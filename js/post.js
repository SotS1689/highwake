// The post-processing chain, built to touch every screen pixel as few times as
// possible (each full-screen pass costs about 10 ms at 1080p on integrated graphics):
//
//   scene (HDR, with depth), drawn smaller than the screen on slower computers
//   -> temporal anti-aliasing: each frame blended with the ones before it
//   -> clouds (raymarched at reduced size)        volclouds.js
//   -> sun shafts (half size)                      cinematic.js
//   -> bloom (a small mip chain, half size and below)
//   -> ONE final pass at the screen's own size: sharpened upscale of the scene, clouds +
//      haze + shafts + bloom, tone mapping, sRGB, colour grade, vignette, grain and
//      fringe, straight to the screen.

import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { DECK_TOP } from "./volclouds.js";
import { shared } from "./gfx.js";

const VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const quad = (frag, uniforms) => new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false }));

// ---- temporal anti-aliasing ---------------------------------------------------------------
// The trick most big games lean on for foliage. Every frame the camera is nudged by a
// different fraction of a pixel, and the new frame is blended into a running average of
// the frames before it. Over a few frames each pixel has been sampled at many spots, so
// the hard cut-out edges of leaves, thin branches and distant forest come out smooth,
// as if drawn at several times the resolution, for the price of one extra pass.
// To follow the camera, each pixel looks up where its piece of the world was on screen
// last frame (from the depth image); the old colour is kept only if it is close to what
// is around the pixel now, so things that moved don't leave ghosts. The dragon moves
// with the camera, so pixels near it are looked up with the dragon's own motion.
const HALTON = [[0, -0.167], [-0.25, 0.167], [0.25, -0.389], [-0.375, -0.056], [0.125, 0.278], [-0.125, -0.278], [0.375, 0.056], [-0.438, 0.389]];
export class TAAPass extends Pass {
    constructor(camera) {
        super();
        this.camera = camera;
        this.needsSwap = false;
        const opt = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
        this.hist = [new THREE.WebGLRenderTarget(1, 1, opt), new THREE.WebGLRenderTarget(1, 1, opt)];
        this.u = {
            tCur: { value: null }, tHist: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uReset: { value: 1 },
            uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uCurVP: { value: new THREE.Matrix4() },
            uDragon: { value: new THREE.Vector3(0, -1e6, 0) }, uDragonMove: { value: new THREE.Vector3() },
        };
        this.q = quad(/* glsl */ `
            uniform sampler2D tCur, tHist, tDepth; uniform vec2 uTexel; uniform float uReset;
            uniform mat4 uInvVP, uPrevVP, uCurVP; uniform vec3 uDragon, uDragonMove;
            varying vec2 vUv;
            // work on compressed brightness, so one very bright pixel (the sun, a glint) can't flicker
            // A pixel that overflowed (looking into the sun) or isn't a number would otherwise
            // get into the running average and spread through it until the screen went dark.
            vec3 ok(vec3 c){ return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : clamp(c, 0.0, 3.0e4); }
            vec3 tm(vec3 c){ c = ok(c); return c / (1.0 + max(c.r, max(c.g, c.b))); }
            vec3 itm(vec3 c){ return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
            // Read the running average with a sharp (Catmull-Rom) filter, in five lookups.
            // A plain smooth lookup blurs the picture a little more every frame the camera
            // moves, which is what made everything look out of focus.
            vec3 histSharp(vec2 uv){
                vec2 pos = uv / uTexel, c1 = floor(pos - 0.5) + 0.5, f = pos - c1;
                vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
                vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
                vec2 w12 = w1 + w2, t0 = (c1 - 1.0) * uTexel, t3 = (c1 + 2.0) * uTexel, t12 = (c1 + w2 / w12) * uTexel;
                vec4 r = vec4(texture2D(tHist, vec2(t12.x, t0.y)).rgb, 1.0) * (w12.x * w0.y)
                       + vec4(texture2D(tHist, vec2(t0.x, t12.y)).rgb, 1.0) * (w0.x * w12.y)
                       + vec4(texture2D(tHist, vec2(t12.x, t12.y)).rgb, 1.0) * (w12.x * w12.y)
                       + vec4(texture2D(tHist, vec2(t3.x, t12.y)).rgb, 1.0) * (w3.x * w12.y)
                       + vec4(texture2D(tHist, vec2(t12.x, t3.y)).rgb, 1.0) * (w12.x * w3.y);
                return ok(r.rgb / max(r.a, 1e-4));
            }
            void main(){
                vec4 c4 = texture2D(tCur, vUv);
                vec3 c = tm(c4.rgb);
                float leaf = 1.0 - c4.a;       // foliage marks its pixels (gfx.js): it moves in the wind
                vec3 mn = c, mx = c, m1 = c, m2 = c * c;
                float d = texture2D(tDepth, vUv).x;
                for (int i = 0; i < 4; i++) {
                    vec2 o = (i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(-1.0, 0.0) : i == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0)) * uTexel;
                    vec3 a = tm(texture2D(tCur, vUv + o).rgb);
                    mn = min(mn, a); mx = max(mx, a); m1 += a; m2 += a * a;
                    // the nearest thing around this pixel decides its motion, so the edge of a
                    // near leaf against far sky moves with the leaf
                    d = min(d, texture2D(tDepth, vUv + o).x);
                    vec2 o2 = (i == 0 ? vec2(1.0, 1.0) : i == 1 ? vec2(-1.0, 1.0) : i == 2 ? vec2(1.0, -1.0) : vec2(-1.0, -1.0)) * uTexel;
                    vec3 b = tm(texture2D(tCur, vUv + o2).rgb);
                    mn = min(mn, b); mx = max(mx, b); m1 += b; m2 += b * b;
                }
                if (uReset > 0.5) { gl_FragColor = vec4(ok(itm(c)), 1.0); return; }
                m1 /= 9.0;
                vec3 sd = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
                mn = max(mn, m1 - 1.25 * sd); mx = min(mx, m1 + 1.25 * sd);
                vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
                vec3 wp = w.xyz / w.w, was = wp;
                if (d < 0.99999 && distance(wp, uDragon) < 26.0) was -= uDragonMove;
                vec4 pc = uPrevVP * vec4(was, 1.0), cc = uCurVP * vec4(wp, 1.0);
                vec2 vel = (pc.xy / pc.w - cc.xy / cc.w) * 0.5;
                vec2 huv = vUv + vel;
                if (pc.w <= 0.0 || any(lessThan(huv, vec2(0.0))) || any(greaterThan(huv, vec2(1.0)))) { gl_FragColor = vec4(itm(c), 1.0); return; }
                vec3 h = tm(histSharp(huv));
                h = clamp(h, mn, mx);
                // more of the new frame where the picture is moving fast (crisp in motion,
                // smoothest when still)
                float k = mix(0.12, 0.4, clamp(length(vel / uTexel) / 16.0, 0.0, 1.0));
                k = max(k, leaf * 0.55);
                gl_FragColor = vec4(ok(itm(mix(h, c, k))), 1.0);
            }`, this.u);
        this.w = this.h = 1;
        this.frame = 0;
        this.reset = true;
        this.prevVP = new THREE.Matrix4();
        this.lastCam = new THREE.Vector3();
        this.lastDragon = null;
    }

