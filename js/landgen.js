// The land far below: a 160 km square of mountains, valleys, rivers, lakes and a
// coastline, generated once into a heightmap. Depressions are flood-filled into
// lakes and water is routed downhill so rivers follow the real valleys.

import { makeNoise } from "./noise.js";

export const LAND_N = 1024;          // heightmap resolution
export const LAND_SIZE = 160000;     // metres across
export const GROUND_Y = -12000;      // world height of sea level down there

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
    f32[0] = v;
    const x = u32[0], sign = (x >>> 16) & 0x8000;
    const e = ((x >>> 23) & 0xff) - 112;
    if (e <= 0) return sign;
    if (e >= 31) return sign | 0x7c00;
    return sign | (e << 10) | ((x & 0x7fffff) >>> 13);
}

// Returns RGBA half floats: terrain height, water surface, river strength, moisture
export function generateLand(seed = 77) {
    const N = LAND_N, n = makeNoise(seed), n2 = makeNoise(seed + 1);
    const h = new Float32Array(N * N), moist = new Float32Array(N * N);
    const km = LAND_SIZE / 1000;
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            const x = (i / (N - 1) - 0.5) * km, z = (j / (N - 1) - 0.5) * km;
            const wx = x + 7 * n.fbm(x * 0.025, z * 0.025, 1.7, 3), wz = z + 7 * n.fbm(x * 0.025 + 9, z * 0.025, 3.1, 3);
            // continents, with an ocean coast off to one side
            let cont = n.fbm(wx * 0.011 + 3.3, wz * 0.011 - 1.7, 0.3, 4) * 1.4;
            const coast = x * 0.62 + z * 0.78 + n.fbm(wx * 0.03, wz * 0.03, 7.7, 3) * 14;
            cont += 0.42 - smooth(32, 62, coast) * 0.95;
            const mMask = smooth(-0.05, 0.3, n2.fbm(wx * 0.018, wz * 0.018, 0.9, 3) + 0.08);
            // billowed noise: valleys along its creases join up into drainage networks
            let b = 0, amp = 0.5, f = 0.045;
            for (let o = 0; o < 5; o++) { b += amp * Math.abs(n2.noise3(wx * f, wz * f, 5.5 + o)); amp *= 0.5; f *= 2.05; }
            const crest = n.ridged(wx * 0.11, wz * 0.11, 8.1, 3);
            const land = smooth(-0.1, 0.25, cont);
            let y = cont * 1000 + mMask * land * (Math.pow(b * 1.6, 1.5) * 3600 + crest * crest * 700 * smooth(0.12, 0.4, b));
            y += n.fbm(wx * 0.16, wz * 0.16, 2.2, 4) * 140 + 40;
            // the land tilts gently toward the sea so valleys drain instead of pooling
            y += (62 - coast) * 6;
            h[j * N + i] = y;
            moist[j * N + i] = 0.55 + n2.fbm(x * 0.035, z * 0.035, 4.4, 4) * 1.1;
        }
    }

    // priority flood from the edges: fills basins into lakes and gives each cell
    // the neighbour its water drains to
    const filled = new Float32Array(N * N), parent = new Int32Array(N * N).fill(-1);
    const seen = new Uint8Array(N * N), order = new Int32Array(N * N);
    const hk = new Float32Array(N * N), hv = new Int32Array(N * N);
    let hs = 0, oi = 0;
    const push = (c, k) => {
        let i = hs++;
        while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
        hk[i] = k; hv[i] = c;
    };
    const pop = () => {
        const top = hv[0], k = hk[--hs], v = hv[hs];
        let i = 0;
        for (;;) {
            let c = i * 2 + 1;
            if (c >= hs) break;
            if (c + 1 < hs && hk[c + 1] < hk[c]) c++;
            if (hk[c] >= k) break;
            hk[i] = hk[c]; hv[i] = hv[c]; i = c;
        }
        hk[i] = k; hv[i] = v;
        return top;
    };
    for (let i = 0; i < N; i++) for (const c of [i, (N - 1) * N + i, i * N, i * N + N - 1]) {
        if (seen[c]) continue;
        seen[c] = 1; filled[c] = Math.max(h[c], 0); push(c, filled[c]);
    }
    const D = [-1, 1, -N, N, -N - 1, -N + 1, N - 1, N + 1];
    while (hs) {
        const c = pop();
        order[oi++] = c;
        const ci = c % N, cj = (c / N) | 0;
        for (let d = 0; d < 8; d++) {
            const nb = c + D[d];
            const ni = nb % N, nj = (nb / N) | 0;
            if (nb < 0 || nb >= N * N || Math.abs(ni - ci) > 1 || Math.abs(nj - cj) > 1 || seen[nb]) continue;
            seen[nb] = 1;
            parent[nb] = c;
            const f = filled[c];
            filled[nb] = h[nb] > f ? h[nb] : f <= 0 && h[nb] < 0 ? 0 : f + 0.001;
            push(nb, filled[nb]);
        }
    }
    // flow accumulation, upstream to downstream
    const acc = new Float32Array(N * N).fill(1);
    for (let k = oi - 1; k >= 0; k--) { const c = order[k], p = parent[c]; if (p >= 0) acc[p] += acc[c]; }

    const out = new Uint16Array(N * N * 4);
    const lo = Math.log(300), hi = Math.log(60000);
    for (let c = 0; c < N * N; c++) {
        const water = filled[c] - h[c] > 1.5 || (h[c] < 0 && filled[c] <= 0.01);
        const river = water ? 0 : smooth(lo, hi, Math.log(acc[c]));
        let m = moist[c] + river * 0.5 - smooth(1400, 3200, h[c]) * 0.6;
        out[c * 4] = toHalf(h[c] - river * 30);
        out[c * 4 + 1] = toHalf(water ? filled[c] : -9999);
        out[c * 4 + 2] = toHalf(river);
        out[c * 4 + 3] = toHalf(Math.min(1, Math.max(0, m)));
    }
    return out;
}
