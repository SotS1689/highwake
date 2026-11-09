// The dragon you ride: its input (mouse, keys, gamepad), flight model, wingtip
// trails, speed streaks and the chase camera.

import * as THREE from "three";
import { SHADER_END } from "./gfx.js";
import { Dragon } from "./dragon.js";
import { ModelDragon } from "./dragonModel.js";
import { CEILING, BOUNDARY } from "./world.js";

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------------
export class Input {
    constructor(canvas, settings) {
        this.settings = settings;
        this.keys = new Set();
        this.stick = new THREE.Vector2();   // virtual mouse stick, unit disc
        this.locked = false;
        this.pad = null;
        this.pressed = new Set();           // one-shot keys this frame
        addEventListener("keydown", (e) => {
            if (e.repeat) return;
            this.keys.add(e.code);
            this.pressed.add(e.code);
            // double-tap A or D: a full barrel roll that way
            if (e.code === "KeyA" || e.code === "KeyD") {
                const now = performance.now();
                if (this._lastTap?.code === e.code && now - this._lastTap.t < 300) {
                    this.pressed.add(e.code === "KeyD" ? "RollRight" : "RollLeft");
                    this._lastTap = null;
                } else this._lastTap = { code: e.code, t: now };
            }
            if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code) && this.locked) e.preventDefault();
        });
        addEventListener("keyup", (e) => this.keys.delete(e.code));
        addEventListener("blur", () => this.keys.clear());
        addEventListener("mousemove", (e) => {
            if (!this.locked) return;
            const s = 0.0024 * this.settings.sens;
            this.stick.x += e.movementX * s;
            this.stick.y += (this.settings.invert ? 1 : -1) * e.movementY * s;
            if (this.stick.length() > 1) this.stick.normalize();
        });
        document.addEventListener("pointerlockchange", () => {
            this.locked = document.pointerLockElement === canvas;
            if (!this.locked) this.stick.set(0, 0);
        });
        this.canvas = canvas;
    }

    lock() { this.canvas.requestPointerLock?.()?.catch?.(() => {}); }

    read(dt) {
        const k = (c) => this.keys.has(c);
        // the mouse stick drifts slowly back to centre
        this.stick.multiplyScalar(Math.max(0, 1 - dt * 0.5));
        let sx = this.stick.x, sy = this.stick.y;
        const inv = this.settings.invert ? -1 : 1;
        if (k("ArrowLeft")) sx -= 1;
        if (k("ArrowRight")) sx += 1;
        if (k("ArrowUp")) sy += 1 * inv;
        if (k("ArrowDown")) sy -= 1 * inv;
        let roll = (k("KeyD") ? 1 : 0) - (k("KeyA") ? 1 : 0);
        let rudder = (k("KeyE") ? 1 : 0) - (k("KeyQ") ? 1 : 0);
        let thr = (k("KeyW") ? 1 : 0) - (k("KeyS") ? 1 : 0);
        let boost = k("Space");
        let brake = k("ShiftLeft") || k("ShiftRight");

        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = [...pads].find((p) => p && p.connected);
        if (gp) {
            const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
            sx += dz(gp.axes[0] || 0);
            sy += -dz(gp.axes[1] || 0) * inv;
            rudder += dz(gp.axes[2] || 0);
            roll += (gp.buttons[5]?.value || 0) - (gp.buttons[4]?.value || 0);
            thr += (gp.buttons[7]?.value || 0);
            brake = brake || (gp.buttons[6]?.value || 0) > 0.3;
            boost = boost || gp.buttons[0]?.pressed;
            if (gp.buttons[9]?.pressed && !this._padStart) this.pressed.add("Escape");
            if (gp.buttons[3]?.pressed && !this._padY) this.pressed.add("KeyC");
            this._padStart = gp.buttons[9]?.pressed;
            this._padY = gp.buttons[3]?.pressed;
            if ((gp.buttons[6]?.value || 0) > 0.3 && !(gp.buttons[7]?.value > 0.3)) thr -= 0.6;
        }
        const out = {
            stickX: THREE.MathUtils.clamp(sx, -1, 1), stickY: THREE.MathUtils.clamp(sy, -1, 1),
            roll: THREE.MathUtils.clamp(roll, -1, 1), rudder: THREE.MathUtils.clamp(rudder, -1, 1),
            thr: THREE.MathUtils.clamp(thr, -1, 1), boost, brake, pressed: new Set(this.pressed),
        };
        this.pressed.clear();
        return out;
    }
}

