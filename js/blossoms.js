// Blossoms that burst open on the trees as the dragon flies near, and fold away again
// once it has passed. Each tree in the near forest carries a few dozen flowers on the
// outside of its crown; they cost nothing while closed (zero-size cards) and only exist
// on the detailed near trees.
//
// The flowers are otherworldly. Their designs are drawn into one atlas (star-lilies,
// spiral nautilus blooms, jelly blooms, hanging bells and angel-trumpets, tulip cups, and
// spares), and each kind of tree carries one design of its own (SPECIES_FLOWER), in a
// range of sizes and colours: a main colour family per tree (neighbours drift through the
// palette), each flower a shade along it, an accent colour on its tips, spots or inner
// ring, and a glowing heart; they glow softly at night.

import * as THREE from "three";
import { shared, addWind } from "./gfx.js";
import { mulberry32 } from "./noise.js";

// how close the dragon must be (metres from the flower): fully open inside OPEN, closed beyond CLOSED
const OPEN = 130, CLOSED = 280;
const PALETTE = ["#ff4fd8", "#ff7a59", "#ffd34d", "#a77bff", "#5ff2ff", "#ffe3f4", "#b6ff5a", "#5a5cff", "#ff3a6e", "#2fe0b8"];
const HEARTS = ["#fff1a8", "#ffffff", "#9ffcff", "#ffb3f0"];

// The atlas: 4 x 4 cells. Channels: red = petal light (darker toward the heart and in the
// folds), green = the heart (it glows), blue = the accent colour's mask, alpha = shape.
// Cells 0-11 are flowers seen face-on; 12, 13 hang from their top edge (bell, trumpet);
// 14 stands on its bottom edge (tulip cup).
const GRID = 4, CELL = 512;
const HANG = [12, 13], STAND = [14];
// each kind of tree has its own flower (kit order: canopy = Parasol, Veilwillow, Cloudpad;
// spire = Corkscrew, Lantern fir, Bellcap):
//   Parasol: star-lilies opening on its sunny umbrella; Veilwillow: bells hanging under its
//   drooping fronds; Cloudpad: tulip cups standing on its flat pads; Corkscrew: spiral
//   nautilus blooms, echoing its twist; Lantern fir: angel-trumpets hanging like its
//   lanterns; Bellcap: frilled jelly blooms to match its jellyfish bells.
const SPECIES_FLOWER = { canopy: [0, 12, 14], spire: [1, 13, 7] };
const CROSSED = new Set([3, 8, 9]);    // puffs and plumes read better as two crossed cards

