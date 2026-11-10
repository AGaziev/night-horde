import {
	TICK_HZ, SNAPSHOT_HZ, MAX_PLAYERS, RUN_SECONDS, MAX_ENEMIES, MAX_GEMS, PLAYER_RADIUS,
	REVIVE_RADIUS, REVIVE_SECONDS, REVIVE_HP_FRACTION, PLAYER_IFRAMES, GEM_SHARE, MAX_LEVEL,
	MAX_WEAPONS, MAX_PASSIVES, BOSS_TIMES, xpForNext, PLAYER_COLORS, HEROES, WEAPONS, PASSIVES,
	BASE_MAGNET, GEM_PULL_SPEED, ENEMIES, ENEMY_TYPES, PROJECTILE_KINDS, WEAPON_IDS, PASSIVE_IDS,
	WAVES, enemyHpScale, spawnRateScale, SPAWN_DISTANCE, orbitAngle, heroTrait, enemyDmgScale, INVASION, invasionCount, ELITE_EVERY_LATE,
	passiveValue, baseMods, REROLLS_START, SKIP_XP, RARE_CHANCE, CHEST_RARE_CHANCE, HEAL_OFFER_HP, ST,
	ELITE_START, ELITE_EVERY, ELITE_HP_MUL, ELITE_R_MUL, ELITE_CHEST_CHANCE, ELITE_AFFIXES,
	GOLD_GEM_CHANCE, GOLD_GEM_MUL, GEM_SWEEP_EVERY, GEM_SWEEP_PLACE, gemTier, ITEMS, ITEM_TYPES, ITEM_LIFE,
	MAGNET_ITEM_EVERY, BREAK_TILE, BREAK_R, BREAK_DROPS, breakableAt, HOSTILE_R,
	DUOS, DUO_IDS, DUO_BY_PAIR, duoKey, MAX_DUOS, DUO_MIN_LEVEL, DUO_DEFER_OFFERS, duoStartLevel, weaponDef, weaponMaxLevel,
	SYNERGY_PER, SYNERGY_MAX, ROMAN,
} from '../public/shared/content.js';

const SNAPSHOT_EVERY = Math.max(1, Math.round(TICK_HZ / SNAPSHOT_HZ));
const CELL = 64;
const MAX_ENEMY_R = Math.max(...Object.values(ENEMIES).map((e) => e.r));
const VIEW_DIST2 = 1000 * 1000;
const FAR_DIST2 = 1400 * 1400;
const WORLD_LIMIT = 100000;
const MAX_HIT_FX = 32;
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
const MAX_CRIT_FX = 12;
const WET_HOLD = 0.5;
const BURN_TICK = 0.5;
const SICKLE_CATCH = PLAYER_RADIUS + 10;
const TRAP_ARM = 0.25;
const TRAP_FAR2 = 1200 * 1200;
const TRAP_BEHIND = 30;
const MOVE_RECENT = 0.3;
const SPLASH_FRAC = 0.5;
const DENSE_R = 80;
const BOMB_RANGE = 320;
const LEECH_EVERY = 0.5;
const LEECH_R = 120;
const LEECH_FRAC = 0.02;
const BLINK_EVERY = 3;
const BLINK_DIST = 120;
const VOLATILE_R = 90;
const ITEM_PICK_R = PLAYER_RADIUS + 16;
const MAX_ITEMS = 80;
const ELITE_PICK_DIST2 = 800 * 800;
const ELITE_AFFIX_INDEX = Object.fromEntries(ELITE_AFFIXES.map((a, i) => [a.id, i]));
const ITEM_INDEX = Object.fromEntries(ITEM_TYPES.map((t, i) => [t, i]));
const BREAK_DROP_TOTAL = BREAK_DROPS.reduce((s, [, w]) => s + w, 0);
// Damage sources: weapon id (for per-weapon stats) and tags (for armor and reactions).
const SRC = Object.fromEntries([...WEAPON_IDS, ...DUO_IDS].map((id) => [id, { weapon: id, tags: weaponDef(id).tags ?? [] }]));
const SRC_NONE = { weapon: 'other', tags: [] };
const SRC_BLAST = { weapon: 'blast', tags: ['fire', 'aoe'] };
const SRC_BURN = { weapon: 'burn', tags: ['fire'] };
const SRC_CRACKER = { weapon: 'cracker', tags: ['aoe'], raw: true }; // raw: fixed damage, no multipliers
const FORGE_CARD = { id: 'forge', kind: 'rare', name: 'Кузня удачи', icon: '⚒', desc: '+1 уровень двум оружиям', level: 0 };
const shuffle = (a) => {
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
};
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
	tick: 'такт', rps: 'скорость', speed: 'скорость', fuse: 'фитиль', slow: 'замедление', dur: 'длительность',
	freeze: 'заморозка', max: 'капканов', root: 'удержание', splash: 'осколки',
};
const PCT_STATS = new Set(['slow']);

function upgradeDesc(weaponId, toLevel) {
	const W = weaponDef(weaponId);
	const a = W.levels[toLevel - 2], b = W.levels[toLevel - 1];
	const parts = [];
	for (const k of Object.keys(b)) {
		if (k === 'both') {
			if (b.both && !a.both) parts.push('удар в обе стороны');
			continue;
		}
		if (a[k] !== b[k] && STAT_LABELS[k] && k !== 'speed' && k !== 'spread' && k !== 'hitCd' && k !== 'fuse') {
			const f = (v) => (PCT_STATS.has(k) ? `${Math.round(v * 100)}%` : v);
			parts.push(k === 'freeze' && !a[k] ? `заморозка ${b[k]} с` : `${STAT_LABELS[k]} ${f(a[k])}→${f(b[k])}`);
		}
	}
	return parts.join(', ') || W.desc;
}

