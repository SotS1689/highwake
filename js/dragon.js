// The sky-dragon you ride: a long, sleek body with a sculpted head, horns, frills
// and a row of dorsal spines, membrane wings on jointed arm and finger bones, and
// hind legs tucked under like a bird's. Everything is rebuilt on the CPU each frame
// (a few thousand vertices) so the spine can sway, the neck can lead into turns and
// the wings can glide, flap and fold. The skin is shaded with shingled scales,
// belly plates, horn ridges and membrane veins, a cheap subsurface-scattering term
// (wrap lighting plus light shining through thin parts), a sky reflection and the
// sun's own shadow of the dragon on itself.
// Local frame: +z forward, +y up, +x is the dragon's left.

import * as THREE from "three";
import { shared } from "./gfx.js";

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const TAU = Math.PI * 2;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-(x * x) / (w * w));
const mix3 = (a, b, t) => a.map((v, q) => v + (b[q] - v) * t);

// linear-space palette
const COL = {
    top: [0.010, 0.033, 0.062], flank: [0.02, 0.15, 0.27], belly: [0.5, 0.41, 0.27], stripe: [0.78, 0.3, 0.05],
    face: [0.09, 0.2, 0.28], mask: [0.004, 0.012, 0.025], mouth: [0.05, 0.008, 0.012], leg: [0.025, 0.12, 0.21],
    bone: [0.72, 0.64, 0.48], horn: [0.05, 0.06, 0.07], claw: [0.03, 0.028, 0.025], tooth: [0.85, 0.82, 0.72],
    wingIn: [0.012, 0.04, 0.075], wingMid: [0.03, 0.12, 0.21], wingEdge: [0.42, 0.15, 0.035],
};

// skin attribute: x = surface kind, y = thinness (how much light passes through), z = scale size
const SCALES = 0, PLATES = 1, HORN = 2, MEMBRANE = 3;

// body profile by z: [z, half width, half height, crest height]
const PROF = [
    [7.8, 0.05, 0.04, 0], [7.55, 0.19, 0.14, 0], [7.1, 0.29, 0.23, 0], [6.6, 0.37, 0.29, 0],
    [6.15, 0.49, 0.39, 0], [5.75, 0.55, 0.45, 0], [5.35, 0.43, 0.41, 0], [4.9, 0.33, 0.37, 0.1],
    [3.9, 0.4, 0.46, 0.2], [2.7, 0.66, 0.74, 0.3], [1.5, 1.05, 1.08, 0.36], [0.4, 1.18, 1.18, 0.38],
    [-0.9, 1.06, 1.02, 0.36], [-2.3, 0.86, 0.8, 0.32], [-4.1, 0.6, 0.56, 0.28], [-6.6, 0.38, 0.36, 0.22],
    [-9.2, 0.22, 0.21, 0.15], [-11.4, 0.13, 0.11, 0.08], [-12.4, 0.42, 0.06, 0], [-13.4, 0.52, 0.045, 0],
    [-14.3, 0.3, 0.035, 0], [-15.0, 0.02, 0.02, 0],
];
const Z0 = PROF[0][0], Z1 = PROF[PROF.length - 1][0];
const HEAD_Z = 5.3;           // the skull is rigid in front of this
const SIDES = 32;

// rings are packed densely on the head, looser down the tail
const RING_Z = [];
for (let z = Z0; z > Z1; z -= z > 5 ? 0.055 : z > -4 ? 0.13 : 0.2) RING_Z.push(z);
RING_Z.push(Z1);

function profAt(z) {
    for (let i = 0; i < PROF.length - 1; i++) {
        const a = PROF[i], b = PROF[i + 1];
        if (z <= a[0] && z >= b[0]) {
            let t = (a[0] - z) / (a[0] - b[0]);
            t = t * t * (3 - 2 * t);
            return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
        }
    }
    return [0.02, 0.02, 0];
}

// angle of the mouth line below the spine (it rises toward the jaw hinge)
const mouthAngle = (z) => 2.0 - 0.3 * smooth(7.6, 5.7, z);

// Cross-section at z and angle th (0 = spine, PI = belly, positive toward the left):
// the offset [x, y] in the ring's frame, with skull, muscle and rib detail
function section(z, th) {
    const [hw, hh, crest] = profAt(z);
    const head = smooth(5.1, 5.6, z);
    const s = Math.sin(th), c = Math.cos(th);
    const n = 2 + head * 0.9;                     // a squarer skull
    let x = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * hw;
    let y = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * hh;
    if (y < 0) y *= 0.85;
    else y *= 1 - 0.18 * head;                    // flat brow
    let a = Math.abs(th % TAU); if (a > Math.PI) a = TAU - a;
    let dr = crest * 0.3 * gauss(a, 0.13);        // dorsal ridge
    if (z > 5.2) {
        dr += 0.09 * gauss(z - 6.15, 0.28) * gauss(a - 0.8, 0.3);       // brow ridges
        dr -= 0.05 * gauss(z - 6.38, 0.14) * gauss(a - 1.12, 0.16);     // eye sockets
        dr += 0.07 * gauss(z - 5.75, 0.3) * gauss(a - 1.65, 0.35);      // jaw muscles
        dr += 0.035 * gauss(z - 7.42, 0.1) * gauss(a - 0.5, 0.18);      // nostrils
        const mA = mouthAngle(z), lip = smooth(5.55, 5.9, z);
        dr -= 0.035 * gauss(a - mA, 0.06) * lip;
        if (a > mA) x *= 1 - 0.08 * lip;          // the lower jaw sits inside the upper
    }
    dr += 0.17 * gauss(z - 1.4, 0.9) * gauss(a - 0.9, 0.45);           // shoulders under the wing roots
    dr += 0.12 * gauss(z - 1.9, 0.8) * gauss(a - Math.PI, 0.6);        // chest keel
    dr += 0.14 * gauss(z + 2.5, 0.7) * gauss(a - 1.95, 0.45);          // haunches
    dr += 0.016 * Math.sin(z * 9) * smooth(-1.4, -0.6, z) * smooth(2.4, 1.6, z) * gauss(a - 1.6, 0.5);   // ribs
    const r = Math.hypot(x, y) || 1;
    return [x + (x / r) * dr, y + (y / r) * dr];
}