function blossomAtlas() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = GRID * CELL;
    const g = cv.getContext("2d");
    const P = (L, accent = 0, heart = 0, a = 1) => `rgba(${Math.round(L * 255)},${Math.round(heart * 255)},${Math.round(accent * 255)},${a})`;
    // a petal from the origin out along -y: length len, half-width w, pointed or rounded tip
    const petal = (len, w, tip = 0.15, bulge = 0.55) => {
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(-w * 1.1, -len * bulge * 0.5, -w, -len * (1 - tip), 0, -len);
        g.bezierCurveTo(w, -len * (1 - tip), w * 1.1, -len * bulge * 0.5, 0, 0);
    };
    const shadePetal = (len, L0 = 0.35, L1 = 1.0) => {
        const gr = g.createLinearGradient(0, 0, 0, -len);
        gr.addColorStop(0, P(L0)); gr.addColorStop(0.5, P((L0 + L1) * 0.6)); gr.addColorStop(1, P(L1));
        return gr;
    };
    const ring = (n, fn, off = 0) => { for (let k = 0; k < n; k++) { g.save(); g.rotate(off + (k / n) * Math.PI * 2); fn(k); g.restore(); } };
    const heart = (r, dots = 0, dr = 0.02) => {
        const hg = g.createRadialGradient(0, 0, 0, 0, 0, r);
        hg.addColorStop(0, P(1, 0, 1)); hg.addColorStop(0.75, P(1, 0, 0.85)); hg.addColorStop(1, P(0.6, 0, 0.3, 0));
        g.fillStyle = hg; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
        // stamens: fine filaments ending in glowing dots
        if (dots) ring(dots, (k) => {
            const L = r * (1.6 + 0.6 * ((k * 7) % 3) / 2);
            g.strokeStyle = P(0.9, 0, 0.7); g.lineWidth = 0.008; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L); g.stroke();
            g.fillStyle = P(1, 0, 1); g.beginPath(); g.arc(0, -L, dr, 0, Math.PI * 2); g.fill();
        });
    };
    const vein = (len, a = 0.6) => { g.strokeStyle = P(0.25, 0, 0, a); g.lineWidth = 0.012; g.beginPath(); g.moveTo(0, -0.05); g.lineTo(0, -len * 0.85); g.stroke(); };

    const designs = [
        // 0 star-lily: six long pointed petals curling at the tips, accent tips, long stamens
        () => {
            ring(6, () => { petal(0.95, 0.17, 0.05, 0.45); g.fillStyle = shadePetal(0.95); g.fill();
                g.save(); g.clip(); g.fillStyle = P(1, 1); g.fillRect(-0.3, -1, 0.6, 0.32); g.restore(); vein(0.95); });
            heart(0.12, 7, 0.025);
        },
        // 1 nautilus: petals on a spiral, shrinking inward
        () => {
            for (let k = 26; k >= 0; k--) {
                const t = k / 26;
                g.save(); g.rotate(k * 2.4); petal(0.25 + 0.72 * t, 0.06 + 0.17 * t, 0.3, 0.6);
                g.fillStyle = shadePetal(0.25 + 0.72 * t, 0.3, 0.6 + 0.4 * t); g.fill();
                if (k % 3 === 0) { g.save(); g.clip(); g.fillStyle = P(0.9, 1, 0, 0.8); g.fillRect(-0.3, -1, 0.6, 0.25 + 0.3 * t); g.restore(); }
                g.restore();
            }
            heart(0.07);
        },
        // 2 double-ring: broad outer petals, a contrasting inner star
        () => {
            ring(8, () => { petal(0.96, 0.32, 0.4, 0.7); g.fillStyle = shadePetal(0.96, 0.4); g.fill(); vein(0.96, 0.4); });
            ring(5, () => { petal(0.55, 0.16, 0.05, 0.5); g.fillStyle = P(0.85, 1); g.fill(); }, 0.3);
            heart(0.13, 10, 0.018);
        },
        // 3 urchin puff: dozens of fine spikes with glowing beads at their tips
        () => {
            ring(46, (k) => {
                const L = 0.75 + 0.2 * Math.sin(k * 2.7);
                g.strokeStyle = P(0.55 + 0.4 * (k % 2)); g.lineWidth = 0.035; g.lineCap = "round";
                g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -L); g.stroke();
                g.fillStyle = P(1, 1, 0.3); g.beginPath(); g.arc(0, -L, 0.05, 0, Math.PI * 2); g.fill();
            });
            heart(0.22);
        },
        // 4 moth-orchid: three tall petals, two wide wings with eye-spots, a frilled lip
        () => {
            ring(3, () => { petal(0.9, 0.2, 0.2); g.fillStyle = shadePetal(0.9); g.fill(); vein(0.9); }, Math.PI);
            for (const s of [-1, 1]) {
                g.save(); g.rotate(s * 1.25); petal(0.85, 0.42, 0.45, 0.75); g.fillStyle = shadePetal(0.85, 0.45); g.fill();
                g.fillStyle = P(0.95, 1); g.beginPath(); g.arc(0, -0.52, 0.15, 0, Math.PI * 2); g.fill();
                g.fillStyle = P(0.2, 0, 0.8); g.beginPath(); g.arc(0, -0.52, 0.06, 0, Math.PI * 2); g.fill();
                g.restore();
            }
            g.save(); g.rotate(Math.PI); g.beginPath(); g.moveTo(-0.16, 0); g.quadraticCurveTo(-0.3, -0.45, 0, -0.5); g.quadraticCurveTo(0.3, -0.45, 0.16, 0); g.fillStyle = P(0.8, 1); g.fill(); g.restore();
            heart(0.1);
        },
        // 5 fractal rosette: five petals, each split into three lobes
        () => {
            ring(5, () => {
                petal(0.6, 0.2, 0.3); g.fillStyle = shadePetal(0.6, 0.35, 0.8); g.fill();
                for (const a of [-0.45, 0, 0.45]) { g.save(); g.translate(0, -0.52); g.rotate(a); petal(0.42, 0.13, 0.3); g.fillStyle = a ? shadePetal(0.42, 0.7, 1) : P(0.95, 1); g.fill(); g.restore(); }
            });
            heart(0.14, 5, 0.03);
        },
        // 6 pinwheel of crescents
        () => {
            ring(7, () => {
                g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(0.35, -0.2, 0.45, -0.7, 0.05, -0.97); g.bezierCurveTo(0.25, -0.6, 0.12, -0.25, 0, 0);
                g.fillStyle = shadePetal(0.97, 0.4); g.fill();
                g.beginPath(); g.moveTo(0.05, -0.97); g.bezierCurveTo(0.3, -0.75, 0.32, -0.55, 0.26, -0.45); g.lineTo(0.17, -0.62); g.closePath(); g.fillStyle = P(1, 1); g.fill();
            });
            heart(0.16);
        },
        // 7 jelly bloom: a frilled disc with glowing radial veins
        () => {
            g.beginPath();
            for (let k = 0; k <= 240; k++) { const a = (k / 240) * Math.PI * 2, r = 0.84 + 0.09 * Math.sin(a * 18) + 0.04 * Math.sin(a * 5); k ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(r, 0); }
            const dg = g.createRadialGradient(0, 0, 0, 0, 0, 0.95);
            dg.addColorStop(0, P(0.35)); dg.addColorStop(0.7, P(0.75)); dg.addColorStop(1, P(1, 0.8));
            g.fillStyle = dg; g.fill();
            ring(18, () => { g.strokeStyle = P(1, 1, 0.25); g.lineWidth = 0.02; g.beginPath(); g.moveTo(0, -0.18); g.quadraticCurveTo(0.08, -0.5, 0, -0.84); g.stroke(); });
            heart(0.2, 0);
        },
        // 8 feather plume: seven feathered petals with fine barbs
        () => {
            ring(7, () => {
                g.strokeStyle = P(0.5); g.lineWidth = 0.025; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -0.95); g.stroke();
                for (let b = 0; b < 16; b++) {
                    const y = -0.15 - b * 0.05, L = 0.18 * Math.sin(((b + 1) / 17) * Math.PI);
                    g.strokeStyle = P(0.55 + 0.45 * b / 16, b > 11 ? 1 : 0); g.lineWidth = 0.014;
                    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, y); g.lineTo(s * L, y - 0.07); g.stroke(); }
                }
            });
            heart(0.1, 0);
        },
        // 9 crystal flower: faceted angular petals, two-tone facets
        () => {
            ring(6, () => {
                g.beginPath(); g.moveTo(0, -0.05); g.lineTo(-0.22, -0.45); g.lineTo(0, -0.98); g.closePath(); g.fillStyle = P(0.55); g.fill();
                g.beginPath(); g.moveTo(0, -0.05); g.lineTo(0.22, -0.45); g.lineTo(0, -0.98); g.closePath(); g.fillStyle = P(0.95); g.fill();
                g.beginPath(); g.moveTo(0, -0.7); g.lineTo(0.1, -0.6); g.lineTo(0, -0.98); g.lineTo(-0.1, -0.6); g.closePath(); g.fillStyle = P(1, 1); g.fill();
            });
            ring(6, () => { g.beginPath(); g.moveTo(0, 0); g.lineTo(-0.12, -0.3); g.lineTo(0, -0.5); g.lineTo(0.12, -0.3); g.closePath(); g.fillStyle = P(0.75, 0.6); g.fill(); }, Math.PI / 6);
            heart(0.09);
        },
        // 10 eye-flower: concentric frilled rings round a great glowing iris
        () => {
            for (const [r, L, ac, n] of [[0.95, 0.5, 0, 22], [0.72, 0.85, 1, 16], [0.5, 0.6, 0, 12]]) {
                g.beginPath();
                for (let k = 0; k <= 200; k++) { const a = (k / 200) * Math.PI * 2, rr = r * (0.92 + 0.08 * Math.cos(a * n)); k ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(rr, 0); }
                g.fillStyle = P(L, ac); g.fill();
            }
            heart(0.32, 0);
            g.fillStyle = P(0.15); g.beginPath(); g.ellipse(0, 0, 0.05, 0.16, 0, 0, Math.PI * 2); g.fill();
        },
        // 11 ribbon flower: four long wavy ribbons
        () => {
            ring(4, () => {
                g.beginPath(); g.moveTo(-0.05, 0);
                for (let k = 0; k <= 20; k++) { const t = k / 20; g.lineTo(-0.07 - 0.06 * t + Math.sin(t * 9) * 0.07, -t * 0.97); }
                for (let k = 20; k >= 0; k--) { const t = k / 20; g.lineTo(0.07 + 0.06 * t + Math.sin(t * 9) * 0.07, -t * 0.97); }
                g.closePath(); g.fillStyle = shadePetal(0.97, 0.4); g.fill();
                g.save(); g.clip(); g.fillStyle = P(1, 1, 0, 0.9); for (let k = 0; k < 4; k++) g.fillRect(-0.3, -0.3 - k * 0.18, 0.6, 0.05); g.restore();
            }, Math.PI / 4);
            ring(4, () => { petal(0.4, 0.12, 0.2); g.fillStyle = P(0.8); g.fill(); });
            heart(0.11, 8, 0.02);
        },
        // 12 hanging bell (top edge = stem): a domed bell with a frilled hem and dangling stamens
        () => {
            g.strokeStyle = P(0.5); g.lineWidth = 0.035; g.beginPath(); g.moveTo(0, -1); g.lineTo(0, -0.72); g.stroke();
            g.beginPath(); g.moveTo(0, -0.74);
            g.bezierCurveTo(-0.38, -0.72, -0.42, -0.1, -0.62, 0.22);
            for (let k = 0; k <= 12; k++) { const x = -0.62 + (1.24 * k) / 12; g.lineTo(x, 0.22 + (k % 2 ? 0.1 : 0)); }
            g.bezierCurveTo(0.42, -0.1, 0.38, -0.72, 0, -0.74);
            const bg = g.createLinearGradient(0, -0.74, 0, 0.3); bg.addColorStop(0, P(0.45)); bg.addColorStop(0.7, P(0.95)); bg.addColorStop(1, P(1, 1));
            g.fillStyle = bg; g.fill();
            for (const x of [-0.18, 0, 0.18]) { g.strokeStyle = P(0.9, 0, 0.6); g.lineWidth = 0.014; g.beginPath(); g.moveTo(x * 0.6, 0.15); g.lineTo(x, 0.62 + Math.abs(x)); g.stroke();
                g.fillStyle = P(1, 0, 1); g.beginPath(); g.arc(x, 0.64 + Math.abs(x), 0.05, 0, Math.PI * 2); g.fill(); }
        },
        // 13 angel-trumpet (top edge = stem): a long tube flaring into a pointed skirt
        () => {
            g.strokeStyle = P(0.45); g.lineWidth = 0.035; g.beginPath(); g.moveTo(0, -1); g.lineTo(0, -0.85); g.stroke();
            g.beginPath(); g.moveTo(-0.07, -0.86); g.bezierCurveTo(-0.1, -0.2, -0.2, 0.2, -0.7, 0.55); g.lineTo(-0.45, 0.62); g.lineTo(-0.25, 0.9); g.lineTo(0, 0.7);
            g.lineTo(0.25, 0.9); g.lineTo(0.45, 0.62); g.lineTo(0.7, 0.55); g.bezierCurveTo(0.2, 0.2, 0.1, -0.2, 0.07, -0.86); g.closePath();
            const tg = g.createLinearGradient(0, -0.86, 0, 0.9); tg.addColorStop(0, P(0.4)); tg.addColorStop(0.55, P(0.9)); tg.addColorStop(0.8, P(1, 1)); tg.addColorStop(1, P(1, 1));
            g.fillStyle = tg; g.fill();
            g.strokeStyle = P(0.3, 0, 0, 0.6); g.lineWidth = 0.012;
            for (const x of [-0.3, 0, 0.3]) { g.beginPath(); g.moveTo(0, -0.6); g.quadraticCurveTo(x * 0.5, 0.2, x * 1.3, 0.7); g.stroke(); }
            g.fillStyle = P(1, 0, 1); g.beginPath(); g.ellipse(0, 0.62, 0.12, 0.05, 0, 0, Math.PI * 2); g.fill();
        },
        // 14 tulip cup (bottom edge = stem): a cup of pointed petals holding a glowing heart
        () => {
            g.strokeStyle = P(0.45); g.lineWidth = 0.045; g.beginPath(); g.moveTo(0, 1); g.lineTo(0, 0.35); g.stroke();
            g.fillStyle = P(1, 0, 1); g.beginPath(); g.arc(0, -0.25, 0.22, 0, Math.PI * 2); g.fill();
            for (const [x, s, L] of [[-0.3, -1, 0.75], [0.3, 1, 0.75], [0, 0, 0.95]]) {
                g.save(); g.translate(x * 0.4, 0.38); g.rotate(s * 0.32);
                g.beginPath(); g.moveTo(-0.22, 0); g.bezierCurveTo(-0.36, -0.4, -0.2, -L * 0.8, 0, -L); g.bezierCurveTo(0.2, -L * 0.8, 0.36, -0.4, 0.22, 0); g.closePath();
                const cg = g.createLinearGradient(0, 0, 0, -L); cg.addColorStop(0, P(0.4)); cg.addColorStop(0.75, P(0.95)); cg.addColorStop(1, P(1, 1));
                g.fillStyle = cg; g.globalAlpha = s ? 1 : 0.92; g.fill(); g.globalAlpha = 1; g.restore();
            }
        },
    ];
    designs.forEach((draw, i) => {
        const cx = i % GRID, cy = Math.floor(i / GRID);
        g.save();
        g.translate((cx + 0.5) * CELL, (cy + 0.5) * CELL);
        g.scale(CELL * 0.47, CELL * 0.47);
        draw();
        g.restore();
    });
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
}

