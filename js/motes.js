// Floating motes: pollen and seed-fluff drifting in the air near the islands, warm in
// the sun by day and faintly glowing by night. A fixed cloud of points wraps around the
// camera (so it never runs out), drawn and animated entirely on the GPU, and fades in
// only when you're close to an island.

import * as THREE from "three";
import { shared, SHADER_END } from "./gfx.js";

const BOX = 260;           // size of the wrapping cube around the camera (m)

export class Motes {
    constructor(scene, entities, count = 900) {
        this.entities = entities.filter((e) => e.kind === "island");
        const pos = new Float32Array(count * 3), seed = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
            pos.set([Math.random() * BOX, Math.random() * BOX, Math.random() * BOX], i * 3);
            seed.set([Math.random(), Math.random()], i * 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 2));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
        this.u = {
            uTime: shared.uTime, uSunColor: shared.uSunColor, uGlow: shared.uGlow, uSunDir: shared.uSunDir,
            uCam: { value: new THREE.Vector3() }, uNear: { value: 0 }, uPx: { value: 1 },
        };
        this.points = new THREE.Points(g, new THREE.ShaderMaterial({
            uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
            vertexShader: /* glsl */ `
                attribute vec2 aSeed; uniform float uTime, uPx, uNear; uniform vec3 uCam;
                varying float vA; varying float vS;
                void main(){
                    // drift on a slow breeze with a little wandering, then wrap into the box
                    vec3 drift = vec3(1.6, 0.35 + 0.3 * aSeed.y, 0.9) * uTime
                        + vec3(sin(uTime * 0.3 + aSeed.x * 40.0), sin(uTime * 0.23 + aSeed.y * 31.0), cos(uTime * 0.27 + aSeed.x * 17.0)) * 4.0;
                    vec3 rel = mod(position + drift - uCam, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
                    vec3 p = uCam + rel;
                    vec4 mv = viewMatrix * vec4(p, 1.0);
                    gl_Position = projectionMatrix * mv;
                    float d = -mv.z;
                    // fade at the edge of the box and very close to the eye
                    float edge = 1.0 - smoothstep(${(BOX * 0.32).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, length(rel));
                    vA = edge * smoothstep(2.0, 8.0, d) * uNear * (0.6 + 0.4 * sin(uTime * 2.0 + aSeed.x * 60.0));
                    vS = aSeed.y;
                    gl_PointSize = clamp((0.35 + 0.5 * aSeed.x) * 2400.0 * uPx / max(d, 1.0), 1.5, 22.0);
                }`,
            fragmentShader: /* glsl */ `
                uniform vec3 uSunColor, uSunDir; uniform float uGlow;
                varying float vA; varying float vS;
                void main(){
                    float r = length(gl_PointCoord - 0.5);
                    float a = smoothstep(0.5, 0.0, r) * vA;
                    vec3 day = mix(vec3(1.0, 0.92, 0.7), vec3(0.9, 1.0, 0.8), vS) * uSunColor * (0.35 + 0.65 * clamp(uSunDir.y * 3.0, 0.0, 1.0));
                    vec3 night = vec3(0.35, 0.95, 1.0) * uGlow * 1.6;
                    vec3 c = day * 1.3 + night;
                    gl_FragColor = vec4(c * a, a);
                    ${SHADER_END}
                }`,
        }));
        this.points.frustumCulled = false;
        this.points.renderOrder = 7;
        scene.add(this.points);
    }

    setPixelScale(px) { this.u.uPx.value = px; }

    update(cam, dt) {
        this.u.uCam.value.copy(cam);
        // near an island (above its top or alongside it): fade the motes in
        let near = 0;
        for (const e of this.entities) {
            const r = e.r || 300;
            const d = Math.hypot(e.pos[0] - cam.x, (e.pos[1] - cam.y) * 0.6, e.pos[2] - cam.z) - r;
            near = Math.max(near, 1 - Math.min(1, Math.max(0, d / 500)));
        }
        this.u.uNear.value += (near - this.u.uNear.value) * Math.min(1, dt * 1.5);
    }
}