    setSize(w, h) {
        this.w = w; this.h = h;
        for (const t of this.hist) t.setSize(w, h);
        this.u.uTexel.value.set(1 / w, 1 / h);
        this.reset = true;
    }

    // Call just before the scene is drawn: shifts the view by a fraction of a pixel.
    jitter() {
        const [x, y] = HALTON[this.frame++ % HALTON.length];
        this.camera.setViewOffset(this.w, this.h, x, y, this.w, this.h);
    }

    // where the dragon is now (null: no dragon in view), so its pixels are followed properly
    setDragon(pos) {
        const u = this.u;
        if (pos && this.lastDragon) { u.uDragon.value.copy(pos); u.uDragonMove.value.subVectors(pos, this.lastDragon); }
        else u.uDragon.value.set(0, -1e6, 0);
        this.lastDragon = pos ? (this.lastDragon || new THREE.Vector3()).copy(pos) : null;
    }

    render(renderer, writeBuffer, readBuffer) {
        const u = this.u, cam = this.camera, [read, write] = this.hist;
        // this frame's view without the sub-pixel shift, to measure real motion against
        const view = cam.view, on = view && view.enabled;
        if (on) { view.enabled = false; cam.updateProjectionMatrix(); }
        u.uCurVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        if (on) { view.enabled = true; cam.updateProjectionMatrix(); }
        u.uInvVP.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
        u.uPrevVP.value.copy(this.prevVP);
        // a jump (respawn, a new view): start the average afresh
        if (cam.position.distanceTo(this.lastCam) > 400) this.reset = true;
        u.uReset.value = this.reset ? 1 : 0;
        u.tCur.value = readBuffer.texture; u.tDepth.value = readBuffer.depthTexture; u.tHist.value = read.texture;
        renderer.setRenderTarget(write);
        this.q.render(renderer);
        this.hist.reverse();
        this.prevVP.copy(u.uCurVP.value);
        this.lastCam.copy(cam.position);
        this.reset = false;
    }

