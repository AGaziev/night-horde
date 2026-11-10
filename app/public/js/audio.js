// Procedural sound: synthesized effects and adaptive music on the Web Audio API. No audio files.
import { ENEMIES, ENEMY_TYPES, PROJECTILE_KINDS, breakableAt } from '/shared/content.js';

const STORE_KEY = 'nh.audio';
const DEFAULTS = { muted: false, music: 0.55, sfx: 0.8 };

// Hearing range around the own hero: full volume up to HEAR_FULL, silent beyond HEAR_MAX.
const HEAR_FULL = 380;
const HEAR_MAX = 1050;
const PAN_SPAN = 650;
const MIN_AUDIBLE = 0.05;
const MAX_VOICES = 32;
const LOOKAHEAD = 0.3;
const MAX_SHOT_DELAY = 0.35;

// Rate limits per sound: at most `max` starts within `win` seconds.
const LIMITS = {
	hit: [0.05, 2], crit: [0.06, 2], die: [0.05, 3], bigdie: [0.12, 2],
	bolt: [0.05, 2], knife: [0.05, 2], sickle: [0.08, 2], icedisc: [0.08, 2], spear: [0.08, 2],
	slash: [0.06, 2], tslash: [0.1, 2], zap: [0.07, 2], thunder: [0.25, 1],
	boom: [0.06, 3], lob: [0.08, 2], orb: [0.2, 2], eshot: [0.08, 2], warn: [0.1, 2],
	frost: [0.2, 2], shard: [0.05, 2], snap: [0.08, 2], brk: [0.08, 2], blink: [0.1, 2],
	gem: [0.045, 1], puddle: [0.12, 2], hurt: [0.14, 1], default: [0.05, 2],
};
// Sounds that must play even when the voice pool is full.
const PRIORITY = new Set(['hurt', 'down', 'up', 'lvl', 'pick', 'boss', 'chest', 'duo', 'inv', 'item', 'open', 'elite', 'ui', 'sting', 'bigdie']);

const PENTA = [0, 3, 5, 7, 10]; // minor pentatonic steps
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);

// 8-bar loop in D minor: Dm | Bb | Gm | A | Dm | F | Gm | A.
const BARS = [
	{ root: 38, pad: [50, 53, 57] },
	{ root: 34, pad: [50, 53, 58] },
	{ root: 31, pad: [50, 55, 58] },
	{ root: 33, pad: [49, 52, 57] },
	{ root: 38, pad: [50, 53, 57] },
	{ root: 41, pad: [48, 53, 57] },
	{ root: 31, pad: [50, 55, 58] },
	{ root: 33, pad: [49, 52, 57] },
];
// Melody per bar: [step (16ths), midi, length in steps].
const MELODY = [
	[[0, 69, 4], [4, 72, 2], [6, 74, 2], [8, 77, 6], [14, 76, 2]],
	[[0, 74, 6], [6, 72, 2], [8, 70, 4], [12, 69, 4]],
	[[0, 67, 4], [4, 70, 4], [8, 74, 4], [12, 72, 2], [14, 70, 2]],
	[[0, 69, 8], [8, 73, 4], [12, 76, 4]],
	[[0, 77, 4], [4, 76, 2], [6, 74, 2], [8, 72, 4], [12, 74, 4]],
	[[0, 72, 4], [4, 69, 4], [8, 72, 4], [12, 77, 4]],
	[[0, 79, 4], [4, 77, 2], [6, 74, 2], [8, 70, 4], [12, 74, 4]],
	[[0, 73, 6], [6, 76, 2], [8, 74, 8]],
];
const BPM = 84;
const STEP = 60 / BPM / 4;

function loadSettings() {
	try {
		const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
		if (v && typeof v === 'object') {
			return {
				muted: !!v.muted,
				music: clamp(Number.isFinite(+v.music) ? +v.music : DEFAULTS.music, 0, 1),
				sfx: clamp(Number.isFinite(+v.sfx) ? +v.sfx : DEFAULTS.sfx, 0, 1),
			};
		}
	} catch { /* storage blocked or corrupt */ }
	return { ...DEFAULTS };
}

export class Sound {
	constructor() {
		this.ctx = null;
		this.settings = loadSettings();
		this.onChange = () => {};
		this.voiceEnds = [];
		this.rate = new Map();
		this.stats = { sfx: 0, music: 0, dropped: 0, limited: 0 };
		this.mode = 'menu';
		this.intensity = 0.1;
		this.target = 0.1;
		this.gemStreak = 0;
		this.gemLast = 0;
		this.prevSnap = null;
		this.failed = 0;
		this.tmp = { x: 0, y: 0 };
		const unlock = () => this.unlock();
		for (const t of ['pointerdown', 'touchend', 'keydown', 'click']) addEventListener(t, unlock, { capture: true, passive: true });
		document.addEventListener('visibilitychange', () => {
			if (!this.ctx) return;
			if (document.hidden) this.ctx.suspend().catch(() => {});
			else this.ctx.resume().catch(() => {});
		});
	}

	// --- Setup ---

