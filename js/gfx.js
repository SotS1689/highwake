// Shared rendering helpers: global shader uniforms, generated textures, the
// glow-capable material and a small geometry builder.

import * as THREE from "three";
import { makeNoise } from "./noise.js";

export const shared = {
    uTime: { value: 0 },
    uGlow: { value: 0 },          // bioluminescence strength (night = high)
    uGlowColor: { value: new THREE.Color(0.25, 0.95, 1.0) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uHaze: { value: new THREE.Color(0.7, 0.8, 0.9) },
    uShadow: { value: new THREE.Color(0.4, 0.45, 0.55) },
    // island shadows: the nearest islands as sun-blocking discs (x, y, z, radius)
    uIsl: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, -1e6, 0, 0)) },
    uIslN: { value: 0 },
    uDragonShade: { value: 1 },   // how much direct sun reaches the dragon (islands overhead)
    // the dragon's air, for plants: where it is, how fast it moves, and the last downstroke
    uDragonPos: { value: new THREE.Vector3(0, -1e6, 0) },
    uDragonVel: { value: new THREE.Vector3() },
    uBeatPos: { value: new THREE.Vector3(0, -1e6, 0) },
    uBeatAge: { value: 99 },
    uBeatAmp: { value: 0 },
};

// Push (in metres, world space) that the dragon's air gives a plant at world point wp:
// its wake shoves plants aside and drags them along behind it, lingering a moment after
// it passes; each downstroke rolls a ring of air outward from beneath the wings.
// agit (0..2) says how stirred up the air is there, for leaf flutter.
export const DRAGON_WAKE_GLSL = `
    uniform vec3 uDragonPos, uDragonVel, uBeatPos; uniform float uBeatAge, uBeatAmp;
    vec3 dragonWake(vec3 wp, out float agit){
        agit = 0.0;
        vec3 to = wp - uDragonPos;
        float d = length(to);
        if (d > 560.0) return vec3(0.0);
        float sp = length(uDragonVel);
        vec3 vd = sp > 1.0 ? uDragonVel / sp : vec3(0.0, 0.0, 1.0);
        float along = dot(to, vd);
        vec3 perp = to - vd * along;
        float pl = length(perp);
        vec3 away = pl > 0.5 ? perp / pl : vec3(0.0, -1.0, 0.0);
        float spK = clamp(sp / 80.0, 0.0, 1.8);
        // the wake: a broad channel of air dragged along behind the dragon
        float behind = along < 0.0 ? exp(along / 200.0) : 0.0;
        float wake = exp(-pl * pl / 16900.0) * behind * spK;
        // the bow wave: air shoved out ahead of the dragon, so plants in front of it lean
        // away before it arrives (the part the player sees, flying forward)
        float ahead = along >= 0.0 ? exp(-along / 150.0) * (1.0 - exp(-along / 18.0) * 0.5) : 0.0;
        float bow = exp(-pl * pl / 22500.0) * ahead * spK;
        vec3 push = (away * 0.9 + vd * 0.5 - vec3(0.0, 0.3, 0.0)) * wake * 18.0
                  + (away * 1.0 + vd * 0.35) * bow * 14.0;
        vec3 tb = wp - uBeatPos;
        float db = length(tb.xz);
        float ringR = 20.0 + uBeatAge * 120.0;
        float ring = exp(-pow((db - ringR) / 34.0, 2.0)) * exp(-uBeatAge * 1.1) * uBeatAmp
            * exp(-abs(uBeatPos.y - wp.y) / 220.0);
        push += vec3(tb.x, 0.0, tb.z) / max(db, 1.0) * ring * 15.0 - vec3(0.0, ring * 5.0, 0.0);
        agit = clamp(wake + bow * 1.2 + ring * 1.8, 0.0, 2.5);
        // buffeting: the air comes in gusts, not one steady shove
        float buf = 1.0 + 0.45 * sin(uTime * 7.0 + d * 0.11) * min(agit, 1.0) + 0.25 * sin(uTime * 13.0 + d * 0.23);
        return push * buf;
    }`;

