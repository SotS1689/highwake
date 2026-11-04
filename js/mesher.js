// Surface-nets mesher for one island's signed-distance field, with vertex colours,
// glow, ambient occlusion and spots for trees and hanging vines.

import { entitySDF } from "./world.js";
import { mulberry32 } from "./noise.js";

const lin = (c) => Math.pow(c, 2.2);
const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

export function meshEntity(e) {
    const c = e.cell;
    const b = e.bounds;
    const nx = Math.ceil((b.max[0] - b.min[0]) / c) + 1;
    const ny = Math.ceil((b.max[1] - b.min[1]) / c) + 1;
    const nz = Math.ceil((b.max[2] - b.min[2]) / c) + 1;
    const ox = b.min[0], oy = b.min[1], oz = b.min[2];
    const vals = new Float32Array(nx * ny * nz);
    const id = (i, j, k) => i + nx * (j + ny * k);

    // Coarse blocks far from the surface are filled from one sample
    const B = 4;
    const margin = 3.46 * c * 1.35 + (e.amp || 0) * 3 + c;
    for (let bk = 0; bk < nz; bk += B) for (let bj = 0; bj < ny; bj += B) for (let bi = 0; bi < nx; bi += B) {
        const ci = Math.min(bi + B / 2, nx - 1), cj = Math.min(bj + B / 2, ny - 1), ck = Math.min(bk + B / 2, nz - 1);
        const dc = entitySDF(e, ox + ci * c, oy + cj * c, oz + ck * c);
        const far = Math.abs(dc) > margin;
        for (let k = bk; k < Math.min(bk + B, nz); k++) for (let j = bj; j < Math.min(bj + B, ny); j++) for (let i = bi; i < Math.min(bi + B, nx); i++) {
            vals[id(i, j, k)] = far ? dc : entitySDF(e, ox + i * c, oy + j * c, oz + k * c);
        }
    }

    // One vertex per cell that straddles the surface
    const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
    const pos = [];
    const corner = new Float32Array(8);
    const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let q = 0; q < 8; q++) {
            const v = vals[id(i + CO[q][0], j + CO[q][1], k + CO[q][2])];
            corner[q] = v;
            if (v < 0) mask |= 1 << q;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, bb] of EDGES) {
            const va = corner[a], vb = corner[bb];
            if ((va < 0) === (vb < 0)) continue;
            const t = va / (va - vb);
            sx += CO[a][0] + (CO[bb][0] - CO[a][0]) * t;
            sy += CO[a][1] + (CO[bb][1] - CO[a][1]) * t;
            sz += CO[a][2] + (CO[bb][2] - CO[a][2]) * t;
            n++;
        }
        cellVert[cid(i, j, k)] = pos.length / 3;
        pos.push(ox + (i + sx / n) * c, oy + (j + sy / n) * c, oz + (k + sz / n) * c);
    }

    // Quads across every grid edge with a sign change
    const idx = [];
    const quad = (a, b2, c2, d2, flip) => {
        if (a < 0 || b2 < 0 || c2 < 0 || d2 < 0) return;
        if (!flip) idx.push(a, c2, b2, a, d2, c2);
        else idx.push(a, b2, c2, a, c2, d2);
    };
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const v0 = vals[id(i, j, k)], v1 = vals[id(i + 1, j, k)];
        if ((v0 < 0) === (v1 < 0)) continue;
        quad(cellVert[cid(i, j - 1, k - 1)], cellVert[cid(i, j, k - 1)], cellVert[cid(i, j, k)], cellVert[cid(i, j - 1, k)], v0 < 0);
    }
    for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const v0 = vals[id(i, j, k)], v1 = vals[id(i, j + 1, k)];
        if ((v0 < 0) === (v1 < 0)) continue;
        quad(cellVert[cid(i - 1, j, k - 1)], cellVert[cid(i - 1, j, k)], cellVert[cid(i, j, k)], cellVert[cid(i, j, k - 1)], v0 < 0);
    }
    for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const v0 = vals[id(i, j, k)], v1 = vals[id(i, j, k + 1)];
        if ((v0 < 0) === (v1 < 0)) continue;
        quad(cellVert[cid(i - 1, j - 1, k)], cellVert[cid(i, j - 1, k)], cellVert[cid(i, j, k)], cellVert[cid(i - 1, j, k)], v0 < 0);
    }

    // Normals, colours, glow
    const nv = pos.length / 3;
    const normal = new Float32Array(nv * 3);
    const color = new Float32Array(nv * 3);
    const glow = new Float32Array(nv);
    const rand = mulberry32((e.seed || 1) * 31 + 7);
    const trees = [], vines = [];
    // trilinear sample of the grid (world-local coords), clamped at the edges
    const sample = (x, y, z) => {
        let fx = (x - ox) / c, fy = (y - oy) / c, fz = (z - oz) / c;
        fx = Math.min(nx - 1.001, Math.max(0, fx)); fy = Math.min(ny - 1.001, Math.max(0, fy)); fz = Math.min(nz - 1.001, Math.max(0, fz));
        const i = fx | 0, j = fy | 0, k = fz | 0;
        const tx = fx - i, ty = fy - j, tz = fz - k;
        const v00 = vals[id(i, j, k)] * (1 - tx) + vals[id(i + 1, j, k)] * tx;
        const v10 = vals[id(i, j + 1, k)] * (1 - tx) + vals[id(i + 1, j + 1, k)] * tx;
        const v01 = vals[id(i, j, k + 1)] * (1 - tx) + vals[id(i + 1, j, k + 1)] * tx;
        const v11 = vals[id(i, j + 1, k + 1)] * (1 - tx) + vals[id(i + 1, j + 1, k + 1)] * tx;
        return (v00 * (1 - ty) + v10 * ty) * (1 - tz) + (v01 * (1 - ty) + v11 * ty) * tz;
    };
    const eps = c * 0.6;
    const nz2 = e.noise;
    const H = e.h || 100;
    const treeChance = (e.trees || 0) * (c * c) / (30 * 30);
    const vineChance = (c * c) / (32 * 32);
    const isBridge = e.kind === "bridge";

    for (let v = 0; v < nv; v++) {
        const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        // gradient from the sampled grid (no extra field evaluations)
        let gx = sample(x + eps, y, z) - sample(x - eps, y, z);
        let gy = sample(x, y + eps, z) - sample(x, y - eps, z);
        let gz = sample(x, y, z + eps) - sample(x, y, z - eps);
        const gl = Math.hypot(gx, gy, gz) || 1;
        gx /= gl; gy /= gl; gz /= gl;
        normal[v * 3] = gx; normal[v * 3 + 1] = gy; normal[v * 3 + 2] = gz;

        const ao = Math.min(1, Math.max(0.3, sample(x + gx * c * 3, y + gy * c * 3, z + gz * c * 3) / (c * 3)));
        const nA = nz2.noise3(x * 0.004, y * 0.004, z * 0.004);
        const nB = nz2.noise3(x * 0.02, y * 0.02, z * 0.02);

        // rock with strata
        const band = Math.sin(y * 0.05 + nA * 4) * 0.5 + 0.5;
        let r = 0.60 - band * 0.10 + nB * 0.04, g = 0.55 - band * 0.09 + nB * 0.04, bl = 0.49 - band * 0.07 + nB * 0.04;
        // cooler, darker underside
        const under = isBridge ? smooth(0.2, -0.6, gy) * 0.6 : smooth(-H * 0.2, -H * 1.6, y) * smooth(0.3, -0.3, gy);
        r += (0.34 - r) * under; g += (0.34 - g) * under; bl += (0.40 - bl) * under;
        // grass and moss on the tops
        const grass = smooth(0.5, 0.78, gy) * (isBridge ? 1 : smooth(-H * 0.6, -H * 0.2, y));
        if (grass > 0) {
            const t = nA * 0.5 + 0.5;
            let gr = 0.13 + (0.06 - 0.13) * t, gg = 0.38 + (0.36 - 0.38) * t, gb = 0.15 + (0.30 - 0.15) * t;
            if (nB > 0.45) { gr += 0.12; gg += 0.08; } // sunlit meadows
            if (e.glowy) { gr *= 0.7; gb += 0.08; }
            r += (gr - r) * grass; g += (gg - g) * grass; bl += (gb - bl) * grass;
        }
        // hanging moss streaks just under the rim
        const moss = smooth(0.2, 0.8, nz2.noise3(x * 0.03, y * 0.004, z * 0.03)) * smooth(-0.1, -0.5, gy) * smooth(-H * 1.4, -H * 0.2, y) * (1 - under * 0.5);
        r += (0.12 - r) * moss * 0.6; g += (0.30 - g) * moss * 0.6; bl += (0.20 - bl) * moss * 0.6;

        color[v * 3] = lin(Math.max(0, r)) * ao;
        color[v * 3 + 1] = lin(Math.max(0, g)) * ao;
        color[v * 3 + 2] = lin(Math.max(0, bl)) * ao;

        // where bioluminescent veins may run (the veins themselves are drawn per pixel)
        let gw = Math.max(under, moss * 0.4);
        if (e.glowy) gw = Math.max(gw, grass * 0.8);
        glow[v] = gw;

        if (!isBridge && gy > 0.84 && rand() < treeChance) {
            const forest = nz2.noise3(x * 0.0022 + 9, z * 0.0022, 3);
            if (forest > -0.25) trees.push(x, y, z, 0.7 + rand() * 0.7, rand());
        }
        if (gy < -0.55 && rand() < vineChance && vines.length < 1800 * 4) vines.push(x, y, z, 0.4 + rand() * rand() * 1.8);
    }

    return {
        position: new Float32Array(pos),
        normal, color, glow,
        index: new Uint32Array(idx),
        trees: new Float32Array(trees),
        vines: new Float32Array(vines),
    };
}
