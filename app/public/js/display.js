// Screen-space layers kept out of the canvas (vignette, hurt flash, off-screen arrows) and adaptive DPR.

function el(tag, cls, parent) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	parent.appendChild(e);
	return e;
}

export class Overlay {
	constructor() {
		const body = document.body;
		el('div', 'fx-layer fx-vignette', body);
		this.eclipseEl = el('div', 'fx-layer fx-eclipse', body);
		this.dawnEl = el('div', 'fx-layer fx-dawn', body);
		this.hurtEl = el('div', 'fx-layer fx-hurt', body);
		this.eclipseV = -1;
		this.dawnV = -1;
		this.sight = null;
		this.arrowRoot = el('div', 'fx-layer fx-arrows', body);
		this.hurtV = -1;
		this.pool = [];
	}

	hurt(v) {
		const q = Math.round(Math.max(0, Math.min(1, v)) * 50) / 50;
		if (q === this.hurtV) return;
		this.hurtV = q;
		this.hurtEl.style.opacity = q;
	}

	// Peak layers: the eclipse narrows the view around the screen centre, dawn warms the bottom and flashes at the burn.
	peak(game) {
		const pk = game ? game.peak() : null;
		let ecl = 0, dawn = 0;
		if (pk && pk.def.sight) {
			ecl = Math.max(0, Math.min(1, (pk.dur - pk.left) / 1.5, pk.left / 1.5));
			if (this.sight !== pk.def.sight) {
				this.sight = pk.def.sight;
				this.eclipseEl.style.setProperty('--sight', String(pk.def.sight));
			}
		}
		if (pk && pk.def.burn) dawn = 0.3 * (1 - pk.left / pk.dur);
		const d = game && game.dawn;
		if (d) dawn = d.t < 0.25 ? 1 : Math.max(0.6, 1 - (d.t - 0.25) * 0.5);
		const qe = Math.round(ecl * 50) / 50, qd = Math.round(dawn * 50) / 50;
		if (qe !== this.eclipseV) this.eclipseEl.style.opacity = this.eclipseV = qe;
		if (qd !== this.dawnV) this.dawnEl.style.opacity = this.dawnV = qd;
	}

	// list: [{x, y, ang, pulse, color, name}] in CSS pixels, or null.
	arrows(list) {
		const n = list ? list.length : 0;
		while (this.pool.length < n) {
			const root = el('div', 'fx-arrow', this.arrowRoot);
			root.innerHTML = '<svg width="34" height="30" viewBox="-14 -15 34 30"><polygon points="14,0 -8,-10 -3,0 -8,10" stroke="#000" stroke-width="2" stroke-linejoin="round"/></svg><span></span>';
			this.pool.push({ root, svg: root.firstChild, poly: root.firstChild.firstChild, label: root.lastChild, key: '', shown: false });
		}
		for (let i = 0; i < this.pool.length; i++) {
			const p = this.pool[i];
			if (i >= n) {
				if (p.shown) {
					p.root.style.display = 'none';
					p.shown = false;
				}
				continue;
			}
			const a = list[i];
			if (!p.shown) {
				p.root.style.display = '';
				p.shown = true;
			}
			const key = a.color + '|' + a.name + '|' + (a.icon ?? '');
			if (p.key !== key) {
				p.key = key;
				p.poly.setAttribute('fill', a.color);
				p.label.textContent = (a.icon ?? '✝') + ' ' + a.name;
			}
			p.root.style.transform = `translate(${a.x.toFixed(1)}px,${a.y.toFixed(1)}px)`;
			p.svg.style.transform = `translate(-50%,-50%) rotate(${a.ang.toFixed(3)}rad) scale(${a.pulse.toFixed(3)})`;
			p.label.style.transform = `translate(calc(-50% + ${(-Math.cos(a.ang) * 26).toFixed(1)}px), calc(-50% + ${(-Math.sin(a.ang) * 22).toFixed(1)}px))`;
		}
	}
}

const LEVELS = [2, 1.5, 1.25, 1];
const WINDOW_MS = 1000;
const SLOW_MS = 20;
const SLOW_WINDOWS = 3; // ~3 s of slow frames before stepping down
const FAST_MS = 17.5; // keeps vsync at 60 Hz
const FAST_WINDOWS = 8;
const RETRY_BASE_MS = 20000;

// Steps the canvas resolution down when frames are slow for a few seconds and back up when they have headroom.
// A level that failed right after a step up waits twice as long before the next try.
export class DprController {
	constructor(onChange) {
		this.onChange = onChange;
		const native = Math.min(2, window.devicePixelRatio || 1);
		this.levels = LEVELS.filter((l) => l <= native);
		if (!this.levels.length) this.levels = [native];
		if (this.levels[0] < native) this.levels.unshift(native);
		const touch = window.matchMedia?.('(pointer: coarse)').matches;
		this.idx = touch ? Math.max(0, this.levels.findIndex((l) => l <= 1.5)) : 0;
		this.fixed = 0;
		this.last = 0;
		this.winStart = 0;
		this.sum = 0;
		this.count = 0;
		this.slowRun = 0;
		this.fastRun = 0;
		this.retryAt = 0;
		this.retryMs = RETRY_BASE_MS;
		this.upAt = 0;
	}

	get value() {
		return this.fixed || this.levels[this.idx];
	}

	// Pins a DPR (0 = adaptive again); used by benchmarks and could back a quality setting.
	lock(v) {
		this.fixed = +v || 0;
		this.onChange();
	}

	frame() {
		const now = performance.now();
		const dt = now - this.last;
		this.last = now;
		if (this.fixed || dt <= 0 || dt > 250) return;
		if (!this.winStart) this.winStart = now;
		this.sum += dt;
		this.count++;
		if (now - this.winStart < WINDOW_MS) return;
		const mean = this.sum / this.count;
		this.winStart = now;
		this.sum = 0;
		this.count = 0;
		if (mean > SLOW_MS) {
			this.fastRun = 0;
			if (++this.slowRun >= SLOW_WINDOWS && this.idx < this.levels.length - 1) {
				// Failing soon after a step up: back off before trying that level again.
				this.retryMs = now - this.upAt < 15000 ? this.retryMs * 2 : RETRY_BASE_MS;
				this.retryAt = now + this.retryMs;
				this.set(this.idx + 1);
			}
		} else {
			this.slowRun = 0;
			if (mean < FAST_MS && this.idx > 0 && now >= this.retryAt) {
				if (++this.fastRun >= FAST_WINDOWS) {
					this.upAt = now;
					this.set(this.idx - 1);
				}
			} else this.fastRun = 0;
		}
	}

	set(i) {
		this.idx = i;
		this.slowRun = 0;
		this.fastRun = 0;
		this.onChange();
	}
}
