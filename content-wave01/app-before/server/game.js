import {
	TICK_HZ, SNAPSHOT_HZ, MAX_PLAYERS, RUN_SECONDS, MAX_ENEMIES, MAX_GEMS, PLAYER_RADIUS,
	REVIVE_RADIUS, REVIVE_SECONDS, REVIVE_HP_FRACTION, PLAYER_IFRAMES, GEM_SHARE, MAX_LEVEL,
	MAX_WEAPONS, MAX_PASSIVES, BOSS_TIMES, xpForNext, PLAYER_COLORS, HEROES, WEAPONS, PASSIVES,
	BASE_MAGNET, GEM_PULL_SPEED, ENEMIES, ENEMY_TYPES, PROJECTILE_KINDS, WEAPON_IDS, PASSIVE_IDS,
	WAVES, enemyHpScale, spawnRateScale, SPAWN_DISTANCE, orbitAngle, heroTrait,
} from '../public/shared/content.js';

const SNAPSHOT_EVERY = Math.max(1, Math.round(TICK_HZ / SNAPSHOT_HZ));
const CELL = 64;
const MAX_ENEMY_R = Math.max(...Object.values(ENEMIES).map((e) => e.r));
const VIEW_DIST2 = 1000 * 1000;
const FAR_DIST2 = 1400 * 1400;
const WORLD_LIMIT = 100000;
const MAX_HIT_FX = 40;
const KNIFE_AIM_RANGE = 550;
const round3 = (v) => Math.round(v * 1000) / 1000;
const MAX_DIE_FX = 40;
const SEPARATION_NEIGHBORS = 10;
const PROJ_R = 6;
const ORBIT_BLADE_R = 12;
const LIGHTNING_RANGE = 600;
const CHAIN_RANGE = 170;
const BOLT_RANGE = 700;
const HEAL_AMOUNT = 30;
const REVIVE_IFRAMES = 1.5;
const SLOW_HOLD = 0.1; // seconds a puddle slow lingers after the last check
const TYPE_INDEX = Object.fromEntries(ENEMY_TYPES.map((t, i) => [t, i]));
const KIND_INDEX = Object.fromEntries(PROJECTILE_KINDS.map((k, i) => [k, i]));
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r2 = (v) => Math.round(v * 100) / 100;

