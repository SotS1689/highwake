// All sound is synthesized: wind, an evolving score, whale song, chimes, the bell,
// thunder, and little stings for rings, discoveries and achievements.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
// D lydian-ish pentatonic for chimes and melody
export const CHIME_FREQS = [NOTE(62), NOTE(66), NOTE(69), NOTE(71), NOTE(76)];

export class Audio {
    constructor() {
        this.ctx = null;
        this.vol = 0.8;
        this.musicVol = 0.6;
    }

    start() {
        if (this.ctx) { this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = (this.ctx = new AC());
        this.master = ctx.createGain();
        this.master.gain.value = this.vol;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16; comp.ratio.value = 3;
        this.master.connect(comp).connect(ctx.destination);

        // a long, airy reverb
        this.verb = ctx.createConvolver();
        this.verb.buffer = this._impulse(4.5, 2.4);
        this.verbIn = ctx.createGain();
        this.verbIn.gain.value = 0.9;
        this.verbIn.connect(this.verb).connect(this.master);

        this.sfx = ctx.createGain();
        this.sfx.connect(this.master);
        this.sfx.connect(this.verbIn);
        this.music = ctx.createGain();
        this.music.gain.value = this.musicVol * 0.5;
        this.music.connect(this.master);
        this.music.connect(this.verbIn);

        this._wind();
        this._score();
    }

    setVolume(v) { this.vol = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }
    setMusic(v) { this.musicVol = v; if (this.music) this.music.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.3); }
    suspend() { this.ctx?.suspend(); }

    _impulse(sec, decay) {
        const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
        const b = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = b.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
        return b;
    }