// Islands block the sun as soft discs at their middle height; the shadow's edge softens
// with distance from the island (the sun isn't a point). Cheap enough to run per pixel.
export const ISLAND_SHADOW_GLSL = `
    uniform vec4 uIsl[16]; uniform int uIslN;
    float islandShadow(vec3 p, vec3 L){
        if (L.y < 0.02) return 1.0;
        float s = 1.0;
        for (int i = 0; i < 16; i++) {
            if (i >= uIslN) break;
            vec4 c = uIsl[i];
            float t = (c.y - p.y) / L.y;
            if (t <= 0.0) continue;
            vec2 q = p.xz + L.xz * t - c.xz;
            float pen = c.w * 0.12 + t * 0.012;
            s *= smoothstep(c.w * 0.72 - pen, c.w * 0.72 + pen, length(q));
        }
        return mix(1.0, s, smoothstep(0.02, 0.12, L.y));
    }
`;

// Called every frame: hand the shaders the islands nearest the camera, and work out
// (on the CPU, same maths) how shaded the dragon is.
const _islTmp = [];
export function updateIslandShadows(entities, cam, dragonPos, frame) {
    const L = shared.uSunDir.value;
    if (frame % 8 === 0 || !_islTmp.length) {
        _islTmp.length = 0;
        for (const e of entities) if (e.kind === "island" && (e.r || 0) > 120) _islTmp.push(e);
        _islTmp.sort((a, b) => Math.hypot(a.pos[0] - cam.x, a.pos[2] - cam.z) - Math.hypot(b.pos[0] - cam.x, b.pos[2] - cam.z));
        const n = Math.min(16, _islTmp.length);
        for (let i = 0; i < n; i++) { const e = _islTmp[i]; shared.uIsl.value[i].set(e.pos[0], e.pos[1], e.pos[2], e.r); }
        shared.uIslN.value = n;
    }
    let s = 1;
    if (dragonPos && L.y > 0.02) {
        for (let i = 0; i < shared.uIslN.value; i++) {
            const c = shared.uIsl.value[i];
            const t = (c.y - dragonPos.y) / L.y;
            if (t <= 0) continue;
            const d = Math.hypot(dragonPos.x + L.x * t - c.x, dragonPos.z + L.z * t - c.z);
            const pen = c.w * 0.12 + t * 0.012, a = c.w * 0.72 - pen, b = c.w * 0.72 + pen;
            const k = Math.min(1, Math.max(0, (d - a) / (b - a)));
            s *= k * k * (3 - 2 * k);
        }
        const fade = Math.min(1, Math.max(0, (L.y - 0.02) / 0.1));
        s = 1 + (s - 1) * fade;
    }
    // ease, so flying into shade is a smooth dimming rather than a switch
    shared.uDragonShade.value += (Math.max(0.12, s) - shared.uDragonShade.value) * 0.15;
}

// Tileable fBm noise in four channels at different scales
export function makeNoiseTexture(size = 256) {
    const n = makeNoise(4242);
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // blend four shifted copies so the edges wrap seamlessly
            const u = x / size, w = y / size;
            for (let c = 0; c < 4; c++) {
                const s = [4, 8, 16, 2][c];
                const f = (a, b) => n.fbm(a * s, b * s, c * 13.7, 4);
                const v = f(u, w) * (1 - u) * (1 - w) + f(u - 1, w) * u * (1 - w) + f(u, w - 1) * (1 - u) * w + f(u - 1, w - 1) * u * w;
                data[(y * size + x) * 4 + c] = Math.max(0, Math.min(255, (v * 0.7 + 0.5) * 255));
            }
        }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}

// Soft cumulus puff for billboard clouds
export function makePuffTexture(size = 256) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const g = cv.getContext("2d");
    const n = makeNoise(99);
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = (x / size) * 2 - 1, v = (y / size) * 2 - 1;
            const r = Math.hypot(u, v * 1.15);
            const billow = n.fbm(u * 2.2, v * 2.2, 0.5, 5) * 0.55;
            let a = 1 - (r + billow * 0.6);
            a = Math.max(0, Math.min(1, a * 1.8));
            a = a * a * (3 - 2 * a);
            const i = (y * size + x) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
            img.data[i + 3] = a * 255;
        }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
}

