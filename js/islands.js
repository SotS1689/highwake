// Builds island meshes (in workers), forests, hanging vines and waterfalls.

import * as THREE from "three";
import { entitySDF } from "./world.js";
import { shared, glowMaterial, foliageMaterial, addWind, buildParts, M4, SHADER_END, textures, UV_BARK as BARK, UV_LEAVES as LEAVES, ATLAS_HANGING } from "./gfx.js";
import { mulberry32 } from "./noise.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// The Blender tree kit (tools/blender/build_trees.py): for each species and variant a
// near version (bark + leaf cards) and a far version (a few big cards on the atlas).
// ?trees=classic keeps the old code-built trees.
async function loadTreeModels() {
    if (new URLSearchParams(location.search).get("trees") === "classic") return null;
    try {
        const gltf = await new GLTFLoader().loadAsync(new URL("../models/trees.glb", import.meta.url).href);
        const out = { canopy: [], spire: [] };
        gltf.scene.traverse((o) => {
            if (!o.isMesh) return;
            const g = o.geometry;
            for (const [from, to] of [["_GLOW", "glow"], ["_glow", "glow"], ["_NRM", "normal"], ["_nrm", "normal"]]) {
                if (g.attributes[from]) { g.setAttribute(to, g.attributes[from]); g.deleteAttribute(from); }
            }
            if (!g.attributes.glow) g.setAttribute("glow", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
            const m = o.name.match(/^(canopy|spire)(\d)_(bark|leaves|lo)$/);
            if (!m) return;
            g.computeBoundingSphere();
            const list = out[m[1]], v = +m[2] - 1;
            (list[v] ??= {})[m[3]] = g;
        });
        if (!out.canopy.length || !out.spire.length) throw new Error("tree kit incomplete");
        return out;
    } catch (e) {
        console.warn("tree models failed, using the classic trees", e);
        return null;
    }
}

export async function buildIslands(scene, entities, onProgress) {
    const mat = glowMaterial({ roughness: 0.95 }, null, true, true);
    const meshes = new Array(entities.length);
    const results = new Array(entities.length);
    const coarse = new Array(entities.length);
    // each island is meshed twice: full detail, and a coarse copy (cells LOD_SCALE times
    // bigger, about 1/9 the triangles) drawn when it's far away and for the horizon giants
    const LOD_SCALE = 3;
    const workers = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    // biggest first so the slow ones start early
    const order = entities.map((e, i) => i).sort((a, b) => (entities[b].r || 0) - (entities[a].r || 0));
    const queue = order.map((i) => ({ index: i, scale: 1 })).concat(order.map((i) => ({ index: i, scale: LOD_SCALE })));
    const total = queue.length;
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
            w.postMessage(queue.shift());
        };
        for (let k = 0; k < workers; k++) {
            const w = new Worker(new URL("./mesher.worker.js", import.meta.url), { type: "module" });
            active++;
            pool.push(w);
            w.onmessage = (ev) => {
                (ev.data.scale === 1 ? results : coarse)[ev.data.entity] = ev.data;
                done++;
                onProgress?.(done / total);
                next(w);
            };
            w.onerror = (err) => reject(err);
            next(w);
        }
    });

    const toGeo = (r) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(r.position, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(r.normal, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(r.color, 3));
        geo.setAttribute("glow", new THREE.BufferAttribute(r.glow, 1));
        geo.setIndex(new THREE.BufferAttribute(r.index, 1));
        geo.computeBoundingSphere();
        return geo;
    };
    const [treeKit, rockKit] = await Promise.all([loadTreeModels(), loadRockModels()]);
    const veg = new Vegetation(scene, treeKit);
    veg.rocks = rockKit ? new Rocks(scene, rockKit, mat) : null;
    const farGeos = new Array(entities.length);
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i], r = results[i];
        const m = new THREE.Mesh(toGeo(r), mat);
        const lo = coarse[i] && coarse[i].index.length > 0 ? new THREE.Mesh(toGeo(coarse[i]), mat) : null;
        // switch to the coarse copy once the island is small on screen
        const lod = new THREE.LOD();
        lod.position.set(...e.pos);
        lod.addLevel(m, 0);
        if (lo) lod.addLevel(lo, Math.max(2200, (e.r || 300) * 6));
        lod.matrixAutoUpdate = false;
        lod.updateMatrix();
        scene.add(lod);
        meshes[i] = m;
        farGeos[i] = lo ? lo.geometry : m.geometry;
        e.mesh = m;
        veg.add(e, r.trees, r.vines);
        if (veg.ground) veg.ground.add(e, r);
        if (veg.rocks) veg.rocks.add(e, r);
    }
    veg.finish();
    veg.ground?.finish();
    const falls = new Waterfalls(scene, entities);
    return { meshes, farGeos, veg, falls };
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
    return { umbrella: buildParts(umbrella), spire, glowPlant, vines: [vineGeometry(30, 11), vineGeometry(50, 23)], vinesLo: [vineGeometry(30, 11, true), vineGeometry(50, 23, true)] };
}

