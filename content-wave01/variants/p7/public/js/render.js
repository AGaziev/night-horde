// Canvas 2D renderer: everything is procedural.
import {
	ENEMIES, ENEMY_TYPES, HEROES, WEAPONS, orbitAngle, MAX_ENEMIES, ST, ELITE_R_MUL, ELITE_AFFIXES, ITEM_TYPES,
	BREAK_TILE, breakableAt, PROJECTILE_KINDS,
} from '/shared/content.js';
import { P, lerpEnemy, E_STRIDE } from './game.js';

const TILE = 96;
const GEM_COLORS = ['#4fc3f7', '#81c784', '#f06292', '#ffd54f'];
const GEM_SIZE = [5, 6.5, 8.5, 9.5];
const BOSS_T = ENEMY_TYPES.indexOf('boss');
const SPITTER_T = ENEMY_TYPES.indexOf('spitter');
const BLOATER_T = ENEMY_TYPES.indexOf('bloater');
const SICKLE_K = PROJECTILE_KINDS.indexOf('sickle');
const BAR_TYPES = new Set(['ghoul', 'wisp', 'skel', 'brute', 'spitter'].map((t) => ENEMY_TYPES.indexOf(t)));
const GROUND = ['#13171b', '#141a1d', '#12161a', '#151a1b'];
const TYPE_COUNT = ENEMY_TYPES.length;
const CAP = MAX_ENEMIES + 64;
const TAU = Math.PI * 2;

function hash2(x, y) {
	let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return (h ^ (h >>> 16)) >>> 0;
}