    _noise(sec = 2) {
        const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
        const b = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = b.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 + w * 0.15; }
        return b;
    }

    _wind() {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this._noise(4);
        src.loop = true;
        this.windF = ctx.createBiquadFilter();
        this.windF.type = "bandpass"; this.windF.Q.value = 0.6; this.windF.frequency.value = 400;
        this.windG = ctx.createGain(); this.windG.gain.value = 0;
        src.connect(this.windF).connect(this.windG).connect(this.master);
        // high hiss for boosting
        const src2 = ctx.createBufferSource();
        src2.buffer = this._noise(3); src2.loop = true;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2500;
        this.hissG = ctx.createGain(); this.hissG.gain.value = 0;
        src2.connect(hp).connect(this.hissG).connect(this.master);
        src.start(); src2.start();
    }

    // Slowly shifting pad chords plus a sparse, wandering melody
    _score() {
        const ctx = this.ctx;
        this.padF = ctx.createBiquadFilter();
        this.padF.type = "lowpass"; this.padF.frequency.value = 900; this.padF.Q.value = 0.4;
        this.padG = ctx.createGain(); this.padG.gain.value = 0.11;
        this.padF.connect(this.padG).connect(this.music);
        this.voices = [];
        for (let i = 0; i < 4; i++) {
            const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
            o1.type = "sawtooth"; o2.type = "triangle";
            o2.detune.value = 7;
            const g = ctx.createGain(); g.gain.value = 0.25;
            o1.connect(g); o2.connect(g); g.connect(this.padF);
            o1.start(); o2.start();
            this.voices.push([o1, o2]);
        }
        this.chords = [[50, 57, 62, 66], [47, 54, 62, 64], [43, 50, 59, 66], [45, 52, 61, 64], [50, 57, 64, 69], [52, 59, 62, 67]];
        this.chordIdx = 0;
        this.nextChord = 0;
        this.nextNote = 2;
        this.intensity = 0;
        this._setChord(0);
    }

    _setChord(i) {
        const t = this.ctx.currentTime;
        this.chords[i].forEach((n, k) => {
            for (const o of this.voices[k]) o.frequency.setTargetAtTime(NOTE(n), t, 1.8);
        });
    }

    pluck(freq, when = 0, vol = 0.18, dur = 2.4, bus = null) {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime + when;
        const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o2.type = "sine"; o.frequency.value = freq; o2.frequency.value = freq * 2.005;
        const g2 = ctx.createGain(); g2.gain.value = 0.25;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        o.connect(g); o2.connect(g2).connect(g);
        g.connect(bus || this.sfx);
        o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
    }

    chime(i, vol = 0.3) {
        const f = CHIME_FREQS[i];
        this.pluck(f, 0, vol, 3.5);
        this.pluck(f * 1.5, 0.02, vol * 0.25, 2.5);
    }

    bell(seq) {
        // the bell tolls low, then plays the melody
        this.pluck(NOTE(38), 0, 0.5, 6);
        this.pluck(NOTE(50) * 1.003, 0, 0.25, 5);
        seq.forEach((n, k) => setTimeout(() => this.chime(n, 0.32), 1300 + k * 650));
    }

    wrong() {
        if (!this.ctx) return;
        this.pluck(NOTE(61), 0, 0.2, 1.4);
        this.pluck(NOTE(62), 0, 0.2, 1.4);
        this.pluck(NOTE(49), 0.05, 0.15, 1.6);
    }

    ring(k = 0) { this.pluck(NOTE(74 + (k % 5) * 2), 0, 0.22, 1.2); this.pluck(NOTE(81 + (k % 5) * 2), 0.06, 0.1, 1.0); }

    sting(big = false) {
        const notes = big ? [62, 66, 69, 74, 78, 81] : [69, 74, 78];
        notes.forEach((n, k) => this.pluck(NOTE(n), k * 0.11, big ? 0.22 : 0.18, big ? 4 : 2.5));
    }

    discover() {
        // a wide, slow swell for wonders
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        [50, 57, 62, 66, 69, 76].forEach((n, k) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = k % 2 ? "triangle" : "sine";
            o.frequency.value = NOTE(n);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.07, t + 1.5 + k * 0.15);
            g.gain.exponentialRampToValueAtTime(0.0005, t + 7);
            o.connect(g).connect(this.sfx);
            o.start(t); o.stop(t + 7.2);
        });
    }

    thump(strength) {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const src = ctx.createBufferSource(); src.buffer = this._noise(0.6);
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 300 + strength * 6;
        const g = ctx.createGain();
        g.gain.setValueAtTime(Math.min(0.9, 0.2 + strength * 0.012), t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        src.connect(f).connect(g).connect(this.sfx);
        src.start(t);
    }

    thunder(dist) {
        if (!this.ctx) return;
        const ctx = this.ctx, delay = Math.min(8, dist / 340), t = ctx.currentTime + delay;
        const vol = Math.max(0.05, 0.8 - dist / 8000);
        const src = ctx.createBufferSource(); src.buffer = this._noise(4);
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 180;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
        src.connect(f).connect(g).connect(this.sfx);
        src.start(t);
    }

    // Long gliding calls; vol by distance, pan by side
    whale(vol, pan = 0, low = false) {
        if (!this.ctx || vol < 0.01) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const o = ctx.createOscillator(), fm = ctx.createOscillator(), fmg = ctx.createGain(), g = ctx.createGain();
        const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        const base = low ? 70 : 110 + Math.random() * 60;
        o.type = "sine";
        o.frequency.setValueAtTime(base, t);
        o.frequency.linearRampToValueAtTime(base * (1.5 + Math.random() * 0.6), t + 1.4);
        o.frequency.linearRampToValueAtTime(base * 0.8, t + 3.6);
        fm.frequency.value = 5 + Math.random() * 3; fmg.gain.value = base * 0.04;
        fm.connect(fmg).connect(o.frequency);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol * 0.35, t + 0.6);
        g.gain.linearRampToValueAtTime(vol * 0.25, t + 2.6);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 4.2);
        o.connect(g);
        if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p).connect(this.sfx); } else g.connect(this.sfx);
        o.start(t); fm.start(t); o.stop(t + 4.4); fm.stop(t + 4.4);
    }

    hum(vol) {
        if (!this.ctx) return;
        if (!this.humO) {
            const ctx = this.ctx;
            this.humO = ctx.createOscillator(); this.humO.type = "sine"; this.humO.frequency.value = 55;
            const o2 = ctx.createOscillator(); o2.type = "sine"; o2.frequency.value = 82.6;
            this.humG = ctx.createGain(); this.humG.gain.value = 0;
            this.humO.connect(this.humG); o2.connect(this.humG); this.humG.connect(this.sfx);
            this.humO.start(); o2.start();
        }
        this.humG.gain.setTargetAtTime(vol * 0.25, this.ctx.currentTime, 0.4);
    }

    // a deep whump of air on each wing downstroke
    flap(strength = 1) {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        if (!this.flapBuf) this.flapBuf = this._noise(0.6);
        const src = ctx.createBufferSource();
        src.buffer = this.flapBuf;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass"; f.Q.value = 0.8;
        f.frequency.setValueAtTime(180, t);
        f.frequency.exponentialRampToValueAtTime(900, t + 0.12);
        f.frequency.exponentialRampToValueAtTime(140, t + 0.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5 * strength, t + 0.09);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        src.connect(f).connect(g).connect(this.sfx);
        src.start(t);
        src.stop(t + 0.6);
    }

    update(dt, { speed, boosting, inCloud, storm, excitement }) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const s = Math.min(1, speed / 180);
        this.windF.frequency.setTargetAtTime(250 + s * 1400, t, 0.2);
        this.windG.gain.setTargetAtTime(0.05 + s * s * 0.5 + (inCloud ? 0.15 : 0) + storm * 0.35, t, 0.2);
        this.hissG.gain.setTargetAtTime((boosting ? 0.015 : 0) + Math.max(0, s - 0.6) * 0.08, t, 0.15);

        // the score breathes with how much is happening
        this.intensity += ((excitement || 0) - this.intensity) * Math.min(1, dt * 0.3);
        this.padF.frequency.setTargetAtTime(600 + this.intensity * 1500 + s * 400, t, 1);
        this.nextChord -= dt;
        if (this.nextChord <= 0) {
            this.nextChord = 9 - this.intensity * 3;
            this.chordIdx = (this.chordIdx + 1 + Math.floor(Math.random() * 2)) % this.chords.length;
            this._setChord(this.chordIdx);
        }
        this.nextNote -= dt;
        if (this.nextNote <= 0) {
            const ch = this.chords[this.chordIdx];
            const n = ch[Math.floor(Math.random() * ch.length)] + 12 * (1 + Math.floor(Math.random() * 2));
            this.pluck(NOTE(n), 0, 0.06 + this.intensity * 0.04, 3, this.music);
            this.nextNote = (0.6 + Math.random() * 1.8) / (0.6 + this.intensity);
        }
    }
}