// A hanging vine of length L: two bark strands twisting round a gently swaying
// line, leaf clumps along it and glowing seed-bulbs at the nodes and the tip.
// Returns the strand geometry (bark-mapped) and the leaf-card geometry.
// lo: the distant version, one thin strand and a few leaf cards (about 1/20 the triangles).
function vineGeometry(L, seed, lo = false) {
    const rand = mulberry32(seed);
    const p1 = rand() * 6.28, p2 = rand() * 6.28;
    const centre = (t) => new THREE.Vector3(Math.sin(t * 4.1 + p1) * L * 0.035 * t, -t * L, Math.sin(t * 3.3 + p2) * L * 0.03 * t);
    const strands = [];
    for (let s = 0; s < (lo ? 1 : 2); s++) {
        const pts = [];
        for (let i = 0; i <= 48; i++) {
            const t = i / 48, a = t * L * 0.9 + s * Math.PI, r = 0.75 * (1 - t * 0.6);
            pts.push(centre(t).add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)));
        }
        const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), lo ? 8 : 28, lo ? 0.8 : 0.5, lo ? 3 : 5, false);
        // taper toward the tip, and run the bark texture along the strand every few metres
        const P = tube.attributes.position, U = tube.attributes.uv;
        for (let i = 0; i < P.count; i++) {
            const t = U.getX(i), k = lo ? 1 - t * 0.5 : 1 - t * 0.7, q = pts[Math.round(t * 48)];
            P.setX(i, q.x + (P.getX(i) - q.x) * k);
            P.setZ(i, q.z + (P.getZ(i) - q.z) * k);
            U.setXY(i, (t * L) / 3.0, U.getY(i));
        }
        strands.push({ geo: tube, color: s ? "#7d9a78" : "#6f8c6c", glow: 0 });
    }
    // seed-bulbs: a few along the vine, a bigger one at the tip
    const nodes = lo ? 0 : Math.round(L / 9);
    for (let n = 1; n <= nodes; n++) {
        const t = n / (nodes + 1) + (rand() - 0.5) * 0.05, c = centre(t);
        strands.push({ geo: new THREE.SphereGeometry(0.55, 6, 4), matrix: M4([c.x + 0.6, c.y, c.z], [0, 0, 0], [1, 1.3, 1]), color: "#8a7bd0", glow: 0.55 });
    }
    const tip = centre(1);
    strands.push({ geo: lo ? new THREE.OctahedronGeometry(1.0) : new THREE.SphereGeometry(1.0, 8, 6), matrix: M4([tip.x, tip.y - 0.4, tip.z], [0, 0, 0], [1, 1.5, 1]), color: "#9a88e8", glow: 0.95 });
    // leaf clumps hanging off the strands, thinning out toward the tip
    const leaves = [];
    const nl = Math.round(L * (lo ? 0.25 : 0.8));
    for (let i = 0; i < nl; i++) {
        const t = Math.pow(i / nl, 1.3) * 0.95 + 0.02, c = centre(t), a = rand() * 6.28, sz = (2.6 + rand() * 1.6) * (1 - t * 0.5);
        const off = new THREE.Vector3(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9);
        leaves.push({
            geo: new THREE.PlaneGeometry(sz * (lo ? 1.6 : 1), sz * 1.2 * (lo ? 1.6 : 1)), color: rand() < 0.5 ? "#e4f2e6" : "#d2e6d6", uvRect: ATLAS_HANGING, normalFrom: [c.x, c.y + 2, c.z],
            matrix: M4([c.x + off.x * 1.6, c.y - sz * 0.3, c.z + off.z * 1.6], [0, -a + Math.PI / 2, 0]).multiply(M4([0, 0, 0], [-0.35, 0, 0])),
        });
    }
    return { L, strand: buildParts(strands), leaves: buildParts(leaves) };
}

