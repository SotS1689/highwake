// Builds island meshes (in workers), forests, hanging vines and waterfalls.

import * as THREE from "three";
import { entitySDF } from "./world.js";
import { shared, glowMaterial, foliageMaterial, addWind, buildParts, M4, SHADER_END, textures, UV_BARK as BARK, UV_LEAVES as LEAVES } from "./gfx.js";
import { mulberry32 } from "./noise.js";

export async function buildIslands(scene, entities, onProgress) {
    const mat = glowMaterial({ roughness: 0.95 }, null, true, true);
    const meshes = new Array(entities.length);
    const results = new Array(entities.length);
    const workers = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    // biggest first so the slow ones start early
    const queue = entities.map((e, i) => i).sort((a, b) => (entities[b].r || 0) - (entities[a].r || 0));
    let done = 0;

    await new Promise((resolve, reject) => {
        let active = 0;
        const pool = [];
        const next = (w) => {
            if (!queue.length) {
                w.terminate();
                if (--active === 0) resolve();
                return;
            }
            w.postMessage({ index: queue.shift() });
        };
        for (let k = 0; k < workers; k++) {
            const w = new Worker(new URL("./mesher.worker.js", import.meta.url), { type: "module" });
            active++;
            pool.push(w);
            w.onmessage = (ev) => {
                results[ev.data.entity] = ev.data;
                done++;
                onProgress?.(done / entities.length);
                next(w);
            };
            w.onerror = (err) => reject(err);
            next(w);
        }
    });

    const veg = new Vegetation(scene);
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i], r = results[i];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(r.position, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(r.normal, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(r.color, 3));
        geo.setAttribute("glow", new THREE.BufferAttribute(r.glow, 1));
        geo.setIndex(new THREE.BufferAttribute(r.index, 1));
        geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, mat);
        m.position.set(...e.pos);
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        scene.add(m);
        meshes[i] = m;
        e.mesh = m;
        veg.add(e, r.trees, r.vines);
    }
    veg.finish();
    const falls = new Waterfalls(scene, entities);
    return { meshes, veg, falls };
}

// ---------------------------------------------------------------------------------
// Trees and vines, instanced per island so off-screen islands are culled.

function treeGeometries() {
    const rand = mulberry32(8);
    // 0: umbrella tree, the classic tall Pandoran shape: a bark trunk under a
    // broad canopy of leaf-clump cards
    const umbrella = [
        { geo: new THREE.CylinderGeometry(0.9, 2.2, 40, 7, 1, true), matrix: M4([0, 20, 0]), color: "#e8e0d8", uvRect: BARK },
        { geo: new THREE.PlaneGeometry(30, 30), matrix: M4([0, 45, 0], [-Math.PI / 2, 0, 0.4]), color: "#d6ffe4", uvRect: LEAVES, normalFrom: [0, 30, 0] },
        { geo: new THREE.PlaneGeometry(22, 22), matrix: M4([0, 48.5, 0], [-Math.PI / 2, 0, 1.3]), color: "#e8ffd0", uvRect: LEAVES, normalFrom: [0, 30, 0],
            glow: (x, y, z) => (Math.sin(x * 2.1 + z * 1.7) > 0.93 ? 0.35 : 0) },
    ];
    for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + rand() * 0.4;
        umbrella.push({
            geo: new THREE.PlaneGeometry(17, 13), color: k % 2 ? "#c6f5cf" : "#b5e8c0", uvRect: LEAVES, normalFrom: [0, 30, 0],
            matrix: M4([Math.cos(a) * 9, 43, Math.sin(a) * 9], [0, -a + Math.PI / 2, 0]).multiply(M4([0, 0, 0], [-0.9, 0, 0])),
        });
    }
    // 1: spire tree, drooping tiers like a giant fir
    const spireParts = [{ geo: new THREE.CylinderGeometry(0.6, 1.6, 52, 6, 1, true), matrix: M4([0, 26, 0]), color: "#e0d8d0", uvRect: BARK }];
    for (let k = 0; k < 5; k++) {
        const w = 24 - k * 4.2, y = 14 + k * 8.5;
        for (let q = 0; q < 3; q++) {
            const a = (q / 3) * Math.PI + k * 0.7;
            spireParts.push({
                geo: new THREE.PlaneGeometry(w, w * 0.55), color: k % 2 ? "#a9e0c8" : "#c0ecc8", uvRect: LEAVES, normalFrom: [0, y - 8, 0],
                matrix: M4([0, y, 0], [0, a, 0]).multiply(M4([0, 0, 0], [-Math.PI / 2 + 0.55, 0, 0])),
            });
        }
    }
    spireParts.push({ geo: new THREE.PlaneGeometry(14, 30), matrix: M4([0, 42, 0], [0, 0.3, 0]), color: "#b8e6c8", uvRect: LEAVES, normalFrom: [0, 30, 0] });
    spireParts.push({ geo: new THREE.PlaneGeometry(14, 30), matrix: M4([0, 42, 0], [0, 1.87, 0]), color: "#b8e6c8", uvRect: LEAVES, normalFrom: [0, 30, 0] });
    const spire = buildParts(spireParts);
    // 2: glowing spiral plant (lights the islands at night)
    const glowPlant = buildParts([
        { geo: new THREE.ConeGeometry(1.6, 18, 7, 6), matrix: M4([0, 9, 0]), color: "#c75a2e", glow: (x, y) => 0.3 + y / 18 },
        { geo: new THREE.ConeGeometry(1.1, 12, 6, 4), matrix: M4([3, 6, 1.5], [0.15, 0, -0.2]), color: "#d0743a", glow: (x, y) => 0.3 + y / 12 },
        { geo: new THREE.ConeGeometry(0.9, 10, 6, 4), matrix: M4([-2.5, 5, -2], [-0.2, 0, 0.18]), color: "#b54a3a", glow: (x, y) => 0.3 + y / 10 },
    ]);
    return { umbrella: buildParts(umbrella), spire, glowPlant, vines: [vineGeometry(30, 11), vineGeometry(50, 23)] };
}

