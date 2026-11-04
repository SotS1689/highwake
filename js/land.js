// The world far below the islands: the generated heightmap drawn as a vast
// landscape 12 km down, lit by the sun, shadowed by the cloud deck, hazed by
// the air between, with glinting water and forests that glow at night.

import * as THREE from "three";
import { shared, SHADER_END } from "./gfx.js";
import { LAND_N, LAND_SIZE, GROUND_Y } from "./landgen.js";
import { CLOUD_GLSL } from "./sky.js";

export function generateLandAsync(seed = 77) {
    return new Promise((resolve, reject) => {
        const w = new Worker(new URL("./land.worker.js", import.meta.url), { type: "module" });
        w.onmessage = (ev) => { w.terminate(); resolve(ev.data.data); };
        w.onerror = reject;
        w.postMessage({ seed });
    });
}

export class Land {
    constructor(scene, data, sky) {
        const tex = new THREE.DataTexture(data, LAND_N, LAND_N, THREE.RGBAFormat, THREE.HalfFloatType);
        tex.magFilter = tex.minFilter = THREE.LinearFilter;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;

        // a grid that is dense under the play area and stretches out to the horizon
        const G = 320, HALF = LAND_SIZE / 2;
        const warp = (u) => HALF * (0.3 * u + 0.7 * u * u * u);
        const pos = new Float32Array((G + 1) * (G + 1) * 3);
        for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
            const k = (j * (G + 1) + i) * 3;
            pos[k] = warp((i / G) * 2 - 1); pos[k + 1] = 0; pos[k + 2] = warp((j / G) * 2 - 1);
        }
        const idx = [];
        for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
            const a = j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1;
            idx.push(a, c, b, b, c, d);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setIndex(idx);