class Vegetation {
    constructor(scene, kit) {
        this.scene = scene;
        this.geos = treeGeometries();
        this.kit = kit;
        this.mat = foliageMaterial();
        // vine leaves hang weeping fronds from the Blender leaves atlas
        this.vineLeafMat = foliageMaterial(null, textures().leaves);
        // vine strands sway with the same wind as their leaves (foliageMaterial)
        this.glowMat = addWind(glowMaterial({ roughness: 0.8 }, "#ff9a5a"), 0.5, false);
        this.vineMat = addWind(glowMaterial({ roughness: 0.85, map: textures().bark }, "#9b7cff"), 1, false);
        if (kit) {
            this.leafMat = foliageMaterial(null, textures().leaves);
            this.barkMat = addWind(glowMaterial({ roughness: 0.9, map: textures().bark }), 1, false);
        }
        this.groups = [];
        this.hiRange = 600;      // set from the quality level
        this.groundRange = 300;  // ground cover (0: none)
        this.ground = kit ? new Ground(scene) : null;
        this.CHUNK = 320;        // forest patch size for the near trees
    }

    _instanced(geo, mat, list) {
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((m, k) => im.setMatrixAt(k, m));
        im.computeBoundingSphere();
        this.scene.add(im);
        return im;
    }

    add(e, trees, vines) {
        const group = { e, meshes: [], chunks: [], lo: new Map() };
        const scaleFor = e.small ? 0.7 : 1;
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
        const rand = mulberry32((e.seed || 3) * 17);
        // sort trees by kind (0 canopy, 1 spire, 2 glow plant) and, with the kit, variant;
        // with the kit, canopy and spire trees are also gathered into forest patches
        const sets = new Map(), chunks = new Map();
        for (let i = 0; i < trees.length; i += 5) {
            const t = trees[i + 4];
            const ty = e.glowy ? (t < 0.45 ? 2 : t < 0.8 ? 0 : 1) : t < 0.66 ? 0 : t < 0.9 ? 1 : 2;
            const sc = trees[i + 3] * scaleFor;
            p.set(trees[i] + e.pos[0], trees[i + 1] + e.pos[1] - 2, trees[i + 2] + e.pos[2]);
            q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.12, rand() * 6.28, (rand() - 0.5) * 0.12));
            s.set(sc, sc * (0.8 + rand() * 0.5), sc);
            const variants = this.kit && ty < 2 ? this.kit[ty ? "spire" : "canopy"].length : 1;
            const key = ty * 10 + Math.min(variants - 1, Math.floor(rand() * variants));
            if (!sets.has(key)) sets.set(key, []);
            const list = sets.get(key);
            const tree = { m: m4.compose(p, q, s).clone(), key, index: list.length };
            list.push(tree);
            if (this.kit && ty < 2) {
                const ck = Math.floor(trees[i] / this.CHUNK) + "," + Math.floor(trees[i + 2] / this.CHUNK);
                if (!chunks.has(ck)) chunks.set(ck, { trees: [], center: new THREE.Vector3(), hi: false, meshes: null, r: 0 });
                const c = chunks.get(ck);
                c.trees.push(tree);
                c.center.add(p);
            }
        }
        // far versions: one instanced mesh per kind and variant for the whole island
        for (const [key, list] of sets) {
            const ty = Math.floor(key / 10), v = key % 10;
            const kitTree = this.kit && ty < 2;
            const geo = kitTree ? this.kit[ty ? "spire" : "canopy"][v].lo : [this.geos.umbrella, this.geos.spire, this.geos.glowPlant][ty];
            const mat = ty === 2 ? this.glowMat : kitTree ? this.leafMat : this.mat;
            const im = this._instanced(geo, mat, list.map((t) => t.m));
            group.lo.set(key, im);
            group.meshes.push(im);
        }
        // near versions are built per forest patch the first time you come close
        const tp = new THREE.Vector3();
        for (const c of chunks.values()) {
            c.center.multiplyScalar(1 / c.trees.length);
            for (const t of c.trees) c.r = Math.max(c.r, c.center.distanceTo(tp.setFromMatrixPosition(t.m)));
            c.r += 30;
            group.chunks.push(c);
        }
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
        group.vinesHi = []; group.vinesLo = [];
        byVariant.forEach((list, vi) => {
            if (!list.length) return;
            for (const [V, out] of [[this.geos.vines[vi], group.vinesHi], [this.geos.vinesLo[vi], group.vinesLo]]) {
                for (const [geo, mat] of [[V.strand, this.vineMat], [V.leaves, this.vineLeafMat]]) out.push(this._instanced(geo, mat, list));
            }
        });
        this.groups.push(group);
    }

    // Shader warm-up: one hidden near tree of each kind (the loading screen's warm-up
    // draws hidden things once), so the first forest you fly up to doesn't stall.
    finish() {
        if (!this.kit) return;
        const m = new THREE.Matrix4().makeTranslation(0, -1e5, 0);
        for (const sp of ["canopy", "spire"]) for (const v of this.kit[sp]) {
            for (const [geo, mat] of [[v.bark, this.barkMat], [v.leaves, this.leafMat]]) this._instanced(geo, mat, [m]).visible = false;
        }
    }

    _setHi(g, c, hi) {
        c.hi = hi;
        if (hi && !c.meshes) {
            const byKey = new Map();
            for (const t of c.trees) { if (!byKey.has(t.key)) byKey.set(t.key, []); byKey.get(t.key).push(t.m); }
            c.meshes = [];
            for (const [key, list] of byKey) {
                const v = this.kit[Math.floor(key / 10) ? "spire" : "canopy"][key % 10];
                c.meshes.push(this._instanced(v.bark, this.barkMat, list), this._instanced(v.leaves, this.leafMat, list));
            }
        }
        if (c.meshes) for (const m of c.meshes) m.visible = hi;
        // hide the far versions of these trees while the near ones show
        const touched = new Set();
        for (const t of c.trees) {
            const im = g.lo.get(t.key);
            im.setMatrixAt(t.index, hi ? ZERO : t.m);
            touched.add(im);
        }
        for (const im of touched) im.instanceMatrix.needsUpdate = true;
    }

    // Hide forests on far islands (they're sub-pixel there anyway); trees near the camera
    // use the detailed Blender models; vines get a detailed version up close, a light one
    // at middle distance, and none beyond that.
    update(cam, range) {
        const VINE_HI = 900, VINE_LO = Math.min(range, 4500);
        const HI = this.hiRange;
        this.ground?.update(cam, this.groundRange);
        this.rocks?.update(cam, range);
        for (const g of this.groups) {
            const d = Math.hypot(g.e.pos[0] - cam.x, g.e.pos[1] - cam.y, g.e.pos[2] - cam.z) - (g.e.r || 500);
            const vis = d < range;
            for (const m of g.meshes) m.visible = vis;
            for (const m of g.vinesHi) m.visible = d < VINE_HI;
            for (const m of g.vinesLo) m.visible = d >= VINE_HI && d < VINE_LO;
            for (const c of g.chunks) {
                const dc = c.center.distanceTo(cam) - c.r;
                // a little hysteresis so a patch on the boundary doesn't flip every frame
                const want = vis && (c.hi ? dc < HI * 1.15 : dc < HI);
                if (want !== c.hi) this._setHi(g, c, want);
            }
        }
    }
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------------------------------------------------------------------------------
// Ground cover: clumps of grass, ferns, flowers and low bushes on the grassy tops,
// from the Blender undergrowth atlas. Only patches near the camera exist; each clump
// shrinks into the ground toward the edge of the range, so they never pop in.