// ---------------------------------------------------------------------------------
export class Vessel {
    // model: the Blender-built dragon (glTF), or null for the code-built one
    constructor(scene, model = null) {
        this.dragon = model ? new ModelDragon(model) : new Dragon();
        this.group = this.dragon.group;
        this.tipL = this.dragon.tipL;
        this.tipR = this.dragon.tipR;
        scene.add(this.group);

        this.pos = new THREE.Vector3();
        this.q = new THREE.Quaternion();
        this.vdir = new THREE.Vector3(0, 0, 1);
        this.speed = 70;
        this.throttle = 0.75;
        this.boost = 1;
        this.boosting = false;
        this.crowned = false;    // the Crown is awake: endless boost, double top speed
        this.rates = new THREE.Vector3(); // pitch, yaw, roll (rad/s)
        this.fwd = new THREE.Vector3(); this.up = new THREE.Vector3(); this.right = new THREE.Vector3();
        this.extVel = new THREE.Vector3();
        this.bank = 0;
        this.hover = 0;          // 0..1: stopped in the air, held up on the wingbeats
        this.hoverClimb = 0;     // m/s up (or down) while hovering, from the pitch stick
        this.trails = new Trails(scene);
        this.streaks = new Streaks(scene);
        this._axes();
    }

    reset(pos, dir) {
        this.pos.set(...pos);
        const f = new THREE.Vector3(...dir).normalize();
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), f.clone().negate(), UP);
        this.q.setFromRotationMatrix(m);
        this.vdir.copy(f);
        this.speed = 70;
        this.hover = 0; this.hoverClimb = 0; this.barrel = null;
        this.rates.set(0, 0, 0);
        this.extVel.set(0, 0, 0);
        this._axes();
        this.trails.reset(this);
    }

    _axes() {
        this.fwd.set(0, 0, 1).applyQuaternion(this.q);
        this.up.set(0, 1, 0).applyQuaternion(this.q);
        this.right.set(-1, 0, 0).applyQuaternion(this.q);
        this.bank = Math.atan2(-this.right.y, this.up.y);
    }

    // world: { thermalLift, wind (Vector3), boostRefill }
    update(dt, inp, settings, world) {
        // throttle
        this.throttle = THREE.MathUtils.clamp(this.throttle + inp.thr * dt * 0.6, 0, 1);
        // hover: throttle right down and the air-brake held, the dragon pulls up, stops and
        // holds itself in the air on strong wingbeats. It can still turn on the spot, and
        // the pitch stick lifts it or lets it sink. Let go of the brake (or open the
        // throttle) and it noses over and flies on.
        const hoverWant = inp.brake && this.throttle < 0.04 ? 1 : 0;
        this.hover += (hoverWant - this.hover) * Math.min(1, dt * (hoverWant ? 0.9 : 1.6));
        if (this.hover < 0.002) this.hover = 0;
        const hv = this.hover;

        // rotation rates (smoothed)
        const steep = Math.abs(this.fwd.y);
        // hold the bank through steep flight and while the stick is pulled hard, so a
        // held pull carries you over the top in a full loop instead of rolling upright
        const loopish = steep > 0.72 || (Math.abs(inp.stickY) > 0.6 && Math.abs(inp.stickX) < 0.3);
        if (!this.barrel && hv < 0.5) {
            if (inp.pressed.has("RollRight")) this.barrel = { dir: 1, left: Math.PI * 2 };
            else if (inp.pressed.has("RollLeft")) this.barrel = { dir: -1, left: Math.PI * 2 };
        }
        let roll;
        if (this.barrel) roll = this.barrel.dir * 7.5;
        else if (inp.roll !== 0) roll = inp.roll * 3.2;
        else {
            const target = loopish ? this.bank : inp.stickX * 0.8;
            const levelPull = settings.autolevel || Math.abs(inp.stickX) > 0.05 ? 2.6 : 0;
            let err = target - this.bank;
            err = Math.atan2(Math.sin(err), Math.cos(err));
            roll = THREE.MathUtils.clamp(err * levelPull, -2.4, 2.4);
        }
        const pitch = inp.stickY * 1.45 * (1 - hv);
        if (hv > 0) roll *= 1 - hv;
        const yaw = inp.stickX * 0.75 + inp.rudder * 0.55;
        const k = Math.min(1, dt * 7);
        this.rates.x += (pitch - this.rates.x) * k;
        this.rates.y += (yaw - this.rates.y) * k;
        this.rates.z += (roll - this.rates.z) * (this.barrel ? Math.min(1, dt * 14) : k);
        if (this.barrel) {
            this.barrel.left -= Math.abs(this.rates.z) * dt;
            if (this.barrel.left <= 0.15) this.barrel = null;
        }
        this.avel = this.rates;

        const yawAxis = UP.clone().lerp(this.up, THREE.MathUtils.smoothstep(steep, 0.55, 0.85)).normalize();
        const qa = new THREE.Quaternion();
        this.q.premultiply(qa.setFromAxisAngle(this.right, this.rates.x * dt));
        this.q.premultiply(qa.setFromAxisAngle(yawAxis, -this.rates.y * dt));
        this.q.premultiply(qa.setFromAxisAngle(this.fwd, this.rates.z * dt));
        this.q.normalize();
        this._axes();
        // hovering, the body settles level-winged with the nose raised a little, facing
        // wherever it was heading
        const flat = this._flat || (this._flat = new THREE.Vector3());
        flat.set(this.fwd.x, 0, this.fwd.z);
        if (flat.lengthSq() < 0.01) flat.set(this.vdir.x, 0, this.vdir.z);
        if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
        flat.normalize();
        if (hv > 0) {
            // (leaving the hover, it noses over a touch to pick up speed again)
            const P = hoverWant ? 0.3 : -0.12;
            const f = flat.clone().multiplyScalar(Math.cos(P)).addScaledVector(UP, Math.sin(P));
            const qt = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), f.negate(), UP));
            this.q.slerp(qt, Math.min(1, dt * 2.5 * hv)).normalize();
            this._axes();
        }

        // speed: thrust, drag, gravity along the flight path
        const thin = THREE.MathUtils.clamp(1 - (this.pos.y - 5600) / 2600, 0.15, 1);
        let thrust = THREE.MathUtils.lerp(1.5, 6.9, this.throttle) * thin;
        this.boosting = inp.boost && this.boost > 0.02;
        // boost: the dragon beats its wings, each downstroke a surge of speed
        // once the Crown is awake the boost never runs dry
        if (this.boosting) { thrust += 7 + 30 * this.dragon.downstroke; if (!this.crowned) this.boost = Math.max(0, this.boost - dt * 0.2); }
        else this.boost = Math.min(1, this.boost + dt * (0.03 + (world.boostRefill || 0)));
        if (this.crowned) this.boost = 1;
        // top speed goes as sqrt(thrust / drag), so a quarter of the drag doubles it
        const drag = 0.0012 * (inp.brake ? 5 : this.crowned ? 0.25 : 1);
        this.speed += (thrust * (1 - hv) - drag * this.speed * this.speed - 20 * this.vdir.y * (1 - hv)) * dt;
        // hovering, the wings hold the air and the last of the speed bleeds away
        this.speed -= this.speed * hv * dt * 1.5;
        this.speed = Math.max(this.speed, 18 * (1 - hv));

        // flight path follows the nose with a little slip (level, hovering)
        const grip = THREE.MathUtils.lerp(4.5, 2.2, THREE.MathUtils.clamp((this.speed - 60) / 120, 0, 1));
        this.vdir.lerp(hv > 0 ? this.fwd.clone().lerp(flat, hv) : this.fwd, Math.min(1, dt * grip)).normalize();

        // outside forces: rising air, storm wind, the edge of the world, the ceiling
        const ext = this.extVel;
        ext.multiplyScalar(Math.max(0, 1 - dt * 1.2));
        if (world.wind) ext.addScaledVector(world.wind, dt);
        if (world.thermalLift) ext.y += world.thermalLift * dt;
        const fr = Math.hypot(this.pos.x, this.pos.z);
        if (fr > BOUNDARY) {
            const push = (fr - BOUNDARY) * 0.02;
            ext.x -= (this.pos.x / fr) * push * dt * 20;
            ext.z -= (this.pos.z / fr) * push * dt * 20;
        }
        if (this.pos.y > CEILING) ext.y -= (this.pos.y - CEILING) * dt * 0.3;
        // below the cloud deck the air thickens and lifts you back up
        if (this.pos.y < -1500) ext.y += (-1500 - this.pos.y) * dt * 0.6;

        this.vel = this.vdir.clone().multiplyScalar(this.speed).add(ext);
        if (hv > 0) {
            // climb or sink on the pitch stick, and bob: each downstroke lifts a little
            this.hoverClimb += (inp.stickY * 14 - this.hoverClimb) * Math.min(1, dt * 3);
            this.vel.y += (this.hoverClimb + (this.dragon.downstroke - 0.3) * 4) * hv;
        } else this.hoverClimb = 0;
        this.pos.addScaledVector(this.vel, dt);

        this.group.position.copy(this.pos);
        this.group.quaternion.copy(this.q);
        this.dragon.update(dt, { speed: this.speed, boosting: this.boosting, brake: inp.brake, rates: this.rates, climb: this.fwd.y, hover: hv });
        this.trails.update(this, dt);
    }

    // push out of rock; returns impact speed (0 if none)
    collide(sdf, radius = 3.2) {
        const d = sdf(this.pos);
        if (d >= radius) return 0;
        const e = 0.8;
        const p = this.pos;
        const n = new THREE.Vector3(
            sdf(new THREE.Vector3(p.x + e, p.y, p.z)) - sdf(new THREE.Vector3(p.x - e, p.y, p.z)),
            sdf(new THREE.Vector3(p.x, p.y + e, p.z)) - sdf(new THREE.Vector3(p.x, p.y - e, p.z)),
            sdf(new THREE.Vector3(p.x, p.y, p.z + e)) - sdf(new THREE.Vector3(p.x, p.y, p.z - e)),
        );
        if (n.lengthSq() < 1e-9 || !isFinite(n.x)) n.copy(this.up);
        n.normalize();
        this.pos.addScaledVector(n, radius - d + 0.5);
        const vn = this.vdir.dot(n);
        let impact = 0;
        if (vn < 0) {
            impact = -vn * this.speed;
            this.vdir.addScaledVector(n, -vn * 1.6).normalize();
            this.speed *= 1 - Math.min(0.6, -vn * 0.7);
            // nose gets knocked away from the wall too
            const target = this.vdir.clone();
            const qn = new THREE.Quaternion().setFromUnitVectors(this.fwd, target);
            this.q.premultiply(new THREE.Quaternion().slerp(qn, 0.6));
            this._axes();
        }
        this.extVel.multiplyScalar(0.5);
        this.group.position.copy(this.pos);
        this.group.quaternion.copy(this.q);
        return impact;
    }
}

