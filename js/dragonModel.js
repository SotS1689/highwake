// The sky-dragon built in Blender (tools/blender/build_dragon.py → models/dragon.glb):
// a skinned mesh on a 34-bone rig with glide, flap and brake animations. It keeps the
// same interface as the code-built Dragon in dragon.js and reuses its skin shader
// (scales, belly plates, membrane veins, subsurface glow), which reads the colour,
// _glow and _skin attributes the Blender script writes per vertex.
// On top of the animations the spine is posed procedurally each frame: the tail
// sways and trails into turns, and the neck leads them.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { skinMaterial, eyeMaterial } from "./dragon.js";

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

let pending = null;
export function loadDragonModel(url = "models/dragon.glb") {
    pending ??= new GLTFLoader().loadAsync(url);
    return pending;
}

// GLTFLoader strips dots from node names ("finger0.L" becomes "finger0L")
const bn = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
const TAIL = ["hips", "tail1", "tail2", "tail3", "tail4", "tail5"];
const NECK = ["neck1", "neck2", "head"];

export class ModelDragon {
    constructor(gltf) {
        this.group = new THREE.Group();
        this.time = 0;
        this.phase = 0;
        this.amp = 0;
        this.downstroke = 0;
        this.beat = false;
        this.brakeAmt = 0;
        this.brakeVel = 0;
        this.tipL = V(); this.tipR = V();

        this.skin = skinMaterial(false);
        this.membraneMat = skinMaterial(true);
        this.eyeMat = eyeMaterial();
        const root = gltf.scene;
        this.meshes = [];
        root.traverse((o) => {
            if (!o.isMesh) return;
            const g = o.geometry;
            for (const [from, to] of [["_GLOW", "glow"], ["_glow", "glow"], ["_SKIN", "skin"], ["_skin", "skin"]]) {
                if (g.attributes[from]) { g.setAttribute(to, g.attributes[from]); g.deleteAttribute(from); }
            }
            const name = o.material.name;
            o.material = name === "membrane" ? this.membraneMat : name === "eye" ? this.eyeMat : this.skin;
            o.frustumCulled = false;
            this.meshes.push(o);
        });
        this.group.add(root);

        // rest orientation of each bone in model space, to pose the spine in model axes
        root.updateMatrixWorld(true);
        this.bones = {};
        this.rest = {};
        this.bind = {};
        const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
        root.traverse((o) => {
            if (!o.isBone) return;
            this.bones[o.name] = o;
            const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
            this.rest[o.name] = new THREE.Quaternion().setFromRotationMatrix(m);
            this.bind[o.name] = o.quaternion.clone();
        });

        this.mixer = new THREE.AnimationMixer(root);
        const clip = (n) => gltf.animations.find((a) => a.name === n);
        this.act = {};
        for (const n of ["glide", "flap", "brake"]) {
            const a = this.mixer.clipAction(clip(n));
            a.play();
            a.setEffectiveWeight(n === "glide" ? 1 : 0);
            this.act[n] = a;
        }
        this.act.flap.timeScale = 0;        // driven by the wingbeat phase
        this.act.brake.timeScale = 0;
        this.flapDur = clip("flap").duration;

        this._q = new THREE.Quaternion();
        this._r = new THREE.Quaternion();
        this._e = new THREE.Euler();
        this._v = V(); this._w = V();
        this.update(0, { speed: 70, boosting: false, brake: false, rates: V(), climb: 0 });
    }

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
        for (const m of this.meshes) m.castShadow = m.receiveShadow = size > 0 && m.material !== this.eyeMat;
    }

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

    // turn a rotation given in model axes into the bone's own frame and apply it
    _bend(name, yaw, pitch, roll = 0) {
        const b = this.bones[name];
        if (!b) return;
        const B = this.rest[name];
        this._r.setFromEuler(this._e.set(pitch, yaw, roll, "YXZ"));
        this._q.copy(B).invert().multiply(this._r).multiply(B);
        b.quaternion.multiply(this._q);
    }

    // st: { speed, boosting, brake, rates (pitch, yaw, roll rad/s), climb (fwd.y) }
    update(dt, st) {
        this.time += dt;
        // wingbeat control, as in dragon.js
        let want = st.boosting ? 1 : st.speed < 45 || st.climb > 0.55 ? 0.5 : 0;
        if (st.brake) want = 0;
        this.amp += (want - this.amp) * Math.min(1, dt * (want > this.amp ? 4 : 1.5));
        const freq = 0.75 + this.amp * 1.0;
        const before = Math.sin(this.phase);
        if (this.amp > 0.03) this.phase = (this.phase + dt * freq * TAU) % TAU;
        else this.phase += (0 - (this.phase > Math.PI ? this.phase - TAU : this.phase)) * Math.min(1, dt * 2);
        this.downstroke = this.amp * Math.max(0, Math.sin(this.phase));
        this.beat = before <= 0 && Math.sin(this.phase) > 0 && this.amp > 0.4;
        const bw = st.brake ? 1 : 0, sk = st.brake ? 90 : 45, sd = st.brake ? 11 : 12;
        const h = Math.min(dt, 1 / 30);
        this.brakeVel += ((bw - this.brakeAmt) * sk - this.brakeVel * sd) * h;
        this.brakeAmt = Math.max(-0.1, Math.min(1.15, this.brakeAmt + this.brakeVel * h));

        // blend the clips: the flap clip's frame 0 is the top of the stroke, like phase 0
        const brake = Math.max(0, Math.min(1, this.brakeAmt));
        const flap = Math.min(1 - brake, this.amp > 0.03 ? this.amp : 0);
        this.act.flap.setEffectiveWeight(flap);
        this.act.brake.setEffectiveWeight(brake);
        this.act.glide.setEffectiveWeight(Math.max(0, 1 - flap - brake));
        this.act.flap.time = (this.phase / TAU) * this.flapDur;
        // the procedural bends below multiply onto the spine, so start each frame from rest
        for (const n of TAIL.concat(NECK)) this.bones[n]?.quaternion.copy(this.bind[n]);
        this.mixer.update(dt);

        // procedural spine: tail sways and trails turns, neck leads them
        const t = this.time, r = st.rates;
        const sway = 0.35 + (1 - this.amp) * 0.2;
        TAIL.forEach((n, k) => {
            const f = k / (TAIL.length - 1);
            const yaw = -(Math.sin(t * 1.5 - k * 0.7) * sway * 0.07 * (0.3 + f) + (r.y * 0.16 - r.z * 0.04) * (0.4 + f));
            const pitch = -r.x * 0.12 * (0.4 + f) + Math.sin(t * 1.1 - k * 0.6) * 0.035 * f - this.downstroke * 0.02;
            this._bend(n, yaw, pitch);
        });
        NECK.forEach((n, k) => this._bend(n, -r.y * 0.1, -r.x * 0.06 + (k === 2 ? this.downstroke * 0.03 : 0)));

        // wingtips for the vapour trails, in dragon space
        this.group.updateMatrixWorld(true);
        for (const [sfx, out] of [[".L", this.tipL], [".R", this.tipR]]) {
            const a = this.bones[bn("finger0" + sfx)], b = this.bones[bn("finger0tip" + sfx)];
            if (!a || !b) continue;
            a.getWorldPosition(this._v);
            b.getWorldPosition(this._w);
            out.copy(this._w).multiplyScalar(2).sub(this._v);
            this.group.worldToLocal(out);
        }
    }
}
