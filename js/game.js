// The game: renderer and post-processing, loading the world, the frame loop,
// collisions, puzzles, achievements and saving.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { buildWorld, worldSDF, GATES, WONDERS, THERMALS, BELL, CHIME_ORDER, CROWN, SPAWN } from "./world.js";
import { shared, texturesReady } from "./gfx.js";
import { Sky } from "./sky.js";
import { buildIslands } from "./islands.js";
import { Land, generateLandAsync } from "./land.js";
import { Landmarks } from "./landmarks.js";
import { Creatures } from "./creatures.js";
import { Vessel, Input, ChaseCamera } from "./vessel.js";
import { Audio } from "./audio.js";

export const ACHIEVEMENTS = [
    { id: "first_flight", name: "Taking Wing", text: "Fly your first two kilometres.", icon: "➶" },
    { id: "gate_one", name: "Eye of the Needle", text: "Thread your first great arch.", icon: "◎" },
    { id: "needlework", name: "Needlework", text: "Thread all six great arches.", icon: "✦", key: true },
    { id: "gauntlet", name: "Run the Spine", text: "Finish the ring run through Hollowspine.", icon: "◉", key: true },
    { id: "gauntlet_gold", name: "Spine Racer", text: "Finish the Hollowspine run under par.", icon: "⚡" },
    { id: "resonance", name: "Resonance", text: "Answer the bell of Bellstone with its own song.", icon: "♫", key: true },
    { id: "kinship", name: "Kin of the High Sky", text: "Earn the trust of the Matriarch by flying at her side.", icon: "❂", key: true },
    { id: "slipstream", name: "Slipstream", text: "Ride a whale's wake for five seconds.", icon: "≋" },
    { id: "loop", name: "Loop the Sky", text: "Fly a full vertical loop.", icon: "↻" },
    { id: "roll", name: "Barrel Roll", text: "Roll all the way around.", icon: "⟲" },
    { id: "daredevil", name: "Rock Kisser", text: "Skim within a wingspan of rock at speed for two seconds.", icon: "⚠" },
    { id: "cloudskim", name: "Cloud Skimmer", text: "Fly low over the sea of clouds for five seconds.", icon: "☁" },
    { id: "thin_air", name: "Thin Air", text: "Climb above 6,000 metres.", icon: "▲" },
    { id: "falling_star", name: "Falling Star", text: "Reach 150 m/s in a beating dive.", icon: "✧" },
    { id: "veil", name: "Through the Veil", text: "Fly through a waterfall.", icon: "⫶" },
    { id: "wanderer", name: "Wanderer", text: "Discover four wonders.", icon: "✺" },
    { id: "wonder_seeker", name: "Wonder-Seeker", text: "Discover all eight wonders.", icon: "✹" },
    { id: "crown", name: "The Crown Awakens", text: "Bring four sky keys to the Crown and fly through it.", icon: "♛" },
];
export const KEY_NAMES = { needlework: "Key of Needles", gauntlet: "Key of the Spine", resonance: "Key of Song", kinship: "Key of Kinship" };
const SAVE_KEY = "highwake.save.v1";

const QUALITY = {
    low: { px: 0.75, bloom: false, veg: 3500, shadow: 0 },
    medium: { px: 1, bloom: true, veg: 6000, shadow: 1024 },
    high: { px: 1.5, bloom: true, veg: 9000, shadow: 2048 },
    ultra: { px: 2, bloom: true, veg: 14000, shadow: 4096 },
};

export class Game {
    constructor(canvas, ui, settings, track) {
        this.canvas = canvas;
        this.ui = ui;
        this.settings = settings;
        this.track = track;
        this.state = "loading";
        this.save = this._load();
        this.audio = new Audio();
        this.audio.setVolume(settings.vol);
        this.audio.setMusic(settings.music);

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(68, 1, 1.5, 95000);
        this.camera.position.set(3500, 3000, 3500);
        this.input = new Input(canvas, settings);
        this.clock = new THREE.Clock();
        this.time = 0;
        addEventListener("resize", () => this.resize());
    }