const GROUND_CELLS = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];     // grass, fern, flowers, bush
const GROUND_SIZE = [[7, 4.5], [9, 6.5], [6.5, 5], [10, 6]];         // width, height (m)

function groundMaterial(range) {
    const m = foliageMaterial(null, textures().undergrowth);
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
        base.call(m, sh, r);
        sh.uniforms.uGroundRange = range;
        sh.vertexShader = sh.vertexShader
            .replace("#include <common>", "#include <common>\nattribute vec2 aCell;\nuniform float uGroundRange;")
            .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv += aCell;\n#endif")
            .replace("#include <project_vertex>", `{
                vec3 gp = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                float f = smoothstep(uGroundRange, uGroundRange * 0.7, distance(gp, cameraPosition));
                // a gentle sway, more at the tips, then sink into the ground with distance
                transformed.x += sin(uTime * 1.7 + gp.x * 0.05 + gp.z * 0.04) * position.y * 0.07;
                transformed *= f;
            }
            #include <project_vertex>`);
    };
    const key = m.customProgramCacheKey;
    m.customProgramCacheKey = () => key() + "ground";
    return m;
}

function groundGeometry() {
    // three crossed upright cards; normals lean up so a clump shades like the ground it's on
    const parts = [];
    for (let k = 0; k < 3; k++) {
        parts.push({ geo: new THREE.PlaneGeometry(1, 1), matrix: M4([0, 0.5, 0], [0, (k * Math.PI) / 3, 0]), color: "#c9d4b4", uvRect: [0.004, 0.496, 0.496, 0.004], normalFrom: [0, -1.2, 0] });
    }
    return buildParts(parts);
}