// A hanging vine of length L: two bark strands twisting round a gently swaying
// line, leaf clumps along it and glowing seed-bulbs at the nodes and the tip.
// Returns the strand geometry (bark-mapped) and the leaf-card geometry.
function vineGeometry(L, seed) {
    const rand = mulberry32(seed);
    const p1 = rand() * 6.28, p2 = rand() * 6.28;
    const centre = (t) => new THREE.Vector3(Math.sin(t * 4.1 + p1) * L * 0.035 * t, -t * L, Math.sin(t * 3.3 + p2) * L * 0.03 * t);
    const strands = [];
    for (let s = 0; s < 2; s++) {
        const pts = [];
        for (let i = 0; i <= 48; i++) {
            const t = i / 48, a = t * L * 0.9 + s * Math.PI, r = 0.75 * (1 - t * 0.6);
            pts.push(centre(t).add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)));
        }
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 56, 0.5, 6, false);
        // taper toward the tip, and run the bark texture along the strand every few metres
        const P = tube.attributes.position, U = tube.attributes.uv;
        for (let i = 0; i < P.count; i++) {
            const t = U.getX(i), k = 1 - t * 0.7, q = pts[Math.round(t * 48)];
            P.setX(i, q.x + (P.getX(i) - q.x) * k);
            P.setZ(i, q.z + (P.getZ(i) - q.z) * k);
            U.setXY(i, (t * L) / 3.0, U.getY(i));
        }
        strands.push({ geo: tube, color: s ? "#7d9a78" : "#6f8c6c", glow: 0 });
    }
    // seed-bulbs: a few along the vine, a bigger one at the tip
    const nodes = Math.round(L / 9);
    for (let n = 1; n <= nodes; n++) {
        const t = n / (nodes + 1) + (rand() - 0.5) * 0.05, c = centre(t);
        strands.push({ geo: new THREE.SphereGeometry(0.55, 8, 6), matrix: M4([c.x + 0.6, c.y, c.z], [0, 0, 0], [1, 1.3, 1]), color: "#8a7bd0", glow: 0.55 });
    }
    const tip = centre(1);
    strands.push({ geo: new THREE.SphereGeometry(1.0, 10, 8), matrix: M4([tip.x, tip.y - 0.4, tip.z], [0, 0, 0], [1, 1.5, 1]), color: "#9a88e8", glow: 0.95 });
    // leaf clumps hanging off the strands, thinning out toward the tip
    const leaves = [];
    const nl = Math.round(L * 0.8);
    for (let i = 0; i < nl; i++) {
        const t = Math.pow(i / nl, 1.3) * 0.95 + 0.02, c = centre(t), a = rand() * 6.28, sz = (2.6 + rand() * 1.6) * (1 - t * 0.5);
        const off = new THREE.Vector3(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9);
        leaves.push({
            geo: new THREE.PlaneGeometry(sz, sz * 1.2), color: rand() < 0.5 ? "#b9e6c2" : "#a7d9b6", uvRect: LEAVES, normalFrom: [c.x, c.y + 2, c.z],
            matrix: M4([c.x + off.x * 1.6, c.y - sz * 0.3, c.z + off.z * 1.6], [0, -a + Math.PI / 2, 0]).multiply(M4([0, 0, 0], [-0.35, 0, 0])),
        });
    }
    return { L, strand: buildParts(strands), leaves: buildParts(leaves) };
}