    // ---- loading ----------------------------------------------------------------------------
    async load(onProgress) {
        this.entities = buildWorld();
        const landData = generateLandAsync();
        const texReady = texturesReady();
        this.sky = new Sky(this.scene, this.renderer);
        onProgress(0.03, "Raising the islands…");
        const isl = await buildIslands(this.scene, this.entities, (f) => onProgress(0.05 + f * 0.8, "Raising the islands…"));
        this.veg = isl.veg;
        this.sky.setFarGeometries(this.entities.map((e, i) => ({ geo: isl.meshes[i].geometry, r: e.r, big: e.kind === "island" && !e.small })).filter((g) => g.big));
        this.falls = isl.falls;
        onProgress(0.86, "Unrolling the world below…");
        this.land = new Land(this.scene, await landData, this.sky);
        onProgress(0.88, "Waking the wonders…");
        await new Promise((r) => setTimeout(r, 0));
        this.landmarks = new Landmarks(this.scene, this.entities, this.sky);
        onProgress(0.93, "Calling the whales…");
        await new Promise((r) => setTimeout(r, 0));
        this.creatures = new Creatures(this.scene, this.entities, this.landmarks);
        for (const f of this.falls.list) if (f.mist) for (let k = 0; k < 3; k++) this.sky.addCloud([f.mist.x + (Math.random() - 0.5) * 90, f.mist.y + (Math.random() - 0.5) * 120, f.mist.z + (Math.random() - 0.5) * 90], 160 + Math.random() * 120, 0.6);
        this.sky.finishClouds();
        this.vessel = new Vessel(this.scene);
        this.chase = new ChaseCamera(this.camera);
        this.sdf = (p) => Math.min(worldSDF(this.entities, p.x, p.y, p.z, 30), this.landmarks.sdf(p), this.creatures.sdf(p));
        this.applyQuality();
        this.applySettings();
        this._initPuzzles();
        this.resize();
        await texReady;
        // compile shaders before the first real frame
        this.renderer.compile(this.scene, this.camera);
        onProgress(1, "Ready");
        this.state = "title";
        this.vessel.reset(SPAWN.pos, SPAWN.dir);
        this.vessel.group.visible = false;
        this.renderer.setAnimationLoop(() => this.frame());
    }