// CC0 photo textures from ambientCG (see README): rock, cliff and grass for the
// islands, and a bark + leaf-clump atlas for the trees
let TEX = null;
const loading = [];
export function textures() {
    if (TEX) return TEX;
    const L = new THREE.TextureLoader();
    const get = (f, color = true) => {
        let done;
        loading.push(new Promise((r) => (done = r)));
        const t = L.load(new URL(`../tex/${f}`, import.meta.url).href, done, undefined, done);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = 8;
        return t;
    };
    TEX = {
        cliff: get("cliff_c.jpg"), cliffN: get("cliff_n.jpg", false), rock: get("rock_c.jpg"),
        grass: get("grass_c.jpg"), grassN: get("grass_n.jpg", false), tree: get("tree_atlas.png"), bark: get("bark_c.jpg"), barkN: get("bark_n.jpg", false),
        leaves: get("leaves.png"), undergrowth: get("undergrowth.png"), alien: get("alien.png"),
    };
    // the leaves atlases are addressed with glTF uvs (no flip), cells must not bleed into each other
    for (const t of [TEX.leaves, TEX.undergrowth, TEX.alien]) { t.flipY = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
    TEX.tree.wrapS = TEX.tree.wrapT = THREE.ClampToEdgeWrapping;
    return TEX;
}
export function texturesReady() {
    textures();
    return Promise.all(loading);
}

// Triplanar rock and grass detail. Texture colour is divided by its average so the
// art-directed vertex colours keep their hue and the photo adds the grain.
const DETAIL_GLSL = `
    uniform sampler2D tCliff, tCliffN, tRock, tGrass, tGrassN, tBark;
    varying vec3 vNW;
    vec3 triC(sampler2D t, vec3 p, vec3 w, float s){ return texture2D(t, p.zy*s).rgb*w.x + texture2D(t, p.xz*s).rgb*w.y + texture2D(t, p.xy*s).rgb*w.z; }
    vec3 triN(sampler2D t, vec3 p, vec3 w, float s){
        vec3 a = texture2D(t, p.zy*s).xyz*2.-1., b = texture2D(t, p.xz*s).xyz*2.-1., c = texture2D(t, p.xy*s).xyz*2.-1.;
        return vec3(0., a.y, a.x)*w.x + vec3(b.x, 0., b.y)*w.y + vec3(c.x, c.y, 0.)*w.z;
    }
`;
const DETAIL_COLOR = `
    vec3 nW = normalize(vNW);
    vec3 bw = pow(abs(nW), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
    float grassW = smoothstep(0.008, 0.05, vColor.g - vColor.r);
    vec3 cd = vec3(1.0), gd = vec3(1.0), pert = vec3(0.0);
    #ifdef BARK
    if (grassW < 0.99) cd = (triC(tBark, vVW, bw, 1.0/22.0) * 0.6 + triC(tBark, vVW, bw, 1.0/110.0) * 0.4) / vec3(0.199, 0.139, 0.086);
    #else
    // a ragged grass line instead of the smooth per-vertex one; where grass is taken
    // away the vertex green becomes bare, earthy rock
    float nA = vn3(vVW * 0.045), nB = vn3(vVW * 0.0035 + 3.1);
    float gV = grassW;
    grassW = smoothstep(0.25, 0.75, grassW + (nA - 0.5) * 0.9);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.45, 0.4, 0.15))) * vec3(1.05, 0.95, 0.8), clamp(gV - grassW, 0.0, 1.0));
    if (grassW < 0.99) {
        // de-tiling: the lookups are warped by low-frequency noise (so the grid of
        // repeats bends away), the big layer is rotated against the small one, and the
        // two are mixed in proportions that wander across the island
        vec3 wp = vVW + (vec3(nA, 1.0 - nA, nB) - 0.5) * vec3(16.0, 11.0, 16.0) + vec3(nB * 23.0, 0.0, -nB * 17.0);
        vec3 rp = vec3(0.788 * vVW.x - 0.616 * vVW.z, vVW.y * 0.93 + nA * 9.0, 0.616 * vVW.x + 0.788 * vVW.z);
        float mixK = 0.35 + 0.4 * smoothstep(0.2, 0.8, nB + (nA - 0.5) * 0.3);
        cd = (triC(tCliff, wp, bw, 1.0/9.0) * (1.0 - mixK) + triC(tCliff, rp, bw, 1.0/53.0) * mixK) / vec3(0.19, 0.179, 0.135);
        if (nW.y < -0.15) cd = mix(cd, triC(tRock, wp.zyx, bw.zyx, 1.0/16.0) / vec3(0.084, 0.0785, 0.066), smoothstep(-0.15, -0.6, nW.y));
        pert += triN(tCliffN, wp, bw, 1.0/9.0) * (1.0 - grassW) * 0.9;
        // rock beds: irregular bands from noise stretched sideways (no fixed spacing, so
        // they never read as ruled lines), tilting and pinching out across the face, and
        // big warm/cool patches so a cliff isn't one flat brown
        float bed = vn3(vec3(vVW.x * 0.004, vVW.y * 0.045 + nB * 2.5 + vVW.x * 0.006, vVW.z * 0.004));
        cd *= (0.86 + 0.24 * bed) * mix(vec3(0.9, 0.95, 1.05), vec3(1.1, 0.98, 0.85), nB);
    }
    #endif
    if (grassW > 0.01) {
        gd = (triC(tGrass, vVW, bw, 1.0/5.0) * 0.35 + triC(tGrass, vVW, bw, 1.0/37.0) * 0.35 + triC(tGrass, vVW, bw, 1.0/190.0) * 0.3) / vec3(0.126, 0.16, 0.035);
        vec3 gn = texture2D(tGrassN, vVW.xz / 5.0).xyz * 2.0 - 1.0;
        pert += vec3(gn.x, 0.0, gn.y) * grassW * 0.6;
    }
    gd = pow(gd, vec3(1.5));
    vec3 det = mix(cd, gd, grassW);
    det *= 1.0 - 0.3 * grassW * (1.0 - grassW) * 4.0;       // darker soil where grass meets rock
    det = mix(vec3(dot(det, vec3(0.3333))), det, 0.45);
    det = pow(det, vec3(1.25));
    diffuseColor.rgb *= clamp(det, 0.0, 3.0);
`;

// MeshStandardMaterial that reads a per-vertex "glow" attribute and lights it at night
const VEIN_GLSL = `
    float vh3(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.-2.*f);
        return mix(mix(mix(vh3(i), vh3(i+vec3(1,0,0)), f.x), mix(vh3(i+vec3(0,1,0)), vh3(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(vh3(i+vec3(0,0,1)), vh3(i+vec3(1,0,1)), f.x), mix(vh3(i+vec3(0,1,1)), vh3(i+vec3(1,1,1)), f.x), f.y), f.z); }
    float veins(vec3 w){
        float a = abs(vn3(w*vec3(0.018,0.006,0.018)) - 0.5) * 2.0;
        float b = abs(vn3(w*vec3(0.05,0.016,0.05) + 7.3) - 0.5) * 2.0;
        return (1.0 - smoothstep(0.0, 0.05, a)) + (1.0 - smoothstep(0.0, 0.04, b)) * 0.55;
    }
`;

// veins: the glow attribute is a mask, and the glowing veins are drawn per pixel
// detail: add triplanar photo detail (islands)
export function glowMaterial(opts = {}, glowColor = null, veins = false, detail = false) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, ...opts });
    const gc = glowColor ? { value: new THREE.Color(glowColor) } : shared.uGlowColor;
    m.onBeforeCompile = (sh) => {
        sh.uniforms.uGlow = shared.uGlow;
        sh.uniforms.uGlowColor = gc;
        sh.vertexShader = sh.vertexShader
            .replace("#include <common>", "#include <common>\nattribute float glow;\nvarying float vGlow;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;");
        sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", "#include <common>\nuniform float uGlow;\nuniform vec3 uGlowColor;\nvarying float vGlow;")
            .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlowColor * vGlow * (0.01 + uGlow * uGlow * 2.6);");
        if (veins || detail) {
            sh.vertexShader = sh.vertexShader
                .replace("varying float vGlow;", "varying float vGlow;\nvarying vec3 vVW;")
                .replace("vGlow = glow;", "vGlow = glow;\nvVW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
            sh.fragmentShader = sh.fragmentShader
                .replace("varying float vGlow;", "varying float vGlow;\nvarying vec3 vVW;" + VEIN_GLSL);
            if (veins) sh.fragmentShader = sh.fragmentShader.replace("uGlowColor * vGlow *", "uGlowColor * vGlow * veins(vVW) *");
        }
        if (detail) {
            const T = textures();
            Object.assign(sh.uniforms, { tCliff: { value: T.cliff }, tCliffN: { value: T.cliffN }, tRock: { value: T.rock }, tGrass: { value: T.grass }, tGrassN: { value: T.grassN }, tBark: { value: T.bark } });
            if (detail === "bark") sh.fragmentShader = "#define BARK\n" + sh.fragmentShader;
            sh.vertexShader = sh.vertexShader
                .replace("varying vec3 vVW;", "varying vec3 vVW;\nvarying vec3 vNW;")
                .replace("vVW = (modelMatrix", "vNW = normalize(mat3(modelMatrix) * objectNormal);\nvVW = (modelMatrix");
            sh.fragmentShader = sh.fragmentShader
                .replace("varying vec3 vVW;", "varying vec3 vVW;" + DETAIL_GLSL)
                .replace("#include <color_fragment>", "#include <color_fragment>" + DETAIL_COLOR)
                .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(normalize(nW + pert), 0.0)).xyz);");
        }
    };
    m.customProgramCacheKey = () => "glow" + (glowColor || "") + (veins ? "v" : "") + (detail ? "d" + detail : "");
    return m;
}

