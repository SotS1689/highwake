// Blossoms that burst open on the trees as the dragon flies near, and fold away again
// once it has passed. Each tree in the near forest carries a few dozen flowers on the
// outside of its crown; they cost nothing while closed (zero-size cards) and only exist
// on the detailed near trees. Colours are fantastical: magenta, coral, gold, violet,
// cyan and pearl, one main colour per tree with neighbours in the same family, and they
// glow softly at night.

import * as THREE from "three";
import { shared, addWind } from "./gfx.js";
import { mulberry32 } from "./noise.js";

// how close the dragon must be (metres from the flower): fully open inside OPEN, closed beyond CLOSED
const OPEN = 110, CLOSED = 240;
const PALETTE = ["#ff4fd8", "#ff7a59", "#ffd34d", "#a77bff", "#5ff2ff", "#ffe3f4"];

// A five-petalled flower drawn into a data texture: red = petal light (darker toward the
// heart), green = the golden heart, alpha = the shape. The shader supplies the colour.
function blossomTexture() {
    const S = 256, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    g.translate(S / 2, S / 2);
    for (let k = 0; k < 5; k++) {
        g.save();
        g.rotate((k / 5) * Math.PI * 2);
        const gr = g.createLinearGradient(0, -8, 0, -118);
        gr.addColorStop(0, "rgb(110,0,0)");
        gr.addColorStop(0.45, "rgb(225,0,0)");
        gr.addColorStop(1, "rgb(255,0,0)");
        g.fillStyle = gr;
        g.beginPath();
        // a rounded petal with a small notch at its tip
        g.moveTo(0, -6);
        g.bezierCurveTo(-58, -40, -52, -112, -8, -118);
        g.lineTo(0, -108);
        g.lineTo(8, -118);
        g.bezierCurveTo(52, -112, 58, -40, 0, -6);
        g.fill();
        // a faint vein down the middle
        g.strokeStyle = "rgba(170,0,0,0.6)";
        g.lineWidth = 3;
        g.beginPath(); g.moveTo(0, -14); g.lineTo(0, -92); g.stroke();
        g.restore();
    }
    const hc = g.createRadialGradient(0, 0, 0, 0, 0, 30);
    hc.addColorStop(0, "rgb(255,255,0)");
    hc.addColorStop(0.7, "rgb(255,230,0)");
    hc.addColorStop(1, "rgba(255,120,0,0)");
    g.fillStyle = hc;
    g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
}