    get texture() { return this.hist[0].texture; }
}

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
        this.taa = null;       // when set, bloom reads the smoothed image
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
        this.preU.tSrc.value = this.taa?.enabled ? this.taa.texture : readBuffer.texture;
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
// It runs at the screen's own size even when the scene was drawn smaller: the scene is
// stretched up here with a sharpening filter (as console games do), which looks far
// crisper than letting the browser stretch a small canvas.
export class FinalPass extends Pass {
    constructor({ camera, clouds, rays, bloom, grade, taa }) {
        super();
        this.camera = camera;
        this.clouds = clouds; this.rays = rays; this.bloom = bloom; this.taa = taa;
        this.u = {
            tScene: { value: null }, tDepth: { value: null }, tCloud: { value: null }, tRays: { value: null }, tBloom: { value: null },
            uClouds: { value: 0 }, uRays: { value: 0 }, uBloom: { value: 0.32 }, uExposure: { value: 1 },
            uSTexel: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0.55 },
            uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
            uNear: { value: 1 }, uFar: { value: 1000 }, uCTexel: { value: new THREE.Vector2(1, 1) },
            uSunDir: shared.uSunDir, uSunColor: shared.uSunColor, uHaze: shared.uHaze,
            ...grade,
        };
        this.q = quad(/* glsl */ `
            #include <packing>
            uniform sampler2D tScene, tDepth, tCloud, tRays, tBloom;
            uniform float uClouds, uRays, uBloom, uExposure, uNear, uFar;
            uniform mat4 uInvProj, uCamWorld; uniform vec3 uCam, uSunDir, uSunColor, uHaze; uniform vec2 uCTexel, uSTexel; uniform float uSharp;
            float lz(vec2 uv){ float d = texture2D(tDepth, uv).x; return d >= 0.99999 ? 1e7 : -perspectiveDepthToViewZ(d, uNear, uFar); }
            // The clouds are marched at reduced size. Stretched up plainly, each cloud pixel
            // straddling the dragon's outline blends clear air into the cloud beside it (and
            // cloud onto the dragon): a fuzzy halo. Instead, of the four nearest cloud pixels,
            // lean on the ones marched to about the same depth as this screen pixel.
            vec4 cloudAt(vec2 uv){
                vec2 st = uv / uCTexel - 0.5, i0 = floor(st), f = st - i0;
                float z0 = lz(uv);
                vec4 acc = vec4(0.0); float ws = 0.0;
                for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
                    vec2 tuv = (i0 + vec2(float(i), float(j)) + 0.5) * uCTexel;
                    float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) + 1e-3;
                    float rel = abs(lz(tuv) - z0) / max(min(lz(tuv), z0), 1.0);
                    float w = bw / (0.01 + rel * rel * 400.0);
                    acc += texture2D(tCloud, tuv) * w; ws += w;
                }
                return acc / ws;
            }
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
                // sharpen: push each pixel away from the average of its four neighbours, but
                // never beyond the brightest or darkest of them (no halos), on compressed
                // brightness so highlights don't ring
                vec3 col = texture2D(tScene, vUv).rgb;
                {
                    vec3 c0 = col / (1.0 + col);
                    vec3 a = texture2D(tScene, vUv + vec2(uSTexel.x, 0.0)).rgb, b = texture2D(tScene, vUv - vec2(uSTexel.x, 0.0)).rgb;
                    vec3 c = texture2D(tScene, vUv + vec2(0.0, uSTexel.y)).rgb, d = texture2D(tScene, vUv - vec2(0.0, uSTexel.y)).rgb;
                    a /= 1.0 + a; b /= 1.0 + b; c /= 1.0 + c; d /= 1.0 + d;
                    vec3 lo = min(c0, min(min(a, b), min(c, d))), hi = max(c0, max(max(a, b), max(c, d)));
                    vec3 s = clamp(c0 + (c0 - (a + b + c + d) * 0.25) * uSharp, lo, hi);
                    col = s / max(1.0 - s, 1e-3);
                }
                if (uFringe > 0.0005) {
                    vec2 o = cc * r2 * uFringe;
                    col.r = texture2D(tScene, vUv - o).r; col.b = texture2D(tScene, vUv + o).b;
                }
                if (uClouds > 0.5) {
                    vec4 cl = cloudAt(vUv);
                    col = col * cl.a + cl.rgb;
                }
                {
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

    setSize(w, h) { this.u.uSTexel.value.set(1 / w, 1 / h); }

    render(renderer, writeBuffer, readBuffer) {
        const u = this.u, cam = this.camera;
        u.tScene.value = this.taa?.enabled ? this.taa.texture : readBuffer.texture;
        u.tDepth.value = readBuffer.depthTexture;
        u.uClouds.value = this.clouds?.enabled ? 1 : 0;
        if (u.uClouds.value) {
            u.tCloud.value = this.clouds.texture;
            u.uCTexel.value.set(1 / this.clouds.target.width, 1 / this.clouds.target.height);
        }
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