class Ground {
    constructor(scene) {
        this.scene = scene;
        this.range = { value: 300 };
        this.mat = groundMaterial(this.range);
        this.geo = groundGeometry();
        this.CHUNK = 160;
        this.chunks = [];
    }

    // Scatter clumps over the grassy, level parts of an island's surface mesh (local
    // coordinates). Each surface vertex stands for about cell x cell square metres.
    add(e, r) {
        const P = r.position, N = r.normal, C = r.color;
        const c = e.cell || 8, per = (c * c) / 45;
        const rand = mulberry32((e.seed || 5) * 131 + 9);
        const map = new Map();
        const t = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
        for (let v = 0; v < P.length / 3; v++) {
            const ny = N[v * 3 + 1];
            if (ny < 0.8 || C[v * 3 + 1] - C[v * 3] < 0.03) continue;
            let k = Math.floor(per) + (rand() < per % 1 ? 1 : 0);
            if (!k) continue;
            n.set(N[v * 3], ny, N[v * 3 + 2]);
            t.set(1, 0, 0).addScaledVector(n, -n.x).normalize();
            b.crossVectors(n, t);
            // meadows: flowers gather in patches, ferns in the damper hollows
            const meadow = Math.sin(P[v * 3] * 0.013 + e.pos[0]) * Math.sin(P[v * 3 + 2] * 0.011 - e.pos[2]);
            while (k--) {
                const du = (rand() - 0.5) * c, dv = (rand() - 0.5) * c;
                const x = P[v * 3] + t.x * du + b.x * dv, y = P[v * 3 + 1] + t.y * du + b.y * dv - 0.4, z = P[v * 3 + 2] + t.z * du + b.z * dv;
                const q = rand();
                const ty = meadow > 0.35 ? (q < 0.55 ? 2 : 0) : q < 0.55 ? 0 : q < 0.75 ? 1 : q < 0.9 ? 3 : 2;
                const key = Math.floor(x / this.CHUNK) + "," + Math.floor(z / this.CHUNK);
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(x + e.pos[0], y + e.pos[1], z + e.pos[2], ty, 0.7 + rand() * 0.6, rand() * 6.283);
            }
        }
        for (const list of map.values()) {
            const data = new Float32Array(list);
            const center = new THREE.Vector3();
            for (let i = 0; i < data.length; i += 6) center.x += data[i], center.y += data[i + 1], center.z += data[i + 2];
            center.multiplyScalar(6 / data.length);
            let rad = 0;
            for (let i = 0; i < data.length; i += 6) rad = Math.max(rad, Math.hypot(data[i] - center.x, data[i + 1] - center.y, data[i + 2] - center.z));
            this.chunks.push({ data, center, r: rad + 10, mesh: null });
        }
    }