// Flowers on the outside of a tree crown, read off the tree's leaf cards: points whose
// leaf normal faces out and up, pushed a little clear of the leaves. Each flower is two
// crossed cards around its centre; aBloom = (opening delay, colour jitter).
export function blossomGeometry(leaves, count, seed) {
    const rand = mulberry32(seed);
    const P = leaves.attributes.position, N = leaves.attributes.normal;
    leaves.computeBoundingBox();
    const c = leaves.boundingBox.getCenter(new THREE.Vector3());
    const cand = [];
    let maxR = 0;
    for (let i = 0; i < P.count; i++) maxR = Math.max(maxR, Math.hypot(P.getX(i) - c.x, (P.getY(i) - c.y) * 1.4, P.getZ(i) - c.z));
    for (let i = 0; i < P.count; i++) {
        const r = Math.hypot(P.getX(i) - c.x, (P.getY(i) - c.y) * 1.4, P.getZ(i) - c.z);
        if (r > maxR * 0.6 && N.getY(i) > -0.3) cand.push(i);
    }
    const pos = [], nrm = [], uv = [], ctr = [], bloom = [], idx = [];
    const n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3();
    for (let k = 0; k < count && cand.length; k++) {
        const i = cand[Math.floor(rand() * cand.length)];
        n.set(N.getX(i), N.getY(i), N.getZ(i)).normalize();
        p.set(P.getX(i), P.getY(i), P.getZ(i)).addScaledVector(n, 0.7);
        const s = 1.1 + rand() * 0.7, delay = rand(), jit = rand();
        // two crossed cards: one facing out of the crown, one tipped across it
        a.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).cross(n).normalize();
        b.copy(n).cross(a).normalize();
        for (const [ax, by] of [[a, b], [a, b.clone().lerp(n, 0.85).normalize()]]) {
            const o = pos.length / 3;
            for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
                const x = (u - 0.5) * 2 * s, y = (v - 0.5) * 2 * s;
                pos.push(p.x + ax.x * x + by.x * y, p.y + ax.y * x + by.y * y, p.z + ax.z * x + by.z * y);
                nrm.push(n.x, n.y, n.z);
                uv.push(u, v);
                ctr.push(p.x, p.y, p.z);
                bloom.push(delay, jit);
            }
            idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("aCenter", new THREE.Float32BufferAttribute(ctr, 3));
    g.setAttribute("aBloom", new THREE.Float32BufferAttribute(bloom, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
}

export function blossomMaterial() {
    const m = new THREE.MeshStandardMaterial({ map: blossomTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.55 });
    const cols = PALETTE.map((h) => new THREE.Color(h));
    const glsl = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
    m.onBeforeCompile = (sh) => {
        sh.uniforms.uDragonPos = shared.uDragonPos;
        sh.uniforms.uGlow = shared.uGlow;
        sh.uniforms.uTime = shared.uTime;
        sh.vertexShader = sh.vertexShader
            .replace("#include <common>", `#include <common>
                attribute vec3 aCenter; attribute vec2 aBloom;
                // uDragonPos is declared by the wind (addWind) below
                varying vec3 vBlossomCol; varying float vOpen;
                vec3 blossomPalette(float i){
                    i = mod(floor(i), 6.0);
                    return i < 0.5 ? ${glsl(cols[0])} : i < 1.5 ? ${glsl(cols[1])} : i < 2.5 ? ${glsl(cols[2])}
                         : i < 3.5 ? ${glsl(cols[3])} : i < 4.5 ? ${glsl(cols[4])} : ${glsl(cols[5])};
                }`)
            .replace("#include <begin_vertex>", `#include <begin_vertex>
                {
                    mat4 im = modelMatrix;
                    #ifdef USE_INSTANCING
                    im = modelMatrix * instanceMatrix;
                    #endif
                    vec3 wc = (im * vec4(aCenter, 1.0)).xyz;
                    float b = smoothstep(${CLOSED.toFixed(1)}, ${OPEN.toFixed(1)}, distance(wc, uDragonPos));
                    float open = clamp(b * 1.8 - aBloom.x * 0.8, 0.0, 1.0);
                    // burst: overshoot a little, then settle (ease-out-back), rising out of the leaves
                    float o = open - 1.0;
                    float s = open <= 0.0 ? 0.0 : 1.0 + 2.70158 * o * o * o + 1.70158 * o * o;
                    transformed = aCenter + (transformed - aCenter) * s + objectNormal * (open - 1.0) * 1.2;
                    vOpen = open;
                    // one main colour per tree (neighbours drift through the palette), a few
                    // flowers on each tree in the next colour along
                    vec3 tp = (im * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                    float h = sin(tp.x * 0.004) * 1.5 + sin(tp.z * 0.0053 + 1.7) * 1.5 + fract(sin(dot(tp.xz, vec2(12.9898, 78.233))) * 43758.5453) * 1.2;
                    vBlossomCol = blossomPalette(h * 2.0 + 6.0 + step(0.78, aBloom.y));
                }`);
        sh.fragmentShader = sh.fragmentShader
            .replace("#include <common>", "#include <common>\nuniform float uGlow;\nvarying vec3 vBlossomCol; varying float vOpen;")
            .replace("#include <map_fragment>", `
                vec4 bt = texture2D(map, vMapUv);
                diffuseColor.rgb = mix(vBlossomCol * (0.4 + 0.6 * bt.r), vec3(1.0, 0.82, 0.32), bt.g);
                diffuseColor.a *= bt.a;`)
            .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
                // fantastical flowers are a little lit from within, and glow at night
                totalEmissiveRadiance += diffuseColor.rgb * (0.18 + uGlow * uGlow * 1.6) * vOpen;`);
    };
    m.customProgramCacheKey = () => "blossom1";
    return addWind(m, 1, false);
}

// Add a blossom geometry to every variant of the tree kit
export function addBlossoms(kit) {
    let seed = 1;
    for (const [sp, n] of [["canopy", 30], ["spire", 16]]) {
        for (const v of kit[sp]) v.blossom = blossomGeometry(v.leaves, n, 97 * seed++);
    }
}