// uv of a point (u, v in 0..1, v up) inside atlas cell i (canvas row 0 is the top; the
// canvas texture is flipped, so v grows upward)
function cellUV(i, u, v) {
    const cx = i % GRID, cy = Math.floor(i / GRID), e = 0.012;
    return [(cx + e + u * (1 - 2 * e)) / GRID, 1 - (cy + 1 - e - v * (1 - 2 * e)) / GRID];
}

// Flowers on the outside of a tree crown, read off the tree's leaf cards: points whose
// leaf normal faces out (face-on blooms and upright cups) or down (hanging bells). One
// design (atlas cell) per tree, in a range of sizes. aCenter is the point the flower opens out of (its heart, or the stem
// end for hanging and upright ones); aBloom = (opening delay, colour jitter).
export function blossomGeometry(leaves, count, seed, cell) {
    const rand = mulberry32(seed);
    const P = leaves.attributes.position, N = leaves.attributes.normal;
    // leaf cards that move on their own stems (islands.js leafCards): each flower rides its card
    const S = leaves.attributes.aStem, PH = leaves.attributes.aPhase;
    let src = 0;
    leaves.computeBoundingBox();
    const c = leaves.boundingBox.getCenter(new THREE.Vector3());
    const up = [], down = [];
    let maxR = 0;
    for (let i = 0; i < P.count; i++) maxR = Math.max(maxR, Math.hypot(P.getX(i) - c.x, (P.getY(i) - c.y) * 1.4, P.getZ(i) - c.z));
    for (let i = 0; i < P.count; i++) {
        const r = Math.hypot(P.getX(i) - c.x, (P.getY(i) - c.y) * 1.4, P.getZ(i) - c.z);
        if (r < maxR * 0.55) continue;
        if (N.getY(i) > -0.3) up.push(i);
        if (N.getY(i) < 0.2 && P.getY(i) < c.y + (leaves.boundingBox.max.y - c.y) * 0.4) down.push(i);
    }
    const pos = [], nrm = [], uv = [], ctr = [], bloom = [], idx = [], stem = [], phase = [];
    const n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), o = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    // a card: centre o, half-axes ax (u) and by (v), normal nn, atlas cell
    const quad = (cell, o, ax, by, nn, center, delay, jit) => {
        const base = pos.length / 3;
        for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
            const x = (u - 0.5) * 2, y = (v - 0.5) * 2;
            pos.push(o.x + ax.x * x + by.x * y, o.y + ax.y * x + by.y * y, o.z + ax.z * x + by.z * y);
            nrm.push(nn.x, nn.y, nn.z);
            uv.push(...cellUV(cell, u, v));
            ctr.push(center.x, center.y, center.z);
            bloom.push(delay, jit);
            if (S) { stem.push(S.getX(src), S.getY(src), S.getZ(src)); phase.push(PH.getX(src)); }
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (let k = 0; k < count && up.length; k++) {
        // the same flower in a range of sizes, a few big ones
        const s = 1.0 + 2.4 * Math.pow(rand(), 1.6);
        const delay = rand(), jit = rand();
        if (HANG.includes(cell) && down.length) {
            // hangs from the underside of the leaves: the card's top edge at the stem
            const i = down[Math.floor(rand() * down.length)];
            src = i;
            p.set(P.getX(i), P.getY(i), P.getZ(i));
            const L = s * 1.3;
            for (let q = 0; q < 2; q++) {
                const ang = rand() * Math.PI + q * Math.PI / 2;
                a.set(Math.cos(ang), 0, Math.sin(ang));
                n.set(-a.z, 0, a.x);
                o.copy(p).addScaledVector(Y, -L);
                quad(cell, o, a.clone().multiplyScalar(L * 0.7), Y.clone().multiplyScalar(L), n, p, delay, jit);
            }
            continue;
        }
        const i = up[Math.floor(rand() * up.length)];
        src = i;
        n.set(N.getX(i), N.getY(i), N.getZ(i)).normalize();
        p.set(P.getX(i), P.getY(i), P.getZ(i));
        if (STAND.includes(cell)) {
            // stands on the leaves, leaning out of the crown: the card's bottom edge at the stem
            const axis = n.clone().multiplyScalar(0.45).add(Y).normalize();
            const L = s * 1.2;
            for (let q = 0; q < 2; q++) {
                const ang = rand() * Math.PI + q * Math.PI / 2;
                a.set(Math.cos(ang), 0, Math.sin(ang)).cross(axis).normalize();
                b.copy(axis).cross(a).normalize();
                o.copy(p).addScaledVector(axis, L);
                quad(cell, o, a.clone().multiplyScalar(L * 0.62), axis.clone().multiplyScalar(L), b, p, delay, jit);
            }
            continue;
        }
        // face-on: sits just clear of the leaves, facing out, spun at random
        p.addScaledVector(n, 0.4 + s * 0.25);
        a.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).cross(n).normalize();
        b.copy(n).cross(a).normalize();
        quad(cell, p, a.clone().multiplyScalar(s), b.clone().multiplyScalar(s), n, p, delay, jit);
        if (CROSSED.has(cell)) quad(cell, p, a.clone().multiplyScalar(s), b.clone().lerp(n, 0.85).normalize().multiplyScalar(s), n, p, delay, jit);
        // giants get a ring of small buds round them
        if (s > 2.6) for (let q = 0; q < 3; q++) {
            const ang = rand() * Math.PI * 2;
            const bp = p.clone().addScaledVector(a, Math.cos(ang) * s * 1.15).addScaledVector(b, Math.sin(ang) * s * 1.15);
            const bs = 0.35 + rand() * 0.4;
            quad(cell, bp, a.clone().multiplyScalar(bs), b.clone().multiplyScalar(bs), n, bp, Math.min(1, delay + 0.2), jit);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("aCenter", new THREE.Float32BufferAttribute(ctr, 3));
    g.setAttribute("aBloom", new THREE.Float32BufferAttribute(bloom, 2));
    if (S) {
        g.setAttribute("aStem", new THREE.Float32BufferAttribute(stem, 3));
        g.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1));
    }
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
}