// Leaf-clump cards from the tree atlas; normals keep pointing outward on both faces
// Wind for instanced plants: the further a vertex is from the base (up a trunk, or down
// a hanging vine), the more it sways; leaf cards also flutter. Gusts roll across the
// world, so neighbouring trees move together.
export function addWind(m, strength = 1, flutter = true) {
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
        base?.call(m, sh, r);
        for (const u of ["uTime", "uDragonPos", "uDragonVel", "uBeatPos", "uBeatAge", "uBeatAmp"]) sh.uniforms[u] = shared[u];
        sh.vertexShader = sh.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uTime;" + DRAGON_WAKE_GLSL
                + (m.userData.cards ? "\nattribute vec3 aStem; attribute float aPhase;" : ""))
            .replace("#include <project_vertex>", `{
                vec3 ip = modelMatrix[3].xyz;
                mat3 om = mat3(modelMatrix);
                vec3 wpv = (modelMatrix * vec4(transformed, 1.0)).xyz;
                #ifdef USE_INSTANCING
                ip = (modelMatrix * instanceMatrix[3]).xyz;
                om = mat3(modelMatrix * instanceMatrix);
                wpv = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
                #endif
                float k = pow(min(abs(position.y) / ${(m.userData.windHeight || 50).toFixed(1)}, 1.2), 2.0) * ${strength.toFixed(2)};
                // a light breeze: slow sway in rolling gusts, with a quicker shiver on top
                float gust = 0.6 + 0.4 * sin(uTime * 0.37 + ip.x * 0.0021 + ip.z * 0.0017);
                float sway = sin(uTime * 1.25 + ip.x * 0.013 + ip.z * 0.011) * gust;
                // the dragon's air, read on the plant's own axis at this vertex's height and
                // turned into the plant's own space: the whole plant leans away from it as one.
                // (Read at each vertex, the leaves on either side of the dragon's path slid
                // apart and the crown swelled like a lens instead of being pushed.)
                float agit;
                vec3 pw = dragonWake(vec3(ip.x, wpv.y, ip.z), agit);
                vec3 pl = transpose(om) * pw / max(dot(om[0], om[0]), 1e-4);
                ${m.userData.cards ? `{
                    // each leaf card swings on its own stem, in its own rhythm, and is blown
                    // back on it, away from the dragon, when the dragon's air reaches it
                    // (read at the card's own stem, so on a vast crown only the cards the
                    // dragon actually passes are stirred)
                    #ifdef USE_INSTANCING
                    vec3 sw = (modelMatrix * instanceMatrix * vec4(aStem, 1.0)).xyz;
                    #else
                    vec3 sw = (modelMatrix * vec4(aStem, 1.0)).xyz;
                    #endif
                    float agc;
                    vec3 plc = transpose(om) * dragonWake(sw, agc) / max(dot(om[0], om[0]), 1e-4);
                    vec3 off = transformed - aStem;
                    float ph = aPhase * 6.2832;
                    float ag = agc * (0.55 + 0.9 * aPhase);
                    // the breeze's own swing and shiver, then the dragon's air: a stronger flutter
                    // at a steady rhythm of its own (only its strength follows the air; letting
                    // the air speed up the rhythm made the phase race as the dragon passed)
                    float a1 = sin(uTime * (2.1 + aPhase * 1.8) + ph) * (0.05 + 0.05 * gust + ag * 0.1)
                             + sin(uTime * (5.3 + aPhase * 2.9) + ph * 2.3) * 0.015
                             + sin(uTime * (3.4 + aPhase * 1.6) + ph * 1.7) * ag * 0.13;
                    vec3 ax = normalize(vec3(cos(ph * 3.0), 0.35 * sin(ph * 5.0), sin(ph * 3.0)));
                    off = off * cos(a1) + cross(ax, off) * sin(a1) + ax * dot(ax, off) * (1.0 - cos(a1));
                    float L = length(off), pm = length(plc);
                    if (L > 1e-3 && pm > 1e-3) off = normalize(off + plc / pm * L * min(ag, 1.3) * 0.55) * L;
                    transformed = aStem + off;
                }` : ""}
                transformed.x += sway * k * 0.8 + sin(uTime * 2.9 + ip.z * 0.03) * k * 0.12;
                transformed.z += cos(uTime * 1.05 + ip.z * 0.012) * gust * k * 0.45;
                transformed += pl * k;
                // leaves (the right half of the tree atlas) flutter on top of the sway
                #if ${m.userData.cards ? 1 : 0}
                float leaf = 0.0;   // leaf cards already move on their stems
                #elif defined(USE_UV) && ${flutter === "all" ? 2 : flutter ? 1 : 0} == 2
                float leaf = 1.0;
                #elif defined(USE_UV) && ${flutter ? 1 : 0}
                float leaf = step(0.5, uv.x);
                #else
                float leaf = 0.0;
                #endif
                float h = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
                transformed.y += leaf * (sin(uTime * 6.0 + h * 6.28) * (0.3 + gust) + sin(uTime * 4.5 + h * 6.28) * agit * 3.0) * 0.18 * min(k + 0.2, 1.0);
            }
            #include <project_vertex>`);
    };
    const key = m.customProgramCacheKey?.bind(m);
    m.customProgramCacheKey = () => (key ? key() : "") + "wind3" + strength + flutter + (m.userData.windHeight || 50) + (m.userData.cards ? "cards" : "");
    return m;
}