class Vegetation {
    constructor(scene) {
        this.scene = scene;
        this.geos = treeGeometries();
        this.mat = foliageMaterial();
        // vine strands sway with the same wind as their leaves (foliageMaterial)
        this.glowMat = addWind(glowMaterial({ roughness: 0.8 }, "#ff9a5a"), 0.5, false);
        this.vineMat = addWind(glowMaterial({ roughness: 0.85, map: textures().bark }, "#9b7cff"), 1, false);
        this.groups = [];
    }

    add(e, trees, vines) {
        const types = [[], [], []];
        for (let i = 0; i < trees.length; i += 5) {
            const t = trees[i + 4];
            const ty = e.glowy ? (t < 0.45 ? 2 : t < 0.8 ? 0 : 1) : t < 0.66 ? 0 : t < 0.9 ? 1 : 2;
            types[ty].push(trees[i], trees[i + 1], trees[i + 2], trees[i + 3]);
        }
        const group = { e, meshes: [] };
        const geos = [this.geos.umbrella, this.geos.spire, this.geos.glowPlant];
        const scaleFor = e.small ? 0.7 : 1;
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
        const rand = mulberry32((e.seed || 3) * 17);
        types.forEach((arr, ty) => {
            const n = arr.length / 4;
            if (!n) return;
            const im = new THREE.InstancedMesh(geos[ty], ty === 2 ? this.glowMat : this.mat, n);
            for (let k = 0; k < n; k++) {
                const sc = arr[k * 4 + 3] * scaleFor;
                p.set(arr[k * 4] + e.pos[0], arr[k * 4 + 1] + e.pos[1] - 2, arr[k * 4 + 2] + e.pos[2]);
                q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.12, rand() * 6.28, (rand() - 0.5) * 0.12));
                s.set(sc, sc * (0.8 + rand() * 0.5), sc);
                im.setMatrixAt(k, m4.compose(p, q, s));
            }
            im.computeBoundingSphere();
            this.scene.add(im);
            group.meshes.push(im);
        });
        // vines: each uses the nearer of two built lengths, scaled to fit
        const byVariant = [[], []];
        for (let k = 0; k < vines.length / 4; k++) {
            const len = vines[k * 4 + 3] * 55 * (e.small ? 0.6 : 1);
            const vi = len < 40 ? 0 : 1;
            p.set(vines[k * 4] + e.pos[0], vines[k * 4 + 1] + e.pos[1] + 2, vines[k * 4 + 2] + e.pos[2]);
            q.setFromEuler(new THREE.Euler(0, rand() * 6.28, 0));
            s.setScalar(Math.max(0.35, len / this.geos.vines[vi].L));
            byVariant[vi].push(m4.compose(p, q, s).clone());
        }
        byVariant.forEach((list, vi) => {
            if (!list.length) return;
            const V = this.geos.vines[vi];
            for (const [geo, mat] of [[V.strand, this.vineMat], [V.leaves, this.mat]]) {
                const im = new THREE.InstancedMesh(geo, mat, list.length);
                list.forEach((m, k) => im.setMatrixAt(k, m));
                im.computeBoundingSphere();
                this.scene.add(im);
                group.meshes.push(im);
            }
        });
        this.groups.push(group);
    }

    finish() {}

    // Hide forests on far islands; they're sub-pixel there anyway
    update(cam, range) {
        for (const g of this.groups) {
            const d = Math.hypot(g.e.pos[0] - cam.x, g.e.pos[1] - cam.y, g.e.pos[2] - cam.z) - (g.e.r || 500);
            const vis = d < range;
            for (const m of g.meshes) m.visible = vis;
        }
    }
}