export function sanitizeName(v) {
	if (typeof v !== 'string') return '';
	return v.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

const sanitizeHero = (v) => (typeof v === 'string' && Object.hasOwn(HEROES, v) ? v : null);

class Grid {
	constructor(cell) {
		this.inv = 1 / cell;
		this.cells = new Map();
		this.used = [];
	}

	clear() {
		for (const a of this.used) a.length = 0;
		this.used.length = 0;
		if (this.cells.size > 8192) this.cells.clear();
	}

	key(cx, cy) {
		return (clamp(cx, -32000, 32000) + 32768) * 65536 + (clamp(cy, -32000, 32000) + 32768);
	}

	insert(e) {
		const k = this.key(Math.floor(e.x * this.inv), Math.floor(e.y * this.inv));
		let a = this.cells.get(k);
		if (!a) this.cells.set(k, a = []);
		if (a.length === 0) this.used.push(a);
		a.push(e);
	}

	query(x, y, r, out) {
		out.length = 0;
		const x0 = Math.floor((x - r) * this.inv), x1 = Math.floor((x + r) * this.inv);
		const y0 = Math.floor((y - r) * this.inv), y1 = Math.floor((y + r) * this.inv);
		for (let cx = x0; cx <= x1; cx++) {
			for (let cy = y0; cy <= y1; cy++) {
				const a = this.cells.get(this.key(cx, cy));
				if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
			}
		}
		return out;
	}
}

const STAT_LABELS = {
	dmg: 'урон', cd: 'перезарядка', count: 'кол-во', pierce: 'пробивание', range: 'дальность',
	width: 'ширина', radius: 'радиус', strikes: 'удары', chain: 'цепь', duration: 'длительность',
	tick: 'такт', rps: 'скорость', speed: 'скорость',
};

function upgradeDesc(weaponId, toLevel) {
	const a = WEAPONS[weaponId].levels[toLevel - 2], b = WEAPONS[weaponId].levels[toLevel - 1];
	const parts = [];
	for (const k of Object.keys(b)) {
		if (k === 'both') {
			if (b.both && !a.both) parts.push('удар в обе стороны');
			continue;
		}
		if (a[k] !== b[k] && STAT_LABELS[k] && k !== 'speed' && k !== 'spread' && k !== 'hitCd') {
			parts.push(`${STAT_LABELS[k]} ${a[k]}→${b[k]}`);
		}
	}
	return parts.join(', ') || WEAPONS[weaponId].desc;
}

function makeHero(member, x, y) {
	const h = HEROES[member.hero];
	return {
		pid: member.pid, name: member.name, hero: member.hero, color: member.color,
		x, y, fx: 1, fy: 0, lastPosT: 0,
		hp: h.hp, baseHp: h.hp, maxHp: h.hp, speed: h.speed,
		level: 1, xp: 0, st: 0, rev: 0, iframes: 0,
		weapons: new Map([[h.weapon, { lvl: 1, t: 0.3 }]]),
		trait: heroTrait(member.hero),
		passives: new Map(),
		mods: { dmgMul: 1, cdMul: 1, speedMul: 1, magnetMul: 1, areaMul: 1, regen: 0 },
		kills: 0, dmg: 0,
		offer: null, queue: 0,
	};
}

export class Room {
	constructor(code, send) {
		this.code = code;
		this.send = send;
		this.state = 'lobby';
		this.members = new Map(); // pid -> {pid, name, hero, ready, color}
		this.host = null;
		this.heroes = new Map();
	}

	get size() {
		return this.members.size;
	}

	broadcast(msg) {
		const json = JSON.stringify(msg);
		for (const pid of this.members.keys()) this.send(pid, msg, json);
	}

	addPlayer(pid, name, hero) {
		if (this.state !== 'lobby') return 'Игра уже идёт';
		if (this.members.size >= MAX_PLAYERS) return 'Комната заполнена';
		const usedColors = new Set([...this.members.values()].map((m) => m.color));
		const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0];
		this.members.set(pid, { pid, name, hero: sanitizeHero(hero) ?? 'knight', ready: false, color });
		if (this.host === null) this.host = pid;
		this.sendLobby();
		return null;
	}

	removePlayer(pid) {
		if (!this.members.delete(pid)) return;
		this.heroes.delete(pid);
		if (this.host === pid) this.host = this.members.keys().next().value ?? null;
		if (this.members.size === 0) return;
		if (this.state === 'lobby') this.sendLobby();
		else if (this.state === 'play') this.checkAllDown();
	}

	rename(pid, name) {
		const m = this.members.get(pid);
		if (!m) return;
		m.name = name;
		const h = this.heroes.get(pid);
		if (h) h.name = name;
		if (this.state === 'lobby') this.sendLobby();
	}

	lobbyMsg() {
		return {
			t: 'lobby', code: this.code, host: this.host,
			players: [...this.members.values()].map(({ pid, name, hero, ready, color }) => ({ pid, name, hero, ready, color })),
		};
	}

	sendLobby() {
		this.broadcast(this.lobbyMsg());
	}

	startMsg() {
		return {
			t: 'start',
			players: [...this.heroes.values()].map((h) => ({ pid: h.pid, name: h.name, hero: h.hero, color: h.color, x: Math.round(h.x), y: Math.round(h.y) })),
		};
	}

	// Re-sends current state to a reconnected player.
	resync(pid) {
		if (this.state === 'lobby') {
			this.send(pid, this.lobbyMsg());
			return;
		}
		if (this.state === 'play') {
			this.send(pid, this.startMsg());
			const h = this.heroes.get(pid);
			if (h?.offer) this.sendOffer(h);
		} else if (this.state === 'over' && this.overMsg) {
			this.send(pid, this.overMsg);
		}
	}

	handle(pid, msg) {
		const m = this.members.get(pid);
		if (!m) return;
		switch (msg.t) {
			case 'hero': {
				const hero = sanitizeHero(msg.hero);
				if (this.state === 'lobby' && hero) {
					m.hero = hero;
					this.sendLobby();
				}
				break;
			}
			case 'ready':
				if (this.state === 'lobby') {
					m.ready = msg.v === true;
					this.sendLobby();
				}
				break;
			case 'start':
				if (this.state !== 'lobby') break;
				if (pid !== this.host) this.send(pid, { t: 'err', msg: 'Начать игру может только хост' });
				else this.start();
				break;
			case 'again':
				if (this.state !== 'over') break;
				if (pid !== this.host) this.send(pid, { t: 'err', msg: 'Перезапустить может только хост' });
				else this.toLobby();
				break;
			case 'pos':
				this.onPos(pid, msg);
				break;
			case 'pick':
				this.onPick(pid, msg);
				break;
		}
	}

	toLobby() {
		this.state = 'lobby';
		this.heroes.clear();
		this.resetSim();
		for (const m of this.members.values()) m.ready = false;
		this.sendLobby();
	}

	resetSim() {
		this.time = 0;
		this.kills = 0;
		this.tickNo = 0;
		this.nextId = 1;
		this.enemies = [];
		this.projectiles = [];
		this.gems = [];
		this.puddles = [];
		this.bosses = [];
		this.bossIdx = 0;
		this.spawnAcc = 0;
		this.fx = [];
		this.hitFx = 0;
		this.dieFx = 0;
		this.grid = new Grid(CELL);
		this.q1 = [];
		this.q2 = [];
		this.overMsg = null;
	}

	start() {
		this.resetSim();
		this.state = 'play';
		this.heroes.clear();
		const list = [...this.members.values()];
		list.forEach((m, i) => {
			const a = (i / list.length) * Math.PI * 2;
			const r = list.length > 1 ? 50 : 0;
			this.heroes.set(m.pid, makeHero(m, Math.cos(a) * r, Math.sin(a) * r));
		});
		this.broadcast(this.startMsg());
	}

	onPos(pid, msg) {
		if (this.state !== 'play') return;
		const h = this.heroes.get(pid);
		if (!h || h.st !== 0) return;
		const x = num(msg.x), y = num(msg.y);
		if (x !== null && y !== null) {
			const tx = clamp(x, -WORLD_LIMIT, WORLD_LIMIT), ty = clamp(y, -WORLD_LIMIT, WORLD_LIMIT);
			const elapsed = clamp(this.time - h.lastPosT, 0, 1);
			const maxStep = h.speed * h.mods.speedMul * elapsed * 1.5 + 30;
			const dx = tx - h.x, dy = ty - h.y;
			const d = Math.hypot(dx, dy);
			if (d <= maxStep) {
				h.x = tx;
				h.y = ty;
			} else {
				h.x += (dx / d) * maxStep;
				h.y += (dy / d) * maxStep;
			}
			h.lastPosT = this.time;
		}
		const fx = num(msg.fx), fy = num(msg.fy);
		if (fx !== null && fy !== null) {
			const l = Math.hypot(fx, fy);
			if (l > 0.01) {
				h.fx = fx / l;
				h.fy = fy / l;
			}
		}
	}

	// --- level-up offers ---

	grantOffer(h) {
		if (h.offer) {
			h.queue++;
			this.sendOffer(h);
		} else {
			h.offer = this.makeChoices(h);
			this.sendOffer(h);
		}
	}

	sendOffer(h) {
		this.send(h.pid, { t: 'lvl', choices: h.offer, pending: h.queue });
	}

	makeChoices(h) {
		const pool = [];
		for (const id of WEAPON_IDS) {
			const w = h.weapons.get(id);
			const W = WEAPONS[id];
			if (w) {
				if (w.lvl < MAX_LEVEL) pool.push({ id, kind: 'weapon', name: W.name, icon: W.icon, desc: upgradeDesc(id, w.lvl + 1), level: w.lvl + 1 });
			} else if (h.weapons.size < MAX_WEAPONS) {
				pool.push({ id, kind: 'weapon', name: W.name, icon: W.icon, desc: W.desc, level: 1 });
			}
		}
		for (const id of PASSIVE_IDS) {
			const lvl = h.passives.get(id) ?? 0;
			const P = PASSIVES[id];
			if (lvl ? lvl < MAX_LEVEL : h.passives.size < MAX_PASSIVES) {
				pool.push({ id, kind: 'passive', name: P.name, icon: P.icon, desc: P.desc, level: lvl + 1 });
			}
		}
		if (pool.length === 0) return [{ id: 'heal', kind: 'heal', name: 'Лечение', icon: '✚', desc: `+${HEAL_AMOUNT} здоровья`, level: 0 }];
		for (let i = pool.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[pool[i], pool[j]] = [pool[j], pool[i]];
		}
		return pool.slice(0, 3);
	}

	onPick(pid, msg) {
		if (this.state !== 'play') return;
		const h = this.heroes.get(pid);
		const i = num(msg.i);
		if (!h?.offer || i === null || !Number.isInteger(i) || i < 0 || i >= h.offer.length) return;
		const c = h.offer[i];
		if (c.kind === 'weapon') {
			const w = h.weapons.get(c.id);
			if (w) w.lvl = Math.min(MAX_LEVEL, w.lvl + 1);
			else h.weapons.set(c.id, { lvl: 1, t: 0.2 });
		} else if (c.kind === 'passive') {
			h.passives.set(c.id, Math.min(MAX_LEVEL, (h.passives.get(c.id) ?? 0) + 1));
			const before = h.maxHp;
			this.recalcMods(h);
			if (h.maxHp > before && h.st === 0) h.hp += h.maxHp - before;
		} else if (h.st === 0) {
			h.hp = Math.min(h.maxHp, h.hp + HEAL_AMOUNT);
		}
		h.offer = null;
		if (h.queue > 0) {
			h.queue--;
			h.offer = this.makeChoices(h);
			this.sendOffer(h);
		}
	}

	recalcMods(h) {
		const m = { dmgMul: 1, cdMul: 1, speedMul: 1, magnetMul: 1, areaMul: 1, regen: 0, maxHp: 0 };
		for (const [id, lvl] of h.passives) m[PASSIVES[id].stat] += PASSIVES[id].perLevel * lvl;
		m.cdMul = Math.max(0.3, m.cdMul);
		h.maxHp = h.baseHp + m.maxHp;
		delete m.maxHp;
		h.mods = m;
	}

	// --- simulation ---

	tick(dt) {
		if (this.state !== 'play') return;
		this.time += dt;
		this.tickNo++;
		const alive = [];
		for (const h of this.heroes.values()) if (h.st === 0) alive.push(h);

		if (alive.length) {
			this.spawn(dt, alive);
			this.moveEnemies(dt, alive);
		}
		this.rebuildGrid();
		this.updatePlayers(dt, alive);
		this.auraHeals(dt, alive);
		this.updateProjectiles(dt);
		this.updatePuddles(dt);
		this.compactEnemies();
		this.updateGems(dt, alive);
		this.updateRevive(dt);

		if (this.checkAllDown()) return;
		if (this.time >= RUN_SECONDS) {
			this.finish(true);
			return;
		}
		if (this.tickNo % SNAPSHOT_EVERY === 0) this.snapshot();
	}

	randomRingPos(alive) {
		const p = alive[Math.floor(Math.random() * alive.length)];
		const a = Math.random() * Math.PI * 2;
		const d = SPAWN_DISTANCE.min + Math.random() * (SPAWN_DISTANCE.max - SPAWN_DISTANCE.min);
		return [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d];
	}

	spawnEnemy(type, alive, hpMul) {
		const E = ENEMIES[type];
		const [x, y] = this.randomRingPos(alive);
		const hp = E.hp * hpMul;
		const e = {
			id: this.nextId++, type: TYPE_INDEX[type], x, y, hp, maxHp: hp,
			speed: E.speed * (0.9 + Math.random() * 0.2), dmg: E.dmg, r: E.r, xp: E.xp,
			dead: false, zig: type === 'wisp', phase: Math.random() * Math.PI * 2, oh: null,
			slow: 0, slowT: 0,
		};
		this.enemies.push(e);
		return e;
	}

	spawn(dt, alive) {
		const n = this.heroes.size;
		while (this.bossIdx < BOSS_TIMES.length && this.time >= BOSS_TIMES[this.bossIdx]) {
			this.bossIdx++;
			const b = this.spawnEnemy('boss', alive, n);
			this.bosses.push(b);
			this.fx.push(['boss', ENEMIES.boss.name]);
		}
		let wave = WAVES[0];
		for (const w of WAVES) if (w.at <= this.time) wave = w;
		this.spawnAcc += wave.rate * spawnRateScale(n) * dt;
		if (this.spawnAcc < 1) return;
		const types = Object.entries(wave.types);
		const total = types.reduce((s, [, w]) => s + w, 0);
		const hpMul = enemyHpScale(this.time, n);
		while (this.spawnAcc >= 1) {
			this.spawnAcc -= 1;
			if (this.enemies.length >= MAX_ENEMIES) {
				this.spawnAcc = 0;
				break;
			}
			let r = Math.random() * total;
			let type = types[0][0];
			for (const [t, w] of types) {
				if ((r -= w) <= 0) {
					type = t;
					break;
				}
			}
			this.spawnEnemy(type, alive, hpMul);
		}
	}

	rebuildGrid() {
		this.grid.clear();
		for (const e of this.enemies) if (!e.dead) this.grid.insert(e);
	}

	moveEnemies(dt, alive) {
		this.rebuildGrid();
		const near = this.q1;
		const taunters = alive.filter((p) => p.trait.taunt > 0);
		for (const e of this.enemies) {
			let best = null, bd = Infinity;
			for (const p of alive) {
				const d = dist2(e.x, e.y, p.x, p.y);
				if (d < bd) {
					bd = d;
					best = p;
				}
			}
			if (bd > FAR_DIST2) {
				[e.x, e.y] = this.randomRingPos(alive);
				continue;
			}
			if (taunters.length) [best, bd] = this.tauntTarget(e, taunters, best, bd);
			let dx = best.x - e.x, dy = best.y - e.y;
			const d = Math.sqrt(bd) || 1;
			dx /= d;
			dy /= d;
			if (e.zig) {
				const s = Math.sin(this.time * 5 + e.phase) * 0.9;
				const zx = dx - dy * s, zy = dy + dx * s;
				const l = Math.hypot(zx, zy) || 1;
				dx = zx / l;
				dy = zy / l;
			}
			// Stop at contact distance so enemies don't stack on the player.
			const speed = e.slowT > this.time ? e.speed * (1 - e.slow) : e.speed;
			const step = Math.min(speed * dt, Math.max(0, d - e.r - PLAYER_RADIUS + 2));
			e.x += dx * step;
			e.y += dy * step;

			this.grid.query(e.x, e.y, e.r + MAX_ENEMY_R, near);
			let checked = 0;
			for (let i = 0; i < near.length && checked < SEPARATION_NEIGHBORS; i++) {
				const o = near[i];
				if (o === e) continue;
				const ox = e.x - o.x, oy = e.y - o.y;
				const min = e.r + o.r;
				const dd = ox * ox + oy * oy;
				if (dd >= min * min) continue;
				checked++;
				if (dd < 0.0001) {
					e.x += (Math.random() - 0.5) * 2;
					continue;
				}
				const l = Math.sqrt(dd);
				// Heavier enemies (boss) are pushed less.
				const push = (min - l) * 0.5 * (o.r / (e.r + o.r)) * 2;
				e.x += (ox / l) * push * 0.5;
				e.y += (oy / l) * push * 0.5;
			}
		}
	}

	// Taunting heroes pull enemies within their taunt range away from the nearest player.
	tauntTarget(e, taunters, best, bd) {
		let tb = null, td = Infinity;
		for (const p of taunters) {
			const d = dist2(e.x, e.y, p.x, p.y);
			if (d < p.trait.taunt * p.trait.taunt && d < td) {
				td = d;
				tb = p;
			}
		}
		return tb ? [tb, td] : [best, bd];
	}

	hurtEnemy(e, dmg, h) {
		if (e.dead || dmg <= 0) return;
		h.dmg += Math.min(dmg, e.hp);
		e.hp -= dmg;
		if (this.hitFx < MAX_HIT_FX) {
			this.hitFx++;
			this.fx.push(['hit', Math.round(e.x), Math.round(e.y), Math.max(1, Math.round(dmg))]);
		}
		if (e.hp <= 0) this.killEnemy(e, h);
	}

	killEnemy(e, h) {
		e.dead = true;
		this.kills++;
		h.kills++;
		if (this.dieFx < MAX_DIE_FX) {
			this.dieFx++;
			this.fx.push(['die', Math.round(e.x), Math.round(e.y), e.type]);
		}
		this.dropGem(e.x, e.y, e.xp);
		const bi = this.bosses.indexOf(e);
		if (bi >= 0) {
			this.bosses.splice(bi, 1);
			this.fx.push(['chest', Math.round(e.x), Math.round(e.y)]);
			for (const p of this.heroes.values()) if (p.st === 0) this.grantOffer(p);
		}
	}

	dropGem(x, y, xp) {
		if (this.gems.length >= MAX_GEMS) {
			let best = this.gems[0], bd = Infinity;
			for (const g of this.gems) {
				const d = dist2(x, y, g.x, g.y);
				if (d < bd) {
					bd = d;
					best = g;
				}
			}
			best.xp += xp;
			return;
		}
		this.gems.push({ id: this.nextId++, x, y, xp });
	}

	compactEnemies() {
		let j = 0;
		for (const e of this.enemies) if (!e.dead) this.enemies[j++] = e;
		this.enemies.length = j;
	}

	updatePlayers(dt, alive) {
		const near = this.q1;
		for (const h of alive) {
			if (h.st !== 0) continue;
			h.iframes = Math.max(0, h.iframes - dt);
			if (h.mods.regen > 0) h.hp = Math.min(h.maxHp, h.hp + h.mods.regen * dt);

			if (h.iframes <= 0) {
				this.grid.query(h.x, h.y, PLAYER_RADIUS + MAX_ENEMY_R, near);
				for (const e of near) {
					if (e.dead) continue;
					const min = e.r + PLAYER_RADIUS;
					if (dist2(e.x, e.y, h.x, h.y) < min * min) {
						this.hurtPlayer(h, e.dmg);
						break;
					}
				}
			}
			if (h.st !== 0) continue;
			for (const [id, w] of h.weapons) this.updateWeapon(h, id, w, dt);
		}
	}

	hurtPlayer(h, dmg) {
		h.hp -= dmg * h.trait.dmgTaken;
		h.iframes = PLAYER_IFRAMES;
		this.fx.push(['hurt', h.pid]);
		if (h.hp <= 0) {
			h.hp = 0;
			h.st = 1;
			h.rev = 0;
			this.fx.push(['down', h.pid]);
		}
	}

	nearestEnemies(x, y, count, range) {
		const r2max = range * range;
		const picked = [];
		for (let k = 0; k < count; k++) {
			let best = null, bd = r2max;
			for (const e of this.enemies) {
				if (e.dead || picked.includes(e)) continue;
				const d = dist2(x, y, e.x, e.y);
				if (d < bd) {
					bd = d;
					best = e;
				}
			}
			if (!best) break;
			picked.push(best);
		}
		return picked;
	}

	updateWeapon(h, id, w, dt) {
		const L = WEAPONS[id].levels[w.lvl - 1];
		const { dmgMul, cdMul, areaMul } = h.mods;
		if (id === 'orbit') {
			this.orbitHits(h, L, dmgMul, areaMul);
			return;
		}
		w.t -= dt;
		if (w.t > 0) return;
		const dmg = L.dmg * dmgMul;
		switch (id) {
			case 'bolt': {
				const targets = this.nearestEnemies(h.x, h.y, L.count, BOLT_RANGE);
				if (!targets.length) {
					w.t = 0.1;
					return;
				}
				for (let i = 0; i < L.count; i++) {
					const t = targets[i % targets.length];
					const a = Math.atan2(t.y - h.y, t.x - h.x) + (i - (L.count - 1) / 2) * 0.25;
					this.addProjectile(h, 'bolt', a, L.speed, dmg, L.pierce, 2.5, t);
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'knives': {
				// Aim at the nearest enemy: players usually run away from the horde, so facing would shoot into empty space.
				const target = this.nearestEnemies(h.x, h.y, 1, KNIFE_AIM_RANGE)[0];
				const base = target ? Math.atan2(target.y - h.y, target.x - h.x) : Math.atan2(h.fy, h.fx);
				for (let i = 0; i < L.count; i++) {
					this.addProjectile(h, 'knife', base + (i - (L.count - 1) / 2) * L.spread, L.speed, dmg, L.pierce, 1.1, null);
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'whip': {
				const range = L.range * areaMul, width = L.width * areaMul;
				const target = this.nearestEnemies(h.x, h.y, 1, range + width)[0];
				const dir = target ? (target.x >= h.x ? 1 : -1) : (h.fx >= 0 ? 1 : -1);
				this.slash(h, dir, range, width, dmg);
				if (L.both) this.slash(h, -dir, range, width, dmg);
				w.t = L.cd * cdMul;
				return;
			}
			case 'aura': {
				const r = L.radius * areaMul;
				const near = this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2);
				for (const e of near) {
					const rr = r + e.r * 0.5;
					if (!e.dead && dist2(e.x, e.y, h.x, h.y) < rr * rr) this.hurtEnemy(e, dmg, h);
				}
				w.t = L.tick;
				return;
			}
			case 'lightning': {
				const cand = [];
				const R2 = LIGHTNING_RANGE * LIGHTNING_RANGE;
				for (const e of this.enemies) if (!e.dead && dist2(e.x, e.y, h.x, h.y) < R2) cand.push(e);
				if (!cand.length) {
					w.t = 0.2;
					return;
				}
				for (let s = 0; s < L.strikes && cand.length; s++) {
					const idx = Math.floor(Math.random() * cand.length);
					let t = cand[idx];
					cand[idx] = cand[cand.length - 1];
					cand.pop();
					this.fx.push(['zap', Math.round(t.x), Math.round(t.y - 320), Math.round(t.x), Math.round(t.y)]);
					const hit = [t];
					this.hurtEnemy(t, dmg, h);
					const chain = L.chain + h.trait.chainBonus;
					for (let c = 0; c < chain; c++) {
						const next = this.nearestFrom(t, hit, CHAIN_RANGE);
						if (!next) break;
						this.fx.push(['zap', Math.round(t.x), Math.round(t.y), Math.round(next.x), Math.round(next.y)]);
						hit.push(next);
						this.hurtEnemy(next, dmg, h);
						t = next;
					}
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'flask': {
				const targets = this.nearestEnemies(h.x, h.y, L.count, 300);
				for (let i = 0; i < L.count; i++) {
					let x, y;
					const t = targets[i];
					if (t) {
						x = t.x;
						y = t.y;
					} else {
						const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 100;
						x = h.x + Math.cos(a) * d;
						y = h.y + Math.sin(a) * d;
					}
					const z = { id: this.nextId++, owner: h, x, y, r: L.radius * areaMul, life: L.duration, dmg, tick: L.tick, t: 0, slow: h.trait.puddleSlow };
					this.puddles.push(z);
					if (z.slow > 0) this.fx.push(['slowz', z.id]);
				}
				w.t = L.cd * cdMul;
				return;
			}
		}
	}

	nearestFrom(from, exclude, range) {
		const near = this.grid.query(from.x, from.y, range, this.q2);
		let best = null, bd = range * range;
		for (const e of near) {
			if (e.dead || exclude.includes(e)) continue;
			const d = dist2(from.x, from.y, e.x, e.y);
			if (d < bd) {
				bd = d;
				best = e;
			}
		}
		return best;
	}

	slash(h, dir, range, width, dmg) {
		this.fx.push(['slash', h.pid, dir, Math.round(range), Math.round(width)]);
		const cx = h.x + dir * range / 2;
		const near = this.grid.query(cx, h.y, range / 2 + width / 2 + MAX_ENEMY_R, this.q2);
		const x0 = dir > 0 ? h.x : h.x - range, x1 = dir > 0 ? h.x + range : h.x;
		for (const e of near) {
			if (e.dead) continue;
			if (e.x + e.r < x0 || e.x - e.r > x1) continue;
			if (Math.abs(e.y - h.y) > width / 2 + e.r) continue;
			this.hurtEnemy(e, dmg, h);
		}
	}

	orbitHits(h, L, dmgMul, areaMul) {
		const R = L.radius * areaMul;
		const bladeR = ORBIT_BLADE_R * areaMul;
		const near = this.grid.query(h.x, h.y, R + bladeR + MAX_ENEMY_R, this.q2);
		if (!near.length) return;
		const bx = [], by = [];
		for (let i = 0; i < L.count; i++) {
			const a = orbitAngle(this.time, L.rps, i, L.count);
			bx.push(h.x + Math.cos(a) * R);
			by.push(h.y + Math.sin(a) * R);
		}
		for (const e of near) {
			if (e.dead) continue;
			if (e.oh && (e.oh[h.pid] ?? 0) > this.time) continue;
			const rr = (bladeR + e.r) * (bladeR + e.r);
			for (let i = 0; i < bx.length; i++) {
				if (dist2(e.x, e.y, bx[i], by[i]) < rr) {
					(e.oh ??= {})[h.pid] = this.time + L.hitCd;
					this.hurtEnemy(e, L.dmg * dmgMul, h);
					break;
				}
			}
		}
	}

	addProjectile(h, kind, ang, speed, dmg, pierce, life, target) {
		const p = {
			id: this.nextId++, kind: KIND_INDEX[kind], owner: h, x: h.x, y: h.y,
			vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, speed, dmg, pierce, life, target, hit: [],
		};
		this.projectiles.push(p);
		// Projectiles often live shorter than a snapshot interval, so clients simulate them from events.
		this.fx.push(['shot', p.id, p.kind, Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy),
			round3(life), target ? target.id : -1, round3(this.time)]);
	}

	endProjectile(p) {
		this.fx.push(['pend', p.id, Math.round(p.x), Math.round(p.y), round3(this.time)]);
	}

	updateProjectiles(dt) {
		const near = this.q1;
		let j = 0;
		for (const p of this.projectiles) {
			p.life -= dt;
			if (p.life <= 0 || p.pierce <= 0) {
				this.endProjectile(p);
				continue;
			}
			if (p.target) {
				if (p.target.dead) {
					p.target = this.nearestEnemies(p.x, p.y, 1, 400)[0] ?? null;
					this.fx.push(['ptgt', p.id, p.target ? p.target.id : -1, round3(this.time)]);
				}
				if (p.target) {
					const dx = p.target.x - p.x, dy = p.target.y - p.y;
					const d = Math.hypot(dx, dy) || 1;
					const k = Math.min(1, dt * 10);
					p.vx += ((dx / d) * p.speed - p.vx) * k;
					p.vy += ((dy / d) * p.speed - p.vy) * k;
					const v = Math.hypot(p.vx, p.vy) || 1;
					p.vx = (p.vx / v) * p.speed;
					p.vy = (p.vy / v) * p.speed;
				}
			}
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			this.grid.query(p.x, p.y, PROJ_R + MAX_ENEMY_R, near);
			for (const e of near) {
				if (e.dead || p.hit.includes(e.id)) continue;
				const min = e.r + PROJ_R;
				if (dist2(e.x, e.y, p.x, p.y) >= min * min) continue;
				p.hit.push(e.id);
				this.hurtEnemy(e, p.dmg, p.owner);
				if (--p.pierce <= 0) break;
				if (p.target === e) {
					p.target = null;
					this.fx.push(['ptgt', p.id, -1, round3(this.time)]);
				}
			}
			if (p.pierce > 0) this.projectiles[j++] = p;
			else this.endProjectile(p);
		}
		this.projectiles.length = j;
	}

	updatePuddles(dt) {
		const near = this.q1;
		let j = 0;
		for (const z of this.puddles) {
			z.life -= dt;
			if (z.life <= 0) continue;
			if (z.slow > 0) this.slowInPuddle(z);
			z.t -= dt;
			if (z.t <= 0) {
				z.t = z.tick;
				this.grid.query(z.x, z.y, z.r + MAX_ENEMY_R, near);
				for (const e of near) {
					const rr = z.r + e.r * 0.5;
					if (!e.dead && dist2(e.x, e.y, z.x, z.y) < rr * rr) this.hurtEnemy(e, z.dmg, z.owner);
				}
			}
			this.puddles[j++] = z;
		}
		this.puddles.length = j;
	}

	slowInPuddle(z) {
		const near = this.grid.query(z.x, z.y, z.r + MAX_ENEMY_R, this.q2);
		for (const e of near) {
			const rr = z.r + e.r * 0.5;
			if (e.dead || dist2(e.x, e.y, z.x, z.y) >= rr * rr) continue;
			if (e.slowT <= this.time || z.slow > e.slow) e.slow = z.slow;
			e.slowT = this.time + SLOW_HOLD;
		}
	}

	// Herald-like heroes heal other alive players standing inside their aura.
	auraHeals(dt, alive) {
		for (const h of alive) {
			if (h.st !== 0 || h.trait.auraHeal <= 0) continue;
			const w = h.weapons.get('aura');
			if (!w) continue;
			const r = WEAPONS.aura.levels[w.lvl - 1].radius * h.mods.areaMul;
			for (const o of alive) {
				if (o === h || o.st !== 0 || dist2(o.x, o.y, h.x, h.y) >= r * r) continue;
				o.hp = Math.min(o.maxHp, o.hp + h.trait.auraHeal * dt);
			}
		}
	}

	updateGems(dt, alive) {
		if (!alive.length) return;
		let j = 0;
		for (const g of this.gems) {
			let best = null, bd = Infinity;
			for (const h of alive) {
				if (h.st !== 0) continue;
				const d = dist2(g.x, g.y, h.x, h.y);
				const mr = BASE_MAGNET * h.mods.magnetMul;
				if (d < mr * mr && d < bd) {
					bd = d;
					best = h;
				}
			}
			if (best) {
				const d = Math.sqrt(bd);
				if (d < PLAYER_RADIUS + 6) {
					this.collectGem(best, g.xp);
					continue;
				}
				const step = Math.min(d, GEM_PULL_SPEED * dt);
				g.x += ((best.x - g.x) / d) * step;
				g.y += ((best.y - g.y) / d) * step;
			}
			this.gems[j++] = g;
		}
		this.gems.length = j;
	}

	collectGem(h, xp) {
		this.addXp(h, xp);
		for (const o of this.heroes.values()) if (o !== h && o.st === 0) this.addXp(o, xp * GEM_SHARE);
	}

	addXp(h, xp) {
		h.xp += xp;
		let need = xpForNext(h.level);
		while (h.xp >= need) {
			h.xp -= need;
			h.level++;
			this.fx.push(['lvl', h.pid]);
			this.grantOffer(h);
			need = xpForNext(h.level);
		}
	}

	updateRevive(dt) {
		const rate = (100 / REVIVE_SECONDS) * dt;
		for (const h of this.heroes.values()) {
			if (h.st !== 1) continue;
			let helped = false;
			for (const o of this.heroes.values()) {
				if (o.st === 0 && dist2(o.x, o.y, h.x, h.y) < REVIVE_RADIUS * REVIVE_RADIUS) {
					helped = true;
					break;
				}
			}
			h.rev = helped ? h.rev + rate : Math.max(0, h.rev - rate * 0.5);
			if (h.rev >= 100) {
				h.st = 0;
				h.rev = 0;
				h.hp = h.maxHp * REVIVE_HP_FRACTION;
				h.iframes = REVIVE_IFRAMES;
				h.lastPosT = this.time;
				this.fx.push(['up', h.pid]);
			}
		}
	}

	checkAllDown() {
		if (this.state !== 'play' || this.heroes.size === 0) return false;
		for (const h of this.heroes.values()) if (h.st === 0) return false;
		this.finish(false);
		return true;
	}

	finish(win) {
		this.snapshot();
		this.state = 'over';
		for (const h of this.heroes.values()) {
			h.offer = null;
			h.queue = 0;
		}
		this.overMsg = {
			t: 'over', win, time: Math.round(this.time * 10) / 10, host: this.host,
			stats: [...this.heroes.values()].map((h) => ({ pid: h.pid, name: h.name, hero: h.hero, kills: h.kills, dmg: Math.round(h.dmg), level: h.level })),
		};
		this.broadcast(this.overMsg);
	}

	snapshot() {
		const ps = [...this.heroes.values()];
		const visible = (x, y) => {
			for (const h of ps) if (dist2(x, y, h.x, h.y) < VIEW_DIST2) return true;
			return false;
		};
		const p = ps.map((h) => [
			h.pid, Math.round(h.x), Math.round(h.y), Math.ceil(h.hp), Math.round(h.maxHp), h.level,
			Math.floor(h.xp), xpForNext(h.level), h.st, Math.round(h.rev), r2(h.fx), r2(h.fy),
			[...h.weapons].map(([id, w]) => [id, w.lvl]),
		]);
		const e = [];
		for (const en of this.enemies) {
			if (en.dead || !visible(en.x, en.y)) continue;
			e.push(en.id, en.type, Math.round(en.x), Math.round(en.y), clamp(Math.ceil((en.hp / en.maxHp) * 100), 1, 100));
		}
		const b = []; // projectiles travel as shot/ptgt/pend events in fx
		const g = [];
		for (const gm of this.gems) {
			if (!visible(gm.x, gm.y)) continue;
			g.push(gm.id, Math.round(gm.x), Math.round(gm.y), gm.xp <= 2 ? 0 : gm.xp <= 9 ? 1 : 2);
		}
		const z = [];
		for (const pz of this.puddles) z.push(pz.id, Math.round(pz.x), Math.round(pz.y), Math.round(pz.r));
		const boss = this.bosses.find((x) => !x.dead);
		const msg = {
			t: 's', tm: Math.round(this.time * 100) / 100, k: this.kills, p, e, b, g, z,
			fx: this.fx, boss: boss ? [Math.ceil(boss.hp), Math.round(boss.maxHp)] : null,
		};
		this.fx = [];
		this.hitFx = 0;
		this.dieFx = 0;
		this.broadcast(msg);
		return msg;
	}
}

// Lobby/rooms router. Knows nothing about transports: everything goes through send(pid, msg, json?).
export class Hub {
	constructor(send) {
		this.send = send;
		this.players = new Map(); // pid -> {pid, name, room}
		this.rooms = new Map();
	}

	addPlayer(pid, name) {
		this.players.set(pid, { pid, name, room: null });
	}

	// Called on every (re)connection.
	welcome(pid) {
		const p = this.players.get(pid);
		if (!p) return;
		this.send(pid, { t: 'welcome', pid, name: p.name, room: p.room?.code ?? null });
		if (p.room) p.room.resync(pid);
	}

	removePlayer(pid) {
		this.leaveRoom(pid);
		this.players.delete(pid);
	}

	leaveRoom(pid) {
		const p = this.players.get(pid);
		const room = p?.room;
		if (!room) return;
		p.room = null;
		room.removePlayer(pid);
		if (room.size === 0) this.rooms.delete(room.code);
		this.pushRooms();
	}

	roomList() {
		const out = [];
		for (const r of this.rooms.values()) {
			if (r.state !== 'lobby') continue;
			out.push({ code: r.code, host: r.members.get(r.host)?.name ?? '', players: r.size, state: r.state });
		}
		return out;
	}

	// Pushes the room list to everyone who is in the menu.
	pushRooms() {
		const msg = { t: 'rooms', rooms: this.roomList() };
		const json = JSON.stringify(msg);
		for (const p of this.players.values()) if (!p.room) this.send(p.pid, msg, json);
	}

	newCode() {
		for (;;) {
			let c = '';
			for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
			if (!this.rooms.has(c)) return c;
		}
	}

	handle(pid, msg) {
		const p = this.players.get(pid);
		if (!p || !msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return;
		const err = (text) => this.send(pid, { t: 'err', msg: text });
		switch (msg.t) {
			case 'ping': {
				const c = msg.c;
				if (num(c) !== null || (typeof c === 'string' && c.length <= 32)) this.send(pid, { t: 'pong', c });
				return;
			}
			case 'name': {
				const name = sanitizeName(msg.name);
				if (!name) return err('Пустое имя');
				p.name = name;
				p.room?.rename(pid, name);
				return;
			}
			case 'list':
				this.send(pid, { t: 'rooms', rooms: this.roomList() });
				return;
			case 'create': {
				this.leaveRoom(pid);
				const room = new Room(this.newCode(), this.send);
				this.rooms.set(room.code, room);
				room.addPlayer(pid, p.name, msg.hero);
				p.room = room;
				this.pushRooms();
				return;
			}
			case 'join': {
				const code = typeof msg.code === 'string' ? msg.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : '';
				const room = this.rooms.get(code);
				if (!room) return err('Комната не найдена');
				if (p.room === room) {
					room.resync(pid);
					return;
				}
				if (room.state !== 'lobby') return err('Игра в этой комнате уже идёт');
				if (room.size >= MAX_PLAYERS) return err('Комната заполнена');
				this.leaveRoom(pid);
				const e = room.addPlayer(pid, p.name, msg.hero);
				if (e) return err(e);
				p.room = room;
				this.pushRooms();
				return;
			}
			case 'leave':
				this.leaveRoom(pid);
				return;
			default: {
				const room = p.room;
				if (!room) return;
				room.handle(pid, msg);
				if (msg.t === 'start' || msg.t === 'again') this.pushRooms();
			}
		}
	}

	tick(dt) {
		for (const r of this.rooms.values()) r.tick(dt);
	}
}