// map: the leaf texture (default: the old tree atlas, leaves on its right half);
// with the Blender leaves atlas every vertex is leaf and flutters, and the cards are
// anti-aliased with alpha-to-coverage where the scene is multisampled.
// recolor: take only the texture's light and shade and let the vertex colours set the
// hue (the Worldtree's pale silver-jade leaves, from the same green atlas)
// selfGlow: at night the leaves glow in their own colour (the otherworldly kit's filaments
// and beads), with only a touch of the world's glow colour
export function foliageMaterial(glowColor = null, map = null, recolor = false, wind = 1, selfGlow = false) {
    const m = glowMaterial({ roughness: 0.85, map: map || textures().tree, alphaTest: 0.5, side: THREE.DoubleSide, alphaToCoverage: !!map }, glowColor);
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
        base(sh, r);
        if (selfGlow) sh.fragmentShader = sh.fragmentShader.replace("totalEmissiveRadiance += uGlowColor * vGlow *",
            "totalEmissiveRadiance += (diffuseColor.rgb * 1.5 + uGlowColor * 0.1) * vGlow *");
        if (recolor) sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
            diffuseColor.rgb = vec3(pow(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) * ${typeof recolor === "number" ? recolor.toFixed(2) : "3.2"}, 0.85));`);
        // Leaves are thin: sunlight passes through them. Looking toward the sun through a
        // canopy, the leaves glow a deeper, warmer colour (forward scattering), and the
        // side of a clump facing away from the sun still picks up light through the leaves.
        sh.uniforms.uSunDir = shared.uSunDir;
        sh.uniforms.uSunColor = shared.uSunColor;
        sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", "#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;")
            .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
            {
                vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
                vec3 Vv = normalize(vViewPosition);                 // camera to fragment
                float day = smoothstep(-0.05, 0.2, uSunDir.y);
                float fwd = pow(clamp(dot(Vv, Lv), 0.0, 1.0), 4.0);  // sun behind the leaves
                float back = clamp(dot(-normal, Lv), 0.0, 1.0);     // leaf's shaded side
                // like a Translucent BSDF added to the leaf shader: light coming through a
                // thin leaf takes on its colour, deeper and a little warmer
                vec3 tint = diffuseColor.rgb * mix(vec3(1.0), diffuseColor.rgb * 1.7 + vec3(0.14, 0.1, 0.0), 0.6);
                totalEmissiveRadiance += tint * uSunColor * (fwd * 2.0 + back * 0.5) * day;
            }`);
        sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", THREE.ShaderChunk.normal_fragment_begin.replace(/normal \*= faceDirection;/g, ""));
        // Blender atlases have soft, antialiased alpha: the alpha test then gives a
        // crisp edge at any magnification (sharpened to one pixel by three's
        // alpha-to-coverage path). Mipmapping averages alpha down, which would thin
        // distant leaves to nothing, so alpha is boosted with the mip level.
        if (map) sh.fragmentShader = sh.fragmentShader.replace("#include <alphatest_fragment>", `
            #ifdef USE_MAP
            {
                vec2 ts = vec2(textureSize(map, 0));
                vec2 ddx = dFdx(vMapUv * ts), ddy = dFdy(vMapUv * ts);
                float lod = 0.5 * log2(max(max(dot(ddx, ddx), dot(ddy, ddy)), 1e-8));
                diffuseColor.a *= 1.0 + max(lod, 0.0) * 0.25;
                // a card seen edge-on smears its texture into streaks: fade it out as it
                // turns away (its real face, from screen-space derivatives)
                vec3 fn = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
                float facing = abs(dot(fn, normalize(vViewPosition)));
                diffuseColor.a *= smoothstep(0.06, 0.3, facing);
            }
            #endif
            #include <alphatest_fragment>`);
    };
    m.customProgramCacheKey = () => "foliage" + (glowColor || "") + (map ? "atlas3" : "") + (recolor ? "rc" + recolor : "") + (selfGlow ? "self" : "") + "sss";
    return addWind(m, wind, map ? "all" : true);
}
export const UV_BARK = [0.02, 0.0, 0.48, 1.0], UV_LEAVES = [0.5, 0.0, 1.0, 1.0];
// cells of the Blender leaves atlas (tex/leaves.png, glTF uvs): [u0, v at the card's bottom, u1, v at its top]
export const ATLAS_BROADLEAF = [0.004, 0.496, 0.496, 0.004];
export const ATLAS_HANGING = [0.004, 0.504, 0.496, 0.996];   // weeping frond, hanging from its top edge
// cells of the otherworldly atlas (tex/alien.png): sword-leaf fan, plume, and the filament
// curtain, which hangs from the top edge of its cell (card top = attach point)
export const ALIEN_FAN = [0.004, 0.496, 0.496, 0.004], ALIEN_PLUME = [0.504, 0.496, 0.996, 0.004], ALIEN_FILAMENT = [0.004, 0.996, 0.496, 0.504];