// ---------------------------------------------------------------------------------
// Waterfalls: ribbons that pour off the rims and dissolve into mist far below.

export class Waterfalls {
    constructor(scene, entities) {
        this.list = [];
        this.u = { uTime: shared.uTime, uSunColor: shared.uSunColor, uHaze: shared.uHaze, uGlow: shared.uGlow, uSunDir: shared.uSunDir };
        this.mat = new THREE.ShaderMaterial({
            uniforms: this.u, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
            vertexShader: `
                attribute float aLen; varying vec2 vUv; varying float vLen; varying float vDist; varying float vDir;
                attribute float aDir;
                void main(){ vUv = uv; vLen = aLen; vDir = aDir; vec4 mv = modelViewMatrix * vec4(position,1.); vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
            fragmentShader: `
                uniform float uTime, uGlow; uniform vec3 uSunColor, uHaze, uSunDir;
                varying vec2 vUv; varying float vLen; varying float vDist; varying float vDir;
                float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
                float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
                void main(){
                    float along = vUv.y * vLen;           // metres from the lip
                    float x = vUv.x;
                    // water accelerates as it falls, so the streaks stretch: distance grows with
                    // the square of time, so time-from-the-lip goes with its square root
                    float ft = sqrt(max(along, 0.0)) * 0.9;
                    float flow = (vDir > 0.0 ? ft : along * 0.035) - uTime * 1.6 * vDir;
                    float s = n(vec2(x * 18., flow)) * 0.5 + n(vec2(x * 47., flow * 1.7 + 3.)) * 0.3 + n(vec2(x * 110., flow * 3.1 + 7.)) * 0.2;
                    // the sheet is solid at the lip and tears into strands and spray lower down
                    float tear = smoothstep(0.02, 0.55, vUv.y);
                    float rag = n(vec2(x * 9., ft * 0.6 - uTime * 0.5)) * 0.12;
                    float edge = smoothstep(0.0, 0.16 + rag + tear * 0.12, x) * smoothstep(1.0, 0.84 - rag - tear * 0.12, x);
                    float fade = 1.0 - smoothstep(0.35, 1.0, vUv.y);
                    float a = smoothstep(0.3 + 0.28 * tear, 0.78, s);
                    a = max(a, (1.0 - smoothstep(0.0, 0.07, vUv.y)) * 0.85);       // glassy lip
                    a = max(a, 0.18 * (1.0 - tear)) * edge * fade;
                    // deep green-blue where it's thick, white foam on the fast streaks
                    float foam = smoothstep(0.55, 0.92, s) + (1.0 - smoothstep(0.0, 0.05, vUv.y)) * 0.6;
                    vec3 col = mix(vec3(0.32, 0.52, 0.6), vec3(1.0), clamp(foam, 0.0, 1.0));
                    float sunUp = clamp(uSunDir.y * 3.0 + 0.3, 0.0, 1.0);
                    col *= 0.5 + 0.5 * uSunColor;
                    // sun glints sparkling down the sheet
                    vec2 gc = vec2(x * 160., flow * 26.);
                    float glint = step(0.992, h(floor(gc))) * smoothstep(0.5, 0.0, length(fract(gc) - 0.5)) * sunUp;
                    col += uSunColor * glint * 3.0;
                    col += vec3(0.3, 0.9, 1.0) * uGlow * 0.3 * s;
                    col = mix(col, uHaze, clamp(1.0 - exp(-vDist * 0.00008), 0., 1.));
                    gl_FragColor = vec4(col, a * 0.88);
                    ${SHADER_END}
                }`,
        });
        const rand = mulberry32(2024);
        for (const e of entities) {
            if (e.kind !== "island") continue;
            for (const ang of e.falls || []) {
                const f = this._place(e, ang, rand);
                if (f) this.list.push(f);
            }
            if (e.risingFall) this._rising(e);
        }
        this.mesh = this._build(scene);
        this.spray = this._buildSpray(scene);
    }

    // Spray: droplets peel off each falling sheet and drift outward as they fall,
    // growing into mist. Animated entirely in the vertex shader.
    _buildSpray(scene) {
        const PER = 260;
        const falls = this.list.filter((f) => !f.rising);
        const n = falls.length * PER;
        const lip = new Float32Array(n * 3), frame = new Float32Array(n * 4), seed = new Float32Array(n * 4);
        const rand = mulberry32(77);
        falls.forEach((f, fi) => {
            const L = f.pts[3];
            for (let k = 0; k < PER; k++) {
                const i = fi * PER + k;
                lip.set([L.x, L.y, L.z], i * 3);
                frame.set([f.normal.x, f.normal.z, f.w, f.len], i * 4);
                seed.set([rand(), rand(), rand(), rand()], i * 4);
            }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(lip, 3));
        g.setAttribute("aFrame", new THREE.BufferAttribute(frame, 4));
        g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        this.sprayU = { uTime: shared.uTime, uSunColor: shared.uSunColor, uHaze: shared.uHaze, uGlow: shared.uGlow, uPx: { value: 1 } };
        const m = new THREE.Points(g, new THREE.ShaderMaterial({
            uniforms: this.sprayU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
            vertexShader: `
                attribute vec4 aFrame, aSeed; uniform float uTime, uPx; varying float vA; varying float vDist;
                void main(){
                    float life = fract(aSeed.x + uTime * (0.05 + 0.04 * aSeed.y));
                    float fall = life * life * aFrame.w * 0.55;           // accelerating
                    vec3 out_ = vec3(aFrame.x, 0.0, aFrame.y);
                    vec3 side = vec3(-aFrame.y, 0.0, aFrame.x);
                    float spread = 1.0 + fall * 0.02;
                    vec3 p = position + vec3(0.0, -fall, 0.0)
                        + out_ * (8.0 + fall * (0.04 + 0.08 * aSeed.z))
                        + side * (aSeed.w - 0.5) * aFrame.z * spread;
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    vDist = -mv.z;
                    gl_Position = projectionMatrix * mv;
                    vA = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.55, 1.0, life)) * smoothstep(9000.0, 1500.0, vDist);
                    gl_PointSize = clamp((6.0 + fall * 0.08) * 260.0 * uPx / max(vDist, 1.0), 1.0, 48.0);
                }`,
            fragmentShader: `
                uniform vec3 uSunColor, uHaze; uniform float uGlow; varying float vA; varying float vDist;
                void main(){
                    float d = length(gl_PointCoord - 0.5);
                    float a = smoothstep(0.5, 0.0, d) * vA * 0.35;
                    vec3 c = mix(vec3(0.9, 0.95, 1.0) * (0.5 + 0.6 * uSunColor), uHaze, clamp(vDist / 12000.0, 0.0, 1.0)) + vec3(0.2, 0.7, 0.9) * uGlow * 0.2;
                    gl_FragColor = vec4(c * a, a);
                    ${SHADER_END}
                }`,
        }));
        m.frustumCulled = false;
        m.renderOrder = 6;
        scene.add(m);
        return m;
    }

    setPixelScale(px) { if (this.sprayU) this.sprayU.uPx.value = px; }

    _surfaceY(e, x, z) {
        for (let y = e.h * 1.2; y > -e.h * 2; y -= 3) if (entitySDF(e, x, y, z) < 0) return y;
        return null;
    }

    _radiusAt(e, ang, y) {
        const dx = Math.cos(ang), dz = Math.sin(ang);
        for (let r = e.r * 1.8; r > 0; r -= 6) if (entitySDF(e, dx * r, y, dz * r) < 0) return r;
        return 0;
    }

    _place(e, ang0, rand) {
        // look for a lip that is the outermost point on its side, so water falls clear
        for (let tries = 0; tries < 12; tries++) {
            const ang = ang0 + (tries ? (rand() - 0.5) * 1.4 : 0);
            const lipR = this._radiusAt(e, ang, e.h * 0.05);
            if (!lipR) continue;
            let maxBelow = 0;
            for (const y of [-e.h * 0.4, -e.h * 0.8, -e.h * 1.3, -e.h * 2, -e.d * 0.4]) maxBelow = Math.max(maxBelow, this._radiusAt(e, ang, y));
            if (maxBelow > lipR + 4) continue;
            const dx = Math.cos(ang), dz = Math.sin(ang);
            const inR = lipR - 30;
            const topY = this._surfaceY(e, dx * inR, dz * inR);
            if (topY === null) continue;
            const w = (e.small ? 14 : 26) + rand() * 20;
            const len = (e.small ? 600 : 1000) + rand() * 700;
            const P = (r, y) => new THREE.Vector3(e.pos[0] + dx * r, e.pos[1] + y, e.pos[2] + dz * r);
            const pts = [P(inR, topY + 1.5), P(lipR - 2, topY - 1), P(lipR + 10, topY - 14), P(lipR + 18, topY - 50)];
            for (let k = 1; k <= 16; k++) pts.push(P(lipR + 18 + k * 2.5, topY - 50 - (k / 16) * len));
            const tangent = new THREE.Vector3(-dz, 0, dx);
            const bottom = pts[pts.length - 1];
            const mid = P(lipR + 18 + 20, 0);
            return { pts, w, len: len + 80, tangent, dir: 1, normal: new THREE.Vector3(dx, 0, dz), x: mid.x, z: mid.z, top: e.pos[1] + topY - 50, bottomY: bottom.y + len * 0.4, mist: bottom.clone().setY(e.pos[1] + topY - 50 - len * 0.55) };
        }
        return null;
    }

    _rising(e) {
        // water that climbs from a pool on the summit into the sky
        const topY = this._surfaceY(e, 0, 0) ?? e.h * 0.4;
        for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2;
            const base = new THREE.Vector3(e.pos[0] + Math.cos(a) * 40, e.pos[1] + topY, e.pos[2] + Math.sin(a) * 40);
            const pts = [];
            for (let i = 0; i <= 24; i++) {
                const t = i / 24;
                const tw = a + t * 2.2;
                pts.push(new THREE.Vector3(e.pos[0] + Math.cos(tw) * (40 + t * 120), base.y + t * 1500, e.pos[2] + Math.sin(tw) * (40 + t * 120)));
            }
            this.list.push({ pts, w: 34, len: 1600, tangent: new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), dir: -1, rising: true, normal: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)) });
        }
    }

    _build(scene) {
        const pos = [], uv = [], lenA = [], dirA = [], idx = [];
        for (const f of this.list) {
            const base = pos.length / 3;
            let acc = 0;
            for (let i = 0; i < f.pts.length; i++) {
                if (i) acc += f.pts[i].distanceTo(f.pts[i - 1]);
                const t = acc / f.len;
                const half = (f.w / 2) * (1 + t * (f.rising ? 0.5 : 2.2));
                let side = f.tangent;
                if (f.rising) {
                    const p = f.pts[i];
                    side = new THREE.Vector3(p.x - f.pts[0].x, 0, p.z - f.pts[0].z).cross(new THREE.Vector3(0, 1, 0)).normalize();
                    if (!isFinite(side.x) || side.lengthSq() < 0.5) side = f.tangent;
                }
                for (const sgn of [-1, 1]) {
                    const p = f.pts[i].clone().addScaledVector(side, sgn * half);
                    pos.push(p.x, p.y, p.z);
                    uv.push(sgn < 0 ? 0 : 1, Math.min(1, t));
                    lenA.push(f.len); dirA.push(f.dir);
                }
                if (i) {
                    const a = base + (i - 1) * 2;
                    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
                }
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        geo.setAttribute("aLen", new THREE.Float32BufferAttribute(lenA, 1));
        geo.setAttribute("aDir", new THREE.Float32BufferAttribute(dirA, 1));
        geo.setIndex(idx);
        geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, this.mat);
        m.renderOrder = 4;
        m.frustumCulled = false;
        scene.add(m);
        return m;
    }

    // Is p inside a falling sheet of water?
    inside(p) {
        for (const f of this.list) {
            if (f.rising) {
                const b = f.pts[0];
                if (p.y < b.y || p.y > b.y + 1500) continue;
                const t = (p.y - b.y) / 1500;
                const i = Math.min(f.pts.length - 1, Math.round(t * 24));
                if (Math.hypot(p.x - f.pts[i].x, p.z - f.pts[i].z) < 22) return true;
                continue;
            }
            if (p.y > f.top || p.y < f.bottomY) continue;
            const dx = p.x - f.x, dz = p.z - f.z;
            const along = dx * f.tangent.x + dz * f.tangent.z;
            const across = dx * f.normal.x + dz * f.normal.z;
            if (Math.abs(across) < 9 && Math.abs(along) < f.w * 0.8) return true;
        }
        return false;
    }
}