function shade(hex, k) {
	const n = parseInt(hex.slice(1), 16);
	const f = (c) => Math.max(0, Math.min(255, Math.round(c * k)));
	return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export class Renderer {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d', { alpha: false });
		this.w = 0;
		this.h = 0;
		this.dpr = 1;
		this.zoom = 1;
		this.camX = 0;
		this.camY = 0;
		this.idle = 0;
		this.tmp = { x: 0, y: 0 };
		// Per-type batched enemy buffers (no per-frame allocation).
		this.ex = [];
		this.ey = [];
		this.eh = [];
		this.eid = [];
		this.edx = [];
		this.est = [];
		this.ecount = new Int32Array(TYPE_COUNT);
		this.elites = [];
		this.one = { x: new Float32Array(1), y: new Float32Array(1), h: new Float32Array(1), id: new Int32Array(1), dx: new Float32Array(1), st: new Int32Array(1) };
		for (let i = 0; i < TYPE_COUNT; i++) {
			this.ex.push(new Float32Array(CAP));
			this.ey.push(new Float32Array(CAP));
			this.eh.push(new Float32Array(CAP));
			this.eid.push(new Int32Array(CAP));
			this.edx.push(new Float32Array(CAP));
			this.est.push(new Int32Array(CAP));
		}
		this.shades = {};
		for (const id of ENEMY_TYPES) {
			const c = ENEMIES[id].color;
			this.shades[id] = { base: c, dark: shade(c, 0.55), light: shade(c, 1.25) };
		}
		this.resize();
		addEventListener('resize', () => this.resize());
	}

	resize() {
		this.dpr = Math.min(2, window.devicePixelRatio || 1);
		this.w = window.innerWidth;
		this.h = window.innerHeight;
		this.canvas.width = Math.round(this.w * this.dpr);
		this.canvas.height = Math.round(this.h * this.dpr);
		this.zoom = Math.min(1.1, Math.max(0.6, Math.min(this.w, this.h) / 720));
		const ctx = this.ctx;
		const r = Math.hypot(this.w, this.h) / 2;
		this.vignette = ctx.createRadialGradient(this.w / 2, this.h / 2, r * 0.35, this.w / 2, this.h / 2, r);
		this.vignette.addColorStop(0, 'rgba(0,0,0,0)');
		this.vignette.addColorStop(1, 'rgba(0,0,0,0.7)');
		this.hurtGrad = ctx.createRadialGradient(this.w / 2, this.h / 2, r * 0.4, this.w / 2, this.h / 2, r);
		this.hurtGrad.addColorStop(0, 'rgba(200,0,0,0)');
		this.hurtGrad.addColorStop(1, 'rgba(200,0,0,0.55)');
	}

	draw(game, dt) {
		const ctx = this.ctx;
		const { w, h, dpr } = this;
		const z = this.zoom;
		const now = performance.now() / 1000;
		const view = game.view;
		const inGame = game.running && view.b;
		this.game = game;

		if (inGame) {
			this.camX = game.local.x;
			this.camY = game.local.y;
		} else {
			this.idle += dt;
			this.camX = this.idle * 18;
			this.camY = Math.sin(this.idle * 0.1) * 120;
		}
		let sx = 0, sy = 0;
		if (game.shake > 0) {
			sx = (Math.random() - 0.5) * game.shake;
			sy = (Math.random() - 0.5) * game.shake;
		}
		const halfW = w / 2 / z, halfH = h / 2 / z;
		const vx0 = this.camX - halfW - 60, vx1 = this.camX + halfW + 60;
		const vy0 = this.camY - halfH - 60, vy1 = this.camY + halfH + 60;
		this.vx0 = vx0; this.vx1 = vx1; this.vy0 = vy0; this.vy1 = vy1;

		ctx.setTransform(dpr * z, 0, 0, dpr * z, (w / 2 + sx - this.camX * z) * dpr, (h / 2 + sy - this.camY * z) * dpr);
		this.drawGround(ctx, vx0, vy0, vx1, vy1);

		if (inGame) {
			const tm = view.tm;
			this.trackSlowPuddles(game);
			this.drawProps(ctx, game, now);
			this.drawPuddles(ctx, view.b, now);
			this.drawWarns(ctx, game, now);
			this.drawTraps(ctx, view.b, now);
			this.drawItems(ctx, view.b, now);
			this.drawGems(ctx, view, now);
			this.drawAuras(ctx, game, now);
			this.drawEnemies(ctx, view, now);
			this.drawPlayers(ctx, game, now);
			this.drawOrbits(ctx, game, tm);
			this.drawProjectiles(ctx, game, now);
			this.drawLobs(ctx, game, now);
			this.drawHostile(ctx, game, now);
			this.drawEffects(ctx, game);
		}

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = this.vignette;
		ctx.fillRect(0, 0, w, h);
		if (inGame) {
			if (game.hurtFlash > 0) {
				ctx.globalAlpha = game.hurtFlash;
				ctx.fillStyle = this.hurtGrad;
				ctx.fillRect(0, 0, w, h);
				ctx.globalAlpha = 1;
			}
			this.drawArrows(ctx, game, now);
		}
	}

	toScreen(x, y, out) {
		out.x = (x - this.camX) * this.zoom + this.w / 2;
		out.y = (y - this.camY) * this.zoom + this.h / 2;
		return out;
	}

	drawGround(ctx, x0, y0, x1, y1) {
		const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor(x1 / TILE);
		const ty0 = Math.floor(y0 / TILE), ty1 = Math.floor(y1 / TILE);
		for (let b = 0; b < GROUND.length; b++) {
			ctx.fillStyle = GROUND[b];
			ctx.beginPath();
			for (let ty = ty0; ty <= ty1; ty++) {
				for (let tx = tx0; tx <= tx1; tx++) {
					if ((hash2(tx, ty) & 3) === b) ctx.rect(tx * TILE, ty * TILE, TILE + 0.5, TILE + 0.5);
				}
			}
			ctx.fill();
		}
		// Grass tufts.
		ctx.strokeStyle = 'rgba(80,120,70,0.35)';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		for (let ty = ty0; ty <= ty1; ty++) {
			for (let tx = tx0; tx <= tx1; tx++) {
				const hv = hash2(tx, ty);
				const n = (hv >>> 2) % 4;
				for (let i = 0; i < n; i++) {
					const hh = hash2(hv, i);
					const gx = tx * TILE + (hh % TILE);
					const gy = ty * TILE + ((hh >>> 8) % TILE);
					ctx.moveTo(gx - 3, gy);
					ctx.lineTo(gx - 4, gy - 6);
					ctx.moveTo(gx, gy);
					ctx.lineTo(gx, gy - 8);
					ctx.moveTo(gx + 3, gy);
					ctx.lineTo(gx + 5, gy - 6);
				}
			}
		}
		ctx.stroke();
		// Stones and dark patches.
		ctx.fillStyle = 'rgba(255,255,255,0.045)';
		ctx.beginPath();
		for (let ty = ty0; ty <= ty1; ty++) {
			for (let tx = tx0; tx <= tx1; tx++) {
				const hv = hash2(tx + 911, ty - 377);
				if ((hv & 7) !== 0) continue;
				const gx = tx * TILE + (hv >>> 4) % TILE;
				const gy = ty * TILE + (hv >>> 12) % TILE;
				const r = 2 + ((hv >>> 20) % 4);
				ctx.moveTo(gx + r * 1.4, gy);
				ctx.ellipse(gx, gy, r * 1.4, r, 0, 0, TAU);
			}
		}
		ctx.fill();
		ctx.fillStyle = 'rgba(0,0,0,0.18)';
		ctx.beginPath();
		for (let ty = ty0; ty <= ty1; ty++) {
			for (let tx = tx0; tx <= tx1; tx++) {
				const hv = hash2(tx - 51, ty + 1203);
				if ((hv % 11) !== 0) continue;
				const gx = tx * TILE + (hv >>> 5) % TILE;
				const gy = ty * TILE + (hv >>> 13) % TILE;
				const r = 18 + ((hv >>> 21) % 22);
				ctx.moveTo(gx + r * 1.5, gy);
				ctx.ellipse(gx, gy, r * 1.5, r, 0, 0, TAU);
			}
		}
		ctx.fill();
	}

	visible(x, y) {
		return x > this.vx0 && x < this.vx1 && y > this.vy0 && y < this.vy1;
	}

	// Puddles that slow enemies are announced by a 'slowz' event; snapshots are scanned once each.
	trackSlowPuddles(game) {
		if (!this.slowZ) {
			this.slowZ = new Set();
			this.slowScanned = new WeakSet();
		}
		for (const s of game.snaps) {
			if (this.slowScanned.has(s)) continue;
			this.slowScanned.add(s);
			for (const ev of s.fx) if (Array.isArray(ev) && ev[0] === 'slowz') this.slowZ.add(ev[1]);
		}
		const z = game.view?.b?.z;
		if (this.slowZ.size > 64 && z) {
			const live = new Set();
			for (let i = 0; i + 4 <= z.length; i += 4) live.add(z[i]);
			for (const id of this.slowZ) if (!live.has(id)) this.slowZ.delete(id);
		}
	}

	isSlowPuddle(id) {
		return !!this.slowZ && this.slowZ.has(id);
	}

	drawPuddles(ctx, snap, now) {
		const z = snap.z;
		if (!z.length) return;
		ctx.fillStyle = 'rgba(120,220,90,0.22)';
		ctx.beginPath();
		for (let i = 0; i + 4 <= z.length; i += 4) {
			const x = z[i + 1], y = z[i + 2], r = z[i + 3];
			ctx.moveTo(x + r, y);
			ctx.ellipse(x, y, r, r * 0.8, 0, 0, TAU);
		}
		ctx.fill();
		ctx.strokeStyle = 'rgba(160,255,120,0.5)';
		ctx.lineWidth = 2;
		ctx.stroke();
		if (this.slowZ?.size) {
			// Frosty rim on slowing puddles.
			ctx.beginPath();
			for (let i = 0; i + 4 <= z.length; i += 4) {
				if (!this.slowZ.has(z[i])) continue;
				const x = z[i + 1], y = z[i + 2], r = z[i + 3];
				ctx.moveTo(x + r * 0.9, y);
				ctx.ellipse(x, y, r * 0.9, r * 0.72, 0, 0, TAU);
			}
			ctx.strokeStyle = 'rgba(150,205,255,0.75)';
			ctx.setLineDash([6, 6]);
			ctx.lineDashOffset = -now * 12;
			ctx.stroke();
			ctx.setLineDash([]);
		}
		ctx.fillStyle = 'rgba(190,255,150,0.55)';
		ctx.beginPath();
		for (let i = 0; i + 4 <= z.length; i += 4) {
			const x = z[i + 1], y = z[i + 2], r = z[i + 3];
			for (let k = 0; k < 4; k++) {
				const a = k * 1.7 + z[i] * 0.37;
				const ph = (now * 1.3 + k * 0.29 + z[i] * 0.11) % 1;
				const br = 1.5 + ph * 3;
				const bx = x + Math.cos(a) * r * 0.55, by = y + Math.sin(a) * r * 0.45 - ph * 4;
				ctx.moveTo(bx + br, by);
				ctx.arc(bx, by, br, 0, TAU);
			}
		}
		ctx.fill();
	}

	drawGems(ctx, view, now) {
		const { a, b, t } = view;
		const g = b.g;
		if (!g.length) return;
		for (let tier = 0; tier < 4; tier++) {
			const s = GEM_SIZE[tier];
			ctx.fillStyle = GEM_COLORS[tier];
			ctx.globalAlpha = 0.18;
			ctx.beginPath();
			for (let i = 0; i + 4 <= g.length; i += 4) {
				if ((g[i + 3] | 0) !== tier) continue;
				const p = this.lerpFlat(a.g, a.gIdx, g, i, t, this.tmp);
				if (!this.visible(p.x, p.y)) continue;
				ctx.moveTo(p.x + s * 2, p.y);
				ctx.arc(p.x, p.y, s * 2, 0, TAU);
			}
			ctx.fill();
			ctx.globalAlpha = 1;
			ctx.beginPath();
			for (let i = 0; i + 4 <= g.length; i += 4) {
				if ((g[i + 3] | 0) !== tier) continue;
				const p = this.lerpFlat(a.g, a.gIdx, g, i, t, this.tmp);
				if (!this.visible(p.x, p.y)) continue;
				const bob = Math.sin(now * 4 + g[i]) * 1.5;
				const y = p.y + bob;
				ctx.moveTo(p.x, y - s * 1.3);
				ctx.lineTo(p.x + s, y);
				ctx.lineTo(p.x, y + s * 1.3);
				ctx.lineTo(p.x - s, y);
				ctx.closePath();
			}
			ctx.fill();
		}
		ctx.fillStyle = 'rgba(255,255,255,0.75)';
		ctx.beginPath();
		for (let i = 0; i + 4 <= g.length; i += 4) {
			const p = this.lerpFlat(a.g, a.gIdx, g, i, t, this.tmp);
			if (!this.visible(p.x, p.y)) continue;
			const s = GEM_SIZE[Math.min(3, Math.max(0, g[i + 3] | 0))] * 0.35;
			const y = p.y + Math.sin(now * 4 + g[i]) * 1.5 - s;
			ctx.moveTo(p.x - s * 0.5, y);
			ctx.lineTo(p.x, y - s);
			ctx.lineTo(p.x + s * 0.5, y);
			ctx.closePath();
		}
		ctx.fill();
	}

	// Interpolates x,y (at offsets +1/+2 for g/b/e layouts handled by caller) of a flat record by id.
	lerpFlat(aArr, aIdx, bArr, i, t, out) {
		const bx = bArr[i + 1], by = bArr[i + 2];
		const j = aIdx.get(bArr[i]);
		if (j === undefined) {
			out.x = bx;
			out.y = by;
		} else {
			out.x = aArr[j + 1] + (bx - aArr[j + 1]) * t;
			out.y = aArr[j + 2] + (by - aArr[j + 2]) * t;
		}
		return out;
	}

	drawEnemies(ctx, view, now) {
		const b = view.b;
		const e = b.e;
		const cnt = this.ecount;
		cnt.fill(0);
		const p = this.tmp;
		const elites = this.elites;
		elites.length = 0;
		for (let i = 0; i + E_STRIDE <= e.length; i += E_STRIDE) {
			const type = e[i + 1] | 0;
			if (type < 0 || type >= TYPE_COUNT) continue;
			lerpEnemy(view, i, p);
			if (!this.visible(p.x, p.y) && type !== BOSS_T) continue;
			const st = e[i + 5] | 0;
			if (st & ST.elite) {
				elites.push({ type, x: p.x, y: p.y, h: e[i + 4], id: e[i], dx: p.dx, st });
				continue;
			}
			const n = cnt[type];
			if (n >= CAP) continue;
			this.ex[type][n] = p.x;
			this.ey[type][n] = p.y;
			this.eh[type][n] = e[i + 4];
			this.eid[type][n] = e[i];
			this.edx[type][n] = p.dx;
			this.est[type][n] = st;
			cnt[type] = n + 1;
		}

		// Shadows for everyone in one path.
		ctx.fillStyle = 'rgba(0,0,0,0.32)';
		ctx.beginPath();
		for (let ty = 0; ty < TYPE_COUNT; ty++) {
			const r = ENEMIES[ENEMY_TYPES[ty]].r;
			const xs = this.ex[ty], ys = this.ey[ty];
			for (let k = 0; k < cnt[ty]; k++) {
				const y = ys[k] + r * 0.85;
				ctx.moveTo(xs[k] + r, y);
				ctx.ellipse(xs[k], y, r, r * 0.35, 0, 0, TAU);
			}
		}
		for (const el of elites) {
			const r = ENEMIES[ENEMY_TYPES[el.type]].r * ELITE_R_MUL;
			ctx.moveTo(el.x + r, el.y + r * 0.85);
			ctx.ellipse(el.x, el.y + r * 0.85, r, r * 0.35, 0, 0, TAU);
		}
		ctx.fill();

		this.drawWindupWarnings(ctx, cnt, now);
		for (let ty = 0; ty < TYPE_COUNT; ty++) {
			if (ty === BOSS_T) for (let k = 0; k < cnt[ty]; k++) this.drawBoss(ctx, this.ex[ty][k], this.ey[ty][k], now);
			else this.drawType(ctx, ty, cnt[ty], now);
		}
		for (const el of elites) this.drawElite(ctx, el, now);
		this.drawStates(ctx, cnt, now);

		// Health bars for wounded tougher enemies.
		ctx.fillStyle = 'rgba(0,0,0,0.6)';
		ctx.beginPath();
		for (const ty of BAR_TYPES) {
			const r = ENEMIES[ENEMY_TYPES[ty]].r;
			for (let k = 0; k < cnt[ty]; k++) {
				if (this.eh[ty][k] >= 100) continue;
				ctx.rect(this.ex[ty][k] - r, this.ey[ty][k] - r - 8, r * 2, 3);
			}
		}
		ctx.fill();
		ctx.fillStyle = '#ef5350';
		ctx.beginPath();
		for (const ty of BAR_TYPES) {
			const r = ENEMIES[ENEMY_TYPES[ty]].r;
			for (let k = 0; k < cnt[ty]; k++) {
				const hp = this.eh[ty][k];
				if (hp >= 100) continue;
				ctx.rect(this.ex[ty][k] - r, this.ey[ty][k] - r - 8, r * 2 * Math.max(0, hp) / 100, 3);
			}
		}
		ctx.fill();
	}

	drawType(ctx, ty, n, now) {
		switch (ty) {
			case 0: return this.drawBats(ctx, n, now);
			case 1: return this.drawGhouls(ctx, n, now);
			case 2: return this.drawWisps(ctx, n, now);
			case 3: return this.drawSkels(ctx, n);
			case 4: return this.drawBrutes(ctx, n, now);
			case SPITTER_T: return this.drawSpitters(ctx, n, now);
			case BLOATER_T: return this.drawBloaters(ctx, n, now);
		}
	}

	// Elites: the regular figure scaled up, golden halo and the affix name.
	drawElite(ctx, el, now) {
		const r = ENEMIES[ENEMY_TYPES[el.type]].r * ELITE_R_MUL;
		const pulse = 1 + Math.sin(now * 4 + el.id) * 0.08;
		ctx.fillStyle = 'rgba(255,213,79,0.16)';
		ctx.beginPath();
		ctx.arc(el.x, el.y, r * 1.6 * pulse, 0, TAU);
		ctx.fill();
		const o = this.one;
		const saved = [this.ex[el.type], this.ey[el.type], this.eh[el.type], this.eid[el.type], this.edx[el.type], this.est[el.type]];
		o.x[0] = el.x; o.y[0] = el.y; o.h[0] = el.h; o.id[0] = el.id; o.dx[0] = el.dx; o.st[0] = el.st;
		this.ex[el.type] = o.x; this.ey[el.type] = o.y; this.eh[el.type] = o.h; this.eid[el.type] = o.id; this.edx[el.type] = o.dx; this.est[el.type] = o.st;
		ctx.save();
		ctx.translate(el.x, el.y);
		ctx.scale(ELITE_R_MUL, ELITE_R_MUL);
		ctx.translate(-el.x, -el.y);
		if (el.type === BOSS_T) this.drawBoss(ctx, el.x, el.y, now);
		else this.drawType(ctx, el.type, 1, now);
		ctx.restore();
		[this.ex[el.type], this.ey[el.type], this.eh[el.type], this.eid[el.type], this.edx[el.type], this.est[el.type]] = saved;
		ctx.strokeStyle = '#ffd54f';
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		ctx.arc(el.x, el.y, r * 1.12, 0, TAU);
		ctx.stroke();
		this.drawStateOne(ctx, el.x, el.y, r, el.st, now);
		// Health bar and affix.
		ctx.fillStyle = 'rgba(0,0,0,0.65)';
		ctx.fillRect(el.x - r, el.y - r - 10, r * 2, 4);
		ctx.fillStyle = '#ffca28';
		ctx.fillRect(el.x - r, el.y - r - 10, r * 2 * Math.max(0, el.h) / 100, 4);
		const affix = this.game?.eliteAffix.get(el.id);
		const name = affix !== undefined ? ELITE_AFFIXES[affix]?.name : 'Элита';
		ctx.font = '700 11px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.lineWidth = 3;
		ctx.strokeStyle = 'rgba(0,0,0,0.85)';
		ctx.strokeText('★ ' + name, el.x, el.y - r - 20);
		ctx.fillStyle = '#ffe082';
		ctx.fillText('★ ' + name, el.x, el.y - r - 20);
	}

	// Danger circles under bloaters with a lit fuse.
	drawWindupWarnings(ctx, cnt, now) {
		const n = cnt[BLOATER_T];
		if (!n) return;
		const R = ENEMIES.bloater.blastR;
		ctx.beginPath();
		let any = false;
		for (let k = 0; k < n; k++) {
			if (!(this.est[BLOATER_T][k] & ST.windup)) continue;
			const x = this.ex[BLOATER_T][k], y = this.ey[BLOATER_T][k];
			ctx.moveTo(x + R, y);
			ctx.arc(x, y, R, 0, TAU);
			any = true;
		}
		if (!any) return;
		ctx.fillStyle = `rgba(239,83,80,${0.12 + 0.1 * Math.sin(now * 30)})`;
		ctx.fill();
		ctx.strokeStyle = 'rgba(255,82,82,0.85)';
		ctx.lineWidth = 2;
		ctx.setLineDash([7, 5]);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	// Visual states from the snapshot bit mask: chill, frozen, roots.
	drawStates(ctx, cnt, now) {
		for (let ty = 0; ty < TYPE_COUNT; ty++) {
			const n = cnt[ty];
			if (!n) continue;
			const r = ENEMIES[ENEMY_TYPES[ty]].r;
			const st = this.est[ty];
			for (let k = 0; k < n; k++) if (st[k] & (ST.chill | ST.frozen | ST.root | ST.burn)) this.drawStateOne(ctx, this.ex[ty][k], this.ey[ty][k], r, st[k], now);
		}
	}

	drawStateOne(ctx, x, y, r, st, now) {
		if (st & ST.frozen) {
			ctx.fillStyle = 'rgba(200,235,255,0.32)';
			ctx.strokeStyle = 'rgba(255,255,255,0.95)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(x, y, r * 1.1, 0, TAU);
			ctx.fill();
			ctx.stroke();
			// Frost crystals on the rim.
			ctx.fillStyle = '#e1f5fe';
			ctx.beginPath();
			for (let i = 0; i < 4; i++) {
				const a = i * 1.57 + 0.4;
				const cx = x + Math.cos(a) * r * 1.1, cy = y + Math.sin(a) * r * 1.1;
				ctx.moveTo(cx + 3, cy);
				ctx.lineTo(cx, cy - 4);
				ctx.lineTo(cx - 3, cy);
				ctx.lineTo(cx, cy + 4);
				ctx.closePath();
			}
			ctx.fill();
		} else if (st & ST.chill) {
			ctx.fillStyle = 'rgba(90,160,255,0.38)';
			ctx.beginPath();
			ctx.arc(x, y, r * 1.05, 0, TAU);
			ctx.fill();
		}
		if (st & ST.root) {
			ctx.strokeStyle = '#8d6e63';
			ctx.lineWidth = 2;
			ctx.beginPath();
			for (let i = -2; i <= 2; i++) {
				const bx = x + i * r * 0.35;
				ctx.moveTo(bx, y + r * 0.9);
				ctx.lineTo(bx + Math.sin(now * 3 + i) * 3, y + r * 0.2);
			}
			ctx.stroke();
		}
		if (st & ST.burn) {
			ctx.fillStyle = 'rgba(255,138,50,0.8)';
			ctx.beginPath();
			for (let i = 0; i < 2; i++) {
				const ph = (now * 1.5 + i * 0.5 + x * 0.01) % 1;
				const fx = x + Math.sin(i * 2.4 + now * 4) * r * 0.5, fy = y - ph * r * 1.6;
				ctx.moveTo(fx + 2.5, fy);
				ctx.arc(fx, fy, 2.5 * (1 - ph), 0, TAU);
			}
			ctx.fill();
		}
	}

	eyes(ctx, ty, n, r, dy, spread, size) {
		const xs = this.ex[ty], ys = this.ey[ty], dx = this.edx[ty];
		for (let k = 0; k < n; k++) {
			const look = dx[k] > 0.5 ? r * 0.18 : dx[k] < -0.5 ? -r * 0.18 : 0;
			const x = xs[k] + look, y = ys[k] + dy;
			ctx.moveTo(x - spread + size, y);
			ctx.arc(x - spread, y, size, 0, TAU);
			ctx.moveTo(x + spread + size, y);
			ctx.arc(x + spread, y, size, 0, TAU);
		}
	}

	drawBats(ctx, n, now) {
		if (!n) return;
		const sh = this.shades.bat, r = ENEMIES.bat.r;
		const xs = this.ex[0], ys = this.ey[0], ids = this.eid[0];
		ctx.fillStyle = sh.dark;
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			const x = xs[k], y = ys[k];
			const flap = Math.sin(now * 18 + ids[k]) * r * 0.7;
			ctx.moveTo(x - r * 0.4, y);
			ctx.lineTo(x - r * 1.9, y - flap - r * 0.3);
			ctx.lineTo(x - r * 1.2, y + r * 0.2);
			ctx.lineTo(x - r * 0.4, y + r * 0.35);
			ctx.closePath();
			ctx.moveTo(x + r * 0.4, y);
			ctx.lineTo(x + r * 1.9, y - flap - r * 0.3);
			ctx.lineTo(x + r * 1.2, y + r * 0.2);
			ctx.lineTo(x + r * 0.4, y + r * 0.35);
			ctx.closePath();
		}
		ctx.fill();
		ctx.fillStyle = sh.base;
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			ctx.moveTo(xs[k] + r * 0.7, ys[k]);
			ctx.ellipse(xs[k], ys[k], r * 0.7, r * 0.8, 0, 0, TAU);
			// Ears.
			ctx.moveTo(xs[k] - r * 0.5, ys[k] - r * 0.5);
			ctx.lineTo(xs[k] - r * 0.35, ys[k] - r * 1.15);
			ctx.lineTo(xs[k] - r * 0.1, ys[k] - r * 0.6);
			ctx.moveTo(xs[k] + r * 0.5, ys[k] - r * 0.5);
			ctx.lineTo(xs[k] + r * 0.35, ys[k] - r * 1.15);
			ctx.lineTo(xs[k] + r * 0.1, ys[k] - r * 0.6);
		}
		ctx.fill();
		ctx.fillStyle = '#ffeb3b';
		ctx.beginPath();
		this.eyes(ctx, 0, n, r, -r * 0.15, r * 0.28, 1.6);
		ctx.fill();
	}

	drawGhouls(ctx, n, now) {
		if (!n) return;
		const sh = this.shades.ghoul, r = ENEMIES.ghoul.r;
		const xs = this.ex[1], ys = this.ey[1], ids = this.eid[1];
		ctx.fillStyle = sh.dark;
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			const sway = Math.sin(now * 5 + ids[k]) * 3;
			ctx.moveTo(xs[k] - r * 0.7 + 4, ys[k] + r * 0.1 + sway);
			ctx.arc(xs[k] - r * 0.95, ys[k] + r * 0.1 + sway, 4, 0, TAU);
			ctx.moveTo(xs[k] + r * 0.95 + 4, ys[k] + r * 0.1 - sway);
			ctx.arc(xs[k] + r * 0.95, ys[k] + r * 0.1 - sway, 4, 0, TAU);
		}
		ctx.fill();
		ctx.fillStyle = sh.base;
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			const x = xs[k], y = ys[k];
			ctx.moveTo(x + r * 0.85, y);
			ctx.ellipse(x, y, r * 0.85, r, 0, 0, TAU);
		}
		ctx.fill();
		ctx.fillStyle = sh.dark;
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			ctx.rect(xs[k] - r * 0.35, ys[k] + r * 0.3, r * 0.7, r * 0.18);
		}
		ctx.fill();
		ctx.fillStyle = '#d4ff6b';
		ctx.beginPath();
		this.eyes(ctx, 1, n, r, -r * 0.25, r * 0.32, 2.2);
		ctx.fill();
	}

	drawWisps(ctx, n, now) {
		if (!n) return;
		const sh = this.shades.wisp, r = ENEMIES.wisp.r;
		const xs = this.ex[2], ys = this.ey[2], ids = this.eid[2];
		ctx.fillStyle = 'rgba(255,152,0,0.22)';
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			const rr = r * (2 + Math.sin(now * 9 + ids[k]) * 0.3);
			ctx.moveTo(xs[k] + rr, ys[k]);
			ctx.arc(xs[k], ys[k], rr, 0, TAU);
		}
		ctx.fill();
		ctx.fillStyle = sh.base;
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			const x = xs[k], y = ys[k];
			const flick = Math.sin(now * 14 + ids[k] * 1.7) * 3;
			ctx.moveTo(x - r, y);
			ctx.quadraticCurveTo(x - r, y - r * 1.2, x + flick, y - r * 2.2);
			ctx.quadraticCurveTo(x + r, y - r * 1.2, x + r, y);
			ctx.arc(x, y, r, 0, Math.PI);
		}
		ctx.fill();
		ctx.fillStyle = '#fff8e1';
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			ctx.moveTo(xs[k] + r * 0.45, ys[k]);
			ctx.arc(xs[k], ys[k], r * 0.45, 0, TAU);
		}
		ctx.fill();
	}

	drawSkels(ctx, n) {
		if (!n) return;
		const sh = this.shades.skel, r = ENEMIES.skel.r;
		const xs = this.ex[3], ys = this.ey[3];
		ctx.fillStyle = sh.base;
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			const x = xs[k], y = ys[k];
			ctx.moveTo(x + r * 0.85, y - r * 0.15);
			ctx.arc(x, y - r * 0.15, r * 0.85, 0, TAU);
			ctx.rect(x - r * 0.5, y + r * 0.45, r, r * 0.45);
		}
		ctx.fill();
		ctx.strokeStyle = sh.dark;
		ctx.lineWidth = 1.5;
		ctx.stroke();
		ctx.fillStyle = '#1a1a1a';
		ctx.beginPath();
		this.eyes(ctx, 3, n, r, -r * 0.15, r * 0.33, 3);
		for (let k = 0; k < n; k++) {
			const x = xs[k], y = ys[k] + r * 0.5;
			ctx.rect(x - r * 0.25, y, 1.5, r * 0.35);
			ctx.rect(x, y, 1.5, r * 0.35);
			ctx.rect(x + r * 0.25, y, 1.5, r * 0.35);
		}
		ctx.fill();
		ctx.fillStyle = '#ff5252';
		ctx.beginPath();
		this.eyes(ctx, 3, n, r, -r * 0.15, r * 0.33, 1.2);
		ctx.fill();
	}

	drawBrutes(ctx, n, now) {
		if (!n) return;
		const sh = this.shades.brute, r = ENEMIES.brute.r;
		const xs = this.ex[4], ys = this.ey[4], ids = this.eid[4];
		ctx.fillStyle = '#d7ccc8';
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			const x = xs[k], y = ys[k];
			ctx.moveTo(x - r * 0.6, y - r * 0.7);
			ctx.lineTo(x - r * 1.0, y - r * 1.35);
			ctx.lineTo(x - r * 0.3, y - r * 0.85);
			ctx.moveTo(x + r * 0.6, y - r * 0.7);
			ctx.lineTo(x + r * 1.0, y - r * 1.35);
			ctx.lineTo(x + r * 0.3, y - r * 0.85);
		}
		ctx.fill();
		ctx.fillStyle = sh.dark;
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			const bob = Math.sin(now * 4 + ids[k]) * 2;
			ctx.roundRect(xs[k] - r * 1.25, ys[k] - r * 0.3 + bob, r * 0.5, r * 0.9, 5);
			ctx.roundRect(xs[k] + r * 0.75, ys[k] - r * 0.3 - bob, r * 0.5, r * 0.9, 5);
		}
		ctx.fill();
		ctx.fillStyle = sh.base;
		ctx.beginPath();
		for (let k = 0; k < n; k++) {
			ctx.roundRect(xs[k] - r * 0.85, ys[k] - r * 0.9, r * 1.7, r * 1.8, r * 0.5);
		}
		ctx.fill();
		ctx.fillStyle = '#ff7043';
		ctx.beginPath();
		this.eyes(ctx, 4, n, r, -r * 0.35, r * 0.3, 3);
		ctx.fill();
	}

	drawBoss(ctx, x, y, now) {
		const r = ENEMIES.boss.r;
		const pulse = 1 + Math.sin(now * 3) * 0.05;
		ctx.save();
		ctx.translate(x, y);
		ctx.fillStyle = 'rgba(211,47,47,0.18)';
		ctx.beginPath();
		ctx.arc(0, 0, r * 1.7 * pulse, 0, TAU);
		ctx.fill();
		// Cloak spikes.
		ctx.fillStyle = '#4a0f12';
		ctx.beginPath();
		const spikes = 14;
		for (let i = 0; i <= spikes * 2; i++) {
			const a = (i / (spikes * 2)) * TAU + now * 0.4;
			const rr = i % 2 ? r * 1.0 : r * 1.35;
			if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
			else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
		}
		ctx.fill();
		ctx.shadowColor = '#ff1744';
		ctx.shadowBlur = 20;
		ctx.fillStyle = '#d32f2f';
		ctx.beginPath();
		ctx.arc(0, 0, r * 0.85, 0, TAU);
		ctx.fill();
		ctx.shadowBlur = 0;
		// Crown.
		ctx.fillStyle = '#ffd54f';
		ctx.beginPath();
		ctx.moveTo(-r * 0.55, -r * 0.6);
		ctx.lineTo(-r * 0.55, -r * 1.1);
		ctx.lineTo(-r * 0.27, -r * 0.82);
		ctx.lineTo(0, -r * 1.2);
		ctx.lineTo(r * 0.27, -r * 0.82);
		ctx.lineTo(r * 0.55, -r * 1.1);
		ctx.lineTo(r * 0.55, -r * 0.6);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = '#1a0000';
		ctx.beginPath();
		ctx.ellipse(-r * 0.3, -r * 0.1, r * 0.2, r * 0.13, 0.3, 0, TAU);
		ctx.ellipse(r * 0.3, -r * 0.1, r * 0.2, r * 0.13, -0.3, 0, TAU);
		ctx.fill();
		ctx.fillStyle = '#ffeb3b';
		ctx.beginPath();
		ctx.arc(-r * 0.3, -r * 0.1, r * 0.07, 0, TAU);
		ctx.arc(r * 0.3, -r * 0.1, r * 0.07, 0, TAU);
		ctx.fill();
		ctx.restore();
	}

	drawAuras(ctx, game, now) {
		const b = game.view.b;
		for (const row of b.p) {
			const w = row[P.w];
			if (!Array.isArray(w) || row[P.st] === 1) continue;
			for (const wl of w) {
				if (!Array.isArray(wl) || wl[0] !== 'aura') continue;
				const def = WEAPONS.aura.levels[Math.max(0, Math.min(4, (wl[1] | 0) - 1))];
				const pos = game.playerPos(row[P.pid], this.tmp);
				if (!pos) continue;
				const r = def.radius * (row[P.pid] === game.me ? game.areaMul() : 1);
				const meta = game.meta(row[P.pid]);
				ctx.fillStyle = meta.color;
				ctx.globalAlpha = 0.08 + Math.sin(now * 3) * 0.03;
				ctx.beginPath();
				ctx.arc(pos.x, pos.y, r, 0, TAU);
				ctx.fill();
				ctx.globalAlpha = 0.35;
				ctx.strokeStyle = meta.color;
				ctx.lineWidth = 2;
				ctx.setLineDash([8, 10]);
				ctx.lineDashOffset = -now * 30;
				ctx.stroke();
				ctx.setLineDash([]);
				ctx.globalAlpha = 1;
			}
		}
	}

	drawOrbits(ctx, game, tm) {
		const b = game.view.b;
		ctx.fillStyle = '#e3f2fd';
		ctx.strokeStyle = 'rgba(144,202,249,0.9)';
		ctx.lineWidth = 2;
		for (const row of b.p) {
			const w = row[P.w];
			if (!Array.isArray(w) || row[P.st] === 1) continue;
			for (const wl of w) {
				if (!Array.isArray(wl) || wl[0] !== 'orbit') continue;
				const lv = WEAPONS.orbit.levels[Math.max(0, Math.min(4, (wl[1] | 0) - 1))];
				const def = { ...lv, count: lv.count + Math.max(0, wl[2] | 0) }; // + Echo blades
				const pos = game.playerPos(row[P.pid], this.tmp);
				if (!pos) continue;
				const px = pos.x, py = pos.y;
				const r = def.radius * (row[P.pid] === game.me ? game.areaMul() : 1);
				if (HEROES[game.meta(row[P.pid]).hero]?.orbitSkin === 'hammer') {
					this.drawHammers(ctx, px, py, r, def, tm);
					continue;
				}
				ctx.beginPath();
				for (let i = 0; i < def.count; i++) {
					const a = orbitAngle(tm, def.rps, i, def.count);
					const x = px + Math.cos(a) * r, y = py + Math.sin(a) * r;
					// Blade oriented along the tangent.
					const tx = -Math.sin(a), ty = Math.cos(a);
					const nx = Math.cos(a), ny = Math.sin(a);
					ctx.moveTo(x + tx * 12, y + ty * 12);
					ctx.lineTo(x + nx * 4, y + ny * 4);
					ctx.lineTo(x - tx * 8, y - ty * 8);
					ctx.lineTo(x - nx * 4, y - ny * 4);
					ctx.closePath();
				}
				ctx.fill();
				ctx.stroke();
			}
		}
	}

	drawHammers(ctx, px, py, r, def, tm) {
		ctx.save();
		for (let i = 0; i < def.count; i++) {
			const a = orbitAngle(tm, def.rps, i, def.count);
			const x = px + Math.cos(a) * r, y = py + Math.sin(a) * r;
			ctx.save();
			ctx.translate(x, y);
			// Handle points to the hero, head trails along the tangent.
			ctx.rotate(a + tm * 6);
			ctx.strokeStyle = '#6d4c41';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.moveTo(-11, 0);
			ctx.lineTo(5, 0);
			ctx.stroke();
			ctx.fillStyle = '#b0bec5';
			ctx.strokeStyle = 'rgba(0,0,0,0.7)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.rect(3, -7, 9, 14);
			ctx.fill();
			ctx.stroke();
			ctx.fillStyle = '#eceff1';
			ctx.fillRect(10, -7, 2, 14);
			ctx.restore();
		}
		ctx.restore();
		ctx.fillStyle = '#e3f2fd';
		ctx.strokeStyle = 'rgba(144,202,249,0.9)';
		ctx.lineWidth = 2;
	}

	drawProjectiles(ctx, game, now) {
		if (!game.shots.size) return;
		const shots = [];
		for (const s of game.shots.values()) if (s.show && this.visible(s.x, s.y)) shots.push(s);
		if (!shots.length) return;
		this.drawSickles(ctx, shots, now);
		const dirOf = (s) => {
			const v = Math.hypot(s.vx, s.vy) || 1;
			return [s.vx / v, s.vy / v];
		};
		// Motion trails make fast projectiles readable.
		ctx.lineCap = 'round';
		for (const [kind, color, len, width] of [[0, 'rgba(206,147,216,0.45)', 26, 6], [1, 'rgba(236,239,241,0.35)', 22, 3]]) {
			ctx.strokeStyle = color;
			ctx.lineWidth = width;
			ctx.beginPath();
			for (const s of shots) {
				if (s.kind !== kind) continue;
				const [c, n] = dirOf(s);
				ctx.moveTo(s.x - c * len, s.y - n * len);
				ctx.lineTo(s.x, s.y);
			}
			ctx.stroke();
		}
		ctx.lineCap = 'butt';
		// Bolts: glow + core.
		ctx.fillStyle = 'rgba(206,147,216,0.35)';
		ctx.beginPath();
		for (const s of shots) {
			if (s.kind !== 0) continue;
			ctx.moveTo(s.x + 12, s.y);
			ctx.arc(s.x, s.y, 12, 0, TAU);
		}
		ctx.fill();
		ctx.fillStyle = '#f8eefa';
		ctx.beginPath();
		for (const s of shots) {
			if (s.kind !== 0) continue;
			const [c, n] = dirOf(s);
			ctx.moveTo(s.x + c * 9, s.y + n * 9);
			ctx.lineTo(s.x - n * 5, s.y + c * 5);
			ctx.lineTo(s.x - c * 11, s.y - n * 11);
			ctx.lineTo(s.x + n * 5, s.y - c * 5);
			ctx.closePath();
		}
		ctx.fill();
		// Knives.
		ctx.fillStyle = '#eceff1';
		ctx.strokeStyle = '#546e7a';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		for (const s of shots) {
			if (s.kind !== 1) continue;
			const [c, n] = dirOf(s);
			ctx.moveTo(s.x + c * 13, s.y + n * 13);
			ctx.lineTo(s.x - n * 3.5, s.y + c * 3.5);
			ctx.lineTo(s.x - c * 10, s.y - n * 10);
			ctx.lineTo(s.x + n * 3.5, s.y - c * 3.5);
			ctx.closePath();
		}
		ctx.fill();
		ctx.stroke();
	}

	drawSickles(ctx, shots, now) {
		ctx.fillStyle = '#eceff1';
		ctx.strokeStyle = 'rgba(176,190,197,0.9)';
		ctx.lineWidth = 1.5;
		for (const s of shots) {
			if (s.kind !== SICKLE_K) continue;
			const a = now * 16 + s.st * 7;
			ctx.save();
			ctx.translate(s.x, s.y);
			ctx.rotate(a);
			ctx.globalAlpha = 0.25;
			ctx.beginPath();
			ctx.arc(0, 0, 17, 0, TAU);
			ctx.fill();
			ctx.globalAlpha = 1;
			ctx.beginPath();
			ctx.arc(0, 0, 14, -1.9, 1.9);
			ctx.arc(5, 0, 10, 1.7, -1.7, true);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}
	}

	// Spitter: green sac on stubby legs, swells and glows while winding up a shot.
	drawSpitters(ctx, n, now) {
		if (!n) return;
		const sh = this.shades.spitter, r = ENEMIES.spitter.r;
		const xs = this.ex[SPITTER_T], ys = this.ey[SPITTER_T], ids = this.eid[SPITTER_T], st = this.est[SPITTER_T], dx = this.edx[SPITTER_T];
		for (let k = 0; k < n; k++) {
			const x = xs[k], y = ys[k];
			const wind = (st[k] & ST.windup) !== 0;
			const sw = wind ? 1.18 + Math.sin(now * 40) * 0.04 : 1 + Math.sin(now * 3 + ids[k]) * 0.04;
			if (wind) {
				ctx.fillStyle = 'rgba(178,255,89,0.35)';
				ctx.beginPath();
				ctx.arc(x, y, r * 1.9, 0, TAU);
				ctx.fill();
			}
			ctx.fillStyle = sh.dark;
			ctx.beginPath();
			ctx.ellipse(x - r * 0.5, y + r * 0.75, r * 0.25, r * 0.18, 0, 0, TAU);
			ctx.ellipse(x + r * 0.5, y + r * 0.75, r * 0.25, r * 0.18, 0, 0, TAU);
			ctx.fill();
			ctx.fillStyle = sh.base;
			ctx.beginPath();
			ctx.ellipse(x, y, r * sw, r * 0.9 * sw, 0, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = sh.dark;
			ctx.lineWidth = 1.5;
			ctx.stroke();
			// Mouth points to the side it moves.
			const side = dx[k] < -0.3 ? -1 : 1;
			ctx.fillStyle = wind ? '#ccff90' : '#33691e';
			ctx.beginPath();
			ctx.ellipse(x + side * r * 0.55, y + r * 0.1, r * 0.3, r * 0.38 * (wind ? 1.3 : 1), 0, 0, TAU);
			ctx.fill();
			ctx.fillStyle = '#1b2a0d';
			ctx.beginPath();
			ctx.arc(x - side * r * 0.1, y - r * 0.35, 2.2, 0, TAU);
			ctx.arc(x + side * r * 0.25, y - r * 0.4, 2.2, 0, TAU);
			ctx.fill();
		}
	}

	// Bloater: pink balloon that swells and flashes red once its fuse is lit.
	drawBloaters(ctx, n, now) {
		if (!n) return;
		const sh = this.shades.bloater, r = ENEMIES.bloater.r;
		const xs = this.ex[BLOATER_T], ys = this.ey[BLOATER_T], ids = this.eid[BLOATER_T], st = this.est[BLOATER_T];
		for (let k = 0; k < n; k++) {
			const x = xs[k], y = ys[k];
			const fuse = (st[k] & ST.windup) !== 0;
			const sw = fuse ? 1.25 + Math.sin(now * 35) * 0.08 : 1 + Math.sin(now * 5 + ids[k]) * 0.05;
			ctx.fillStyle = fuse && Math.sin(now * 30) > 0 ? '#ff5252' : sh.base;
			ctx.beginPath();
			ctx.arc(x, y - 2, r * sw, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = sh.dark;
			ctx.lineWidth = 1.5;
			ctx.stroke();
			ctx.fillStyle = 'rgba(255,255,255,0.45)';
			ctx.beginPath();
			ctx.ellipse(x - r * 0.35 * sw, y - r * 0.45 * sw, r * 0.25, r * 0.15, -0.6, 0, TAU);
			ctx.fill();
			ctx.fillStyle = sh.dark;
			ctx.beginPath();
			ctx.arc(x - r * 0.3, y, 1.8, 0, TAU);
			ctx.arc(x + r * 0.3, y, 1.8, 0, TAU);
			ctx.arc(x + r * 0.1, y + r * 0.6 * sw, 2.5, 0, TAU);
			ctx.fill();
		}
	}

	// Breakable props: deterministic per tile (same function as the server), minus broken ones.
	drawProps(ctx, game, now) {
		const tx0 = Math.floor((this.vx0 - 40) / BREAK_TILE), tx1 = Math.floor((this.vx1 + 40) / BREAK_TILE);
		const ty0 = Math.floor((this.vy0 - 40) / BREAK_TILE), ty1 = Math.floor((this.vy1 + 40) / BREAK_TILE);
		for (let tx = tx0; tx <= tx1; tx++) {
			for (let ty = ty0; ty <= ty1; ty++) {
				const b = breakableAt(tx, ty);
				if (!b || game.broken.has(tx * 100003 + ty)) continue;
				drawProp(ctx, b, now);
			}
		}
	}

	drawWarns(ctx, game, now) {
		for (const w of game.warns) {
			const k = Math.min(1, w.t / w.life);
			ctx.fillStyle = `rgba(239,83,80,${0.1 + 0.25 * k})`;
			ctx.strokeStyle = 'rgba(255,82,82,0.9)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(w.x, w.y, w.r, 0, TAU);
			ctx.fill();
			ctx.setLineDash([7, 5]);
			ctx.lineDashOffset = -now * 40;
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.beginPath();
			ctx.arc(w.x, w.y, w.r * k, 0, TAU);
			ctx.stroke();
		}
	}

	drawTraps(ctx, snap, now) {
		const t = snap.tr;
		if (!t.length) return;
		for (let i = 0; i + 3 <= t.length; i += 3) {
			const x = t[i + 1], y = t[i + 2];
			if (!this.visible(x, y)) continue;
			ctx.fillStyle = 'rgba(0,0,0,0.3)';
			ctx.beginPath();
			ctx.ellipse(x, y + 3, 15, 6, 0, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = '#90a4ae';
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.ellipse(x, y, 13, 8, 0, 0, TAU);
			ctx.stroke();
			// Teeth.
			ctx.fillStyle = '#cfd8dc';
			ctx.beginPath();
			for (let k = 0; k < 8; k++) {
				const a = (k / 8) * TAU;
				const cx = x + Math.cos(a) * 13, cy = y + Math.sin(a) * 8;
				ctx.moveTo(cx, cy);
				ctx.lineTo(x + Math.cos(a + 0.2) * 7, y + Math.sin(a + 0.2) * 4);
				ctx.lineTo(x + Math.cos(a - 0.2) * 7, y + Math.sin(a - 0.2) * 4);
				ctx.closePath();
			}
			ctx.fill();
			ctx.fillStyle = `rgba(255,171,64,${0.5 + 0.3 * Math.sin(now * 4 + t[i])})`;
			ctx.beginPath();
			ctx.arc(x, y, 2.5, 0, TAU);
			ctx.fill();
		}
	}

	drawItems(ctx, snap, now) {
		const it = snap.it;
		if (!it.length) return;
		for (let i = 0; i + 4 <= it.length; i += 4) {
			const x = it[i + 2], y = it[i + 3];
			if (!this.visible(x, y)) continue;
			drawItem(ctx, ITEM_TYPES[it[i + 1] | 0], x, y + Math.sin(now * 3 + it[i]) * 2, now);
		}
	}

	drawLobs(ctx, game, now) {
		if (!game.lobs.size) return;
		const vt = game.view.tm;
		for (const l of game.lobs.values()) {
			const k = (vt - l.st) / l.fuse;
			if (k < 0 || k > 1.05) continue;
			const kk = Math.min(1, k);
			// Landing marker.
			ctx.strokeStyle = `rgba(255,171,64,${0.3 + 0.6 * kk})`;
			ctx.lineWidth = 2;
			ctx.setLineDash([5, 5]);
			ctx.beginPath();
			ctx.arc(l.x1, l.y1, 14 + 30 * kk, 0, TAU);
			ctx.stroke();
			ctx.setLineDash([]);
			// Body on an arc: flies in the first 60% of the fuse, then sits and sparkles.
			const f = Math.min(1, kk / 0.6);
			const x = l.x0 + (l.x1 - l.x0) * f, y = l.y0 + (l.y1 - l.y0) * f - Math.sin(f * Math.PI) * 70;
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(f < 1 ? now * 12 : 0);
			ctx.fillStyle = '#e53935';
			ctx.fillRect(-4, -8, 8, 16);
			ctx.fillStyle = '#ffeb3b';
			ctx.fillRect(-4, -2, 8, 3);
			ctx.restore();
			ctx.fillStyle = Math.sin(now * 50) > 0 ? '#fff59d' : '#ff9800';
			ctx.beginPath();
			ctx.arc(x, y - 11, 3 + Math.random() * 2, 0, TAU);
			ctx.fill();
		}
	}

	// Enemy blobs: green drop with a ground shadow and a short trail so they are easy to dodge.
	drawHostile(ctx, game, now) {
		if (!game.hostile.size) return;
		for (const s of game.hostile.values()) {
			if (!s.show || !this.visible(s.x, s.y)) continue;
			const v = Math.hypot(s.vx, s.vy) || 1;
			const cx = s.vx / v, cy = s.vy / v;
			ctx.fillStyle = 'rgba(0,0,0,0.35)';
			ctx.beginPath();
			ctx.ellipse(s.x, s.y + 12, 7, 3, 0, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = 'rgba(156,204,101,0.45)';
			ctx.lineWidth = 8;
			ctx.lineCap = 'round';
			ctx.beginPath();
			ctx.moveTo(s.x - cx * 22, s.y - cy * 22);
			ctx.lineTo(s.x, s.y);
			ctx.stroke();
			ctx.lineCap = 'butt';
			ctx.fillStyle = 'rgba(178,255,89,0.3)';
			ctx.beginPath();
			ctx.arc(s.x, s.y, 12 + Math.sin(now * 20) * 1.5, 0, TAU);
			ctx.fill();
			ctx.fillStyle = '#9ccc65';
			ctx.strokeStyle = '#33691e';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(s.x, s.y, 7, 0, TAU);
			ctx.fill();
			ctx.stroke();
			ctx.fillStyle = '#f1f8e9';
			ctx.beginPath();
			ctx.arc(s.x - 2, s.y - 2.5, 2, 0, TAU);
			ctx.fill();
		}
	}

	drawPlayers(ctx, game, now) {
		const b = game.view.b;
		const a = game.view.a;
		const t = game.view.t;
		let mineDrawn = false;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const healers = this.healAuras(game);
		for (const row of b.p) {
			const pid = row[P.pid];
			const pos = game.playerPos(pid, this.tmp);
			if (!pos) continue;
			const x = pos.x, y = pos.y;
			if (!this.visible(x, y)) continue;
			if (healers.length && row[P.st] !== 1 && healers.some((hz) => hz.pid !== pid && (x - hz.x) ** 2 + (y - hz.y) ** 2 < hz.r * hz.r)) {
				this.drawHealGlow(ctx, x, y, now);
			}
			const meta = game.meta(pid);
			const me = pid === game.me;
			if (me) mineDrawn = true;
			let fx, fy;
			if (me) {
				fx = game.local.fx;
				fy = game.local.fy;
			} else {
				const ra = a.pMap.get(pid) || row;
				fx = ra[P.fx] + (row[P.fx] - ra[P.fx]) * t;
				fy = ra[P.fy] + (row[P.fy] - ra[P.fy]) * t;
			}
			const down = row[P.st] === 1;
			if (down) this.drawDowned(ctx, x, y, meta, row[P.rev] || 0, now);
			else drawHero(ctx, x, y, meta.hero, meta.color, fx || 1, fy || 0, now, me);
			// Name and hp.
			ctx.font = '600 12px system-ui, sans-serif';
			ctx.lineWidth = 3;
			ctx.strokeStyle = 'rgba(0,0,0,0.85)';
			ctx.strokeText(meta.name, x, y - 34);
			ctx.fillStyle = me ? '#ffffff' : meta.color;
			ctx.fillText(meta.name, x, y - 34);
			if (!down) {
				const hp = Math.max(0, Math.min(1, row[P.hp] / (row[P.maxHp] || 1)));
				ctx.fillStyle = 'rgba(0,0,0,0.65)';
				ctx.fillRect(x - 16, y + 22, 32, 4);
				ctx.fillStyle = hp > 0.35 ? '#66bb6a' : '#ef5350';
				ctx.fillRect(x - 16, y + 22, 32 * hp, 4);
			}
		}
		// The own hero is drawn even before the first snapshot that contains it.
		if (!mineDrawn && game.me !== null && game.running && !b.pMap.has(game.me)) {
			const meta = game.meta(game.me);
			drawHero(ctx, game.local.x, game.local.y, meta.hero, meta.color, game.local.fx, game.local.fy, now, true);
		}
	}

	// Auras of alive heroes whose trait heals allies inside them.
	healAuras(game) {
		const out = [];
		for (const row of game.view.b.p) {
			if (row[P.st] === 1 || !Array.isArray(row[P.w])) continue;
			const pid = row[P.pid];
			if (!(HEROES[game.meta(pid).hero]?.trait?.auraHeal > 0)) continue;
			const wl = row[P.w].find((w) => Array.isArray(w) && w[0] === 'aura');
			if (!wl) continue;
			const pos = game.playerPos(pid, this.tmp);
			if (!pos) continue;
			const def = WEAPONS.aura.levels[Math.max(0, Math.min(4, (wl[1] | 0) - 1))];
			out.push({ pid, x: pos.x, y: pos.y, r: def.radius * (pid === game.me ? game.areaMul() : 1) });
		}
		return out;
	}

	drawHealGlow(ctx, x, y, now) {
		const a = 0.45 + Math.sin(now * 5) * 0.12;
		const g = ctx.createRadialGradient(x, y, 4, x, y, 30);
		g.addColorStop(0, `rgba(255,224,130,${a})`);
		g.addColorStop(1, 'rgba(255,224,130,0)');
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(x, y, 30, 0, TAU);
		ctx.fill();
		// Little rising sparks.
		ctx.fillStyle = 'rgba(255,236,170,0.9)';
		ctx.beginPath();
		for (let k = 0; k < 3; k++) {
			const ph = (now * 0.9 + k / 3) % 1;
			const sx = x + Math.sin(k * 2.1 + now) * 13, sy = y + 6 - ph * 34;
			ctx.moveTo(sx + 1.8, sy);
			ctx.arc(sx, sy, 1.8 * (1 - ph * 0.6), 0, TAU);
		}
		ctx.fill();
	}

	drawDowned(ctx, x, y, meta, rev, now) {
		ctx.fillStyle = 'rgba(0,0,0,0.35)';
		ctx.beginPath();
		ctx.ellipse(x, y + 8, 20, 7, 0, 0, TAU);
		ctx.fill();
		ctx.fillStyle = '#5f6370';
		ctx.beginPath();
		ctx.ellipse(x, y + 4, 17, 9, 0, 0, TAU);
		ctx.fill();
		ctx.strokeStyle = meta.color;
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.fillStyle = '#e8e9f3';
		ctx.font = '700 14px system-ui, sans-serif';
		ctx.fillText('✝', x, y + 3);
		// Revive ring.
		const pulse = 0.5 + Math.sin(now * 5) * 0.2;
		ctx.strokeStyle = `rgba(255,255,255,${pulse * 0.4})`;
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.arc(x, y, 28, 0, TAU);
		ctx.stroke();
		if (rev > 0) {
			ctx.strokeStyle = '#81c784';
			ctx.lineWidth = 4;
			ctx.beginPath();
			ctx.arc(x, y, 28, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, rev / 100));
			ctx.stroke();
		}
	}

	drawEffects(ctx, game) {
		// Death and chest rings.
		for (const r of game.rings) {
			const k = r.t / r.life;
			let x = r.x, y = r.y;
			if (r.pid !== undefined) {
				const p = game.playerPos(r.pid, this.tmp);
				if (p) { x = p.x; y = p.y; }
			}
			ctx.globalAlpha = 1 - k;
			const rr = r.r0 + (r.r1 - r.r0) * (r.frost || r.fill ? 1 - (1 - k) * (1 - k) : k);
			if (r.fill) {
				ctx.fillStyle = r.color;
				ctx.globalAlpha = (1 - k) * 0.35;
				ctx.beginPath();
				ctx.arc(x, y, rr, 0, TAU);
				ctx.fill();
				ctx.globalAlpha = 1 - k;
			}
			ctx.strokeStyle = r.color;
			ctx.lineWidth = r.frost ? 5 : 3;
			ctx.beginPath();
			ctx.arc(x, y, rr, 0, TAU);
			ctx.stroke();
			if (r.frost) {
				// Ice shards riding the wave.
				ctx.fillStyle = '#e1f5fe';
				ctx.beginPath();
				for (let i = 0; i < 12; i++) {
					const a = (i / 12) * TAU + r.r1 * 0.01;
					const cx = x + Math.cos(a) * rr, cy = y + Math.sin(a) * rr;
					ctx.moveTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
					ctx.lineTo(cx - Math.sin(a) * 3, cy + Math.cos(a) * 3);
					ctx.lineTo(cx + Math.sin(a) * 3, cy - Math.cos(a) * 3);
					ctx.closePath();
				}
				ctx.fill();
			}
		}
		ctx.globalAlpha = 1;

		// Whip slashes.
		for (const s of game.slashes) {
			const p = game.playerPos(s.pid, this.tmp);
			if (!p) continue;
			const k = s.t / 0.22;
			const cx = p.x + s.dir * (s.range / 2 + 10);
			const rx = s.range / 2 + 6, ry = s.width / 2;
			ctx.globalAlpha = 1 - k;
			ctx.fillStyle = 'rgba(255,255,255,0.85)';
			ctx.beginPath();
			ctx.ellipse(cx, p.y, rx, ry, 0, s.dir > 0 ? -Math.PI / 2 : Math.PI / 2, s.dir > 0 ? Math.PI / 2 : Math.PI * 1.5);
			ctx.ellipse(cx - s.dir * rx * 0.35, p.y + ry * 0.15, rx * 0.8, ry * 0.65, 0, s.dir > 0 ? Math.PI / 2 : Math.PI * 1.5, s.dir > 0 ? -Math.PI / 2 : Math.PI / 2, true);
			ctx.fill();
			ctx.strokeStyle = 'rgba(144,202,249,0.9)';
			ctx.lineWidth = 2;
			ctx.stroke();
		}
		ctx.globalAlpha = 1;

		// Lightning.
		if (game.zaps.length) {
			ctx.lineJoin = 'round';
			for (const z of game.zaps) {
				const k = z.t / 0.25;
				const pts = z.pts;
				ctx.globalAlpha = 1 - k;
				ctx.beginPath();
				ctx.moveTo(pts[0], pts[1]);
				for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
				ctx.strokeStyle = 'rgba(129,212,250,0.45)';
				ctx.lineWidth = 9;
				ctx.stroke();
				ctx.strokeStyle = '#ffffff';
				ctx.lineWidth = 2.5;
				ctx.stroke();
				ctx.fillStyle = 'rgba(179,229,252,0.5)';
				ctx.beginPath();
				ctx.arc(pts[pts.length - 2], pts[pts.length - 1], 16 * (1 - k) + 4, 0, TAU);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
		}

		// Death particles.
		for (const p of game.particles) {
			ctx.globalAlpha = 1 - p.t / p.life;
			ctx.fillStyle = p.color;
			ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
		}
		ctx.globalAlpha = 1;

		// Damage numbers.
		if (game.numbers.length) {
			ctx.font = '800 14px system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.lineWidth = 3;
			ctx.strokeStyle = 'rgba(0,0,0,0.8)';
			for (const n of game.numbers) {
				if (n.crit) continue;
				const k = n.t / 0.8;
				const y = n.y - k * 26;
				ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
				ctx.strokeText(n.v, n.x, y);
				ctx.fillStyle = n.v >= 30 ? '#ffb74d' : '#ffffff';
				ctx.fillText(n.v, n.x, y);
			}
			// Crits: 40% bigger, yellow, with «!»; own ones brighter than allies'.
			ctx.font = '900 20px system-ui, sans-serif';
			ctx.lineWidth = 4;
			for (const n of game.numbers) {
				if (!n.crit) continue;
				const k = n.t / 0.8;
				const pop = k < 0.15 ? 1 + (0.15 - k) * 3 : 1;
				const y = n.y - k * 30;
				ctx.globalAlpha = (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4) * (n.mine ? 1 : 0.7);
				ctx.save();
				ctx.translate(n.x, y);
				ctx.scale(pop, pop);
				ctx.strokeText(n.v + '!', 0, 0);
				ctx.fillStyle = n.mine ? '#ffeb3b' : '#fff59d';
				ctx.fillText(n.v + '!', 0, 0);
				ctx.restore();
			}
			ctx.globalAlpha = 1;
		}
	}

	// Edge-of-screen arrows pointing to downed allies outside the view.
	drawArrows(ctx, game, now) {
		const b = game.view.b;
		const m = 28;
		const cx = this.w / 2, cy = this.h / 2;
		for (const row of b.p) {
			if (row[P.st] !== 1 || row[P.pid] === game.me) continue;
			const pos = game.playerPos(row[P.pid], this.tmp);
			if (!pos) continue;
			const s = this.toScreen(pos.x, pos.y, this.tmp);
			if (s.x > 0 && s.x < this.w && s.y > 0 && s.y < this.h) continue;
			const dx = s.x - cx, dy = s.y - cy;
			const k = Math.min((cx - m) / Math.abs(dx || 1e-6), (cy - m) / Math.abs(dy || 1e-6));
			const ax = cx + dx * k, ay = cy + dy * k;
			const ang = Math.atan2(dy, dx);
			const meta = game.meta(row[P.pid]);
			const pulse = 1 + Math.sin(now * 6) * 0.15;
			ctx.save();
			ctx.translate(ax, ay);
			ctx.rotate(ang);
			ctx.scale(pulse, pulse);
			ctx.fillStyle = meta.color;
			ctx.strokeStyle = '#000';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(14, 0);
			ctx.lineTo(-8, -10);
			ctx.lineTo(-3, 0);
			ctx.lineTo(-8, 10);
			ctx.closePath();
			ctx.stroke();
			ctx.fill();
			ctx.restore();
			ctx.font = '700 11px system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.lineWidth = 3;
			ctx.strokeStyle = 'rgba(0,0,0,0.85)';
			const lx = ax - Math.cos(ang) * 26, ly = ay - Math.sin(ang) * 22;
			ctx.strokeText('✝ ' + meta.name, lx, ly);
			ctx.fillStyle = '#fff';
			ctx.fillText('✝ ' + meta.name, lx, ly);
		}
	}
}

function drawProp(ctx, b, now) {
	const { x, y } = b;
	ctx.fillStyle = 'rgba(0,0,0,0.35)';
	ctx.beginPath();
	ctx.ellipse(x, y + 14, 16, 5, 0, 0, TAU);
	ctx.fill();
	if (b.kind === 'tomb') {
		ctx.fillStyle = '#78909c';
		ctx.strokeStyle = '#37474f';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(x - 11, y + 14);
		ctx.lineTo(x - 11, y - 6);
		ctx.arc(x, y - 6, 11, Math.PI, 0);
		ctx.lineTo(x + 11, y + 14);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = '#455a64';
		ctx.fillRect(x - 1.5, y - 10, 3, 14);
		ctx.fillRect(x - 5, y - 6, 10, 3);
	} else if (b.kind === 'barrel') {
		ctx.fillStyle = '#8d6e63';
		ctx.strokeStyle = '#3e2723';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.roundRect(x - 11, y - 14, 22, 28, 6);
		ctx.fill();
		ctx.stroke();
		ctx.strokeStyle = '#bcaaa4';
		ctx.beginPath();
		ctx.moveTo(x - 11, y - 6);
		ctx.lineTo(x + 11, y - 6);
		ctx.moveTo(x - 11, y + 6);
		ctx.lineTo(x + 11, y + 6);
		ctx.stroke();
	} else {
		ctx.strokeStyle = '#455a64';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(x, y + 14);
		ctx.lineTo(x, y - 18);
		ctx.stroke();
		const g = 0.55 + Math.sin(now * 2.3 + x) * 0.15;
		ctx.fillStyle = `rgba(255,213,79,${g * 0.3})`;
		ctx.beginPath();
		ctx.arc(x, y - 22, 16, 0, TAU);
		ctx.fill();
		ctx.fillStyle = '#ffe082';
		ctx.strokeStyle = '#37474f';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.rect(x - 5, y - 28, 10, 11);
		ctx.fill();
		ctx.stroke();
	}
}

function drawItem(ctx, type, x, y, now) {
	ctx.fillStyle = 'rgba(0,0,0,0.3)';
	ctx.beginPath();
	ctx.ellipse(x, y + 12, 10, 4, 0, 0, TAU);
	ctx.fill();
	// Soft glow so pickups stand out of the grass.
	const glow = { dew: '128,222,234', magnet: '255,112,67', rage: '239,83,80', cracker: '255,235,59', slowtime: '179,229,252', feather: '255,255,255', chest: '255,213,79' }[type] || '255,255,255';
	ctx.fillStyle = `rgba(${glow},${0.18 + Math.sin(now * 4) * 0.06})`;
	ctx.beginPath();
	ctx.arc(x, y, 17, 0, TAU);
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = 'rgba(0,0,0,0.7)';
	switch (type) {
		case 'dew':
			ctx.fillStyle = '#b0bec5';
			ctx.beginPath();
			ctx.moveTo(x - 9, y - 6);
			ctx.quadraticCurveTo(x, y + 8, x + 9, y - 6);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.fillRect(x - 1.5, y + 1, 3, 7);
			ctx.fillRect(x - 5, y + 7, 10, 2.5);
			ctx.fillStyle = '#4dd0e1';
			ctx.beginPath();
			ctx.ellipse(x, y - 5, 7, 2.2, 0, 0, TAU);
			ctx.fill();
			break;
		case 'magnet':
			ctx.fillStyle = '#4e342e';
			ctx.beginPath();
			ctx.arc(x, y, 10, 0, TAU);
			ctx.fill();
			ctx.stroke();
			ctx.strokeStyle = '#ff7043';
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.arc(x, y, 5.5, 0.6, TAU - 0.6);
			ctx.moveTo(x + 6, y);
			ctx.lineTo(x - 1, y);
			ctx.stroke();
			break;
		case 'rage':
		case 'slowtime': {
			const liquid = type === 'rage' ? '#e53935' : '#81d4fa';
			ctx.fillStyle = '#eceff1';
			ctx.fillRect(x - 2.5, y - 12, 5, 6);
			ctx.fillStyle = liquid;
			ctx.beginPath();
			ctx.arc(x, y + 2, 8, 0, TAU);
			ctx.fill();
			ctx.stroke();
			if (type === 'slowtime') {
				ctx.strokeStyle = '#0d47a1';
				ctx.beginPath();
				ctx.moveTo(x - 4, y - 2);
				ctx.lineTo(x + 4, y - 2);
				ctx.lineTo(x - 4, y + 6);
				ctx.lineTo(x + 4, y + 6);
				ctx.closePath();
				ctx.stroke();
			}
			break;
		}
		case 'cracker':
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(-0.5);
			ctx.fillStyle = '#ffeb3b';
			ctx.fillRect(-11, -5, 22, 10);
			ctx.fillStyle = '#e53935';
			for (let i = -9; i < 11; i += 6) ctx.fillRect(i, -5, 3, 10);
			ctx.strokeRect(-11, -5, 22, 10);
			ctx.restore();
			break;
		case 'feather':
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(-0.7 + Math.sin(now * 2) * 0.1);
			ctx.fillStyle = '#fafafa';
			ctx.beginPath();
			ctx.ellipse(0, 0, 4.5, 12, 0, 0, TAU);
			ctx.fill();
			ctx.stroke();
			ctx.strokeStyle = '#90a4ae';
			ctx.beginPath();
			ctx.moveTo(0, -11);
			ctx.lineTo(0, 15);
			ctx.stroke();
			ctx.restore();
			break;
		case 'chest': {
			// Light pillar visible from afar.
			const g = ctx.createLinearGradient(x, y - 160, x, y);
			g.addColorStop(0, 'rgba(255,213,79,0)');
			g.addColorStop(1, `rgba(255,213,79,${0.35 + Math.sin(now * 3) * 0.1})`);
			ctx.fillStyle = g;
			ctx.fillRect(x - 10, y - 160, 20, 160);
			ctx.fillStyle = '#6d4c41';
			ctx.beginPath();
			ctx.roundRect(x - 13, y - 9, 26, 18, 3);
			ctx.fill();
			ctx.stroke();
			ctx.fillStyle = '#ffca28';
			ctx.fillRect(x - 13, y - 3, 26, 3);
			ctx.fillRect(x - 2.5, y - 4, 5, 7);
			break;
		}
	}
}

// Hero figure: body in player color, hero-specific headgear in hero color.
export function drawHero(ctx, x, y, heroId, color, fx, fy, now, me) {
	const hero = HEROES[heroId] || HEROES.knight;
	const r = 14;
	ctx.fillStyle = 'rgba(0,0,0,0.38)';
	ctx.beginPath();
	ctx.ellipse(x, y + r * 0.95, r * 1.05, r * 0.38, 0, 0, TAU);
	ctx.fill();
	if (me) {
		ctx.strokeStyle = 'rgba(255,255,255,0.25)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.ellipse(x, y + r * 0.95, r * 1.5, r * 0.55, 0, 0, TAU);
		ctx.stroke();
	}
	// Facing pointer.
	const len = Math.hypot(fx, fy) || 1;
	const ux = fx / len, uy = fy / len;
	ctx.fillStyle = color;
	ctx.globalAlpha = 0.85;
	ctx.beginPath();
	ctx.moveTo(x + ux * (r + 10), y + uy * (r + 10));
	ctx.lineTo(x + ux * (r + 2) - uy * 6, y + uy * (r + 2) + ux * 6);
	ctx.lineTo(x + ux * (r + 2) + uy * 6, y + uy * (r + 2) - ux * 6);
	ctx.closePath();
	ctx.fill();
	ctx.globalAlpha = 1;
	// Body.
	const bob = Math.sin(now * 8) * 0.8;
	ctx.fillStyle = color;
	ctx.strokeStyle = 'rgba(0,0,0,0.6)';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(x, y + bob, r, 0, TAU);
	ctx.fill();
	ctx.stroke();
	// Face.
	const lx = ux * 3;
	ctx.fillStyle = '#f5e6d3';
	ctx.beginPath();
	ctx.ellipse(x + lx, y - 2 + bob, r * 0.55, r * 0.45, 0, 0, TAU);
	ctx.fill();
	ctx.fillStyle = '#1b1b1b';
	ctx.beginPath();
	ctx.arc(x + lx - 3, y - 3 + bob, 1.6, 0, TAU);
	ctx.arc(x + lx + 3, y - 3 + bob, 1.6, 0, TAU);
	ctx.fill();
	// Headgear.
	ctx.fillStyle = hero.color;
	ctx.strokeStyle = 'rgba(0,0,0,0.55)';
	ctx.lineWidth = 1.5;
	if (heroId === 'herald') return drawHerald(ctx, x, y + bob, r, hero.color, now);
	if (heroId === 'smith') return drawSmith(ctx, x, y, r, hero.color, lx, ux, bob);
	if (heroId === 'stormcaller') return drawStormcaller(ctx, x, y, r, hero.color, now, bob);
	if (heroId === 'alchemist') return drawAlchemist(ctx, x, y, r, hero.color, lx, ux, now, bob);
	ctx.beginPath();
	if (heroId === 'witch') {
		ctx.ellipse(x, y - r * 0.55 + bob, r * 1.1, r * 0.25, 0, 0, TAU);
		ctx.moveTo(x - r * 0.6, y - r * 0.6 + bob);
		ctx.lineTo(x + r * 0.5, y - r * 2.1 + bob);
		ctx.lineTo(x + r * 0.6, y - r * 0.6 + bob);
		ctx.closePath();
	} else if (heroId === 'ranger') {
		ctx.arc(x, y - r * 0.2 + bob, r * 0.95, Math.PI * 1.05, Math.PI * 1.95);
		ctx.lineTo(x + r * 0.4, y - r * 1.35 + bob);
		ctx.lineTo(x - r * 0.2, y - r * 1.55 + bob);
		ctx.closePath();
	} else {
		ctx.arc(x, y - r * 0.15 + bob, r * 0.95, Math.PI, 0);
		ctx.lineTo(x + r * 0.95, y - r * 0.3 + bob);
		ctx.lineTo(x - r * 0.95, y - r * 0.3 + bob);
		ctx.closePath();
		ctx.moveTo(x, y - r * 1.1 + bob);
		ctx.lineTo(x + 3, y - r * 1.6 + bob);
		ctx.lineTo(x - 3, y - r * 1.6 + bob);
		ctx.closePath();
	}
	ctx.fill();
	ctx.stroke();
}

function drawHerald(ctx, x, y, r, color, now) {
	// Tall rounded cowl.
	ctx.beginPath();
	ctx.moveTo(x - r * 1.0, y - r * 0.15);
	ctx.quadraticCurveTo(x - r * 1.05, y - r * 1.5, x, y - r * 1.95);
	ctx.quadraticCurveTo(x + r * 1.05, y - r * 1.5, x + r * 1.0, y - r * 0.15);
	ctx.lineTo(x + r * 0.7, y - r * 0.35);
	ctx.quadraticCurveTo(x, y - r * 1.05, x - r * 0.7, y - r * 0.35);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();
	// Swinging hand bell beside him.
	const sw = Math.sin(now * 4) * 0.35;
	const bx = x + r * 1.25, by = y - r * 0.1;
	ctx.save();
	ctx.translate(bx, by);
	ctx.rotate(sw);
	ctx.fillStyle = '#ffca28';
	ctx.beginPath();
	ctx.moveTo(-r * 0.12, -r * 0.55);
	ctx.quadraticCurveTo(-r * 0.4, -r * 0.45, -r * 0.42, r * 0.15);
	ctx.lineTo(r * 0.42, r * 0.15);
	ctx.quadraticCurveTo(r * 0.4, -r * 0.45, r * 0.12, -r * 0.55);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();
	ctx.fillStyle = '#6d4c41';
	ctx.beginPath();
	ctx.arc(0, r * 0.22, r * 0.11, 0, TAU);
	ctx.fill();
	ctx.restore();
}

function drawSmith(ctx, x, y, r, color, lx, ux, bob) {
	// Beard.
	ctx.fillStyle = '#5d4037';
	ctx.beginPath();
	ctx.moveTo(x + lx - r * 0.55, y + bob);
	ctx.quadraticCurveTo(x + lx, y + r * 0.95 + bob, x + lx + r * 0.55, y + bob);
	ctx.quadraticCurveTo(x + lx, y + r * 0.25 + bob, x + lx - r * 0.55, y + bob);
	ctx.fill();
	// Hammer over the shoulder, on the side away from the facing.
	const side = ux >= 0 ? -1 : 1;
	ctx.strokeStyle = '#6d4c41';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(x + side * r * 0.5, y + r * 0.4 + bob);
	ctx.lineTo(x + side * r * 1.15, y - r * 1.05 + bob);
	ctx.stroke();
	ctx.fillStyle = '#90a4ae';
	ctx.strokeStyle = 'rgba(0,0,0,0.6)';
	ctx.lineWidth = 1.5;
	ctx.save();
	ctx.translate(x + side * r * 1.15, y - r * 1.05 + bob);
	ctx.rotate(side * 0.42);
	ctx.beginPath();
	ctx.rect(-r * 0.55, -r * 0.28, r * 1.1, r * 0.56);
	ctx.fill();
	ctx.stroke();
	ctx.restore();
	// Wide flat cap with a brim.
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.rect(x - r * 1.1, y - r * 0.62 + bob, r * 2.2, r * 0.3);
	ctx.rect(x - r * 0.75, y - r * 1.12 + bob, r * 1.5, r * 0.52);
	ctx.fill();
	ctx.stroke();
}

function drawStormcaller(ctx, x, y, r, color, now, bob) {
	// Crackling crown of three bolts.
	const fl = 0.85 + Math.sin(now * 13) * 0.08;
	ctx.fillStyle = 'rgba(128,222,234,0.22)';
	ctx.beginPath();
	ctx.arc(x, y - r * 1.15 + bob, r * 1.0 * fl, 0, TAU);
	ctx.fill();
	ctx.fillStyle = color;
	ctx.beginPath();
	const w = r * 0.3;
	for (const k of [-1, 0, 1]) {
		const bx = x + k * r * 0.62, base = y - r * 0.5 + bob;
		const h = (k === 0 ? 1.6 : 1.2) * r * fl;
		const lean = k * r * 0.35;
		const pt = (u, v) => [bx + u * w + lean * v, base - v * h];
		const pts = [pt(-1, 0), pt(-0.1, 0.5), pt(-0.8, 0.5), pt(0.3, 1), pt(0.15, 0.58), pt(0.9, 0.58), pt(1, 0)];
		ctx.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
		ctx.closePath();
	}
	ctx.fillStyle = '#e0f7fa';
	ctx.lineWidth = 1;
	ctx.fill();
	ctx.stroke();
	ctx.fillStyle = color;
	ctx.lineWidth = 1.5;
	// Headband.
	ctx.beginPath();
	ctx.ellipse(x, y - r * 0.55 + bob, r * 0.95, r * 0.2, 0, 0, TAU);
	ctx.fill();
	ctx.stroke();
}

function drawAlchemist(ctx, x, y, r, color, lx, ux, now, bob) {
	// Flask on the back, on the side away from the facing.
	const side = ux >= 0 ? -1 : 1;
	const fx = x + side * r * 1.05, fy = y + r * 0.1 + bob;
	ctx.fillStyle = 'rgba(220,240,255,0.55)';
	ctx.beginPath();
	ctx.arc(fx, fy, r * 0.5, 0, TAU);
	ctx.rect(fx - r * 0.13, fy - r * 0.85, r * 0.26, r * 0.45);
	ctx.fill();
	ctx.stroke();
	ctx.fillStyle = '#9ccc65';
	ctx.beginPath();
	ctx.arc(fx, fy, r * 0.42, 0.15, Math.PI - 0.15);
	ctx.fill();
	ctx.fillStyle = 'rgba(220,255,180,0.8)';
	const ph = (now * 1.5) % 1;
	ctx.beginPath();
	ctx.arc(fx + r * 0.12, fy - ph * r * 0.9, r * 0.09, 0, TAU);
	ctx.fill();
	// Leather cap.
	ctx.fillStyle = '#8d6e63';
	ctx.beginPath();
	ctx.arc(x, y - r * 0.2 + bob, r * 0.92, Math.PI * 1.08, Math.PI * 1.92);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();
	// Goggles over the eyes.
	ctx.strokeStyle = '#4e342e';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(x - r * 0.95, y - r * 0.28 + bob);
	ctx.lineTo(x + r * 0.95, y - r * 0.28 + bob);
	ctx.stroke();
	ctx.fillStyle = color;
	ctx.strokeStyle = 'rgba(0,0,0,0.65)';
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.arc(x + lx - 3.5, y - 3.5 + bob, 3.6, 0, TAU);
	ctx.moveTo(x + lx + 3.5 + 3.6, y - 3.5 + bob);
	ctx.arc(x + lx + 3.5, y - 3.5 + bob, 3.6, 0, TAU);
	ctx.fill();
	ctx.stroke();
	ctx.fillStyle = 'rgba(38,50,56,0.85)';
	ctx.beginPath();
	ctx.arc(x + lx - 3.5, y - 3.5 + bob, 2, 0, TAU);
	ctx.arc(x + lx + 3.5, y - 3.5 + bob, 2, 0, TAU);
	ctx.fill();
}

// Small preview canvas for hero cards.
export function drawHeroPreview(canvas, heroId, color) {
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	const size = 56;
	canvas.width = size * dpr;
	canvas.height = size * dpr;
	const ctx = canvas.getContext('2d');
	ctx.setTransform(dpr * 1.3, 0, 0, dpr * 1.3, 0, 0);
	ctx.clearRect(0, 0, size, size);
	drawHero(ctx, size / 2 / 1.3, size / 2 / 1.3 + 4, heroId, color, 1, 0.3, 0, false);
}