export function blossomMaterial() {
    const m = new THREE.MeshStandardMaterial({ map: blossomAtlas(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.5 });
    const glsl = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
    const pick = (name, list) => {
        const cols = list.map((h) => new THREE.Color(h));
        let body = "";
        cols.forEach((c, i) => { body += `${i ? "else " : ""}if (i < ${i}.5) return ${glsl(c)};\n`; });
        return `vec3 ${name}(float i){ i = mod(floor(i), ${cols.length}.0);\n${body} return ${glsl(cols[cols.length - 1])}; }`;
    };
    m.onBeforeCompile = (sh) => {
        sh.uniforms.uDragonPos = shared.uDragonPos;
        sh.uniforms.uGlow = shared.uGlow;
        sh.uniforms.uTime = shared.uTime;
        sh.vertexShader = sh.vertexShader
            .replace("#include <common>", `#include <common>
                attribute vec3 aCenter; attribute vec2 aBloom;
                // uDragonPos is declared by the wind (addWind) below
                varying vec3 vBlossomCol, vAccentCol, vHeartCol; varying float vOpen, vSeed;
                ${pick("blossomPalette", PALETTE)}
                ${pick("heartPalette", HEARTS)}`)
            .replace("#include <begin_vertex>", `#include <begin_vertex>
                {
                    mat4 im = modelMatrix;
                    #ifdef USE_INSTANCING
                    im = modelMatrix * instanceMatrix;
                    #endif
                    vec3 wc = (im * vec4(aCenter, 1.0)).xyz;
                    float b = smoothstep(${CLOSED.toFixed(1)}, ${OPEN.toFixed(1)}, distance(wc, uDragonPos));
                    float open = clamp(b * 1.8 - aBloom.x * 0.8, 0.0, 1.0);
                    // burst: overshoot a little, then settle (ease-out-back), unfurling with a twist
                    float o = open - 1.0;
                    float s = open <= 0.0 ? 0.0 : 1.0 + 2.70158 * o * o * o + 1.70158 * o * o;
                    vec3 rel = transformed - aCenter;
                    float tw = (1.0 - open) * 1.6 * (aBloom.y - 0.5);
                    vec3 ax = normalize(objectNormal);
                    rel = rel * cos(tw) + cross(ax, rel) * sin(tw) + ax * dot(ax, rel) * (1.0 - cos(tw));
                    transformed = aCenter + rel * s + objectNormal * (open - 1.0) * 1.2;
                    // a slow breathing pulse once open
                    transformed = aCenter + (transformed - aCenter) * (1.0 + 0.04 * sin(uTime * 1.3 + aBloom.y * 20.0) * open);
                    vOpen = open;
                    vSeed = aBloom.y;
                    // one main colour per tree (neighbours drift through the palette), some
                    // flowers on each tree in the next colour along; the accent is a few
                    // colours away, the heart is gold, white, ice or rose
                    vec3 tp = (im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                    float h = sin(tp.x * 0.004) * 1.5 + sin(tp.z * 0.0053 + 1.7) * 1.5 + fract(sin(dot(tp.xz, vec2(12.9898, 78.233))) * 43758.5453) * 1.2;
                    float mainI = h * 2.0 + 10.0 + floor(fract(aBloom.y * 3.17) * 2.6);
                    vBlossomCol = blossomPalette(mainI);
                    vAccentCol = blossomPalette(mainI + 3.0 + floor(fract(aBloom.y * 7.31) * 4.0));
                    vHeartCol = heartPalette(fract(aBloom.y * 13.7) * 4.0);
                }`);
        sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", "#include <common>\nuniform float uGlow;\nvarying vec3 vBlossomCol, vAccentCol, vHeartCol; varying float vOpen, vSeed;")
            .replace("#include <map_fragment>", `
                vec4 bt = texture2D(map, vMapUv);
                vec3 body = mix(vBlossomCol, vAccentCol, bt.b);
                diffuseColor.rgb = mix(body * (0.3 + 0.7 * bt.r), vHeartCol, bt.g);
                diffuseColor.a *= bt.a;`)
            .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
                // otherworldly flowers are lit from within: hearts and accents most, more at night
                totalEmissiveRadiance += diffuseColor.rgb * (0.16 + 0.5 * bt.g + 0.2 * bt.b + uGlow * uGlow * (1.4 + 1.2 * bt.g)) * vOpen;`);
    };
    m.customProgramCacheKey = () => "blossom2";
    m.userData.windHeight = 100;   // sway with the (100 m tall) trees they grow on
    m.userData.cards = true;       // and ride the leaf card each one grows on
    return addWind(m, 1, false);
}

// Add a blossom geometry to every variant of the tree kit
export function addBlossoms(kit) {
    let seed = 1;
    for (const [sp, n] of [["canopy", 34], ["spire", 26]]) {
        kit[sp].forEach((v, i) => { v.blossom = blossomGeometry(v.leaves, n, 97 * seed++, SPECIES_FLOWER[sp][i % 3]); });
    }
}