function makeHero(member, x, y) {
	const h = HEROES[member.hero];
	return {
		pid: member.pid, name: member.name, hero: member.hero, color: member.color,
		x, y, fx: 1, fy: 0, lastPosT: 0, mvx: 1, mvy: 0, movedT: -1, trapRing: 0, rageT: 0,
		hp: h.hp, baseHp: h.hp, maxHp: h.hp, speed: h.speed,
		level: 1, xp: 0, st: 0, rev: 0, iframes: 0,
		weapons: new Map([[h.weapon, { lvl: 1, t: 0.3 }]]),
		trait: heroTrait(member.hero),
		passives: new Map(),
		mods: baseMods(),
		kills: 0, dmg: 0, dmgBy: {},
		offer: null, queue: 0, boostQueue: 0, rerolls: REROLLS_START, lastOfferNewW: false, combos: [],
		fused: new Set(), duoDefer: {}, offerNo: 0, startWeapon: h.weapon,
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
			broken: this.brokenList ?? [],
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
			case 'reroll':
				this.onReroll(pid);
				break;
			case 'skip':
				this.onSkip(pid);
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
		this.hostile = [];
		this.blasts = [];
		this.traps = [];
		this.items = [];
		this.broken = new Set();
		this.brokenList = [];
		this.nextEliteT = ELITE_START;
		this.nextInvasionT = INVASION.from;
		this.nextGemSweep = GEM_SWEEP_EVERY;
		this.nextMagnetT = MAGNET_ITEM_EVERY;
		this.critFx = 0;
		this.orbs = [];
		this.timers = [];
		this.synergy = 0;
		this.spawnAcc = 0;
		this.fx = [];
		this.hitFx = 0;
		this.dieFx = 0;
		this.grid = new Grid(CELL);
		this.q1 = [];
		this.q2 = [];
		this.q3 = [];
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
			if (d > 0.5) {
				h.mvx = dx / d;
				h.mvy = dy / d;
				h.movedT = this.time;
			}
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

	// `boost` — extra chance for a rare card (small chest).
	grantOffer(h, boost = false) {
		if (boost) h.boostQueue++;
		if (h.offer) {
			h.queue++;
			this.sendOffer(h);
		} else {
			h.offer = this.makeChoices(h);
			this.sendOffer(h);
		}
	}

	sendOffer(h) {
		this.send(h.pid, {
			t: 'lvl', choices: h.offer, pending: h.queue, rerolls: h.rerolls, skipXp: SKIP_XP,
			slots: [h.weapons.size, MAX_WEAPONS, h.passives.size, MAX_PASSIVES],
		});
	}

	// Weighted offer (G4): slot 1 — upgrade of something owned, slot 2 — 50/50 upgrade or new, slot 3 — anything.
	// A new weapon is offered in at most every other offer; low hp turns slot 3 into healing.
	makeChoices(h) {
		const boost = h.boostQueue > 0;
		if (boost) h.boostQueue--;
		h.offerNo++;
		this.updateCombos(h);
		const ups = [], newW = [], newP = [];
		for (const id of [...WEAPON_IDS, ...DUO_IDS]) {
			const w = h.weapons.get(id);
			const W = weaponDef(id);
			if (w) {
				if (w.lvl < weaponMaxLevel(id)) ups.push({ id, kind: 'weapon', name: W.name, icon: W.icon, desc: upgradeDesc(id, w.lvl + 1), level: w.lvl + 1, duo: DUOS[id] ? 1 : undefined });
			} else if (!DUOS[id] && !h.fused.has(id) && h.weapons.size < MAX_WEAPONS) {
				const card = { id, kind: 'weapon', name: W.name, icon: W.icon, desc: W.desc, level: 1 };
				newW.push(card);
				// The hero's starting weapon pulls its duo partners: weight ×2.
				if (DUO_BY_PAIR[duoKey(id, h.startWeapon)] && !h.fused.has(h.startWeapon)) newW.push(card);
			}
		}
		for (const id of PASSIVE_IDS) {
			const lvl = h.passives.get(id) ?? 0;
			const P = PASSIVES[id];
			if (lvl ? lvl < MAX_LEVEL : h.passives.size < MAX_PASSIVES) {
				(lvl ? ups : newP).push({ id, kind: 'passive', name: P.name, icon: P.icon, desc: P.desc, level: lvl + 1 });
			}
		}
		shuffle(ups);
		shuffle(newW);
		shuffle(newP);
		const out = [];
		const used = new Set();
		let newWTaken = false;
		const allowNewW = !h.lastOfferNewW;
		const take = (arr) => {
			for (const c of arr) {
				const key = c.kind + c.id;
				if (used.has(key) || (c.kind === 'weapon' && c.level === 1 && (newWTaken || !allowNewW))) continue;
				used.add(key);
				out.push(c);
				if (c.kind === 'weapon' && c.level === 1) newWTaken = true;
				return true;
			}
			return false;
		};
		const fresh = () => shuffle([...newW, ...newP]);
		// A ready duo goes to slot 1 (unless the player declined it recently).
		const ready = h.combos.find((c) => c.ready && !(h.duoDefer[c.id] > h.offerNo));
		if (ready) out.push(this.duoCard(h, ready));
		else if (!take(ups)) take(fresh());
		if (Math.random() < 0.5) {
			if (!take(ups)) take(fresh());
		} else if (!take(fresh())) take(ups);
		take(shuffle([...ups, ...newW, ...newP]));
		h.lastOfferNewW = newWTaken;
		const heal = { id: 'heal', kind: 'heal', name: 'Лечение', icon: '✚', desc: `+${HEAL_AMOUNT} здоровья`, level: 0 };
		if (out.length === 0) return [heal];
		for (const c of out) this.duoHint(h, c);
		const slot3 = Math.min(2, out.length);
		if (h.st === 0 && h.hp < h.maxHp * HEAL_OFFER_HP) {
			out[slot3] = { ...heal, desc: `+${HEAL_AMOUNT} здоровья (здоровья меньше ${Math.round(HEAL_OFFER_HP * 100)}%)` };
		} else {
			const rare = (boost ? CHEST_RARE_CHANCE : RARE_CHANCE) * (1 + h.mods.luck);
			if (Math.random() < rare && [...h.weapons].some(([id, w]) => w.lvl < weaponMaxLevel(id))) out[slot3] = { ...FORGE_CARD };
		}
		return out;
	}

	duoCard(h, c) {
		const D = DUOS[c.id];
		const level = duoStartLevel(h.weapons.get(c.a).lvl + h.weapons.get(c.b).lvl);
		return {
			id: c.id, kind: 'duo', name: D.name, icon: D.icon, desc: D.desc, level, parts: [c.a, c.b],
			partNames: [WEAPONS[c.a].name, WEAPONS[c.b].name], partIcons: [WEAPONS[c.a].icon, WEAPONS[c.b].icon],
		};
	}

	// «🔗 с Грозой → Громовой разрез (нужно 3 + 3)» on weapon cards that pair with something already owned.
	duoHint(h, c) {
		if (c.kind !== 'weapon' || DUOS[c.id] || this.duoCount(h) >= MAX_DUOS) return;
		for (const [id] of h.weapons) {
			if (id === c.id || DUOS[id]) continue;
			const duo = DUO_BY_PAIR[duoKey(c.id, id)];
			if (duo) {
				c.duoHint = { with: id, withName: WEAPONS[id].name, id: duo, name: DUOS[duo].name, need: DUO_MIN_LEVEL };
				return;
			}
		}
	}

	duoCount(h) {
		let n = 0;
		for (const id of h.weapons.keys()) if (DUOS[id]) n++;
		return n;
	}

	// The two parts leave, the duo takes the first part's slot (Map order is the HUD order).
	fuseDuo(h, card) {
		const [a, b] = card.parts;
		if (!h.weapons.has(a) || !h.weapons.has(b) || this.duoCount(h) >= MAX_DUOS) return false;
		const next = new Map();
		for (const [id, w] of h.weapons) {
			if (id === a) next.set(card.id, { lvl: card.level, t: 0.3 });
			else if (id !== b) next.set(id, w);
		}
		h.weapons = next;
		h.fused.add(a);
		h.fused.add(b);
		this.traps = this.traps.filter((t) => t.owner !== h); // trap-based parts start a fresh field
		this.fx.push(['duo', h.pid, card.id]);
		this.updateSynergy();
		return true;
	}

	// «Слаженность»: +4% damage for the whole team per unique duo in the party (identical duos count once).
	updateSynergy() {
		const ids = new Set();
		for (const p of this.heroes.values()) for (const id of p.weapons.keys()) if (DUOS[id]) ids.add(id);
		this.synergy = Math.min(SYNERGY_MAX, SYNERGY_PER * ids.size);
	}

	onPick(pid, msg) {
		if (this.state !== 'play') return;
		const h = this.heroes.get(pid);
		const i = num(msg.i);
		if (!h?.offer || i === null || !Number.isInteger(i) || i < 0 || i >= h.offer.length) return;
		const c = h.offer[i];
		this.deferSkippedDuos(h, c);
		if (c.kind === 'duo') {
			this.fuseDuo(h, c);
		} else if (c.kind === 'weapon') {
			const w = h.weapons.get(c.id);
			if (w) w.lvl = Math.min(weaponMaxLevel(c.id), w.lvl + 1);
			else h.weapons.set(c.id, { lvl: 1, t: 0.2 });
		} else if (c.kind === 'passive') {
			h.passives.set(c.id, Math.min(MAX_LEVEL, (h.passives.get(c.id) ?? 0) + 1));
			const before = h.maxHp;
			this.recalcMods(h);
			if (h.maxHp > before && h.st === 0) h.hp += h.maxHp - before;
		} else if (c.kind === 'rare') {
			const list = shuffle([...h.weapons].filter(([id, w]) => w.lvl < weaponMaxLevel(id)));
			for (const [, w] of list.slice(0, 2)) w.lvl++;
		} else if (h.st === 0) {
			h.hp = Math.min(h.maxHp, h.hp + HEAL_AMOUNT);
		}
		if (c.kind === 'weapon' || c.kind === 'rare' || c.kind === 'duo') this.updateCombos(h);
		this.nextOffer(h);
	}

	// A duo card that was not taken (another card or «Отказаться») comes back after DUO_DEFER_OFFERS offers.
	deferSkippedDuos(h, picked) {
		for (const c of h.offer ?? []) if (c.kind === 'duo' && c !== picked) h.duoDefer[c.id] = h.offerNo + DUO_DEFER_OFFERS;
	}

	// The single place where owned weapon pairs are matched against DUOS: h.combos = [{id, a, b, ready}].
	updateCombos(h) {
		const own = [...h.weapons].filter(([id]) => !DUOS[id]);
		const out = [];
		if (this.duoCount(h) < MAX_DUOS) {
			for (let i = 0; i < own.length; i++) {
				for (let j = i + 1; j < own.length; j++) {
					const id = DUO_BY_PAIR[duoKey(own[i][0], own[j][0])];
					if (!id) continue;
					const ready = own[i][1].lvl >= DUO_MIN_LEVEL && own[j][1].lvl >= DUO_MIN_LEVEL;
					out.push({ id, a: own[i][0], b: own[j][0], ready, sum: own[i][1].lvl + own[j][1].lvl });
				}
			}
		}
		out.sort((x, y) => y.sum - x.sum);
		h.combos = out;
		return out;
	}

	nextOffer(h) {
		h.offer = null;
		if (h.queue > 0) {
			h.queue--;
			h.offer = this.makeChoices(h);
			this.sendOffer(h);
		}
	}

	onReroll(pid) {
		if (this.state !== 'play') return;
		const h = this.heroes.get(pid);
		if (!h?.offer || h.rerolls <= 0) return;
		h.rerolls--;
		h.offer = this.makeChoices(h);
		this.sendOffer(h);
	}

	// Declining the whole offer gives SKIP_XP instead (no junk in slots).
	onSkip(pid) {
		if (this.state !== 'play') return;
		const h = this.heroes.get(pid);
		if (!h?.offer) return;
		this.deferSkippedDuos(h, null);
		this.nextOffer(h);
		this.addXp(h, SKIP_XP);
	}

	recalcMods(h) {
		const m = { ...baseMods(), maxHp: 0 };
		for (const [id, lvl] of h.passives) {
			const P = PASSIVES[id];
			m[P.stat] += passiveValue(id, lvl);
			for (const [k, arr] of Object.entries(P.extra ?? {})) m[k] = Math.max(m[k], arr[Math.min(arr.length, lvl) - 1]);
		}
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
		this.updateHostile(dt);
		this.updateBlasts();
		this.updateOrbs(dt);
		this.updateTimers();
		this.updateTraps(dt);
		this.updatePuddles(dt);
		this.compactEnemies();
		this.updateGems(dt, alive);
		this.updateItems(dt, alive);
		this.updateRevive(dt);
		if (alive.length) {
			if (this.time >= this.nextEliteT) {
				this.nextEliteT = this.time + (this.time >= 600 ? ELITE_EVERY_LATE : ELITE_EVERY);
				this.makeElite(alive);
			}
			if (this.time >= this.nextInvasionT) {
				this.nextInvasionT = this.time + INVASION.every;
				this.invasion(alive);
			}
			if (this.time >= this.nextGemSweep) {
				this.nextGemSweep = this.time + GEM_SWEEP_EVERY;
				this.sweepFarGems(alive);
			}
		}

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
			id: this.nextId++, type: TYPE_INDEX[type], def: E, x, y, hp, maxHp: hp,
			speed: E.speed * (0.9 + Math.random() * 0.2), dmg: E.dmg * enemyDmgScale(this.time), dmgMul: enemyDmgScale(this.time), r: E.r, xp: E.xp,
			dead: false, zig: type === 'wisp', phase: Math.random() * Math.PI * 2, oh: null,
			boss: type === 'boss', ai: E.ai ?? null,
			slow: 0, slowT: 0, frozenT: 0, rootT: 0, wetT: 0, markT: 0, markMul: 0,
			burnT: 0, burnDps: 0, burnOwner: null, burnAcc: 0,
			elite: null, windT: 0, fuseT: 0, shotT: E.shotCd ? E.shotCd * (0.5 + Math.random() * 0.5) : 0,
			fuseBy: null, exploded: false, auxT: 0,
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
		const wave = this.currentWave();
		this.spawnAcc += wave.rate * spawnRateScale(n) * dt;
		if (this.spawnAcc < 1) return;
		const hpMul = enemyHpScale(this.time, n);
		while (this.spawnAcc >= 1) {
			this.spawnAcc -= 1;
			if (this.enemies.length >= MAX_ENEMIES) {
				this.spawnAcc = 0;
				break;
			}
			this.spawnEnemy(this.waveType(wave), alive, hpMul);
		}
	}

	currentWave() {
		let wave = WAVES[0];
		for (const w of WAVES) if (w.at <= this.time) wave = w;
		return wave;
	}

	waveType(wave) {
		const types = Object.entries(wave.types);
		let r = Math.random() * types.reduce((s, [, w]) => s + w, 0);
		for (const [t, w] of types) if ((r -= w) <= 0) return t;
		return types[0][0];
	}

	// A ring of the current wave's enemies around every alive player, closing in (may exceed the cap a little).
	invasion(alive) {
		const wave = this.currentWave();
		const count = invasionCount(this.time, this.heroes.size);
		if (count <= 0) return;
		const hpMul = enemyHpScale(this.time, this.heroes.size);
		const cap = MAX_ENEMIES + 60;
		for (const h of alive) {
			this.fx.push(['inv', h.pid, INVASION.radius]);
			for (let i = 0; i < count && this.enemies.length < cap; i++) {
				const e = this.spawnEnemy(this.waveType(wave), alive, hpMul);
				const a = (i / count) * Math.PI * 2;
				e.x = h.x + Math.cos(a) * INVASION.radius;
				e.y = h.y + Math.sin(a) * INVASION.radius;
			}
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
		const now = this.time;
		for (const e of this.enemies) {
			if (e.dead) continue;
			if (e.burnT > now) this.burnTick(e, dt);
			if (e.dead) continue;
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
				e.windT = 0;
				continue;
			}
			if (taunters.length) [best, bd] = this.tauntTarget(e, taunters, best, bd);
			if (e.elite) this.eliteTick(e, best, dt);
			if (e.frozenT > now || e.rootT > now) continue;
			let dx = best.x - e.x, dy = best.y - e.y;
			const d = Math.sqrt(bd) || 1;
			dx /= d;
			dy /= d;
			// Stop at contact distance so enemies don't stack on the player.
			let speed = e.slowT > now ? e.speed * (1 - e.slow) : e.speed;
			let maxStep = Math.max(0, d - e.r - PLAYER_RADIUS + 2);
			if (e.ai === 'ranged') {
				if (this.rangedTick(e, best, d, dt)) continue;
				const [kmin, kmax] = e.def.keep;
				if (d < kmin) {
					dx = -dx;
					dy = -dy;
					maxStep = Infinity;
				} else if (d <= kmax) {
					// Strafe around the target inside the keep ring.
					const s = Math.sin(e.phase) >= 0 ? 1 : -1;
					[dx, dy] = [-dy * s, dx * s];
					speed *= 0.5;
				}
			} else if (e.ai === 'exploder' && e.fuseT > 0) {
				e.fuseT -= dt;
				if (e.fuseT <= 0) this.killEnemy(e, e.fuseBy, SRC_BLAST);
				continue;
			}
			if (e.zig) {
				const s = Math.sin(now * 5 + e.phase) * 0.9;
				const zx = dx - dy * s, zy = dy + dx * s;
				const l = Math.hypot(zx, zy) || 1;
				dx = zx / l;
				dy = zy / l;
			}
			const step = Math.min(speed * dt, maxStep);
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

	// Ranged enemy: wind up, then spit at the target's current position. Returns true while it stands still.
	rangedTick(e, target, d, dt) {
		const E = e.def;
		if (e.windT > 0) {
			e.windT -= dt;
			if (e.windT <= 0) {
				e.windT = 0;
				this.fireHostile(e, target);
			}
			return true;
		}
		e.shotT -= dt;
		if (e.shotT <= 0 && d < E.keep[1] + 80) {
			e.windT = E.windup;
			e.shotT = E.shotCd;
			return true;
		}
		return false;
	}

	fireHostile(e, target) {
		const E = e.def;
		const dx = target.x - e.x, dy = target.y - e.y;
		const d = Math.hypot(dx, dy) || 1;
		const s = {
			id: this.nextId++, x: e.x, y: e.y, vx: (dx / d) * E.shotSpeed, vy: (dy / d) * E.shotSpeed,
			life: E.shotLife, dmg: E.shotDmg * e.dmgMul,
		};
		this.hostile.push(s);
		this.fx.push(['eshot', s.id, Math.round(s.x), Math.round(s.y), Math.round(s.vx), Math.round(s.vy), round3(s.life), round3(this.time)]);
	}

	updateHostile(dt) {
		let j = 0;
		for (const s of this.hostile) {
			s.life -= dt;
			s.x += s.vx * dt;
			s.y += s.vy * dt;
			let done = s.life <= 0;
			if (!done) {
				const min = HOSTILE_R + PLAYER_RADIUS;
				for (const h of this.heroes.values()) {
					if (h.st !== 0 || dist2(h.x, h.y, s.x, s.y) >= min * min) continue;
					if (h.iframes <= 0) this.hurtPlayer(h, s.dmg);
					done = true;
					break;
				}
			}
			if (done) this.fx.push(['epend', s.id, round3(this.time)]);
			else this.hostile[j++] = s;
		}
		this.hostile.length = j;
	}

	eliteTick(e, target, dt) {
		if (e.elite === 'leech') {
			e.auxT -= dt;
			if (e.auxT > 0) return;
			e.auxT = LEECH_EVERY;
			for (const o of this.grid.query(e.x, e.y, LEECH_R, this.q3)) {
				if (o === e || o.dead || dist2(o.x, o.y, e.x, e.y) > LEECH_R * LEECH_R) continue;
				o.hp = Math.min(o.maxHp, o.hp + o.maxHp * LEECH_FRAC * LEECH_EVERY);
			}
		} else if (e.elite === 'blink') {
			e.auxT -= dt;
			if (e.auxT > 0 || e.frozenT > this.time || e.rootT > this.time) return;
			e.auxT = BLINK_EVERY;
			const dx = target.x - e.x, dy = target.y - e.y;
			const d = Math.hypot(dx, dy) || 1;
			const step = Math.min(BLINK_DIST, Math.max(0, d - e.r - PLAYER_RADIUS - 20));
			this.fx.push(['blink', Math.round(e.x), Math.round(e.y)]);
			e.x += (dx / d) * step;
			e.y += (dy / d) * step;
		}
	}

	// Once in a while a regular enemy near the players turns into an elite with one affix.
	makeElite(alive) {
		const cand = [];
		for (const e of this.enemies) {
			if (e.dead || e.boss || e.elite || e.ai === 'exploder') continue;
			for (const h of alive) {
				if (dist2(e.x, e.y, h.x, h.y) < ELITE_PICK_DIST2) {
					cand.push(e);
					break;
				}
			}
		}
		if (!cand.length) return null;
		// Prefer tougher enemies.
		cand.sort((a, b) => b.maxHp - a.maxHp);
		const e = cand[Math.floor(Math.random() * Math.min(cand.length, 12))];
		const affix = ELITE_AFFIXES[Math.floor(Math.random() * ELITE_AFFIXES.length)].id;
		this.setElite(e, affix);
		return e;
	}

	setElite(e, affix) {
		e.elite = affix;
		e.hp *= ELITE_HP_MUL;
		e.maxHp *= ELITE_HP_MUL;
		e.r *= ELITE_R_MUL;
		e.xp *= 3;
		e.auxT = affix === 'blink' ? BLINK_EVERY : 0;
		if (affix === 'fast') e.speed *= 1.4;
		this.fx.push(['elite', e.id, ELITE_AFFIX_INDEX[affix]]);
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

	// The single damage entry point: mark → crit → (reactions, wave 2) → armor → hp → burn.
	hurtEnemy(e, dmg, h, src = SRC_NONE) {
		if (e.dead || dmg <= 0) return 0;
		const now = this.time;
		let crit = false;
		if (!src.raw && e.markT > now) dmg *= 1 + e.markMul;
		if (h && !src.raw) {
			if (h.rageT > now) dmg *= ITEMS.rage.mul;
			if (this.synergy > 0) dmg *= 1 + this.synergy;
			if (h.mods.chillVuln > 0 && e.slowT > now) dmg *= 1 + h.mods.chillVuln;
			if (h.mods.critChance > 0 && Math.random() < h.mods.critChance) {
				crit = true;
				dmg *= h.mods.critMul;
			}
		}
		if (e.elite === 'armored' && src.tags.includes('proj')) dmg *= 0.5;
		const dealt = Math.min(dmg, e.hp);
		if (h) {
			h.dmg += dealt;
			h.dmgBy[src.weapon] = (h.dmgBy[src.weapon] ?? 0) + dealt;
		}
		e.hp -= dmg;
		if (crit && this.critFx < MAX_CRIT_FX) {
			this.critFx++;
			this.fx.push(['hit', Math.round(e.x), Math.round(e.y), Math.max(1, Math.round(dmg)), 1, h.pid]);
		} else if (this.hitFx < MAX_HIT_FX) {
			this.hitFx++;
			this.fx.push(['hit', Math.round(e.x), Math.round(e.y), Math.max(1, Math.round(dmg))]);
		}
		if (e.hp <= 0) this.killEnemy(e, h, src);
		else if (h && h.mods.burnChance > 0 && src !== SRC_BURN && Math.random() < h.mods.burnChance) this.burn(e, h, h.mods.burnDps, 3);
		return dmg;
	}

	burn(e, h, dps, dur) {
		if (e.burnT <= this.time) e.burnAcc = 0;
		e.burnT = this.time + dur * h.mods.durMul;
		if (dps >= e.burnDps || e.burnT <= this.time) e.burnDps = dps;
		e.burnOwner = h;
	}

	burnTick(e, dt) {
		e.burnAcc += dt;
		if (e.burnAcc < BURN_TICK) return;
		e.burnAcc -= BURN_TICK;
		this.hurtEnemy(e, e.burnDps * BURN_TICK, e.burnOwner, SRC_BURN);
	}

	slowEnemy(e, slow, dur) {
		if (e.slowT <= this.time || slow >= e.slow) e.slow = slow;
		e.slowT = Math.max(e.slowT, this.time + dur);
	}

	killEnemy(e, h, src = SRC_NONE) {
		e.dead = true;
		this.kills++;
		if (h) h.kills++;
		if (this.dieFx < MAX_DIE_FX) {
			this.dieFx++;
			this.fx.push(['die', Math.round(e.x), Math.round(e.y), e.type]);
		}
		const luck = h ? h.mods.luck : 0;
		this.dropGem(e.x, e.y, e.xp, Math.random() < GOLD_GEM_CHANCE * (1 + luck));
		if (e.ai === 'exploder' && !e.exploded) {
			e.exploded = true;
			const E = e.def;
			// Killed by a player: short fuse at the spot; fuse burnt out: blows up right away.
			this.addBlast(e.x, e.y, E.blastR, E.blastDmg * e.dmgMul, E.blastEnemyDmg, h, 1, e.fuseT > 0 || src === SRC_BLAST ? 0 : E.fuse);
		}
		if (e.elite) {
			if (e.elite === 'volatile') this.addBlast(e.x, e.y, VOLATILE_R, ENEMIES.bloater.blastDmg, ENEMIES.bloater.blastEnemyDmg, h, 2, ENEMIES.bloater.fuse);
			if (Math.random() < ELITE_CHEST_CHANCE * (1 + luck)) this.dropItem('chest', e.x, e.y);
			else this.dropGem(e.x + 12, e.y, e.xp * GOLD_GEM_MUL, true);
		}
		if (e.type === TYPE_INDEX.brute && this.time >= this.nextMagnetT) {
			this.nextMagnetT = this.time + MAGNET_ITEM_EVERY;
			this.dropItem('magnet', e.x, e.y + 10);
		}
		const bi = this.bosses.indexOf(e);
		if (bi >= 0) {
			this.bosses.splice(bi, 1);
			this.fx.push(['chest', Math.round(e.x), Math.round(e.y)]);
			for (const p of this.heroes.values()) if (p.st === 0) this.grantOffer(p);
		}
	}

	// kind: 0 petard (enemies only), 1 bloater, 2 volatile elite (both hurt players too).
	addBlast(x, y, r, pdmg, edmg, owner, kind, delay, src = SRC_BLAST) {
		const b = { x, y, r, pdmg, edmg, owner, kind, t: this.time + delay, src };
		if (delay <= 0) {
			this.explode(b);
			return;
		}
		this.blasts.push(b);
		if (kind !== 0) this.fx.push(['warn', Math.round(x), Math.round(y), Math.round(r), round3(delay)]);
	}

	updateBlasts() {
		if (!this.blasts.length) return;
		let j = 0;
		const due = [];
		for (const b of this.blasts) {
			if (b.t <= this.time + 1e-9) due.push(b);
			else this.blasts[j++] = b;
		}
		this.blasts.length = j;
		for (const b of due) this.explode(b);
	}

	explode(b) {
		this.fx.push(['boom', Math.round(b.x), Math.round(b.y), Math.round(b.r), b.kind]);
		const near = this.grid.query(b.x, b.y, b.r + MAX_ENEMY_R, []);
		for (const e of near) {
			const rr = b.r + e.r * 0.5;
			if (e.dead || dist2(e.x, e.y, b.x, b.y) >= rr * rr) continue;
			this.hurtEnemy(e, b.edmg, b.owner, b.src);
			if (b.kb && !e.dead && !e.boss) this.knock(e, b.x, b.y, b.kb);
		}
		if (b.then) b.then(b);
		if (b.pdmg > 0) {
			for (const h of this.heroes.values()) {
				const rr = b.r + PLAYER_RADIUS;
				if (h.st === 0 && h.iframes <= 0 && dist2(h.x, h.y, b.x, b.y) < rr * rr) this.hurtPlayer(h, b.pdmg);
			}
		}
		if (b.owner) this.breakAround(b.x, b.y, b.r, b.owner);
	}

	dropGem(x, y, xp, gold = false) {
		if (this.gems.length >= MAX_GEMS) {
			// G1: fold the gem farthest from every player into the new one, so XP never drifts out of reach.
			let wi = 0, wd = -1;
			for (let i = 0; i < this.gems.length; i++) {
				const g = this.gems[i];
				let d = Infinity;
				for (const h of this.heroes.values()) {
					const dd = dist2(g.x, g.y, h.x, h.y);
					if (dd < d) d = dd;
				}
				if (d > wd) {
					wd = d;
					wi = i;
				}
			}
			const far = this.gems[wi];
			xp += far.xp; // the gold look is not inherited: tier follows the merged xp
			this.gems[wi] = this.gems[this.gems.length - 1];
			this.gems.pop();
		}
		this.gems.push({ id: this.nextId++, x, y, xp, gold, pull: null });
	}

	// G1: gems farther than FAR from all players are merged next to the nearest one, at the edge of the view.
	sweepFarGems(alive) {
		const groups = new Map();
		let j = 0;
		for (const g of this.gems) {
			let best = null, bd = Infinity;
			for (const h of alive) {
				const d = dist2(g.x, g.y, h.x, h.y);
				if (d < bd) {
					bd = d;
					best = h;
				}
			}
			if (bd <= FAR_DIST2 || g.pull) {
				this.gems[j++] = g;
				continue;
			}
			let gr = groups.get(best);
			if (!gr) groups.set(best, gr = { xp: 0, sx: 0, sy: 0, n: 0 });
			gr.xp += g.xp;
			gr.sx += g.x;
			gr.sy += g.y;
			gr.n++;
		}
		this.gems.length = j;
		for (const [h, gr] of groups) {
			const dx = gr.sx / gr.n - h.x, dy = gr.sy / gr.n - h.y;
			const d = Math.hypot(dx, dy) || 1;
			this.gems.push({ id: this.nextId++, x: h.x + (dx / d) * GEM_SWEEP_PLACE, y: h.y + (dy / d) * GEM_SWEEP_PLACE, xp: gr.xp, gold: false, pull: null });
		}
	}

	dropItem(type, x, y) {
		if (this.items.length >= MAX_ITEMS) {
			const i = this.items.findIndex((it) => it.type !== ITEM_INDEX.chest);
			if (i < 0) return null;
			this.items.splice(i, 1);
		}
		const it = { id: this.nextId++, type: ITEM_INDEX[type], x, y, life: type === 'chest' ? ITEM_LIFE * 2 : ITEM_LIFE };
		this.items.push(it);
		return it;
	}

	updateItems(dt, alive) {
		if (!this.items.length) return;
		let j = 0;
		for (const it of this.items) {
			it.life -= dt;
			if (it.life <= 0) continue;
			let taker = null;
			for (const h of alive) {
				if (h.st === 0 && dist2(h.x, h.y, it.x, it.y) < ITEM_PICK_R * ITEM_PICK_R) {
					taker = h;
					break;
				}
			}
			if (taker) this.useItem(taker, it, alive);
			else this.items[j++] = it;
		}
		this.items.length = j;
	}

	useItem(h, it, alive) {
		const type = ITEM_TYPES[it.type];
		this.fx.push(['item', h.pid, it.type, Math.round(it.x), Math.round(it.y)]);
		const now = this.time;
		switch (type) {
			case 'dew':
				h.hp = Math.min(h.maxHp, h.hp + ITEMS.dew.heal);
				break;
			case 'magnet':
				for (const g of this.gems) g.pull = h;
				break;
			case 'rage': {
				const R = ITEMS.rage.radius;
				for (const o of alive) if (o.st === 0 && dist2(o.x, o.y, h.x, h.y) < R * R) o.rageT = now + ITEMS.rage.dur;
				break;
			}
			case 'cracker': {
				const R = ITEMS.cracker.radius;
				for (const e of this.enemies) {
					if (e.dead || dist2(e.x, e.y, h.x, h.y) >= R * R) continue;
					this.hurtEnemy(e, e.boss || e.elite ? e.maxHp * ITEMS.cracker.bigFrac : e.hp + 1, h, SRC_CRACKER);
				}
				break;
			}
			case 'slowtime': {
				const R = ITEMS.slowtime.radius;
				for (const e of this.enemies) {
					if (e.dead || dist2(e.x, e.y, h.x, h.y) >= R * R) continue;
					e.slow = ITEMS.slowtime.slow;
					e.slowT = Math.max(e.slowT, now + ITEMS.slowtime.dur);
				}
				break;
			}
			case 'feather':
				h.rerolls++;
				if (h.offer) this.sendOffer(h);
				break;
			case 'chest':
				this.fx.push(['open', h.pid, Math.round(it.x), Math.round(it.y)]);
				this.grantOffer(h, true);
				break;
		}
	}

	// Breakable props (deterministic per tile, see content.js) break from any hit that covers them.
	breakAround(x, y, r, h) {
		const R = r + BREAK_R;
		const tx0 = Math.floor((x - R) / BREAK_TILE), tx1 = Math.floor((x + R) / BREAK_TILE);
		const ty0 = Math.floor((y - R) / BREAK_TILE), ty1 = Math.floor((y + R) / BREAK_TILE);
		for (let tx = tx0; tx <= tx1; tx++) {
			for (let ty = ty0; ty <= ty1; ty++) {
				const b = breakableAt(tx, ty);
				if (!b || dist2(b.x, b.y, x, y) >= R * R) continue;
				const key = tx * 100003 + ty;
				if (this.broken.has(key)) continue;
				this.broken.add(key);
				this.brokenList.push(tx, ty);
				this.breakProp(b, h);
			}
		}
	}

	breakProp(b, h) {
		let r = Math.random() * BREAK_DROP_TOTAL;
		let drop = BREAK_DROPS[0][0];
		for (const [id, w] of BREAK_DROPS) {
			if ((r -= w) <= 0) {
				drop = id;
				break;
			}
		}
		this.fx.push(['brk', b.tx, b.ty]);
		if (drop === 'gems') {
			for (let i = 0; i < 5; i++) {
				const a = (i / 5) * Math.PI * 2;
				this.dropGem(b.x + Math.cos(a) * 18, b.y + Math.sin(a) * 18, 3);
			}
		} else {
			this.dropItem(drop, b.x, b.y);
		}
	}

	compactEnemies() {
		let j = 0;
		for (const e of this.enemies) if (!e.dead) this.enemies[j++] = e;
		this.enemies.length = j;
	}

	updatePlayers(dt, alive) {
		const near = this.q1;
		const now = this.time;
		for (const h of alive) {
			if (h.st !== 0) continue;
			h.iframes = Math.max(0, h.iframes - dt);
			if (h.mods.regen > 0) h.hp = Math.min(h.maxHp, h.hp + h.mods.regen * dt);

			this.grid.query(h.x, h.y, PLAYER_RADIUS + MAX_ENEMY_R, near);
			for (const e of near) {
				if (e.dead) continue;
				const min = e.r + PLAYER_RADIUS;
				if (dist2(e.x, e.y, h.x, h.y) >= min * min) continue;
				if (e.ai === 'exploder') {
					if (e.fuseT <= 0) {
						e.fuseT = e.def.fuse;
						e.fuseBy = null;
					}
					continue;
				}
				if (h.iframes > 0 || e.dmg <= 0 || e.frozenT > now) continue;
				this.hurtPlayer(h, e.dmg);
				if (h.st !== 0) break;
			}
			if (h.st !== 0) continue;
			this.breakAround(h.x, h.y, PLAYER_RADIUS, h);
			for (const [id, w] of h.weapons) this.updateWeapon(h, id, w, dt);
		}
	}

	hurtPlayer(h, dmg) {
		h.hp -= Math.max(1, dmg * h.trait.dmgTaken - h.mods.armor);
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

	// Up to `count` points in the densest groups within `range` (most neighbors in DENSE_R among the 12 nearest).
	densestPoints(h, count, range) {
		const cand = this.nearestEnemies(h.x, h.y, 12, range);
		if (!cand.length) return [];
		const scored = cand.map((c) => {
			let n = 0;
			for (const o of this.grid.query(c.x, c.y, DENSE_R, this.q3)) if (!o.dead && dist2(o.x, o.y, c.x, c.y) < DENSE_R * DENSE_R) n++;
			return [n, c];
		});
		scored.sort((a, b) => b[0] - a[0]);
		const out = [];
		for (const [, c] of scored) {
			if (out.length >= count) break;
			if (out.some((p) => dist2(p.x, p.y, c.x, c.y) < 50 * 50)) continue;
			out.push({ x: c.x, y: c.y });
		}
		for (let i = 0; out.length < count; i++) {
			const p = out[i % out.length];
			const a = Math.random() * Math.PI * 2;
			out.push({ x: p.x + Math.cos(a) * 60, y: p.y + Math.sin(a) * 60 });
		}
		return out;
	}

	updateWeapon(h, id, w, dt) {
		const L = weaponDef(id).levels[w.lvl - 1];
		const { dmgMul, cdMul, areaMul, amount, durMul } = h.mods;
		const src = SRC[id];
		switch (id) {
			case 'orbit':
				this.orbitHits(h, L, dmgMul, areaMul, amount);
				return;
			case 'windmill':
				this.windmillHits(h, L, dmgMul, areaMul, amount);
				return;
			case 'orrery':
				this.orreryTick(h, w, L, dt);
				return;
			case 'tripwire':
				this.tripwireTick(h, w, L, dt);
				return;
			case 'aurora':
				w.p = (w.p ?? L.pulse) - dt;
				if (w.p <= 0) {
					w.p = L.pulse * cdMul;
					this.auroraPulse(h, L);
				}
				break;
		}
		w.t -= dt;
		if (w.t > 0) return;
		const dmg = L.dmg * dmgMul;
		switch (id) {
			case 'bolt': {
				const count = L.count + amount;
				const targets = this.nearestEnemies(h.x, h.y, count, BOLT_RANGE);
				if (!targets.length) {
					w.t = 0.1;
					return;
				}
				for (let i = 0; i < count; i++) {
					const t = targets[i % targets.length];
					const a = Math.atan2(t.y - h.y, t.x - h.x) + (i - (count - 1) / 2) * 0.25;
					this.addProjectile(h, 'bolt', a, L.speed, dmg, L.pierce, 2.5, t);
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'knives': {
				// Aim at the nearest enemy: players usually run away from the horde, so facing would shoot into empty space.
				const count = L.count + amount;
				const target = this.nearestEnemies(h.x, h.y, 1, KNIFE_AIM_RANGE)[0];
				const base = target ? Math.atan2(target.y - h.y, target.x - h.x) : Math.atan2(h.fy, h.fx);
				for (let i = 0; i < count; i++) {
					this.addProjectile(h, 'knife', base + (i - (count - 1) / 2) * L.spread, L.speed, dmg, L.pierce, 1.1, null);
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'sickle': {
				const count = L.count + amount;
				const range = L.range * areaMul;
				const targets = this.nearestEnemies(h.x, h.y, count, range + 60);
				if (!targets.length) {
					w.t = 0.1;
					return;
				}
				for (let i = 0; i < count; i++) {
					const t = targets[i % targets.length];
					const spread = i < targets.length ? 0 : (i - targets.length + 1) * 0.5;
					const a = Math.atan2(t.y - h.y, t.x - h.x) + spread;
					this.addProjectile(h, 'sickle', a, L.speed, dmg, Infinity, (range / L.speed) * 2 + 1.5, null, range / L.speed);
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
					if (!e.dead && dist2(e.x, e.y, h.x, h.y) < rr * rr) this.hurtEnemy(e, dmg, h, src);
				}
				this.breakAround(h.x, h.y, r, h);
				w.t = L.tick;
				return;
			}
			case 'frost': {
				const r = L.radius * areaMul;
				const near = this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2);
				let any = false;
				for (const e of near) {
					const rr = r + e.r * 0.5;
					if (e.dead || dist2(e.x, e.y, h.x, h.y) >= rr * rr) continue;
					any = true;
					this.hurtEnemy(e, dmg, h, src);
					if (e.dead) continue;
					this.slowEnemy(e, L.slow, L.dur * durMul);
					if (L.freeze > 0 && !e.boss) e.frozenT = Math.max(e.frozenT, this.time + L.freeze * h.mods.ctrlMul * durMul);
				}
				if (!any) {
					w.t = 0.2;
					return;
				}
				this.fx.push(['frost', h.pid, Math.round(r)]);
				this.breakAround(h.x, h.y, r, h);
				w.t = L.cd * cdMul;
				return;
			}
			case 'bomb':
			case 'molotov':
			case 'icebomb': {
				const lobKind = id === 'bomb' ? 0 : id === 'molotov' ? 1 : 2;
				const thrown = this.throwBombs(h, L.count + amount, L.fuse, lobKind, (x, y) => ({
					x, y, r: L.radius * areaMul, pdmg: 0, edmg: dmg, owner: h, src,
					kind: lobKind === 0 ? 0 : lobKind === 1 ? 6 : 4,
					then: lobKind === 1 ? (b) => this.firePool(h, b, L) : lobKind === 2 ? (b) => this.iceBurst(h, b, L) : null,
				}));
				w.t = thrown ? L.cd * cdMul : 0.2;
				return;
			}
			case 'traps':
				this.layTrap(h, { r: L.radius * areaMul, dmg, root: L.root * h.mods.ctrlMul, splash: L.splash * areaMul, max: L.max, src });
				w.t = L.cd * cdMul;
				return;
			case 'minefield':
				this.layTrap(h, { kind: 1, r: L.trigger * areaMul, dmg, blastR: L.radius * areaMul, kb: L.kb, recharge: L.recharge, max: L.max, src });
				w.t = L.cd * cdMul;
				return;
			case 'thunderslash': {
				const range = L.range * areaMul, width = L.width * areaMul;
				w.n = (w.n ?? 0) + 1;
				const big = w.n % 3 === 0;
				this.fx.push(['tslash', h.pid, Math.round(range), Math.round(width), big ? 1 : 0]);
				const hit = [];
				for (const dir of [1, -1]) {
					this.slashHits(h, dir, range, width, dmg, src, hit);
					this.breakAround(h.x + (dir * range) / 2, h.y, range / 2, h);
				}
				// Every enemy hit becomes a lightning rod: a strike from the sky 0.3 s later, chaining on.
				const rods = hit.slice(0, 5);
				const chain = L.chain + h.trait.chainBonus;
				if (rods.length) this.after(0.3, () => { for (const e of rods) this.strikeAt(h, e, dmg * L.rodFrac, chain, src); });
				if (big) this.thunderFan(h, L, range, src);
				w.t = L.cd * cdMul;
				return;
			}
			case 'orb': {
				const pts = this.densestPoints(h, L.count + amount, 420);
				if (!pts.length) {
					w.t = 0.2;
					return;
				}
				for (const p of pts) {
					const o = {
						id: this.nextId++, owner: h, x: h.x, y: h.y, tx: p.x, ty: p.y, speed: L.speed, life: L.life,
						r: L.radius * areaMul, dmg, tick: L.tick, t: L.tick, boom: L.boom * dmgMul, boomR: L.boomR * areaMul, src,
					};
					this.orbs.push(o);
					this.fx.push(['orb', o.id, Math.round(o.x), Math.round(o.y), Math.round(o.tx), Math.round(o.ty), o.speed, round3(o.life), round3(this.time), Math.round(o.r)]);
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'fanback': {
				const count = L.count + amount;
				const range = L.range * areaMul;
				const target = this.nearestEnemies(h.x, h.y, 1, range + 200)[0];
				if (!target) {
					w.t = 0.1;
					return;
				}
				const base = Math.atan2(target.y - h.y, target.x - h.x);
				for (let i = 0; i < count; i++) {
					this.addProjectile(h, 'knife', base + (i - (count - 1) / 2) * L.spread, L.speed, dmg, Infinity, (range / L.speed) * 2 + 1.2, null, range / L.speed, { src });
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'icedisc': {
				const count = L.count + amount;
				const range = L.range * areaMul;
				const targets = this.nearestEnemies(h.x, h.y, count, range + 60);
				if (!targets.length) {
					w.t = 0.1;
					return;
				}
				for (let i = 0; i < count; i++) {
					const t = targets[i % targets.length];
					const a = Math.atan2(t.y - h.y, t.x - h.x) + (i < targets.length ? 0 : (i - targets.length + 1) * 0.5);
					this.addProjectile(h, 'icedisc', a, L.speed, dmg, Infinity, (range / L.speed) * 2 + 1.5, null, range / L.speed, {
						src, trail: { r: L.trailR * areaMul, life: L.trailLife * durMul, slow: L.trailSlow, every: 0.08, acc: 0 },
						freezeBack: L.freeze * h.mods.ctrlMul * durMul,
					});
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'aurora': {
				const r = L.radius * areaMul;
				for (const e of this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2)) {
					const rr = r + e.r * 0.5;
					if (e.dead || dist2(e.x, e.y, h.x, h.y) >= rr * rr) continue;
					this.hurtEnemy(e, dmg, h, src);
					if (!e.dead) this.slowEnemy(e, L.slow, L.tick + 0.2);
				}
				this.breakAround(h.x, h.y, r, h);
				w.t = L.tick;
				return;
			}
			case 'censer': {
				const z = {
					id: this.nextId++, owner: h, x: h.x, y: h.y, r: L.radius * areaMul, life: L.life * durMul, dmg, tick: L.tick, t: 0,
					slow: h.trait.puddleSlow, heal: L.heal,
				};
				this.puddles.push(z);
				this.fx.push(['zk', z.id, 2]);
				w.t = L.every;
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
				for (let s = 0; s < L.strikes + amount && cand.length; s++) {
					const idx = Math.floor(Math.random() * cand.length);
					let t = cand[idx];
					cand[idx] = cand[cand.length - 1];
					cand.pop();
					this.fx.push(['zap', Math.round(t.x), Math.round(t.y - 320), Math.round(t.x), Math.round(t.y)]);
					const hit = [t];
					this.hurtEnemy(t, dmg, h, src);
					const chain = L.chain + h.trait.chainBonus;
					for (let c = 0; c < chain; c++) {
						const next = this.nearestFrom(t, hit, CHAIN_RANGE);
						if (!next) break;
						this.fx.push(['zap', Math.round(t.x), Math.round(t.y), Math.round(next.x), Math.round(next.y)]);
						hit.push(next);
						this.hurtEnemy(next, dmg, h, src);
						t = next;
					}
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'flask': {
				const count = L.count + amount;
				const targets = this.nearestEnemies(h.x, h.y, count, 300);
				for (let i = 0; i < count; i++) {
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
					const z = { id: this.nextId++, owner: h, x, y, r: L.radius * areaMul, life: L.duration * durMul, dmg, tick: L.tick, t: 0, slow: h.trait.puddleSlow };
					this.puddles.push(z);
					if (z.slow > 0) this.fx.push(['slowz', z.id]);
				}
				w.t = L.cd * cdMul;
				return;
			}
		}
	}

	after(delay, fn) {
		this.timers.push({ t: this.time + delay, fn });
	}

	updateTimers() {
		if (!this.timers.length) return;
		const now = this.time + 1e-9;
		const due = this.timers.filter((x) => x.t <= now);
		if (!due.length) return;
		this.timers = this.timers.filter((x) => x.t > now);
		for (const x of due) x.fn();
	}

	knock(e, fromX, fromY, dist) {
		const dx = e.x - fromX, dy = e.y - fromY;
		const d = Math.hypot(dx, dy) || 1;
		e.x += (dx / d) * dist;
		e.y += (dy / d) * dist;
	}

	// Lightning from the sky into `t` (or the nearest enemy if it already died), then a chain.
	strikeAt(h, t, dmg, chain, src) {
		if (t.dead) t = this.nearestFrom(t, [], 80);
		if (!t) return;
		this.fx.push(['zap', Math.round(t.x), Math.round(t.y - 320), Math.round(t.x), Math.round(t.y)]);
		const hit = [t];
		this.hurtEnemy(t, dmg, h, src);
		for (let c = 0; c < chain; c++) {
			const next = this.nearestFrom(t, hit, CHAIN_RANGE);
			if (!next) break;
			this.fx.push(['zap', Math.round(t.x), Math.round(t.y), Math.round(next.x), Math.round(next.y)]);
			hit.push(next);
			this.hurtEnemy(next, dmg, h, src);
			t = next;
		}
	}

	// Every 3rd Thunder Slash: a fan of bolts from the hero into enemies spread around the swing.
	thunderFan(h, L, range, src) {
		const R = range * 1.3;
		this.fx.push(['tfan', h.pid, Math.round(R)]);
		const cand = this.grid.query(h.x, h.y, R + MAX_ENEMY_R, this.q2).filter((e) => !e.dead && dist2(e.x, e.y, h.x, h.y) < R * R);
		const ang = (e) => Math.atan2(e.y - h.y, e.x - h.x);
		cand.sort((a, b) => ang(a) - ang(b));
		const dmg = L.fanDmg * h.mods.dmgMul;
		for (let i = 0; i < L.fan; i++) {
			const e = cand.length ? cand[Math.floor(((i + 0.5) / L.fan) * cand.length)] : null;
			const a = (i / L.fan) * Math.PI * 2;
			const x = e ? e.x : h.x + Math.cos(a) * range, y = e ? e.y : h.y + Math.sin(a) * range;
			this.fx.push(['zap', Math.round(h.x), Math.round(h.y), Math.round(x), Math.round(y)]);
			if (e && !e.dead) this.hurtEnemy(e, dmg, h, src);
		}
	}

	slashHits(h, dir, range, width, dmg, src, hit) {
		const cx = h.x + (dir * range) / 2;
		const near = this.grid.query(cx, h.y, range / 2 + width / 2 + MAX_ENEMY_R, this.q2);
		const x0 = dir > 0 ? h.x : h.x - range, x1 = dir > 0 ? h.x + range : h.x;
		for (const e of near) {
			if (e.dead || e.x + e.r < x0 || e.x - e.r > x1 || Math.abs(e.y - h.y) > width / 2 + e.r) continue;
			this.hurtEnemy(e, dmg, h, src);
			if (!e.dead) hit.push(e);
		}
	}

	// Lob bombs into the densest groups; `blast(x, y)` builds the explosion. Returns false if there was no target.
	throwBombs(h, count, fuse, lobKind, blast) {
		const pts = this.densestPoints(h, count, BOMB_RANGE);
		if (!pts.length) return false;
		for (const p of pts) {
			this.fx.push(['lob', this.nextId++, Math.round(h.x), Math.round(h.y), Math.round(p.x), Math.round(p.y), round3(fuse), round3(this.time), lobKind]);
			this.blasts.push({ ...blast(p.x, p.y), t: this.time + fuse });
		}
		return true;
	}

	firePool(h, b, L) {
		const z = {
			id: this.nextId++, owner: h, x: b.x, y: b.y, r: b.r * 0.9, life: L.pool * h.mods.durMul, dmg: L.poolDmg * h.mods.dmgMul,
			tick: L.tick, t: 0, slow: h.trait.puddleSlow, src: SRC.molotov,
		};
		this.puddles.push(z);
		this.fx.push(['zk', z.id, 1]);
	}

	// Freeze everyone in the blast; 0.5 s later the frozen ones shatter into shards around them.
	iceBurst(h, b, L) {
		const frozen = [];
		const dur = L.freeze * h.mods.ctrlMul * h.mods.durMul;
		for (const e of this.grid.query(b.x, b.y, b.r + MAX_ENEMY_R, this.q3)) {
			const rr = b.r + e.r * 0.5;
			if (e.dead || e.boss || dist2(e.x, e.y, b.x, b.y) >= rr * rr) continue;
			e.frozenT = Math.max(e.frozenT, this.time + dur);
			if (frozen.length < 8) frozen.push(e);
		}
		const shard = b.edmg * L.shardFrac;
		if (frozen.length) this.after(0.5, () => {
			for (const f of frozen) {
				this.fx.push(['shard', Math.round(f.x), Math.round(f.y)]);
				for (const e of this.grid.query(f.x, f.y, L.shardR + MAX_ENEMY_R, this.q3)) {
					const rr = L.shardR + e.r * 0.5;
					if (!e.dead && dist2(e.x, e.y, f.x, f.y) < rr * rr) this.hurtEnemy(e, shard, h, SRC.icebomb);
				}
			}
		});
	}

	auroraPulse(h, L) {
		const R = L.radius * h.mods.areaMul * 2;
		const dur = L.freeze * h.mods.ctrlMul * h.mods.durMul;
		for (const e of this.grid.query(h.x, h.y, R + MAX_ENEMY_R, this.q2)) {
			const rr = R + e.r * 0.5;
			if (!e.dead && !e.boss && dist2(e.x, e.y, h.x, h.y) < rr * rr) e.frozenT = Math.max(e.frozenT, this.time + dur);
		}
		this.fx.push(['frost', h.pid, Math.round(R)]);
	}

	// Traps (kind 0), mines (1) and knife spikes (3): behind a moving hero, in a ring around a standing one, or at o.x/o.y.
	layTrap(h, o) {
		let x, y;
		if (o.x !== undefined) {
			x = o.x;
			y = o.y;
		} else if (this.time - h.movedT < MOVE_RECENT) {
			x = h.x - h.mvx * TRAP_BEHIND + (Math.random() - 0.5) * 16;
			y = h.y - h.mvy * TRAP_BEHIND + (Math.random() - 0.5) * 16;
		} else {
			const a = h.trapRing++ * 2.4;
			x = h.x + Math.cos(a) * 48;
			y = h.y + Math.sin(a) * 48;
		}
		const kind = o.kind ?? 0;
		this.traps.push({
			id: this.nextId++, owner: h, x, y, kind, r: o.r, dmg: o.dmg, root: o.root ?? 0, splash: o.splash ?? 0, src: o.src,
			blastR: o.blastR ?? 0, kb: o.kb ?? 0, recharge: o.recharge ?? 0, rearm: o.rearm ?? 0, life: o.life ?? Infinity, armT: this.time + TRAP_ARM,
		});
		if (o.max) {
			let mine = 0;
			for (const t of this.traps) if (t.owner === h && t.kind === kind) mine++;
			if (mine > o.max) this.traps.splice(this.traps.findIndex((t) => t.owner === h && t.kind === kind), 1);
		}
	}

	orreryTick(h, w, L, dt) {
		const { dmgMul, areaMul, amount, cdMul } = h.mods;
		const count = L.count + amount;
		w.ready ??= [];
		while (w.ready.length < count) w.ready.push(0);
		w.t -= dt;
		if (w.t > 0) return;
		const target = this.nearestEnemies(h.x, h.y, 1, L.trigger * areaMul)[0];
		if (!target) return;
		const R = L.radius * areaMul;
		let best = -1, bd = Infinity, bx = 0, by = 0;
		for (let i = 0; i < count; i++) {
			if (w.ready[i] > this.time) continue;
			const a = orbitAngle(this.time, L.rps, i, count);
			const x = h.x + Math.cos(a) * R, y = h.y + Math.sin(a) * R;
			const d = dist2(x, y, target.x, target.y);
			if (d < bd) {
				bd = d;
				best = i;
				bx = x;
				by = y;
			}
		}
		if (best < 0) return;
		w.ready[best] = this.time + L.respawn * cdMul;
		this.addProjectile(h, 'bolt', Math.atan2(target.y - by, target.x - bx), L.speed, L.dmg * dmgMul, L.pierce, 2, target, 0, { x: bx, y: by, src: SRC.orrery });
		w.t = 0.12;
	}

	// Sparks still on the orbit as a bit mask for the snapshot (the client draws only those).
	orreryMask(h, w) {
		if (!w.ready) return 0x3fffffff;
		let m = 0;
		for (let i = 0; i < w.ready.length && i < 30; i++) if (w.ready[i] <= this.time) m |= 1 << i;
		return m;
	}

	windmillHits(h, L, dmgMul, areaMul, amount) {
		const count = L.count + amount;
		const len = L.len * areaMul, half = (L.width * areaMul) / 2;
		const cs = [], sn = [];
		for (let i = 0; i < count; i++) {
			const a = orbitAngle(this.time, L.rps, i, count);
			cs.push(Math.cos(a));
			sn.push(Math.sin(a));
		}
		if (this.tickNo % 3 === 0) for (let i = 0; i < count; i++) this.breakAround(h.x + cs[i] * len * 0.75, h.y + sn[i] * len * 0.75, len * 0.25, h);
		const key = -h.pid;
		for (const e of this.grid.query(h.x, h.y, len + MAX_ENEMY_R, this.q2)) {
			if (e.dead || (e.oh && (e.oh[key] ?? 0) > this.time)) continue;
			const dx = e.x - h.x, dy = e.y - h.y;
			for (let i = 0; i < count; i++) {
				const along = dx * cs[i] + dy * sn[i];
				if (along < 0 || along > len + e.r) continue;
				if (Math.abs(-dx * sn[i] + dy * cs[i]) >= half + e.r) continue;
				(e.oh ??= {})[key] = this.time + L.hitCd;
				this.hurtEnemy(e, L.dmg * dmgMul, h, SRC.windmill);
				if (!e.dead && !e.boss) this.knock(e, h.x, h.y, L.kb);
				break;
			}
		}
	}

	tripwireTick(h, w, L, dt) {
		const { dmgMul, cdMul, areaMul, amount, durMul, ctrlMul } = h.mods;
		const src = SRC.tripwire;
		w.t -= dt;
		if (w.t <= 0) {
			const count = L.count + amount;
			const target = this.nearestEnemies(h.x, h.y, 1, KNIFE_AIM_RANGE)[0];
			const base = target ? Math.atan2(target.y - h.y, target.x - h.x) : Math.atan2(h.fy, h.fx);
			for (let i = 0; i < count; i++) {
				this.addProjectile(h, 'knife', base + (i - (count - 1) / 2) * L.spread, L.speed, L.dmg * dmgMul, L.pierce, 1.1, null, 0, {
					src, spike: { dmg: L.spikeDmg * dmgMul, life: L.spikeLife * durMul, root: L.spikeRoot * ctrlMul },
				});
			}
			w.t = L.cd * cdMul;
		}
		w.tt = (w.tt ?? 0) - dt;
		if (w.tt <= 0) {
			this.layTrap(h, { r: L.radius * areaMul, dmg: L.trapDmg * dmgMul, root: L.root * ctrlMul, max: L.max, src, rearm: L.rearm });
			w.tt = L.trapCd * cdMul;
		}
		w.wt = (w.wt ?? 0) - dt;
		if (w.wt <= 0) {
			w.wt = L.wireTick;
			this.wireHits(h, L.link, L.wireDmg * dmgMul, src);
		}
	}

	// Threads between the owner's traps no farther than `link` apart cut everything on the line.
	wireHits(h, link, dmg, src) {
		const mine = this.traps.filter((t) => t.owner === h && t.kind === 0);
		for (let i = 0; i < mine.length; i++) {
			for (let j = i + 1; j < mine.length; j++) {
				const a = mine[i], b = mine[j];
				const lx = b.x - a.x, ly = b.y - a.y, l2 = lx * lx + ly * ly;
				if (l2 > link * link || l2 < 1) continue;
				const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
				for (const e of this.grid.query(mx, my, Math.sqrt(l2) / 2 + MAX_ENEMY_R, this.q3)) {
					if (e.dead) continue;
					const k = clamp(((e.x - a.x) * lx + (e.y - a.y) * ly) / l2, 0, 1);
					const px = a.x + lx * k, py = a.y + ly * k;
					if (dist2(e.x, e.y, px, py) < (e.r + 6) * (e.r + 6)) this.hurtEnemy(e, dmg, h, src);
				}
			}
		}
	}

	updateOrbs(dt) {
		if (!this.orbs.length) return;
		let j = 0;
		for (const o of this.orbs) {
			const dx = o.tx - o.x, dy = o.ty - o.y;
			const d = Math.hypot(dx, dy);
			if (d > 0.01) {
				const step = Math.min(d, o.speed * dt);
				o.x += (dx / d) * step;
				o.y += (dy / d) * step;
			}
			o.t -= dt;
			if (o.t <= 0) {
				o.t = o.tick;
				let zaps = 0;
				for (const e of this.grid.query(o.x, o.y, o.r + MAX_ENEMY_R, this.q1)) {
					const rr = o.r + e.r * 0.5;
					if (e.dead || dist2(e.x, e.y, o.x, o.y) >= rr * rr) continue;
					if (zaps++ < 3) this.fx.push(['zap', Math.round(o.x), Math.round(o.y), Math.round(e.x), Math.round(e.y)]);
					this.hurtEnemy(e, o.dmg, o.owner, o.src);
				}
			}
			o.life -= dt;
			if (o.life <= 0) {
				this.explode({ x: o.x, y: o.y, r: o.boomR, pdmg: 0, edmg: o.boom, owner: o.owner, kind: 3, src: o.src });
				continue;
			}
			this.orbs[j++] = o;
		}
		this.orbs.length = j;
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
			this.hurtEnemy(e, dmg, h, SRC.whip);
		}
		this.breakAround(cx, h.y, range / 2, h);
	}

	orbitHits(h, L, dmgMul, areaMul, amount) {
		const R = L.radius * areaMul;
		const bladeR = ORBIT_BLADE_R * areaMul;
		const count = L.count + amount;
		const bx = [], by = [];
		for (let i = 0; i < count; i++) {
			const a = orbitAngle(this.time, L.rps, i, count);
			bx.push(h.x + Math.cos(a) * R);
			by.push(h.y + Math.sin(a) * R);
		}
		if (this.tickNo % 3 === 0) for (let i = 0; i < count; i++) this.breakAround(bx[i], by[i], bladeR, h);
		const near = this.grid.query(h.x, h.y, R + bladeR + MAX_ENEMY_R, this.q2);
		if (!near.length) return;
		for (const e of near) {
			if (e.dead) continue;
			if (e.oh && (e.oh[h.pid] ?? 0) > this.time) continue;
			const rr = (bladeR + e.r) * (bladeR + e.r);
			for (let i = 0; i < bx.length; i++) {
				if (dist2(e.x, e.y, bx[i], by[i]) < rr) {
					(e.oh ??= {})[h.pid] = this.time + L.hitCd;
					this.hurtEnemy(e, L.dmg * dmgMul, h, SRC.orbit);
					break;
				}
			}
		}
	}

	// `outT` > 0 makes a returning projectile (sickle): straight out for outT seconds, then back to the owner.
	// opts: x, y (start), src, spike (knife becomes a spike on a miss), trail (ice trail), freezeBack (freeze on the way back).
	addProjectile(h, kind, ang, speed, dmg, pierce, life, target, outT = 0, opts = {}) {
		const p = {
			id: this.nextId++, kind: KIND_INDEX[kind], src: opts.src ?? SRC[kind === 'knife' ? 'knives' : kind], owner: h,
			x: opts.x ?? h.x, y: opts.y ?? h.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, speed, dmg, pierce, life, target,
			hit: [], outT, returns: outT > 0, spike: opts.spike ?? null, trail: opts.trail ?? null, freezeBack: opts.freezeBack ?? 0, anyHit: false,
		};
		this.projectiles.push(p);
		// Projectiles often live shorter than a snapshot interval, so clients simulate them from events.
		const ev = ['shot', p.id, p.kind, Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy),
			round3(life), target ? target.id : -1, round3(this.time)];
		if (outT > 0) ev.push(h.pid, round3(outT));
		this.fx.push(ev);
	}

	iceTrail(p, dt) {
		const tr = p.trail;
		tr.acc += dt;
		if (tr.acc < tr.every) return;
		tr.acc = 0;
		// Not sent to clients: they draw the trail from the disc's own path.
		this.puddles.push({ id: this.nextId++, owner: p.owner, x: p.x, y: p.y, r: tr.r, life: tr.life, dmg: 0, tick: 1, t: 1, slow: tr.slow, hidden: true });
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
				if (p.spike && !p.anyHit) this.layTrap(p.owner, { kind: 3, x: p.x, y: p.y, r: 14, dmg: p.spike.dmg, root: p.spike.root, life: p.spike.life, src: p.src });
				this.endProjectile(p);
				continue;
			}
			if (p.trail) this.iceTrail(p, dt);
			if (p.outT > 0) {
				p.outT -= dt;
				if (p.outT <= 0) p.hit.length = 0; // a new pass on the way back
			} else if (p.returns) {
				// Returning: fly straight at the owner and vanish on touch.
				const dx = p.owner.x - p.x, dy = p.owner.y - p.y;
				const d = Math.hypot(dx, dy) || 1;
				if (d < SICKLE_CATCH) {
					this.endProjectile(p);
					continue;
				}
				p.vx = (dx / d) * p.speed;
				p.vy = (dy / d) * p.speed;
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
			this.breakAround(p.x, p.y, PROJ_R, p.owner);
			this.grid.query(p.x, p.y, PROJ_R + MAX_ENEMY_R, near);
			for (const e of near) {
				if (e.dead || p.hit.includes(e.id)) continue;
				const min = e.r + PROJ_R;
				if (dist2(e.x, e.y, p.x, p.y) >= min * min) continue;
				p.hit.push(e.id);
				p.anyHit = true;
				this.hurtEnemy(e, p.dmg, p.owner, p.src);
				if (p.freezeBack > 0 && p.outT <= 0 && !e.dead && !e.boss) e.frozenT = Math.max(e.frozenT, this.time + p.freezeBack);
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

	updateTraps(dt) {
		if (!this.traps.length) return;
		const near = this.q1;
		let j = 0;
		for (const t of this.traps) {
			if (!this.heroes.has(t.owner.pid) || dist2(t.x, t.y, t.owner.x, t.owner.y) > TRAP_FAR2) continue;
			t.life -= dt;
			if (t.life <= 0) continue;
			let victim = null;
			if (t.armT <= this.time) {
				this.grid.query(t.x, t.y, t.r + MAX_ENEMY_R, near);
				for (const e of near) {
					const rr = t.r + e.r * 0.5;
					if (!e.dead && dist2(e.x, e.y, t.x, t.y) < rr * rr) {
						victim = e;
						break;
					}
				}
			}
			if (!victim) {
				this.traps[j++] = t;
				continue;
			}
			const src = t.src ?? SRC.traps;
			const stays = t.rearm > 0; // Растяжка: traps hold the thread net and re-arm instead of vanishing
			if (t.kind === 1) {
				// Mine: blast and recharge instead of vanishing.
				this.explode({ x: t.x, y: t.y, r: t.blastR, pdmg: 0, edmg: t.dmg, owner: t.owner, kind: 5, src, kb: t.kb });
				t.armT = this.time + t.recharge;
				this.traps[j++] = t;
				continue;
			}
			this.fx.push(['snap', Math.round(t.x), Math.round(t.y)]);
			if (!victim.boss && t.root > 0) victim.rootT = Math.max(victim.rootT, this.time + t.root);
			this.hurtEnemy(victim, t.dmg, t.owner, src);
			if (stays) {
				t.armT = this.time + t.rearm;
				this.traps[j++] = t;
			}
			if (t.splash > 0) {
				for (const e of this.grid.query(t.x, t.y, t.splash + MAX_ENEMY_R, near)) {
					const rr = t.splash + e.r * 0.5;
					if (e !== victim && !e.dead && dist2(e.x, e.y, t.x, t.y) < rr * rr) this.hurtEnemy(e, t.dmg * SPLASH_FRAC, t.owner, src);
				}
			}
		}
		this.traps.length = j;
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
				if (z.dmg > 0) {
					for (const e of near) {
						const rr = z.r + e.r * 0.5;
						if (e.dead || dist2(e.x, e.y, z.x, z.y) >= rr * rr) continue;
						if (!z.heal && !z.src) e.wetT = this.time + WET_HOLD; // wet from duo clouds and pools comes with wave 2
						this.hurtEnemy(e, z.dmg, z.owner, z.src ?? (z.heal ? SRC.censer : SRC.flask));
					}
					this.breakAround(z.x, z.y, z.r, z.owner);
				}
			}
			if (z.heal > 0) {
				for (const o of this.heroes.values()) {
					if (o !== z.owner && o.st === 0 && dist2(o.x, o.y, z.x, z.y) < z.r * z.r) o.hp = Math.min(o.maxHp, o.hp + z.heal * dt);
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
			e.slowT = Math.max(e.slowT, this.time + SLOW_HOLD);
		}
	}

	// Herald-like heroes heal other alive players standing inside their aura.
	auraHeals(dt, alive) {
		for (const h of alive) {
			if (h.st !== 0 || h.trait.auraHeal <= 0) continue;
			const auraId = h.weapons.has('aura') ? 'aura' : h.weapons.has('aurora') ? 'aurora' : null;
			if (!auraId) continue;
			const r = weaponDef(auraId).levels[h.weapons.get(auraId).lvl - 1].radius * h.mods.areaMul;
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
			if (g.pull && g.pull.st === 0 && this.heroes.has(g.pull.pid)) {
				best = g.pull;
				bd = dist2(g.x, g.y, best.x, best.y);
			} else {
				g.pull = null;
				for (const h of alive) {
					if (h.st !== 0) continue;
					const d = dist2(g.x, g.y, h.x, h.y);
					const mr = BASE_MAGNET * h.mods.magnetMul;
					if (d < mr * mr && d < bd) {
						bd = d;
						best = h;
					}
				}
			}
			if (best) {
				const d = Math.sqrt(bd);
				if (d < PLAYER_RADIUS + 6) {
					this.collectGem(best, g.xp);
					continue;
				}
				const step = Math.min(d, (g.pull ? GEM_PULL_SPEED * 2 : GEM_PULL_SPEED) * dt);
				g.x += ((best.x - g.x) / d) * step;
				g.y += ((best.y - g.y) / d) * step;
			}
			this.gems[j++] = g;
		}
		this.gems.length = j;
	}

	collectGem(h, xp) {
		this.addXp(h, xp * h.mods.xpMul);
		for (const o of this.heroes.values()) if (o !== h && o.st === 0) this.addXp(o, xp * GEM_SHARE * o.mods.xpMul);
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

	enemyState(en) {
		const t = this.time;
		let st = 0;
		if (en.burnT > t) st |= ST.burn;
		if (en.slowT > t) st |= ST.chill;
		if (en.frozenT > t) st |= ST.frozen;
		if (en.wetT > t) st |= ST.wet;
		if (en.markT > t) st |= ST.mark;
		if (en.rootT > t) st |= ST.root;
		if (en.elite) st |= ST.elite;
		if (en.windT > 0 || en.fuseT > 0) st |= ST.windup;
		return st;
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
			// Orbit gets a 3rd field with extra blades (Echo) so clients draw what the server hits with.
			[...h.weapons].map(([id, w]) => (id === 'orrery' ? [id, w.lvl, h.mods.amount, this.orreryMask(h, w)]
				: (id === 'orbit' || id === 'windmill') && h.mods.amount > 0 ? [id, w.lvl, h.mods.amount] : [id, w.lvl])),
		]);
		const e = [];
		for (const en of this.enemies) {
			if (en.dead || !visible(en.x, en.y)) continue;
			e.push(en.id, en.type, Math.round(en.x), Math.round(en.y), clamp(Math.ceil((en.hp / en.maxHp) * 100), 1, 100), this.enemyState(en));
		}
		const b = []; // projectiles travel as shot/ptgt/pend events in fx
		const g = [];
		for (const gm of this.gems) {
			if (!visible(gm.x, gm.y)) continue;
			g.push(gm.id, Math.round(gm.x), Math.round(gm.y), gemTier(gm.xp, gm.gold));
		}
		const z = [];
		for (const pz of this.puddles) if (!pz.hidden && visible(pz.x, pz.y)) z.push(pz.id, Math.round(pz.x), Math.round(pz.y), Math.round(pz.r));
		const tr = [];
		for (const t of this.traps) {
			if (!visible(t.x, t.y)) continue;
			tr.push(t.id, Math.round(t.x), Math.round(t.y), t.kind === 1 && t.armT > this.time ? 2 : t.kind, t.owner.pid);
		}
		const it = [];
		for (const i of this.items) if (visible(i.x, i.y)) it.push(i.id, i.type, Math.round(i.x), Math.round(i.y));
		const boss = this.bosses.find((x) => !x.dead);
		const msg = {
			t: 's', tm: Math.round(this.time * 100) / 100, k: this.kills, p, e, b, g, z, tr, it, syn: Math.round(this.synergy * 100),
			fx: this.fx, boss: boss ? [Math.ceil(boss.hp), Math.round(boss.maxHp)] : null,
		};
		this.fx = [];
		this.hitFx = 0;
		this.dieFx = 0;
		this.critFx = 0;
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
