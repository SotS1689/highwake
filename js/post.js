// The post-processing chain, built to touch every screen pixel as few times as
// possible (each full-screen pass costs about 10 ms at 1080p on integrated graphics):
//
//   scene (HDR, with depth)
//   -> clouds (raymarched at reduced size)        volclouds.js
//   -> sun shafts (half size)                      cinematic.js
//   -> bloom (a small mip chain, half size and below)
//   -> ONE full-size final pass: clouds + haze + shafts + bloom, tone mapping,
//      sRGB, colour grade, vignette, grain and fringe, straight to the screen.

import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { DECK_TOP } from "./volclouds.js";
import { shared } from "./gfx.js";

const VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const quad = (frag, uniforms) => new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false }));

// ---- bloom ----------------------------------------------------------------------------------
// Bright parts are cut out at half size, blurred down a chain of ever-smaller images and
// added back up again. Only the first step reads the full-size image.
export class BloomPass extends Pass {
    constructor({ threshold = 0.88, levels = 5 } = {}) {
        super();
        this.needsSwap = false;
        this.levels = levels;
        const rt = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
        this.down = Array.from({ length: levels }, rt);
        this.up = Array.from({ length: levels - 1 }, rt);
        this.preU = { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: threshold } };
        this.pre = quad(`uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; varying vec2 vUv;
            vec3 f(vec3 c){ float l = max(c.r, max(c.g, c.b)); float k = clamp(l - uThreshold + 0.25, 0.0, 0.5); k = k * k / 0.5;
                return c * max(k, l - uThreshold) / max(l, 1e-4); }
            void main(){
                vec3 c = f(texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb) + f(texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb)
                       + f(texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb) + f(texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb);
                gl_FragColor = vec4(min(c * 0.25, vec3(60.0)), 1.0);
            }`, this.preU);
        this.downU = { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } };
        this.downQ = quad(`uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
            void main(){
                vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
                c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
                c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
                gl_FragColor = vec4(c / 8.0, 1.0);
            }`, this.downU);
        this.upU = { tSmall: { value: null }, tHere: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } };
        this.upQ = quad(`uniform sampler2D tSmall, tHere; uniform vec2 uTexel; uniform float uWeight; varying vec2 vUv;
            void main(){
                vec3 c = vec3(0.0);
                c += texture2D(tSmall, vUv + uTexel * vec2(-1.0, 0.0)).rgb * 2.0 + texture2D(tSmall, vUv + uTexel * vec2(1.0, 0.0)).rgb * 2.0;
                c += texture2D(tSmall, vUv + uTexel * vec2(0.0, -1.0)).rgb * 2.0 + texture2D(tSmall, vUv + uTexel * vec2(0.0, 1.0)).rgb * 2.0;
                c += texture2D(tSmall, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSmall, vUv + uTexel * vec2(1.0, -1.0)).rgb;
                c += texture2D(tSmall, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSmall, vUv + uTexel * vec2(1.0, 1.0)).rgb;
                gl_FragColor = vec4(c / 12.0 + texture2D(tHere, vUv).rgb * uWeight, 1.0);
            }`, this.upU);
        this.size = new THREE.Vector2(1, 1);
    }

    setSize(w, h) {
        this.size.set(w, h);
        for (let i = 0; i < this.levels; i++) {
            const d = 2 ** (i + 1);
            this.down[i].setSize(Math.max(1, Math.round(w / d)), Math.max(1, Math.round(h / d)));
            if (i < this.levels - 1) this.up[i].setSize(Math.max(1, Math.round(w / d)), Math.max(1, Math.round(h / d)));
        }
    }

    get texture() { return this.up[0].texture; }

    render(renderer, writeBuffer, readBuffer) {
        this.preU.tSrc.value = readBuffer.texture;
        this.preU.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
        renderer.setRenderTarget(this.down[0]);
        this.pre.render(renderer);
        for (let i = 1; i < this.levels; i++) {
            const src = this.down[i - 1];
            this.downU.tSrc.value = src.texture;
            this.downU.uTexel.value.set(1 / src.width, 1 / src.height);
            renderer.setRenderTarget(this.down[i]);
            this.downQ.render(renderer);
        }
        // back up: each level adds its own blur to the wider glow from below
        for (let i = this.levels - 2; i >= 0; i--) {
            const small = i === this.levels - 2 ? this.down[i + 1] : this.up[i + 1];
            this.upU.tSmall.value = small.texture;
            this.upU.tHere.value = this.down[i].texture;
            this.upU.uTexel.value.set(1 / small.width, 1 / small.height);
            this.upU.uWeight.value = 0.8;
            renderer.setRenderTarget(this.up[i]);
            this.upQ.render(renderer);
        }
    }
}

