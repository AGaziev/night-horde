// Canvas 2D renderer: everything is procedural.
import {
	ENEMIES, ENEMY_TYPES, HEROES, WEAPONS, orbitAngle, MAX_ENEMIES, ST, ELITE_R_MUL, ELITE_AFFIXES, ITEM_TYPES,
	BREAK_TILE, breakableAt, PROJECTILE_KINDS, DUOS, EVOS, REACTIONS, beaconAngle, SHIELD_DIRS, SHIELD_SHIFT, weaponLevel,
} from '/shared/content.js';
import { P, lerpEnemy, E_STRIDE, TR_STRIDE, ZK_FIRE, ZK_CLOUD, ZK_LIGHT } from './game.js';
import { sprites, blit, walkFrame, attackFrame } from './sprites.js';
import { Overlay, DprController } from './display.js';

const TILE = 96;
const GEM_COLORS = ['#4fc3f7', '#81c784', '#f06292', '#ffd54f'];
const GEM_SIZE = [5, 6.5, 8.5, 9.5];
const BOSS_T = ENEMY_TYPES.indexOf('boss');
const BOSS_SET = new Set(ENEMY_TYPES.map((t, i) => (ENEMIES[t].boss ? i : -1)).filter((i) => i >= 0));
const SPITTER_T = ENEMY_TYPES.indexOf('spitter');
const BLOATER_T = ENEMY_TYPES.indexOf('bloater');
const SNIPER_T = ENEMY_TYPES.indexOf('sniper');
const SHIELD_T = ENEMY_TYPES.indexOf('shield');
const GOLD_T = ENEMY_TYPES.indexOf('goldshade');
const SHIELD_ARC = (ENEMIES.shield.arc * Math.PI) / 180;
const shieldAngle = (st) => (((st >> SHIELD_SHIFT) & (SHIELD_DIRS - 1)) / SHIELD_DIRS) * Math.PI * 2;
const SICKLE_K = PROJECTILE_KINDS.indexOf('sickle');
const ICEDISC_K = PROJECTILE_KINDS.indexOf('icedisc');
const SPEAR_K = PROJECTILE_KINDS.indexOf('spear');
const duoLevel = (id, lvl) => DUOS[id].levels[Math.max(0, Math.min(2, (lvl | 0) - 1))];
const BAR_TYPES = new Set(['ghoul', 'wisp', 'skel', 'brute', 'spitter', 'sniper', 'shield', 'goldshade'].map((t) => ENEMY_TYPES.indexOf(t)));
const GROUND = ['#13171b', '#141a1d', '#12161a', '#151a1b'];
const TYPE_COUNT = ENEMY_TYPES.length;
const CAP = MAX_ENEMIES + 64;
const TAU = Math.PI * 2;
// Sheets are drawn at 2x game units: 0.5 gives one art pixel per device pixel at DPR 2.
const ART = 0.5;
const PROJ_ART = { bolt: 0.8, knife: 0.8, sickle: 1, icedisc: 1, spear: 1.6, hostile: 0.75 };
const DECOR = ['prop_gravestone', 'prop_stump', 'prop_mushrooms'];
const DECOR_CELL = 200;
const ITEM_ARROWS = 3;
const ALLY_ARROWS = 4; // standing-ally arrows after merging close directions
const ALLY_MERGE = 0.4; // rad: allies closer in direction share an arrow
const MM_RANGE = 1600; // world units from the hero to the minimap rim
const HERO_FOOT = 14 * 0.95;

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
		this.sprites = sprites;
		this.heroMotion = new Map();
		this.arrowBuf = [];
		this.itemArrows = [];
		this.allyArrows = [];
		this.arrowBox = { at: -1, w: 0, h: 0, l: 0, r: 0, t: 0, b: 0, mmX: Infinity, mmY: Infinity };
		this.mmShown = null;
		this.mmAt = 0;
		this.mmSize = 0;
		this.overlay = new Overlay();
		this.dprCtl = new DprController(() => this.resize());
		this.resize();
		addEventListener('resize', () => this.resize());
	}

	resize() {
		this.dpr = this.dprCtl.value;
		this.w = window.innerWidth;
		this.h = window.innerHeight;
		this.canvas.width = Math.round(this.w * this.dpr);
		this.canvas.height = Math.round(this.h * this.dpr);
		this.zoom = Math.min(1.1, Math.max(0.6, Math.min(this.w, this.h) / 720));
	}

	draw(game, dt) {
		const ctx = this.ctx;
		const { w, h, dpr } = this;
		const z = this.zoom;
		const now = performance.now() / 1000;
		this.dt = dt;
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

		this.ox = (w / 2 + sx - this.camX * z) * dpr;
		this.oy = (h / 2 + sy - this.camY * z) * dpr;
		this.k = dpr * z;
		ctx.setTransform(this.k, 0, 0, this.k, this.ox, this.oy);
		ctx.imageSmoothingEnabled = false;
		this.drawGround(ctx, vx0, vy0, vx1, vy1);

		if (inGame) {
			const tm = view.tm;
			this.trackSlowPuddles(game);
			this.drawProps(ctx, game, now);
			this.drawIceTrail(ctx, game);
			this.drawPuddles(ctx, view.b, now, game);
			this.drawSteams(ctx, game, now);
			this.drawBanners(ctx, game, now);
			this.drawEventGround(ctx, game, now);
			this.drawWarns(ctx, game, now);
			this.drawTraps(ctx, view.b, now);
			this.drawItems(ctx, view.b, now);
			this.drawGems(ctx, view, now);
			this.drawAuras(ctx, game, now);
			this.drawEnemies(ctx, view, now);
			this.drawPlayers(ctx, game, now);
			this.drawOrbits(ctx, game, tm);
			this.drawProjectiles(ctx, game, now);
			this.drawOrbs(ctx, game, now);
			this.drawThunder(ctx, game, now);
			this.drawCones(ctx, game);
			this.drawCrescents(ctx, game);
			this.drawLobs(ctx, game, now);
			this.drawHostile(ctx, game, now);
			this.drawEventSky(ctx, game, now);
			this.drawEffects(ctx, game);
			this.drawReactions(ctx, game);
			this.drawFinale(ctx, game, now, vx0, vy0, vx1, vy1);
		}

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (inGame && game.evoFlash) {
			// Own evolution: a 120 ms full-screen flash in the weapon colour.
			ctx.globalAlpha = 0.35 * (1 - game.evoFlash.t / 0.12);
			ctx.fillStyle = game.evoFlash.color;
			ctx.fillRect(0, 0, w, h);
			ctx.globalAlpha = 1;
		}
		this.overlay.hurt(inGame ? game.hurtFlash : 0);
		this.overlay.peak(inGame ? game : null);
		this.overlay.arrows(inGame ? this.arrowList(game, now) : null);
		this.updateMinimap(game, now, inGame);
		this.dprCtl.frame();
	}

	toScreen(x, y, out) {
		out.x = (x - this.camX) * this.zoom + this.w / 2;
		out.y = (y - this.camY) * this.zoom + this.h / 2;
		return out;
	}

	drawGround(ctx, x0, y0, x1, y1) {
		const g = this.sprites.ready && this.sprites.get('ground');
		if (!g) return this.drawGroundVector(ctx, x0, y0, x1, y1);
		// Tiles blitted on whole device pixels: much cheaper than a transformed pattern under software raster.
		const k = this.k, step = g.cw * ART;
		const size = Math.ceil(step * k);
		const tx0 = Math.floor(x0 / step), tx1 = Math.floor(x1 / step);
		const ty0 = Math.floor(y0 / step), ty1 = Math.floor(y1 / step);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		for (let ty = ty0; ty <= ty1; ty++) {
			const dy = Math.round(this.oy + ty * step * k);
			for (let tx = tx0; tx <= tx1; tx++) ctx.drawImage(g.img, Math.round(this.ox + tx * step * k), dy, size, size);
		}
		ctx.setTransform(k, 0, 0, k, this.ox, this.oy);
		this.drawDecor(ctx, x0, y0, x1, y1);
	}

	// Rare non-colliding decor, seeded by world cell; never on top of a breakable prop.
	drawDecor(ctx, x0, y0, x1, y1) {
		const cx0 = Math.floor((x0 - 40) / DECOR_CELL), cx1 = Math.floor((x1 + 40) / DECOR_CELL);
		const cy0 = Math.floor(y0 / DECOR_CELL), cy1 = Math.floor((y1 + 40) / DECOR_CELL);
		for (let cy = cy0; cy <= cy1; cy++) {
			for (let cx = cx0; cx <= cx1; cx++) {
				const hv = hash2(cx * 7 + 3301, cy * 13 - 911);
				if (hv % 9 !== 0) continue;
				const s = this.sprites.get(DECOR[(hv >>> 8) % DECOR.length]);
				if (!s) continue;
				const x = cx * DECOR_CELL + 30 + ((hv >>> 12) % (DECOR_CELL - 60));
				const y = cy * DECOR_CELL + 30 + ((hv >>> 20) % (DECOR_CELL - 60));
				const b = breakableAt(Math.floor(x / BREAK_TILE), Math.floor(y / BREAK_TILE));
				if (b && (b.x - x) ** 2 + (b.y - y) ** 2 < 4900) continue;
				blit(ctx, s, 0, x, y, ART, (hv & 16) !== 0);
			}
		}
	}

	drawGroundVector(ctx, x0, y0, x1, y1) {
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

	drawPuddles(ctx, snap, now, game) {
		const z = snap.z;
		if (!z.length) return;
		const look = (i) => game.zk.get(z[i]) | 0;
		// Burning pools (Коктейль) and censer clouds (Кадило) have their own look.
		for (let i = 0; i + 4 <= z.length; i += 4) {
			const k = look(i);
			if (!k) continue;
			const x = z[i + 1], y = z[i + 2], r = z[i + 3];
			if (k === ZK_FIRE) {
				const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
				g.addColorStop(0, 'rgba(255,214,0,0.45)');
				g.addColorStop(0.6, 'rgba(255,112,67,0.32)');
				g.addColorStop(1, 'rgba(120,200,80,0.12)');
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.ellipse(x, y, r, r * 0.8, 0, 0, TAU);
				ctx.fill();
				ctx.fillStyle = 'rgba(255,171,64,0.85)';
				ctx.beginPath();
				for (let f = 0; f < 4; f++) {
					const a = f * 1.6 + z[i] * 0.3, ph = (now * 2 + f * 0.25 + z[i] * 0.07) % 1;
					const fx = x + Math.cos(a) * r * 0.5, fy = y + Math.sin(a) * r * 0.35 - ph * 14;
					ctx.moveTo(fx + 3, fy);
					ctx.arc(fx, fy, 3 * (1 - ph), 0, TAU);
				}
				ctx.fill();
			} else if (k === ZK_LIGHT) {
				const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.3);
				g.addColorStop(0, 'rgba(255,241,118,0.30)');
				g.addColorStop(1, 'rgba(255,213,79,0)');
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.arc(x, y, r * 1.3, 0, TAU);
				ctx.fill();
			} else if (k === ZK_CLOUD) {
				ctx.fillStyle = 'rgba(200,230,201,0.07)';
				ctx.beginPath();
				for (let c = 0; c < 3; c++) {
					const a = c * 2.1 + now * 0.6 + z[i] * 0.2;
					const cx = x + Math.cos(a) * r * 0.3, cy = y + Math.sin(a) * r * 0.25 - 4;
					ctx.moveTo(cx + r * 0.7, cy);
					ctx.arc(cx, cy, r * 0.7, 0, TAU);
				}
				ctx.fill();
				ctx.strokeStyle = 'rgba(232,245,233,0.14)';
				ctx.lineWidth = 1;
				ctx.stroke();
			}
		}
		ctx.fillStyle = 'rgba(120,220,90,0.22)';
		ctx.beginPath();
		let plain = false;
		for (let i = 0; i + 4 <= z.length; i += 4) {
			if (look(i)) continue;
			const x = z[i + 1], y = z[i + 2], r = z[i + 3];
			ctx.moveTo(x + r, y);
			ctx.ellipse(x, y, r, r * 0.8, 0, 0, TAU);
			plain = true;
		}
		if (!plain) return;
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
			if (!this.visible(p.x, p.y) && !BOSS_SET.has(type)) continue;
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
			if (BOSS_SET.has(ty)) for (let k = 0; k < cnt[ty]; k++) this.drawBoss(ctx, this.ex[ty][k], this.ey[ty][k], now, ty, this.est[ty][k], this.eid[ty][k], this.edx[ty][k]);
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
		if (n && this.drawEnemySprites(ctx, ty, n, now)) return;
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

	drawEnemySprites(ctx, ty, n, now) {
		const s = this.sprites.get(ENEMY_TYPES[ty]);
		if (!s) return false;
		const r = ENEMIES[ENEMY_TYPES[ty]].r;
		const sc = ART * r / (s.body || r);
		const foot = r * 0.85;
		const xs = this.ex[ty], ys = this.ey[ty], ids = this.eid[ty], st = this.est[ty], dx = this.edx[ty];
		for (let k = 0; k < n; k++) {
			const x = xs[k], y = ys[k], f = st[k];
			let scale = sc;
			if (ty === SPITTER_T || ty === BLOATER_T) {
				const wind = (f & ST.windup) !== 0;
				if (ty === SPITTER_T) {
					scale *= wind ? 1.18 + Math.sin(now * 40) * 0.04 : 1 + Math.sin(now * 3 + ids[k]) * 0.04;
					if (wind) {
						ctx.fillStyle = 'rgba(178,255,89,0.35)';
						ctx.beginPath();
						ctx.arc(x, y, r * 1.9, 0, TAU);
						ctx.fill();
					}
				} else scale *= wind ? 1.25 + Math.sin(now * 35) * 0.08 : 1;
			}
			const still = (f & (ST.frozen | ST.root)) !== 0;
			if (ty === SHIELD_T) {
				this.drawShieldUnit(ctx, s, x, y, foot, scale, f, still ? 0 : walkFrame(s, now, ids[k]), now);
				continue;
			}
			if (ty === SNIPER_T || ty === GOLD_T) this.drawSpecialGlow(ctx, ty, x, y, r, f, now, ids[k]);
			const frame = still ? 0 : ty === SNIPER_T && (f & ST.windup) ? attackFrame(s, now) : walkFrame(s, now, ids[k]);
			blit(ctx, s, frame, x, y + foot, scale, dx[k] < -0.3);
			if (ty === BLOATER_T && (f & ST.windup) && Math.sin(now * 30) > 0) {
				ctx.fillStyle = 'rgba(255,82,82,0.45)';
				ctx.beginPath();
				ctx.arc(x, y - 2, r * 1.2, 0, TAU);
				ctx.fill();
			}
		}
		return true;
	}

	// Shieldbearer: the figure faces its shield; a steel arc marks the guarded front (×0,2 damage), the rest is open.
	drawShieldUnit(ctx, s, x, y, foot, scale, st, frame, now) {
		const a = shieldAngle(st), r = ENEMIES.shield.r;
		blit(ctx, s, frame, x, y + foot, scale, Math.cos(a) < 0);
		ctx.save();
		ctx.lineCap = 'round';
		ctx.strokeStyle = 'rgba(20,30,40,0.85)';
		ctx.lineWidth = 7;
		ctx.beginPath();
		ctx.arc(x, y, r * 1.45, a - SHIELD_ARC, a + SHIELD_ARC);
		ctx.stroke();
		ctx.strokeStyle = `rgba(176,212,236,${0.8 + Math.sin(now * 5) * 0.15})`;
		ctx.lineWidth = 4;
		ctx.stroke();
		ctx.restore();
	}

	// Golden shade (v18.1): a trail of fading gold sparks behind it, a bright pulsing halo and a light beam,
	// so it stands out of the horde at once.
	drawGoldShade(ctx, x, y, r, now, id) {
		const trails = this.goldTrails ??= new Map();
		let t = trails.get(id);
		if (!t) trails.set(id, t = { pts: [], at: 0 });
		if (now - t.at > 0.04) {
			t.at = now;
			t.pts.push(x, y, now);
			if (t.pts.length > 3 * 18) t.pts.splice(0, 3);
		}
		t.seen = now;
		for (let i = 0; i < t.pts.length; i += 3) {
			const age = now - t.pts[i + 2];
			if (age > 0.7) continue;
			const k = 1 - age / 0.7;
			const jx = Math.sin(t.pts[i + 2] * 37 + i) * 5, jy = Math.cos(t.pts[i + 2] * 29 + i) * 5;
			ctx.fillStyle = `rgba(255,${200 + Math.round(55 * k)},${Math.round(120 * k)},${0.85 * k})`;
			ctx.beginPath();
			ctx.arc(t.pts[i] + jx, t.pts[i + 1] + jy, 1.5 + 3.5 * k, 0, TAU);
			ctx.fill();
		}
		if (trails.size > 8) for (const [k2, v] of trails) if (now - v.seen > 2) trails.delete(k2);
		const g = ctx.createLinearGradient(x, y - 140, x, y);
		g.addColorStop(0, 'rgba(255,213,79,0)');
		g.addColorStop(1, `rgba(255,213,79,${0.35 + Math.sin(now * 5) * 0.1})`);
		ctx.fillStyle = g;
		ctx.fillRect(x - 7, y - 140, 14, 140);
		const p = 1 + Math.sin(now * 9 + id) * 0.12;
		ctx.fillStyle = 'rgba(255,193,7,0.22)';
		ctx.beginPath();
		ctx.arc(x, y, r * 3.2 * p, 0, TAU);
		ctx.fill();
		ctx.fillStyle = 'rgba(255,236,179,0.45)';
		ctx.beginPath();
		ctx.arc(x, y, r * 1.8 * p, 0, TAU);
		ctx.fill();
		ctx.strokeStyle = '#ffd54f';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(x, y, r * 2.4 * p, 0, TAU);
		ctx.stroke();
	}

	// Sniper: teal aura, brighter while aiming.
	drawSpecialGlow(ctx, ty, x, y, r, st, now, id) {
		if (ty === GOLD_T) return this.drawGoldShade(ctx, x, y, r, now, id);
		const wind = (st & ST.windup) !== 0;
		ctx.fillStyle = wind ? `rgba(100,255,218,${0.3 + Math.sin(now * 30) * 0.1})` : 'rgba(100,255,218,0.12)';
		ctx.beginPath();
		ctx.arc(x, y, r * (wind ? 2.2 : 1.7), 0, TAU);
		ctx.fill();
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
		if (BOSS_SET.has(el.type)) this.drawBoss(ctx, el.x, el.y, now, el.type, el.st, el.id, el.dx);
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
			for (let k = 0; k < n; k++) if (st[k] & (ST.chill | ST.frozen | ST.root | ST.burn | ST.mark | ST.wet | ST.resonance | ST.stormMarked)) this.drawStateOne(ctx, this.ex[ty][k], this.ey[ty][k], r, st[k], now);
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
		if (st & ST.mark) {
			// Lantern mark: a golden diamond over the head.
			const my = y - r - 9 + Math.sin(now * 5 + x) * 1.5;
			ctx.fillStyle = '#ffd54f';
			ctx.beginPath();
			ctx.moveTo(x, my - 5);
			ctx.lineTo(x + 4, my);
			ctx.lineTo(x, my + 5);
			ctx.lineTo(x - 4, my);
			ctx.closePath();
			ctx.fill();
		}
		if (st & ST.stormMarked) {
			ctx.strokeStyle = '#82e8ff';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(x, y, r + 5, Math.PI * 1.15, Math.PI * 1.85);
			ctx.stroke();
		}
		if (st & ST.resonance) {
			ctx.strokeStyle = '#ffd47e';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(x, y, r + 4, Math.PI * 0.14, Math.PI * 0.86);
			ctx.stroke();
		}
		if (st & ST.wet) {
			// Wet: two blue drops dripping down the sides.
			ctx.fillStyle = 'rgba(79,195,247,0.85)';
			ctx.beginPath();
			for (let i = 0; i < 2; i++) {
				const ph = (now * 1.2 + i * 0.5 + y * 0.013) % 1;
				const dx = x + (i ? r * 0.7 : -r * 0.7), dy = y - r * 0.2 + ph * r * 0.9;
				ctx.moveTo(dx, dy - 4);
				ctx.quadraticCurveTo(dx + 2.6, dy + 0.5, dx, dy + 2.5);
				ctx.quadraticCurveTo(dx - 2.6, dy + 0.5, dx, dy - 4);
			}
			ctx.fill();
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

	// Bosses: windup glow (an attack is coming) under a per-kind figure.
	drawBoss(ctx, x, y, now, ty = BOSS_T, st = 0, id = 0, dx = 0) {
		const def = ENEMIES[ENEMY_TYPES[ty]] || ENEMIES.boss;
		const r = def.r;
		if (st & ST.windup) {
			const k = 0.5 + 0.5 * Math.sin(now * 18);
			ctx.fillStyle = `rgba(255,235,59,${0.18 + 0.2 * k})`;
			ctx.beginPath();
			ctx.arc(x, y, r * (1.75 + 0.15 * k), 0, TAU);
			ctx.fill();
			ctx.strokeStyle = `rgba(255,241,118,${0.6 + 0.4 * k})`;
			ctx.lineWidth = 3;
			ctx.stroke();
		}
		const s = this.sprites.get(ENEMY_TYPES[ty]);
		if (s) {
			const f = (st & ST.windup) && s.attack ? attackFrame(s, now) : (st & (ST.frozen | ST.root)) ? 0 : walkFrame(s, now, id);
			return blit(ctx, s, f, x, y + r * 0.85, ART * r / (s.body || r), dx < -0.3);
		}
		switch (def.bk) {
			case 'brood': return this.drawBrood(ctx, x, y, r, def.color, now, id);
			case 'ram': return this.drawRam(ctx, x, y, r, def.color);
			case 'gunner': return this.drawGunner(ctx, x, y, r, def.color, now);
			case 'twin':
			case 'half': return this.drawTwin(ctx, x, y, r, def.color, now, def.bk === 'half');
		}
		return this.drawLord(ctx, x, y, now);
	}

	drawBrood(ctx, x, y, r, color, now, id) {
		ctx.save();
		ctx.translate(x, y);
		ctx.strokeStyle = '#4a148c';
		ctx.lineWidth = 5;
		ctx.lineCap = 'round';
		ctx.beginPath();
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * TAU + 0.2;
			const wig = Math.sin(now * 6 + i * 1.7 + id) * 0.18;
			ctx.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7);
			ctx.quadraticCurveTo(Math.cos(a + wig) * r * 1.35, Math.sin(a + wig) * r * 1.35 - 6, Math.cos(a + wig * 2) * r * 1.6, Math.sin(a + wig * 2) * r * 1.6);
		}
		ctx.stroke();
		ctx.shadowColor = '#e040fb';
		ctx.shadowBlur = 18;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.ellipse(0, 0, r * 0.95, r * 0.8, 0, 0, TAU);
		ctx.fill();
		ctx.shadowBlur = 0;
		ctx.fillStyle = '#ce93d8';
		ctx.beginPath();
		for (let i = 0; i < 5; i++) {
			const a = (i / 5) * TAU + now * 0.5;
			const er = r * (0.14 + 0.03 * Math.sin(now * 5 + i));
			ctx.moveTo(Math.cos(a) * r * 0.5 + er, Math.sin(a) * r * 0.45);
			ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.45, er, 0, TAU);
		}
		ctx.fill();
		ctx.fillStyle = '#ff1744';
		ctx.beginPath();
		for (const [ex, ey] of [[-0.2, -0.15], [0.2, -0.15], [-0.1, 0.05], [0.1, 0.05]]) {
			ctx.moveTo(ex * r + r * 0.08, ey * r);
			ctx.arc(ex * r, ey * r, r * 0.08, 0, TAU);
		}
		ctx.fill();
		ctx.restore();
	}

	drawRam(ctx, x, y, r, color) {
		ctx.save();
		ctx.translate(x, y);
		ctx.fillStyle = 'rgba(141,110,99,0.2)';
		ctx.beginPath();
		ctx.arc(0, 0, r * 1.5, 0, TAU);
		ctx.fill();
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(0, 0, r, 0, TAU);
		ctx.fill();
		ctx.fillStyle = shade(color, 0.6);
		ctx.beginPath();
		ctx.ellipse(0, r * 0.35, r * 0.5, r * 0.35, 0, 0, TAU);
		ctx.fill();
		ctx.strokeStyle = '#efebe9';
		ctx.lineWidth = r * 0.28;
		ctx.lineCap = 'round';
		for (const sg of [-1, 1]) {
			ctx.beginPath();
			ctx.moveTo(sg * r * 0.55, -r * 0.55);
			ctx.quadraticCurveTo(sg * r * 1.5, -r * 1.1, sg * r * 1.25, -r * 0.1);
			ctx.stroke();
		}
		ctx.fillStyle = '#ff3d00';
		ctx.beginPath();
		ctx.arc(-r * 0.32, -r * 0.15, r * 0.11, 0, TAU);
		ctx.arc(r * 0.32, -r * 0.15, r * 0.11, 0, TAU);
		ctx.fill();
		ctx.strokeStyle = '#ffd54f';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.arc(0, r * 0.62, r * 0.16, 0, TAU);
		ctx.stroke();
		ctx.restore();
	}

	drawGunner(ctx, x, y, r, color, now) {
		ctx.save();
		ctx.translate(x, y);
		ctx.fillStyle = '#78909c';
		ctx.strokeStyle = '#37474f';
		ctx.lineWidth = 2;
		[0.55, 0.85, 1.1, 0.85, 0.55].forEach((hgt, i) => {
			const px = (i - 2) * r * 0.36 - r * 0.13;
			ctx.beginPath();
			ctx.rect(px, -r * 0.5 - r * hgt, r * 0.26, r * hgt);
			ctx.fill();
			ctx.stroke();
		});
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(0, 0, r * 0.9, 0, TAU);
		ctx.fill();
		ctx.strokeStyle = '#eceff1';
		ctx.lineWidth = 3;
		ctx.stroke();
		ctx.fillStyle = '#212121';
		ctx.beginPath();
		ctx.ellipse(-r * 0.32, -r * 0.1, r * 0.2, r * 0.24, 0, 0, TAU);
		ctx.ellipse(r * 0.32, -r * 0.1, r * 0.2, r * 0.24, 0, 0, TAU);
		ctx.fill();
		const glow = r * 0.07 * (1 + 0.3 * Math.sin(now * 7));
		ctx.fillStyle = '#80deea';
		ctx.beginPath();
		ctx.arc(-r * 0.32, -r * 0.08, glow, 0, TAU);
		ctx.arc(r * 0.32, -r * 0.08, glow, 0, TAU);
		ctx.fill();
		ctx.fillStyle = '#212121';
		for (let i = -2; i <= 2; i++) ctx.fillRect(i * r * 0.14 - r * 0.04, r * 0.35, r * 0.08, r * 0.2);
		ctx.restore();
	}

	drawTwin(ctx, x, y, r, color, now, half) {
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(Math.sin(now * 1.3) * 0.25);
		ctx.fillStyle = 'rgba(38,166,154,0.18)';
		ctx.beginPath();
		ctx.arc(0, 0, r * 1.5, 0, TAU);
		ctx.fill();
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5);
		ctx.fill();
		ctx.fillStyle = half ? shade(color, 0.7) : '#263238';
		ctx.beginPath();
		ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
		ctx.fill();
		ctx.strokeStyle = '#e0f2f1';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(0, -r);
		for (let i = 1; i <= 6; i++) ctx.lineTo((i % 2 ? 1 : -1) * r * 0.12, -r + (i / 6) * r * 2);
		ctx.stroke();
		ctx.fillStyle = '#fff';
		ctx.beginPath();
		ctx.arc(-r * 0.42, -r * 0.15, r * 0.13, 0, TAU);
		ctx.fill();
		ctx.fillStyle = '#ff5252';
		ctx.beginPath();
		ctx.arc(r * 0.42, -r * 0.15, r * 0.13, 0, TAU);
		ctx.fill();
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(-r * 0.4, r * 0.3, r * 0.22, 0.2, Math.PI - 0.2);
		ctx.moveTo(r * 0.62, r * 0.45);
		ctx.arc(r * 0.4, r * 0.45, r * 0.22, 0, -Math.PI, true);
		ctx.stroke();
		ctx.restore();
	}

	drawLord(ctx, x, y, now) {
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
				if (!Array.isArray(wl)) continue;
				if (wl[0] === 'aurora') {
					const pos = game.playerPos(row[P.pid], this.tmp);
					if (pos) this.drawAurora(ctx, pos.x, pos.y, duoLevel('aurora', wl[1]).radius * (row[P.pid] === game.me ? game.areaMul() : 1), now);
					continue;
				}
				if (wl[0] === 'blizzard') {
					const pos = game.playerPos(row[P.pid], this.tmp);
					if (pos) this.drawBlizzard(ctx, pos.x, pos.y, EVOS.blizzard.levels[0].radius * (row[P.pid] === game.me ? game.areaMul() : 1), now);
					continue;
				}
				if (wl[0] === 'dome') {
					// Купол: the aura is wider while the shield holds a charge (server domeTick).
					const pos = game.playerPos(row[P.pid], this.tmp);
					if (!pos) continue;
					const L = duoLevel('dome', wl[1]);
					const charged = (row[P.ward] | 0) > 0;
					const r = L.radius * (charged ? L.chargeArea : 1) * (row[P.pid] === game.me ? game.areaMul() : 1);
					this.drawDome(ctx, pos.x, pos.y, r, charged, game.meta(row[P.pid]).color, now);
					continue;
				}
				if (wl[0] !== 'aura' && wl[0] !== 'tocsin') continue;
				// v20: an overclock (wl[3]) changes the radius the server hits with.
				const def = wl[0] === 'tocsin' ? EVOS.tocsin.levels[0] : weaponLevel('aura', Math.max(1, Math.min(5, wl[1] | 0)), wl[3] | 0);
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

	drawDome(ctx, x, y, r, charged, color, now) {
		ctx.fillStyle = charged ? '#ffe082' : color;
		ctx.globalAlpha = (charged ? 0.12 : 0.07) + Math.sin(now * 3) * 0.03;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, TAU);
		ctx.fill();
		ctx.globalAlpha = charged ? 0.6 : 0.3;
		ctx.strokeStyle = charged ? '#ffd54f' : color;
		ctx.lineWidth = charged ? 3 : 2;
		if (!charged) ctx.setLineDash([8, 10]);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
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
				if (!Array.isArray(wl)) continue;
				if (wl[0] === 'millstones' || wl[0] === 'moonblade') {
					const pos = game.playerPos(row[P.pid], this.tmp);
					if (!pos) continue;
					const area = row[P.pid] === game.me ? game.areaMul() : 1;
					if (wl[0] === 'millstones') this.drawMillstones(ctx, pos.x, pos.y, EVOS.millstones.levels[0], area, tm);
					else this.drawMoonblades(ctx, pos.x, pos.y, EVOS.moonblade.levels[0], area, tm, performance.now() / 1000);
					ctx.fillStyle = '#e3f2fd';
					ctx.strokeStyle = 'rgba(144,202,249,0.9)';
					ctx.lineWidth = 2;
					continue;
				}
				if (wl[0] === 'firewheel' || wl[0] === 'beacon') {
					const pos = game.playerPos(row[P.pid], this.tmp);
					if (!pos) continue;
					const area = row[P.pid] === game.me ? game.areaMul() : 1;
					if (wl[0] === 'firewheel') {
						const L = duoLevel('firewheel', wl[1]);
						this.drawFirewheels(ctx, pos.x, pos.y, L, L.count + Math.max(0, wl[2] | 0), area, tm);
					} else this.drawBeacon(ctx, pos.x, pos.y, EVOS.beacon.levels[0], area, tm, row[P.pid]);
					ctx.fillStyle = '#e3f2fd';
					ctx.strokeStyle = 'rgba(144,202,249,0.9)';
					ctx.lineWidth = 2;
					continue;
				}
				if (wl[0] === 'windmill' || wl[0] === 'orrery') {
					const pos = game.playerPos(row[P.pid], this.tmp);
					if (!pos) continue;
					const area = row[P.pid] === game.me ? game.areaMul() : 1;
					const L = duoLevel(wl[0], wl[1]);
					const count = L.count + Math.max(0, wl[2] | 0);
					if (wl[0] === 'windmill') this.drawWindmill(ctx, pos.x, pos.y, L, count, area, tm, game.meta(row[P.pid]).color);
					else this.drawOrrery(ctx, pos.x, pos.y, L, count, area, tm, wl[3] === undefined ? -1 : wl[3] | 0);
					ctx.fillStyle = '#e3f2fd';
					ctx.strokeStyle = 'rgba(144,202,249,0.9)';
					ctx.lineWidth = 2;
					continue;
				}
				if (wl[0] !== 'orbit') continue;
				const lv = weaponLevel('orbit', Math.max(1, Math.min(5, wl[1] | 0)), wl[3] | 0); // v20: overclocks change radius and speed
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
		// v20 «Шаровая молния»: a big crackling ball under the usual spark.
		for (const s of shots) {
			if (!s.big) continue;
			const g = ctx.createRadialGradient(s.x, s.y, 2, s.x, s.y, 26);
			g.addColorStop(0, 'rgba(255,255,255,0.95)');
			g.addColorStop(0.45, 'rgba(206,147,216,0.75)');
			g.addColorStop(1, 'rgba(126,87,194,0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(s.x, s.y, 26, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = 'rgba(225,190,231,0.9)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			for (let k = 0; k < 4; k++) {
				const a = now * 9 + k * 1.57 + s.st * 3;
				ctx.moveTo(s.x + Math.cos(a) * 6, s.y + Math.sin(a) * 6);
				ctx.lineTo(s.x + Math.cos(a + 0.5) * 17, s.y + Math.sin(a + 0.5) * 17);
			}
			ctx.stroke();
		}
		if (this.drawShotSprites(ctx, shots, now)) return;
		this.drawSickles(ctx, shots, now);
		this.drawIceDiscs(ctx, shots, now);
		this.drawSpears(ctx, shots);
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

	// Sprite at x,y rotated by ang around its anchor; resets to the world transform afterwards via endRot().
	rotBlit(ctx, s, f, x, y, ang, scale) {
		const k = this.k, c = Math.cos(ang) * k, n = Math.sin(ang) * k;
		ctx.setTransform(c, n, -n, c, this.ox + k * x, this.oy + k * y);
		ctx.drawImage(s.img, f * s.cw, 0, s.cw, s.ch, -s.ax * scale, -s.ay * scale, s.cw * scale, s.ch * scale);
	}

	endRot(ctx) {
		ctx.setTransform(this.k, 0, 0, this.k, this.ox, this.oy);
	}

	drawShotSprites(ctx, shots, now) {
		const sp = this.sprites;
		if (!sp.ready) return false;
		const sheets = PROJECTILE_KINDS.map((k) => sp.get(k));
		if (sheets.some((x) => !x)) return false;
		// Motion trails keep fast projectiles readable.
		ctx.lineCap = 'round';
		for (const [kind, color, len, width] of [[0, 'rgba(206,147,216,0.45)', 26, 6], [1, 'rgba(236,239,241,0.35)', 22, 3], [SPEAR_K, 'rgba(255,224,178,0.35)', 60, 7]]) {
			ctx.strokeStyle = color;
			ctx.lineWidth = width;
			ctx.beginPath();
			for (const s of shots) {
				if (s.kind !== kind) continue;
				const v = Math.hypot(s.vx, s.vy) || 1;
				ctx.moveTo(s.x - s.vx / v * len, s.y - s.vy / v * len);
				ctx.lineTo(s.x, s.y);
			}
			ctx.stroke();
		}
		ctx.lineCap = 'butt';
		for (const s of shots) {
			const sh = sheets[s.kind];
			if (!sh) continue;
			const id = PROJECTILE_KINDS[s.kind];
			const ang = s.kind === SICKLE_K ? now * 16 + s.st * 7 : s.kind === ICEDISC_K ? now * 14 + s.st * 5 : Math.atan2(s.vy, s.vx);
			this.rotBlit(ctx, sh, walkFrame(sh, now, (s.st * 997) | 0), s.x, s.y, ang, PROJ_ART[id] ?? 1);
		}
		this.endRot(ctx);
		return true;
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
		for (const l of game.blines) {
			const k = Math.min(1, l.t / l.life);
			const dx = l.x2 - l.x1, dy = l.y2 - l.y1, len = Math.hypot(dx, dy) || 1;
			ctx.save();
			ctx.translate(l.x1, l.y1);
			ctx.rotate(Math.atan2(dy, dx));
			ctx.fillStyle = `rgba(239,83,80,${0.12 + 0.2 * k})`;
			ctx.fillRect(0, -l.w / 2, len, l.w);
			ctx.fillStyle = 'rgba(255,82,82,0.35)';
			ctx.fillRect(0, -l.w / 2, len * k, l.w);
			ctx.strokeStyle = 'rgba(255,82,82,0.9)';
			ctx.lineWidth = 2;
			ctx.setLineDash([10, 6]);
			ctx.lineDashOffset = -now * 60;
			ctx.strokeRect(0, -l.w / 2, len, l.w);
			ctx.setLineDash([]);
			ctx.restore();
		}
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

	// Traps [id, x, y, kind, pid]: 0 trap, 1 mine, 2 mine recharging, 3 knife spike; Растяжка links its traps with threads.
	drawTraps(ctx, snap, now) {
		const t = snap.tr;
		if (!t.length) return;
		this.drawWires(ctx, snap, now);
		for (let i = 0; i + TR_STRIDE <= t.length; i += TR_STRIDE) {
			const x = t[i + 1], y = t[i + 2], kind = t[i + 3] | 0;
			if (!this.visible(x, y)) continue;
			if (kind === 4) {
				// Wolf pit: dark hole ringed with stakes.
				ctx.fillStyle = 'rgba(33,20,12,0.85)';
				ctx.beginPath();
				ctx.ellipse(x, y, 15, 9, 0, 0, TAU);
				ctx.fill();
				ctx.strokeStyle = '#a1887f';
				ctx.lineWidth = 2;
				ctx.beginPath();
				for (let k = 0; k < 8; k++) {
					const a = (k / 8) * TAU;
					ctx.moveTo(x + Math.cos(a) * 15, y + Math.sin(a) * 9);
					ctx.lineTo(x + Math.cos(a) * 21, y + Math.sin(a) * 13 - 5);
				}
				ctx.stroke();
				continue;
			}
			if (kind === 1 || kind === 2) {
				this.drawMine(ctx, x, y, kind === 1, now, t[i]);
				continue;
			}
			if (kind === 3) {
				ctx.fillStyle = '#cfd8dc';
				ctx.strokeStyle = '#455a64';
				ctx.lineWidth = 1;
				ctx.beginPath();
				for (let k = 0; k < 3; k++) {
					const sx = x + (k - 1) * 5;
					ctx.moveTo(sx - 2.5, y + 4);
					ctx.lineTo(sx, y - 7);
					ctx.lineTo(sx + 2.5, y + 4);
					ctx.closePath();
				}
				ctx.fill();
				ctx.stroke();
				continue;
			}
			ctx.fillStyle = 'rgba(0,0,0,0.3)';
			ctx.beginPath();
			ctx.ellipse(x, y + 3, 15, 6, 0, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = '#90a4ae';
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.ellipse(x, y, 13, 8, 0, 0, TAU);
			ctx.stroke();
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

	drawWires(ctx, snap, now) {
		const t = snap.tr;
		const owners = new Map(); // pid -> link length, for players with Растяжка
		for (const row of snap.p) {
			const wl = Array.isArray(row[P.w]) ? row[P.w].find((w) => Array.isArray(w) && w[0] === 'tripwire') : null;
			if (wl) owners.set(row[P.pid], duoLevel('tripwire', wl[1]).link);
		}
		if (!owners.size) return;
		const segs = [];
		for (let i = 0; i + TR_STRIDE <= t.length; i += TR_STRIDE) {
			const link = owners.get(t[i + 4]);
			if (!link || t[i + 3] !== 0) continue;
			for (let j = i + TR_STRIDE; j + TR_STRIDE <= t.length; j += TR_STRIDE) {
				if (t[j + 4] !== t[i + 4] || t[j + 3] !== 0) continue;
				const dx = t[j + 1] - t[i + 1], dy = t[j + 2] - t[i + 2];
				if (dx * dx + dy * dy > link * link) continue;
				segs.push(t[i + 1], t[i + 2], t[j + 1], t[j + 2]);
			}
		}
		if (!segs.length) return;
		// Glow, then a bright core, then a glint running along every thread.
		for (const [w, c] of [[6, 'rgba(255,224,178,0.18)'], [2.2, `rgba(255,243,224,${0.75 + 0.2 * Math.sin(now * 8)})`]]) {
			ctx.strokeStyle = c;
			ctx.lineWidth = w;
			ctx.beginPath();
			for (let k = 0; k < segs.length; k += 4) {
				ctx.moveTo(segs[k], segs[k + 1]);
				ctx.lineTo(segs[k + 2], segs[k + 3]);
			}
			ctx.stroke();
		}
		ctx.fillStyle = '#fff8e1';
		ctx.beginPath();
		for (let k = 0; k < segs.length; k += 4) {
			const f = (now * 0.9 + k * 0.13) % 1;
			const x = segs[k] + (segs[k + 2] - segs[k]) * f, y = segs[k + 1] + (segs[k + 3] - segs[k + 1]) * f;
			ctx.moveTo(x + 2.5, y);
			ctx.arc(x, y, 2.5, 0, TAU);
		}
		ctx.fill();
	}

	drawMine(ctx, x, y, armed, now, id) {
		ctx.fillStyle = 'rgba(0,0,0,0.3)';
		ctx.beginPath();
		ctx.ellipse(x, y + 4, 13, 5, 0, 0, TAU);
		ctx.fill();
		ctx.fillStyle = armed ? '#5d4037' : '#3e2723';
		ctx.strokeStyle = armed ? '#ffab40' : '#6d4c41';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(x, y - 11);
		ctx.lineTo(x + 11, y);
		ctx.lineTo(x, y + 11);
		ctx.lineTo(x - 11, y);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		const blink = armed && Math.sin(now * 8 + id) > 0;
		ctx.fillStyle = blink ? '#ff5252' : armed ? '#b71c1c' : '#424242';
		ctx.beginPath();
		ctx.arc(x, y, 3, 0, TAU);
		ctx.fill();
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
			// 0 petard, 1 molotov bottle, 2 ice grenade.
			ctx.fillStyle = ['#e53935', '#7cb342', '#4fc3f7', '#ec407a'][l.kind] || '#e53935';
			ctx.fillRect(-4, -8, 8, 16);
			ctx.fillStyle = ['#ffeb3b', '#ff7043', '#e1f5fe', '#fff59d'][l.kind] || '#ffeb3b';
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
		this.drawOrbShots(ctx, game, now);
		const sh = this.sprites.ready ? this.sprites.get('hostile') : null;
		if (sh) {
			ctx.fillStyle = 'rgba(0,0,0,0.35)';
			ctx.beginPath();
			for (const s of game.hostile.values()) {
				if (!s.show || s.r || !this.visible(s.x, s.y)) continue;
				ctx.moveTo(s.x + 7, s.y + 12);
				ctx.ellipse(s.x, s.y + 12, 7, 3, 0, 0, TAU);
			}
			ctx.fill();
			// Glow keeps enemy shots readable on the dark ground.
			const gr = 12 + Math.sin(now * 20) * 1.5;
			ctx.fillStyle = 'rgba(178,255,89,0.3)';
			ctx.beginPath();
			for (const s of game.hostile.values()) {
				if (!s.show || s.r || !this.visible(s.x, s.y)) continue;
				ctx.moveTo(s.x + gr, s.y);
				ctx.arc(s.x, s.y, gr, 0, TAU);
			}
			ctx.fill();
			for (const s of game.hostile.values()) {
				if (!s.show || s.r || !this.visible(s.x, s.y)) continue;
				this.rotBlit(ctx, sh, walkFrame(sh, now, (s.st * 997) | 0), s.x, s.y, Math.atan2(s.vy, s.vx), PROJ_ART.hostile);
			}
			this.endRot(ctx);
			return;
		}
		for (const s of game.hostile.values()) {
			if (!s.show || s.r || !this.visible(s.x, s.y)) continue;
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

	// Sniper orbs: big slow teal balls with a dark core and a trail, readable at a glance and easy to sidestep.
	drawOrbShots(ctx, game, now) {
		for (const s of game.hostile.values()) {
			if (!s.r || !s.show || !this.visible(s.x, s.y)) continue;
			const v = Math.hypot(s.vx, s.vy) || 1, cx = s.vx / v, cy = s.vy / v, r = s.r;
			ctx.fillStyle = 'rgba(0,0,0,0.35)';
			ctx.beginPath();
			ctx.ellipse(s.x, s.y + r + 6, r, r * 0.35, 0, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = 'rgba(100,255,218,0.3)';
			ctx.lineWidth = r * 1.4;
			ctx.lineCap = 'round';
			ctx.beginPath();
			ctx.moveTo(s.x - cx * r * 3, s.y - cy * r * 3);
			ctx.lineTo(s.x, s.y);
			ctx.stroke();
			ctx.lineCap = 'butt';
			ctx.fillStyle = `rgba(100,255,218,${0.25 + Math.sin(now * 14) * 0.08})`;
			ctx.beginPath();
			ctx.arc(s.x, s.y, r * 1.7, 0, TAU);
			ctx.fill();
			ctx.fillStyle = '#1de9b6';
			ctx.strokeStyle = '#004d40';
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.arc(s.x, s.y, r, 0, TAU);
			ctx.fill();
			ctx.stroke();
			ctx.fillStyle = '#e0f2f1';
			ctx.beginPath();
			ctx.arc(s.x - r * 0.3, s.y - r * 0.35, r * 0.3, 0, TAU);
			ctx.fill();
		}
	}

	// Wave 4 events on the ground: red fog, the altar, the cursed chest and its hold ring, the star countdown.
	drawEventGround(ctx, game, now) {
		const ev = game.event();
		if (!ev) return;
		const { x, y, r } = ev;
		ctx.save();
		switch (ev.def.id) {
			case 'fog': {
				const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
				g.addColorStop(0, 'rgba(198,40,40,0.26)');
				g.addColorStop(0.8, 'rgba(183,28,28,0.2)');
				g.addColorStop(1, 'rgba(183,28,28,0)');
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.arc(x, y, r, 0, TAU);
				ctx.fill();
				ctx.strokeStyle = 'rgba(255,82,82,0.55)';
				ctx.lineWidth = 3;
				ctx.setLineDash([18, 12]);
				ctx.lineDashOffset = now * 20;
				ctx.beginPath();
				ctx.arc(x, y, r, 0, TAU);
				ctx.stroke();
				break;
			}
			case 'altar': {
				const p = 1 + Math.sin(now * 3) * 0.08;
				ctx.fillStyle = 'rgba(123,31,162,0.25)';
				ctx.beginPath();
				ctx.arc(x, y, r * 1.8 * p, 0, TAU);
				ctx.fill();
				ctx.fillStyle = '#424242';
				ctx.strokeStyle = '#ce93d8';
				ctx.lineWidth = 2;
				ctx.beginPath();
				ctx.ellipse(x, y + 4, r, r * 0.55, 0, 0, TAU);
				ctx.fill();
				ctx.stroke();
				ctx.fillStyle = '#616161';
				ctx.fillRect(x - 10, y - 22, 20, 24);
				ctx.strokeRect(x - 10, y - 22, 20, 24);
				ctx.fillStyle = `rgba(234,128,252,${0.7 + Math.sin(now * 6) * 0.3})`;
				ctx.beginPath();
				ctx.arc(x, y - 28, 6, 0, TAU);
				ctx.fill();
				this.eventLabel(ctx, x, y - 44, 'Алтарь', '#e1bee7');
				break;
			}
			case 'cursed':
				if (ev.phase === 0) {
					ctx.fillStyle = `rgba(74,20,140,${0.35 + Math.sin(now * 4) * 0.1})`;
					ctx.beginPath();
					ctx.arc(x, y, 34, 0, TAU);
					ctx.fill();
					drawItem(ctx, 'chest', x, y, now);
					ctx.strokeStyle = '#b388ff';
					ctx.lineWidth = 2;
					ctx.beginPath();
					ctx.arc(x, y, 22, 0, TAU);
					ctx.stroke();
					this.eventLabel(ctx, x, y - 30, 'Проклятый сундук', '#d1c4e9');
				} else {
					ctx.strokeStyle = 'rgba(179,136,255,0.6)';
					ctx.lineWidth = 3;
					ctx.setLineDash([10, 10]);
					ctx.lineDashOffset = -now * 30;
					ctx.beginPath();
					ctx.arc(x, y, r, 0, TAU);
					ctx.stroke();
				}
				break;
			case 'star':
				if (ev.phase === 0) this.eventLabel(ctx, x, y, String(Math.ceil(ev.left)), '#fff59d', 28);
				break;
		}
		ctx.restore();
	}

	// The falling star: a bright head with a tail coming down onto the marked circle.
	drawEventSky(ctx, game, now) {
		const ev = game.event();
		if (!ev || ev.def.id !== 'star' || ev.phase !== 0) return;
		const k = Math.max(0, Math.min(1, ev.left / ev.def.warn));
		const sx = ev.x + k * 260, sy = ev.y - k * 520;
		ctx.save();
		ctx.strokeStyle = 'rgba(255,241,118,0.45)';
		ctx.lineWidth = 10;
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(sx + 70, sy - 140);
		ctx.lineTo(sx, sy);
		ctx.stroke();
		ctx.fillStyle = '#fffde7';
		ctx.beginPath();
		for (let i = 0; i < 10; i++) {
			const a = (i / 10) * TAU + now * 2, rr = i % 2 ? 7 : 16;
			ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
		}
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}

	eventLabel(ctx, x, y, text, color, size = 12) {
		ctx.font = `800 ${size}px system-ui, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.lineWidth = 3;
		ctx.strokeStyle = 'rgba(0,0,0,0.85)';
		ctx.strokeText(text, x, y);
		ctx.fillStyle = color;
		ctx.fillText(text, x, y);
	}

	// Громовой разрез: a two-sided crescent with an electric rim; every 3rd swing a ring of lightning.
	drawThunder(ctx, game, now) {
		if (!game.tslashes.length && !game.fans.length) return;
		ctx.save();
		ctx.lineJoin = 'round';
		for (const s of game.tslashes) {
			const p = game.playerPos(s.pid, this.tmp);
			if (!p) continue;
			const k = s.t / 0.32;
			const fade = 1 - k;
			const grow = 0.75 + 0.25 * Math.min(1, k * 4);
			for (const dir of [1, -1]) {
				const rx = (s.range / 2 + 8) * grow, ry = (s.width / 2 + 6) * grow;
				const cx = p.x + dir * rx;
				const a0 = dir > 0 ? -Math.PI / 2 : Math.PI / 2, a1 = dir > 0 ? Math.PI / 2 : Math.PI * 1.5;
				// Body: white at the hero, ice-blue at the tip.
				const g = ctx.createLinearGradient(p.x, p.y, p.x + dir * rx * 2, p.y);
				g.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`);
				g.addColorStop(1, `rgba(64,196,255,${0.75 * fade})`);
				ctx.fillStyle = g;
				ctx.shadowColor = '#40c4ff';
				ctx.shadowBlur = s.big ? 26 : 16;
				ctx.beginPath();
				ctx.ellipse(cx, p.y, rx, ry, 0, a0, a1);
				ctx.ellipse(cx - dir * rx * 0.35, p.y + ry * 0.15, rx * 0.8, ry * 0.62, 0, a1, a0, true);
				ctx.fill();
				ctx.shadowBlur = 0;
				// Electric rim: jagged line along the outer arc, new every frame so it crackles.
				const pts = [];
				const n = 14;
				for (let i = 0; i <= n; i++) {
					const a = a0 + ((a1 - a0) * i) / n;
					const j = i === 0 || i === n ? 0 : (Math.random() - 0.5) * 9;
					pts.push(cx + Math.cos(a) * (rx + j), p.y + Math.sin(a) * (ry + j));
				}
				for (const [w, c] of [[s.big ? 9 : 6, `rgba(128,216,255,${0.55 * fade})`], [2, `rgba(255,255,255,${fade})`]]) {
					ctx.strokeStyle = c;
					ctx.lineWidth = w;
					ctx.beginPath();
					ctx.moveTo(pts[0], pts[1]);
					for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
					ctx.stroke();
				}
			}
			// Sparks spraying from the hero.
			ctx.fillStyle = `rgba(225,245,254,${fade})`;
			ctx.beginPath();
			for (let i = 0; i < 8; i++) {
				const a = s.seed + i * 0.785;
				const d = 20 + k * s.range * 0.9;
				const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d * 0.6;
				ctx.moveTo(x + 2, y);
				ctx.arc(x, y, 2, 0, TAU);
			}
			ctx.fill();
			if (s.big) {
				const fr = s.range * 0.6 * grow;
				const flash = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, fr);
				flash.addColorStop(0, `rgba(255,255,255,${0.7 * fade})`);
				flash.addColorStop(0.4, `rgba(128,216,255,${0.35 * fade})`);
				flash.addColorStop(1, 'rgba(64,196,255,0)');
				ctx.fillStyle = flash;
				ctx.beginPath();
				ctx.arc(p.x, p.y, fr, 0, TAU);
				ctx.fill();
			}
		}
		for (const f of game.fans) {
			const p = game.playerPos(f.pid, this.tmp);
			if (!p) continue;
			const k = f.t / 0.45;
			const r = f.r * (0.35 + 0.65 * Math.min(1, k * 1.6));
			const pts = [];
			const n = 36;
			for (let i = 0; i <= n; i++) {
				const a = (i / n) * TAU;
				const j = (Math.random() - 0.5) * 16;
				pts.push(p.x + Math.cos(a) * (r + j), p.y + Math.sin(a) * (r + j));
			}
			for (const [w, c] of [[10, `rgba(64,196,255,${0.4 * (1 - k)})`], [2.5, `rgba(255,255,255,${1 - k})`]]) {
				ctx.strokeStyle = c;
				ctx.lineWidth = w;
				ctx.beginPath();
				ctx.moveTo(pts[0], pts[1]);
				for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
				ctx.stroke();
			}
		}
		ctx.restore();
	}

	// Шаровая молния: glowing ball with flickering arcs.
	drawOrbs(ctx, game, now) {
		if (!game.orbs.size) return;
		for (const o of game.orbs.values()) {
			if (!o.show || !this.visible(o.x, o.y)) continue;
			ctx.fillStyle = 'rgba(128,216,255,0.08)';
			ctx.beginPath();
			ctx.arc(o.x, o.y, o.r, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = 'rgba(128,216,255,0.35)';
			ctx.setLineDash([4, 8]);
			ctx.lineDashOffset = -now * 40;
			ctx.lineWidth = 1.5;
			ctx.stroke();
			ctx.setLineDash([]);
			const g = ctx.createRadialGradient(o.x, o.y, 2, o.x, o.y, 22);
			g.addColorStop(0, '#ffffff');
			g.addColorStop(0.4, 'rgba(179,229,252,0.9)');
			g.addColorStop(1, 'rgba(64,196,255,0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(o.x, o.y, 22 + Math.sin(now * 20) * 2, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = 'rgba(255,255,255,0.9)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			for (let i = 0; i < 4; i++) {
				const a = now * 9 + i * 1.57 + Math.random() * 0.6;
				let x = o.x, y = o.y;
				ctx.moveTo(x, y);
				for (let s = 1; s <= 3; s++) {
					x = o.x + Math.cos(a) * s * 9 + (Math.random() - 0.5) * 6;
					y = o.y + Math.sin(a) * s * 9 + (Math.random() - 0.5) * 6;
					ctx.lineTo(x, y);
				}
			}
			ctx.stroke();
		}
	}

	// Полярное сияние: shimmering green-violet ring of light.
	drawAurora(ctx, x, y, r, now) {
		const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
		g.addColorStop(0, 'rgba(105,240,174,0.03)');
		g.addColorStop(0.75, `rgba(105,240,174,${0.12 + Math.sin(now * 2) * 0.04})`);
		g.addColorStop(1, 'rgba(179,136,255,0.22)');
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, TAU);
		ctx.fill();
		ctx.lineWidth = 3;
		for (let band = 0; band < 2; band++) {
			ctx.strokeStyle = band ? 'rgba(179,136,255,0.45)' : 'rgba(105,240,174,0.5)';
			ctx.beginPath();
			for (let i = 0; i <= 48; i++) {
				const a = (i / 48) * TAU;
				const rr = r * (0.92 + 0.05 * Math.sin(a * 5 + now * (band ? -2 : 2.6)));
				if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
				else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
			}
			ctx.stroke();
		}
	}

	// Мельница: long translucent blades with a motion trail.
	drawWindmill(ctx, px, py, L, count, area, tm, color) {
		const len = L.len * area, w = L.width * area;
		for (let i = 0; i < count; i++) {
			const a = orbitAngle(tm, L.rps, i, count);
			for (let tr = 3; tr >= 0; tr--) {
				const aa = a - tr * 0.07;
				const c = Math.cos(aa), s = Math.sin(aa);
				ctx.fillStyle = tr ? `rgba(227,242,253,${0.08 * (4 - tr)})` : 'rgba(236,239,241,0.55)';
				ctx.beginPath();
				ctx.moveTo(px + c * 16 - s * w * 0.3, py + s * 16 + c * w * 0.3);
				ctx.lineTo(px + c * len - s * w * 0.5, py + s * len + c * w * 0.5);
				ctx.lineTo(px + c * (len + 10), py + s * (len + 10));
				ctx.lineTo(px + c * len + s * w * 0.5, py + s * len - c * w * 0.5);
				ctx.lineTo(px + c * 16 + s * w * 0.3, py + s * 16 - c * w * 0.3);
				ctx.closePath();
				ctx.fill();
			}
			ctx.strokeStyle = color;
			ctx.lineWidth = 1.5;
			ctx.stroke();
		}
		ctx.fillStyle = '#90a4ae';
		ctx.beginPath();
		ctx.arc(px, py, 6, 0, TAU);
		ctx.fill();
	}

	// Планетарий: sparks on an orbit; those that flew off (mask bit 0) are missing until they respawn.
	drawOrrery(ctx, px, py, L, count, area, tm, mask) {
		const R = L.radius * area;
		ctx.strokeStyle = 'rgba(206,147,216,0.25)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(px, py, R, 0, TAU);
		ctx.stroke();
		for (let i = 0; i < count; i++) {
			if (mask >= 0 && i < 30 && !(mask & (1 << i))) continue;
			const a = orbitAngle(tm, L.rps, i, count);
			const x = px + Math.cos(a) * R, y = py + Math.sin(a) * R;
			ctx.fillStyle = 'rgba(206,147,216,0.4)';
			ctx.beginPath();
			ctx.arc(x, y, 9, 0, TAU);
			ctx.fill();
			ctx.fillStyle = '#f8eefa';
			ctx.beginPath();
			ctx.arc(x, y, 4, 0, TAU);
			ctx.fill();
		}
	}

	// Ледяной диск: spinning blue disc with frost teeth.
	drawIceDiscs(ctx, shots, now) {
		for (const s of shots) {
			if (s.kind !== ICEDISC_K) continue;
			ctx.save();
			ctx.translate(s.x, s.y);
			ctx.rotate(now * 14 + s.st * 5);
			ctx.fillStyle = 'rgba(129,212,250,0.3)';
			ctx.beginPath();
			ctx.arc(0, 0, 18, 0, TAU);
			ctx.fill();
			ctx.fillStyle = '#b3e5fc';
			ctx.strokeStyle = '#0277bd';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			for (let i = 0; i < 12; i++) {
				const a = (i / 12) * TAU, r = i % 2 ? 9 : 14;
				if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
				else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
			}
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}
	}

	drawIceTrail(ctx, game) {
		if (!game.iceTrail.length) return;
		for (const p of game.iceTrail) {
			if (!this.visible(p.x, p.y)) continue;
			const k = p.t / 2.5;
			ctx.fillStyle = `rgba(179,229,252,${0.12 * (1 - k)})`;
			ctx.beginPath();
			ctx.ellipse(p.x, p.y, 22, 15, p.seed, 0, TAU);
			ctx.fill();
			// A couple of frost glints per patch.
			ctx.fillStyle = `rgba(225,245,254,${0.6 * (1 - k)})`;
			ctx.fillRect(p.x + Math.cos(p.seed) * 9 - 1, p.y + Math.sin(p.seed) * 6 - 1, 2.5, 2.5);
			ctx.fillRect(p.x - Math.cos(p.seed) * 7 - 1, p.y - Math.sin(p.seed * 2) * 5 - 1, 2, 2);
		}
	}

	// Lantern: a warm cone of light toward the densest group.
	drawCones(ctx, game) {
		for (const c of game.cones) {
			const p = game.playerPos(c.pid, this.tmp);
			if (!p) continue;
			const k = c.t / 0.45;
			const storm = this.hasWeapon(game, c.pid, 'stormlight');
			const fire = !storm && this.hasWeapon(game, c.pid, 'glow'); // Зарево: a red-hot cone
			const g = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, c.range);
			g.addColorStop(0, storm ? `rgba(179,229,252,${0.4 * (1 - k)})` : fire ? `rgba(255,171,64,${0.4 * (1 - k)})` : `rgba(255,236,179,${0.35 * (1 - k)})`);
			g.addColorStop(1, storm ? 'rgba(128,216,255,0)' : fire ? 'rgba(244,81,30,0)' : 'rgba(255,213,79,0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.moveTo(p.x, p.y);
			ctx.arc(p.x, p.y, c.range, c.a - c.half, c.a + c.half);
			ctx.closePath();
			ctx.fill();
		}
	}

	hasWeapon(game, pid, id) {
		const row = game.view.b?.p.find((r) => r[P.pid] === pid);
		return !!row && Array.isArray(row[P.w]) && row[P.w].some((wl) => Array.isArray(wl) && wl[0] === id);
	}

	// Огненное колесо: burning wheels with spokes on the orbit, plus a faint fire ring.
	drawFirewheels(ctx, px, py, L, count, area, tm) {
		const R = L.radius * area;
		ctx.strokeStyle = 'rgba(255,112,67,0.18)';
		ctx.lineWidth = 10;
		ctx.beginPath();
		ctx.arc(px, py, R, 0, TAU);
		ctx.stroke();
		for (let i = 0; i < count; i++) {
			const a = orbitAngle(tm, L.rps, i, count);
			const x = px + Math.cos(a) * R, y = py + Math.sin(a) * R;
			const g = ctx.createRadialGradient(x, y, 2, x, y, 18);
			g.addColorStop(0, 'rgba(255,241,118,0.95)');
			g.addColorStop(0.5, 'rgba(255,145,0,0.75)');
			g.addColorStop(1, 'rgba(255,61,0,0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(x, y, 18, 0, TAU);
			ctx.fill();
			ctx.strokeStyle = '#ffccbc';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(x, y, 9, 0, TAU);
			for (let k = 0; k < 3; k++) {
				const sa = tm * 9 + (k * TAU) / 3;
				ctx.moveTo(x, y);
				ctx.lineTo(x + Math.cos(sa) * 9, y + Math.sin(sa) * 9);
			}
			ctx.stroke();
		}
	}

	// Маяк: light beams rotating around the hero (same angle formula as the server).
	drawBeacon(ctx, px, py, L, area, tm, pid) {
		const range = L.range * area, half = (L.half * Math.PI) / 180;
		for (let b = 0; b < L.beams; b++) {
			const a = beaconAngle(tm, pid, L.rps) + (b * TAU) / L.beams;
			const g = ctx.createRadialGradient(px, py, 8, px, py, range);
			g.addColorStop(0, 'rgba(255,248,225,0.55)');
			g.addColorStop(1, 'rgba(255,213,79,0)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.moveTo(px, py);
			ctx.arc(px, py, range, a - half, a + half);
			ctx.closePath();
			ctx.fill();
		}
		ctx.fillStyle = '#fff8e1';
		ctx.beginPath();
		ctx.arc(px, py - 26, 4, 0, TAU);
		ctx.fill();
	}

	// Steam clouds from the «Пар» reaction.
	drawSteams(ctx, game, now) {
		if (!game.steams.length) return;
		for (const c of game.steams) {
			const k = c.t / c.life;
			ctx.fillStyle = `rgba(236,239,241,${0.22 * (1 - k)})`;
			ctx.beginPath();
			for (let i = 0; i < 4; i++) {
				const a = i * 1.6 + now * 0.5, rr = c.r * (0.45 + 0.1 * Math.sin(now * 2 + i));
				const cx = c.x + Math.cos(a) * c.r * 0.35, cy = c.y + Math.sin(a) * c.r * 0.25 - k * 10;
				ctx.moveTo(cx + rr, cy);
				ctx.arc(cx, cy, rr, 0, TAU);
			}
			ctx.fill();
		}
	}

	// Знамя: a pole with a red flag and the buff radius.
	drawBanners(ctx, game, now) {
		for (const b of game.banners) {
			const k = b.t / b.life;
			ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
			ctx.strokeStyle = 'rgba(239,83,80,0.35)';
			ctx.lineWidth = 2;
			ctx.setLineDash([10, 8]);
			ctx.lineDashOffset = -now * 20;
			ctx.beginPath();
			ctx.arc(b.x, b.y, b.r, 0, TAU);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = 'rgba(239,83,80,0.06)';
			ctx.fill();
			ctx.strokeStyle = '#5d4037';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.moveTo(b.x, b.y + 6);
			ctx.lineTo(b.x, b.y - 46);
			ctx.stroke();
			const wave = Math.sin(now * 6) * 3;
			ctx.fillStyle = '#e53935';
			ctx.beginPath();
			ctx.moveTo(b.x, b.y - 46);
			ctx.quadraticCurveTo(b.x + 14, b.y - 44 + wave, b.x + 28, b.y - 40);
			ctx.lineTo(b.x + 26, b.y - 28 + wave);
			ctx.quadraticCurveTo(b.x + 12, b.y - 30 - wave, b.x, b.y - 28);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = '#ffd54f';
			ctx.beginPath();
			ctx.arc(b.x + 13, b.y - 36, 3, 0, TAU);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
	}

	// Reactions: each has its own shape and colour, plus a short caption over the spot.
	drawReactions(ctx, game) {
		for (const e of game.reacts) {
			const k = e.t / 0.5, a = 1 - k;
			const color = REACTIONS[e.kind]?.color ?? '#fff';
			ctx.globalAlpha = a;
			switch (e.kind) {
				case 'cond': {
					// Blue broken arcs across the puddle.
					ctx.strokeStyle = color;
					ctx.lineWidth = 2;
					ctx.beginPath();
					for (let i = 0; i < 5; i++) {
						const a0 = e.seed + i * 1.3, r = e.r * 0.9;
						let x = e.x + Math.cos(a0) * r * 0.2, y = e.y + Math.sin(a0) * r * 0.15;
						ctx.moveTo(x, y);
						for (let j = 1; j <= 4; j++) {
							x = e.x + Math.cos(a0 + j * 0.25) * r * (0.2 + j * 0.2) + Math.sin(e.seed * j + i) * 6;
							y = e.y + Math.sin(a0 + j * 0.25) * r * 0.8 * (0.2 + j * 0.2) + Math.cos(e.seed * j + i) * 6;
							ctx.lineTo(x, y);
						}
					}
					ctx.stroke();
					ctx.strokeStyle = 'rgba(179,229,252,0.6)';
					ctx.beginPath();
					ctx.ellipse(e.x, e.y, e.r, e.r * 0.8, 0, 0, TAU);
					ctx.stroke();
					break;
				}
				case 'flash': {
					const r = e.r * (0.4 + 0.8 * k);
					ctx.fillStyle = 'rgba(255,152,0,0.35)';
					ctx.beginPath();
					ctx.arc(e.x, e.y, r, 0, TAU);
					ctx.fill();
					ctx.strokeStyle = color;
					ctx.lineWidth = 4 * a + 1;
					ctx.stroke();
					break;
				}
				case 'shatter': {
					// Six triangular shards flying out.
					ctx.fillStyle = color;
					ctx.beginPath();
					for (let i = 0; i < 6; i++) {
						const ang = e.seed + (i * TAU) / 6, d = 6 + e.r * k;
						const x = e.x + Math.cos(ang) * d, y = e.y + Math.sin(ang) * d;
						ctx.moveTo(x + Math.cos(ang) * 7, y + Math.sin(ang) * 7);
						ctx.lineTo(x - Math.sin(ang) * 3, y + Math.cos(ang) * 3);
						ctx.lineTo(x + Math.sin(ang) * 3, y - Math.cos(ang) * 3);
						ctx.closePath();
					}
					ctx.fill();
					break;
				}
				case 'steam':
					ctx.strokeStyle = color;
					ctx.lineWidth = 2;
					ctx.beginPath();
					ctx.arc(e.x, e.y, e.r * (0.3 + 0.7 * k), 0, TAU);
					ctx.stroke();
					break;
				case 'icing':
					ctx.strokeStyle = color;
					ctx.lineWidth = 3;
					ctx.beginPath();
					for (let i = 0; i < 3; i++) {
						const ang = (i * Math.PI) / 3 + e.seed;
						ctx.moveTo(e.x + Math.cos(ang) * 14, e.y + Math.sin(ang) * 14);
						ctx.lineTo(e.x - Math.cos(ang) * 14, e.y - Math.sin(ang) * 14);
					}
					ctx.stroke();
					break;
				case 'blast':
					ctx.fillStyle = 'rgba(255,112,67,0.5)';
					ctx.beginPath();
					ctx.arc(e.x, e.y, 10 + 16 * k, 0, TAU);
					ctx.fill();
					break;
			}
		}
		ctx.globalAlpha = 1;
		if (!game.labels.length) return;
		ctx.font = '800 13px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.lineWidth = 3;
		ctx.strokeStyle = 'rgba(0,0,0,0.85)';
		for (const l of game.labels) {
			const R = REACTIONS[l.kind];
			if (!R) continue;
			const k = l.t / 0.9;
			const y = l.y - k * 18;
			ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
			const text = R.name + '!';
			ctx.strokeText(text, l.x, y);
			ctx.fillStyle = R.color;
			ctx.fillText(text, l.x, y);
		}
		ctx.globalAlpha = 1;
	}

	// Crescent: a full white-blue ring swing.
	drawCrescents(ctx, game) {
		for (const c of game.crescents) {
			const p = game.playerPos(c.pid, this.tmp);
			if (!p) continue;
			const k = c.t / 0.3;
			const r = c.r * (0.6 + 0.4 * k);
			ctx.strokeStyle = `rgba(144,202,249,${0.7 * (1 - k)})`;
			ctx.lineWidth = 16 * (1 - k) + 2;
			ctx.beginPath();
			ctx.arc(p.x, p.y, r, 0, TAU);
			ctx.stroke();
			ctx.strokeStyle = `rgba(255,255,255,${1 - k})`;
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.arc(p.x, p.y, r + 6, k * 6, k * 6 + Math.PI * 1.6);
			ctx.stroke();
		}
	}

	// Ward / Bastion: a translucent hexagon with one dot per charge.
	drawWard(ctx, x, y, charges, bastion, now) {
		if (!(charges > 0)) return;
		const r = 26;
		ctx.strokeStyle = bastion ? 'rgba(255,213,79,0.85)' : 'rgba(128,216,255,0.75)';
		ctx.fillStyle = bastion ? 'rgba(255,213,79,0.1)' : 'rgba(128,216,255,0.1)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * TAU + now * 0.5;
			if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
			else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = bastion ? '#ffe082' : '#b3e5fc';
		ctx.beginPath();
		for (let i = 0; i < charges; i++) {
			const cx = x + (i - (charges - 1) / 2) * 7, cy = y - r - 6;
			ctx.moveTo(cx + 2.5, cy);
			ctx.arc(cx, cy, 2.5, 0, TAU);
		}
		ctx.fill();
	}

	// Millstones: two rings of hammers turning opposite ways.
	drawMillstones(ctx, px, py, L, area, tm) {
		for (const [R, dir] of [[L.radius * area, 1], [L.radius2 * area, -1]]) {
			for (let i = 0; i < L.count; i++) {
				const a = dir * orbitAngle(tm, L.rps, i, L.count);
				const x = px + Math.cos(a) * R, y = py + Math.sin(a) * R;
				ctx.save();
				ctx.translate(x, y);
				ctx.rotate(a + tm * 6 * dir);
				ctx.fillStyle = '#90a4ae';
				ctx.strokeStyle = 'rgba(0,0,0,0.7)';
				ctx.lineWidth = 1.5;
				ctx.fillRect(-6, -8, 12, 16);
				ctx.strokeRect(-6, -8, 12, 16);
				ctx.fillStyle = '#eceff1';
				ctx.fillRect(4, -8, 2, 16);
				ctx.restore();
			}
		}
	}

	// Moonblade: four pale sickles circling on a wide ellipse.
	drawMoonblades(ctx, px, py, L, area, tm, now) {
		for (let i = 0; i < L.count; i++) {
			const a = orbitAngle(tm, L.rps, i, L.count);
			const x = px + Math.cos(a) * L.rx * area, y = py + Math.sin(a) * L.ry * area;
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(now * 12 + i);
			ctx.fillStyle = 'rgba(225,245,254,0.3)';
			ctx.beginPath();
			ctx.arc(0, 0, 22, 0, TAU);
			ctx.fill();
			ctx.fillStyle = '#e1f5fe';
			ctx.strokeStyle = '#81d4fa';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(0, 0, 17, -1.9, 1.9);
			ctx.arc(6, 0, 12, 1.7, -1.7, true);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		}
	}

	// Blizzard: a ring of drifting snow around the hero.
	drawBlizzard(ctx, x, y, r, now) {
		ctx.fillStyle = 'rgba(179,229,252,0.08)';
		ctx.beginPath();
		ctx.arc(x, y, r, 0, TAU);
		ctx.fill();
		ctx.fillStyle = 'rgba(255,255,255,0.85)';
		ctx.beginPath();
		for (let i = 0; i < 36; i++) {
			const a = i * 2.39996 + now * (0.6 + (i % 3) * 0.2);
			const d = r * (0.25 + ((i * 37) % 75) / 100);
			const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d * 0.9;
			ctx.moveTo(sx + 1.8, sy);
			ctx.arc(sx, sy, 1.8, 0, TAU);
		}
		ctx.fill();
	}

	drawSpears(ctx, shots) {
		ctx.lineCap = 'round';
		for (const s of shots) {
			if (s.kind !== SPEAR_K) continue;
			const v = Math.hypot(s.vx, s.vy) || 1;
			const c = s.vx / v, n = s.vy / v;
			ctx.strokeStyle = 'rgba(255,224,178,0.35)';
			ctx.lineWidth = 7;
			ctx.beginPath();
			ctx.moveTo(s.x - c * 60, s.y - n * 60);
			ctx.lineTo(s.x, s.y);
			ctx.stroke();
			ctx.strokeStyle = '#8d6e63';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.moveTo(s.x - c * 34, s.y - n * 34);
			ctx.lineTo(s.x + c * 6, s.y + n * 6);
			ctx.stroke();
			ctx.fillStyle = '#eceff1';
			ctx.beginPath();
			ctx.moveTo(s.x + c * 18, s.y + n * 18);
			ctx.lineTo(s.x + c * 4 - n * 5, s.y + n * 4 + c * 5);
			ctx.lineTo(s.x + c * 4 + n * 5, s.y + n * 4 - c * 5);
			ctx.closePath();
			ctx.fill();
		}
		ctx.lineCap = 'butt';
	}

	drawPlayers(ctx, game, now) {
		const b = game.view.b;
		const a = game.view.a;
		const t = game.view.t;
		let mineDrawn = false;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		for (const row of b.p) {
			const pid = row[P.pid];
			const pos = game.playerPos(pid, this.tmp);
			if (!pos) continue;
			const x = pos.x, y = pos.y;
			if (!this.visible(x, y)) continue;
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
			const moving = this.heroMoving(pid, x, y);
			const sprite = this.sprites.ready ? this.sprites.tinted(meta.hero, meta.color) : null;
			if (down) this.drawDowned(ctx, x, y, meta, row[P.rev] || 0, now, sprite, fx);
			else {
				if (sprite) this.drawHeroSprite(ctx, sprite, x, y, meta.color, fx || 1, fy || 0, now, me, moving, pid);
				else drawHero(ctx, x, y, meta.hero, meta.color, fx || 1, fy || 0, now, me);
				const wl = Array.isArray(row[P.w]) ? row[P.w] : [];
				this.drawWard(ctx, x, y, row[P.ward] | 0, wl.some((w) => Array.isArray(w) && w[0] === 'bastion'), now);
				if (row[P.heroShield]) {
					ctx.strokeStyle = '#a5e5ff';
					ctx.lineWidth = 1.7;
					ctx.beginPath();
					ctx.arc(x, y, 22, 0, TAU);
					ctx.stroke();
				}
			}
			// Name and hp.
			ctx.font = '600 12px system-ui, sans-serif';
			ctx.lineWidth = 3;
			ctx.strokeStyle = 'rgba(0,0,0,0.85)';
			const ny = sprite && !down ? y - 40 : y - 34;
			ctx.strokeText(meta.name, x, ny);
			ctx.fillStyle = me ? '#ffffff' : meta.color;
			ctx.fillText(meta.name, x, ny);
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
			const sprite = this.sprites.ready ? this.sprites.tinted(meta.hero, meta.color) : null;
			if (sprite) this.drawHeroSprite(ctx, sprite, game.local.x, game.local.y, meta.color, game.local.fx, game.local.fy, now, true, false, game.me);
			else drawHero(ctx, game.local.x, game.local.y, meta.hero, meta.color, game.local.fx, game.local.fy, now, true);
		}
	}

	// Smoothed speed from rendered positions; works the same for the local hero and interpolated others.
	heroMoving(pid, x, y) {
		let m = this.heroMotion.get(pid);
		if (!m) {
			if (this.heroMotion.size > 32) this.heroMotion.clear();
			m = { x, y, v: 0 };
			this.heroMotion.set(pid, m);
		}
		const dt = Math.max(1e-3, this.dt || 0.016);
		const v = Math.hypot(x - m.x, y - m.y) / dt;
		m.v += (Math.min(v, 1000) - m.v) * Math.min(1, dt * 10);
		m.x = x;
		m.y = y;
		return m.v > 25;
	}

	drawHeroSprite(ctx, s, x, y, color, fx, fy, now, me, moving, pid) {
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
		blit(ctx, s, moving ? walkFrame(s, now, pid) : 0, x, y + HERO_FOOT, ART * r / (s.body || r), ux < -0.2);
	}

	drawDowned(ctx, x, y, meta, rev, now, sprite, fx) {
		ctx.fillStyle = 'rgba(0,0,0,0.35)';
		ctx.beginPath();
		ctx.ellipse(x, y + 8, 20, 7, 0, 0, TAU);
		ctx.fill();
		if (sprite) blit(ctx, sprite, sprite.frames - 1, x, y + HERO_FOOT, ART * 14 / (sprite.body || 14), fx < -0.2);
		else {
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
		}
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
				ctx.strokeStyle = z.color ?? 'rgba(129,212,250,0.45)';
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

	// v21 finale: darkness outside the ring (one even-odd fill, no blur or gradients), its edge, the absorbed horde.
	drawFinale(ctx, game, now, x0, y0, x1, y1) {
		const a = game.absorb;
		if (a) {
			// Threads shrink towards the middle of the ring within 0.8 s.
			const k = Math.min(1, a.t / 0.8);
			ctx.strokeStyle = `rgba(74, 20, 140, ${(0.75 * (1 - k)).toFixed(2)})`;
			ctx.lineWidth = 3;
			ctx.beginPath();
			for (let i = 0; i + 2 <= a.pts.length; i += 2) {
				ctx.moveTo(a.pts[i] + (a.cx - a.pts[i]) * k, a.pts[i + 1] + (a.cy - a.pts[i + 1]) * k);
				ctx.lineTo(a.cx, a.cy);
			}
			ctx.stroke();
		}
		const f = game.finale();
		if (!f || game.dawn) return;
		// Nothing of the wall on screen: the whole view lies inside the ring.
		const far = Math.max(Math.hypot(x0 - f.cx, y0 - f.cy), Math.hypot(x1 - f.cx, y0 - f.cy), Math.hypot(x0 - f.cx, y1 - f.cy), Math.hypot(x1 - f.cx, y1 - f.cy));
		if (far < f.r - 8) return;
		ctx.fillStyle = 'rgba(6, 3, 14, 0.86)';
		ctx.beginPath();
		ctx.rect(x0 - 40, y0 - 40, x1 - x0 + 80, y1 - y0 + 80);
		ctx.arc(f.cx, f.cy, f.r, 0, Math.PI * 2);
		ctx.fill('evenodd');
		// The edge: a soft band and a running dashed line; it pulses while the ring is closing.
		const pulse = f.phase === 1 ? 0.6 + 0.4 * Math.sin(now * 10) : 1;
		ctx.lineWidth = 10;
		ctx.strokeStyle = `rgba(126, 87, 194, ${(0.35 * pulse).toFixed(2)})`;
		ctx.beginPath();
		ctx.arc(f.cx, f.cy, f.r, 0, Math.PI * 2);
		ctx.stroke();
		ctx.lineWidth = 3;
		ctx.strokeStyle = f.phase >= 3 ? `rgba(255, 138, 128, ${(0.9 * pulse).toFixed(2)})` : `rgba(209, 196, 233, ${(0.9 * pulse).toFixed(2)})`;
		ctx.setLineDash([18, 14]);
		ctx.lineDashOffset = -now * 40;
		ctx.beginPath();
		ctx.arc(f.cx, f.cy, f.r, 0, Math.PI * 2);
		ctx.stroke();
		ctx.setLineDash([]);
	}

	// Edge-of-screen arrows: every ally outside the view (downed ones red and pulsing, standing ones in their colour,
	// close directions merged into one "name +N" arrow), the finale Lord, chests, star shards and the event spot.
	arrowList(game, now) {
		const out = this.arrowBuf;
		out.length = 0;
		const b = game.view.b;
		this.updateArrowBox(now);
		const pulse = 1 + Math.sin(now * 6) * 0.15;
		const allies = this.allyArrows;
		allies.length = 0;
		for (const row of b.p) {
			const pid = row[P.pid];
			if (pid === game.me) continue;
			const pos = game.playerPos(pid, this.tmp);
			if (!pos) continue;
			const s = this.toScreen(pos.x, pos.y, this.tmp);
			if (this.onScreen(s)) continue;
			const meta = game.meta(pid);
			const d = Math.hypot(s.x - this.w / 2, s.y - this.h / 2);
			if (row[P.st] === 1) {
				out.push(this.edgeArrow(s, { pulse: pulse * 1.1, color: '#ff5252', name: shortName(meta.name), icon: '✝', kind: 'down' }));
			} else {
				allies.push({ sx: s.x, sy: s.y, d, ang: Math.atan2(s.y - this.h / 2, s.x - this.w / 2), color: meta.color, name: meta.name, n: 1 });
			}
		}
		for (const c of mergeByAngle(allies).sort((p, q) => p.d - q.d).slice(0, ALLY_ARROWS)) {
			this.tmp.x = c.sx;
			this.tmp.y = c.sy;
			out.push(this.edgeArrow(this.tmp, { pulse: 0.8, color: c.color, name: shortName(c.name) + (c.n > 1 ? ` +${c.n - 1}` : ''), icon: '●', kind: 'ally' }));
		}
		// v21 finale: the Lord outside the view gets a red arrow (on a phone the arena is wider than the screen).
		const fin = game.finale();
		if (fin && fin.phase >= 2) {
			const e = b.e;
			for (let i = 0; i + E_STRIDE <= e.length; i += E_STRIDE) {
				if (e[i + 1] !== BOSS_T) continue;
				const s = this.toScreen(+e[i + 2], +e[i + 3], this.tmp);
				if (!this.onScreen(s)) out.push(this.edgeArrow(s, { pulse, color: '#ff5252', name: 'Владыка', icon: '☠' }));
				break;
			}
		}
		// v19: chests and star shards lying off-screen get an arrow each (the nearest ITEM_ARROWS), as long as they lie.
		const items = this.itemArrows;
		items.length = 0;
		const it = b.it;
		for (let i = 0; i + 4 <= it.length; i += 4) {
			const kind = ITEM_TYPES[it[i + 1] | 0];
			if (kind !== 'chest' && kind !== 'star') continue;
			const d = Math.hypot(it[i + 2] - this.camX, it[i + 3] - this.camY);
			items.push({ x: it[i + 2], y: it[i + 3], d, kind });
		}
		items.sort((p, q) => p.d - q.d);
		for (const o of items.slice(0, ITEM_ARROWS)) {
			const s = this.toScreen(o.x, o.y, this.tmp);
			if (!this.onScreen(s)) out.push(this.edgeArrow(s, { pulse, color: '#ffd54f', name: o.kind === 'chest' ? 'Сундук' : 'Осколок', icon: '★' }));
		}
		// Off-screen event spot (altar, cursed chest, golden shade) gets a gold arrow; the star shard has its item arrow.
		const ev = game.event();
		if (ev && !(ev.def.id === 'fog' || ev.def.id === 'streak' || (ev.def.id === 'cursed' && ev.phase === 1) || (ev.def.id === 'star' && ev.phase === 1))) {
			const s = this.toScreen(ev.x, ev.y, this.tmp);
			if (!this.onScreen(s)) out.push(this.edgeArrow(s, { pulse, color: '#ffd54f', name: ev.def.arrow ?? ev.def.name, icon: '★' }));
		}
		// Downed allies last: drawn on top of everything else.
		out.sort((p, q) => (p.kind === 'down') - (q.kind === 'down'));
		return out;
	}

	onScreen(s) {
		return s.x > 0 && s.x < this.w && s.y > 0 && s.y < this.h;
	}

	// Arrows stay below the top HUD block and out of the minimap corner; both are measured twice a second.
	updateArrowBox(now) {
		const B = this.arrowBox;
		if (now - B.at < 0.5 && B.w === this.w && B.h === this.h) return;
		B.at = now;
		B.w = this.w;
		B.h = this.h;
		this.hudTopEl ??= document.querySelector('.hud-top');
		const hudBottom = this.hudTopEl ? this.hudTopEl.getBoundingClientRect().bottom : 0;
		const m = 28;
		B.l = m;
		B.r = this.w - m;
		B.b = this.h - m;
		B.t = Math.max(m, Math.min(this.h * 0.32, hudBottom + 18));
		const r = this.overlay.mm.getBoundingClientRect();
		B.mmX = r.width ? r.left - 16 : Infinity;
		B.mmY = r.width ? r.top - 16 : Infinity;
	}

	// Projects screen point `s` from the screen centre onto the arrow box.
	edgeArrow(s, a) {
		const B = this.arrowBox;
		const cx = this.w / 2, cy = this.h / 2;
		const dx = s.x - cx, dy = s.y - cy;
		const kx = dx > 0 ? (B.r - cx) / dx : dx < 0 ? (B.l - cx) / dx : Infinity;
		const ky = dy > 0 ? (B.b - cy) / dy : dy < 0 ? (B.t - cy) / dy : Infinity;
		const k = Math.min(kx, ky);
		let x = cx + dx * k, y = cy + dy * k;
		if (x > B.mmX && y > B.mmY) {
			if (kx <= ky) y = B.mmY;
			else x = B.mmX;
		}
		a.x = x;
		a.y = y;
		a.ang = Math.atan2(dy, dx);
		return a;
	}

	// Corner radar centred on the own hero: allies, the Lord, chests and the event spot; redrawn ~8 times a second.
	updateMinimap(game, now, inGame) {
		const cv = this.overlay.mm;
		const show = !!inGame;
		if (show !== this.mmShown) {
			this.mmShown = show;
			cv.style.display = show ? '' : 'none';
			this.mmAt = 0;
			if (show) this.mmSize = 0;
		}
		if (!show || now - this.mmAt < 0.125) return;
		this.mmAt = now;
		const css = cv.clientWidth;
		if (!css) return;
		const px = Math.round(css * Math.min(2, window.devicePixelRatio || 1));
		if (this.mmSize !== px) {
			this.mmSize = px;
			cv.width = cv.height = px;
		}
		const ctx = cv.getContext('2d');
		const k = px / css, c = css / 2, R = c - 5, sc = R / MM_RANGE;
		ctx.setTransform(k, 0, 0, k, 0, 0);
		ctx.clearRect(0, 0, css, css);
		ctx.save();
		ctx.beginPath();
		ctx.arc(c, c, c - 1, 0, TAU);
		ctx.fillStyle = 'rgba(8, 10, 16, 0.62)';
		ctx.fill();
		ctx.clip();
		const mx = this.camX, my = this.camY;
		// View frame.
		const hw = (this.w / 2 / this.zoom) * sc, hh = (this.h / 2 / this.zoom) * sc;
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
		ctx.lineWidth = 1;
		ctx.strokeRect(c - hw, c - hh, hw * 2, hh * 2);
		const fin = game.finale();
		if (fin) {
			ctx.strokeStyle = 'rgba(255, 138, 128, 0.7)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(c + (fin.cx - mx) * sc, c + (fin.cy - my) * sc, Math.max(2, fin.r * sc), 0, TAU);
			ctx.stroke();
		}
		ctx.restore();
		const at = (x, y, out) => {
			let dx = (x - mx) * sc, dy = (y - my) * sc;
			const d = Math.hypot(dx, dy);
			if (d > R) {
				dx *= R / d;
				dy *= R / d;
			}
			out.x = c + dx;
			out.y = c + dy;
			return out;
		};
		const p = this.tmp;
		const b = game.view.b;
		const it = b.it;
		ctx.fillStyle = '#ffd54f';
		for (let i = 0; i + 4 <= it.length; i += 4) {
			const kind = ITEM_TYPES[it[i + 1] | 0];
			if (kind !== 'chest' && kind !== 'star') continue;
			at(it[i + 2], it[i + 3], p);
			ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
		}
		const ev = game.event();
		if (ev && ev.def.id !== 'fog' && ev.def.id !== 'streak') {
			at(ev.x, ev.y, p);
			ctx.beginPath();
			ctx.moveTo(p.x, p.y - 4);
			ctx.lineTo(p.x + 4, p.y);
			ctx.lineTo(p.x, p.y + 4);
			ctx.lineTo(p.x - 4, p.y);
			ctx.closePath();
			ctx.fill();
		}
		const e = b.e;
		for (let i = 0; i + E_STRIDE <= e.length; i += E_STRIDE) {
			if (e[i + 1] !== BOSS_T) continue;
			at(+e[i + 2], +e[i + 3], p);
			ctx.beginPath();
			ctx.arc(p.x, p.y, 5, 0, TAU);
			ctx.fillStyle = '#ff1744';
			ctx.fill();
			ctx.strokeStyle = '#fff';
			ctx.lineWidth = 1.2;
			ctx.stroke();
		}
		const blink = Math.sin(now * 8) > 0;
		for (const row of b.p) {
			const pid = row[P.pid];
			if (pid === game.me || !game.playerPos(pid, p)) continue;
			at(p.x, p.y, p);
			ctx.beginPath();
			ctx.arc(p.x, p.y, 3.5, 0, TAU);
			ctx.fillStyle = game.meta(pid).color;
			ctx.fill();
			ctx.lineWidth = row[P.st] === 1 ? 2 : 1;
			ctx.strokeStyle = row[P.st] === 1 ? (blink ? '#ff5252' : '#fff') : '#000';
			ctx.stroke();
		}
		ctx.beginPath();
		ctx.arc(c, c, 3, 0, TAU);
		ctx.fillStyle = '#fff';
		ctx.fill();
		ctx.beginPath();
		ctx.arc(c, c, c - 1, 0, TAU);
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
		ctx.lineWidth = 1;
		ctx.stroke();
	}
}

// Names on arrows are kept short so a label fits next to the screen edge on a phone.
function shortName(name) {
	const ch = Array.from(String(name || ''));
	return ch.length > 8 ? ch.slice(0, 7).join('') + '…' : ch.join('');
}

// Allies whose arrows point in nearly the same direction share one arrow (the nearest one, with a count).
function mergeByAngle(list) {
	if (list.length < 2) return list;
	list.sort((p, q) => p.ang - q.ang);
	const out = [];
	for (const a of list) {
		const last = out[out.length - 1];
		if (last && a.ang - last.ang1 < ALLY_MERGE) {
			last.ang1 = a.ang;
			last.n += a.n;
			if (a.d < last.d) Object.assign(last, { sx: a.sx, sy: a.sy, d: a.d, color: a.color, name: a.name });
		} else out.push({ ...a, ang1: a.ang });
	}
	if (out.length > 1) {
		const first = out[0], last = out[out.length - 1];
		if (first.ang + TAU - last.ang1 < ALLY_MERGE) {
			first.n += last.n;
			if (last.d < first.d) Object.assign(first, { sx: last.sx, sy: last.sy, d: last.d, color: last.color, name: last.name });
			out.pop();
		}
	}
	return out;
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
	const glow = { dew: '128,222,234', magnet: '255,112,67', rage: '239,83,80', cracker: '255,235,59', slowtime: '179,229,252', feather: '255,255,255', chest: '255,213,79', star: '255,245,157' }[type] || '255,255,255';
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
		case 'star': {
			ctx.fillStyle = '#fff59d';
			ctx.beginPath();
			for (let i = 0; i < 10; i++) {
				const a = (i / 10) * TAU - Math.PI / 2 + now * 0.8, rr = i % 2 ? 5 : 12;
				ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
			}
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
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
	if (heroId === 'spearmaiden') return drawSpearmaiden(ctx, x, y, r, hero.color, ux, bob);
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

// Vector fallback for «Копейщица»: crested helmet and an upright spear on the facing side.
function drawSpearmaiden(ctx, x, y, r, color, ux, bob) {
	const side = ux >= 0 ? 1 : -1;
	ctx.strokeStyle = '#8d6e63';
	ctx.lineWidth = 2.5;
	ctx.beginPath();
	ctx.moveTo(x + side * r * 1.05, y + r * 0.9 + bob);
	ctx.lineTo(x + side * r * 1.05, y - r * 1.9 + bob);
	ctx.stroke();
	ctx.fillStyle = '#cfd8dc';
	ctx.strokeStyle = 'rgba(0,0,0,0.6)';
	ctx.lineWidth = 1.2;
	ctx.beginPath();
	ctx.moveTo(x + side * r * 1.05, y - r * 2.45 + bob);
	ctx.lineTo(x + side * r * 1.05 - r * 0.28, y - r * 1.8 + bob);
	ctx.lineTo(x + side * r * 1.05 + r * 0.28, y - r * 1.8 + bob);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();
	// Helmet with a crest in the hero colour.
	ctx.fillStyle = '#b0bec5';
	ctx.strokeStyle = 'rgba(0,0,0,0.55)';
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.arc(x, y - r * 0.15 + bob, r * 0.95, Math.PI, 0);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.ellipse(x - side * r * 0.1, y - r * 1.15 + bob, r * 0.75, r * 0.22, -side * 0.25, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();
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

