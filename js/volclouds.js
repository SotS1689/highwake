// Volumetric sea of clouds: a post pass that raymarches the cloud deck as a real slab
// of billowing cloud (y = DECK_BASE..DECK_TOP), so you can skim its tops, dive into it
// and see the land through its gaps with soft, deep edges. Its shape is the same field
// as the flat deck and the land's cloud shadows (CLOUD_GLSL), so everything agrees.
// It reads the scene's depth so islands, whales and the dragon sit inside the clouds
// correctly, then adds low-lying haze in the same march: aerial perspective that
// thickens toward the deck and warms toward the sun.
// Performance: the march runs at reduced resolution into its own target; the single
// final pass (post.js) lays it over the scene and adds the haze, which is analytic.

import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { CLOUD_GLSL } from "./sky.js";
import { shared } from "./gfx.js";

export const DECK_BASE = -140, DECK_TOP = 330;

const shader = {
    uniforms: {
        tDiffuse: { value: null }, tDepth: { value: null },
        uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uCam: { value: new THREE.Vector3() }, uNear: { value: 1 }, uFar: { value: 1000 },
        uNoise: { value: null }, uTime: shared.uTime, uCover: { value: 0.555 },
        uSunDir: shared.uSunDir, uSunColor: shared.uSunColor,
        uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uFarCol: { value: new THREE.Color() },
        uHaze: shared.uHaze, uSteps: { value: 32 }, uFrame: { value: 0 },
        tCloud: { value: null }, uTexel: { value: new THREE.Vector2() },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tDiffuse, tDepth, uNoise, tCloud; uniform vec2 uTexel;
        uniform mat4 uInvProj, uCamWorld; uniform vec3 uCam, uSunDir, uSunColor, uLit, uShade, uFarCol, uHaze;
        uniform float uNear, uFar, uTime, uCover, uFrame; uniform int uSteps;
        varying vec2 vUv;
        ${CLOUD_GLSL}
        const float YB = ${DECK_BASE.toFixed(1)}, YT = ${DECK_TOP.toFixed(1)};
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        // cloud height above the base at this point of the deck, and its density at height y
        float density(vec3 p, float det, out float top){
            float h = H(p.xz, det);
            float c = clamp((h - uCover + 0.045) / 0.32, 0.0, 1.0);
            top = YB + 110.0 + c * c * (YT - YB - 110.0) * 1.15;
            // billows: wispy erosion from a pseudo-3D lookup, stronger near the tops and edges
            float n = texture2D(uNoise, p.xz * 0.0021 + vec2(p.y * 0.0017, -p.y * 0.0011) + uTime * 0.0006).g;
            float edge = top - p.y;
            float d = smoothstep(0.0, 45.0 + 45.0 * n + 60.0 * (1.0 - smoothstep(200.0, 1500.0, length(p - uCam))), edge) * smoothstep(YB - 20.0, YB + 90.0, p.y);
            d *= smoothstep(0.0, 0.05, c);
            d *= mix(1.0, smoothstep(0.25, 0.75, n + c * 0.35), smoothstep(160.0, 0.0, edge) * det);
            return d;
        }

        void main(){
            // world-space ray through this pixel
            vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
            vec3 vdir = normalize(vp.xyz / vp.w);
            vec3 D = normalize(mat3(uCamWorld) * vdir);
            #ifdef MARCH
            // this half-res pixel covers 2x2 scene pixels: stop at the nearest of them, so
            // cloud never smears over the edge of something in front of it
            float depth = min(min(texture2D(tDepth, vUv + uTexel * vec2(-0.5, -0.5)).x, texture2D(tDepth, vUv + uTexel * vec2(0.5, -0.5)).x),
                              min(texture2D(tDepth, vUv + uTexel * vec2(-0.5, 0.5)).x, texture2D(tDepth, vUv + uTexel * vec2(0.5, 0.5)).x));
            #else
            float depth = texture2D(tDepth, vUv).x;
            #endif
            float tScene = depth >= 0.99999 ? 1e9 : perspectiveDepthToViewZ(depth, uNear, uFar) / vdir.z;

            #ifdef MARCH
            vec3 col = vec3(0.0); float T = 1.0;
            // slab entry and exit
            float t0, t1;
            if (abs(D.y) < 1e-4) { t0 = (uCam.y > YB && uCam.y < YT) ? 0.0 : 1e9; t1 = 90000.0; }
            else {
                float ta = (YB - uCam.y) / D.y, tb = (YT - uCam.y) / D.y;
                t0 = max(min(ta, tb), 0.0); t1 = max(ta, tb);
            }
            t1 = min(min(t1, tScene), 90000.0);
            if (t1 > t0) {
                float len = t1 - t0;
                int N = uSteps;
                // fewer, longer steps cover grazing rays through the far deck
                // steps grow with distance (quadratic spacing), so close cloud is finely sampled
                // interleaved gradient noise: a much finer, more even dither than white noise
                float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * 5.588238, vec2(0.06711056, 0.00583715))));
                float sunUp = clamp(uSunDir.y * 3.0 + 0.2, 0.0, 1.0);
                float phase = pow(max(dot(D, uSunDir), 0.0), 8.0) * 0.8 + pow(max(dot(D, uSunDir), 0.0), 2.0) * 0.25;
                for (int i = 0; i < 96; i++) {
                    if (i >= N || T < 0.02) break;
                    float s0 = (float(i) + jit) / float(N);
                    float t = t0 + len * s0 * s0;
                    float dt = len * (2.0 * s0 + 1.0 / float(N)) / float(N);
                    vec3 p = uCam + D * t;
                    float dist = t;
                    float det = 1.0 - smoothstep(1500.0, 14000.0, dist);
                    float top;
                    float d = density(p, det, top);
                    if (d > 0.002) {
                        // lit from above: bright tops, blue-grey depths, a silver rim toward the sun
                        float hgt = clamp((p.y - YB) / max(top - YB, 1.0), 0.0, 1.0);
                        float lit = pow(hgt, 0.8) * (0.75 + 0.25 * sunUp);
                        vec3 c = mix(uShade, uLit, clamp(lit * 0.9 + 0.1, 0.0, 1.0));
                        c += uSunColor * phase * (0.35 + 0.65 * (1.0 - d)) * sunUp * 0.6;
                        float fogF = 1.0 - exp(-dist * 0.000042);
                        c = mix(c, uFarCol, clamp(fogF, 0.0, 1.0));
                        float sigma = 0.03 * d * (0.5 + 0.5 * det) + 0.004 * d;
                        float a = 1.0 - exp(-sigma * dt);
                        col += T * a * c;
                        T *= 1.0 - a;
                    }
                }
            }
            gl_FragColor = vec4(col, T);
            #else
            vec4 base = texture2D(tDiffuse, vUv);
            vec4 cl = texture2D(tCloud, vUv);
            vec3 col = cl.rgb; float T = cl.a;
            // low-lying haze: thickest at the deck, thinning with height, warm toward the sun
            float tEnd = min(tScene, 60000.0);
            float k = 0.00045;                 // 1 / haze scale height
            float y0 = uCam.y - YT;
            float hd = abs(D.y) > 1e-3 ? (exp(-k * max(y0, 0.0)) - exp(-k * max(y0 + D.y * tEnd, 0.0))) / (k * D.y) : exp(-k * max(y0, 0.0)) * tEnd;
            float haze = 1.0 - exp(-max(hd, 0.0) * 0.000016);
            vec3 hz = mix(uHaze, uSunColor * 0.9, pow(max(dot(D, uSunDir), 0.0), 6.0) * 0.4);
            vec3 outc = base.rgb * T + col;
            outc = mix(outc, hz, haze * (tScene < 1e8 ? 1.0 : 0.0));
            gl_FragColor = vec4(outc, base.a);
            #endif
        }`,
};

export class VolumetricClouds extends Pass {
    constructor(sky, camera) {
        super();
        this.sky = sky;
        this.camera = camera;
        const make = (march) => new THREE.ShaderMaterial({
            ...shader, defines: march ? { MARCH: "" } : {},
            uniforms: this.u, depthTest: false, depthWrite: false,
        });
        const u = (this.u = THREE.UniformsUtils.clone(shader.uniforms));
        // keep the shared (live) uniforms shared
        for (const k of ["uTime", "uSunDir", "uSunColor", "uHaze"]) u[k] = shader.uniforms[k];
        u.uNoise.value = sky.noiseTex;
        u.uCover = sky.seaU.uCover;
        this.needsSwap = false;
        this.marchQuad = new FullScreenQuad(make(true));
        this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
        this.scale = 0.5;
        this.frame = 0;
    }

    setSteps(n) { this.u.uSteps.value = n; }

    setSize(w, h) {
        this.target.setSize(Math.max(1, Math.round(w * this.scale)), Math.max(1, Math.round(h * this.scale)));
        this.u.uTexel.value.set(1 / w, 1 / h);
    }

    render(renderer, writeBuffer, readBuffer) {
        const u = this.u, cam = this.camera;
        u.tDiffuse.value = readBuffer.texture;
        u.tDepth.value = readBuffer.depthTexture;
        u.uInvProj.value.copy(cam.projectionMatrixInverse);
        u.uCamWorld.value.copy(cam.matrixWorld);
        u.uCam.value.copy(cam.position);
        u.uNear.value = cam.near; u.uFar.value = cam.far;
        u.uLit.value.copy(this.sky.seaU.uLit.value);
        u.uShade.value.copy(this.sky.seaU.uShade.value);
        u.uFarCol.value.copy(this.sky.seaU.uFar.value);
        u.uFrame.value = this.frame = (this.frame + 1) % 64;
        renderer.setRenderTarget(this.target);
        this.marchQuad.render(renderer);
    }

    get texture() { return this.target.texture; }

    dispose() { this.marchQuad.material.dispose(); this.marchQuad.dispose(); this.target.dispose(); }
}