	unlock() {
		if (!this.ctx) {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) return;
			try {
				this.ctx = new AC({ latencyHint: 'interactive' });
			} catch {
				return;
			}
			this.build();
		}
		if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {});
	}

	build() {
		const c = this.ctx;
		this.master = c.createGain();
		this.master.gain.value = this.settings.muted ? 0 : 1;
		const comp = c.createDynamicsCompressor();
		comp.threshold.value = -16;
		comp.knee.value = 10;
		comp.ratio.value = 5;
		comp.attack.value = 0.004;
		comp.release.value = 0.2;
		const limit = c.createDynamicsCompressor();
		limit.threshold.value = -3;
		limit.knee.value = 0;
		limit.ratio.value = 20;
		limit.attack.value = 0.001;
		limit.release.value = 0.08;
		this.out = c.createGain();
		this.out.gain.value = 0.92;
		this.analyser = c.createAnalyser();
		this.analyser.fftSize = 2048;
		this.master.connect(comp).connect(limit).connect(this.out);
		this.out.connect(this.analyser);
		this.out.connect(c.destination);

		this.sfxBus = c.createGain();
		this.musicBus = c.createGain();
		this.sfxBus.connect(this.master);
		this.musicBus.connect(this.master);
		this.applyVolumes();

		// One shared reverb tail for music and the big moments.
		this.verb = c.createConvolver();
		this.verb.buffer = this.impulse(2.4);
		this.verbOut = c.createGain();
		this.verbOut.gain.value = 0.55;
		this.verb.connect(this.verbOut).connect(this.master);
		this.musicVerb = c.createGain();
		this.musicVerb.gain.value = 0.4;
		this.musicVerb.connect(this.verb);
		this.sfxVerb = c.createGain();
		this.sfxVerb.gain.value = 0.35;
		this.sfxVerb.connect(this.verb);
		// Music verb send is scaled by the music volume, sfx send by the effects volume.
		this.musicVerbVol = c.createGain();
		this.sfxVerbVol = c.createGain();
		this.musicVerbVol.connect(this.musicVerb);
		this.sfxVerbVol.connect(this.sfxVerb);
		this.applyVolumes();

		this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
		const d = this.noise.getChannelData(0);
		for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

		this.music = new Music(this);
		this.music.setMode(this.mode);
		this.timer = setInterval(() => this.music.schedule(), 50);
	}

	impulse(sec) {
		const c = this.ctx;
		const n = Math.floor(c.sampleRate * sec);
		const b = c.createBuffer(2, n, c.sampleRate);
		for (let ch = 0; ch < 2; ch++) {
			const d = b.getChannelData(ch);
			for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
		}
		return b;
	}

	// --- Settings ---

	applyVolumes() {
		if (!this.ctx) return;
		const t = this.ctx.currentTime;
		const s = this.settings;
		this.master.gain.setTargetAtTime(s.muted ? 0 : 1, t, 0.04);
		this.sfxBus.gain.setTargetAtTime(s.sfx * 0.9, t, 0.05);
		this.musicBus.gain.setTargetAtTime(s.music * 0.7, t, 0.15);
		if (this.musicVerbVol) {
			this.musicVerbVol.gain.setTargetAtTime(s.music * 0.7, t, 0.15);
			this.sfxVerbVol.gain.setTargetAtTime(s.sfx * 0.9, t, 0.05);
		}
	}

	save() {
		try { localStorage.setItem(STORE_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
		this.onChange(this.settings);
	}

	setMuted(v) {
		this.settings.muted = !!v;
		this.applyVolumes();
		this.save();
	}

	toggleMute() {
		this.unlock();
		this.setMuted(!this.settings.muted);
		if (!this.settings.muted) this.ui();
	}

	setVolume(kind, v) {
		if (kind !== 'music' && kind !== 'sfx') return;
		this.settings[kind] = clamp(+v || 0, 0, 1);
		if (this.settings[kind] > 0 && this.settings.muted) this.settings.muted = false;
		this.applyVolumes();
		this.save();
	}

	ready() {
		return this.ctx && this.ctx.state === 'running' && !this.settings.muted;
	}

	// --- Voice management ---

	activeVoices(now) {
		const a = this.voiceEnds;
		let j = 0;
		for (let i = 0; i < a.length; i++) if (a[i] > now) a[j++] = a[i];
		a.length = j;
		return j;
	}

	// Returns {t, out} to build a voice into, or null when the sound is skipped.
	voice(key, vol, pan, delay, dur) {
		if (!this.ready() || this.settings.sfx <= 0) return null;
		if (vol < MIN_AUDIBLE) return null;
		const c = this.ctx;
		const now = c.currentTime;
		const [win, max] = LIMITS[key] || LIMITS.default;
		let r = this.rate.get(key);
		if (!r) this.rate.set(key, (r = { start: -1, n: 0 }));
		if (now - r.start > win) {
			r.start = now;
			r.n = 0;
		}
		if (r.n >= max) {
			this.stats.limited++;
			return null;
		}
		if (!PRIORITY.has(key) && this.activeVoices(now) >= MAX_VOICES) {
			this.stats.dropped++;
			return null;
		}
		r.n++;
		const t = now + 0.005 + (delay > 0 ? delay : 0);
		this.voiceEnds.push(t + dur);
		this.stats.sfx++;
		const g = c.createGain();
		g.gain.value = vol;
		if (pan) {
			const p = c.createStereoPanner();
			p.pan.value = pan;
			g.connect(p).connect(this.sfxBus);
		} else {
			g.connect(this.sfxBus);
		}
		return { t, out: g };
	}

	// Volume and pan of a world position relative to the own hero.
	spatial(game, x, y) {
		const lx = game?.local?.x ?? x, ly = game?.local?.y ?? y;
		const dx = x - lx, d = Math.hypot(dx, y - ly);
		const k = d <= HEAR_FULL ? 1 : d >= HEAR_MAX ? 0 : 1 - (d - HEAR_FULL) / (HEAR_MAX - HEAR_FULL);
		this.sp = this.sp || { vol: 0, pan: 0 };
		this.sp.vol = k * k;
		this.sp.pan = clamp(dx / PAN_SPAN, -0.8, 0.8);
		return this.sp;
	}

	at(key, game, x, y, vol, delay, dur) {
		const s = this.spatial(game, x, y);
		return this.voice(key, vol * s.vol, s.pan, delay, dur);
	}

	atPlayer(key, game, pid, vol, dur, otherVol = 0.45) {
		if (pid === game.me) return this.voice(key, vol, 0, 0, dur);
		const pt = game.playerPos(pid, this.tmp);
		if (!pt) return null;
		return this.at(key, game, pt.x, pt.y, vol * otherVol, 0, dur);
	}

	// --- Synth primitives (all scheduled at absolute time t into dest) ---

	tone(dest, t, type, f0, f1, dur, vol, attack = 0.004) {
		const c = this.ctx;
		const o = c.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
		const g = c.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.linearRampToValueAtTime(vol, t + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(dest);
		o.start(t);
		o.stop(t + dur + 0.03);
		return o;
	}

	hiss(dest, t, filter, f0, f1, q, dur, vol, attack = 0.003) {
		const c = this.ctx;
		const s = c.createBufferSource();
		s.buffer = this.noise;
		const f = c.createBiquadFilter();
		f.type = filter;
		f.Q.value = q;
		f.frequency.setValueAtTime(f0, t);
		if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
		const g = c.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.linearRampToValueAtTime(vol, t + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		s.connect(f).connect(g).connect(dest);
		s.start(t, Math.random() * 1.5, dur + 0.05);
	}

	bell(dest, t, midi, dur, vol) {
		const f = mtof(midi);
		this.tone(dest, t, 'sine', f, 0, dur, vol, 0.003);
		this.tone(dest, t, 'triangle', f * 2, 0, dur * 0.45, vol * 0.35, 0.002);
		this.tone(dest, t, 'sine', f * 3.01, 0, dur * 0.25, vol * 0.12, 0.002);
	}

	thump(dest, t, f0, f1, dur, vol) {
		this.tone(dest, t, 'sine', f0, f1, dur, vol, 0.003);
	}

	send(v, amount) {
		const s = this.ctx.createGain();
		s.gain.value = amount;
		v.out.connect(s).connect(this.sfxVerbVol);
	}

	// --- Game hooks (a sound failure must never break the frame) ---

	shot(ev, game) {
		if (!this.ready()) return;
		try { this.playShot(ev, game); } catch (err) { this.fail(err); }
	}

	fx(ev, game) {
		if (!this.ready()) return;
		try { this.playFx(ev, game); } catch (err) { this.fail(err); }
	}

	snapshot(game) {
		try { this.readSnapshot(game); } catch (err) { this.fail(err); }
	}

	fail(err) {
		if (this.failed++ < 3) console.warn('sound:', err);
	}


	// Projectile-like events arrive ahead of the render clock: schedule them for when they appear.
	playShot(ev, game) {
		const vt = game.view?.tm || 0;
		const lead = (st) => (vt > 0 ? clamp(st - vt, 0, MAX_SHOT_DELAY) : 0);
		let v;
		switch (ev[0]) {
			case 'shot': {
				const kind = PROJECTILE_KINDS[ev[2] | 0] || 'bolt';
				const x = +ev[3], y = +ev[4], d = lead(+ev[9] || 0);
				if (kind === 'bolt') {
					if (!(v = this.at('bolt', game, x, y, 0.16, d, 0.14))) return;
					const p = rnd(-80, 80);
					this.tone(v.out, v.t, 'sine', 1500 + p, 620 + p, 0.11, 0.7);
					this.tone(v.out, v.t, 'triangle', 2600 + p, 1300, 0.05, 0.25);
				} else if (kind === 'knife') {
					if (!(v = this.at('knife', game, x, y, 0.2, d, 0.09))) return;
					this.hiss(v.out, v.t, 'bandpass', 3800, 7000, 1.4, 0.07, 0.9);
					this.tone(v.out, v.t, 'square', 1100, 500, 0.02, 0.08);
				} else if (kind === 'sickle') {
					if (!(v = this.at('sickle', game, x, y, 0.2, d, 0.32))) return;
					this.hiss(v.out, v.t, 'bandpass', 700, 2400, 3, 0.3, 0.9, 0.04);
					this.tone(v.out, v.t, 'triangle', 420, 640, 0.25, 0.12, 0.05);
				} else if (kind === 'spear') {
					if (!(v = this.at('spear', game, x, y, 0.2, d, 0.16))) return;
					this.hiss(v.out, v.t, 'bandpass', 1600, 700, 2, 0.12, 0.9, 0.006);
					this.tone(v.out, v.t, 'triangle', 240, 120, 0.1, 0.35);
				} else {
					if (!(v = this.at('icedisc', game, x, y, 0.13, d, 0.35))) return;
					this.tone(v.out, v.t, 'sine', 2350, 2200, 0.3, 0.5);
					this.tone(v.out, v.t, 'sine', 3520, 3400, 0.2, 0.25);
					this.hiss(v.out, v.t, 'highpass', 6000, 6000, 0.7, 0.12, 0.25);
				}
				break;
			}
			case 'eshot':
				if (!(v = this.at('eshot', game, +ev[2], +ev[3], 0.13, lead(+ev[7] || 0), 0.12))) return;
				this.hiss(v.out, v.t, 'bandpass', 1300, 600, 2, 0.08, 0.6);
				this.tone(v.out, v.t, 'sine', 320, 180, 0.1, 0.4);
				break;
			case 'lob':
				if (!(v = this.at('lob', game, +ev[2], +ev[3], 0.12, lead(+ev[7] || 0), 0.12))) return;
				this.tone(v.out, v.t, 'triangle', 260, 520, 0.1, 0.6);
				this.hiss(v.out, v.t, 'bandpass', 1500, 2500, 1.5, 0.08, 0.3);
				break;
			case 'orb':
				if (!(v = this.at('orb', game, +ev[2], +ev[3], 0.16, lead(+ev[8] || 0), 0.6))) return;
				this.tone(v.out, v.t, 'sawtooth', 110, 165, 0.55, 0.12, 0.08);
				this.tone(v.out, v.t, 'sine', 330, 495, 0.55, 0.4, 0.08);
				this.hiss(v.out, v.t, 'highpass', 4000, 4000, 0.7, 0.3, 0.3);
				break;
		}
	}

	playFx(ev, game) {
		let v;
		switch (ev[0]) {
			case 'hit': {
				const crit = ev[4] === 1;
				if (crit) {
					const mine = ev[5] === game.me;
					if (!(v = this.at('crit', game, +ev[1], +ev[2], mine ? 0.16 : 0.08, 0, 0.12))) return;
					this.tone(v.out, v.t, 'sine', 1250, 950, 0.1, 0.8);
					this.tone(v.out, v.t, 'triangle', 2500, 1900, 0.05, 0.3);
				} else {
					if (!(v = this.at('hit', game, +ev[1], +ev[2], 0.1, 0, 0.06))) return;
					this.tone(v.out, v.t, 'triangle', rnd(420, 520), 230, 0.045, 0.8);
					this.hiss(v.out, v.t, 'highpass', 2500, 2500, 0.7, 0.025, 0.4);
				}
				break;
			}
			case 'die': {
				const def = ENEMIES[ENEMY_TYPES[ev[3]]] || ENEMIES.bat;
				const r = def.r || 12;
				if (def === ENEMIES.boss) {
					if (!(v = this.voice('bigdie', 0.5, 0, 0, 2.5))) return;
					this.thump(v.out, v.t, 120, 32, 1.4, 0.9);
					this.hiss(v.out, v.t, 'lowpass', 1800, 120, 0.8, 1.6, 0.6);
					this.bell(v.out, v.t + 0.25, 62, 2.2, 0.3);
					this.bell(v.out, v.t + 0.25, 69, 2.2, 0.2);
					this.send(v, 0.6);
					return;
				}
				if (!(v = this.at('die', game, +ev[1], +ev[2], r > 15 ? 0.17 : 0.12, 0, 0.18))) return;
				const f = clamp(520 * (12 / r), 140, 700) * rnd(0.92, 1.08);
				this.tone(v.out, v.t, 'sine', f, f * 0.45, 0.13, 0.7);
				this.hiss(v.out, v.t, 'bandpass', f * 2.5, f, 1.2, 0.1, 0.4);
				break;
			}
			case 'zap':
				if (!(v = this.at('zap', game, +ev[3], +ev[4], 0.15, 0, 0.14))) return;
				this.hiss(v.out, v.t, 'highpass', 2200, 3500, 0.8, 0.08, 0.8);
				this.tone(v.out, v.t, 'square', 140, 60, 0.12, 0.12);
				this.tone(v.out, v.t, 'sawtooth', 1900, 700, 0.04, 0.1);
				break;
			case 'slash':
				if (!(v = this.atPlayer('slash', game, ev[1], 0.2, 0.2, 0.55))) return;
				this.hiss(v.out, v.t, 'bandpass', 2000, 450, 1.3, 0.17, 0.9, 0.01);
				this.tone(v.out, v.t, 'triangle', 330, 140, 0.09, 0.15);
				break;
			case 'tslash':
				if (!(v = this.atPlayer('tslash', game, ev[1], 0.22, 0.35, 0.55))) return;
				this.hiss(v.out, v.t, 'bandpass', 2200, 400, 1.2, 0.2, 0.8, 0.01);
				this.hiss(v.out, v.t + 0.05, 'highpass', 3000, 5000, 0.7, 0.12, 0.5);
				if (ev[4] === 1) this.thump(v.out, v.t, 90, 40, 0.3, 0.6);
				break;
			case 'tfan':
				if (!(v = this.atPlayer('thunder', game, ev[1], 0.3, 1, 0.5))) return;
				this.hiss(v.out, v.t, 'lowpass', 1400, 120, 0.7, 0.9, 0.8, 0.01);
				this.hiss(v.out, v.t, 'highpass', 3000, 3000, 0.7, 0.15, 0.5);
				this.thump(v.out, v.t, 70, 35, 0.6, 0.6);
				this.send(v, 0.3);
				break;
			case 'boom': {
				const kind = ev[4] | 0, x = +ev[1], y = +ev[2];
				if (!(v = this.at('boom', game, x, y, kind === 0 ? 0.24 : 0.3, 0, 0.7))) return;
				const o = v.out, t = v.t;
				if (kind === 1) { // bloater: wet burst
					this.thump(o, t, 200, 55, 0.3, 0.8);
					this.hiss(o, t, 'bandpass', 500, 250, 2, 0.25, 0.6);
				} else if (kind === 3) { // ball lightning
					this.thump(o, t, 130, 45, 0.35, 0.7);
					this.hiss(o, t, 'highpass', 2500, 5000, 0.7, 0.3, 0.6);
				} else if (kind === 4) { // ice grenade
					this.thump(o, t, 110, 50, 0.25, 0.5);
					for (let i = 0; i < 3; i++) this.tone(o, t + i * 0.03, 'sine', rnd(2400, 3800), 0, 0.25, 0.25);
				} else if (kind === 6) { // molotov
					this.hiss(o, t, 'bandpass', 500, 1600, 0.9, 0.55, 0.7, 0.03);
					this.thump(o, t, 120, 50, 0.25, 0.5);
				} else { // petard, volatile elite, mine
					const big = kind !== 0;
					this.thump(o, t, big ? 130 : 160, 42, big ? 0.4 : 0.28, 0.9);
					this.hiss(o, t, 'lowpass', 2600, 180, 0.7, big ? 0.5 : 0.35, 0.8);
				}
				break;
			}
			case 'warn':
				if (!(v = this.at('warn', game, +ev[1], +ev[2], 0.08, 0, 0.35))) return;
				this.hiss(v.out, v.t, 'highpass', 5000, 5000, 0.7, 0.3, 0.5, 0.05);
				this.tone(v.out, v.t, 'square', 1400, 1400, 0.03, 0.15);
				break;
			case 'frost':
				if (!(v = this.atPlayer('frost', game, ev[1], 0.16, 0.6, 0.5))) return;
				this.hiss(v.out, v.t, 'highpass', 5000, 8000, 0.7, 0.45, 0.5, 0.03);
				this.tone(v.out, v.t, 'sine', 1760, 1660, 0.5, 0.35);
				this.tone(v.out, v.t + 0.04, 'sine', 2637, 2500, 0.4, 0.25);
				break;
			case 'shard':
				if (!(v = this.at('shard', game, +ev[1], +ev[2], 0.08, 0, 0.12))) return;
				this.tone(v.out, v.t, 'sine', rnd(2800, 3600), 0, 0.1, 0.6);
				break;
			case 'snap':
				if (!(v = this.at('snap', game, +ev[1], +ev[2], 0.14, 0, 0.1))) return;
				this.tone(v.out, v.t, 'square', 1300, 700, 0.02, 0.3);
				this.hiss(v.out, v.t, 'bandpass', 2500, 1500, 3, 0.06, 0.6);
				break;
			case 'brk': {
				const b = breakableAt(ev[1] | 0, ev[2] | 0);
				if (!b || !(v = this.at('brk', game, b.x, b.y, 0.14, 0, 0.18))) return;
				this.hiss(v.out, v.t, 'bandpass', 900, 500, 2.5, 0.14, 0.8);
				this.tone(v.out, v.t, 'triangle', 190, 90, 0.1, 0.4);
				break;
			}
			case 'blink':
				if (!(v = this.at('blink', game, +ev[1], +ev[2], 0.1, 0, 0.2))) return;
				this.hiss(v.out, v.t, 'bandpass', 3200, 600, 4, 0.16, 0.7);
				break;
			case 'hurt':
				if (ev[1] !== game.me || !(v = this.voice('hurt', 0.32, 0, 0, 0.25))) return;
				this.thump(v.out, v.t, 170, 65, 0.2, 0.9);
				this.hiss(v.out, v.t, 'lowpass', 900, 300, 0.7, 0.12, 0.5);
				break;
			case 'down': {
				if (!(v = this.atPlayer('down', game, ev[1], 0.28, 1.4, 0.6))) return;
				const notes = [74, 70, 67, 62];
				notes.forEach((m, i) => this.tone(v.out, v.t + i * 0.16, 'triangle', mtof(m), mtof(m) * 0.98, 0.5, 0.35));
				this.thump(v.out, v.t, 110, 40, 0.5, 0.5);
				this.send(v, 0.5);
				break;
			}
			case 'up': {
				if (!(v = this.atPlayer('up', game, ev[1], 0.24, 1, 0.6))) return;
				[62, 66, 69, 74].forEach((m, i) => this.bell(v.out, v.t + i * 0.09, m, 0.6, 0.35));
				this.send(v, 0.5);
				break;
			}
			case 'lvl': {
				if (ev[1] !== game.me) {
					if (!(v = this.atPlayer('lvl', game, ev[1], 0.1, 0.5, 1))) return;
					this.bell(v.out, v.t, 81, 0.5, 0.5);
					return;
				}
				if (!(v = this.voice('lvl', 0.2, 0, 0, 1.2))) return;
				[62, 65, 69, 74, 77].forEach((m, i) => this.bell(v.out, v.t + i * 0.065, m, 0.7, 0.45));
				this.send(v, 0.5);
				break;
			}
			case 'boss': {
				if (!(v = this.voice('boss', 0.4, 0, 0, 4))) return;
				const o = v.out, t = v.t;
				this.tone(o, t, 'sawtooth', 36.7, 36.7, 3.5, 0.35, 1.2);
				this.tone(o, t, 'sawtooth', 37.2, 36.9, 3.5, 0.3, 1.2);
				this.tone(o, t, 'sine', 73.4, 73.4, 3.2, 0.5, 0.8);
				this.hiss(o, t, 'lowpass', 300, 1200, 0.8, 3, 0.5, 1.5);
				this.thump(o, t + 0.05, 80, 30, 1.5, 0.9);
				this.bell(o, t + 0.05, 50, 3, 0.35);
				this.bell(o, t + 0.05, 56, 3, 0.25); // tritone for menace
				this.send(v, 0.7);
				this.music?.accent(1);
				break;
			}
			case 'chest':
				if (!(v = this.voice('chest', 0.22, 0, 0, 1.6))) return;
				for (let i = 0; i < 9; i++) this.bell(v.out, v.t + i * 0.06, 74 + PENTA[i % 5] + 12 * Math.floor(i / 5), 0.8, 0.35);
				this.send(v, 0.6);
				break;
			case 'open':
				if (!(v = this.at('open', game, +ev[2], +ev[3], 0.2, 0, 1))) return;
				[69, 74, 77, 81].forEach((m, i) => this.bell(v.out, v.t + i * 0.06, m, 0.6, 0.4));
				this.send(v, 0.4);
				break;
			case 'item':
				if (!(v = this.atPlayer('item', game, ev[1], 0.18, 0.6, 0.6))) return;
				this.bell(v.out, v.t, 81, 0.4, 0.5);
				this.bell(v.out, v.t + 0.08, 86, 0.5, 0.45);
				break;
			case 'duo': {
				if (!(v = this.atPlayer('duo', game, ev[1], 0.3, 3, 0.55))) return;
				const c = this.ctx, o = v.out, t = v.t;
				const f = c.createBiquadFilter();
				f.type = 'lowpass';
				f.Q.value = 4;
				f.frequency.setValueAtTime(300, t);
				f.frequency.exponentialRampToValueAtTime(3500, t + 1.2);
				f.frequency.exponentialRampToValueAtTime(900, t + 2.6);
				f.connect(o);
				for (const m of [50, 57, 62, 65, 69, 76]) {
					this.tone(f, t, 'sawtooth', mtof(m), 0, 2.6, 0.13, 0.5);
					this.tone(f, t, 'sawtooth', mtof(m) * 1.004, 0, 2.6, 0.1, 0.5);
				}
				for (let i = 0; i < 8; i++) this.bell(o, t + 0.35 + i * 0.07, 74 + PENTA[i % 5] + 12 * Math.floor(i / 5), 1, 0.25);
				this.hiss(o, t, 'highpass', 6000, 9000, 0.7, 1.5, 0.15, 0.6);
				this.send(v, 0.8);
				this.music?.accent(0.6);
				break;
			}
			case 'inv': {
				if (ev[1] !== game.me || !(v = this.voice('inv', 0.36, 0, 0, 2.2))) return;
				const o = v.out, t = v.t;
				for (let i = 0; i < 4; i++) this.thump(o, t + i * 0.19, 95 - i * 6, 45, 0.35, i === 3 ? 1 : 0.75);
				for (const m of [38, 39, 45]) this.tone(o, t, 'sawtooth', mtof(m), mtof(m + 12), 1.8, 0.12, 1.4);
				this.hiss(o, t, 'bandpass', 300, 2500, 1, 1.8, 0.4, 1.5);
				this.send(v, 0.5);
				this.music?.accent(0.8);
				break;
			}
			case 'elite':
				if (!(v = this.voice('elite', 0.12, 0, 0, 1))) return;
				this.tone(v.out, v.t, 'sine', 659, 640, 0.9, 0.5, 0.15);
				this.tone(v.out, v.t, 'sine', 698, 690, 0.9, 0.5, 0.15);
				this.send(v, 0.5);
				break;
		}
	}

	// Level-up card picked / rerolled / skipped.
	card(kind) {
		if (!this.ready()) return;
		const v = this.voice('pick', 0.18, 0, 0, 0.8);
		if (!v) return;
		if (kind === 'reroll') {
			this.hiss(v.out, v.t, 'bandpass', 1200, 3500, 2, 0.18, 0.5);
			this.bell(v.out, v.t + 0.1, 77, 0.3, 0.3);
		} else if (kind === 'skip') {
			this.bell(v.out, v.t, 69, 0.35, 0.4);
			this.bell(v.out, v.t + 0.08, 62, 0.4, 0.35);
		} else {
			this.bell(v.out, v.t, 81, 0.4, 0.45);
			this.bell(v.out, v.t + 0.07, 86, 0.6, 0.5);
			this.send(v, 0.4);
		}
	}

	ui() {
		if (!this.ready()) return;
		const v = this.voice('ui', 0.1, 0, 0, 0.3);
		if (v) this.bell(v.out, v.t, 74, 0.25, 0.5);
	}

	// Per-snapshot hook: crystal pickups, new puddles and music intensity.
	readSnapshot(game) {
		const snap = game.latest();
		if (!snap || snap === this.prevSnap) return;
		const prev = this.prevSnap;
		this.prevSnap = snap;
		const lx = game.local.x, ly = game.local.y;

		// Music intensity: run time plus how crowded it is around the hero.
		const e = snap.e;
		let near = 0;
		for (let i = 0; i + 6 <= e.length; i += 6) {
			const dx = e[i + 2] - lx, dy = e[i + 3] - ly;
			if (dx * dx + dy * dy < 450 * 450) near++;
		}
		const minute = snap.tm / 60;
		this.target = clamp(0.12 + minute * 0.035 + near / 90 + (snap.boss ? 0.25 : 0), 0.08, 1);
		this.near = near;

		if (!prev || !this.ready()) return;
		// Crystals that vanished next to the own hero were picked up by us.
		const pg = prev.g, gi = snap.gIdx;
		let picked = 0, gold = false;
		for (let i = 0; i + 4 <= pg.length; i += 4) {
			if (gi.has(pg[i])) continue;
			const dx = pg[i + 1] - lx, dy = pg[i + 2] - ly;
			if (dx * dx + dy * dy < 140 * 140) {
				picked++;
				if (pg[i + 3] === 3) gold = true;
			}
		}
		if (picked) this.gem(picked, gold);

		const pz = prev.z, z = snap.z;
		if (z.length) {
			const old = (this.oldPuddles ??= new Set());
			old.clear();
			for (let i = 0; i + 4 <= pz.length; i += 4) old.add(pz[i]);
			for (let i = 0; i + 4 <= z.length; i += 4) {
				if (old.has(z[i])) continue;
				const v = this.at('puddle', game, z[i + 1], z[i + 2], 0.1, 0, 0.3);
				if (!v) break;
				this.hiss(v.out, v.t, 'bandpass', 900, 400, 3, 0.2, 0.6);
				this.tone(v.out, v.t, 'sine', 500, 900, 0.12, 0.3);
				break;
			}
		}
	}

	gem(n, gold) {
		const now = this.ctx.currentTime;
		this.gemStreak = now - this.gemLast < 0.7 ? this.gemStreak + n : 0;
		this.gemLast = now;
		const v = this.voice('gem', gold ? 0.16 : 0.07, 0, 0, 0.3);
		if (!v) return;
		const s = Math.min(this.gemStreak, 14);
		const m = 74 + PENTA[s % 5] + 12 * Math.floor(s / 5);
		this.bell(v.out, v.t, m, gold ? 0.5 : 0.18, 0.6);
		if (gold) {
			this.bell(v.out, v.t + 0.07, m + 7, 0.5, 0.5);
			this.bell(v.out, v.t + 0.14, m + 12, 0.6, 0.5);
		}
	}

	// menu | lobby | game | over
	setMode(mode, win) {
		const prev = this.mode;
		this.mode = mode;
		if (mode === 'game' && prev !== 'game') {
			this.intensity = this.target = 0.12;
			this.prevSnap = null;
		}
		if (!this.music) return;
		this.music.setMode(mode);
		if (mode === 'over' && prev === 'game') this.music.sting(!!win);
	}

	// Peak absolute sample on the master output right now (for diagnostics).
	peak() {
		if (!this.analyser) return 0;
		const b = (this.peakBuf ??= new Float32Array(this.analyser.fftSize));
		this.analyser.getFloatTimeDomainData(b);
		let m = 0;
		for (let i = 0; i < b.length; i++) {
			const a = b[i] < 0 ? -b[i] : b[i];
			if (a > m) m = a;
		}
		return m;
	}
}

// Procedural music: an 8-bar minor loop with layers faded in by intensity, a quiet menu theme and stingers.
class Music {
	constructor(snd) {
		this.snd = snd;
		const c = (this.ctx = snd.ctx);
		this.bus = { menu: c.createGain(), game: c.createGain(), sting: c.createGain() };
		for (const b of Object.values(this.bus)) {
			b.gain.value = 0;
			b.connect(snd.musicBus);
			b.connect(snd.musicVerbVol);
		}
		this.bus.sting.gain.value = 1;
		this.layers = {};
		for (const name of ['pad', 'bass', 'drums', 'mel', 'arp']) {
			const g = c.createGain();
			g.gain.value = 0;
			g.connect(this.bus.game);
			this.layers[name] = { g, on: 0 };
		}
		this.padFilter = c.createBiquadFilter();
		this.padFilter.type = 'lowpass';
		this.padFilter.frequency.value = 800;
		this.padFilter.Q.value = 0.7;
		this.padFilter.connect(this.layers.pad.g);
		this.arpFilter = c.createBiquadFilter();
		this.arpFilter.type = 'lowpass';
		this.arpFilter.frequency.value = 1200;
		this.arpFilter.Q.value = 3;
		this.arpFilter.connect(this.layers.arp.g);
		this.menuFilter = c.createBiquadFilter();
		this.menuFilter.type = 'lowpass';
		this.menuFilter.frequency.value = 650;
		this.menuFilter.connect(this.bus.menu);
		this.step = 0;
		this.nextT = 0;
		this.mode = null;
		this.accentT = 0;
		this.lastUpd = 0;
		this.variant = 0;
	}

	setMode(mode) {
		if (mode === this.mode) return;
		this.mode = mode;
		const t = this.ctx.currentTime;
		const game = mode === 'game';
		const menu = mode === 'menu' || mode === 'lobby';
		this.bus.game.gain.cancelScheduledValues(t);
		this.bus.menu.gain.cancelScheduledValues(t);
		this.bus.game.gain.setTargetAtTime(game ? 1 : 0, t, game ? 1.2 : 0.7);
		this.bus.menu.gain.setTargetAtTime(menu ? 0.8 : 0, t, menu ? 2 : 0.8);
		if (mode === 'over') {
			// The menu theme comes back softly after the stinger.
			this.bus.menu.gain.setTargetAtTime(0.6, t + 5, 3);
		}
	}

	accent(a) {
		this.snd.intensity = Math.min(1, Math.max(this.snd.intensity, this.snd.intensity + a * 0.25));
		this.accentT = this.ctx.currentTime;
	}

	updateLayers(t) {
		const s = this.snd;
		const dt = Math.min(1, t - (this.lastUpd || t));
		this.lastUpd = t;
		// Slow follow so layers never pop in or out.
		s.intensity += (s.target - s.intensity) * Math.min(1, dt * 0.18);
		const I = s.intensity;
		const lv = (from, full) => clamp((I - from) / (full - from), 0, 1);
		const want = { pad: 0.9 - lv(0.6, 1) * 0.3, bass: lv(0.12, 0.3), drums: lv(0.22, 0.45), mel: lv(0.3, 0.5) * 0.85, arp: lv(0.6, 0.85) * 0.7 };
		for (const [name, l] of Object.entries(this.layers)) {
			l.on = want[name];
			l.g.gain.setTargetAtTime(want[name], t, 1.5);
		}
		this.padFilter.frequency.setTargetAtTime(600 + I * 1400, t, 1.5);
		this.arpFilter.frequency.setTargetAtTime(900 + I * 2600, t, 1.5);
	}

	schedule() {
		const c = this.ctx;
		const snd = this.snd;
		if (c.state !== 'running' || snd.settings.muted || snd.settings.music <= 0) {
			this.nextT = 0;
			return;
		}
		const now = c.currentTime;
		this.updateLayers(now);
		if (this.nextT < now - 0.2) this.nextT = now + 0.05;
		const playGame = this.mode === 'game' || this.bus.game.gain.value > 0.01;
		const playMenu = this.mode !== 'game' || this.bus.menu.gain.value > 0.01;
		while (this.nextT < now + LOOKAHEAD) {
			const t = this.nextT;
			const bar = Math.floor(this.step / 16) % 8;
			const st = this.step % 16;
			if (st === 0 && bar === 0) this.variant = Math.random() < 0.5 ? 0 : 1;
			if (playGame) this.gameStep(t, bar, st);
			if (playMenu) this.menuStep(t, bar, st);
			this.step++;
			this.nextT += STEP;
		}
	}

	note(dest, t, type, midi, dur, vol, attack, detune = 0) {
		const c = this.ctx;
		const o = c.createOscillator();
		o.type = type;
		o.frequency.value = mtof(midi);
		if (detune) o.detune.value = detune;
		const g = c.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.linearRampToValueAtTime(vol, t + attack);
		g.gain.setTargetAtTime(0.0001, t + Math.max(attack, dur * 0.6), dur * 0.25);
		o.connect(g).connect(dest);
		o.start(t);
		o.stop(t + dur * 1.6 + 0.1);
		this.snd.stats.music++;
	}

	noiseHit(dest, t, type, freq, q, dur, vol) {
		const c = this.ctx;
		const s = c.createBufferSource();
		s.buffer = this.snd.noise;
		const f = c.createBiquadFilter();
		f.type = type;
		f.frequency.value = freq;
		f.Q.value = q;
		const g = c.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		s.connect(f).connect(g).connect(dest);
		s.start(t, Math.random() * 1.5, dur + 0.02);
		this.snd.stats.music++;
	}

	kick(dest, t, vol) {
		const c = this.ctx;
		const o = c.createOscillator();
		o.frequency.setValueAtTime(110, t);
		o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
		const g = c.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
		o.connect(g).connect(dest);
		o.start(t);
		o.stop(t + 0.32);
		this.snd.stats.music++;
	}

	gameStep(t, bar, st) {
		const L = this.layers, I = this.snd.intensity;
		const chord = BARS[bar];
		const barLen = STEP * 16;
		if (st === 0 && L.pad.on > 0.01) {
			for (const m of chord.pad) {
				this.note(this.padFilter, t, 'sawtooth', m, barLen * 0.95, 0.05, 0.6, -6);
				this.note(this.padFilter, t, 'sawtooth', m, barLen * 0.95, 0.05, 0.6, 7);
			}
			this.note(this.padFilter, t, 'triangle', chord.root + 12, barLen * 0.95, 0.08, 0.4);
		}
		if (L.bass.on > 0.01) {
			const busy = I > 0.55;
			const hitBass = busy ? st % 2 === 0 : st === 0 || st === 8 || (I > 0.35 && (st === 6 || st === 14));
			if (hitBass) {
				const oct = busy && (st === 6 || st === 14) ? 12 : 0;
				const len = busy ? STEP * 1.8 : STEP * 5;
				this.note(L.bass.g, t, 'triangle', chord.root + oct, len, 0.32, 0.01);
				this.note(L.bass.g, t, 'sine', chord.root + oct - 12, len, 0.22, 0.01);
			}
		}
		if (L.drums.on > 0.01) {
			const d = L.drums.g;
			if (st === 0 || st === 8 || (I > 0.7 && st === 10)) this.kick(d, t, 0.55);
			if (I > 0.45 && (st === 4 || st === 12)) this.noiseHit(d, t, 'bandpass', 1400, 0.8, 0.16, 0.22);
			const hat = I > 0.8 ? true : I > 0.32 ? st % 2 === 0 : st % 4 === 2;
			if (hat) this.noiseHit(d, t, 'highpass', 7000, 0.7, st % 4 === 2 ? 0.07 : 0.035, st % 4 === 2 ? 0.07 : 0.04);
			if (I > 0.75 && bar % 2 === 1 && (st === 12 || st === 14 || st === 15)) {
				this.note(d, t, 'sine', 45 + (15 - st) * 2, STEP * 1.5, 0.35, 0.003);
			}
		}
		if (L.mel.on > 0.01) {
			const phrase = MELODY[bar];
			for (const [s, m, len] of phrase) {
				if (s !== st) continue;
				// Second pass of the loop answers an octave lower on half the bars.
				const mm = this.variant === 1 && bar % 2 === 1 ? m - 12 : m;
				this.note(L.mel.g, t, 'triangle', mm, STEP * len * 1.1, 0.13, 0.008);
				this.note(L.mel.g, t, 'sine', mm + 12, STEP * len * 0.5, 0.04, 0.005);
			}
		}
		if (L.arp.on > 0.01) {
			const notes = chord.pad;
			const m = notes[st % 3] + 12 + (st % 6 >= 3 ? 12 : 0);
			this.note(this.arpFilter, t, 'sawtooth', m, STEP * 0.9, 0.06, 0.004);
		}
	}

	menuStep(t, bar, st) {
		// Half-speed: one chord per two bars, sparse music-box notes.
		const chord = BARS[Math.floor(bar / 2) * 2];
		const barLen = STEP * 16;
		if (st === 0 && bar % 2 === 0) {
			for (const m of chord.pad) this.note(this.menuFilter, t, 'triangle', m, barLen * 1.9, 0.06, 1.5);
			this.note(this.menuFilter, t, 'sine', chord.root, barLen * 1.9, 0.12, 1.5);
		}
		if (st % 4 === 0 && Math.random() < 0.55) {
			const pool = chord.pad;
			const m = pool[Math.floor(Math.random() * pool.length)] + 24;
			this.note(this.bus.menu, t, 'sine', m, STEP * 6, 0.045, 0.004);
			this.note(this.bus.menu, t, 'triangle', m + 12, STEP * 2, 0.012, 0.003);
		}
	}

	sting(win) {
		const t = this.ctx.currentTime + 0.05;
		const d = this.bus.sting;
		const seq = win ? [62, 66, 69, 74, 78, 81] : [74, 70, 67, 65, 62];
		seq.forEach((m, i) => {
			this.note(d, t + i * 0.14, 'triangle', m, 0.9, 0.12, 0.01);
			this.note(d, t + i * 0.14, 'sine', m + 12, 0.5, 0.04, 0.005);
		});
		const end = t + seq.length * 0.14;
		const chord = win ? [50, 54, 57, 62, 66] : [38, 50, 53, 56];
		for (const m of chord) {
			this.note(d, end, 'sawtooth', m, 3, 0.04, 0.3, -5);
			this.note(d, end, 'sawtooth', m, 3, 0.04, 0.3, 5);
		}
		if (!win) this.kick(d, end, 0.6);
	}
}