    _build(ch) {
        const d = ch.data, n = d.length / 6;
        const im = new THREE.InstancedMesh(this.geo, this.mat, n);
        const cell = new Float32Array(n * 2);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < n; i++) {
            const ty = d[i * 6 + 3], sc = d[i * 6 + 4], [w, h] = GROUND_SIZE[ty];
            p.set(d[i * 6], d[i * 6 + 1], d[i * 6 + 2]);
            q.setFromAxisAngle(Y, d[i * 6 + 5]);
            s.set(w * sc, h * sc, w * sc);
            im.setMatrixAt(i, m4.compose(p, q, s));
            cell[i * 2] = GROUND_CELLS[ty][0]; cell[i * 2 + 1] = GROUND_CELLS[ty][1];
        }
        im.geometry = this.geo.clone();     // own instance attribute per patch
        im.geometry.setAttribute("aCell", new THREE.InstancedBufferAttribute(cell, 2));
        im.computeBoundingSphere();
        this.scene.add(im);
        ch.mesh = im;
    }

    finish() {
        // warm-up copy (drawn once while loading, then hidden)
        const ch = { data: new Float32Array([0, -1e5, 0, 0, 1, 0]), center: new THREE.Vector3(0, -1e5, 0), r: 1, mesh: null };
        this._build(ch);
        ch.mesh.visible = false;
    }

    update(cam, range) {
        this.range.value = range;
        for (const ch of this.chunks) {
            const d = ch.center.distanceTo(cam) - ch.r;
            if (d < range) {
                if (!ch.mesh) this._build(ch);
                ch.mesh.visible = true;
            } else if (ch.mesh) {
                ch.mesh.visible = false;
                // free patches left far behind
                if (d > range * 3) { this.scene.remove(ch.mesh); ch.mesh.geometry.dispose(); ch.mesh.dispose(); ch.mesh = null; }
            }
        }
    }
}

// ---------------------------------------------------------------------------------
// Rocks from the Blender rock kit (tools/blender/build_rocks.py): mossy boulders half
// sunk into the island tops and shards hanging from the undersides. They share the island material, so the cliff detail, strata and
// moss carry straight across. Detailed copies near the camera, light ones further out.