// ---------------------------------------------------------------------------------
class Trails {
    constructor(scene) {
        this.N = 70;
        this.meshes = [];
        this.samples = [[], []];
        const mat = new THREE.ShaderMaterial({
            uniforms: { uI: { value: 0.3 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
            vertexShader: `attribute float aT; varying float vT; varying float vD; void main(){ vT = aT; vec4 mv = modelViewMatrix * vec4(position,1.); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
            fragmentShader: `uniform float uI; varying float vT; varying float vD; void main(){ float a = pow(1.0 - vT, 1.6) * uI * smoothstep(20.0, 40.0, vD); gl_FragColor = vec4(vec3(0.85,0.95,1.0), a); ${SHADER_END} }`,
        });
        this.mat = mat;
        for (let s = 0; s < 2; s++) {
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
            const t = new Float32Array(this.N * 2);
            for (let i = 0; i < this.N; i++) t[i * 2] = t[i * 2 + 1] = i / (this.N - 1);
            g.setAttribute("aT", new THREE.BufferAttribute(t, 1));
            const idx = [];
            for (let i = 0; i < this.N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
            g.setIndex(idx);
            const m = new THREE.Mesh(g, mat);
            m.frustumCulled = false;
            scene.add(m);
            this.meshes.push(m);
        }
    }

    reset(v) {
        this.samples = [[], []];
        void v;
    }

    update(v, dt) {
        const tips = [v.tipL, v.tipR];
        for (let s = 0; s < 2; s++) {
            const p = tips[s].clone().applyQuaternion(v.q).add(v.pos);
            const arr = this.samples[s];
            arr.unshift({ p, u: v.up.clone() });
            if (arr.length > this.N) arr.pop();
            const P = this.meshes[s].geometry.attributes.position.array;
            for (let i = 0; i < this.N; i++) {
                const smp = arr[Math.min(i, arr.length - 1)];
                const w = 0.22 * (1 - i / this.N) + 0.03;
                P[i * 6] = smp.p.x + smp.u.x * w; P[i * 6 + 1] = smp.p.y + smp.u.y * w; P[i * 6 + 2] = smp.p.z + smp.u.z * w;
                P[i * 6 + 3] = smp.p.x - smp.u.x * w; P[i * 6 + 4] = smp.p.y - smp.u.y * w; P[i * 6 + 5] = smp.p.z - smp.u.z * w;
            }
            this.meshes[s].geometry.attributes.position.needsUpdate = true;
        }
        const target = 0.06 + THREE.MathUtils.clamp((v.speed - 60) / 100, 0, 1) * 0.35 + (v.boosting ? 0.3 : 0) + Math.min(0.4, Math.abs(v.rates.x) * 0.25);
        this.mat.uniforms.uI.value += (target - this.mat.uniforms.uI.value) * Math.min(1, dt * 3);
    }
}

// Speed streaks around the camera
class Streaks {
    constructor(scene) {
        this.N = 240;
        this.pts = [];
        for (let i = 0; i < this.N; i++) this.pts.push(new THREE.Vector3((Math.random() - 0.5) * 160, (Math.random() - 0.5) * 100, (Math.random() - 0.5) * 160));
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.N * 6), 3).setUsage(THREE.DynamicDrawUsage));
        this.mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
        this.lines = new THREE.LineSegments(g, this.mat);
        this.lines.frustumCulled = false;
        scene.add(this.lines);
    }

    update(camPos, vel, dt) {
        const sp = vel.length();
        const P = this.lines.geometry.attributes.position.array;
        const len = Math.min(30, sp * 0.12);
        const vd = vel.clone().normalize();
        for (let i = 0; i < this.N; i++) {
            const p = this.pts[i];
            p.addScaledVector(vel, -dt);
            for (const [k, h] of [["x", 80], ["y", 50], ["z", 80]]) {
                if (p[k] < -h) p[k] += h * 2;
                else if (p[k] > h) p[k] -= h * 2;
            }
            P[i * 6] = camPos.x + p.x; P[i * 6 + 1] = camPos.y + p.y; P[i * 6 + 2] = camPos.z + p.z;
            P[i * 6 + 3] = camPos.x + p.x - vd.x * len; P[i * 6 + 4] = camPos.y + p.y - vd.y * len; P[i * 6 + 5] = camPos.z + p.z - vd.z * len;
        }
        this.lines.geometry.attributes.position.needsUpdate = true;
        this.mat.opacity = THREE.MathUtils.clamp((sp - 75) / 120, 0, 0.35);
    }
}

// ---------------------------------------------------------------------------------
export class ChaseCamera {
    constructor(camera) {
        this.cam = camera;
        this.mode = 0;
        this.modes = [{ d: 30, h: 7.5 }, { d: 17, h: 4.2 }, { d: 75, h: 17 }];
        this.pos = new THREE.Vector3();
        this.up = new THREE.Vector3(0, 1, 0);
        this.shake = 0;
        this.fovBase = 68;
    }

    cycle() { this.mode = (this.mode + 1) % this.modes.length; }

    snap(v) {
        const m = this.modes[this.mode];
        this.pos.copy(v.pos).addScaledVector(v.fwd, -m.d).addScaledVector(v.up, m.h);
        this.up.copy(UP);
    }

    update(v, dt, settings, sdf) {
        const m = this.modes[this.mode];
        const want = v.pos.clone().addScaledVector(v.vdir, -m.d).addScaledVector(v.up, m.h);
        const k = 1 - Math.exp(-dt * (this.mode === 2 ? 2.5 : 6));
        this.pos.lerp(want, k);
        // keep the camera out of rock
        if (sdf) {
            for (let i = 0; i < 6 && sdf(this.pos) < 3; i++) this.pos.lerp(v.pos, 0.35);
        }
        const steep = Math.abs(v.fwd.y);
        const upWant = settings.camroll ? v.up.clone() : UP.clone().lerp(v.up, THREE.MathUtils.smoothstep(steep, 0.6, 0.9) + (v.up.y < 0 ? 1 : 0)).normalize();
        this.up.lerp(upWant, 1 - Math.exp(-dt * 4)).normalize();
        // (hovering, look along the heading rather than up the raised nose)
        const look = v.pos.clone().addScaledVector(v.hover > 0 ? v.fwd.clone().lerp(v.vdir, v.hover) : v.fwd, 40);
        this.cam.position.copy(this.pos);
        if (this.shake > 0) {
            this.cam.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(this.shake));
            this.shake = Math.max(0, this.shake - dt * 4);
        }
        this.cam.up.copy(this.up);
        this.cam.lookAt(look);
        const fov = this.fovBase + THREE.MathUtils.clamp((v.speed - 70) * 0.13, -6, 20) + (v.boosting ? 4 : 0);
        this.cam.fov += (fov - this.cam.fov) * Math.min(1, dt * 3);
        this.cam.updateProjectionMatrix();
    }
}