// ---- the one full-size pass -------------------------------------------------------------------
export class FinalPass extends Pass {
    constructor({ camera, clouds, rays, bloom, grade }) {
        super();
        this.camera = camera;
        this.clouds = clouds; this.rays = rays; this.bloom = bloom;
        this.u = {
            tScene: { value: null }, tDepth: { value: null }, tCloud: { value: null }, tRays: { value: null }, tBloom: { value: null },
            uClouds: { value: 0 }, uRays: { value: 0 }, uBloom: { value: 0.32 }, uExposure: { value: 1 },
            uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
            uNear: { value: 1 }, uFar: { value: 1000 },
            uSunDir: shared.uSunDir, uSunColor: shared.uSunColor, uHaze: shared.uHaze,
            ...grade,
        };
        this.q = quad(/* glsl */ `
            #include <packing>
            uniform sampler2D tScene, tDepth, tCloud, tRays, tBloom;
            uniform float uClouds, uRays, uBloom, uExposure, uNear, uFar;
            uniform mat4 uInvProj, uCamWorld; uniform vec3 uCam, uSunDir, uSunColor, uHaze;
            uniform float uTime, uSplit, uSat, uContrast, uVignette, uGrain, uFringe;
            uniform vec3 uShadowTint, uHighTint;
            varying vec2 vUv;
            float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
            vec3 hwFilmicFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
            vec3 hwAces(vec3 c){
                const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
                const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
                c *= uExposure / 0.6;
                return clamp(O * hwFilmicFit(I * c), 0.0, 1.0);
            }
            vec3 toSRGB(vec3 c){ return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
            void main(){
                vec2 cc = vUv - 0.5;
                float r2 = dot(cc, cc);
                vec3 col;
                if (uFringe > 0.0005) {
                    vec2 o = cc * r2 * uFringe;
                    col = vec3(texture2D(tScene, vUv - o).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv + o).b);
                } else col = texture2D(tScene, vUv).rgb;
                if (uClouds > 0.5) {
                    vec4 cl = texture2D(tCloud, vUv);
                    col = col * cl.a + cl.rgb;
                    // low-lying haze: thickest at the deck, thinning with height, warm toward the sun
                    vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
                    vec3 vdir = normalize(vp.xyz / vp.w);
                    vec3 D = normalize(mat3(uCamWorld) * vdir);
                    float depth = texture2D(tDepth, vUv).x;
                    if (depth < 0.99999) {
                        float tScene = perspectiveDepthToViewZ(depth, uNear, uFar) / vdir.z;
                        float tEnd = min(tScene, 60000.0);
                        float k = 0.00045;
                        float y0 = uCam.y - ${DECK_TOP.toFixed(1)};
                        float hd = abs(D.y) > 1e-3 ? (exp(-k * max(y0, 0.0)) - exp(-k * max(y0 + D.y * tEnd, 0.0))) / (k * D.y) : exp(-k * max(y0, 0.0)) * tEnd;
                        float haze = 1.0 - exp(-max(hd, 0.0) * 0.000016);
                        vec3 hz = mix(uHaze, uSunColor * 0.9, pow(max(dot(D, uSunDir), 0.0), 6.0) * 0.4);
                        col = mix(col, hz, haze);
                    }
                }
                if (uRays > 0.5) col += texture2D(tRays, vUv).rgb;
                col += texture2D(tBloom, vUv).rgb * uBloom;
                col = toSRGB(hwAces(col));
                // grade: split toning, gentle S-curve and saturation, vignette, grain
                float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
                vec3 tint = mix(uShadowTint, uHighTint, smoothstep(0.1, 0.8, l));
                col = mix(col, col * tint * 1.45, uSplit);
                col = (col - 0.5) * uContrast + 0.5;
                l = dot(col, vec3(0.2126, 0.7152, 0.0722));
                col = mix(vec3(l), col, uSat);
                col *= 1.0 - uVignette * smoothstep(0.08, 0.55, r2 * 1.6);
                float g = hash(vUv * 1731.0 + fract(uTime * 13.7)) - 0.5;
                col += g * uGrain * (1.2 - l);
                gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
            }`, this.u);
    }

    render(renderer, writeBuffer, readBuffer) {
        const u = this.u, cam = this.camera;
        u.tScene.value = readBuffer.texture;
        u.tDepth.value = readBuffer.depthTexture;
        u.uClouds.value = this.clouds?.enabled ? 1 : 0;
        if (u.uClouds.value) u.tCloud.value = this.clouds.texture;
        u.uRays.value = this.rays?.enabled ? 1 : 0;
        if (u.uRays.value) u.tRays.value = this.rays.target.texture;
        u.tBloom.value = this.bloom.texture;
        u.uInvProj.value.copy(cam.projectionMatrixInverse);
        u.uCamWorld.value.copy(cam.matrixWorld);
        u.uCam.value.copy(cam.position);
        u.uNear.value = cam.near; u.uFar.value = cam.far;
        u.uExposure.value = renderer.toneMappingExposure;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.q.render(renderer);
    }
}
