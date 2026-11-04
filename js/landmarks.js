// The wonders and puzzle pieces: the Crown, the Worldtree, Titan's Rest, the
// Listening Stone, the Stormeye, Bellstone's bell and chime crystals, gauntlet
// rings, arch markers and thermals. Also the colliders for everything that isn't
// an SDF island.

import * as THREE from "three";
import { CROWN, GATES, CHIMES, BELL, THERMALS, entitySDF, gauntletRings } from "./world.js";
import { shared, glowMaterial, foliageMaterial, buildParts, M4, roughen, SHADER_END, UV_LEAVES } from "./gfx.js";
import { mulberry32, makeNoise } from "./noise.js";

export const NOTE_COLORS = ["#ff7a6b", "#ffc15a", "#7dff9a", "#6fd8ff", "#c79bff"];

function surfaceY(e, x, z) {
    for (let y = e.h * 1.2; y > -e.h * 2; y -= 2) if (entitySDF(e, x, y, z) < 0) return e.pos[1] + y;
    return e.pos[1];
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
    _worldtree() {
        const e = this.byId.verdance;
        const base = new THREE.Vector3(e.pos[0], surfaceY(e, 0, 0) - 30, e.pos[2]);
        const H = 980;
        const rand = mulberry32(77);
        const n = makeNoise(77);
        const trunk = new THREE.CylinderGeometry(34, 95, H, 28, 40).translate(0, H / 2, 0);
        {
            const P = trunk.attributes.position;
            for (let i = 0; i < P.count; i++) {
                const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
                const th = Math.atan2(z, x);
                const k = 1 + 0.16 * Math.sin(th * 7 + y * 0.012) + n.noise3(x * 0.03, y * 0.01, z * 0.03) * 0.1;
                const flare = 1 + Math.pow(Math.max(0, 1 - y / 160), 2) * 0.8;
                P.setXYZ(i, x * k * flare, y, z * k * flare);
            }
        }
        const parts = [{ geo: trunk, color: "#5a4636", shade: (x, y) => 0.7 + 0.3 * Math.sin(y * 0.05 + x * 0.1) * 0.5 + 0.15, glow: (x, y, z) => (Math.sin(Math.atan2(z, x) * 7 + y * 0.012) > 0.93 ? 0.5 : 0) }];
        const canopyPts = [[0, H + 40, 0]];
        this.colliders.push({ t: "c", a: [base.x, base.y, base.z], b: [base.x, base.y + H, base.z], r: 80 });
        // roots
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + rand() * 0.3;
            const L = 220 + rand() * 120;
            const root = new THREE.CylinderGeometry(10, 38, L, 8, 1).translate(0, L / 2, 0);
            const m = new THREE.Matrix4().makeRotationY(-a).multiply(new THREE.Matrix4().makeRotationZ(-1.25));
            parts.push({ geo: root, matrix: new THREE.Matrix4().makeTranslation(0, 40, 0).multiply(m), color: "#4d3b2e" });
        }
        // great branches
        for (let i = 0; i < 11; i++) {
            const a = (i / 11) * Math.PI * 2 + rand() * 0.4;
            const y0 = 520 + rand() * 360;
            const L = 280 + rand() * 200;
            const tilt = 0.75 + rand() * 0.45;
            const br = new THREE.CylinderGeometry(7, 26, L, 8, 1).translate(0, L / 2, 0);
            const rot = new THREE.Matrix4().makeRotationY(-a).multiply(new THREE.Matrix4().makeRotationZ(-tilt));
            const mat = new THREE.Matrix4().makeTranslation(0, y0, 0).multiply(rot);
            parts.push({ geo: br, matrix: mat, color: "#57432f" });
            const tip = new THREE.Vector3(0, L, 0).applyMatrix4(mat);
            canopyPts.push([tip.x, tip.y + 20, tip.z]);
            this.colliders.push({ t: "c", a: [base.x, base.y + y0, base.z], b: [base.x + tip.x, base.y + tip.y, base.z + tip.z], r: 22 });
        }
        // canopy clusters
        this.tendrilSpots = [];
        const leaves = [];
        for (const c of canopyPts) {
            const r = 120 + rand() * 70;
            const geo = roughen(new THREE.IcosahedronGeometry(r * 0.85, 2), r * 0.18, 0.02, 9 + canopyPts.indexOf(c));
            parts.push({
                geo, matrix: M4(c, [0, rand() * 6, 0], [1, 0.42, 1]), color: "#1d4a33",
                shade: (x, y) => 0.65 + Math.max(0, y / r) * 0.6,
                glow: (x, y, z) => (Math.sin(x * 0.09) * Math.sin(z * 0.08) > 0.6 ? 0.5 : 0.04),
            });
            this.colliders.push({ t: "s", c: [base.x + c[0], base.y + c[1], base.z + c[2]], r: r * 0.5 });
            // a shell of leaf-clump cards around each dark core
            for (let k = 0; k < 46; k++) {
                const u = rand() * 2 - 1, a = rand() * Math.PI * 2, sq = Math.sqrt(1 - u * u);
                const d = [Math.cos(a) * sq, Math.abs(u) * 0.75 + 0.1, Math.sin(a) * sq];
                const p = [c[0] + d[0] * r * 0.95, c[1] + d[1] * r * 0.42, c[2] + d[2] * r * 0.95];
                const sz = 70 + rand() * 60;
                const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...d).normalize());
                q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rand() * 6.28));
                leaves.push({
                    geo: new THREE.PlaneGeometry(sz, sz), uvRect: UV_LEAVES, normalFrom: [c[0], c[1] - r * 0.3, c[2]],
                    matrix: new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(1, 1, 1)),
                    color: k % 3 ? "#bff2cf" : "#d4ffd8", glow: (x, y, z) => (Math.sin(x * 0.09) * Math.sin(z * 0.08) > 0.6 ? 0.5 : 0.04),
                });
            }
            for (let k = 0; k < 40; k++) {
                const a = rand() * 6.28, d = Math.sqrt(rand()) * r * 0.9;
                this.tendrilSpots.push([c[0] + Math.cos(a) * d, c[1] - r * 0.3, c[2] + Math.sin(a) * d, 60 + rand() * 200]);
            }
        }
        const tree = new THREE.Mesh(buildParts(parts), glowMaterial({ roughness: 0.85 }, "#ff8bd8", false, "bark"));
        tree.position.copy(base);
        this.scene.add(tree);
        const crown = new THREE.Mesh(buildParts(leaves), foliageMaterial("#ff8bd8"));
        crown.position.copy(base);
        this.scene.add(crown);
        // glowing willow tendrils (the reason to come back at night)
        const tg = buildParts([{ geo: new THREE.CylinderGeometry(0.5, 0.25, 1, 4, 8).translate(0, -0.5, 0), color: "#5b8a77", glow: (x, y) => 0.4 - y * 0.6 }]);
        const im = new THREE.InstancedMesh(tg, glowMaterial({ roughness: 0.8 }, "#ff9fe6"), this.tendrilSpots.length);
        const m4 = new THREE.Matrix4();
        this.tendrilSpots.forEach((t, i) => {
            m4.compose(new THREE.Vector3(t[0], t[1], t[2]), new THREE.Quaternion(), new THREE.Vector3(1.4, t[3], 1.4));
            im.setMatrixAt(i, m4);
        });
        im.position.copy(base);
        im.computeBoundingSphere();
        this.scene.add(im);
        this.treeTop = base.clone().add(new THREE.Vector3(0, H, 0));
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