// ---- skin shader -------------------------------------------------------------------
const SKIN_GLSL = `
    uniform float uGlow, uTime; uniform vec3 uSunDir, uSunColor, uSkyCol, uGroundCol;
    varying float vGlow; varying vec2 vM; varying vec3 vSkin; varying float vNy;
    float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    // shingled scales: each row overlaps the root of the row behind it.
    // returns height, a per-scale random value and how close we are to the free edge
    vec3 scales(vec2 s){
        vec3 best = vec3(0.5, 0.5, 0.0); float bestY = 1e9;
        vec2 cs = floor(s);
        for (int j = -1; j <= 0; j++) for (int i = -1; i <= 1; i++) {
            vec2 c = cs + vec2(float(i), float(j));
            vec2 root = vec2(c.x + mod(c.y, 2.0) * 0.5 + 0.5, c.y);
            vec2 d = (s - root) / vec2(0.62, 1.15);
            float r = length(d);
            if (d.y > -0.12 && r < 1.0 && c.y < bestY) {
                bestY = c.y;
                float h = 0.3 + 0.45 * clamp(d.y, 0.0, 1.0) + 0.25 * (1.0 - abs(d.x) * 1.6);
                best = vec3(h * smoothstep(1.0, 0.86, r) + 0.3 * (1.0 - smoothstep(1.0, 0.86, r)), hash2(c), smoothstep(0.7, 1.0, r));
            }
        }
        return best;
    }
    vec3 bumpN(vec3 p, vec3 n, vec2 dh, float fd){
        vec3 sx = normalize(dFdx(p)), sy = normalize(dFdy(p));
        vec3 r1 = cross(sy, n), r2 = cross(n, sx);
        float det = dot(sx, r1) * fd;
        return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
    }`;

