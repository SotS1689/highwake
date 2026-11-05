// Cinematic post-processing: sun shafts (god rays), traced at half resolution, and
// the uniforms for the painterly colour grade (split-toning by time of day, gentle
// saturation, vignette, film grain and speed-driven chromatic fringing). The grade
// itself is applied in the single final pass (post.js), along with everything else.

import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { shared } from "./gfx.js";

// Radial blur of the bright sky around the sun. Islands, whales and the dragon
// are dark against it, so they cut the light into shafts with no depth pass.
const GodRaysShader = {
    uniforms: {
        tDiffuse: { value: null },
        uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uStrength: { value: 0 },
        uColor: { value: new THREE.Color(1, 0.9, 0.75) },
        uAspect: { value: 1 },
        uSamples: { value: 48 },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength, uAspect; uniform vec3 uColor; uniform int uSamples;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        vec3 bright(vec2 uv) {
            vec3 c = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
            float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
            // only the glowing sky near the sun feeds the shafts
            vec2 d = (uv - uSun) * vec2(uAspect, 1.0);
            float near = exp(-dot(d, d) * 16.0);
            return c * smoothstep(4.0, 12.0, l) * near;
        }
        void main() {
            vec2 delta = (vUv - uSun) / float(uSamples) * 0.9;
            vec2 uv = vUv - delta * hash(vUv * 917.0); // jitter hides banding
            vec3 acc = vec3(0.0); float decay = 1.0;
            for (int i = 0; i < 96; i++) {
                if (i >= uSamples) break;
                uv -= delta;
                acc += bright(uv) * decay;
                decay *= 0.965;
            }
            acc /= float(uSamples);
            gl_FragColor = vec4(acc * uColor * uStrength, 1.0);
        }`,
};

// The shafts are soft, so they're traced at half resolution into their own target;
// the final pass adds them. Switched off whenever the sun is out of view.
class RaysPass extends Pass {
    constructor() {
        super();
        this.needsSwap = false;
        this.uniforms = THREE.UniformsUtils.clone(GodRaysShader.uniforms);
        this.trace = new FullScreenQuad(new THREE.ShaderMaterial({ ...GodRaysShader, uniforms: this.uniforms, depthTest: false, depthWrite: false }));
        this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
        this.on = true;
    }
    setSize(w, h) { this.target.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))); }
    render(renderer, writeBuffer, readBuffer) {
        this.uniforms.tDiffuse.value = readBuffer.texture;
        renderer.setRenderTarget(this.target);
        this.trace.render(renderer);
    }
}

const DAY = { sh: new THREE.Color(0.48, 0.56, 0.72), hi: new THREE.Color(1.0, 0.93, 0.8) };
const GOLD = { sh: new THREE.Color(0.38, 0.4, 0.68), hi: new THREE.Color(1.0, 0.78, 0.52) };
const NIGHT = { sh: new THREE.Color(0.3, 0.42, 0.75), hi: new THREE.Color(0.75, 0.9, 1.0) };

export class Cinematic {
    constructor() {
        this.rays = new RaysPass();
        // grade uniforms, read by the final pass
        this.gradeU = {
            uTime: { value: 0 }, uShadowTint: { value: new THREE.Color() }, uHighTint: { value: new THREE.Color() },
            uSplit: { value: 0.12 }, uSat: { value: 1.08 }, uContrast: { value: 1.04 }, uVignette: { value: 0.32 },
            uGrain: { value: 0.025 }, uFringe: { value: 0 },
        };
        this._v = new THREE.Vector3();
        this._fwd = new THREE.Vector3();
        this.fringe = 0;
    }

    setQuality(q) {
        this.rays.on = q.rays > 0;
        this.rays.enabled = this.rays.on;
        this.rays.uniforms.uSamples.value = q.rays || 32;
        this.gradeU.uGrain.value = q.grain ?? 0.025;
    }

    update(camera, dt, time, speed = 0) {
        const sunDir = shared.uSunDir.value;
        const ru = this.rays.uniforms, gu = this.gradeU;
        // sun position on screen
        this._v.copy(camera.position).addScaledVector(sunDir, 10000).project(camera);
        camera.getWorldDirection(this._fwd);
        const facing = this._fwd.dot(sunDir);
        ru.uSun.value.set(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5);
        ru.uAspect.value = camera.aspect;
        const up = THREE.MathUtils.smoothstep(sunDir.y, -0.05, 0.08);
        const offScreen = Math.max(Math.abs(this._v.x), Math.abs(this._v.y));
        const onScreen = 1 - THREE.MathUtils.smoothstep(offScreen, 1.0, 1.8);
        // low sun = longer, richer shafts
        const low = 1 - THREE.MathUtils.smoothstep(sunDir.y, 0.15, 0.6);
        ru.uStrength.value = facing > 0 ? up * onScreen * (0.18 + 0.27 * low) : 0;
        this.rays.enabled = this.rays.on && ru.uStrength.value > 0.002;
        ru.uColor.value.copy(shared.uSunColor.value).multiplyScalar(0.8);

        // grade follows the time of day: day → golden hour → night
        const e = sunDir.y;
        const gold = THREE.MathUtils.smoothstep(e, -0.08, 0.05) * (1 - THREE.MathUtils.smoothstep(e, 0.12, 0.35));
        const night = 1 - THREE.MathUtils.smoothstep(e, -0.12, 0.02);
        gu.uShadowTint.value.copy(DAY.sh).lerp(GOLD.sh, gold).lerp(NIGHT.sh, night);
        gu.uHighTint.value.copy(DAY.hi).lerp(GOLD.hi, gold).lerp(NIGHT.hi, night);
        gu.uSplit.value = 0.1 + gold * 0.1 + night * 0.06;
        gu.uSat.value = 1.06 + gold * 0.1 - night * 0.08;
        gu.uTime.value = time;
        // fringe builds at high speed, like air distorting the lens
        const target = THREE.MathUtils.smoothstep(speed, 110, 170) * 0.035;
        this.fringe += (target - this.fringe) * Math.min(1, dt * 3);
        gu.uFringe.value = this.fringe;
    }
}
