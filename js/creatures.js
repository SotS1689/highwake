// Wildlife: sky whales (pods and the Matriarch), skyling flocks, lantern-jelly
// drifters, great sky rays, and the drifting seed-wisps of the Worldtree.

import * as THREE from "three";
import { worldSDF } from "./world.js";
import { shared, glowMaterial, SHADER_END, textures } from "./gfx.js";
import { mulberry32, makeNoise } from "./noise.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Sculpted creature meshes built in Blender (tools/blender/build_creatures.py). Each
// carries the attributes the shaders below animate and shade with; without the file
// the code-built shapes are used instead.
export async function loadCreatureModels(url = "models/creatures.glb") {
    const gltf = await new GLTFLoader().loadAsync(url);
    const out = {};
    const rename = { _GLOW: "glow", _FLEX: "aFlex", _MP: "mp", _FP: "fp" };
    gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry;
        for (const [from, to] of Object.entries(rename)) if (g.attributes[from]) { g.setAttribute(to, g.attributes[from]); g.deleteAttribute(from); }
        g.computeBoundingSphere();
        out[o.name] = g;
    });
    return out;
}

// ---------------------------------------------------------------------------------
// Whale

function whaleGeometry() {
    const prof = [[0, 0.008], [0.06, 0.022], [0.15, 0.045], [0.3, 0.08], [0.45, 0.1], [0.6, 0.108], [0.75, 0.1], [0.87, 0.083], [0.94, 0.062], [0.98, 0.035], [1, 0.001]];
    const dense = [];
    for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        let k = 0;
        while (k < prof.length - 2 && prof[k + 1][0] < t) k++;
        const [t0, r0] = prof[k], [t1, r1] = prof[k + 1];
        const u = (t - t0) / (t1 - t0);
        dense.push(new THREE.Vector2(r0 + (r1 - r0) * (u * u * (3 - 2 * u)), t - 0.5));
    }
    const body = new THREE.LatheGeometry(dense, 44).rotateX(Math.PI / 2);
    body.scale(1, 0.82, 1);
    const parts = [{ geo: body, fin: 0 }];
    const fin = (pts, z, x, y, scale, back = false) => {
        const s = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false }).rotateX(Math.PI / 2);
        const out = [];
        for (const side of [1, -1]) {
            const gg = g.clone().scale(side * scale, 1, scale).translate(side * x, y, z);
            out.push({ geo: gg, fin: back ? 0.6 : 1 });
        }
        return out;
    };
    parts.push(...fin([[0, 0], [0.12, 0.03], [0.3, -0.06], [0.33, -0.11], [0.2, -0.09], [0.04, -0.07]], 0.16, 0.085, -0.02, 1));
    parts.push(...fin([[0, 0], [0.1, 0.02], [0.2, -0.04], [0.21, -0.08], [0.1, -0.06], [0.02, -0.05]], -0.12, 0.07, -0.01, 0.9, true));
    // flukes (horizontal, at the tail)
    const fl = new THREE.Shape([[0, 0.02], [0.08, 0.0], [0.17, -0.05], [0.2, -0.1], [0.12, -0.075], [0.04, -0.06], [0, -0.03]].map(([a, b]) => new THREE.Vector2(a, b)));
    const flg = new THREE.ExtrudeGeometry(fl, { depth: 0.005, bevelEnabled: false }).rotateX(Math.PI / 2);
    for (const side of [1, -1]) parts.push({ geo: flg.clone().scale(side, 1, 1).translate(0, 0, -0.47), fin: 0, fluke: true });

    const pos = [], nrm = [], col = [], glw = [], flex = [];
    const n = makeNoise(6);
    for (const p of parts) {
        const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
        g.computeVertexNormals();
        const P = g.attributes.position, N = g.attributes.normal;
        for (let i = 0; i < P.count; i++) {
            const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
            pos.push(x, y, z);
            nrm.push(N.getX(i), N.getY(i), N.getZ(i));
            const up = Math.min(1, Math.max(0, N.getY(i) * 1.6 + 0.5));
            const m = n.noise3(x * 12, y * 12, z * 12) * 0.07 + n.noise3(x * 40, y * 40, z * 40) * 0.03;
            const back = [0.14 + m, 0.22 + m, 0.36 + m], belly = [0.86, 0.88, 0.88];
            let c = belly.map((b, k) => b + (back[k] - b) * up);
            if (!p.fin && !p.fluke) {
                // pale spots scattered over the back, like a whale shark
                const ang = Math.atan2(y, x);
                const su = z * 70, sv = ang * 7;
                const fu = su - Math.round(su), fv = sv - Math.round(sv);
                const jit = n.noise3(Math.round(su) * 1.7, Math.round(sv) * 1.3, 4);
                if (up > 0.6 && jit > -0.1 && fu * fu + fv * fv < 0.07) c = c.map((v) => v + 0.35);
                // throat grooves underneath the front half
                if (up < 0.25 && z > 0.05 && Math.sin(ang * 60) > 0.55) c = c.map((v) => v * 0.78);
            }
            col.push(...c);
            const th = Math.atan2(y, Math.abs(x));
            let gl = 0;
            if (!p.fin && !p.fluke && Math.abs(th - 0.35) < 0.12 && ((z * 34) % 1 + 1) % 1 < 0.38 && z > -0.35 && z < 0.4) gl = 1;
            if (p.fin && Math.hypot(x, z) > 0.2) gl = 0.7;
            glw.push(gl);
            const tail = Math.pow(Math.min(1, Math.max(0, (0.15 - z) / 0.65)), 1.6);
            flex.push(tail, p.fin ? Math.max(0, Math.abs(x) - 0.07) * p.fin : 0);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute("glow", new THREE.Float32BufferAttribute(glw, 1));
    geo.setAttribute("aFlex", new THREE.Float32BufferAttribute(flex, 2));
    geo.computeBoundingSphere();
    return geo;
}

function whaleMaterial(phase, glowColor) {
    const m = glowMaterial({ roughness: 0.6, side: THREE.DoubleSide }, glowColor);
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (sh) => {
        base(sh);
        sh.uniforms.uPhase = phase;
        sh.vertexShader = sh.vertexShader
            .replace("attribute float glow;", "attribute float glow; attribute vec2 aFlex; uniform float uPhase;")
            .replace("varying float vGlow;", "varying float vGlow; varying vec3 vLP; varying float vFin;")
            .replace("vGlow = glow;", `vGlow = glow * (0.75 + 0.25*sin(uPhase*1.3 + position.z*40.)); vLP = position; vFin = aFlex.y;
                float w = aFlex.x;
                transformed.y += (sin(transformed.z*7.0 - uPhase) * 0.03 + sin(uPhase) * 0.035) * w;
                transformed.y += aFlex.y * sin(uPhase*0.5 + 1.2) * 0.45;`);
    };
    const base2 = m.onBeforeCompile;
    m.onBeforeCompile = (sh) => {
        base2(sh);
        sh.uniforms.tSkin = { value: textures().rock };
        sh.fragmentShader = sh.fragmentShader
            .replace("varying float vGlow;", `varying float vGlow; varying vec3 vLP; varying float vFin; uniform sampler2D tSkin;
                vec3 bumpW(vec3 p, vec3 n, vec2 dh, float fd){
                    vec3 sx = normalize(dFdx(p)), sy = normalize(dFdy(p));
                    vec3 r1 = cross(sy, n), r2 = cross(n, sx);
                    float det = dot(sx, r1) * fd;
                    return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
                }`)
            .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
                normal = bumpW(-vViewPosition, normal, vec2(dFdx(skinH), dFdy(skinH)) * 0.9, faceDirection);`)
            .replace("#include <color_fragment>", `#include <color_fragment>
                float ang = atan(vLP.y, abs(vLP.x));
                vec2 g = vec2(vLP.z * 85.0, ang * 9.0);
                vec2 cell = floor(g), f = fract(g) - 0.5;
                float hs = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
                vec2 off = vec2(fract(hs * 7.13), fract(hs * 3.37)) - 0.5;
                float spot = smoothstep(0.24, 0.14, length(f - off * 0.45)) * step(0.3, hs) * smoothstep(0.15, 0.6, ang) * step(vFin, 0.001);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.88, 0.95), spot * 0.85);
                // weathered hide from a rock photo, and throat pleats along the belly
                float mott = dot(texture2D(tSkin, vec2(vLP.z * 9.0, ang * 1.3)).rgb, vec3(0.3333)) / 0.076;
                float pleat = smoothstep(-0.25, -0.5, ang) * (0.5 + 0.5 * sin(ang * 90.0)) * step(vFin, 0.001);
                diffuseColor.rgb *= mix(1.0, mott, 0.4) * (1.0 - pleat * 0.3);
                float skinH = mott * 0.08 + pleat * 0.6;`);
    };
    m.customProgramCacheKey = () => "whale" + glowColor;
    return m;
}

// ---------------------------------------------------------------------------------
// Sky ray

// A manta: a lens-thick body with swept wings, cephalic fins either side of the
// mouth and a whip tail. Unit span, +z forward; the top and bottom skins meet at
// the rim. mp holds the planform position and which skin it is (1 top, -1 belly, 0 tail).
function mantaGeometry() {
    const NU = 56, NV = 24;
    const g2 = (x, w) => Math.exp(-(x * x) / (w * w));
    const front = (a) => 0.36 * Math.pow(1 - a, 1.25) - 0.06 * a + 0.1 * g2(a - 0.075, 0.03) - 0.035 * g2(a, 0.035);
    const back = (a) => -0.4 + 0.3 * Math.pow(a, 0.6);
    const pos = [], mp = [], idx = [];
    for (const side of [1, -1]) {
        const o = pos.length / 3;
        for (let i = 0; i <= NU; i++) {
            const s = (i / NU) * 2 - 1, u = Math.sign(s) * Math.pow(Math.abs(s), 1.35), a = Math.abs(u);
            for (let j = 0; j <= NV; j++) {
                const v = j / NV, z = front(a) + (back(a) - front(a)) * v;
                // thick over the body and head, thin out along the wings
                const body = 0.06 * Math.pow(Math.max(0, 1 - a * 1.6), 2) * Math.pow(Math.sin(Math.PI * v), 0.6);
                const wing = 0.012 * (1 - a) * Math.pow(Math.sin(Math.PI * v), 0.8);
                const camber = 0.015 * (1 - a * a) * Math.sin(Math.PI * v) - 0.02 * a * a;
                const y = camber + (side > 0 ? body + wing : -(body * 0.55 + wing * 0.7));
                pos.push(u * 0.5, y, z);
                mp.push(u * 0.5, z, side);
            }
        }
        for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
            const p = o + i * (NV + 1) + j, q = p + 1, r = p + NV + 1, t = r + 1;
            if (side > 0) idx.push(p, r, q, q, r, t); else idx.push(p, q, r, q, t, r);
        }
    }
    // whip tail
    const tail = new THREE.ConeGeometry(0.011, 0.62, 8, 6).rotateX(-Math.PI / 2).translate(0, 0.004, -0.69);
    const o = pos.length / 3, TP = tail.attributes.position;
    for (let i = 0; i < TP.count; i++) { pos.push(TP.getX(i), TP.getY(i), TP.getZ(i)); mp.push(TP.getX(i), TP.getZ(i), 0); }
    for (const k of tail.index.array) idx.push(o + k);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("mp", new THREE.Float32BufferAttribute(mp, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
}

function mantaMaterial() {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
    m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, { uTime: shared.uTime, uGlow: shared.uGlow, tSkin: { value: textures().rock } });
        sh.vertexShader = sh.vertexShader
            .replace("#include <common>", "#include <common>\nattribute vec3 mp;\nuniform float uTime;\nvarying vec3 vMP;")
            // wings beat in a wave running from the head back to the tips; the normals follow
            .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
                vMP = mp;
                float ph = float(gl_InstanceID) * 2.1;
                float ax = min(abs(position.x) * 2.0, 1.0), sx = sign(position.x);
                float w = uTime * 1.3 + ph - ax * 1.6 + position.z * 2.0;
                float A = 0.2 * pow(ax, 1.6);
                float fl = A * sin(w);
                float fx = (0.2 * 1.6 * pow(max(ax, 1e-3), 0.6) * 2.0 * sx) * sin(w) + A * cos(w) * (-1.6 * 2.0 * sx);
                float fz = A * cos(w) * 2.0;
                if (mp.z != 0.0) objectNormal = normalize(objectNormal + vec3(-fx, 0.0, -fz) * sign(objectNormal.y));`)
            .replace("#include <begin_vertex>", `#include <begin_vertex>
                transformed.y += fl;
                float tl = max(0.0, -position.z - 0.38);
                transformed.x += sin(uTime * 1.3 + ph + 2.0 - tl * 4.0) * 0.06 * tl;
                transformed.y += sin(uTime * 1.3 + ph + 2.5) * 0.04 * tl;`);
        sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", `#include <common>
                uniform float uGlow, uTime; uniform sampler2D tSkin; varying vec3 vMP;
                float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
                vec3 bumpR(vec3 p, vec3 n, vec2 dh, float fd){
                    vec3 sx = normalize(dFdx(p)), sy = normalize(dFdy(p));
                    vec3 r1 = cross(sy, n), r2 = cross(n, sx);
                    float det = dot(sx, r1) * fd;
                    return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
                }`)
            .replace("#include <color_fragment>", `#include <color_fragment>
                float x = vMP.x, z = vMP.y, ax = abs(x) * 2.0, sideS = vMP.z;
                // fine wrinkled skin from a rock photo
                float grain = dot(texture2D(tSkin, vec2(x, z) * 7.0).rgb, vec3(0.3333)) / 0.076;
                float grain2 = dot(texture2D(tSkin, vec2(x, z) * 23.0 + 0.37).rgb, vec3(0.3333)) / 0.076;
                float mott = smoothstep(0.6, 1.4, grain);
                float skinH = grain * 0.05 + grain2 * 0.03;
                vec3 c;
                float glowS = 0.0;
                if (sideS > 0.5) {
                    // charcoal back, pale chevrons on the shoulders, darker head lobes
                    c = vec3(0.016, 0.02, 0.032) * (0.8 + 0.4 * mott);
                    float zc = 0.2 - 0.36 * ax;
                    float chev = smoothstep(0.075, 0.035, abs(z - zc)) * smoothstep(0.1, 0.17, ax) * smoothstep(0.62, 0.42, ax);
                    chev *= smoothstep(0.75, 1.05, grain * 0.6 + 0.5 + 0.3 * sin(z * 40.0 + x * 13.0));
                    c = mix(c, vec3(0.38, 0.4, 0.42) * (0.85 + 0.3 * mott), chev);
                    c = mix(c, vec3(0.06, 0.07, 0.09), smoothstep(0.035, 0.06, ax) * smoothstep(0.11, 0.08, ax) * smoothstep(0.3, 0.38, z));
                    // eyes on the sides of the head
                    c = mix(c, vec3(0.0), smoothstep(0.012, 0.006, length(vec2(ax - 0.12, z - 0.27))));
                    // rows of glowing spots along the wings
                    float r = length(vec2(x, z + 0.12));
                    float row = abs(fract(r * 10.0) - 0.5);
                    float dotA = abs(fract(atan(z + 0.12, x) * 14.0) - 0.5);
                    glowS = smoothstep(0.12, 0.04, length(vec2(row, dotA * 0.6))) * smoothstep(0.15, 0.3, ax) * smoothstep(0.98, 0.8, ax);
                } else if (sideS < -0.5) {
                    // pale belly with dark margins, unique spots, gill slits and the mouth
                    c = vec3(0.72, 0.72, 0.69) * (0.9 + 0.15 * mott);
                    c = mix(c, vec3(0.12, 0.13, 0.15), smoothstep(0.65, 0.95, ax) * 0.8);
                    vec2 sp = vec2(x * 1.3 + z * 0.4, z) * 30.0, cell = floor(sp);
                    float hs = h21(cell), rad = 0.12 + 0.2 * h21(cell + 5.3);
                    float spot = smoothstep(rad, rad * 0.6, length(fract(sp) - 0.5 - (vec2(h21(cell + 3.1), h21(cell + 7.7)) - 0.5) * (0.9 - rad * 2.0)))
                        * step(0.8, hs) * smoothstep(0.3, 0.12, ax) * step(z, 0.18);
                    c = mix(c, vec3(0.05), spot);
                    float gill = step(abs(fract((z - 0.04) / 0.034) - 0.5), 0.13) * smoothstep(0.1, 0.12, ax) * smoothstep(0.24, 0.2, ax) * step(0.04, z) * step(z, 0.21);
                    c = mix(c, vec3(0.2, 0.18, 0.2), gill * 0.8);
                    skinH += gill * 0.5;
                    c = mix(c, vec3(0.03, 0.02, 0.03), smoothstep(0.06, 0.04, ax) * smoothstep(0.29, 0.32, z));
                } else {
                    c = vec3(0.02, 0.022, 0.03);
                }
                diffuseColor.rgb = c;`)
            .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
                normal = bumpR(-vViewPosition, normal, vec2(dFdx(skinH), dFdy(skinH)) * 0.6, faceDirection);`)
            .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
                totalEmissiveRadiance += vec3(0.62, 0.45, 1.0) * glowS * (0.6 + 0.4 * sin(uTime * 1.7 - length(vMP.xy) * 12.0)) * (0.01 + uGlow * uGlow * 2.6);`);
    };
    m.customProgramCacheKey = () => "manta";
    return m;
}

// ---------------------------------------------------------------------------------
// Skyling

// A small bird, wingspan about 5 m, +z forward: a rounded body with head and beak,
// long wings whose outer primaries split into fingers, and a forked tail.
// fp: x = part (0 body, 1 wing, 2 tail), y and z = position across that part (0..1)
function skylingGeometry() {
    const pos = [], fp = [], idx = [];
    const grid = (nu, nv, at, part, flip) => {
        const o = pos.length / 3;
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
            const u = i / (nu - 1), w = j / (nv - 1);
            pos.push(...at(u, w)); fp.push(part, u, w);
        }
        for (let i = 0; i < nu - 1; i++) for (let j = 0; j < nv - 1; j++) {
            const a = o + i * nv + j, b = a + 1, c = a + nv, d = c + 1;
            if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
        }
    };
    // body: rings along z, from beak tip back to the tail root
    const prof = [[1.75, 0.0], [1.5, 0.05], [1.38, 0.14], [1.2, 0.19], [1.0, 0.16], [0.75, 0.26], [0.35, 0.31], [-0.1, 0.27], [-0.45, 0.18], [-0.7, 0.09]];
    grid(28, 17, (u, w) => {
        const f = u * (prof.length - 1), k = Math.min(prof.length - 2, Math.floor(f)), t = f - k, e = t * t * (3 - 2 * t);
        const z = prof[k][0] + (prof[k + 1][0] - prof[k][0]) * t, r = prof[k][1] + (prof[k + 1][1] - prof[k][1]) * e, a = w * Math.PI * 2;
        return [Math.sin(a) * r, Math.cos(a) * r * 0.85 + 0.06 * Math.min(1, Math.max(0, (z - 0.8) / 0.4)), z];
    }, 0, false);
    // wings: leading edge swept slightly back, outer primaries split into fingers
    for (const s of [1, -1]) {
        grid(26, 6, (u, w) => {
            const x = 0.18 + u * 2.45;
            // tapering to a rounded point, with the primaries splitting into fingers
            const taper = (1 - 0.45 * Math.pow(u, 1.5)) * Math.sqrt(Math.max(0, 1 - Math.pow(u, 4)));
            const le = 0.5 - 0.28 * Math.pow(u, 1.4);
            const fingers = u > 0.5 ? 0.38 * (0.5 + 0.5 * Math.cos((u - 0.5) * Math.PI * 14)) * Math.min(1, (u - 0.5) / 0.2) : 0;
            const te = -0.42 + 0.05 * u - fingers;
            const y = 0.06 * Math.sin(Math.PI * w) * (1 - u) + 0.03 * u - 0.012 * w;
            return [s * x, y, le + (te - le) * w * taper];
        }, 1, s < 0);
    }
    // forked tail
    grid(9, 4, (u, w) => {
        const a = (u - 0.5) * 1.1, len = 0.9 + 0.35 * Math.abs(u - 0.5) * 2;
        return [Math.sin(a) * w * len * 0.8 + (u - 0.5) * 0.12, 0.02, -0.55 - Math.cos(a) * w * len];
    }, 2, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("fp", new THREE.Float32BufferAttribute(fp, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
}

function skylingMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, { uTime: shared.uTime, uGlow: shared.uGlow });
        sh.vertexShader = sh.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute vec3 fp;\nvarying vec3 vFP;\nvarying vec3 vLP;\nvarying float vNy;")
            .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvNy = objectNormal.y;")
            // flap, with the outer wing lagging the inner; now and then each bird glides
            .replace("#include <begin_vertex>", `#include <begin_vertex>
                vFP = fp; vLP = position;
                float ph = float(gl_InstanceID) * 1.7;
                float amp = 0.35 + 0.65 * smoothstep(-0.3, 0.4, sin(uTime * 0.45 + ph * 3.1));
                float w = uTime * 10.0 + ph;
                float ax = abs(position.x);
                if (fp.x > 0.5 && fp.x < 1.5) {
                    transformed.y += amp * (ax * 0.5 * sin(w) + max(ax - 1.1, 0.0) * 0.45 * sin(w - 0.7));
                    transformed.z -= amp * max(0.0, -sin(w)) * 0.25 * fp.y;
                    transformed.y += (1.0 - amp) * ax * 0.06;
                }
                if (fp.x > 1.5) transformed.y += sin(w * 0.5) * 0.05 * fp.z;
                transformed.y -= amp * sin(w) * 0.06;`);
        sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", `#include <common>
                uniform float uGlow, uTime; varying vec3 vFP; varying vec3 vLP; varying float vNy;
                vec3 bumpS(vec3 p, vec3 n, vec2 dh, float fd){
                    vec3 sx = normalize(dFdx(p)), sy = normalize(dFdy(p));
                    vec3 r1 = cross(sy, n), r2 = cross(n, sx);
                    float det = dot(sx, r1) * fd;
                    return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
                }`)
            .replace("#include <color_fragment>", `#include <color_fragment>
                // diffuseColor carries this bird's colour
                vec3 base = diffuseColor.rgb, dark = base * vec3(0.18, 0.16, 0.2), pale = mix(base, vec3(1.0, 0.96, 0.9), 0.65);
                float under = step(vNy * (gl_FrontFacing ? 1.0 : -1.0), 0.0);
                float fH = 0.5;
                float glowS = 0.0;
                vec3 c = base;
                if (vFP.x < 0.5) {
                    // body: dark cap and eye stripe, pale belly, a dark beak
                    float up = vLP.y / 0.3;
                    c = mix(pale, base, smoothstep(-0.3, 0.3, up));
                    c = mix(c, dark, smoothstep(1.05, 1.25, vLP.z) * smoothstep(-0.1, 0.4, up));
                    c = mix(c, vec3(0.06, 0.05, 0.04), smoothstep(1.48, 1.52, vLP.z));
                    // a round eye with a bright ring, on the side of the head
                    float eye = length(vec3(abs(vLP.x) - 0.15, vLP.y - 0.1, vLP.z - 1.3));
                    c = mix(c, pale, smoothstep(0.06, 0.045, eye));
                    c = mix(c, vec3(0.01), smoothstep(0.042, 0.03, eye));
                    fH = 0.5 + 0.5 * sin(vLP.z * 60.0 + abs(vLP.x) * 20.0) * 0.4;
                } else if (vFP.x < 1.5) {
                    // wing: rows of coverts near the leading edge, long flight feathers behind,
                    // dark tips on the primaries and a pale trailing edge on the secondaries
                    float s = vFP.y, v = vFP.z;
                    float rachis = 1.0 - smoothstep(0.0, 0.07, abs(fract(s * 16.0) - 0.5));
                    float rows = abs(fract(v * 6.0 + s * 8.0) - 0.5);
                    float cov = (1.0 - smoothstep(0.32, 0.36, v)) * (1.0 - smoothstep(0.0, 0.12, rows));
                    c = mix(base, base * 0.8, smoothstep(0.35, 0.4, v));
                    c = mix(c, dark, smoothstep(0.62, 0.8, s) * smoothstep(0.45, 0.75, v));
                    c = mix(c, pale, smoothstep(0.8, 0.95, v) * (1.0 - smoothstep(0.45, 0.6, s)));
                    c *= 1.0 - rachis * smoothstep(0.35, 0.45, v) * 0.35 - cov * 0.3;
                    c = mix(c, pale, under * 0.6);
                    fH = rachis * smoothstep(0.35, 0.45, v) * 0.6 + cov * 0.5;
                    glowS = smoothstep(0.9, 1.0, v) * smoothstep(0.55, 0.7, s);
                } else {
                    // tail: barred feathers with bright tips
                    float bar = smoothstep(0.35, 0.5, abs(fract(vFP.z * 5.0) - 0.5) * 2.0);
                    c = mix(base, dark, bar * 0.5);
                    c = mix(c, pale, smoothstep(0.85, 1.0, vFP.z));
                    fH = bar + (1.0 - smoothstep(0.0, 0.1, abs(fract(vFP.y * 8.0) - 0.5))) * 0.5;
                    glowS = smoothstep(0.85, 1.0, vFP.z);
                }
                diffuseColor.rgb = c;`)
            .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
                normal = bumpS(-vViewPosition, normal, vec2(dFdx(fH), dFdy(fH)) * 0.25, faceDirection);`)
            .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
                totalEmissiveRadiance += diffuseColor.rgb * 0.06 + vec3(1.0, 0.75, 0.4) * glowS * (0.02 + uGlow * uGlow * 1.6);`);
    };
    m.customProgramCacheKey = () => "skyling";
    return m;
}

// Push a closed path's control points out of rock
function relaxPath(points, entities, clearance) {
    for (let iter = 0; iter < 10; iter++) {
        const curve = new THREE.CatmullRomCurve3(points, true, "centripetal");
        let moved = false;
        for (let s = 0; s < 300; s++) {
            const p = curve.getPointAt(s / 300);
            const d = worldSDF(entities, p.x, p.y, p.z, clearance + 50);
            if (d >= clearance) continue;
            const e = 20;
            const g = new THREE.Vector3(
                worldSDF(entities, p.x + e, p.y, p.z, 400) - worldSDF(entities, p.x - e, p.y, p.z, 400),
                worldSDF(entities, p.x, p.y + e, p.z, 400) - worldSDF(entities, p.x, p.y - e, p.z, 400),
                worldSDF(entities, p.x, p.y, p.z + e, 400) - worldSDF(entities, p.x, p.y, p.z - e, 400),
            );
            if (!isFinite(g.x + g.y + g.z) || g.lengthSq() === 0) g.set(0, 1, 0);
            g.normalize();
            let best = 0, bd = Infinity;
            points.forEach((cp, i) => { const dd = cp.distanceTo(p); if (dd < bd) { bd = dd; best = i; } });
            points[best].addScaledVector(g, clearance - Math.min(d, clearance) + 120);
            moved = true;
        }
        if (!moved) break;
    }
    return new THREE.CatmullRomCurve3(points, true, "centripetal");
}

class Whale {
    constructor(scene, geo, { length, glow, curve, speed, offset, u0, name }) {
        this.phase = { value: Math.random() * 10 };
        this.mesh = new THREE.Mesh(geo, whaleMaterial(this.phase, glow));
        this.mesh.scale.setScalar(length);
        this.length = length;
        scene.add(this.mesh);
        this.curve = curve;
        this.curveLen = curve.getLength();
        this.speed = speed;
        this.u = u0;
        this.offset = offset || new THREE.Vector3();
        this.name = name;
        this.pos = new THREE.Vector3();
        this.fwd = new THREE.Vector3(0, 0, 1);
        this.bank = 0;
        this.wob = Math.random() * 10;
    }

    update(dt, t) {
        this.u = (this.u + (this.speed * dt) / this.curveLen) % 1;
        const p = this.curve.getPointAt(this.u);
        const ahead = this.curve.getPointAt((this.u + 0.004) % 1);
        const ahead2 = this.curve.getPointAt((this.u + 0.012) % 1);
        const f = ahead.clone().sub(p).normalize();
        const f2 = ahead2.clone().sub(ahead).normalize();
        const turn = f.x * f2.z - f.z * f2.x;
        this.bank += (THREE.MathUtils.clamp(turn * 18, -0.45, 0.45) - this.bank) * Math.min(1, dt * 0.5);
        const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
        const up = new THREE.Vector3().crossVectors(right, f);
        const off = right.clone().multiplyScalar(this.offset.x + Math.sin(t * 0.05 + this.wob) * this.offset.x * 0.2)
            .addScaledVector(up, this.offset.y + Math.sin(t * 0.07 + this.wob) * 20)
            .addScaledVector(f, this.offset.z);
        this.pos.copy(p).add(off);
        this.fwd.copy(f);
        this.mesh.position.copy(this.pos);
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), f.clone().negate(), up);
        this.mesh.quaternion.setFromRotationMatrix(m);
        this.mesh.rotateZ(-this.bank);
        this.phase.value += dt * (1.1 * 180 / this.length + 0.3);
    }
}

// ---------------------------------------------------------------------------------

export class Creatures {
    constructor(scene, entities, landmarks, models = {}) {
        this.scene = scene;
        this.models = models;
        this.whales = [];
        const geo = models.whale || whaleGeometry();
        const P = (a) => a.map((v) => new THREE.Vector3(...v));

        const podA = relaxPath(P([[2200, 3000, 3600], [600, 3150, 6400], [-2200, 3300, 7300], [-4600, 3300, 5600], [-4600, 3000, 2200], [-2400, 3100, -500], [-600, 3300, -2900], [2400, 3000, -1400], [3400, 3200, 1800]]), entities, 140);
        const podB = relaxPath(P([[6000, 1400, -3400], [8900, 1500, -600], [7700, 1300, 2700], [4400, 1500, 3900], [2300, 1300, 700], [2900, 1250, -2000]]), entities, 140);
        const mat = relaxPath(P([[0, 3700, 3800], [-4800, 3900, 2400], [-5200, 3800, -2800], [-800, 4050, -4300], [3600, 3800, -3400], [5600, 4000, 0], [3400, 3700, 3600]]), entities, 200);
        this.paths = [podA, podB, mat];

        const add = (o) => { const w = new Whale(scene, geo, o); this.whales.push(w); return w; };
        add({ length: 190, glow: "#4fe3ff", curve: podA, speed: 34, u0: 0.02, offset: new THREE.Vector3(0, 0, 0) });
        add({ length: 170, glow: "#4fe3ff", curve: podA, speed: 34, u0: 0.02, offset: new THREE.Vector3(110, 40, -120) });
        add({ length: 175, glow: "#4fe3ff", curve: podA, speed: 34, u0: 0.02, offset: new THREE.Vector3(-120, -30, -200) });
        add({ length: 70, glow: "#9ff6ff", curve: podA, speed: 34, u0: 0.02, offset: new THREE.Vector3(50, -60, -40) });
        add({ length: 200, glow: "#7dffcf", curve: podB, speed: 30, u0: 0.4, offset: new THREE.Vector3(0, 0, 0) });
        add({ length: 160, glow: "#7dffcf", curve: podB, speed: 30, u0: 0.4, offset: new THREE.Vector3(-130, 50, -150) });
        add({ length: 80, glow: "#aaffe6", curve: podB, speed: 30, u0: 0.4, offset: new THREE.Vector3(70, -40, -60) });
        this.matriarch = add({ length: 340, glow: "#ffd58a", curve: mat, speed: 40, u0: 0.75, offset: new THREE.Vector3(), name: "matriarch" });

        this._skylings();
        this._drifters();
        this._rays();
        this._wisps(landmarks);
    }

    // ---- skylings: small flocking fliers ---------------------------------------------------
    _skylings() {
        const g = this.models.skyling || skylingGeometry(), mat = skylingMaterial();
        this.flocks = [];
        const rand = mulberry32(17);
        const anchors = [[-300, 2450, 1500, 700], [-2600, 2900, -4600, 900], [5400, 3000, 2400, 600], [-4200, 2550, 1800, 650]];
        for (const [ax, ay, az, ar] of anchors) {
            const N = 70;
            const im = new THREE.InstancedMesh(g, mat, N);
            const palette = [0xffb35c, 0xff7d6b, 0xffe08a, 0x7fe3ef];
            for (let i = 0; i < N; i++) im.setColorAt(i, new THREE.Color(palette[Math.floor(rand() * palette.length)]));
            im.frustumCulled = false;
            this.scene.add(im);
            const birds = [];
            for (let i = 0; i < N; i++) {
                birds.push({ p: new THREE.Vector3(ax + (rand() - 0.5) * 100, ay + (rand() - 0.5) * 60, az + (rand() - 0.5) * 100), v: new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).multiplyScalar(30) });
            }
            this.flocks.push({ im, birds, center: [ax, ay, az], radius: ar, a: rand() * 6.28, sp: 0.04 + rand() * 0.03 });
        }
    }

    _updateFlocks(dt, playerPos) {
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
        const avgP = new THREE.Vector3(), avgV = new THREE.Vector3(), steer = new THREE.Vector3(), tmp = new THREE.Vector3();
        for (const f of this.flocks) {
            f.a += f.sp * dt;
            const anchor = new THREE.Vector3(f.center[0] + Math.cos(f.a) * f.radius, f.center[1] + Math.sin(f.a * 2.3) * 120, f.center[2] + Math.sin(f.a) * f.radius);
            const near = playerPos.distanceTo(anchor) < 3000;
            f.im.visible = near;
            if (!near) continue;
            avgP.set(0, 0, 0); avgV.set(0, 0, 0);
            for (const b of f.birds) { avgP.add(b.p); avgV.add(b.v); }
            avgP.divideScalar(f.birds.length); avgV.divideScalar(f.birds.length);
            f.birds.forEach((b, i) => {
                steer.set(0, 0, 0);
                steer.addScaledVector(tmp.copy(avgP).sub(b.p), 0.15);
                steer.addScaledVector(tmp.copy(avgV).sub(b.v), 0.6);
                steer.addScaledVector(tmp.copy(anchor).sub(b.p), 0.05);
                for (let k = 0; k < f.birds.length; k += 3) {
                    if (k === i) continue;
                    tmp.copy(b.p).sub(f.birds[k].p);
                    const d2 = tmp.lengthSq();
                    if (d2 < 100 && d2 > 0) steer.addScaledVector(tmp, 6 / d2);
                }
                tmp.copy(b.p).sub(playerPos);
                const dp = tmp.length();
                if (dp < 90) steer.addScaledVector(tmp, (90 - dp) * 0.25 / dp * 10);
                b.v.addScaledVector(steer, dt);
                const sp = b.v.length();
                b.v.multiplyScalar(THREE.MathUtils.clamp(sp, 16, 44) / (sp || 1));
                b.p.addScaledVector(b.v, dt);
                m4.lookAt(tmp.set(0, 0, 0), tmp.copy(b.v).negate(), THREE.Object3D.DEFAULT_UP);
                q.setFromRotationMatrix(m4);
                m4.compose(b.p, q, one);
                f.im.setMatrixAt(i, m4);
            });
            f.im.instanceMatrix.needsUpdate = true;
        }
    }

    // ---- lantern-jelly drifters --------------------------------------------------------------
    _drifters() {
        const C = new THREE.Vector3(-3800, 1500, 5000);
        const rand = mulberry32(64);
        const N = 46, T = 7;
        const bellGeo = this.models.jelly || new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
        // the Blender bell overlaps its oral arms, so it adds a little less light
        const layered = this.models.jelly ? "0.75" : "1.0";
        const shader = (isTendril) => new THREE.ShaderMaterial({
            uniforms: { uTime: shared.uTime, uSun: shared.uGlow },
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
            vertexShader: `uniform float uTime; varying vec3 vN, vV, vC; varying float vY;
                void main(){
                    vec3 p = position;
                    ${isTendril ? "p.x += sin(p.y*3.0 + uTime*1.4 + float(gl_InstanceID)) * 0.12 * -p.y; p.z += cos(p.y*2.3 + uTime*1.1 + float(gl_InstanceID)*1.3) * 0.1 * -p.y;" : ""}
                    vY = position.y;
                    vec4 w = modelMatrix * instanceMatrix * vec4(p,1.);
                    vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
                    vV = normalize(cameraPosition - w.xyz);
                    vC = instanceColor;
                    gl_Position = projectionMatrix * viewMatrix * w;
                }`,
            fragmentShader: `uniform float uSun; varying vec3 vN, vV, vC; varying float vY;
                void main(){
                    float fr = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0);
                    float a = ${isTendril ? "0.55 * (1.0 + vY)" : "0.12 + fr*0.75"};
                    vec3 c = vC * (${isTendril ? "1.2" : "0.6 + fr*2.2"}) * (0.6 + uSun*0.8) * ${isTendril ? "1.0" : layered};
                    gl_FragColor = vec4(c, a);
                    ${SHADER_END}
                }`,
        });
        this.bells = new THREE.InstancedMesh(bellGeo, shader(false), N);
        const tGeo = new THREE.CylinderGeometry(0.02, 0.005, 1, 3, 10).translate(0, -0.5, 0);
        this.tendrils = new THREE.InstancedMesh(tGeo, shader(true), N * T);
        const palette = [new THREE.Color(0.3, 0.9, 1.0), new THREE.Color(1.0, 0.45, 0.85), new THREE.Color(0.65, 0.5, 1.0), new THREE.Color(0.4, 1.0, 0.7)];
        this.jellies = [];
        for (let i = 0; i < N; i++) {
            const c = palette[Math.floor(rand() * palette.length)];
            const r = 9 + rand() * rand() * 30;
            this.bells.setColorAt(i, c);
            for (let k = 0; k < T; k++) this.tendrils.setColorAt(i * T + k, c);
            const a = rand() * 6.28, d = 150 + rand() * 850;
            this.jellies.push({ home: new THREE.Vector3(C.x + Math.cos(a) * d, C.y - 700 + rand() * 1200, C.z + Math.sin(a) * d), p: new THREE.Vector3(), r, ph: rand() * 6.28, sp: 0.4 + rand() * 0.4, push: new THREE.Vector3() });
        }
        this.bells.frustumCulled = this.tendrils.frustumCulled = false;
        this.scene.add(this.bells, this.tendrils);
        this.drifterC = C;
    }

    _updateDrifters(dt, t, playerPos) {
        const near = playerPos.distanceTo(this.drifterC) < 6000;
        this.bells.visible = this.tendrils.visible = near;
        if (!near) return;
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
        const T = 7;
        this.jellies.forEach((j, i) => {
            const pulse = Math.sin(t * j.sp * 2 + j.ph);
            const away = j.home.clone().add(j.push).sub(playerPos);
            const d = away.length();
            if (d < 120) j.push.addScaledVector(away.normalize(), (120 - d) * dt * 0.8);
            j.push.multiplyScalar(1 - dt * 0.05);
            j.p.copy(j.home).add(j.push);
            j.p.y += Math.sin(t * 0.2 + j.ph) * 30 + pulse * 3;
            q.setFromEuler(new THREE.Euler(Math.sin(t * 0.3 + j.ph) * 0.15, t * 0.1 + j.ph, Math.cos(t * 0.25 + j.ph) * 0.15));
            s.set(j.r * (1 + pulse * 0.08), j.r * (1 - pulse * 0.12), j.r * (1 + pulse * 0.08));
            this.bells.setMatrixAt(i, m4.compose(j.p, q, s));
            for (let k = 0; k < T; k++) {
                const a = (k / T) * 6.28 + j.ph;
                p.set(Math.cos(a) * j.r * 0.6, 0, Math.sin(a) * j.r * 0.6).applyQuaternion(q).add(j.p);
                s.set(j.r * 2, j.r * (3 + (k % 3)), j.r * 2);
                this.tendrils.setMatrixAt(i * T + k, m4.compose(p, q, s));
            }
        });
        this.bells.instanceMatrix.needsUpdate = true;
        this.tendrils.instanceMatrix.needsUpdate = true;
    }

    // ---- great sky rays ---------------------------------------------------------------------
    _rays() {
        const N = 12;
        this.rays = new THREE.InstancedMesh(this.models.manta || mantaGeometry(), mantaMaterial(), N);
        this.rays.frustumCulled = false;
        this.scene.add(this.rays);
        const rand = mulberry32(81);
        const centers = [[-2600, 3200, -4600], [-7000, 2300, -1600], [5400, 3300, 2400], [0, 2900, 0]];
        this.rayList = [];
        for (let i = 0; i < N; i++) {
            const c = centers[i % centers.length];
            this.rayList.push({ c, r: 900 + rand() * 600, a: rand() * 6.28, sp: (0.018 + rand() * 0.01) * (rand() < 0.5 ? 1 : -1), h: (rand() - 0.5) * 500, size: 48 + rand() * 30, ph: rand() * 6 });
        }
    }

    _updateRays(dt, t) {
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), p2 = new THREE.Vector3();
        this.rayList.forEach((r, i) => {
            r.a += r.sp * dt;
            const pt = (a) => p2.set(r.c[0] + Math.cos(a) * r.r, r.c[1] + r.h + Math.sin(a * 3 + r.ph) * 80, r.c[2] + Math.sin(a) * r.r * 0.8);
            p.copy(pt(r.a));
            const ahead = pt(r.a + r.sp * 0.5).clone();
            const f = ahead.sub(p).normalize();
            m4.lookAt(new THREE.Vector3(), f.clone().negate(), new THREE.Vector3(0, 1, 0));
            q.setFromRotationMatrix(m4);
            q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sign(r.sp) * 0.3));
            s.setScalar(r.size);
            this.rays.setMatrixAt(i, m4.compose(p, q, s));
            r.pos = p.clone();
        });
        this.rays.instanceMatrix.needsUpdate = true;
    }

    // ---- seed wisps drifting off the Worldtree --------------------------------------------------
    _wisps(landmarks) {
        const N = 900;
        const base = landmarks.treeTop.clone();
        const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
        const rand = mulberry32(5);
        for (let i = 0; i < N; i++) {
            const a = rand() * 6.28, d = Math.sqrt(rand()) * 900;
            pos[i * 3] = base.x + Math.cos(a) * d; pos[i * 3 + 1] = base.y - 900 + rand() * 1100; pos[i * 3 + 2] = base.z + Math.sin(a) * d;
            seed[i * 4] = rand() * 6.28; seed[i * 4 + 1] = 0.2 + rand() * 0.5; seed[i * 4 + 2] = 10 + rand() * 30; seed[i * 4 + 3] = rand();
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
        g.boundingSphere = new THREE.Sphere(base, 2000);
        this.wispU = { uTime: shared.uTime, uGlow: shared.uGlow, uPx: { value: 1 } };
        this.wisps = new THREE.Points(g, new THREE.ShaderMaterial({
            uniforms: this.wispU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
            vertexShader: `attribute vec4 aSeed; uniform float uTime, uPx; varying float vA;
                void main(){ vec3 p = position; float t = uTime*aSeed.y + aSeed.x;
                p += vec3(sin(t)*aSeed.z, sin(t*0.7)*aSeed.z*0.6, cos(t*0.9)*aSeed.z);
                vec4 mv = modelViewMatrix * vec4(p,1.); gl_Position = projectionMatrix*mv;
                vA = (0.5 + 0.5*sin(uTime*2.0 + aSeed.w*30.)) * smoothstep(5000., 600., -mv.z);
                gl_PointSize = clamp(1400.*uPx / -mv.z, 1.5, 22.); }`,
            fragmentShader: `uniform float uGlow; varying float vA; void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c);
                float a = smoothstep(0.5, 0.0, d) * vA; float core = smoothstep(0.12, 0.0, d);
                gl_FragColor = vec4(vec3(0.85,0.95,1.0)*(1.0+core*2.0), a*(0.35+uGlow*0.65)); ${SHADER_END} }`,
        }));
        this.scene.add(this.wisps);
    }

    setPixelScale(px) {
        this.wispU.uPx.value = px;
    }

    update(dt, t, playerPos) {
        for (const w of this.whales) w.update(dt, t);
        this._updateFlocks(dt, playerPos);
        this._updateDrifters(dt, t, playerPos);
        this._updateRays(dt, t);
    }

    // Whales as obstacles: capsules along their length
    sdf(p) {
        let d = Infinity;
        for (const w of this.whales) {
            const half = w.length * 0.42;
            const a = w.pos.clone().addScaledVector(w.fwd, half), b = w.pos.clone().addScaledVector(w.fwd, -half);
            const ab = b.clone().sub(a), ap = p.clone().sub(a);
            const h = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
            const r = w.length * 0.1 * (1 - Math.abs(h - 0.4) * 0.9);
            d = Math.min(d, ap.sub(ab.multiplyScalar(h)).length() - r);
        }
        return d;
    }
}
