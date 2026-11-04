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
};

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
        grass: get("grass_c.jpg"), grassN: get("grass_n.jpg", false), tree: get("tree_atlas.png"), bark: get("bark_c.jpg"),
    };
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
    if (grassW < 0.99) {
        cd = (triC(tCliff, vVW, bw, 1.0/9.0) * 0.55 + triC(tCliff, vVW, bw, 1.0/61.0) * 0.45) / vec3(0.19, 0.179, 0.135);
        if (nW.y < -0.15) cd = mix(cd, triC(tRock, vVW, bw, 1.0/16.0) / vec3(0.084, 0.0785, 0.066), smoothstep(-0.15, -0.6, nW.y));
        pert += triN(tCliffN, vVW, bw, 1.0/9.0) * (1.0 - grassW) * 0.9;
    }
    #endif
    if (grassW > 0.01) {
        gd = (triC(tGrass, vVW, bw, 1.0/5.0) * 0.35 + triC(tGrass, vVW, bw, 1.0/37.0) * 0.35 + triC(tGrass, vVW, bw, 1.0/190.0) * 0.3) / vec3(0.126, 0.16, 0.035);
        vec3 gn = texture2D(tGrassN, vVW.xz / 5.0).xyz * 2.0 - 1.0;
        pert += vec3(gn.x, 0.0, gn.y) * grassW * 0.6;
    }
    gd = pow(gd, vec3(1.5));
    vec3 det = mix(cd, gd, grassW);
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
export function foliageMaterial(glowColor = null) {
    const m = glowMaterial({ roughness: 0.85, map: textures().tree, alphaTest: 0.5, side: THREE.DoubleSide }, glowColor);
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
        base(sh, r);
        sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", THREE.ShaderChunk.normal_fragment_begin.replace(/normal \*= faceDirection;/g, ""));
    };
    m.customProgramCacheKey = () => "foliage" + (glowColor || "");
    return m;
}
export const UV_BARK = [0.02, 0.0, 0.48, 1.0], UV_LEAVES = [0.5, 0.0, 1.0, 1.0];

// Build one non-indexed geometry from parts, each with a flat colour and glow
export function buildParts(parts) {
    const pos = [], nrm = [], col = [], glw = [], uvs = [];
    const c = new THREE.Color();
    for (const p of parts) {
        // indexed shapes keep smooth normals; already-split ones (roughened rock) stay faceted
        let g = p.geo.clone();
        if (p.matrix) g.applyMatrix4(p.matrix);
        g.computeVertexNormals();
        if (g.index) g = g.toNonIndexed();
        const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
        const r = p.uvRect || [0, 0, 1, 1];
        c.set(p.color);
        for (let i = 0; i < P.count; i++) {
            pos.push(P.getX(i), P.getY(i), P.getZ(i));
            // normalFrom: point normals away from a centre (soft, rounded foliage)
            if (p.normalFrom) {
                const [cx, cy, cz] = p.normalFrom, dx = P.getX(i) - cx, dy = P.getY(i) - cy, dz = P.getZ(i) - cz, l = Math.hypot(dx, dy, dz) || 1;
                nrm.push(dx / l, dy / l, dz / l);
            } else nrm.push(N.getX(i), N.getY(i), N.getZ(i));
            uvs.push(U ? r[0] + U.getX(i) * (r[2] - r[0]) : 0, U ? r[1] + U.getY(i) * (r[3] - r[1]) : 0);
            const shade = p.shade ? p.shade(P.getX(i), P.getY(i), P.getZ(i)) : 1;
            col.push(c.r * shade, c.g * shade, c.b * shade);
            glw.push(typeof p.glow === "function" ? p.glow(P.getX(i), P.getY(i), P.getZ(i)) : p.glow || 0);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute("glow", new THREE.Float32BufferAttribute(glw, 1));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
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