        this.u = {
            uLand: { value: tex }, uNoise: { value: sky.noiseTex }, uTime: shared.uTime,
            uSunDir: shared.uSunDir, uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightCol: { value: new THREE.Color() },
            uSkyCol: { value: new THREE.Color() }, uHaze: shared.uHaze, uCam: { value: new THREE.Vector3() },
            uGlow: shared.uGlow, uSunColor: shared.uSunColor, uCover: sky.seaU.uCover,
        };
        const mat = new THREE.ShaderMaterial({
            uniforms: this.u, fog: false,
            vertexShader: `
                uniform sampler2D uLand; uniform vec3 uCam;
                varying vec3 vW; varying vec2 vUv;
                void main(){
                    vec3 p = position;
                    vUv = p.xz / ${LAND_SIZE.toFixed(1)} + 0.5;
                    vec4 d = textureLod(uLand, vUv, 0.0);
                    float h = max(d.r, d.g);
                    vec2 off = p.xz - uCam.xz;
                    p.y = ${GROUND_Y.toFixed(1)} + h - dot(off, off) / 2.4e6;   // the curve of the world
                    vW = p;
                    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
                }`,
            fragmentShader: `
                uniform sampler2D uLand, uNoise; uniform float uTime, uGlow, uCover;
                uniform vec3 uSunDir, uLightDir, uLightCol, uSkyCol, uHaze, uCam, uSunColor;
                varying vec3 vW; varying vec2 vUv;
                ${CLOUD_GLSL}
                void main(){
                    float tx = 1.0 / ${LAND_N.toFixed(1)}, spacing = ${(LAND_SIZE / LAND_N).toFixed(2)};
                    vec4 d = texture(uLand, vUv);
                    float hL = texture(uLand, vUv - vec2(tx, 0.)).r, hR = texture(uLand, vUv + vec2(tx, 0.)).r;
                    float hD = texture(uLand, vUv - vec2(0., tx)).r, hU = texture(uLand, vUv + vec2(0., tx)).r;
                    vec3 N = normalize(vec3(hL - hR, 2.0 * spacing, hD - hU));
                    float h = d.r, slope = 1.0 - N.y;
                    vec2 p = vW.xz;
                    float n1 = texture(uNoise, p * 0.00021).a, n2 = texture(uNoise, p * 0.0011).r;
                    float n3 = texture(uNoise, p * 0.0047).g, n4 = texture(uNoise, p * 0.019).b;
                    float dist = length(vW - uCam);
                    // ground cover by moisture, height and slope
                    float m = d.a + (n2 - 0.5) * 0.35;
                    vec3 dry = vec3(0.20, 0.17, 0.09), grass = vec3(0.075, 0.12, 0.035), jungle = vec3(0.02, 0.058, 0.026);
                    vec3 col = mix(dry, grass, smoothstep(0.15, 0.45, m));
                    float forest = smoothstep(0.42, 0.62, m + (n3 - 0.5) * 0.5);
                    col = mix(col, jungle, forest);
                    col *= 0.7 + 0.6 * n3 * (0.6 + 0.4 * n4);
                    float rockF = clamp(smoothstep(0.28, 0.5, slope + (n2 - 0.5) * 0.25) + smoothstep(1900.0, 2700.0, h + (n1 - 0.5) * 900.0), 0.0, 1.0);
                    vec3 rock = mix(vec3(0.13, 0.12, 0.115), vec3(0.24, 0.21, 0.18), n2) * (0.75 + 0.5 * n4);
                    col = mix(col, rock, rockF);
                    float snow = smoothstep(2700.0, 3300.0, h + (n1 - 0.5) * 900.0 + n4 * 200.0) * (1.0 - smoothstep(0.5, 0.75, slope));
                    col = mix(col, vec3(0.82, 0.86, 0.92), snow);
                    col = mix(col, vec3(0.42, 0.37, 0.26), smoothstep(30.0, 4.0, h) * (1.0 - step(h, -1.0)));
                    // light: sun (or moon), sky fill, and the shadows of the cloud deck far above
                    vec3 L = normalize(uLightDir);
                    vec2 sp = p + L.xz / max(L.y, 0.15) * (-20.0 - vW.y);
                    float shade = 1.0 - 0.75 * cloudCover(sp, 0.6);
                    float dif = max(dot(N, L), 0.0) * shade;
                    vec3 lit = col * (uLightCol * dif * 0.6 + uSkyCol * (0.5 + 0.5 * N.y) * 0.6);
                    // water: ocean, lakes and the rivers that wind between them
                    float lakeD = d.g - d.r;
                    float wet = max(step(0.5, lakeD), smoothstep(0.08, 0.35, d.b) * (1.0 - snow));
                    if (wet > 0.0) {
                        vec3 deep = vec3(0.006, 0.03, 0.06), shallow = vec3(0.02, 0.12, 0.13);
                        vec3 wc = mix(shallow, deep, smoothstep(5.0, 120.0, lakeD));
                        vec3 wn = normalize(vec3((n4 - 0.5) * 0.12, 1.0, (texture(uNoise, p * 0.023 + uTime * 0.002).r - 0.5) * 0.12));
                        vec3 V = normalize(uCam - vW);
                        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(V, wn), 0.0), 5.0);
                        float spec = pow(max(dot(reflect(-V, wn), uSunDir), 0.0), 220.0) * 60.0 + pow(max(dot(reflect(-V, wn), uSunDir), 0.0), 12.0) * 0.6;
                        vec3 water = wc * (uSkyCol * 0.4 + uLightCol * 0.1) + uSkyCol * fres * 0.5 + uSunColor * spec * shade * max(uSunDir.y, 0.0);
                        lit = mix(lit, water, wet);
                    }
                    // bioluminescent forests and rivers by night
                    float spark = smoothstep(0.62, 0.8, n4) * smoothstep(0.55, 0.75, n3);
                    lit += vec3(0.1, 0.75, 1.0) * uGlow * uGlow * (forest * spark * 0.14 + wet * d.b * 0.1 + forest * 0.006);
                    // the long blue haze of 12 km of air
                    float T = exp(-dist / 55000.0);
                    vec3 air = uHaze * vec3(0.42, 0.52, 0.7);
                    vec3 col2 = lit * T + air * (1.0 - T);
                    gl_FragColor = vec4(col2, 1.0);
                    ${SHADER_END}
                }`,
        });
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = -6;
        scene.add(this.mesh);
        this.sky = sky;
    }

    update(camera) {
        const s = this.sky;
        this.u.uCam.value.copy(camera.position);
        this.u.uLightDir.value.copy(s.sun.position).sub(s.sun.target.position).normalize();
        this.u.uLightCol.value.copy(s.sun.color).multiplyScalar(s.sun.intensity);
        this.u.uSkyCol.value.copy(s.hemi.color).multiplyScalar(s.hemi.intensity * 0.6);
    }
}