// Build one non-indexed geometry from parts, each with a flat colour and glow
export function buildParts(parts) {
    const pos = [], nrm = [], col = [], glw = [], uvs = [], stems = [], phases = [];
    const c = new THREE.Color();
    // stem: [x, y, z] where a leaf card attaches (it then swings on it in the wind shader,
    // material.userData.cards); phase: its own 0..1 rhythm
    const anyStem = parts.some((p) => p.stem);
    for (const p of parts) {
        // indexed shapes keep smooth normals; already-split ones (roughened rock) stay faceted
        let g = p.geo.clone();
        if (p.matrix) g.applyMatrix4(p.matrix);
        if (!p.keepNormals || !g.attributes.normal) g.computeVertexNormals();
        if (g.index) g = g.toNonIndexed();
        const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
        const r = p.uvRect || [0, 0, 1, 1];
        c.set(p.color);
        const cl = p.collar;   // { a, d, r }: a branch growing out of a parent (axis point, direction, radius)
        for (let i = 0; i < P.count; i++) {
            pos.push(P.getX(i), P.getY(i), P.getZ(i));
            // normalFrom: point normals away from a centre (soft, rounded foliage)
            if (p.normalFrom) {
                const [cx, cy, cz] = p.normalFrom, dx = P.getX(i) - cx, dy = P.getY(i) - cy, dz = P.getZ(i) - cz, l = Math.hypot(dx, dy, dz) || 1;
                nrm.push(dx / l, dy / l, dz / l);
            } else if (cl) {
                // near the parent, bend the normal toward the parent's own surface normal so
                // the branch flows out of it with no crease in the shading
                const qx = P.getX(i) - cl.a.x, qy = P.getY(i) - cl.a.y, qz = P.getZ(i) - cl.a.z;
                const al = qx * cl.d.x + qy * cl.d.y + qz * cl.d.z;
                const rx = qx - cl.d.x * al, ry = qy - cl.d.y * al, rz = qz - cl.d.z * al, h = Math.hypot(rx, ry, rz) || 1;
                const x = THREE.MathUtils.clamp((h - cl.r * 0.45) / (cl.r * 1.5), 0, 1);
                const w = (1 - x * x * (3 - 2 * x)) * 0.85 * (Math.abs(al) < cl.r * 3 ? 1 : 0);
                let nx = N.getX(i) * (1 - w) + (rx / h) * w, ny = N.getY(i) * (1 - w) + (ry / h) * w, nz = N.getZ(i) * (1 - w) + (rz / h) * w;
                const l = Math.hypot(nx, ny, nz) || 1;
                nrm.push(nx / l, ny / l, nz / l);
            } else nrm.push(N.getX(i), N.getY(i), N.getZ(i));
            uvs.push(U ? r[0] + U.getX(i) * (r[2] - r[0]) : 0, U ? r[1] + U.getY(i) * (r[3] - r[1]) : 0);
            const shade = p.shade ? p.shade(P.getX(i), P.getY(i), P.getZ(i)) : 1;
            col.push(c.r * shade, c.g * shade, c.b * shade);
            glw.push(typeof p.glow === "function" ? p.glow(P.getX(i), P.getY(i), P.getZ(i)) : p.glow || 0);
            if (anyStem) {
                if (p.stem) stems.push(p.stem[0], p.stem[1], p.stem[2]); else stems.push(P.getX(i), P.getY(i), P.getZ(i));
                phases.push(p.phase || 0);
            }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute("glow", new THREE.Float32BufferAttribute(glw, 1));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    if (anyStem) {
        geo.setAttribute("aStem", new THREE.Float32BufferAttribute(stems, 3));
        geo.setAttribute("aPhase", new THREE.Float32BufferAttribute(phases, 1));
    }
    geo.computeBoundingSphere();
    return geo;
}

export const M4 = (pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) => {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...(Array.isArray(scl) ? scl : [scl, scl, scl])));
    return m;
};

// Push vertices of a geometry along their normals by noise (rocky look)
export function roughen(geo, amount, freq, seed = 1) {
    const n = makeNoise(seed);
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const P = g.attributes.position;
    // displace by position so shared corners move together
    for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        const len = Math.hypot(x, y, z) || 1;
        const d = n.fbm(x * freq, y * freq, z * freq, 3) * amount;
        P.setXYZ(i, x + (x / len) * d, y + (y / len) * d, z + (z / len) * d);
    }
    g.computeVertexNormals();
    return g;
}

export const SHADER_END = `
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
`;