export function skinMaterial(membrane) {
    const m = new THREE.MeshPhysicalMaterial({
        vertexColors: true, metalness: 0, side: membrane ? THREE.DoubleSide : THREE.FrontSide,
        roughness: membrane ? 0.68 : 0.46,
        clearcoat: membrane ? 0.12 : 0.35, clearcoatRoughness: 0.32,
        iridescence: membrane ? 0 : 0.3, iridescenceIOR: 1.5, iridescenceThicknessRange: [200, 450],
    });
    m.userData.u = { uSkyCol: { value: new THREE.Color(0.4, 0.5, 0.6) }, uGroundCol: { value: new THREE.Color(0.2, 0.2, 0.2) } };
    m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, m.userData.u, {
            uGlow: shared.uGlow, uTime: shared.uTime, uSunDir: shared.uSunDir, uSunColor: shared.uSunColor,
            uDragonShade: shared.uDragonShade,
        });
        sh.vertexShader = sh.vertexShader
            .replace("#include <common>", "#include <common>\nattribute float glow;\nattribute vec3 skin;\nvarying float vGlow;\nvarying vec2 vM;\nvarying vec3 vSkin;\nvarying float vNy;")
            .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvNy = objectNormal.y;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = glow;\nvM = uv;\nvSkin = skin;");
        sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", "#include <common>\nuniform float uDragonShade;\n" + SKIN_GLSL)
            .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.directDiffuse *= uDragonShade;\nreflectedLight.directSpecular *= uDragonShade;")
            .replace("#include <color_fragment>", `#include <color_fragment>
                float sH = 0.5, edge = 0.0, vein = 0.0, thin = vSkin.y;
                ${membrane ? `
                // veins fanning out from the bones, branching once, and fine wrinkles
                float vx = vM.x * 1.2 + sin(vM.y * 1.3 + vM.x * 2.1) * 0.22 + sin(vM.y * 4.7 + vM.x * 0.7) * 0.05;
                float bx = vM.x * 2.4 + vM.y * 0.55 + sin(vM.y * 2.3 + vM.x * 3.0) * 0.3;
                float v1 = abs(fract(vx) - 0.5), v2 = abs(fract(bx) - 0.5);
                float aaV = clamp(1.3 - fwidth(bx) * 5.0, 0.0, 1.0);
                vein = clamp((1.0 - smoothstep(0.0, 0.055, v1)) + (1.0 - smoothstep(0.0, 0.03, v2)) * smoothstep(0.8, 2.4, vM.y) * 0.55, 0.0, 1.0) * aaV;
                // fine skin creases running across the veins
                float wr = sin(vM.y * 17.0 + sin(vM.x * 5.0) * 1.6 + sin(vM.x * 13.0) * 0.3) * 0.5 + 0.5;
                sH = 0.45 + vein * 0.45 + wr * 0.08 * aaV;
                thin *= 1.0 - vein * 0.55;
                // the underside is paler and warmer
                float under = step(vNy * (gl_FrontFacing ? 1.0 : -1.0), 0.0) * step(vSkin.x, 3.5);
                diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.7 + vec3(0.035, 0.022, 0.012), under);
                diffuseColor.rgb *= 1.0 - vein * 0.3;` : `
                if (vSkin.x > 1.5) {
                    // horn and claw: growth rings and lengthwise grain
                    float ring = sin(vM.y * 48.0 + sin(vM.x * 9.0) * 0.6) * 0.5 + 0.5;
                    float grain = sin(vM.x * 60.0 + vM.y * 3.0) * 0.5 + 0.5;
                    float aaH = clamp(1.3 - fwidth(vM.y * 48.0) * 0.3, 0.0, 1.0);
                    sH = mix(0.5, ring * 0.7 + grain * 0.3, aaH);
                    diffuseColor.rgb *= 0.85 + 0.3 * sH;
                } else {
                    vec2 sz = vec2(0.17, 0.135) * vSkin.z;
                    vec3 sc = scales(vM / sz);
                    // belly plates: wide shingled bands across the underside
                    float f = fract(vM.y / (0.22 * vSkin.z) + 0.3);
                    vec3 pl = vec3(0.35 + 0.5 * f - 0.45 * smoothstep(0.88, 1.0, f), hash2(vec2(floor(vM.y / (0.22 * vSkin.z) + 0.3), 7.0)), smoothstep(0.86, 1.0, f));
                    float plate = smoothstep(0.3, 0.7, vSkin.x);
                    sc = mix(sc, pl, plate);
                    float aa = clamp(1.4 - length(fwidth(vM / sz)) * 2.2, 0.0, 1.0);
                    sH = mix(0.5, sc.x, aa); edge = sc.z * aa;
                    // each scale a little different in shade and hue
                    diffuseColor.rgb *= (0.78 + 0.32 * sH) * (1.0 - 0.35 * edge) * mix(vec3(1.0), 0.82 + vec3(0.3, 0.42, 0.3) * sc.y, aa);
                }`}`)
            .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
                roughnessFactor = clamp(roughnessFactor + edge * 0.25 - (vSkin.x > 1.5 && vSkin.x < 2.5 ? 0.2 : 0.0), 0.05, 1.0);`)
            .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
                normal = bumpN(-vViewPosition, normal, vec2(dFdx(sH), dFdy(sH)) * ${membrane ? "0.35" : "0.75"}, faceDirection);`)
            .replace("#include <clearcoat_normal_fragment_begin>", "#ifdef USE_CLEARCOAT\nvec3 clearcoatNormal = normal;\n#endif")
            .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
                {
                    vec3 Vv = normalize(vViewPosition);
                    vec3 Lv = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
                    float day = clamp(uSunDir.y * 4.0 + 0.6, 0.0, 1.0);
                    // subsurface scattering: light wraps past the terminator and shines through thin parts
                    vec3 sss = ${membrane ? "mix(diffuseColor.rgb * 4.0, vec3(1.0, 0.3, 0.08), 0.6)" : "mix(diffuseColor.rgb * 3.5, vec3(0.9, 0.32, 0.12), 0.3)"};
                    float NdL = dot(normal, Lv);
                    float wrap = max(0.0, (NdL + 0.6) / 1.6) - max(0.0, NdL);
                    float trans = pow(clamp(dot(Vv, -normalize(Lv + normal * 0.3)), 0.0, 1.0), ${membrane ? "1.6" : "5.0"});
                    totalEmissiveRadiance += uSunColor * sss * (wrap * ${membrane ? "0.24" : "(0.12 + 0.3 * thin)"} + trans * thin * ${membrane ? "2.8" : "1.2"}) * day;
                    ${membrane ? `// sunlight on the far face glows through the membrane from any view angle
                    totalEmissiveRadiance += uSunColor * sss * max(0.0, -NdL) * thin * 0.35 * day;` : ""}
                    // the sky and the land below, reflected in the scales
                    vec3 Rw = (vec4(reflect(-Vv, normal), 0.0) * viewMatrix).xyz;
                    float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(normal, Vv), 0.0, 1.0), 5.0);
                    totalEmissiveRadiance += mix(uGroundCol, uSkyCol, smoothstep(-0.25, 0.35, Rw.y)) * fres * ${membrane ? "0.1" : "0.28"} * (1.0 - edge * 0.7);
                    // bioluminescent markings, a slow pulse running down the body
                    float pulse = 0.75 + 0.25 * sin(uTime * 2.0 - vM.y * 1.4);
                    ${membrane ? "float gm = smoothstep(0.955, 0.99, vSkin.z) + vein * 0.25;" : "float gm = 1.0;"}
                    totalEmissiveRadiance += vec3(0.25, 0.85, 1.0) * vGlow * gm * pulse * (0.04 + uGlow * uGlow * 2.2);
                }`);
    };
    m.customProgramCacheKey = () => "dskin" + (membrane ? "m" : "");
    return m;
}

export function eyeMaterial() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 3, 64, 64, 64);
    grd.addColorStop(0, "#fff4b0"); grd.addColorStop(0.3, "#ffc43a"); grd.addColorStop(0.72, "#d4520c"); grd.addColorStop(1, "#2a0702");
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 160; i++) {
        const a = Math.random() * TAU;
        g.strokeStyle = Math.random() < 0.5 ? "rgba(255,240,180,0.18)" : "rgba(90,20,0,0.22)";
        g.lineWidth = 1 + Math.random();
        g.beginPath(); g.moveTo(64 + Math.cos(a) * 9, 64 + Math.sin(a) * 9); g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58); g.stroke();
    }
    g.fillStyle = "#000"; g.beginPath(); g.ellipse(64, 64, 6, 42, 0, 0, TAU); g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshPhysicalMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.3, roughness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.12 });
}

// Tapered tubes along short polylines (bones, legs, toes, horns, spines), each with
// one ring per point, oriented by parallel transport and rewritten every frame
class Paths {
    constructor(sides) { this.sides = sides; this.list = []; this.nV = 0; this.tmp = [V(), V(), V(), V()]; }

    // col and glow are values or functions of t (0 at the root, 1 at the tip)
    add(n, col, { glow = 0, skin = [SCALES, 0.2, 0.6], r = 0.1, len = 1 } = {}) {
        this.list.push({ n, off: this.nV, col, glow, skin, r, len });
        this.nV += n * (this.sides + 1);
        return this.list.length - 1;
    }

    build(material) {
        const S = this.sides, nV = this.nV;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nV * 3), 3));
        const uv = new Float32Array(nV * 2), col = new Float32Array(nV * 3), glow = new Float32Array(nV), skin = new Float32Array(nV * 3);
        const idx = [];
        for (const p of this.list) {
            for (let k = 0; k < p.n; k++) {
                const t = k / (p.n - 1);
                const c = typeof p.col === "function" ? p.col(t) : p.col;
                const gl = typeof p.glow === "function" ? p.glow(t) : p.glow;
                for (let j = 0; j <= S; j++) {
                    const v = p.off + k * (S + 1) + j;
                    col.set(c, v * 3); glow[v] = gl; skin.set(p.skin, v * 3);
                    uv[v * 2] = (j / S) * TAU * p.r; uv[v * 2 + 1] = t * p.len;
                }
                if (k < p.n - 1) for (let j = 0; j < S; j++) {
                    const a = p.off + k * (S + 1) + j, b = a + 1, c2 = a + S + 1, d = c2 + 1;
                    idx.push(a, c2, b, b, c2, d);
                }
            }
        }
        geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
        geo.setAttribute("glow", new THREE.BufferAttribute(glow, 1));
        geo.setAttribute("skin", new THREE.BufferAttribute(skin, 3));
        geo.setIndex(idx);
        this.geo = geo;
        this.mesh = new THREE.Mesh(geo, material);
        return this.mesh;
    }

    // pts: Vector3s, radii: numbers; flat squashes the tube along ref (spines are blades)
    set(id, pts, radii, ref = UP, flat = 1) {
        const p = this.list[id], S = this.sides, P = this.geo.attributes.position.array;
        const [d, n1, n2, q] = this.tmp;
        for (let k = 0; k < p.n; k++) {
            d.subVectors(pts[Math.min(p.n - 1, k + 1)], pts[Math.max(0, k - 1)]).normalize();
            if (k === 0) {
                n1.copy(Math.abs(ref.dot(d)) > 0.95 ? q.set(d.y, d.z, d.x) : ref);
            }
            n1.addScaledVector(d, -n1.dot(d)).normalize();       // carry the frame along the path
            n2.crossVectors(d, n1);
            const c = pts[k], r = radii[k];
            for (let j = 0; j <= S; j++) {
                const th = (j / S) * TAU, cs = Math.cos(th) * r * flat, sn = Math.sin(th) * r;
                const o = (p.off + k * (S + 1) + j) * 3;
                P[o] = c.x + n1.x * cs + n2.x * sn; P[o + 1] = c.y + n1.y * cs + n2.y * sn; P[o + 2] = c.z + n1.z * cs + n2.z * sn;
            }
        }
    }

    end() {
        this.geo.attributes.position.needsUpdate = true;
        this.geo.computeVertexNormals();
        const N = this.geo.attributes.normal.array, S = this.sides;
        for (const p of this.list) for (let k = 0; k < p.n; k++) weld(N, p.off + k * (S + 1), p.off + k * (S + 1) + S);
    }
}

// average the normals of two vertices that sit on the same spot (a uv seam)
function weld(N, a, b) {
    const x = N[a * 3] + N[b * 3], y = N[a * 3 + 1] + N[b * 3 + 1], z = N[a * 3 + 2] + N[b * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    N[a * 3] = N[b * 3] = x / l; N[a * 3 + 1] = N[b * 3 + 1] = y / l; N[a * 3 + 2] = N[b * 3 + 2] = z / l;
}

export class Dragon {
    constructor() {
        this.group = new THREE.Group();
        this.time = 0;
        this.phase = 0;          // wingbeat phase, 0 = wings at the top
        this.amp = 0;            // wingbeat strength 0..1
        this.downstroke = 0;     // 0..1 while the wings drive down
        this.beat = false;       // true on the frame a downstroke starts
        this.legs = 0;           // 0 tucked, 1 reaching forward (braking)
        this.brakeAmt = 0;       // 0..1 wings flaring into the air-brake pose
        this.brakeVel = 0;
        this.tipL = V(); this.tipR = V();
        this.ringOf = new Map();

        this.skin = skinMaterial(false);
        this.membraneMat = skinMaterial(true);
        this._buildBody();
        this._buildWings();
        this._buildPaths();
        this.eyeMat = eyeMaterial();
        // only the outward-facing cap of each eye, so the iris texture maps onto it
        const eyeGeo = new THREE.SphereGeometry(0.1, 20, 14, Math.PI * 0.6, Math.PI * 0.8, Math.PI * 0.1, Math.PI * 0.8);
        this.eyes = [0, 1].map(() => {
            const e = new THREE.Mesh(eyeGeo, this.eyeMat);
            e.scale.set(1, 0.72, 1.35);
            e.matrixAutoUpdate = false;
            this.group.add(e);
            return e;
        });
        for (const c of this.group.children) c.frustumCulled = false;
        this.m4 = new THREE.Matrix4();
        this.update(0, { speed: 70, boosting: false, brake: false, rates: V(), climb: 0 });
    }

    // ---- body tube ---------------------------------------------------------------
    _buildBody() {
        const R = RING_Z.length, nV = R * (SIDES + 1);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nV * 3), 3));
        const uv = new Float32Array(nV * 2), col = new Float32Array(nV * 3), glow = new Float32Array(nV), skin = new Float32Array(nV * 3);
        this.OX = new Float32Array(nV); this.OY = new Float32Array(nV);
        this.breath = RING_Z.map((z) => gauss(z - 0.6, 1.8));
        for (let i = 0; i < R; i++) {
            const z = RING_Z[i];
            const [hw, hh] = profAt(z);
            const perim = Math.PI * (hw + hh);
            const head = smooth(5.1, 5.6, z);
            const thin = 1 - smooth(0.04, 0.6, Math.min(hw, hh));
            for (let j = 0; j <= SIDES; j++) {
                // the seam runs along the belly, where the plates hide it
                const th = Math.PI + (j / SIDES) * TAU;
                const k = i * (SIDES + 1) + j;
                const [ox, oy] = section(z, th);
                this.OX[k] = ox; this.OY[k] = oy;
                uv[k * 2] = (j / SIDES) * perim; uv[k * 2 + 1] = Z0 - z;
                const up = Math.cos(th);
                let a = Math.abs(th % TAU); if (a > Math.PI) a = TAU - a;
                let c = up > 0 ? mix3(COL.top, COL.flank, 1 - up) : mix3(COL.flank, COL.belly, smooth(-0.1, -0.7, up));
                // chevron stripes down the back and tail
                const u = Z0 - z - a * 0.45;
                const sv = Math.sin(u * 2.1 + Math.sin(u * 0.6) * 1.5);
                if (z < 5.0 && z > -12.2) c = mix3(c, COL.stripe, smooth(0.74, 0.9, sv) * smooth(0.0, 0.45, up) * 0.9);
                if (z > 5.2) {
                    c = mix3(c, COL.face, 0.55 * smooth(5.6, 7.4, z) * smooth(-0.2, 0.5, up));
                    c = mix3(c, COL.mask, 0.85 * gauss(z - 6.3, 0.4) * gauss(a - 1.0, 0.35));
                    c = mix3(c, COL.mouth, gauss(a - mouthAngle(z), 0.05) * smooth(5.55, 5.9, z));
                    c = mix3(c, COL.mask, gauss(z - 7.47, 0.05) * gauss(a - 0.5, 0.09));
                }
                col.set(c, k * 3);
                // bioluminescent dots along each flank, the spine and the cheeks
                const dot = Math.abs(((Z0 - z) * 1.6) % 1 - 0.5) < 0.18;
                glow[k] = (Math.abs(a - 1.45) < 0.07 && dot && z < 4.8 && z > -12 ? 1 : 0)
                    + (a < 0.06 && dot && z < 4.6 && z > -12 ? 0.35 : 0)
                    + gauss(a - 1.32, 0.05) * smooth(5.3, 5.6, z) * smooth(6.9, 6.5, z) * 0.8;
                const plate = smooth(-0.55, -0.8, up) * (z < 7.2 ? 1 : 0) * smooth(-12.2, -11, z);
                const size = (0.75 + 0.45 * smooth(-0.2, 0.8, up)) * (1 - head * 0.45) * (z < -6 ? 0.8 : 1);
                skin.set([plate, thin * 0.9 + 0.05, size], k * 3);
            }
        }
        geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
        geo.setAttribute("glow", new THREE.BufferAttribute(glow, 1));
        geo.setAttribute("skin", new THREE.BufferAttribute(skin, 3));
        const idx = [];
        for (let i = 0; i < R - 1; i++) {
            for (let j = 0; j < SIDES; j++) {
                const a = i * (SIDES + 1) + j, b = a + 1, c = a + SIDES + 1, d = c + 1;
                idx.push(a, b, c, b, d, c);
            }
        }
        geo.setIndex(idx);
        this.bodyGeo = geo;
        this.group.add(new THREE.Mesh(geo, this.skin));
        this.C = RING_Z.map(() => V());
        this.T = RING_Z.map(() => V());
        this.X = RING_Z.map(() => V());
        this.U = RING_Z.map(() => V());
    }

    // centreline point at z for this frame's sway, turn and wingbeat
    _spine(z, st, out) {
        const t = this.time, r = st.rates;
        const sway = 0.35 + (1 - this.amp) * 0.2;
        const tail = Math.min(1, Math.max(0, (-z - 1) / 14)), neck = Math.min(1, Math.max(0, (z - 2) / 5.7));
        const t2 = tail * tail, n2 = neck * neck;
        const x = t2 * (Math.sin(t * 1.5 - tail * 3.2) * sway + r.y * 2.6 - r.z * 0.6) - n2 * r.y * 1.4;
        const y = 0.55 * smooth(2, 5.6, z) - 0.25 * t2 + n2 * r.x * 0.7 - t2 * r.x * 1.8
            + t2 * Math.sin(t * 1.1 - tail * 2.5) * 0.25 - this.downstroke * 0.15 * (1 - tail);
        return out.set(x, y, z);
    }

    _updateBody(st) {
        const { C, T, X, U } = this, R = RING_Z.length;
        const h0 = this._spine(HEAD_Z, st, V()), hd = this._spine(HEAD_Z + 0.1, st, V()).sub(h0).normalize();
        for (let i = 0; i < R; i++) {
            const z = RING_Z[i];
            if (z > HEAD_Z) C[i].copy(h0).addScaledVector(hd, (z - HEAD_Z) / hd.z);   // the skull doesn't bend
            else this._spine(z, st, C[i]);
        }
        for (let i = 0; i < R; i++) {
            T[i].subVectors(C[Math.max(0, i - 1)], C[Math.min(R - 1, i + 1)]).normalize();
            X[i].crossVectors(UP, T[i]).normalize();
            U[i].crossVectors(T[i], X[i]);
        }
        const P = this.bodyGeo.attributes.position.array, OX = this.OX, OY = this.OY;
        const breathe = Math.sin(this.time * 1.6) * 0.02;
        for (let i = 0; i < R; i++) {
            const b = 1 + breathe * this.breath[i], c = C[i], x = X[i], u = U[i];
            for (let j = 0; j <= SIDES; j++) {
                const k = i * (SIDES + 1) + j, sx = OX[k] * b, sy = OY[k] * b;
                P[k * 3] = c.x + x.x * sx + u.x * sy;
                P[k * 3 + 1] = c.y + x.y * sx + u.y * sy;
                P[k * 3 + 2] = c.z + x.z * sx + u.z * sy;
            }
        }
        this.bodyGeo.attributes.position.needsUpdate = true;
        this.bodyGeo.computeVertexNormals();
        const N = this.bodyGeo.attributes.normal.array;
        for (let i = 0; i < R; i++) weld(N, i * (SIDES + 1), i * (SIDES + 1) + SIDES);
    }

    ring(z) {
        let best = this.ringOf.get(z);
        if (best !== undefined) return best;
        best = 0;
        for (let i = 0; i < RING_Z.length; i++) if (Math.abs(RING_Z[i] - z) < Math.abs(RING_Z[best] - z)) best = i;
        this.ringOf.set(z, best);
        return best;
    }

    // a point on (or lift above) the skin at z and angle th, in dragon space
    surf(z, th, lift = 0, out = V()) {
        const i = this.ring(z), [sx, sy] = section(RING_Z[i], th);
        const r = Math.hypot(sx, sy) || 1, k = 1 + lift / r;
        return out.copy(this.C[i]).addScaledVector(this.X[i], sx * k).addScaledVector(this.U[i], sy * k);
    }

    // ---- wings and frills --------------------------------------------------------
    // Each wing: an inner panel (shoulder-elbow-wrist leading edge back to the body)
    // and three outer panels fanned between the four fingers. Each frill behind the
    // jaw is two small panels between three spines.
    _buildWings() {
        this.GI = [13, 8];
        this.GO = [8, 7];
        this.GF = [5, 4];
        const perWing = this.GI[0] * this.GI[1] + 3 * this.GO[0] * this.GO[1];
        const perFrill = 2 * this.GF[0] * this.GF[1];
        const nV = perWing * 2 + perFrill * 2;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nV * 3), 3));
        const uv = new Float32Array(nV * 2), col = new Float32Array(nV * 3), glow = new Float32Array(nV), skin = new Float32Array(nV * 3);
        const idx = [];
        const grid = (o, nu, nv, flip) => {
            for (let a = 0; a < nu - 1; a++) for (let b = 0; b < nv - 1; b++) {
                const p = o + a * nv + b, q = p + 1, r = p + nv, s = r + 1;
                if (flip) idx.push(p, q, r, q, s, r); else idx.push(p, r, q, q, r, s);
            }
        };
        let o = 0;
        for (let w = 0; w < 2; w++) {
            const panels = [this.GI, this.GO, this.GO, this.GO];
            panels.forEach(([nu, nv], pi) => {
                for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
                    const k = o + a * nv + b;
                    const u = a / (nu - 1), v = b / (nv - 1);
                    // v runs from the bones (0) to the trailing edge (1)
                    const span = pi === 0 ? u * 0.4 : 0.4 + ((pi - 1 + u) / 3) * 0.6;
                    const tEdge = smooth(0.84, 0.99, v);
                    let c = mix3(COL.wingIn, COL.wingMid, smooth(0.0, 0.6, v) * (0.5 + span * 0.5));
                    c = mix3(c, COL.wingEdge, tEdge * 0.75);
                    col.set(c, k * 3);
                    uv[k * 2] = pi === 0 ? u * 6 : (pi + u) * 5; uv[k * 2 + 1] = v * 5;
                    glow[k] = 0.35;
                    // thicker near the bones and the body, thinnest out toward the trailing edge;
                    // z carries v so the shader can draw a thin glowing rim
                    const thick = Math.max(smooth(0.35, 0, v), pi === 0 ? smooth(0.3, 0, u) * 0.8 : 0);
                    skin.set([MEMBRANE, 0.25 + 0.75 * (1 - thick) * (0.7 + 0.3 * v), v], k * 3);
                }
                // keep every panel's normal pointing up out of the wing's top face
                grid(o, nu, nv, (w === 1) !== (pi > 0));
                o += nu * nv;
            });
        }
        this.frillStart = o;
        for (let f = 0; f < 4; f++) {
            const [nu, nv] = this.GF;
            for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
                const k = o + a * nv + b, v = b / (nv - 1);
                col.set(mix3(COL.wingMid, COL.wingEdge, smooth(0.5, 1, v) * 0.8), k * 3);
                uv[k * 2] = ((f % 2) + a / (nu - 1)) * 2; uv[k * 2 + 1] = v * 1.5;
                glow[k] = 0.6;
                skin.set([MEMBRANE + 1, 1, v], k * 3);      // frills: no paler underside
            }
            grid(o, nu, nv, f >= 2);
            o += nu * nv;
        }
        geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
        geo.setAttribute("glow", new THREE.BufferAttribute(glow, 1));
        geo.setAttribute("skin", new THREE.BufferAttribute(skin, 3));
        geo.setIndex(idx);
        this.wingGeo = geo;
        this.perWing = perWing;
        this.group.add(new THREE.Mesh(geo, this.membraneMat));
        this.wp = {};
        for (const k of ["S", "E", "W", "B", "F0", "F1", "F2", "F3", "Xa", "Za", "Na", "Xb", "Zb", "Nb", "t0", "t1", "t2", "t3", "bend"]) this.wp[k] = V();
    }

    // wing points for side s (+1 left, -1 right) in dragon space
    _wingPose(s, st) {
        const p = this.wp;
        const A = this.amp, ph = this.phase;
        const brake = this.brakeAmt;
        const glide = 0.08 + Math.sin(this.time * 0.9 + s) * 0.03;
        const phi1 = glide * (1 - A) + A * (0.18 + 0.8 * Math.cos(ph)) + brake * 0.35 - s * st.rates.z * 0.06;
        const phi2 = phi1 + A * 0.4 * Math.cos(ph - 1.0) - 0.06 * (1 - A);
        const fold = A * Math.max(0, -Math.sin(ph)) * 0.75 + brake * 0.2;
        const aoa = brake * 0.55 + A * 0.25 * Math.sin(ph);
        // inner wing frame
        const ci = Math.cos(phi1), si = Math.sin(phi1);
        p.Xa.set(s * ci, si, 0);
        p.Na.set(-s * si, ci, 0);
        p.Za.set(0, 0, 1).multiplyScalar(Math.cos(aoa)).addScaledVector(p.Na, Math.sin(aoa));
        this._wingRoot(s, 0, p.S);           // the shoulder sits on the body and moves with it
        const at = (out, base, X, Z, a, c) => out.copy(base).addScaledVector(X, a).addScaledVector(Z, c);
        // elbow folds back on the upstroke
        at(p.E, p.S, p.Xa, p.Za, 2.7 * (1 - fold * 0.25), -1.3 - fold * 0.8);
        at(p.W, p.E, p.Xa, p.Za, 3.5 * (1 - fold * 0.45), 1.9 - fold * 1.6);
        // outer wing frame, lagging the inner one
        const co = Math.cos(phi2), so = Math.sin(phi2);
        p.Xb.set(s * co, so, 0);
        p.Nb.set(-s * so, co, 0);
        p.Zb.set(0, 0, 1).multiplyScalar(Math.cos(aoa)).addScaledVector(p.Nb, Math.sin(aoa));
        const fingers = [[6.0, -1.5], [4.8, -3.7], [3.1, -5.0], [1.3, -5.5]];
        const sweep = fold * 0.9;
        fingers.forEach(([a, c], i) => {
            const ca = Math.cos(sweep), sa = Math.sin(sweep);
            const a2 = (a * ca + c * sa) * (1 - fold * 0.2), c2 = -a * sa + c * ca;
            at(p["F" + i], p.W, p.Xb, p.Zb, a2, c2);
        });
        // fingers bow backward and down a little, like a bat's
        p.bend.copy(p.Zb).multiplyScalar(-0.06).addScaledVector(p.Nb, -0.05);
        this._wingRoot(s, 1, p.B);
        return p;
    }

    // where the wing meets the body: v = 0 at the shoulder, 1 at the hip end of the root,
    // following the upper flank just above the skin
    _wingRoot(s, v, out) {
        return this.surf(1.5 + (-3.6 - 1.5) * v, s * (0.72 + 0.4 * v), 0.01, out);
    }

    _writeWing(s, side, st) {
        const p = this._wingPose(s, st);
        const P = this.wingGeo.attributes.position.array;
        let o = side * this.perWing;
        const cup = 0.25 + this.downstroke * 0.45 + this.brakeAmt * 0.3;
        const flut = Math.min(1, Math.max(0, (st.speed - 50) / 60)) * 0.05;
        const put = (k, v) => { P[k * 3] = v.x; P[k * 3 + 1] = v.y; P[k * 3 + 2] = v.z; };
        const { t0, t1, t2 } = p;
        // inner panel: leading edge S-E-W, trailing edge B..F3 with a scalloped sag
        const [nu, nv] = this.GI;
        for (let a = 0; a < nu; a++) {
            const u = a / (nu - 1);
            if (u < 0.5) t0.lerpVectors(p.S, p.E, u * 2); else t0.lerpVectors(p.E, p.W, u * 2 - 1);
            t1.lerpVectors(p.B, p.F3, u);
            t2.subVectors(t0, t1).multiplyScalar(0.16 * Math.sin(Math.PI * u));
            t1.add(t2);
            for (let b = 0; b < nv; b++) {
                const v = b / (nv - 1);
                const q = t2.lerpVectors(t0, t1, v);
                q.addScaledVector(p.Na, cup * Math.sin(Math.PI * v) * Math.sin(Math.PI * u) * 0.9
                    + flut * v * v * Math.sin(this.time * 31 + u * 9 + s));
                // the root edge runs along the flank itself, and the next row eases into it
                // like a fillet of skin, so the membrane grows out of the body
                if (a < 2) {
                    const root = this._wingRoot(s, v, p.t3);
                    if (a === 0) q.copy(root); else q.lerp(root, 0.35);
                }
                put(o + a * nv + b, q);
            }
        }
        o += nu * nv;
        // outer panels: fan from the wrist to the edge between fingers k and k+1
        const [mu, mv] = this.GO;
        for (let f = 0; f < 3; f++) {
            const A = p["F" + f], B = p["F" + (f + 1)];
            for (let a = 0; a < mu; a++) {
                const u = a / (mu - 1);
                t0.lerpVectors(A, B, u);
                t1.subVectors(p.W, t0).multiplyScalar(0.26 * Math.sin(Math.PI * u));
                t0.add(t1);
                const len = t0.distanceTo(p.W);
                for (let b = 0; b < mv; b++) {
                    const v = b / (mv - 1);
                    const q = t2.lerpVectors(p.W, t0, v);
                    q.addScaledVector(p.bend, len * Math.sin(Math.PI * v));
                    q.addScaledVector(p.Nb, cup * 0.7 * Math.sin(Math.PI * v) * Math.sin(Math.PI * u)
                        + flut * v * v * Math.sin(Math.PI * u) * Math.sin(this.time * 33 + f * 2 + u * 7 + s));
                    put(o + a * mv + b, q);
                }
            }
            o += mu * mv;
        }
        (s > 0 ? this.tipL : this.tipR).copy(p.F0);

        // arm: shoulder, elbow and wrist in one smooth, muscled tube
        const B = this.bones, L = this.lb[side];
        const m1 = V().lerpVectors(p.S, p.E, 0.45).addScaledVector(p.Na, 0.08);
        const m2 = V().lerpVectors(p.E, p.W, 0.5).addScaledVector(p.Na, 0.03);
        // the arm starts inside the shoulder muscle so it swells out of the body
        const inS = this.surf(1.6, s * 0.72, -0.35);
        B.set(L.arm, [inS, p.S, m1, p.E, m2, p.W], [0.42, 0.4, 0.27, 0.2, 0.16, 0.13]);
        for (let i = 0; i < 4; i++) {
            const F = p["F" + i], len = F.distanceTo(p.W);
            const pts = [0, 0.33, 0.66, 1].map((v) => V().lerpVectors(p.W, F, v).addScaledVector(p.bend, len * Math.sin(Math.PI * v)));
            B.set(L.fingers[i], pts, [0.12, 0.08, 0.05, 0.022]);
        }
        // the thumb claw hooks forward from the wrist
        const th1 = V().copy(p.W).addScaledVector(p.Zb, 0.25).addScaledVector(p.Xb, 0.05);
        const th2 = V().copy(th1).addScaledVector(p.Zb, 0.2).addScaledVector(p.Nb, -0.1);
        this.spikes.set(L.thumb, [p.W, th1, th2], [0.08, 0.05, 0.004], p.Nb, 0.7);
    }

    _writeFrills(st) {
        const P = this.wingGeo.attributes.position.array, { T, U, X } = this;
        const k = this.ring(5.6), [nu, nv] = this.GF;
        const flare = 0.15 + this.amp * 0.25 + Math.abs(st.rates.y) * 0.3 + Math.sin(this.time * 2.3) * 0.04;
        let o = this.frillStart;
        const tips = [V(), V(), V()], q = V(), e = V();
        this.lb.frills.forEach((ids, side) => {
            const s = side ? -1 : 1;
            const root = this.surf(5.6, s * 1.45, -0.02);
            [[0.45, 0.95], [0.25, 0.4], [0.05, -0.1]].forEach(([up, out], i) => {
                tips[i].copy(root).addScaledVector(T[k], -0.85 + i * 0.1).addScaledVector(U[k], up).addScaledVector(X[k], s * (0.22 + out * flare));
                const mid = V().lerpVectors(root, tips[i], 0.5).addScaledVector(X[k], s * 0.05);
                this.spikes.set(ids[i], [root, mid, tips[i]], [0.035, 0.022, 0.003], X[k], 0.6);
            });
            for (let f = 0; f < 2; f++) {
                for (let a = 0; a < nu; a++) {
                    const u = a / (nu - 1);
                    e.lerpVectors(tips[f], tips[f + 1], u);
                    e.addScaledVector(q.subVectors(root, e), 0.22 * Math.sin(Math.PI * u));
                    for (let b = 0; b < nv; b++) {
                        q.lerpVectors(root, e, b / (nv - 1));
                        const n = o + a * nv + b;
                        P[n * 3] = q.x; P[n * 3 + 1] = q.y; P[n * 3 + 2] = q.z;
                    }
                }
                o += nu * nv;
            }
        });
    }

    // ---- bones, legs, horns and spines --------------------------------------------
    _buildPaths() {
        const B = (this.bones = new Paths(10)), Sp = (this.spikes = new Paths(5));
        const grad = (a, b, t0 = 0, t1 = 1) => (t) => mix3(a, b, smooth(t0, t1, t));
        const scaly = { skin: [SCALES, 0.25, 0.55] };
        const horny = (len, r) => ({ skin: [HORN, 0.35, 1], len, r });
        const arm = [0.035, 0.14, 0.25];
        this.lb = [0, 1].map(() => ({
            arm: B.add(6, grad(COL.top, arm, 0.1, 1), { ...scaly, r: 0.25, len: 6 }),
            fingers: [0, 1, 2, 3].map((i) => B.add(4, grad(arm, i === 0 ? COL.bone : COL.wingIn, 0.6, 1), { skin: [SCALES, 0.4, 0.4], r: 0.08, len: 5 })),
            thumb: Sp.add(3, COL.claw, horny(0.4, 0.06)),
            leg: B.add(6, COL.leg, { ...scaly, r: 0.3, len: 3 }),
            toes: [0, 1, 2].map(() => B.add(4, grad(COL.leg, COL.claw, 0.55, 0.7), { skin: [SCALES, 0.3, 0.35], r: 0.05, len: 0.6 })),
            horn: B.add(7, grad(COL.horn, COL.bone, 0.1, 1), horny(2.2, 0.1)),
            horn2: B.add(5, grad(COL.horn, COL.bone, 0.2, 1), horny(1.1, 0.06)),
            cheek: [0, 1, 2].map(() => Sp.add(3, grad(COL.horn, COL.bone), horny(0.3, 0.03))),
            fang: Sp.add(3, COL.tooth, horny(0.12, 0.02)),
        }));
        this.lb.frills = [0, 1].map(() => [0, 1, 2].map(() => Sp.add(3, grad(COL.wingMid, COL.bone), { glow: (t) => t * 0.6, skin: [HORN, 0.6, 1], len: 0.9, r: 0.03 })));
        // dorsal spines from the back of the skull to the tail fin
        this.dorsal = [];
        for (let z = 5.0; z > -11.6; z -= z > 3.6 ? 0.32 : 0.48) {
            const crest = profAt(z)[2];
            const h = 0.12 + crest * 1.25;
            this.dorsal.push({ z, h, id: Sp.add(3, grad(COL.top, COL.bone, 0.2, 1), { glow: (t) => t * t * 0.45, skin: [HORN, 0.7, 1], len: h, r: 0.05 }) });
        }
        this.group.add(B.build(this.skin), Sp.build(this.skin));
    }

    _writeLimbs(st) {
        const { C, T, X, U } = this, B = this.bones, Sp = this.spikes;
        this.legs += ((st.brake ? 1 : 0) - this.legs) * Math.min(1, this.dt * 3);
        const lg = this.legs;
        // hind legs: tucked back under the hips in flight, reaching forward to brake
        const h = this.ring(-2.4);
        this.lb.forEach((L, side) => {
            const s = side ? -1 : 1;
            const hip = V().copy(C[h]).addScaledVector(X[h], s * 0.55).addScaledVector(U[h], -0.4);
            const knee = V().copy(hip).addScaledVector(T[h], -0.9 + lg * 1.2).addScaledVector(U[h], -0.6 - lg * 0.4).addScaledVector(X[h], s * 0.18);
            const ankle = V().copy(knee).addScaledVector(T[h], -1.15 + lg * 0.9).addScaledVector(U[h], 0.05 - lg * 0.8);
            const foot = V().copy(ankle).addScaledVector(T[h], -0.45 + lg * 0.6).addScaledVector(U[h], -0.1 - lg * 0.2);
            const m1 = V().lerpVectors(hip, knee, 0.45).addScaledVector(U[h], 0.06);
            const m2 = V().lerpVectors(knee, ankle, 0.5);
            B.set(L.leg, [hip, m1, knee, m2, ankle, foot], [0.44, 0.35, 0.2, 0.15, 0.1, 0.085]);
            const fd = V().subVectors(foot, ankle).normalize();
            [-0.45, 0, 0.45].forEach((spread, i) => {
                const d = V().copy(fd).addScaledVector(X[h], s * spread).normalize();
                const p1 = V().copy(foot).addScaledVector(d, 0.22);
                const p2 = V().copy(foot).addScaledVector(d, 0.42).addScaledVector(U[h], -0.03);
                const p3 = V().copy(foot).addScaledVector(d, 0.58).addScaledVector(U[h], -0.14);
                B.set(L.toes[i], [foot, p1, p2, p3], [0.065, 0.05, 0.04, 0.004]);
            });

            // head: swept-back horns, a smaller pair below, cheek spikes and a fang
            const k = this.ring(5.9), tk = T[k], uk = U[k], xk = X[k];
            const hornPath = (base, n, len, up, curl, out) => Array.from({ length: n }, (_, i) => {
                const t = i / (n - 1);
                return V().copy(base).addScaledVector(tk, -len * t).addScaledVector(uk, up * t - curl * t * t).addScaledVector(xk, s * out * (t + 0.4 * t * t));
            });
            const hb = this.surf(5.95, s * 0.55, -0.05);
            B.set(L.horn, hornPath(hb, 7, 2.1, 0.75, 0.5, 0.22), [0, 1, 2, 3, 4, 5, 6].map((i) => 0.14 * Math.pow(1 - i / 6, 0.85) + 0.006));
            const hb2 = this.surf(5.7, s * 1.2, -0.04);
            B.set(L.horn2, hornPath(hb2, 5, 1.0, 0.2, 0.25, 0.3), [0.075, 0.06, 0.042, 0.022, 0.004]);
            L.cheek.forEach((id, i) => {
                const base = this.surf(5.95 - i * 0.22, s * (1.62 + i * 0.08), -0.02);
                const tip = V().copy(base).addScaledVector(tk, -0.28 + i * 0.04).addScaledVector(xk, s * 0.12).addScaledVector(uk, -0.04);
                Sp.set(id, [base, V().lerpVectors(base, tip, 0.5), tip], [0.035, 0.02, 0.003], xk, 0.6);
            });
            const fb = this.surf(7.3, s * (mouthAngle(7.3) - 0.02), -0.02);
            const ft = V().copy(fb).addScaledVector(uk, -0.15).addScaledVector(tk, -0.02);
            Sp.set(L.fang, [fb, V().lerpVectors(fb, ft, 0.5), ft], [0.025, 0.017, 0.002]);

            // eyes, set into their sockets and looking along the head
            const e = this.eyes[side];
            const ep = this.surf(6.38, s * 1.12, -0.035);
            this.m4.makeBasis(V().copy(xk).multiplyScalar(s), uk, V().copy(tk).multiplyScalar(s)).setPosition(ep);
            e.matrix.copy(this.m4).scale(e.scale);
        });
        this.eyeMat.emissiveIntensity = 1.2 + shared.uGlow.value * 1.5;

        // dorsal spines, raked back like a sail
        for (const d of this.dorsal) {
            const i = this.ring(d.z), base = this.surf(d.z, 0, -0.06);
            const tip = V().copy(base).addScaledVector(U[i], d.h * 0.85).addScaledVector(T[i], -d.h * 0.75);
            const mid = V().copy(base).addScaledVector(U[i], d.h * 0.55).addScaledVector(T[i], -d.h * 0.22);
            const r = 0.05 + d.h * 0.14;
            Sp.set(d.id, [base, mid, tip], [r, r * 0.5, 0.004], X[i], 0.35);
        }
    }

    // Let the sun cast the dragon's shadow on itself (wings over the back, the body
    // over the legs). size 0 turns it off.
    setShadows(light, size) {
        light.castShadow = size > 0;
        if (size > 0) {
            light.shadow.mapSize.set(size, size);
            light.shadow.map?.dispose();
            light.shadow.map = null;
            const c = light.shadow.camera;
            c.left = c.bottom = -19; c.right = c.top = 19; c.near = 1; c.far = 260;
            c.updateProjectionMatrix();
            light.shadow.bias = -0.0004;
            light.shadow.normalBias = 0.03;
        }
        for (const m of this.group.children) { m.castShadow = m.receiveShadow = size > 0 && !this.eyes.includes(m); }
    }

    // centre the sun's shadow on the dragon and hand the sky colours to the skin
    aimLights(sun, hemi) {
        const p = this.group.getWorldPosition(V());
        const dir = V().subVectors(sun.position, sun.target.position).normalize();
        sun.target.position.copy(p);
        sun.position.copy(p).addScaledVector(dir, 120);
        sun.target.updateMatrixWorld();
        for (const m of [this.skin, this.membraneMat]) {
            m.userData.u.uSkyCol.value.copy(hemi.color).multiplyScalar(hemi.intensity * 0.55);
            m.userData.u.uGroundCol.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity * 0.45);
        }
    }

    // st: { speed, boosting, brake, rates (pitch, yaw, roll rad/s), climb (fwd.y) }
    update(dt, st) {
        this.time += dt;
        this.dt = dt;
        // flap hard while boosting; an easy beat when slow or climbing; otherwise glide
        let want = st.boosting ? 1 : st.speed < 45 || st.climb > 0.55 ? 0.5 : 0;
        if (st.brake) want = 0;
        this.amp += (want - this.amp) * Math.min(1, dt * (want > this.amp ? 4 : 1.5));
        const freq = 0.75 + this.amp * 1.0;
        const before = Math.sin(this.phase);
        // ease the wings back to the glide pose once the beat fades
        if (this.amp > 0.03) this.phase = (this.phase + dt * freq * Math.PI * 2) % (Math.PI * 2);
        else this.phase += (0 - (this.phase > Math.PI ? this.phase - Math.PI * 2 : this.phase)) * Math.min(1, dt * 2);
        this.downstroke = this.amp * Math.max(0, Math.sin(this.phase));
        this.beat = before <= 0 && Math.sin(this.phase) > 0 && this.amp > 0.4;
        // the wings flare into the air-brake and sweep back out of it on a damped spring,
        // overshooting a touch as the membrane catches the air
        const bw = st.brake ? 1 : 0, sk = st.brake ? 90 : 45, sd = st.brake ? 11 : 12;
        const h = Math.min(dt, 1 / 30);
        this.brakeVel += ((bw - this.brakeAmt) * sk - this.brakeVel * sd) * h;
        this.brakeAmt = Math.max(-0.1, Math.min(1.15, this.brakeAmt + this.brakeVel * h));

        this._updateBody(st);
        this._writeWing(1, 0, st);
        this._writeWing(-1, 1, st);
        this._writeFrills(st);
        this._writeLimbs(st);
        this.bones.end();
        this.spikes.end();
        this.wingGeo.attributes.position.needsUpdate = true;
        this.wingGeo.computeVertexNormals();
    }
}