    applyQuality() {
        const q = QUALITY[this.settings.quality] || QUALITY.high;
        const px = Math.min(window.devicePixelRatio || 1, q.px);
        this.renderer.setPixelRatio(px);
        this.px = px;
        this.vegRange = q.veg;
        this.vessel?.dragon.setShadows(this.sky.sun, q.shadow);
        if (q.bloom && !this.composer) {
            // multisampled, or thin far-off lines (trunks, vines, falls) shimmer once bloom is on
            const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
            this.composer = new EffectComposer(this.renderer, rt);
            this.composer.addPass(new RenderPass(this.scene, this.camera));
            this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.55, 0.88);
            this.composer.addPass(this.bloom);
            this.composer.addPass(new OutputPass());
        }
        this.useComposer = q.bloom;
        this.resize();
    }

    applySettings() {
        this.sky?.setMode(this.settings.time);
        this.audio.setVolume(this.settings.vol);
        this.audio.setMusic(this.settings.music);
    }

    resize() {
        const w = innerWidth, h = innerHeight;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        if (this.composer) {
            this.composer.setPixelRatio(this.renderer.getPixelRatio());
            this.composer.setSize(w, h);
            this.bloom?.resolution.set(w / 2, h / 2);
        }
        const pxScale = (h * this.renderer.getPixelRatio()) / 1000;
        this.landmarks?.thermalPts.material.uniforms.uPx && (this.landmarks.thermalPts.material.uniforms.uPx.value = pxScale);
        this.creatures?.setPixelScale(pxScale);
    }

    // ---- state ------------------------------------------------------------------------------
    startFlight() {
        this.audio.start();
        if (this.state === "title") {
            this.vessel.reset(SPAWN.pos, SPAWN.dir);
            this.chase.snap(this.vessel);
            this.vessel.group.visible = true;
            this.track("game_start", { returning: Object.keys(this.save.ach).length > 0 });
            if (!this.save.introduced) {
                setTimeout(() => this.ui.toast({ kicker: "Highwake", title: "Find the four Sky Keys", text: "Wake the Crown that sleeps above the Heartspire. Look for diamonds on the horizon.", big: true }), 2500);
                this.save.introduced = true;
                this._persist();
            }
        }
        this.state = "flying";
        this.input.lock();
        this.clock.getDelta();
    }

    pause() {
        if (this.state !== "flying") return;
        this.state = "paused";
        if (document.pointerLockElement) document.exitPointerLock();
        this.ui.showPause(true);
    }

    respawn() {
        this.vessel.reset(SPAWN.pos, SPAWN.dir);
        this.chase.snap(this.vessel);
        this.gaunt.running = false;
        this.landmarks.setRingState(0, false);
    }

    // ---- puzzles ------------------------------------------------------------------------------
    _initPuzzles() {
        const L = this.landmarks;
        this.gaunt = { running: false, next: 0, t: 0 };
        let len = 0;
        for (let i = 1; i < L.ringPts.length; i++) len += L.ringPts[i].distanceTo(L.ringPts[i - 1]);
        // a flawless straight-line run averages about 67 m/s; par leaves room for real turns
        this.gauntPar = Math.ceil(len / 58);
        L.setRingState(0, false);
        this.chime = { progress: 0, timer: 3, cooldown: [0, 0, 0, 0, 0] };
        this.save.gates = GATES.map((_, i) => !!(this.save.gates || [])[i]);
        this.save.gates.forEach((g, i) => g && L.setGateDone(i));
        this.counters = { loopAcc: 0, loopIdle: 0, rollAcc: 0, rollIdle: 0, dare: 0, skim: 0, slip: 0, flown: 0, crownMsg: 0, whaleSong: 3, boundaryMsg: 0, autoQ: { t: 0, frames: 0, done: false } };
        this.prevPos = new THREE.Vector3().fromArray(SPAWN.pos);
        this._refreshKeys();
        // sanity check: gauntlet rings must sit in open air
        L.ringPts.forEach((p, i) => { const d = worldSDF(this.entities, p.x, p.y, p.z, 60); if (d < 30) console.warn("ring", i, "is close to rock", d.toFixed(1)); });
    }

    keys() { return Object.keys(KEY_NAMES).filter((k) => this.save.ach[k]); }

    _refreshKeys() {
        this.landmarks.setKeys(this.keys(), this.save.awake);
        this.sky.aurora = this.save.awake ? 1 : 0;
        this.vessel.crowned = !!this.save.awake;
        this.ui.setKeys(this.keys());
    }

    unlock(id) {
        if (this.save.ach[id]) return false;
        this.save.ach[id] = Date.now();
        const a = ACHIEVEMENTS.find((x) => x.id === id);
        this.track("achievement_unlocked", { achievement_id: id });
        if (a.key) {
            this.ui.toast({ kicker: "Sky key found", title: KEY_NAMES[id], text: `${a.name}: ${a.text} (${this.keys().length}/4 keys)`, big: true });
            this.audio.sting(true);
            this.track("key_earned", { key_id: id });
            this._refreshKeys();
            if (this.keys().length === 4) setTimeout(() => this.ui.toast({ kicker: "The Crown stirs", title: "Fly up through the Crown", text: "A beam of light now rises from the Heartspire." }), 4000);
        } else {
            this.ui.toast({ kicker: "Achievement", title: a.name, text: a.text });
            this.audio.sting(false);
        }
        this._persist();
        this.ui.refreshJournal();
        return true;
    }

    discover(w) {
        if (this.save.won[w.id]) return;
        this.save.won[w.id] = Date.now();
        this.track("wonder_found", { wonder_id: w.id });
        this.ui.toast({ kicker: "Wonder discovered", title: w.name, text: w.text, big: true });
        this.audio.discover();
        const n = Object.keys(this.save.won).length;
        if (n >= 4) setTimeout(() => this.unlock("wanderer"), 3500);
        if (n >= WONDERS.length) setTimeout(() => this.unlock("wonder_seeker"), 5000);
        this._persist();
        this.ui.refreshJournal();
    }

    _crossed(prev, cur, center, normal, radius) {
        const c = new THREE.Vector3(...center), n = new THREE.Vector3(...normal);
        const s0 = prev.clone().sub(c).dot(n), s1 = cur.clone().sub(c).dot(n);
        if ((s0 > 0) === (s1 > 0) || s0 === s1) return false;
        const x = prev.clone().lerp(cur, s0 / (s0 - s1));
        return x.distanceTo(c) < radius;
    }

    _puzzles(dt, p, prev, v) {
        const L = this.landmarks, C = this.counters;

        // arches
        GATES.forEach((g, i) => {
            if (this._crossed(prev, p, g.center, g.normal, g.radius)) {
                if (!this.save.gates[i]) {
                    this.save.gates[i] = true;
                    L.setGateDone(i);
                    const n = this.save.gates.filter(Boolean).length;
                    this.audio.sting(false);
                    if (!this.unlock("gate_one")) this.ui.toast({ kicker: "Arch threaded", title: g.name, text: `${n} of ${GATES.length} great arches` });
                    else this.ui.toast({ kicker: "Arch threaded", title: g.name, text: `${n} of ${GATES.length} great arches. Thread them all.` });
                    if (n === GATES.length) setTimeout(() => this.unlock("needlework"), 2000);
                    this._persist();
                } else this.audio.ring(i);
            }
        });

        // gauntlet
        const G = this.gaunt, rings = L.rings;
        if (G.running) {
            G.t += dt;
            const r = rings[G.next];
            if (this._crossed(prev, p, r.pos.toArray(), r.dir.toArray(), 28)) {
                this.audio.ring(G.next);
                G.next++;
                if (G.next >= rings.length) {
                    G.running = false;
                    const t = G.t;
                    const best = this.save.best.gauntlet;
                    if (!best || t < best) this.save.best.gauntlet = t;
                    this.ui.toast({ kicker: "Hollowspine run", title: `${t.toFixed(1)} s`, text: `Par ${this.gauntPar} s.${best ? ` Best ${Math.min(best, t).toFixed(1)} s.` : ""}` });
                    this.unlock("gauntlet");
                    if (t <= this.gauntPar) setTimeout(() => this.unlock("gauntlet_gold"), 2500);
                    L.setRingState(0, false);
                    this._persist();
                } else L.setRingState(G.next, true);
            }
            if (G.t > 300 || p.distanceTo(L.ringPts[0]) > 4500) {
                G.running = false;
                L.setRingState(0, false);
                this.ui.toast({ kicker: "Hollowspine run", title: "Run abandoned", text: "Fly through the first ring to try again." });
            }
        } else if (this._crossed(prev, p, rings[0].pos.toArray(), rings[0].dir.toArray(), 28)) {
            G.running = true; G.next = 1; G.t = 0;
            L.setRingState(1, true);
            this.audio.ring(0);
            this.ui.toast({ kicker: "Hollowspine run", title: "Go!", text: `Thread every ring through the island. Par ${this.gauntPar} s.` });
        }

        // the bell's song
        const bellPos = new THREE.Vector3(...BELL.pos);
        const dBell = p.distanceTo(bellPos);
        if (!this.save.ach.resonance && dBell < BELL.hear) {
            this.chime.timer -= dt;
            if (this.chime.timer <= 0) {
                this.chime.timer = 16;
                this.audio.bell(CHIME_ORDER);
                L.pulseBell(1);
                CHIME_ORDER.forEach((ci, k) => setTimeout(() => L.pulseChime(ci, 1), 1300 + k * 650));
                if (!this.save.heardBell) {
                    this.save.heardBell = true;
                    this.ui.toast({ kicker: "Bellstone", title: "The bell sings", text: "Five crystals float around the island. Fly through them in the order of its song." });
                }
            }
        } else this.chime.timer = Math.min(this.chime.timer, 2);
        L.chimes.forEach((c, i) => {
            this.chime.cooldown[i] -= dt;
            if (this.chime.cooldown[i] > 0) return;
            if (p.distanceTo(c.mesh.position) < 38) {
                this.chime.cooldown[i] = 2;
                this.audio.chime(c.note);
                L.pulseChime(i, 1);
                if (this.save.ach.resonance) return;
                if (CHIME_ORDER[this.chime.progress] === i) {
                    c.lit = true;
                    this.chime.progress++;
                    if (this.chime.progress === CHIME_ORDER.length) {
                        setTimeout(() => { CHIME_ORDER.forEach((n, k) => setTimeout(() => this.audio.chime(n, 0.35), k * 300)); }, 600);
                        L.pulseBell(2);
                        setTimeout(() => this.unlock("resonance"), 2200);
                    }
                } else {
                    this.audio.wrong();
                    L.chimes.forEach((cc) => (cc.lit = false));
                    this.chime.progress = 0;
                    this.chime.timer = Math.min(this.chime.timer, 1.5);
                    this.ui.hint("A wrong note. Listen to the bell again.");
                }
            }
        });

        // the Matriarch
        const M = this.creatures.matriarch;
        const dM = p.distanceTo(M.pos);
        if (!this.save.ach.kinship) {
            if (dM < 200) {
                if (!this.bondNear) { this.bondNear = true; this.ui.toast({ kicker: "The Matriarch", title: "She has noticed you", text: "Stay close beside her. Slow down to match her pace." }); }
                this.save.bond = (this.save.bond || 0) + dt;
                if (this.save.bond >= 20) this.unlock("kinship");
            } else if (dM > 800) this.bondNear = false;
        }

        // whale wakes
        let wake = null;
        for (const w of this.creatures.whales) {
            const rel = p.clone().sub(w.pos);
            const along = rel.dot(w.fwd);
            if (along > -w.length * 0.35 || along < -w.length * 2) continue;
            const lat = rel.clone().addScaledVector(w.fwd, -along).length();
            if (lat < w.length * 0.28) { wake = w; break; }
        }
        this.inWake = wake;
        C.slip = wake ? C.slip + dt : 0;
        if (C.slip > 5) this.unlock("slipstream");

        // wonders
        for (const w of WONDERS) if (!this.save.won[w.id] && p.distanceTo(new THREE.Vector3(...w.pos)) < w.r) this.discover(w);

        // the Crown
        if (this._crossed(prev, p, CROWN.pos, [0, 1, 0], CROWN.radius - CROWN.tube)) {
            if (this.keys().length >= 4 && !this.save.awake) this._awaken();
            else if (!this.save.awake && this.time - C.crownMsg > 30) {
                C.crownMsg = this.time;
                this.ui.toast({ kicker: "The Sleeping Crown", title: `${4 - this.keys().length} sky keys are missing`, text: "Its sockets are dark. Find the keys and return." });
            }
        }

        // flying feats
        const ax = v.rates;
        if (Math.abs(ax.x) > 0.5 && Math.sign(ax.x) === Math.sign(C.loopAcc || ax.x)) { C.loopAcc += ax.x * dt; C.loopIdle = 0; }
        else { C.loopIdle += dt; if (C.loopIdle > 0.8 || Math.sign(ax.x) !== Math.sign(C.loopAcc)) C.loopAcc = 0; }
        if (Math.abs(C.loopAcc) > Math.PI * 1.9) this.unlock("loop");
        if (Math.abs(ax.z) > 1.2 && Math.sign(ax.z) === Math.sign(C.rollAcc || ax.z)) { C.rollAcc += ax.z * dt; C.rollIdle = 0; }
        else { C.rollIdle += dt; if (C.rollIdle > 0.5) C.rollAcc = 0; }
        if (Math.abs(C.rollAcc) > Math.PI * 1.9) this.unlock("roll");

        C.flown += v.speed * dt;
        if (C.flown > 2000) this.unlock("first_flight");
        C.dare = this.lastSdf < 14 && v.speed > 85 ? C.dare + dt : 0;
        if (C.dare > 2) this.unlock("daredevil");
        C.skim = p.y < 280 ? C.skim + dt : 0;
        if (C.skim > 5) this.unlock("cloudskim");
        if (p.y > 6000) this.unlock("thin_air");
        if (v.speed > 150) this.unlock("falling_star");
        if (this.falls.inside(p)) this.unlock("veil");
    }

    _awaken() {
        this.save.awake = true;
        this._persist();
        this._refreshKeys();
        this.ui.flash();
        this.audio.sting(true);
        this.audio.discover();
        this.track("crown_awakened");
        this.unlock("crown");
        this.ui.ending("The Crown Awakens", "Light pours through the old ring, and every island below answers it. The high sky is awake, and it is yours to wander. Your dragon's wings will never tire again.");
    }

    // ---- frame ----------------------------------------------------------------------------------
    frame(fixedDt) {
        const dt = fixedDt ?? Math.min(0.05, this.clock.getDelta());
        this.time += dt;
        shared.uTime.value = this.time;
        const flying = this.state === "flying";

        if (this.state === "title" || this.state === "paused") {
            if (this.state === "title") {
                const a = this.time * 0.025 + 0.6;
                this.camera.position.set(Math.cos(a) * 4200, 3050 + Math.sin(this.time * 0.05) * 150, Math.sin(a) * 4200);
                this.camera.up.set(0, 1, 0);
                this.camera.lookAt(0, 2900, 0);
                this.camera.fov = 62;
                this.camera.updateProjectionMatrix();
            }
        }

        let world = {};
        if (flying) {
            const inp = this.input.read(dt);
            if (inp.pressed.has("Escape")) { this.pause(); }
            if (inp.pressed.has("KeyC")) this.chase.cycle();
            if (inp.pressed.has("KeyJ")) { this.pause(); this.ui.openJournal("ach"); }
            if (inp.pressed.has("KeyM")) { this.pause(); this.ui.openJournal("map"); }
            const v = this.vessel;
            world = this._environment(v.pos);
            // substeps keep fast flight from tunnelling through thin rock
            const steps = Math.min(4, Math.max(1, Math.ceil((v.speed * dt) / 3)));
            this.prevPos.copy(v.pos);
            let impact = 0;
            for (let s = 0; s < steps; s++) {
                v.update(dt / steps, s === 0 ? inp : { ...inp, thr: 0, pressed: new Set() }, this.settings, world);
                impact = Math.max(impact, v.collide(this.sdf));
            }
            if (impact > 4) {
                this.chase.shake = Math.min(3, impact * 0.05);
                this.audio.thump(impact);
            }
            this.lastSdf = worldSDF(this.entities, v.pos.x, v.pos.y, v.pos.z, 30);
            this._puzzles(dt, v.pos, this.prevPos, v);
            this.chase.update(v, dt, this.settings, this.sdf);
            if (world.storm > 0.3) this.chase.shake = Math.max(this.chase.shake, world.storm * 0.5);
            v.streaks.update(this.camera.position, v.vel, dt);
            this._autoQuality(dt);
        }

        const playerPos = flying || this.state === "paused" ? this.vessel.pos : this.camera.position;
        this.sky.update(this.state === "paused" ? 0 : dt, this.camera);
        this.vessel.dragon.aimLights(this.sky.sun, this.sky.hemi);
        this.land.update(this.camera);
        if (this.state !== "paused") {
            const strike = this.landmarks.update(dt, this.time, playerPos);
            if (strike && flying) this.audio.thunder(strike.distanceTo(playerPos));
            this.creatures.update(dt, this.time, playerPos);
        }
        this.veg.update(this.camera.position, this.vegRange);
        if (flying) this._sounds(dt, world);
        if (flying) this.ui.hud(this._hudData(world));

        if (this.useComposer) this.composer.render();
        else this.renderer.render(this.scene, this.camera);
    }

    _environment(p) {
        const out = { wind: new THREE.Vector3(), thermalLift: 0, boostRefill: 0, storm: 0 };
        for (const t of THERMALS) {
            if (p.y < t.y0 || p.y > t.y1) continue;
            const d = Math.hypot(p.x - t.x, p.z - t.z);
            if (d < t.r * 1.5) {
                const f = 1 - d / (t.r * 1.5);
                out.thermalLift += 46 * f;
                out.boostRefill += 0.4 * f;
                out.inThermal = true;
            }
        }
        if (this.inWake) {
            out.wind.addScaledVector(this.inWake.fwd, 40);
            out.boostRefill += 0.5;
        }
        // the storm wheel
        const S = this.landmarks.stormC;
        const dx = p.x - S.x, dz = p.z - S.z, R = Math.hypot(dx, dz);
        if (R > 1150 && R < 2700 && Math.abs(p.y - S.y) < 1200) {
            const f = Math.sin(((R - 1150) / 1550) * Math.PI);
            out.storm = f;
            out.wind.add(new THREE.Vector3(-dz / R, (Math.random() - 0.5) * 2, dx / R).multiplyScalar(70 * f));
            out.wind.add(new THREE.Vector3((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 120).multiplyScalar(f));
        }
        out.inCloud = p.y < 380 && p.y > -120;
        return out;
    }

    _sounds(dt, world) {
        const v = this.vessel, C = this.counters;
        const nearWonder = WONDERS.some((w) => this.vessel.pos.distanceTo(new THREE.Vector3(...w.pos)) < w.r * 1.5);
        this.audio.update(dt, {
            speed: v.speed, boosting: v.boosting, inCloud: world.inCloud, storm: world.storm || 0,
            excitement: Math.min(1, (this.gaunt.running ? 0.7 : 0) + (nearWonder ? 0.4 : 0) + Math.max(0, (v.speed - 90) / 150) + (world.storm || 0) * 0.5),
        });
        if (v.dragon.beat) this.audio.flap(0.6 + v.dragon.amp * 0.4);
        C.whaleSong -= dt;
        if (C.whaleSong <= 0) {
            C.whaleSong = 4 + Math.random() * 7;
            let best = null, bd = Infinity;
            for (const w of this.creatures.whales) { const d = w.pos.distanceTo(v.pos); if (d < bd) { bd = d; best = w; } }
            if (best && bd < 3000) {
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
                const pan = best.pos.clone().sub(this.camera.position).normalize().dot(right);
                this.audio.whale(1 - bd / 3000, pan, best.length > 300);
            }
        }
        const dMono = v.pos.distanceTo(this.landmarks.monolith.position);
        this.audio.hum(Math.max(0, 1 - dMono / 1600));
        this.landmarks.monoBoost = Math.max(0, 1 - dMono / 900) * 1.5;
    }

    _autoQuality(dt) {
        const A = this.counters.autoQ;
        if (A.done || !this.settings.autoQuality) return;
        A.t += dt; A.frames++;
        if (A.t < 2) { A.frames = 0; return; }
        if (A.t > 8) {
            const fps = A.frames / (A.t - 2);
            A.done = true;
            const order = ["low", "medium", "high", "ultra"];
            const i = order.indexOf(this.settings.quality);
            if (fps < 42 && i > 0) {
                this.settings.quality = order[i - 1];
                this.ui.saveSettings();
                this.applyQuality();
                this.ui.hint(`Graphics set to ${order[i - 1]} for smoother flight. Change it in Settings.`);
                A.done = false; A.t = 0; A.frames = 0;
            }
        }
    }

    _hudData(world) {
        const v = this.vessel;
        const markers = [];
        const keys = this.keys();
        if (!this.save.ach.gauntlet || this.gaunt.running) {
            if (this.gaunt.running) markers.push({ pos: this.landmarks.rings[this.gaunt.next].pos, label: `${this.gaunt.next + 1}/${this.landmarks.rings.length}`, ring: true });
            else markers.push({ pos: this.landmarks.ringPts[0], label: "Hollowspine run", min: 300 });
        }
        if (!this.save.ach.resonance) markers.push({ pos: new THREE.Vector3(...BELL.pos), label: "Bellstone", min: 1200 });
        if (!this.save.ach.kinship) markers.push({ pos: this.creatures.matriarch.pos, label: "The Matriarch", min: 500 });
        if (!this.save.ach.needlework) GATES.forEach((g, i) => { if (!this.save.gates[i]) markers.push({ pos: new THREE.Vector3(...g.center), label: g.name, min: 250, small: true }); });
        if (keys.length >= 4 && !this.save.awake) markers.push({ pos: new THREE.Vector3(...CROWN.pos), label: "The Crown", min: 400 });

        let status = "";
        if (this.gaunt.running) status = `Hollowspine run  ${this.gaunt.t.toFixed(1)} s  ·  ring ${this.gaunt.next + 1}/${this.landmarks.rings.length}`;
        else if (!this.save.ach.kinship && this.bondNear) status = `The Matriarch's trust  ${Math.min(100, Math.round(((this.save.bond || 0) / 20) * 100))}%`;
        else if (!this.save.ach.resonance && this.chime.progress > 0) status = `Song  ${"♪".repeat(this.chime.progress)}${"·".repeat(5 - this.chime.progress)}`;
        else if (this.inWake) status = "Riding the wake";
        else if (world.inThermal) status = "Rising air";
        else if (world.storm > 0.2) status = "The storm wheel";

        return {
            speed: v.speed, alt: v.pos.y, throttle: v.throttle, boost: v.boost,
            heading: Math.atan2(v.fwd.x, -v.fwd.z), stick: this.input.stick, locked: this.input.locked,
            markers, status, camera: this.camera,
            aim: v.pos.clone().addScaledVector(v.fwd, 400),
        };
    }

    // ---- screenshots (?shot=name), used for testing and the link-preview image ----------------
    debugShot(name, time) {
        const W = this.creatures.matriarch;
        const S = this.landmarks.stormC;
        const presets = {
            start: () => [SPAWN.pos, SPAWN.dir],
            arch: () => [[1750, 1770, -70], [-1, -0.01, 0.05]],
            whales: () => {
                const right = new THREE.Vector3().crossVectors(W.fwd, new THREE.Vector3(0, 1, 0)).normalize();
                return [W.pos.clone().addScaledVector(right, -330).addScaledVector(W.fwd, -260).add(new THREE.Vector3(0, 60, 0)).toArray(), W.fwd.clone().addScaledVector(right, 0.35).toArray()];
            },
            tree: () => [[-900, 3300, -3300], [-0.75, -0.08, -0.6]],
            storm: () => [[S.x - 3200, S.y + 300, S.z - 600], [1, -0.05, 0.2]],
            under: () => [[350, 500, 1700], [-0.1, 0.55, -0.8]],
            crown: () => [[1500, 4300, 1500], [-0.6, 0.45, -0.6]],
            below: () => [[5200, 2600, 5200], [0.55, -0.6, 0.55]],
            vista: () => [[-6000, 5200, 6000], [0.75, -0.18, -0.6]],
        };
        this.settings.time = time || "golden";
        this.applySettings();
        this.state = "flying";
        this.vessel.group.visible = true;
        for (let i = 0; i < 30; i++) this.frame(1 / 30);
        const [p, d] = (presets[name] || presets.start)();
        this.vessel.reset(p, d);
        this.chase.snap(this.vessel);
        for (let i = 0; i < 40; i++) this.frame(1 / 60);
        this.renderer.setAnimationLoop(null);
        this.frame(1 / 60);
    }

    // ---- saving ---------------------------------------------------------------------------------
    _load() {
        const blank = { ach: {}, won: {}, gates: GATES.map(() => false), best: {}, awake: false, bond: 0 };
        try {
            const s = JSON.parse(localStorage.getItem(SAVE_KEY));
            if (s && s.ach) return { ...blank, ...s, gates: GATES.map((_, i) => !!(s.gates || [])[i]) };
        } catch { /* fresh start */ }
        return blank;
    }

    _persist() {
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch { /* private mode */ }
    }

    resetProgress() {
        this.save = { ach: {}, won: {}, gates: GATES.map(() => false), best: {}, awake: false, bond: 0 };
        this._persist();
        this.landmarks.gateMeshes.forEach((m) => { m.material.color.setRGB(0.6, 1.1, 1.3); m.material.opacity = 0.3; });
        this.landmarks.chimes.forEach((c) => (c.lit = false));
        this._refreshKeys();
        this.ui.refreshJournal();
    }

    stats() {
        return { ach: Object.keys(this.save.ach).length, total: ACHIEVEMENTS.length, won: Object.keys(this.save.won).length, keys: this.keys().length };
    }
}
