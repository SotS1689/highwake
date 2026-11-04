// The whole sky: every island, arch, wonder and puzzle site, plus the signed-distance
// functions that shape the islands. Shared by the main thread (collision) and the
// mesher worker (geometry), so it must stay free of three.js and DOM.

import { makeNoise, mulberry32 } from "./noise.js";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smin = (a, b, k) => {
    const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
    return b + (a - b) * h - k * h * (1 - h);
};
const smax = (a, b, k) => -smin(-a, -b, k);

function sdEllipsoid(x, y, z, rx, ry, rz) {
    const k0 = Math.hypot(x / rx, y / ry, z / rz);
    const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
    return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function sdCapsule(x, y, z, a, b, r) {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
    const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

// Tapering underside: radius rr at depth t (0 at the rim, 1 at the tip)
function sdTail(x, y, z, R, H, D, cx = 0, cz = 0, top = 0) {
    const q = Math.hypot(x - cx, z - cz);
    const t = clamp((top - y) / D, 0, 1);
    const rr = R * Math.pow(1 - t, 1.35) + R * 0.03;
    let d = (q - rr) * 0.75;
    d = Math.max(d, top - D - y);
    d = Math.max(d, y - top - H * 0.15);
    return d;
}

// ---------------------------------------------------------------------------------
// World layout. Units are metres. The cloud sea sits at y = 0.

export const SEA = 0;
export const BOUNDARY = 14000;
export const CEILING = 7600;

export const SPAWN = { pos: [700, 2650, 2900], dir: [-0.15, -0.05, -1] };

export const CROWN = { pos: [0, 5200, 0], radius: 640, tube: 46 };

const ISLANDS = [
    {
        id: "heartspire", name: "Heartspire", pos: [0, 2000, 0], r: 900, h: 300, d: 1750, sq: 0.85, seed: 11,
        holes: [{ gate: "Heartgate", a: [-1350, -250, 80], b: [1350, -250, -80], r: 145 }],
        falls: [0.3, 2.2, 4.1], trees: 1,
    },
    {
        id: "hollowspine", name: "Hollowspine", pos: [-4200, 2300, 1800], r: 620, h: 240, d: 1300, sq: 1.0, seed: 23,
        holes: [
            { gate: "Spine Arch", a: [-950, -80, 0], b: [950, -80, 0], r: 88 },
            { a: [0, -390, -950], b: [0, -390, 950], r: 78 },
            { a: [250, 420, 250], b: [250, -900, 250], r: 70 },
        ],
        falls: [1.2], trees: 0.8,
    },
    {
        id: "bellstone", name: "Bellstone", pos: [3800, 1800, -3000], r: 480, h: 220, d: 1050, sq: 0.9, seed: 37,
        holes: [], falls: [3.6], trees: 0.6,
    },
    {
        id: "verdance", name: "Verdance", pos: [-2600, 2500, -4600], r: 740, h: 280, d: 1450, sq: 0.95, seed: 41,
        holes: [{ gate: "Rootgate", a: [-120, -330, -1050], b: [-80, -330, 1050], r: 125 }],
        falls: [0.9, 2.8, 5.0], trees: 1.3,
    },
    {
        id: "ascension", name: "Ascension", pos: [5400, 2700, 2400], r: 460, h: 230, d: 1000, sq: 1.0, seed: 53,
        holes: [], falls: [4.4], trees: 0.9, risingFall: true,
    },
    {
        id: "twinreach-e", name: "Twinreach East", pos: [1700, 2300, 5300], r: 440, h: 220, d: 1100, sq: 1.0, seed: 61,
        holes: [], falls: [5.6], trees: 1,
    },
    {
        id: "twinreach-w", name: "Twinreach West", pos: [-1300, 2300, 6100], r: 420, h: 210, d: 1050, sq: 0.9, seed: 67,
        holes: [], falls: [2.6], trees: 1,
    },
    {
        id: "ironroot", name: "Ironroot", pos: [7200, 2000, -1200], r: 680, h: 260, d: 1500, sq: 0.8, seed: 71,
        holes: [{ gate: "Ironmaw", a: [-950, -260, -720], b: [950, -210, 720], r: 165 }],
        falls: [1.7, 4.0], trees: 0.7,
    },
    {
        id: "gullwing", name: "Gullwing", pos: [-7000, 1700, -1600], r: 560, h: 220, d: 1200, sq: 1.1, seed: 83,
        holes: [{ gate: "Gullwing Eye", a: [-220, -420, -920], b: [220, -160, 920], r: 118 }],
        falls: [3.1], trees: 0.9,
    },
    {
        id: "lantern", name: "Lantern Hollow", pos: [-3800, 1500, 5000], r: 380, h: 200, d: 900, sq: 1.0, seed: 97,
        holes: [], falls: [], trees: 1.2, glowy: true,
    },
    {
        id: "highperch", name: "Highperch", pos: [-1500, 4300, -1900], r: 340, h: 170, d: 780, sq: 1.0, seed: 101,
        holes: [{ a: [-500, -120, 0], b: [500, -120, 0], r: 60 }],
        falls: [1.0], trees: 1,
    },
];

// The natural stone bridge between the Twinreach islands
const BRIDGES = [
    {
        id: "skybridge", name: "The Skybridge", seed: 131,
        pts: [[1300, 2380, 5410], [700, 2520, 5560], [190, 2560, 5700], [-330, 2510, 5840], [-930, 2380, 6005]],
        r: 62,
    },
];

// Arches the player can thread (Needlework). Bridge gate sits under the span.
export const GATES = [];

// Puzzle sites: positions in world space
export const BELL = { island: "bellstone", pos: [3800, 2060, -3000], hear: 1100 };
export const CHIMES = [
    { pos: [3800 + 720, 2050, -3000 + 160], note: 0 },
    { pos: [3800 + 260, 1660, -3000 - 720], note: 1 },
    { pos: [3800 - 690, 1900, -3000 - 300], note: 2 },
    { pos: [3800 - 420, 2350, -3000 + 640], note: 3 },
    { pos: [3800 + 380, 1450, -3000 + 640], note: 4 },
];
export const CHIME_ORDER = [2, 0, 3, 1, 4];

// Gauntlet rings in Hollowspine-local space, built into world space below
const GAUNTLET_LOCAL = [
    [-1500, -80, 120], [-650, -80, 0], [0, -80, 0], [650, -80, 0], [1350, -60, 0],
    [1250, 250, 700], [700, 560, 620], [250, 520, 250], [250, 120, 250], [250, -360, 250],
    [250, -760, 250], [500, -620, -900], [0, -390, -1300], [0, -390, -400], [0, -390, 400],
    [0, -390, 1300], [-700, -150, 1550],
];

export const THERMALS = [
    { x: 1250, z: -820, y0: 400, y1: 5600, r: 140 },
    { x: -3500, z: 2700, y0: 500, y1: 3800, r: 120 },
    { x: 3200, z: -2200, y0: 300, y1: 3200, r: 120 },
    { x: -2000, z: -3500, y0: 600, y1: 4200, r: 130 },
    { x: 6200, z: 900, y0: 500, y1: 3600, r: 120 },
    { x: -5600, z: -900, y0: 400, y1: 3400, r: 120 },
    { x: 300, z: 4400, y0: 500, y1: 3600, r: 120 },
];

export const WONDERS = [
    { id: "crown", name: "The Sleeping Crown", pos: [0, 5200, 0], r: 1700, text: "A ring of stone the size of a city floats high over the Heartspire, waiting for something." },
    { id: "ribcage", name: "Titan's Rest", pos: [-6200, 3000, 3600], r: 800, text: "The bones of a sky whale larger than any living. Its ribs still drift together, as if remembering." },
    { id: "worldtree", name: "The Worldtree", pos: [-2600, 3300, -4600], r: 1300, text: "One tree, older than the islands it grips. Its crown glows when the sun goes down." },
    { id: "risingfalls", name: "The Rising Falls", pos: [5400, 3400, 2400], r: 1000, text: "Here the water has forgotten which way is down." },
    { id: "monolith", name: "The Listening Stone", pos: [2600, 3700, -6600], r: 900, text: "Black stone, hanging over nothing. It turns slowly to face whatever comes near." },
    { id: "drifters", name: "Lantern Hollow", pos: [-3800, 1700, 5000], r: 1100, text: "A drifting garden of lantern-jellies, pulsing in the shade of the island." },
    { id: "stormeye", name: "The Stormeye", pos: [9600, 2600, 6600], r: 1000, text: "A wheel of cloud and lightning that never moves and never ends." },
    { id: "skybridge", name: "The Skybridge", pos: [190, 2500, 5700], r: 800, text: "A span of living rock binds the Twinreach islands together across the void." },
];

// Small floating rocks: generated, deterministic
function generateRocks() {
    const rand = mulberry32(777);
    const out = [];
    const big = [...ISLANDS];
    let tries = 0;
    while (out.length < 16 && tries++ < 2000) {
        const ang = rand() * Math.PI * 2;
        const dist = 1800 + rand() * 9500;
        const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
        const y = 1000 + rand() * 2900;
        const r = 110 + rand() * 190;
        const ok = [...big, ...out].every((o) => Math.hypot(o.pos[0] - x, o.pos[2] - z) > o.r + r + 500 || Math.abs(o.pos[1] - y) > 1400);
        const okW = WONDERS.every((w) => Math.hypot(w.pos[0] - x, w.pos[1] - y, w.pos[2] - z) > w.r * 0.8 + r);
        if (!ok || !okW) continue;
        out.push({
            id: "rock" + out.length, name: "", pos: [x, y, z], r, h: r * 0.45, d: r * (1.6 + rand()), sq: 0.8 + rand() * 0.4,
            seed: 1000 + out.length, holes: [], falls: rand() < 0.3 ? [rand() * 6.28] : [], trees: 0.8, small: true,
        });
    }
    return out;
}

// ---------------------------------------------------------------------------------
// Build entities: islands get lobes, hanging spurs, noise and bounds

export function buildWorld() {
    const entities = [];
    for (const def of [...ISLANDS, ...generateRocks()]) {
        const rand = mulberry32(def.seed * 9973);
        const R = def.r, H = def.h, D = def.d;
        const lobes = [];
        const nl = def.small ? 2 : 4 + Math.floor(rand() * 3);
        for (let i = 0; i < nl; i++) {
            const a = (i / nl) * Math.PI * 2 + rand() * 0.8;
            const dist = R * (0.55 + rand() * 0.35);
            lobes.push({ x: Math.cos(a) * dist, y: -H * (0.1 + rand() * 0.5), z: Math.sin(a) * dist * def.sq, r: R * (0.28 + rand() * 0.2) });
        }
        const hangers = [];
        const nh = def.small ? 1 : 3 + Math.floor(rand() * 3);
        for (let i = 0; i < nh; i++) {
            const a = rand() * Math.PI * 2;
            const dist = R * (0.35 + rand() * 0.35);
            hangers.push({ x: Math.cos(a) * dist, z: Math.sin(a) * dist * def.sq, r: R * (0.16 + rand() * 0.12), len: D * (0.35 + rand() * 0.35), top: -H * 0.2 });
        }
        const e = {
            kind: "island", ...def, lobes, hangers,
            amp: R * 0.085, freq: 2.4 / R,
            cell: def.small ? clamp(R / 30, 7.5, 10) : clamp(R / 50, 8, 18),
        };
        e.noise = makeNoise(def.seed);
        e.bounds = islandBounds(e);
        entities.push(e);
    }
    for (const b of BRIDGES) {
        const e = { kind: "bridge", ...b, rad: b.r, amp: 14, freq: 1 / 90, cell: 7, noise: makeNoise(b.seed) };
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const p of b.pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
        const m = b.r * 2.2;
        e.pos = [0, 0, 0];
        e.bounds = { min: lo.map((v) => v - m), max: hi.map((v) => v + m) };
        e.r = Math.hypot(hi[0] - lo[0], hi[2] - lo[2]) / 2;
        entities.push(e);
    }

    // Gates (arches) in world space
    GATES.length = 0;
    for (const e of entities) {
        for (const h of e.holes || []) {
            if (!h.gate) continue;
            const c = [0, 1, 2].map((k) => e.pos[k] + (h.a[k] + h.b[k]) / 2);
            const ax = [0, 1, 2].map((k) => h.b[k] - h.a[k]);
            const L = Math.hypot(...ax);
            GATES.push({ name: h.gate, center: c, normal: ax.map((v) => v / L), radius: h.r * 0.95, half: L / 2 });
        }
    }
    {
        const p0 = BRIDGES[0].pts[0], p1 = BRIDGES[0].pts[4];
        const dir = [p1[0] - p0[0], 0, p1[2] - p0[2]];
        const L = Math.hypot(...dir);
        const nrm = [dir[2] / L, 0, -dir[0] / L];
        GATES.splice(3, 0, { name: "Skybridge", center: [190, 2270, 5700], normal: nrm, radius: 210, half: 120 });
    }
    return entities;
}

export function gauntletRings() {
    const hs = ISLANDS.find((i) => i.id === "hollowspine").pos;
    return GAUNTLET_LOCAL.map((p) => [p[0] + hs[0], p[1] + hs[1], p[2] + hs[2]]);
}

function islandBounds(e) {
    let ext = e.r * 1.0;
    for (const l of e.lobes) ext = Math.max(ext, Math.hypot(l.x, l.z) + l.r);
    ext += e.amp * 2.5;
    let bottom = -e.d;
    for (const h of e.hangers) bottom = Math.min(bottom, h.top - h.len);
    return {
        min: [-ext, bottom - e.amp * 2.5, -ext],
        max: [ext, e.h * 0.9 + e.amp * 2.5, ext],
    };
}

// ---------------------------------------------------------------------------------
// Signed distance, entity-local coordinates

export function entitySDF(e, x, y, z) {
    if (e.kind === "bridge") return bridgeSDF(e, x, y, z);
    const R = e.r, H = e.h;
    const zs = z / e.sq;
    let d = sdEllipsoid(x, y, zs, R, H, R);
    d = smax(d, y - H * 0.5, H * 0.35);
    d = smin(d, sdTail(x, y, zs, R * 0.92, H, e.d), R * 0.18);
    for (const l of e.lobes) {
        const ld = sdEllipsoid(x - l.x, y - l.y, z - l.z, l.r, l.r * 0.75, l.r);
        d = smin(d, ld, l.r * 0.45);
    }
    for (const h of e.hangers) {
        d = smin(d, sdTail(x, y, z, h.r, H * 0.3, h.len, h.x, h.z, h.top), h.r * 0.5);
    }

    if (d < e.amp * 2.6) {
        const f = e.freq, n = e.noise;
        let disp = n.fbm(x * f, y * f, z * f, 5) * e.amp;
        if (y < -H * 0.1) {
            // vertical ridges and drips on the underside
            const u = clamp((-y - H * 0.1) / (H * 1.5), 0, 1);
            disp += (n.ridged(x * f * 3, y * f * 0.6, z * f * 3, 3) - 0.6) * e.amp * 0.8 * u;
        }
        d += disp;
    }

    for (const h of e.holes) {
        const r = h.r + e.noise.noise3(x * 0.02, y * 0.02, z * 0.02) * h.r * 0.12;
        d = smax(d, -sdCapsule(x, y, z, h.a, h.b, r), 30);
    }
    return d;
}

function bridgeSDF(e, x, y, z) {
    let d = 1e9;
    const p = e.pts;
    for (let i = 0; i < p.length - 1; i++) {
        const t0 = i / (p.length - 1), t1 = (i + 1) / (p.length - 1);
        // thicker at the ends where it roots into the islands
        const r0 = e.rad * (1 + 0.9 * Math.pow(Math.abs(t0 - 0.5) * 2, 3));
        const r1 = e.rad * (1 + 0.9 * Math.pow(Math.abs(t1 - 0.5) * 2, 3));
        const cd = sdCapsule(x, y, z, p[i], p[i + 1], (r0 + r1) / 2);
        d = i === 0 ? cd : smin(d, cd, 40);
    }
    if (d < e.amp * 2.6) d += e.noise.fbm(x * e.freq, y * e.freq, z * e.freq, 4) * e.amp;
    return d;
}

// World-space distance to any rock, or Infinity when far from all of them
export function worldSDF(entities, x, y, z, margin = 60) {
    let best = Infinity;
    for (const e of entities) {
        const lx = x - e.pos[0], ly = y - e.pos[1], lz = z - e.pos[2];
        const b = e.bounds;
        if (lx < b.min[0] - margin || lx > b.max[0] + margin || ly < b.min[1] - margin || ly > b.max[1] + margin || lz < b.min[2] - margin || lz > b.max[2] + margin) continue;
        const d = entitySDF(e, lx, ly, lz);
        if (d < best) best = d;
    }
    return best;
}