async function loadRockModels() {
    if (new URLSearchParams(location.search).get("trees") === "classic") return null;
    try {
        const gltf = await new GLTFLoader().loadAsync(new URL("../models/rocks.glb", import.meta.url).href);
        const out = {};
        gltf.scene.traverse((o) => {
            if (!o.isMesh) return;
            const g = o.geometry;
            for (const k of ["_GLOW", "_glow"]) if (g.attributes[k]) { g.setAttribute("glow", g.attributes[k]); g.deleteAttribute(k); }
            if (!g.attributes.glow) g.setAttribute("glow", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
            const m = o.name.match(/^(\w+?)_(hi|lo)$/);
            if (m) (out[m[1]] ??= {})[m[2]] = g;
        });
        if (!out.boulder1 || !out.shard) throw new Error("rock kit incomplete");
        return out;
    } catch (e) {
        console.warn("rock models failed, islands go without", e);
        return null;
    }
}

class Rocks {
    constructor(scene, kit, mat) {
        this.scene = scene;
        this.kit = kit;
        this.mat = mat;
        // shards hang in the shadow of the island above, which the renderer doesn't cast:
        // same rock material, with most of the direct sunlight taken away
        this.shadeMat = glowMaterial({ roughness: 0.95 }, null, false, true);
        const base = this.shadeMat.onBeforeCompile;
        this.shadeMat.onBeforeCompile = (sh, r) => {
            base.call(this.shadeMat, sh, r);
            sh.fragmentShader = sh.fragmentShader.replace("#include <lights_fragment_end>",
                "#include <lights_fragment_end>\nreflectedLight.directDiffuse *= 0.12;\nreflectedLight.directSpecular *= 0.12;");
        };
        const key = this.shadeMat.customProgramCacheKey;
        this.shadeMat.customProgramCacheKey = () => key() + "shaded";
        this.groups = [];
        this.hiRange = 700;
    }

    add(e, r) {
        if (e.kind === "bridge") return;
        const P = r.position, N = r.normal, C = r.color;
        const c = e.cell || 8;
        const rand = mulberry32((e.seed || 7) * 977 + 3);
        const lists = { boulder1: [], boulder2: [], shard: [] };
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3();
        const Y = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0), O = new THREE.Vector3(...e.pos);
        const k = e.small ? 0.6 : 1;
        // each rock takes the colour of the island where it sits (relative to the kit's
        // own rock colour), so it belongs to that cliff; boulders on grass keep their moss
        const BASE = [0.32, 0.27, 0.21];
        const tint = (v, grey) => {
            const cr = C[v * 3], cg = C[v * 3 + 1], cb = C[v * 3 + 2];
            if (grey) return new THREE.Color(0.8, 0.8, 0.8);    // the ground there is grass, not rock
            return new THREE.Color(Math.min(1.6, cr / BASE[0]), Math.min(1.6, cg / BASE[1]), Math.min(1.6, cb / BASE[2]));
        };
        for (let v = 0; v < P.length / 3; v++) {
            n.set(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
            const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
            // rocks gather in outcrops rather than spreading evenly
            const clump = Math.max(0, Math.sin(x * 0.013 + z * 0.011 + (e.seed || 0)) * Math.sin(z * 0.015 - y * 0.009));
            const area = c * c;
            if (n.y > 0.75) {
                if (rand() > (area / 2500) * clump * 2.5) continue;
                const sc = (4 + rand() * rand() * 14) * k;
                // half sunk, leaning with the slope
                p.set(x, y - sc * 0.3, z).add(O);
                q.setFromUnitVectors(Y, n.clone().lerp(Y, 0.5).normalize()).multiply(q2.setFromAxisAngle(Y, rand() * 6.28));
                s.set(sc * (0.8 + rand() * 0.4), sc * (0.7 + rand() * 0.5), sc * (0.8 + rand() * 0.4));
                lists[rand() < 0.5 ? "boulder1" : "boulder2"].push([m4.compose(p, q, s).clone(), tint(v, true)]);
            } else if (n.y < -0.45) {
                if (rand() > (area / 2600) * (0.3 + clump) * 1.5) continue;
                // a shard hanging point-down from the underside, its root buried in the rock
                const sc = (16 + rand() * rand() * 44) * k;
                p.set(x, y, z).addScaledVector(n, -sc * 0.5).add(O);
                q.setFromUnitVectors(Y, DOWN.clone().lerp(n, 0.3).normalize()).multiply(q2.setFromAxisAngle(Y, rand() * 6.28));
                s.set(sc * 1.3, sc * (1 + rand() * 0.6), sc * 1.3);
                lists.shard.push([m4.compose(p, q, s).clone(), tint(v, false)]);
            }
        }
        const g = { e, hi: [], lo: [], state: -1 };
        for (const [name, list] of Object.entries(lists)) {
            if (!list.length || !this.kit[name]) continue;
            for (const lvl of ["hi", "lo"]) {
                const im = new THREE.InstancedMesh(this.kit[name][lvl], name === "shard" ? this.shadeMat : this.mat, list.length);
                list.forEach(([m, col], j) => { im.setMatrixAt(j, m); im.setColorAt(j, col); });
                im.computeBoundingSphere();
                im.visible = false;
                this.scene.add(im);
                g[lvl].push(im);
            }
        }
        this.groups.push(g);
    }

    update(cam, range) {
        for (const g of this.groups) {
            const d = Math.hypot(g.e.pos[0] - cam.x, g.e.pos[1] - cam.y, g.e.pos[2] - cam.z) - (g.e.r || 500);
            const st = d < this.hiRange ? 0 : d < Math.min(range, 7000) ? 1 : 2;
            if (st === g.state) continue;
            g.state = st;
            for (const m of g.hi) m.visible = st === 0;
            for (const m of g.lo) m.visible = st === 1;
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
