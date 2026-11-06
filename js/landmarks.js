// The wonders and puzzle pieces: the Crown, the Worldtree, Titan's Rest, the
// Listening Stone, the Stormeye, Bellstone's bell and chime crystals, gauntlet
// rings, arch markers and thermals. Also the colliders for everything that isn't
// an SDF island.

import * as THREE from "three";
import { CROWN, GATES, CHIMES, BELL, THERMALS, entitySDF, gauntletRings } from "./world.js";
import { shared, glowMaterial, foliageMaterial, buildParts, M4, roughen, SHADER_END, UV_LEAVES, ATLAS_BROADLEAF, ATLAS_HANGING, ALIEN_FAN, ALIEN_FILAMENT, textures } from "./gfx.js";
import { mulberry32, makeNoise } from "./noise.js";

export const NOTE_COLORS = ["#ff7a6b", "#ffc15a", "#7dff9a", "#6fd8ff", "#c79bff"];

function surfaceY(e, x, z) {
    for (let y = e.h * 1.2; y > -e.h * 2; y -= 2) if (entitySDF(e, x, y, z) < 0) return e.pos[1] + y;
    return e.pos[1];
}

// An indexed tube along a polyline with a radius per point (parallel-transport frames,
// so it never twists or pinches). uv: u around, v = metres along / vScale.
// radius may be a function (i, j, angle) => r for knotted, ridged bark.
function tubeGeo(pts, radii, sides, vScale = 40) {
    const n = pts.length, pos = [], uv = [], idx = [];
    const T = pts.map((_, i) => pts[Math.min(n - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize());
    let N = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    N = N.sub(T[0].clone().multiplyScalar(N.dot(T[0]))).normalize();
    let acc = 0;
    for (let i = 0; i < n; i++) {
        if (i) {
            acc += pts[i].distanceTo(pts[i - 1]);
            N.sub(T[i].clone().multiplyScalar(N.dot(T[i]))).normalize();
        }
        const B = T[i].clone().cross(N);
        for (let j = 0; j <= sides; j++) {
            const a = (j / sides) * Math.PI * 2;
            const r = typeof radii === "function" ? radii(i, j, a) : radii[i];
            const d = N.clone().multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
            pos.push(pts[i].x + d.x * r, pts[i].y + d.y * r, pts[i].z + d.z * r);
            uv.push(j / sides, acc / vScale);
        }
        if (i) for (let j = 0; j < sides; j++) {
            const a = (i - 1) * (sides + 1) + j, b = a + sides + 1;
            idx.push(a, a + 1, b, a + 1, b + 1, b);   // outward-facing
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    // smooth normals, with the seam (where the texture wraps round) welded, so no
    // crease runs down the wood
    g.computeVertexNormals();
    const Nm = g.attributes.normal, v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
        const a = i * (sides + 1), b = a + sides;
        v.fromBufferAttribute(Nm, a).add(w.fromBufferAttribute(Nm, b)).normalize();
        Nm.setXYZ(a, v.x, v.y, v.z); Nm.setXYZ(b, v.x, v.y, v.z);
    }
    return g;
}

// A curved limb from p0 to p3 that sets off along t0 (a branch leaving its parent almost
// along the parent's own grain) and bends smoothly round to its end: one cubic Bezier,
// so its curvature changes gently all the way, with no kink anywhere. arch lifts the
// middle; wob nudges it sideways. Evenly spaced samples.
function bend(p0, t0, p3, n, arch = 0.1, wob = null, tanK = 0.38) {
    const len = p0.distanceTo(p3);
    const dir = p3.clone().sub(p0).normalize();
    const p1 = p0.clone().addScaledVector(t0, len * tanK);
    const p2 = p3.clone().addScaledVector(dir, -len * 0.32).add(new THREE.Vector3(0, len * arch, 0));
    if (wob) p2.addScaledVector(wob, len * 0.08);
    return new THREE.CubicBezierCurve3(p0, p1, p2, p3).getSpacedPoints(n - 1);
}

// A branch card (the leaves method of the tree kit, after CG Geek's video): a unit card for
// a picture of a twig with many small leaves, its stem at the origin reaching along +y,
// facing +z; cut to the twig's outline (narrow at the stem) and bent back along its length
// and cupped across with loop cuts. uv v = 0 at the stem.
const BRANCH_CARD = (() => {
    const pos = [], uv = [], idx = [];
    const W = [0.42, 0.95, 0.9];
    [0, 0.5, 1].forEach((t, r) => {
        for (const s of [-1, 0, 1]) {
            pos.push(0.5 * s * W[r], t, -0.22 * t * t - 0.05 * W[r] * Math.abs(s));
            uv.push(0.5 + 0.5 * s * W[r] * 0.98, t * 0.96);
        }
    });
    for (let r = 0; r < 2; r++) for (let j = 0; j < 2; j++) {
        const a = r * 3 + j, b = a + 3;
        idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
})();

// a smooth path through control points (centripetal Catmull-Rom), n samples
function smoothPath(ctrl, n) {
    const c = new THREE.CatmullRomCurve3(ctrl.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), false, "centripetal");
    return c.getPoints(n - 1);
}

export class Landmarks {
    constructor(scene, entities, sky) {
        this.scene = scene;
        this.sky = sky;
        this.colliders = [];
        this.byId = Object.fromEntries(entities.map((e) => [e.id, e]));
        this.time = 0;
        this._crown();
        this._worldtree();
        this._ribcage();
        this._monolith();
        this._storm();
        this._bell();
        this._rings();
        this._gates();
        this._thermals();
        this._eyeShrine();
    }

    // ---- collision ------------------------------------------------------------------
    sdf(p) {
        let d = Infinity;
        for (const c of this.colliders) {
            let v;
            if (c.t === "s") v = Math.hypot(p.x - c.c[0], p.y - c.c[1], p.z - c.c[2]) - c.r;
            else if (c.t === "c") {
                const ax = c.b[0] - c.a[0], ay = c.b[1] - c.a[1], az = c.b[2] - c.a[2];
                const px = p.x - c.a[0], py = p.y - c.a[1], pz = p.z - c.a[2];
                const h = Math.max(0, Math.min(1, (px * ax + py * ay + pz * az) / (ax * ax + ay * ay + az * az)));
                v = Math.hypot(px - ax * h, py - ay * h, pz - az * h) - c.r;
            } else if (c.t === "t") {
                const q = Math.hypot(p.x - c.c[0], p.z - c.c[2]) - c.R;
                v = Math.hypot(q, p.y - c.c[1]) - c.r;
            } else if (c.t === "dyn") v = c.fn(p);
            if (v < d) d = v;
        }
        return d;
    }

    // ---- the Crown --------------------------------------------------------------------
    _crown() {
        const g = new THREE.TorusGeometry(CROWN.radius, CROWN.tube, 28, 240);
        const n = makeNoise(5);
        const P = g.attributes.position, N = g.attributes.normal;
        for (let i = 0; i < P.count; i++) {
            const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
            const ang = Math.atan2(y, x);
            // carved teeth along the outer face, plus weathering
            const teeth = Math.pow(Math.max(0, Math.sin(ang * 48)), 6) * 10;
            const d = n.fbm(x * 0.01, y * 0.01, z * 0.01, 4) * 9 + teeth * Math.max(0, z / CROWN.tube);
            P.setXYZ(i, x + N.getX(i) * d, y + N.getY(i) * d, z + N.getZ(i) * d);
        }
        g.computeVertexNormals();
        const colors = [], glow = [];
        for (let i = 0; i < P.count; i++) {
            const z = P.getZ(i);
            const band = Math.abs(z) < 4 ? 1 : 0;
            const c = 0.42 + n.noise3(P.getX(i) * 0.02, P.getY(i) * 0.02, z * 0.05) * 0.06;
            colors.push(c * c * 1.1, c * c, c * c * 0.95);
            glow.push(band);
        }
        g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        g.setAttribute("glow", new THREE.Float32BufferAttribute(glow, 1));
        this.crownMat = glowMaterial({ roughness: 0.85 }, "#ffcf6a", false, true);
        this.crownGlow = { value: 0 };
        const cm = this.crownMat;
        const base = cm.onBeforeCompile;
        cm.onBeforeCompile = (sh) => {
            base(sh);
            sh.uniforms.uCrown = this.crownGlow;
            sh.fragmentShader = sh.fragmentShader
                .replace("uniform float uGlow;", "uniform float uGlow; uniform float uCrown;")
                .replace("(0.01 + uGlow * uGlow * 2.6)", "(0.05 + uCrown * 3.0)");
        };
        cm.customProgramCacheKey = () => "crown";
        const ring = new THREE.Mesh(g, cm);
        ring.rotation.x = Math.PI / 2;
        this.crown = new THREE.Group();
        this.crown.position.set(...CROWN.pos);
        this.crown.add(ring);

        // standing stones around the rim, and spires hanging beneath
        const rand0 = mulberry32(21);
        const teeth = [];
        for (let k = 0; k < 36; k++) {
            const a = (k / 36) * Math.PI * 2;
            const tall = (k % 9 === 0 ? 260 : k % 3 === 0 ? 170 : 90) * (0.85 + rand0() * 0.3);
            const w = k % 9 === 0 ? 34 : 22;
            teeth.push({ geo: new THREE.ConeGeometry(w, tall, 5, 1), matrix: M4([Math.cos(a) * CROWN.radius, CROWN.tube * 0.6 + tall / 2, Math.sin(a) * CROWN.radius], [0, -a, 0]), color: "#8d8577", shade: (x, y) => 0.75 + y / tall * 0.4 });
            if (k % 3 === 0) {
                const cx = CROWN.pos[0] + Math.cos(a) * CROWN.radius, cz = CROWN.pos[2] + Math.sin(a) * CROWN.radius;
                this.colliders.push({ t: "c", a: [cx, CROWN.pos[1], cz], b: [cx, CROWN.pos[1] + CROWN.tube * 0.6 + tall * 0.8, cz], r: w * 0.7 });
            }
            if (k % 2 === 0) {
                const hang = 120 + rand0() * 240;
                teeth.push({ geo: new THREE.ConeGeometry(18, hang, 5, 1), matrix: M4([Math.cos(a) * CROWN.radius, -CROWN.tube * 0.6 - hang / 2, Math.sin(a) * CROWN.radius], [Math.PI, a, 0]), color: "#6d665c" });
            }
        }
        const teethMesh = new THREE.Mesh(buildParts(teeth), glowMaterial({ roughness: 0.85 }, null, false, true));
        this.crown.add(teethMesh);

        // four key sockets
        this.sockets = [];
        for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2;
            const m = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.3, emissive: 0x000000 }));
            m.scale.set(26, 52, 26);
            m.position.set(Math.cos(a) * CROWN.radius, CROWN.tube + 330, Math.sin(a) * CROWN.radius);
            this.crown.add(m);
            this.sockets.push(m);
        }
        this.scene.add(this.crown);
        this.colliders.push({ t: "t", c: CROWN.pos, R: CROWN.radius, r: CROWN.tube + 12 });
        for (const s of this.sockets) this.colliders.push({ t: "s", c: [s.position.x + CROWN.pos[0], s.position.y + CROWN.pos[1], s.position.z + CROWN.pos[2]], r: 30 });
        // ring of cloud around it
        const rand = mulberry32(12);
        for (let i = 0; i < 40; i++) {
            const a = rand() * 6.28, r = CROWN.radius + 300 + rand() * 600;
            this.sky.addCloud([Math.cos(a) * r, CROWN.pos[1] - 250 + rand() * 200, Math.sin(a) * r], 300 + rand() * 300, 0.55);
        }

        // the beam that rises from the Heartspire once all four keys are found
        const hs = this.byId.heartspire;
        const baseY = surfaceY(hs, 0, 0);
        const h = CROWN.pos[1] - baseY;
        const beamGeo = new THREE.CylinderGeometry(60, 90, h, 40, 1, true).translate(0, h / 2, 0);
        this.beamU = { uTime: shared.uTime, uOn: { value: 0 } };
        this.beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
            uniforms: this.beamU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
            vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
            fragmentShader: `uniform float uTime, uOn; varying vec2 vUv;
                void main(){ float s = 0.55 + 0.45*sin(vUv.y*80. - uTime*6.) ; float edge = sin(vUv.x*3.14159*2.)*0.5+0.5;
                float a = uOn * (0.25 + 0.35*s) * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
                gl_FragColor = vec4(vec3(1.0, 0.85, 0.55) * 1.6, a * (0.6 + 0.4*edge)); ${SHADER_END} }`,
        }));
        this.beam.position.set(0, baseY, 0);
        this.beam.visible = false;
        this.scene.add(this.beam);
    }

    setKeys(keys, awake) {
        const n = keys.length;
        this.sockets.forEach((s, i) => {
            const on = i < n;
            s.material.color.set(on ? 0xffd27a : 0x555555);
            s.material.emissive.set(on ? 0xffa23a : 0x000000);
            s.material.emissiveIntensity = on ? 2.2 : 0;
        });
        this.targetCrown = awake ? 1.6 : n / 4 * 0.6;
        this.beam.visible = n >= 4;
        this.beamU.uOn.value = n >= 4 ? (awake ? 0.5 : 1) : 0;
    }

    // ---- the Worldtree ----------------------------------------------------------------
    // A braided giant: six stems twist round each other into one column, then part into
    // sweeping limbs that carry vast flat shelves of moon-silver sword-leaves (the
    // otherworldly atlas) far past the island's rim, violet underneath. From the rim of
    // every shelf, curtains of beaded filaments fall hundreds of metres into the open sky,
    // and the roots crawl over the edge and hang down after them. A cluster of seed-hearts
    // crowns the leader. By night the filaments, the shelves' undersides, the seed-hearts
    // and the veins in the bark glow, and lantern-fruit hang under every shelf.
    _worldtree() {
        const e = this.byId.verdance;
        const top = surfaceY(e, 0, 0);
        const base = new THREE.Vector3(e.pos[0], top - 25, e.pos[2]);
        const rand = mulberry32(77);
        const noise = makeNoise(77);
        const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
        const H = 1150;                // where the braid parts into limbs
        const S = 6;                  // stems in the braid
        const TWIST = Math.PI * 2 * 0.85;
        const bark = [], leaves = [], pads = [], fruit = [];
        const toWorld = (p) => [base.x + p.x, base.y + p.y, base.z + p.z];
        const capsule = (a, b, r) => this.colliders.push({ t: "c", a: toWorld(a), b: toWorld(b), r });

        // bark: pale ash above, darkening into the roots; cyan veins spiral up the braid
        const barkShade = (x, y) => 0.5 + 0.5 * THREE.MathUtils.smoothstep(y, -200, 900);
        const veinGlow = (x, y, z) => {
            const s = Math.sin(Math.atan2(z, x) * 9 + y * 0.011 + noise.noise3(x * 0.01, y * 0.004, z * 0.01) * 2.5);
            return s > 0.965 ? 0.85 : y < -60 ? Math.max(0, (-y - 300) / 900) * 0.9 : 0;   // root tips glow too
        };
        const ridged = (pts, r0, r1, swell = 0) => (i, j, a) => {
            const t = i / (pts.length - 1);
            const r = THREE.MathUtils.lerp(r0, r1, Math.pow(t, 0.8)) + swell * Math.pow(1 - t, 5);
            const p = pts[i];
            return r * (1 + 0.1 * Math.sin(a * 5 + t * 9) + 0.08 * noise.noise3(p.x * 0.02 + a, p.y * 0.02, p.z * 0.02));
        };
        // collar: { a: parent axis point, d: parent direction, r: parent radius } bends this
        // tube's normals into the parent's where it grows out of it, so the join is seamless
        const addTube = (pts, radius, sides, color, collar = null) => bark.push({ geo: tubeGeo(pts, radius, sides, 60), color, shade: barkShade, glow: veinGlow, collar, keepNormals: true });
        // the heading a branch sets off on: mostly along its parent's grain, turning toward
        // where it is going, so it slips out of the parent in a long smooth curve
        const setOff = (d, dir, k = 0.75) => d.clone().multiplyScalar(k).add(dir).add(new THREE.Vector3(0, 0.15, 0)).normalize();
        // a radius function that swells into a collar at the start (hidden in the parent)
        const collared = (pts, r0, r1, rp) => {
            const base = ridged(pts, r0, r1);
            const extra = Math.max(0, Math.min(rp * 0.9, r0 * 1.9) - r0);
            const n = pts.length - 1;
            return (i, j, a) => base(i, j, a) + extra * Math.pow(Math.max(0, 1 - i / Math.max(2, n * 0.3)), 2);
        };

        // ---- the braid ----
        const stemTops = [];
        for (let s = 0; s < S; s++) {
            const ph = (s / S) * Math.PI * 2;
            const pts = [];
            for (let k = 0; k <= 56; k++) {
                const t = k / 56;
                const rax = 66 + 200 * Math.pow(1 - t, 3) + 150 * THREE.MathUtils.smoothstep(t, 0.72, 1.0);
                const a = ph + t * TWIST;
                pts.push(V3(Math.cos(a) * rax, t * H, Math.sin(a) * rax));
            }
            stemTops.push({ pts, p: pts[pts.length - 1], a: ph + TWIST, ph });
        }
        capsule(V3(0, 0, 0), V3(0, H, 0), 185);

        // a leader rising from the heart of the braid to the topmost tier
        const leader = smoothPath([[0, H * 0.6, 0], [25, H + 150, -12], [-35, H + 420, 30], [0, H + 600, 0], [8, H + 690, -4]], 56);
        addTube(leader, ridged(leader, 72, 2), 20, "#d6cebf");
        const leaderR = (i) => THREE.MathUtils.lerp(72, 2, Math.pow(i / (leader.length - 1), 0.8));
        const dirAt = (pts, i) => pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
        capsule(leader[0], leader[leader.length - 1], 50);

        // ---- limbs, forks and the tiers of foliage they carry ----
        const padAt = (c, R, tier) => pads.push({ c, R, tier });
        const skel = [];    // limb points the crown's branches can grow from: { p, r, d }
        leader.forEach((q, i) => { if (q.y > H + 200 && leaderR(i) > 9) skel.push({ p: q, r: leaderR(i), d: dirAt(leader, i) }); });
        for (const st of stemTops) {
            const out = V3(Math.cos(st.a), 0, Math.sin(st.a));
            const side = V3(-out.z, 0, out.x);
            const reach = 820 + rand() * 320, lift = 180 + rand() * 200;
            const p0 = st.p;
            // the stem and its limb are one piece of wood: a single smooth path from the
            // root flare, up through the braid, bending out along the limb to its tip
            const ctrl = st.pts.filter((_, k) => k % 4 === 0 && k <= 48);
            ctrl.push(p0, p0.clone().addScaledVector(out, reach * 0.3).add(V3(0, lift * 0.9, 0)),
                p0.clone().addScaledVector(out, reach * 0.65).add(V3(0, lift * 1.15, 0)).addScaledVector(side, (rand() - 0.5) * 120),
                p0.clone().addScaledVector(out, reach).add(V3(0, lift * 0.85, 0)).addScaledVector(side, (rand() - 0.5) * 160));
            const full = smoothPath(ctrl, 170);
            const acc = [0];
            for (let i = 1; i < full.length; i++) acc.push(acc[i - 1] + full[i].distanceTo(full[i - 1]));
            const total = acc[acc.length - 1];
            let iStart = full.findIndex((q) => q.y >= p0.y - 1);
            if (iStart < 0) iStart = Math.round(full.length * 0.55);
            const s0 = acc[iStart] / total;
            addTube(full, (i, j, a) => {
                const sN = acc[i] / total, q = full[i];
                const r = sN < s0
                    ? THREE.MathUtils.lerp(95, 58, Math.pow(sN / s0, 0.8)) + 50 * Math.pow(1 - sN / s0, 5)
                    : THREE.MathUtils.lerp(58, 2.5, Math.pow((sN - s0) / (1 - s0), 0.85));
                return r * (1 + 0.1 * Math.sin(a * 5 + sN * 20) + 0.08 * noise.noise3(q.x * 0.02 + a, q.y * 0.02, q.z * 0.02));
            }, 22, "#b8ab97");
            const lp = full.slice(iStart);
            const limb = Array.from({ length: 26 }, (_, k) => lp[Math.round((k * (lp.length - 1)) / 25)]);
            capsule(limb[0], limb[13], 48);
            capsule(limb[13], limb[25], 22);
            limb.forEach((q, k) => { const r = THREE.MathUtils.lerp(58, 2.5, Math.pow(k / 25, 0.85)); if (k >= 7 && r > 7) skel.push({ p: q, r, d: dirAt(limb, k) }); });
            padAt(limb[25].clone().add(V3(0, 50, 0)), 330 + rand() * 80, 0);
            padAt(limb[15].clone().add(V3(0, 110, 0)), 310 + rand() * 70, 1);
            padAt(limb[9].clone().add(V3(0, 150, 0)), 260 + rand() * 60, 2);
            // two forks sweeping off to either side
            for (const sgn of [-1, 1]) {
                const i0 = sgn < 0 ? 9 : 16, q0 = limb[i0];
                const fd = out.clone().multiplyScalar(0.55).addScaledVector(side, sgn * 0.85).normalize();
                const L = 380 + rand() * 220;
                // a fork peels away from the limb at a shallow angle, its base flared into a
                // collar that starts inside the limb, so there is no seam where they meet
                const along = limb[i0 + 1].clone().sub(limb[i0 - 1]).normalize();
                const f0 = limb[i0 - 1], fr = THREE.MathUtils.lerp(58, 2.5, Math.pow((i0 - 1) / 25, 0.85));
                const fork = bend(f0, setOff(along, fd, 1.1), q0.clone().addScaledVector(fd, L).add(V3(0, 60 + rand() * 80, 0)), 40, 0.16);
                addTube(fork, collared(fork, Math.min(26, fr * 0.62), 1.5, fr), 14, "#bdb09c", { a: f0, d: along, r: fr });
                capsule(fork[0], fork[fork.length - 1], 16);
                fork.forEach((q, k) => { const r = THREE.MathUtils.lerp(26, 1.5, Math.pow(k / (fork.length - 1), 0.8)); if (k >= 8 && r > 6) skel.push({ p: q, r, d: dirAt(fork, k) }); });
                padAt(fork[fork.length - 1].clone().add(V3(0, 55, 0)), 280 + rand() * 70, 2);
            }
        }
        padAt(leader[leader.length - 1].clone().add(V3(0, 40, 0)), 300, 0);
        padAt(V3(0, H + 330, 0), 440, 1);

        // ---- roots: over the rim and down into the sky ----
        const rimAt = (a) => {
            let last = 0;
            for (let d = 60; d < e.r * 1.6; d += 12) {
                const x = Math.cos(a) * d, z = Math.sin(a) * d;
                let solid = false;
                for (let y = e.h * 1.2; y > -e.h * 0.6; y -= 6) if (entitySDF(e, x, y, z) < 0) { solid = true; break; }
                if (!solid) break;
                last = d;
            }
            return last;
        };
        const local = (wy) => wy - base.y;
        for (let s = 0; s < S * 3; s++) {
            const main = s % 3 === 0;
            const a = (Math.floor(s / 3) / S) * Math.PI * 2 + (main ? 0 : (s % 3 === 1 ? -0.38 : 0.38)) + (rand() - 0.5) * 0.15;
            const rim = rimAt(a);
            if (rim < 150) continue;
            const ctrl = [];
            const d0 = main ? 150 : 210;
            for (const f of [0, 0.3, 0.6, 0.85, 1.0]) {
                const d = d0 + (rim - d0) * f;
                const x = Math.cos(a) * d, z = Math.sin(a) * d;
                ctrl.push(V3(x, local(surfaceY(e, x, z)) + (main ? 14 : 6) - f * 4 + (f === 0 ? 30 : 0), z));
            }
            const lip = ctrl[ctrl.length - 1];
            const ox = Math.cos(a), oz = Math.sin(a);
            const drop = (main ? 650 : 380) + rand() * 420;
            const sway = (rand() - 0.5) * 2;
            ctrl.push(V3(lip.x + ox * 40, lip.y - 60, lip.z + oz * 40));
            ctrl.push(V3(lip.x + ox * 70 + sway * 30, lip.y - drop * 0.35, lip.z + oz * 70 - sway * 20));
            ctrl.push(V3(lip.x + ox * 60 + sway * 70, lip.y - drop * 0.7, lip.z + oz * 60 + sway * 40));
            ctrl.push(V3(lip.x + ox * 45 + sway * 50, lip.y - drop, lip.z + oz * 45 + sway * 70));
            const root = smoothPath(ctrl, main ? 72 : 54);
            addTube(root, ridged(root, main ? 48 : 26, 0.6, main ? 30 : 16), main ? 16 : 11, "#7a6a58");
            // a few thin rootlets trailing from the hanging part
            for (let k = 0; k < (main ? 3 : 1); k++) {
                const q = root[Math.floor(root.length * (0.55 + rand() * 0.3))];
                const L = 120 + rand() * 260;
                const rd = dirAt(root, root.indexOf(q));
                const rl = bend(q, setOff(rd, V3(0, -1, 0), 1.0), q.clone().add(V3((rand() - 0.5) * 90, -L, (rand() - 0.5) * 90)), 22, 0.0, V3(rand() - 0.5, 0, rand() - 0.5));
                const rr0 = 7, rootR = THREE.MathUtils.lerp(main ? 48 : 26, 0.6, Math.pow(root.indexOf(q) / (root.length - 1), 0.8));
                addTube(rl, collared(rl, rr0, 0.3, rootR), 8, "#7a6a58", { a: q, d: rd, r: rootR });
            }
        }

        // ---- the crown ----
        // Each foliage mass is grown, not stamped: a spray of branches leaves the nearest
        // limbs and fans out through the mass, and clumps of crossed leaf cards sit along
        // their outer half, so the crown is airy, with sky and branches showing through.
        // Pale silver-jade on top, deep teal underneath; the undersides glow at night.
        const top0 = new THREE.Color("#f2fbff"), bot0 = new THREE.Color("#4a3d96"), mist = new THREE.Color("#ffd0ec");
        const tmpC = new THREE.Color();
        const rq = () => { const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u); return V3(Math.cos(a) * r, u, Math.sin(a) * r); };
        this.tendrilSpots = [];
        for (const pd of pads) {
            const { c, R } = pd;
            const thick = R * 0.16;      // shelves: wide and flat-topped, not round puffs
            this.colliders.push({ t: "s", c: toWorld(c), r: R * 0.3 });
            const near = skel.filter((q) => q.p.distanceTo(c) < R * 1.2);
            if (!near.length) near.push(skel.reduce((b, q) => (q.p.distanceTo(c) < b.p.distanceTo(c) ? q : b), skel[0]));
            const nb = Math.round(R / 13);
            const hold = [];     // points on this shelf's wood that things can hang from: { p, r }
            for (let k = 0; k < nb; k++) {
                const st = near[Math.floor(rand() * near.length)], start = st.p;
                const a = rand() * Math.PI * 2, rr = Math.sqrt(0.15 + 0.85 * rand()) * R * 0.95;
                const end = V3(c.x + Math.cos(a) * rr, c.y + (rand() - 0.25) * thick * 1.2, c.z + Math.sin(a) * rr);
                const len = start.distanceTo(end);
                const dir = end.clone().sub(start).normalize();
                // a branch starts on its parent's axis, slips out along the parent's grain in
                // one long smooth curve and is never thicker than about two thirds of what it
                // grows from
                const br = bend(start, setOff(st.d, dir), end, 22, 0.08 + rand() * 0.06, rq());
                const r0 = Math.min(11, 3 + len * 0.025, st.r * 0.62);
                addTube(br, collared(br, r0, 1.0, st.r), 8, "#cdc1ad", { a: start, d: st.d, r: st.r });
                br.forEach((q, i) => { if (i >= 7) hold.push({ p: q, r: THREE.MathUtils.lerp(r0, 1.0, Math.pow(i / (br.length - 1), 0.8)) }); });
                // leaf clumps along the outer part of the branch, wrapped round it
                const nClumps = Math.max(3, Math.round(len * 0.65 / 19));
                for (let j = 0; j < nClumps; j++) {
                    const t = 0.35 + 0.65 * (j + rand() * 0.6) / nClumps;
                    const i = Math.min(br.length - 1, Math.round(t * (br.length - 1)));
                    const q = br[i].clone();
                    const h = THREE.MathUtils.clamp((q.y - (c.y - thick)) / (2 * thick), 0, 1);
                    tmpC.copy(bot0).lerp(top0, Math.pow(h, 0.8));
                    tmpC.multiplyScalar(0.88 + rand() * 0.24);
                    if (rand() < 0.12) tmpC.lerp(mist, 0.6);   // a few rose-silver clumps
                    const hex = "#" + tmpC.getHexString();
                    const glow = (1 - h) * 0.4 + (rand() < 0.05 ? 0.45 : 0);
                    const out = q.clone().sub(c).divideScalar(R).add(V3(0, 1.3, 0));
                    // branch cards (a twig of many small leaves): stem on the branch, reaching
                    // out at a random heading and tilt, facing broadly up and out
                    // (smaller cards, twice as many: finer leaves, each with its own stem and
                    // rhythm so it moves on its own in the wind and the dragon's air)
                    for (let n = 0; n < 9 + (rand() < 0.5 ? 1 : 0); n++) {
                        const face = rq().multiplyScalar(0.5).addScaledVector(out.clone().normalize(), 1).normalize();
                        const reach = rq().multiply(V3(1, 0.5, 1)).addScaledVector(out.clone().setY(0).normalize(), 0.7).normalize();
                        const right = reach.clone().cross(face).normalize();
                        const nf = right.clone().cross(reach).normalize();
                        const sz = 20 + rand() * 14;
                        const at = q.clone().addScaledVector(rq(), 3);
                        leaves.push({
                            geo: BRANCH_CARD, uvRect: ALIEN_FAN, normalFrom: [c.x, c.y - thick * 1.6, c.z],
                            matrix: new THREE.Matrix4().makeBasis(right, reach, nf).scale(V3(sz, sz, sz)).setPosition(at), color: hex, glow,
                            stem: [at.x, at.y, at.z], phase: rand(),
                        });
                    }
                }
            }
            // the curtains: beaded filaments falling from the rim of the shelf, longest on
            // the outermost shelves (tier 0), so the crown trails veils into the sky
            const nFr = Math.round(R * 0.04);
            const rimWood = hold.filter((h) => Math.hypot(h.p.x - c.x, h.p.z - c.z) > R * 0.55);
            const pool = rimWood.length ? rimWood : hold;
            // the wood point nearest a wanted spot round the shelf, so curtains stay spread out
            const woodNear = (x, z) => pool.reduce((b, h) => (Math.hypot(h.p.x - x, h.p.z - z) < Math.hypot(b.p.x - x, b.p.z - z) ? h : b), pool[0]);
            const hangFrom = (h) => h.p.clone().add(V3(0, -h.r * 0.7, 0));
            for (let k = 0; k < nFr; k++) {
                const a = (k / nFr) * Math.PI * 2 + rand() * 0.2, rr = R * (0.72 + rand() * 0.26);
                const p = hangFrom(woodNear(c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr));
                const len = (pd.tier === 0 ? 160 : 90) + rand() * (pd.tier === 0 ? 300 : 160);
                const q = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), -a + Math.PI / 2 + (rand() - 0.5) * 0.6);
                const tint = tmpC.set(rand() < 0.3 ? "#f3d6ff" : rand() < 0.5 ? "#d4f6ff" : "#e8fff6");
                leaves.push({
                    geo: new THREE.PlaneGeometry(len * 0.3, len, 1, 4).translate(0, -len / 2, 0), uvRect: ALIEN_FILAMENT,
                    normalFrom: [c.x, c.y + thick, c.z], matrix: new THREE.Matrix4().compose(p, q, V3(1, 1, 1)),
                    color: "#" + tint.getHexString(), glow: (x, y) => 0.15 + THREE.MathUtils.clamp((p.y - y) / len, 0, 1) * 0.85,
                    stem: [p.x, p.y, p.z], phase: rand(),
                });
            }
            // lantern-fruit and glowing tendrils under the tier
            // (each entry is the point on the wood its thread hangs from)
            for (let k = 0; k < Math.round(R / 22); k++) {
                const h = hold[Math.floor(rand() * hold.length)];
                const p = hangFrom(h);
                fruit.push([p.x, p.y, p.z, 2.5 + rand() * 3]);
            }
            // the veils: a thousand-odd glowing strands, thickest round the rim of each shelf,
            // longest under the outer shelves, so the whole crown trails curtains into the sky
            for (let k = 0; k < Math.round(R / 9); k++) {
                const a = rand() * Math.PI * 2, rr = Math.pow(rand(), 0.35) * R * 0.95;
                const L = ((pd.tier === 0 ? 260 : pd.tier === 1 ? 170 : 110) + rand() * (pd.tier === 0 ? 720 : 420)) * (0.3 + 0.7 * rr / R);
                const p = hangFrom(rr > R * 0.55 ? woodNear(c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr) : hold[Math.floor(rand() * hold.length)]);
                this.tendrilSpots.push([p.x, p.y + 0.5, p.z, L]);
            }
        }

        // seed-hearts: great glowing teardrops clustered round the top of the leader
        // each on its own stalk that grows out of the leader and arches over, the heart
        // hanging from the stalk's tip
        const hearts = [];
        for (let k = 0; k < 9; k++) {
            const a = (k / 9) * Math.PI * 2 + rand() * 0.4, rr = 40 + rand() * 50;
            const i0 = leader.length - 4 - Math.floor(rand() * 4);
            const s0 = leader[i0], sr = leaderR(i0), sd = dirAt(leader, i0);
            const out = V3(Math.cos(a), 0, Math.sin(a));
            const up = 40 + rand() * 50;
            const tip = s0.clone().addScaledVector(out, rr).add(V3(0, up - 10, 0));
            const stalk = bend(s0, setOff(sd, out.clone().add(V3(0, 0.6, 0)).normalize(), 1.0), tip, 26, 0.35);
            addTube(stalk, collared(stalk, Math.min(7, sr * 0.6), 1.6, sr), 10, "#d6cebf", { a: s0, d: sd, r: sr });
            hearts.push([tip.x, tip.y - 1.2, tip.z, 9 + rand() * 9]);
        }
        const tree = new THREE.Mesh(buildParts(bark), glowMaterial({ roughness: 0.85 }, "#7fe8ff", false, "bark"));
        tree.position.copy(base);
        this.scene.add(tree);
        const crownMat = foliageMaterial("#8ff3ff", textures().alien, 1.45, 0.12, true);
        crownMat.userData.cards = true;   // every leaf card swings on its own stem (gfx.js addWind)
        const crown = new THREE.Mesh(buildParts(leaves), crownMat);
        crown.position.copy(base);
        this.scene.add(crown);
        // glowing tendrils (the reason to come back at night)
        const tg = buildParts([{ geo: new THREE.CylinderGeometry(0.6, 0.15, 1, 8, 5).translate(0, -0.5, 0), color: "#cdd2ff", glow: (x, y) => 0.25 - y * 0.75 }]);
        const im = new THREE.InstancedMesh(tg, glowMaterial({ roughness: 0.8 }, "#c39bff"), this.tendrilSpots.length);
        const m4 = new THREE.Matrix4();
        this.tendrilSpots.forEach((t, i) => im.setMatrixAt(i, m4.compose(V3(t[0], t[1], t[2]), new THREE.Quaternion(), V3(1.4 + (i % 3) * 0.5, t[3], 1.4 + (i % 3) * 0.5))));
        im.position.copy(base);
        im.computeBoundingSphere();
        this.scene.add(im);
        // lantern-fruit: teardrops on a thread
        // (the instance origin is the top of the thread, where it is tied to the wood)
        const drop = (thread) => buildParts([
            { geo: new THREE.SphereGeometry(1, 10, 8), matrix: M4([0, -thread - 1.3, 0], [0, 0, 0], [1, 1.4, 1]), color: "#ffe9b8", glow: 1.2 },
            { geo: new THREE.CylinderGeometry(0.06, 0.06, thread + 0.2, 6).translate(0, -thread / 2, 0), color: "#6a8f9a", glow: 0.1 },
        ]);
        const fruitMat = glowMaterial({ roughness: 0.4 }, "#ffd89a");
        for (const [list, geo] of [[fruit, drop(6)], [hearts, drop(0.8)]]) {
            const fm = new THREE.InstancedMesh(geo, fruitMat, list.length);
            list.forEach((f, i) => fm.setMatrixAt(i, m4.compose(V3(f[0], f[1], f[2]), new THREE.Quaternion(), V3(f[3], f[3], f[3]))));
            fm.position.copy(base);
            fm.computeBoundingSphere();
            this.scene.add(fm);
        }
        this.treeTop = base.clone().add(V3(0, H + 380, 0));
    }

    // ---- Titan's Rest: the bones of a giant whale ---------------------------------------
    _ribcage() {
        const C = new THREE.Vector3(-6200, 3000, 3600);
        const parts = [];
        const bone = "#d9cfb6";
        const shade = (x, y, z) => 0.8 + 0.2 * Math.sin(x * 0.05 + z * 0.07);
        const spine = [];
        for (let i = 0; i <= 40; i++) {
            const t = i / 40;
            spine.push(new THREE.Vector3(-650 + t * 1300, Math.sin(t * Math.PI) * 70 - t * 40, Math.sin(t * 5) * 20));
        }
        spine.forEach((p, i) => {
            const t = i / 40;
            const r = 10 + Math.sin(t * Math.PI) * 14;
            parts.push({ geo: new THREE.IcosahedronGeometry(r, 1), matrix: M4([p.x, p.y, p.z], [0, 0, 0], [1.3, 1, 1]), color: bone, shade });
            parts.push({ geo: new THREE.ConeGeometry(r * 0.35, r * 2.6, 5), matrix: M4([p.x, p.y + r * 1.5, p.z]), color: bone, shade });
            this.colliders.push({ t: "s", c: [C.x + p.x, C.y + p.y, C.z + p.z], r: r + 4 });
        });
        const RIBS = 12;
        for (let i = 0; i < RIBS; i++) {
            const t = (i + 1) / (RIBS + 1);
            const sp = spine[Math.round(4 + t * 24)];
            const s = 60 + 210 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.7);
            for (const side of [-1, 1]) {
                const pts = [];
                for (let k = 0; k <= 12; k++) {
                    const ph = (k / 12) * Math.PI * 0.86;
                    pts.push(new THREE.Vector3(sp.x - Math.sin(ph) * 25, sp.y - s * (1 - Math.cos(ph)) * 0.95, sp.z + side * s * Math.sin(ph) * 0.9));
                }
                const curve = new THREE.CatmullRomCurve3(pts);
                parts.push({ geo: new THREE.TubeGeometry(curve, 26, 7 + s * 0.02, 6, false), color: bone, shade });
                for (let k = 0; k <= 10; k++) {
                    const q = curve.getPoint(k / 10);
                    this.colliders.push({ t: "s", c: [C.x + q.x, C.y + q.y, C.z + q.z], r: 10 + s * 0.02 });
                }
            }
        }
        // skull
        const skull = roughen(new THREE.IcosahedronGeometry(1, 3), 0.08, 2.5, 4);
        parts.push({ geo: skull, matrix: M4([760, 30, 0], [0, 0, -0.1], [190, 75, 95]), color: bone, shade });
        parts.push({ geo: new THREE.IcosahedronGeometry(1, 2), matrix: M4([760, -60, 0], [0, 0, -0.25], [175, 18, 70]), color: "#cbbf9f" });
        this.colliders.push({ t: "c", a: [C.x + 620, C.y + 25, C.z], b: [C.x + 900, C.y + 5, C.z], r: 70 });
        const mesh = new THREE.Mesh(buildParts(parts), glowMaterial({ roughness: 0.75 }, null, false, true));
        mesh.position.copy(C);
        this.scene.add(mesh);
        this.ribs = mesh;
        // drifting rocks and mist around the bones
        const rand = mulberry32(55);
        for (let i = 0; i < 26; i++) this.sky.addCloud([C.x + (rand() - 0.5) * 1800, C.y - 200 + rand() * 300, C.z + (rand() - 0.5) * 1200], 200 + rand() * 260, 0.45);
    }

    // ---- the Listening Stone -----------------------------------------------------------
    _monolith() {
        const C = new THREE.Vector3(2600, 3700, -6600);
        const cv = document.createElement("canvas");
        cv.width = 256; cv.height = 768;
        const g = cv.getContext("2d");
        g.fillStyle = "#000"; g.fillRect(0, 0, 256, 768);
        g.strokeStyle = "#fff"; g.lineWidth = 5; g.lineCap = "round";
        const rand = mulberry32(3);
        for (let row = 0; row < 14; row++) {
            for (let col = 0; col < 3; col++) {
                const x = 40 + col * 80, y = 50 + row * 50;
                g.beginPath();
                const strokes = 2 + Math.floor(rand() * 3);
                for (let s = 0; s < strokes; s++) {
                    const ax = x + (rand() - 0.5) * 40, ay = y + (rand() - 0.5) * 30;
                    g.moveTo(ax, ay);
                    if (rand() < 0.5) g.lineTo(ax + (rand() - 0.5) * 40, ay + (rand() - 0.5) * 30);
                    else g.arc(ax, ay, 6 + rand() * 10, rand() * 6, rand() * 6 + 3);
                }
                g.stroke();
            }
        }
        const runes = new THREE.CanvasTexture(cv);
        const mat = new THREE.MeshStandardMaterial({ color: 0x15161c, roughness: 0.35, metalness: 0.5, emissive: 0x58e6ff, emissiveMap: runes, emissiveIntensity: 1.5 });
        this.monolith = new THREE.Group();
        this.monolith.position.copy(C);
        const slab = new THREE.Mesh(new THREE.BoxGeometry(170, 560, 60), mat);
        this.monolith.add(slab);
        this.monoMat = mat;
        this.shards = [];
        for (let i = 0; i < 14; i++) {
            const s = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
            const sc = 8 + rand() * 22;
            s.scale.set(sc, sc * (1.5 + rand() * 2), sc * 0.5);
            s.userData = { r: 170 + rand() * 160, y: (rand() - 0.5) * 500, a: rand() * 6.28, sp: (0.05 + rand() * 0.1) * (rand() < 0.5 ? -1 : 1) };
            this.monolith.add(s);
            this.shards.push(s);
        }
        this.scene.add(this.monolith);
        this.colliders.push({ t: "c", a: [C.x, C.y - 270, C.z], b: [C.x, C.y + 270, C.z], r: 92 });
    }

    // ---- the Stormeye --------------------------------------------------------------------
    _storm() {
        this.stormC = new THREE.Vector3(9600, 2600, 6600);
        const rand = mulberry32(909);
        const list = [];
        for (let i = 0; i < 700; i++) {
            const a = rand() * 6.28;
            const r = 1300 + rand() * 1200;
            const y = (rand() - 0.5) * 2600 * (1 - Math.abs(r - 1900) / 1500);
            list.push({ p: [Math.cos(a) * r, y, Math.sin(a) * r], s: 380 + rand() * 520, a: 0.85, tint: 0.65 + rand() * 0.35 });
        }
        // the anvil spreading out over the top
        for (let i = 0; i < 120; i++) {
            const a = rand() * 6.28, r = 1000 + rand() * 2200;
            list.push({ p: [Math.cos(a) * r, 1250 + rand() * 300, Math.sin(a) * r], s: 600 + rand() * 600, a: 0.7, tint: 0.5 });
        }
        // a wall of cloud below the eye, so it reads as a funnel
        for (let i = 0; i < 70; i++) {
            const a = rand() * 6.28, r = rand() * 1500;
            list.push({ p: [Math.cos(a) * r, -1100 - rand() * 600, Math.sin(a) * r], s: 500 + rand() * 500, a: 0.8, tint: 0.7 });
        }
        this.stormGroup = new THREE.Group();
        this.stormGroup.position.copy(this.stormC);
        this.scene.add(this.stormGroup);
        this.stormFlash = { value: 0 };
        this.stormLayer = this.sky.makeLayer(list, this.stormGroup, this.stormFlash);
        this.bolt = null;
        this.boltTimer = 2;
        this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4.5, 6), toneMapped: false, transparent: true });
    }

    _boltStrike() {
        const rand = Math.random;
        const a = rand() * 6.28, r = 1400 + rand() * 800;
        let p = new THREE.Vector3(Math.cos(a) * r, 700, Math.sin(a) * r);
        const pts = [p.clone()];
        for (let i = 0; i < 14; i++) {
            p = p.clone().add(new THREE.Vector3((rand() - 0.5) * 140, -100 - rand() * 60, (rand() - 0.5) * 140));
            pts.push(p);
        }
        if (this.bolt) { this.stormGroup.remove(this.bolt); this.bolt.geometry.dispose(); }
        this.bolt = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.1), 60, 3.5, 4, false), this.boltMat);
        this.stormGroup.add(this.bolt);
        this.boltLife = 0.35;
        this.stormFlash.value = 1;
        return this.stormGroup.localToWorld(pts[3].clone());
    }

    _eyeShrine() {
        // A floating crystal in the calm at the heart of the storm
        const c = this.stormC;
        const parts = [];
        const rand = mulberry32(4);
        for (let i = 0; i < 9; i++) {
            const h = 60 + rand() * 120;
            parts.push({ geo: new THREE.OctahedronGeometry(1, 0), matrix: M4([(rand() - 0.5) * 60, (rand() - 0.5) * 40, (rand() - 0.5) * 60], [rand() - 0.5, rand() * 6, rand() - 0.5], [h * 0.22, h, h * 0.22]), color: "#bfefff", glow: 1 });
        }
        this.eyeCrystal = new THREE.Mesh(buildParts(parts), glowMaterial({ roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.92 }, "#7fe9ff"));
        this.eyeCrystal.position.copy(c);
        this.scene.add(this.eyeCrystal);
        const light = new THREE.PointLight(0x7fe9ff, 3, 1600, 1.2);
        light.position.copy(c);
        this.scene.add(light);
        this.colliders.push({ t: "s", c: [c.x, c.y, c.z], r: 70 });
    }

    // ---- Bellstone: the bell and five chime crystals ---------------------------------------
    _bell() {
        const e = this.byId.bellstone;
        const top = surfaceY(e, 0, 0);
        BELL.pos[1] = top + 90;
        const parts = [];
        // stone frame
        parts.push({ geo: new THREE.BoxGeometry(22, 170, 22), matrix: M4([-70, 85, 0]), color: "#8a8073" });
        parts.push({ geo: new THREE.BoxGeometry(22, 170, 22), matrix: M4([70, 85, 0]), color: "#8a8073" });
        parts.push({ geo: new THREE.BoxGeometry(190, 22, 34), matrix: M4([0, 176, 0]), color: "#7d7366" });
        const frame = new THREE.Mesh(buildParts(parts), glowMaterial({ roughness: 0.9 }, null, false, true));
        frame.position.set(e.pos[0], top - 6, e.pos[2]);
        this.scene.add(frame);
        const prof = [];
        for (let i = 0; i <= 16; i++) {
            const t = i / 16;
            prof.push(new THREE.Vector2(10 + 34 * Math.pow(t, 2.2) + (t > 0.9 ? 6 * (t - 0.9) * 10 : 0), 70 - t * 70));
        }
        this.bellMat = new THREE.MeshStandardMaterial({ color: 0xb98a4a, metalness: 0.85, roughness: 0.35, emissive: 0xffb050, emissiveIntensity: 0 });
        this.bellMesh = new THREE.Mesh(new THREE.LatheGeometry(prof.reverse(), 32), this.bellMat);
        this.bellMesh.position.set(e.pos[0], top + 95, e.pos[2]);
        this.scene.add(this.bellMesh);
        this.colliders.push({ t: "c", a: [e.pos[0] - 70, top, e.pos[2]], b: [e.pos[0] - 70, top + 180, e.pos[2]], r: 16 });
        this.colliders.push({ t: "c", a: [e.pos[0] + 70, top, e.pos[2]], b: [e.pos[0] + 70, top + 180, e.pos[2]], r: 16 });
        this.colliders.push({ t: "c", a: [e.pos[0] - 95, top + 176, e.pos[2]], b: [e.pos[0] + 95, top + 176, e.pos[2]], r: 18 });

        this.chimes = CHIMES.map((c, i) => {
            const mat = new THREE.MeshStandardMaterial({ color: NOTE_COLORS[c.note], emissive: NOTE_COLORS[c.note], emissiveIntensity: 0.4, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.9 });
            const m = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), mat);
            m.scale.set(11, 34, 11);
            m.position.set(...c.pos);
            const halo = new THREE.Mesh(new THREE.TorusGeometry(30, 1.2, 6, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(NOTE_COLORS[c.note]).multiplyScalar(1.5), transparent: true, opacity: 0.5, toneMapped: false }));
            halo.position.copy(m.position);
            this.scene.add(m, halo);
            return { mesh: m, halo, mat, pulse: 0, ...c, idx: i };
        });
    }

    pulseChime(i, amt = 1) { this.chimes[i].pulse = amt; }
    pulseBell(amt = 1) { this.bellPulse = amt; }

    // ---- gauntlet rings around Hollowspine -------------------------------------------------
    _rings() {
        const pts = gauntletRings();
        this.ringPts = pts.map((p) => new THREE.Vector3(...p));
        const geo = new THREE.TorusGeometry(24, 1.8, 10, 72);
        this.rings = this.ringPts.map((p, i) => {
            const next = this.ringPts[Math.min(i + 1, pts.length - 1)];
            const prev = this.ringPts[Math.max(i - 1, 0)];
            const dir = next.clone().sub(prev).normalize();
            const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.2, 0.5), toneMapped: false, transparent: true, opacity: 0.8 });
            const m = new THREE.Mesh(geo, mat);
            m.position.copy(p);
            m.lookAt(p.clone().add(dir));
            this.scene.add(m);
            return { mesh: m, mat, pos: p, dir };
        });
    }

    setRingState(next, running) {
        this.rings.forEach((r, i) => {
            const isNext = i === next;
            r.mesh.visible = running ? i >= next : true;
            const c = running ? (isNext ? [0.8, 2.6, 3.0] : [1.2, 0.95, 0.45]) : i === 0 ? [0.8, 2.6, 3.0] : [0.9, 0.7, 0.35];
            r.mat.color.setRGB(...c);
            r.mat.opacity = running ? (isNext ? 1 : 0.55) : i === 0 ? 1 : 0.35;
            r.isNext = isNext;
        });
    }

    // ---- arch markers ----------------------------------------------------------------------
    _gates() {
        this.gateMeshes = GATES.map((g) => {
            const m = new THREE.Mesh(new THREE.TorusGeometry(g.radius, 1.6, 6, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.1, 1.3), transparent: true, opacity: 0.3, toneMapped: false, depthWrite: false }));
            m.position.set(...g.center);
            m.lookAt(new THREE.Vector3(...g.center).add(new THREE.Vector3(...g.normal)));
            this.scene.add(m);
            return m;
        });
    }

    setGateDone(i) {
        const m = this.gateMeshes[i];
        m.material.color.setRGB(2.2, 1.6, 0.6);
        m.material.opacity = 0.6;
    }

    // ---- rising air ---------------------------------------------------------------------------
    _thermals() {
        const per = 260;
        const N = THERMALS.length * per;
        const pos = new Float32Array(N * 3), seed = new Float32Array(N * 3);
        const rand = mulberry32(31);
        THERMALS.forEach((t, ti) => {
            for (let k = 0; k < per; k++) {
                const i = ti * per + k;
                const a = rand() * 6.28, r = Math.sqrt(rand()) * t.r;
                pos[i * 3] = t.x + Math.cos(a) * r; pos[i * 3 + 1] = t.y0; pos[i * 3 + 2] = t.z + Math.sin(a) * r;
                seed[i * 3] = rand(); seed[i * 3 + 1] = t.y1 - t.y0; seed[i * 3 + 2] = 30 + rand() * 40;
            }
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        const mat = new THREE.ShaderMaterial({
            uniforms: { uTime: shared.uTime, uPx: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
            vertexShader: `attribute vec3 aSeed; uniform float uTime, uPx; varying float vA;
                void main(){ vec3 p = position; float t = mod(aSeed.x*aSeed.y + uTime*aSeed.z, aSeed.y); p.y += t;
                float a = uTime*0.3 + aSeed.x*30.; p.x += sin(a)*8.; p.z += cos(a)*8.;
                vec4 mv = modelViewMatrix * vec4(p,1.); gl_Position = projectionMatrix * mv;
                vA = smoothstep(0., 200., t) * smoothstep(aSeed.y, aSeed.y-300., t) * smoothstep(9000., 1500., -mv.z);
                gl_PointSize = clamp(2600. * uPx / -mv.z, 1., 18.); }`,
            fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d)*vA; gl_FragColor = vec4(vec3(1.0,0.9,0.7)*1.2, a*0.7); ${SHADER_END} }`,
        });
        this.thermalPts = new THREE.Points(geo, mat);
        this.thermalPts.frustumCulled = false;
        this.scene.add(this.thermalPts);
    }

    // ---- per frame --------------------------------------------------------------------------
    update(dt, t, playerPos) {
        this.time = t;
        // crown glow eases toward its target
        this.crownGlow.value += ((this.targetCrown ?? 0) - this.crownGlow.value) * Math.min(1, dt * 0.8);
        this.crown.rotation.y += dt * 0.004;

        // monolith slowly turns to face you
        const toP = Math.atan2(playerPos.x - this.monolith.position.x, playerPos.z - this.monolith.position.z);
        let dy = toP - this.monolith.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.monolith.rotation.y += dy * Math.min(1, dt * 0.15);
        this.monolith.position.y = 3700 + Math.sin(t * 0.2) * 12;
        for (const s of this.shards) {
            const u = s.userData;
            u.a += u.sp * dt;
            s.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(t * 0.3 + u.r) * 10, Math.sin(u.a) * u.r);
            s.rotation.x += dt * 0.1; s.rotation.z += dt * 0.07;
        }
        this.monoMat.emissiveIntensity = 1.1 + Math.sin(t * 0.9) * 0.4 + (this.monoBoost || 0);

        // bones drift
        this.ribs.rotation.y = Math.sin(t * 0.02) * 0.06;
        this.ribs.position.y = 3000 + Math.sin(t * 0.1) * 15;

        // storm turns; lightning
        this.stormGroup.rotation.y += dt * 0.03;
        this.stormFlash.value = Math.max(0, this.stormFlash.value - dt * 3);
        let strike = null;
        this.boltTimer -= dt;
        if (this.boltTimer <= 0) { this.boltTimer = 1.5 + Math.random() * 4; strike = this._boltStrike(); }
        if (this.bolt) {
            this.boltLife -= dt;
            this.boltMat.opacity = Math.max(0, this.boltLife / 0.35) * (Math.random() < 0.3 ? 0.3 : 1);
            if (this.boltLife <= 0) this.bolt.visible = false;
        }
        this.eyeCrystal.rotation.y += dt * 0.2;
        this.eyeCrystal.position.y = this.stormC.y + Math.sin(t * 0.5) * 10;

        // chimes and bell
        for (const c of this.chimes) {
            c.mesh.rotation.y += dt * 0.6;
            c.pulse = Math.max(0, c.pulse - dt * 1.2);
            c.mat.emissiveIntensity = 0.35 + c.pulse * 3 + (c.lit ? 1.2 : 0);
            const s = 1 + c.pulse * 0.25;
            c.mesh.scale.set(11 * s, 34 * s, 11 * s);
            c.halo.lookAt(playerPos);
            c.halo.scale.setScalar(1 + c.pulse * 0.6);
        }
        this.bellPulse = Math.max(0, (this.bellPulse || 0) - dt * 0.8);
        this.bellMat.emissiveIntensity = this.bellPulse * 2;
        this.bellMesh.rotation.z = Math.sin(t * 9) * 0.06 * this.bellPulse;

        // rings shimmer
        if (this.rings) for (const r of this.rings) if (r.isNext) r.mesh.rotation.z += dt * 2;
        return strike;
    }
}
