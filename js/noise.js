// Seeded 3D simplex noise and helpers. No three.js here so the mesher worker can import it.

const GRAD = new Float32Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function makeNoise(seed = 1) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    const perm = new Uint8Array(512);
    const perm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; perm12[i] = perm[i] % 12; }

    const F3 = 1 / 3, G3 = 1 / 6;

    function noise3(x, y, z) {
        const s = (x + y + z) * F3;
        const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
        const t = (i + j + k) * G3;
        const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
        let i1, j1, k1, i2, j2, k2;
        if (x0 >= y0) {
            if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
            else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
            else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
        } else {
            if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
            else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
            else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        }
        const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
        const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
        const x3 = x0 - 1 + 0.5, y3 = y0 - 1 + 0.5, z3 = z0 - 1 + 0.5;
        const ii = i & 255, jj = j & 255, kk = k & 255;
        let n = 0, tt, g;
        tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
        if (tt > 0) { g = perm12[ii + perm[jj + perm[kk]]] * 3; tt *= tt; n += tt * tt * (GRAD[g] * x0 + GRAD[g + 1] * y0 + GRAD[g + 2] * z0); }
        tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
        if (tt > 0) { g = perm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; tt *= tt; n += tt * tt * (GRAD[g] * x1 + GRAD[g + 1] * y1 + GRAD[g + 2] * z1); }
        tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
        if (tt > 0) { g = perm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; tt *= tt; n += tt * tt * (GRAD[g] * x2 + GRAD[g + 1] * y2 + GRAD[g + 2] * z2); }
        tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
        if (tt > 0) { g = perm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; tt *= tt; n += tt * tt * (GRAD[g] * x3 + GRAD[g + 1] * y3 + GRAD[g + 2] * z3); }
        return 32 * n; // roughly -1..1
    }

    function fbm(x, y, z, oct = 4) {
        let sum = 0, amp = 0.5, f = 1;
        for (let o = 0; o < oct; o++) {
            sum += amp * noise3(x * f, y * f, z * f);
            f *= 2.03; amp *= 0.5;
        }
        return sum;
    }

    function ridged(x, y, z, oct = 3) {
        let sum = 0, amp = 0.5, f = 1;
        for (let o = 0; o < oct; o++) {
            sum += amp * (1 - Math.abs(noise3(x * f, y * f, z * f)));
            f *= 2.1; amp *= 0.5;
        }
        return sum;
    }

    return { noise3, fbm, ridged };
}
