import {
	TICK_HZ, SNAPSHOT_HZ, MAX_PLAYERS, RUN_SECONDS, MAX_ENEMIES, MAX_GEMS, PLAYER_RADIUS,
	REVIVE_RADIUS, REVIVE_SECONDS, REVIVE_HP_FRACTION, PLAYER_IFRAMES, MAX_LEVEL,
	MAX_WEAPONS, MAX_PASSIVES, BOSS_TIMES, xpForNext, PLAYER_COLORS, HEROES, WEAPONS, PASSIVES,
	BASE_MAGNET, GEM_PULL_SPEED, ENEMIES, ENEMY_TYPES, PROJECTILE_KINDS, WEAPON_IDS, PASSIVE_IDS,
	WAVES, enemyHpScale, spawnRateScale, SPAWN_DISTANCE, orbitAngle, heroTrait, enemyDmgScale, INVASION, invasionCount, ELITE_EVERY_LATE,
	passiveValue, baseMods, REROLLS_START, SKIP_XP, RARE_CHANCE, CHEST_RARE_CHANCE, HEAL_OFFER_HP, ST,
	ELITE_START, ELITE_EVERY, ELITE_HP_MUL, ELITE_R_MUL, ELITE_CHEST_CHANCE, ELITE_AFFIXES,
	GOLD_GEM_CHANCE, GOLD_GEM_MUL, GEM_SWEEP_EVERY, GEM_SWEEP_PLACE, gemTier, ITEMS, ITEM_TYPES, ITEM_LIFE,
	MAGNET_ITEM_EVERY, BREAK_TILE, BREAK_R, BREAK_DROPS, breakableAt, HOSTILE_R,
	DUOS, DUO_IDS, DUO_BY_PAIR, duoKey, MAX_DUOS, DUO_MIN_LEVEL, DUO_DEFER_OFFERS, duoStartLevel, weaponDef, weaponMaxLevel,
	SYNERGY_PER, SYNERGY_MAX, ROMAN, EVOS, EVO_IDS, EVO_BY_WEAPON, EMBERS,
	BOSS_SCHEDULE, BOSS_POOL, FINAL_BOSS, bossHpScale, REACT, REACTION_IDS, REACTIONS, reactionHint, SYNERGIES,
	beaconAngle, PEAK_WARN, peakSchedule,
} from '../public/shared/content.js';
import { RunLog, runStore, enemyKey } from './runlog.js';
import { SnapshotEncoder, PROTO, isLegacy } from './snapshot-codec.js';

const SNAPSHOT_EVERY = Math.max(1, Math.round(TICK_HZ / SNAPSHOT_HZ));
// Row widths of the flat snapshot arrays; must match the pushes in Room.snapshot() (the codec relies on them).
const SNAP_STRIDE = { e: 6, g: 4, z: 4, tr: 5, it: 4 };
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
const FREEZE_IMMUNE = 1.5;
const TRAIL_MAX = 24;
const SPEAR_RANGE = 500;
const KNOCK_EVERY = 1.0;
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
const SRC = Object.fromEntries([...WEAPON_IDS, ...DUO_IDS, ...EVO_IDS].map((id) => [id, { weapon: id, tags: weaponDef(id).tags ?? [] }]));
const SRC_NONE = { weapon: 'other', tags: [] };
const SRC_BLAST = { weapon: 'blast', tags: ['fire', 'aoe'] };
const SRC_BURN = { weapon: 'burn', tags: ['fire'], react: true }; // damage over time never triggers reactions
// Reaction side damage: its own entry in damage stats, never chains into another reaction.
const SRC_R = Object.fromEntries(REACTION_IDS.map((id) => [id, { weapon: 'r_' + id, tags: [], react: true }]));
const REACT_INDEX = Object.fromEntries(REACTION_IDS.map((id, i) => [id, i]));
const MAX_REACT_FX = 10;
const MAX_STEAMS = 16;
const BOND_R = 250;
const BOND_ALLY = 0.02;
const SPEAR_BOND_R = 60;
const SPEAR_BOND_MUL = 1.3;
const AURA_CHILL = 0.15;
const LIGHTNING_EMBER_BURN = 3;
const BOMB_BURN = { frac: 0.08, dur: 3 };
const MINE_BURN = { frac: 0.06, dur: 3 };
const MOLOTOV_BURN = 0.6; // burn dps = pool tick damage × this
const CROSS_STEP = 50;
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
		fused: new Set(), duoDefer: {}, offerNo: 0, startWeapon: h.weapon, evolved: new Set(), embers: {}, ward: 0, wardMax: 0,
		guard: 0, bondMul: 1, bannerT: 0,
	};
}

export class Room {
	constructor(code, send) {
		this.code = code;
		this.send = send;
		this.runLength = RUN_SECONDS; // a run mode may set it before start(); peaks follow it
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
			this.needKey?.add(pid);
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
			case 'kf':
				this.needKey?.add(pid);
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
		this.bossPlan = shuffle([...BOSS_POOL]);
		this.hostile = [];
		this.blasts = [];
		this.traps = [];
		this.items = [];
		this.broken = new Set();
		this.brokenList = [];
		this.nextEliteT = ELITE_START;
		this.nextInvasionT = INVASION.from;
		this.peaks = peakSchedule(this.runLength, BOSS_TIMES);
		this.peakIdx = 0;
		this.peakWarned = 0;
		this.peak = null;
		this.nextGemSweep = GEM_SWEEP_EVERY;
		this.nextMagnetT = MAGNET_ITEM_EVERY;
		this.critFx = 0;
		this.orbs = [];
		this.steams = [];
		this.banners = [];
		this.reactN = Object.fromEntries(REACTION_IDS.map((id) => [id, 0]));
		this.reactFx = 0;
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
		this.runLog = new RunLog(this);
		this.snapCodec = new SnapshotEncoder(SNAP_STRIDE);
		this.needKey = new Set();
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
		for (const id of [...WEAPON_IDS, ...DUO_IDS, ...EVO_IDS]) {
			const w = h.weapons.get(id);
			const W = weaponDef(id);
			if (w) {
				if (w.lvl < weaponMaxLevel(id)) ups.push({ id, kind: 'weapon', name: W.name, icon: W.icon, desc: upgradeDesc(id, w.lvl + 1), level: w.lvl + 1, duo: DUOS[id] ? 1 : undefined });
			} else if (WEAPONS[id] && !h.fused.has(id) && !h.evolved.has(id) && h.weapons.size < MAX_WEAPONS) {
				const card = { id, kind: 'weapon', name: W.name, icon: W.icon, desc: W.desc, level: 1 };
				newW.push(card);
				// The hero's starting weapon pulls its duo partners: weight ×2.
				if (DUO_BY_PAIR[duoKey(id, h.startWeapon)] && !h.fused.has(h.startWeapon)) newW.push(card);
			}
		}
		for (const id of PASSIVE_IDS) {
			const lvl = h.passives.get(id) ?? 0;
			const P = PASSIVES[id];
			if (P.coop && this.heroes.size < 2) continue;
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
		// An evolution or a ready duo goes to slot 1 (unless the player declined it recently).
		const evo = this.readyEvo(h);
		const ready = h.combos.find((c) => c.ready && !(h.duoDefer[c.id] > h.offerNo));
		if (evo) out.push(this.evoCard(h, evo));
		else if (ready) out.push(this.duoCard(h, ready));
		else if (!take(ups)) take(fresh());
		if (Math.random() < 0.5) {
			if (!take(ups)) take(fresh());
		} else if (!take(fresh())) take(ups);
		take(shuffle([...ups, ...newW, ...newP]));
		h.lastOfferNewW = newWTaken;
		const heal = { id: 'heal', kind: 'heal', name: 'Лечение', icon: '✚', desc: `+${HEAL_AMOUNT} здоровья`, level: 0 };
		// Nothing (or not enough) left to upgrade: embers — small permanent bonuses for this run.
		if (out.length < 3) out.push(...this.emberCards(h, 3 - out.length));
		for (const c of out) {
			this.duoHint(h, c);
			this.waveHints(h, c);
		}
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

	// «💥 реакция «Проводник» с «Зелье» (союзник)» on new weapons; «✦ …» for weapon + artifact synergies.
	waveHints(h, c) {
		if (c.kind === 'weapon' && c.level === 1 && WEAPONS[c.id]) {
			const mine = [...h.weapons.keys()];
			const team = [];
			for (const o of this.heroes.values()) if (o !== h) team.push(...o.weapons.keys());
			const hint = reactionHint(c.id, mine) ?? reactionHint(c.id, team);
			if (hint) c.reactHint = { name: REACTIONS[hint.reaction].name, withName: weaponDef(hint.with).name, ally: !mine.includes(hint.with) };
		}
		const syn = SYNERGIES.find((x) => (c.kind === 'weapon' && x.weapon === c.id && h.passives.has(x.passive))
			|| (c.kind === 'passive' && x.passive === c.id && h.weapons.has(x.weapon)));
		if (syn) c.synHint = { withName: c.kind === 'weapon' ? PASSIVES[syn.passive].name : WEAPONS[syn.weapon].name, desc: syn.desc };
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
		this.runLog?.fused(this, h, 'duo', card.id);
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
		this.runLog?.choice(this, h, 'pick', c, h.offer);
		this.deferSkippedDuos(h, c);
		if (c.kind === 'duo') {
			this.fuseDuo(h, c);
		} else if (c.kind === 'evo') {
			this.evolve(h, c);
		} else if (c.kind === 'ember') {
			h.embers[c.id] = (h.embers[c.id] ?? 0) + 1;
			const before = h.maxHp;
			this.recalcMods(h);
			if (h.st === 0) h.hp = Math.min(h.maxHp, h.hp + (h.maxHp - before) + (EMBERS[c.id].heal ?? 0));
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
		if (c.kind === 'weapon' || c.kind === 'rare' || c.kind === 'duo' || c.kind === 'evo') this.updateCombos(h);
		this.nextOffer(h);
	}

	// A duo card that was not taken (another card or «Отказаться») comes back after DUO_DEFER_OFFERS offers.
	deferSkippedDuos(h, picked) {
		for (const c of h.offer ?? []) if ((c.kind === 'duo' || c.kind === 'evo') && c !== picked) h.duoDefer[c.id] = h.offerNo + DUO_DEFER_OFFERS;
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
		this.runLog?.choice(this, h, 'reroll', null, h.offer);
		h.rerolls--;
		h.offer = this.makeChoices(h);
		this.sendOffer(h);
	}

	// Declining the whole offer gives SKIP_XP instead (no junk in slots).
	onSkip(pid) {
		if (this.state !== 'play') return;
		const h = this.heroes.get(pid);
		if (!h?.offer) return;
		this.runLog?.choice(this, h, 'skip', null, h.offer);
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
		for (const [id, n] of Object.entries(h.embers ?? {})) m[EMBERS[id].stat] += EMBERS[id].value * n;
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
		if (this.tickNo % SNAPSHOT_EVERY === 1 % SNAPSHOT_EVERY) this.reactFx = 0;
		const alive = [];
		for (const h of this.heroes.values()) if (h.st === 0) alive.push(h);

		this.updatePeaks(alive);
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
				if (!this.nearPeak()) this.invasion(alive);
			}
			if (this.time >= this.nextGemSweep) {
				this.nextGemSweep = this.time + GEM_SWEEP_EVERY;
				this.sweepFarGems(alive);
			}
		}

		this.runLog?.tick(this);
		if (this.checkAllDown()) return;
		if (this.time >= this.runLength) {
			if (this.peaks.some((p) => p.burn)) this.burnAll();
			this.finish(true);
			return;
		}
		if (this.tickNo % SNAPSHOT_EVERY === 0) this.snapshot();
	}

	randomRingPos(alive) {
		const p = alive[Math.floor(Math.random() * alive.length)];
		const a = Math.random() * Math.PI * 2;
		const d = (SPAWN_DISTANCE.min + Math.random() * (SPAWN_DISTANCE.max - SPAWN_DISTANCE.min)) * (this.peak?.spawnDist ?? 1);
		return [p.x + Math.cos(a) * d, p.y + Math.sin(a) * d];
	}

	spawnEnemy(type, alive, hpMul) {
		const E = ENEMIES[type];
		const [x, y] = this.randomRingPos(alive);
		const hp = E.hp * hpMul;
		const e = {
			id: this.nextId++, type: TYPE_INDEX[type], def: E, x, y, hp, maxHp: hp,
			speed: E.speed * (0.9 + Math.random() * 0.2), dmg: E.dmg * enemyDmgScale(this.time, this.heroes.size), dmgMul: enemyDmgScale(this.time, this.heroes.size), r: E.r, xp: E.xp * (this.peak?.xpMul ?? 1),
			dead: false, zig: type === 'wisp', phase: Math.random() * Math.PI * 2, oh: null,
			boss: E.boss === true, ai: E.ai ?? null, bk: E.bk ?? null, bs: 0, bt: 0, bcd: 2, dcd: 1, vulnT: 0, group: 0, tx: 0, ty: 0, bvx: 0, bvy: 0, split: false,
			slow: 0, slowT: 0, frozenT: 0, thawT: 0, knockT: 0, rootT: 0, wetT: 0, markT: 0, markMul: 0,
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
			const type = this.bossIdx < BOSS_SCHEDULE.length ? this.bossPlan[this.bossIdx % this.bossPlan.length] : FINAL_BOSS.type;
			this.bossIdx++;
			this.spawnBoss(type, alive);
		}
		const wave = this.currentWave();
		this.spawnAcc += wave.rate * spawnRateScale(n) * (this.peak?.spawnMul ?? 1) * dt;
		if (this.spawnAcc < 1) return;
		const hpMul = enemyHpScale(this.time, n);
		const cap = MAX_ENEMIES + (this.peak?.capAdd ?? 0);
		while (this.spawnAcc >= 1) {
			this.spawnAcc -= 1;
			if (this.enemies.length >= cap) {
				this.spawnAcc = 0;
				break;
			}
			this.spawnEnemy(this.waveType(wave), alive, hpMul);
		}
	}

	spawnBoss(type, alive) {
		const b = this.spawnEnemy(type, alive, bossHpScale(this.time, this.heroes.size));
		b.group = b.id;
		this.bosses.push(b);
		this.fx.push(['boss', ENEMIES[type].name]);
		this.runLog?.bossSpawn(this, b);
		return b;
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

	// --- peaks (this.peaks = peakSchedule(runLength)): warning fx, start fx with side effects, end; the active one is this.peak.
	updatePeaks(alive) {
		if (this.peak && this.time >= this.peak.at + this.peak.dur) {
			this.runLog?.peakEnd(this, this.peak);
			this.peak = null;
		}
		// Peaks already over (time jumped past them) are skipped, not started late.
		while (this.peaks[this.peakIdx] && this.time >= this.peaks[this.peakIdx].at + this.peaks[this.peakIdx].dur) this.peakIdx++;
		this.peakWarned = Math.max(this.peakWarned, this.peakIdx);
		const next = this.peaks[this.peakIdx];
		if (!next) return;
		if (this.peakWarned === this.peakIdx && this.time >= next.at - PEAK_WARN) {
			this.peakWarned++;
			this.fx.push(['peakw', this.peakIdx]);
		}
		if (this.time < next.at) return;
		this.peakIdx++;
		this.peak = next;
		this.fx.push(['peak', this.peakIdx - 1]);
		this.runLog?.peakStart(this, next);
		if (next.ring && alive.length) this.peakRing(next.ring, alive);
	}

	// Invasions skip a peak's warning and active time so the two never stack.
	nearPeak() {
		return this.peaks.some((p) => this.time >= p.at - PEAK_WARN - 1 && this.time < p.at + p.dur);
	}

	// One ring per cluster of alive players: `count` enemies (scaled like spawn) on a circle around the cluster.
	peakRing(R, alive) {
		const wave = this.currentWave();
		const hpMul = enemyHpScale(this.time, this.heroes.size);
		const left = new Set(alive);
		let spawned = 0;
		for (const h of alive) {
			if (!left.has(h)) continue;
			const group = [...left].filter((o) => dist2(o.x, o.y, h.x, h.y) < R.cluster * R.cluster);
			for (const o of group) left.delete(o);
			const cx = group.reduce((s, o) => s + o.x, 0) / group.length, cy = group.reduce((s, o) => s + o.y, 0) / group.length;
			const r = R.r + Math.max(...group.map((o) => Math.hypot(o.x - cx, o.y - cy)));
			const count = Math.round(R.count * spawnRateScale(group.length));
			this.fx.push(['pring', Math.round(cx), Math.round(cy), Math.round(r)]);
			for (let i = 0; i < count && this.enemies.length < MAX_ENEMIES + 120; i++) {
				const e = this.spawnEnemy(R.type ?? this.waveType(wave), alive, hpMul);
				const a = (i / count) * Math.PI * 2;
				e.x = cx + Math.cos(a) * r;
				e.y = cy + Math.sin(a) * r;
				spawned++;
			}
		}
		this.runLog?.peakNote(this, 'spawned', spawned);
	}

	// Dawn: at the end of the run every enemy and enemy shot burns away (no kills or xp).
	burnAll() {
		let n = 0;
		for (const e of this.enemies) if (!e.dead) {
			e.dead = true;
			n++;
		}
		this.hostile.length = 0;
		this.fx.push(['dawn', n]);
		this.runLog?.peakNote(this, 'burned', n);
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
		const speedMul = this.peak?.speedMul ?? 1;
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
				e.bs = 0;
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
			let speed = (e.slowT > now ? e.speed * (1 - e.slow) : e.speed) * speedMul;
			let maxStep = Math.max(0, d - e.r - PLAYER_RADIUS + 2);
			if (e.bk && this.bossTick(e, best, d, dx, dy, speed, dt)) continue;
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

	// --- bosses: every attack is telegraphed (warn circle, lane or windup glow) for ≥ 0.6 s. Returns true when it moved itself.

	bossTick(e, t, d, dx, dy, speed, dt) {
		const E = e.def;
		const rage = E.rage && e.hp < e.maxHp * E.rage;
		if (e.windT > 0) e.windT = Math.max(0, e.windT - dt);
		switch (e.bk) {
			case 'ram':
				return this.dashTick(e, t, d, dt, true);
			case 'brood': {
				if (e.bs === 'call') {
					e.bt -= dt;
					if (e.bt <= 0) {
						this.summon(e, E.call, e.tx, e.ty);
						e.bs = 0;
						e.bcd = E.callCd * (rage ? 0.8 : 1);
					}
					return true;
				}
				if (this.dashTick(e, t, d, dt, rage)) return true;
				e.bcd -= dt;
				if (e.bcd <= 0 && d < 700) {
					e.bs = 'call';
					e.bt = e.windT = E.windup;
					e.vulnT = this.time + E.windup;
					e.tx = t.x;
					e.ty = t.y;
					this.fx.push(['warn', Math.round(t.x), Math.round(t.y), E.call.ring + 20, round3(E.windup)]);
					return true;
				}
				return false;
			}
			case 'gunner': {
				if (e.bs === 'wind') {
					e.bt -= dt;
					if (e.bt <= 0) {
						e.bs = 0;
						e.bcd = E.cd;
						this.shotRing(e, E.shots, E.shotSpeed, E.shotDmg, E.shotLife, Math.random() * Math.PI);
						if (rage) this.after(0.35, () => !e.dead && this.shotRing(e, E.shots, E.shotSpeed, E.shotDmg, E.shotLife, Math.random() * Math.PI));
					}
					return true;
				}
				e.bcd -= dt;
				if (e.bcd <= 0 && d < 600) {
					e.bs = 'wind';
					e.bt = e.windT = E.windup;
					return true;
				}
				const [kmin, kmax] = E.keep;
				if (d < kmin) this.bossStep(e, -dx, -dy, speed, dt);
				else if (d <= kmax) {
					const sg = Math.sin(e.phase + this.time * 0.3) >= 0 ? 1 : -1;
					this.bossStep(e, -dy * sg, dx * sg, speed * 0.6, dt);
				} else this.bossStep(e, dx, dy, speed, dt);
				return true;
			}
			case 'twin':
				if (!e.split && e.hp > 0 && e.hp <= e.maxHp * E.splitAt) {
					this.splitTwin(e);
					return true;
				}
				return false;
			case 'half': {
				if (e.bs === 'blink') {
					e.bt -= dt;
					if (e.bt <= 0) {
						this.fx.push(['blink', Math.round(e.x), Math.round(e.y)]);
						e.x = e.tx;
						e.y = e.ty;
						e.bs = 0;
						e.bcd = E.blinkCd;
					}
					return true;
				}
				e.bcd -= dt;
				if (e.bcd <= 0 && d > 120 && d < 900) {
					const step = Math.min(E.blinkDist, d - e.r - PLAYER_RADIUS);
					e.tx = e.x + dx * step;
					e.ty = e.y + dy * step;
					e.bs = 'blink';
					e.bt = e.windT = E.blinkWarn;
					this.fx.push(['warn', Math.round(e.tx), Math.round(e.ty), Math.round(e.r + 24), round3(E.blinkWarn)]);
					return true;
				}
				return false;
			}
			case 'lord':
				return this.lordTick(e, t, d, dt, rage);
		}
		return false;
	}

	bossStep(e, dx, dy, speed, dt) {
		e.x += dx * speed * dt;
		e.y += dy * speed * dt;
	}

	// Charge: a red lane for dashWarn seconds, a straight dash, then a rest. `allowed` — may start a new charge.
	dashTick(e, t, d, dt, allowed) {
		const E = e.def;
		if (e.bs === 'aim') {
			e.bt -= dt;
			if (e.bt <= 0) {
				e.bs = 'dash';
				e.bt = E.dashTime;
			}
			return true;
		}
		if (e.bs === 'dash') {
			e.bt -= dt;
			this.bossStep(e, e.bvx, e.bvy, E.dashSpeed, dt);
			if (e.bt <= 0) {
				e.bs = 'rest';
				e.bt = E.rest;
			}
			return true;
		}
		if (e.bs === 'rest') {
			e.bt -= dt;
			if (e.bt <= 0) e.bs = 0;
			return true;
		}
		e.dcd -= dt;
		if (!allowed || e.dcd > 0 || d > E.trigger || d < e.r) return false;
		const l = d || 1;
		e.bvx = (t.x - e.x) / l;
		e.bvy = (t.y - e.y) / l;
		e.bs = 'aim';
		e.bt = e.windT = E.dashWarn;
		e.dcd = 0.5;
		const len = E.dashSpeed * E.dashTime;
		this.fx.push(['bline', Math.round(e.x), Math.round(e.y), Math.round(e.x + e.bvx * len), Math.round(e.y + e.bvy * len), Math.round(e.r * 2), round3(E.dashWarn)]);
		return true;
	}

	// The Lord cycles: shock ring around itself → ring of bolts → swarm call. Faster below half hp.
	lordTick(e, t, d, dt, rage) {
		const E = e.def;
		if (e.bs === 'ring') {
			e.bt -= dt;
			if (e.bt <= 0) {
				e.bs = 0;
				this.shotRing(e, E.ring.shots, E.ring.speed, E.ring.dmg, E.ring.life, Math.random() * Math.PI);
				if (rage) this.after(0.4, () => !e.dead && this.shotRing(e, E.ring.shots, E.ring.speed, E.ring.dmg, E.ring.life, Math.random() * Math.PI));
			}
			return true;
		}
		e.bcd -= dt;
		if (e.bcd > 0 || d > 700) return false;
		e.bcd = E.cd * (rage ? 0.65 : 1);
		const move = e.bt2 = ((e.bt2 ?? -1) + 1) % 3;
		if (move === 0) {
			this.addBlast(e.x, e.y, E.wave.r, E.wave.dmg * e.dmgMul, 0, null, 9, E.wave.warn, SRC_NONE, 'boss:wave');
			return false;
		}
		if (move === 1) {
			e.bs = 'ring';
			e.bt = e.windT = E.ring.windup;
			return true;
		}
		const tx = t.x, ty = t.y;
		this.fx.push(['warn', Math.round(tx), Math.round(ty), E.call.ring + 20, round3(E.call.warn)]);
		this.after(E.call.warn, () => !e.dead && this.summon(e, E.call, tx, ty));
		return false;
	}

	summon(e, call, x, y) {
		const alive = [...this.heroes.values()].filter((h) => h.st === 0);
		if (!alive.length) return;
		const count = Math.round(call.count * (1 + 0.25 * (this.heroes.size - 1)));
		const hpMul = enemyHpScale(this.time, this.heroes.size);
		for (let i = 0; i < count && this.enemies.length < MAX_ENEMIES + 60; i++) {
			const m = this.spawnEnemy(call.type, alive, hpMul);
			const a = (i / count) * Math.PI * 2;
			m.x = x + Math.cos(a) * call.ring;
			m.y = y + Math.sin(a) * call.ring;
		}
	}

	shotRing(e, n, speed, dmg, life, a0) {
		for (let i = 0; i < n; i++) {
			const a = a0 + (i / n) * Math.PI * 2;
			const s = { id: this.nextId++, x: e.x, y: e.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life, dmg: dmg * e.dmgMul, from: enemyKey(e) + ':shot' };
			this.hostile.push(s);
			this.fx.push(['eshot', s.id, Math.round(s.x), Math.round(s.y), Math.round(s.vx), Math.round(s.vy), round3(s.life), round3(this.time)]);
		}
	}

	// The twin leaves the field (no kill, no chest) and two halves take over its group; the chest drops after both.
	splitTwin(e) {
		const E = e.def;
		e.split = true;
		e.dead = true;
		const bi = this.bosses.indexOf(e);
		if (bi >= 0) this.bosses.splice(bi, 1);
		this.fx.push(['blink', Math.round(e.x), Math.round(e.y)]);
		for (const side of [-1, 1]) {
			const h = this.spawnEnemy('twinhalf', [...this.heroes.values()].filter((p) => p.st === 0), 1);
			h.hp = h.maxHp = e.maxHp * E.halfHp;
			h.x = e.x + side * 50;
			h.y = e.y;
			h.dmgMul = e.dmgMul;
			h.dmg = h.def.dmg * e.dmgMul;
			h.group = e.group;
			h.barMax = e.maxHp / 2; // the bar continues from the whole twin's hp
			h.bcd = 1.5 + (side > 0 ? 1.2 : 0);
			this.bosses.push(h);
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
			life: E.shotLife, dmg: E.shotDmg * e.dmgMul, from: (e.elite ? 'elite' : enemyKey(e)) + ':shot',
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
					if (h.iframes <= 0) this.hurtPlayer(h, s.dmg, s.from);
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

	// The single damage entry point: mark → crit → reactions → armor → hp → burn.
	hurtEnemy(e, dmg, h, src = SRC_NONE) {
		if (e.dead || dmg <= 0) return 0;
		const now = this.time;
		let crit = false;
		if (!src.raw && e.markT > now) dmg *= 1 + e.markMul;
		if (e.vulnT > now) dmg *= e.def.vuln ?? 1;
		if (h && !src.raw) {
			if (h.rageT > now) dmg *= ITEMS.rage.mul;
			if (this.synergy > 0) dmg *= 1 + this.synergy;
			if (h.bondMul > 1) dmg *= h.bondMul;
			if (h.bannerT > now) dmg *= 1 + EVOS.banner.levels[0].dmgBuff;
			if (h.mods.chillVuln > 0 && e.slowT > now) dmg *= 1 + h.mods.chillVuln;
			if (h.mods.critChance > 0 && Math.random() < h.mods.critChance) {
				crit = true;
				dmg *= h.mods.critMul;
			}
		}
		if (!src.react && !src.raw && src.tags.length) dmg = this.react(e, dmg, h, src);
		if (e.elite === 'armored' && src.tags.includes('proj')) dmg *= 0.5;
		const dealt = Math.min(dmg, e.hp);
		if (h) {
			h.dmg += dealt;
			h.dmgBy[src.weapon] = (h.dmgBy[src.weapon] ?? 0) + dealt;
		}
		e.hp -= dmg;
		this.lastCrit = crit;
		if (crit && this.critFx < MAX_CRIT_FX) {
			this.critFx++;
			this.fx.push(['hit', Math.round(e.x), Math.round(e.y), Math.max(1, Math.round(dmg)), 1, h.pid]);
		} else if (this.hitFx < MAX_HIT_FX) {
			this.hitFx++;
			this.fx.push(['hit', Math.round(e.x), Math.round(e.y), Math.max(1, Math.round(dmg))]);
		}
		if (e.hp <= 0) this.killEnemy(e, h, src);
		else if (h && h.mods.burnChance > 0 && !src.react && Math.random() < h.mods.burnChance) this.burn(e, h, h.mods.burnDps, 3);
		return dmg;
	}

	// Reactions (5.3): the enemy's states meet the hit's tags; returns the (possibly multiplied) damage.
	react(e, dmg, h, src) {
		const now = this.time, t = src.tags;
		const fire = t.includes('fire'), cold = t.includes('cold'), shock = t.includes('shock');
		if (fire && e.rootT > now && t.includes('aoe')) {
			dmg *= REACT.blastMul;
			this.reacted('blast', e.x, e.y, 0);
		}
		if (t.includes('phys') && e.frozenT > now) {
			dmg *= REACT.shatterMul;
			e.frozenT = now;
			e.thawT = now + FREEZE_IMMUNE;
			this.reacted('shatter', e.x, e.y, REACT.shatterR);
			this.splash(e.x, e.y, REACT.shatterR, dmg * REACT.shatterFrac, h, SRC_R.shatter, e);
		}
		if (shock && e.burnT > now) {
			e.burnT = 0;
			this.reacted('flash', e.x, e.y, REACT.flashR);
			this.splash(e.x, e.y, REACT.flashR, REACT.flashBase * (h?.mods.dmgMul ?? 1) + dmg * REACT.flashFrac, h, SRC_R.flash, null);
		}
		if (shock && e.wetT > now && e.wetZ && e.wetZ.life > 0 && !(e.wetZ.condT > now)) {
			const z = e.wetZ;
			z.condT = now + REACT.condEvery;
			this.reacted('cond', z.x, z.y, z.r);
			this.splash(z.x, z.y, z.r, dmg * REACT.condFrac, h, SRC_R.cond, e);
		}
		if (cold && e.wetT > now && !e.boss && e.frozenT <= now && this.freeze(e, REACT.icingFreeze * (h?.mods.ctrlMul ?? 1))) this.reacted('icing', e.x, e.y, 0);
		if (!(e.steamT > now) && ((cold && e.burnT > now) || (fire && e.slowT > now && e.frozenT <= now))) {
			e.burnT = 0;
			e.slowT = 0;
			e.steamT = now + REACT.steamLife;
			this.reacted('steam', e.x, e.y, REACT.steamR);
			if (this.steams.length >= MAX_STEAMS) this.steams.shift();
			this.steams.push({ x: e.x, y: e.y, r: REACT.steamR, t: now + REACT.steamLife });
		}
		return dmg;
	}

	reacted(kind, x, y, r) {
		this.reactN[kind]++;
		if (this.reactFx >= MAX_REACT_FX) return;
		this.reactFx++;
		this.fx.push(['react', REACT_INDEX[kind], Math.round(x), Math.round(y), Math.round(r)]);
	}

	// Damage everyone in a circle (except `skip`) from a reaction or a side effect.
	splash(x, y, r, dmg, h, src, skip) {
		for (const o of this.grid.query(x, y, r + MAX_ENEMY_R, [])) {
			if (o === skip || o.dead || dist2(o.x, o.y, x, y) >= (r + o.r * 0.5) ** 2) continue;
			this.hurtEnemy(o, dmg, h, src);
		}
	}

	// Steam clouds halve contact damage of enemies standing in them.
	inSteam(e) {
		for (const c of this.steams) if (c.t > this.time && dist2(e.x, e.y, c.x, c.y) < c.r * c.r) return true;
		return false;
	}

	root(e, dur) {
		if (e.boss || dur <= 0) return;
		e.rootT = Math.max(e.rootT, this.time + dur);
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
		this.dropGem(e.x, e.y, e.beaconT > this.time ? e.xp * EVOS.beacon.levels[0].xpMul : e.xp, Math.random() < GOLD_GEM_CHANCE * (1 + luck));
		if (e.burnT > this.time && e.burnOwner?.weapons.has('firepath')) this.spreadFire(e);
		if (h && src.weapon === 'fireworks') this.gems[this.gems.length - 1].pull = h;
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
			if (!this.bosses.some((o) => o.group === e.group)) {
				this.fx.push(['chest', Math.round(e.x), Math.round(e.y)]);
				this.runLog?.bossKilled(this, e);
				for (const p of this.heroes.values()) if (p.st === 0) this.grantOffer(p);
			}
		}
	}

	// kind: 0 petard (enemies only), 1 bloater, 2 volatile elite (both hurt players too).
	addBlast(x, y, r, pdmg, edmg, owner, kind, delay, src = SRC_BLAST, from = null) {
		const b = { x, y, r, pdmg, edmg, owner, kind, t: this.time + delay, src, from };
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
			if (b.burn && !e.dead) this.burn(e, b.owner, b.edmg * b.burn.frac, b.burn.dur);
			if (b.kb && !e.dead && !e.boss) this.knock(e, b.x, b.y, b.kb);
		}
		if (b.then) b.then(b);
		if (b.pdmg > 0) {
			for (const h of this.heroes.values()) {
				const rr = b.r + PLAYER_RADIUS;
				if (h.st === 0 && h.iframes <= 0 && dist2(h.x, h.y, b.x, b.y) < rr * rr) this.hurtPlayer(h, b.pdmg, b.from ?? (b.kind === 2 ? 'elite:blast' : 'bloater:blast'));
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
		this.updateBuffs(alive);
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
				this.hurtPlayer(h, e.steamT > now && this.inSteam(e) ? e.dmg * REACT.steamContact : e.dmg, e.elite ? 'elite' : enemyKey(e));
				if (h.st !== 0) break;
			}
			if (h.st !== 0) continue;
			this.breakAround(h.x, h.y, PLAYER_RADIUS, h);
			for (const [id, w] of h.weapons) this.updateWeapon(h, id, w, dt);
		}
	}

	// Bond (+dmg per ally nearby, +2% to allies near a bond holder) and Banner (+dmg inside its radius).
	updateBuffs(alive) {
		const now = this.time;
		if (this.steams.length && this.steams[0].t <= now) this.steams = this.steams.filter((c) => c.t > now);
		if (this.banners.length) this.banners = this.banners.filter((b) => b.t > now);
		for (const h of alive) {
			h.bondMul = 1;
			for (const b of this.banners) if (dist2(h.x, h.y, b.x, b.y) < b.r * b.r) h.bannerT = now + 0.2;
		}
		if (alive.length < 2) return;
		for (const h of alive) {
			let n = 0, holders = 0;
			for (const o of alive) {
				if (o === h || dist2(o.x, o.y, h.x, h.y) > BOND_R * BOND_R) continue;
				n++;
				if (o.mods.bond > 0) holders++;
			}
			h.bondMul = 1 + h.mods.bond * Math.min(3, n) + BOND_ALLY * holders;
		}
	}

	hurtPlayer(h, dmg, from = 'other') {
		if (h.ward > 0) {
			this.wardAbsorb(h);
			return;
		}
		const guard = h.guard;
		h.guard = 0;
		const lost = Math.min(h.hp, Math.max(1, dmg * h.trait.dmgTaken - h.mods.armor - guard));
		h.hp -= lost;
		this.runLog?.hurt(this, h, lost, from);
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
			case 'millstones':
				this.millstoneHits(h, L);
				return;
			case 'moonblade':
				this.moonbladeHits(h, L);
				return;
			case 'ward':
			case 'bastion':
				this.wardTick(h, w, L, dt);
				return;
			case 'phalanx':
				this.wardTick(h, w, L, dt);
				w.a = (w.a ?? 0.5) - dt;
				if (w.a <= 0) w.a = this.phalanxWall(h, L) ? L.atkCd * cdMul : 0.2;
				return;
			case 'firewheel':
				this.firewheelTick(h, w, L, dt);
				return;
			case 'stormlight':
				this.stormlightTick(h, w, L, dt);
				return;
			case 'beacon':
				this.beaconTick(h, w, L, dt);
				return;
			case 'aurora':
			case 'blizzard':
				w.p = (w.p ?? L.pulse) - dt;
				if (w.p <= 0) {
					w.p = L.pulse * cdMul;
					this.auroraPulse(h, L, id === 'blizzard' ? 1 : 2);
				}
				break;
			case 'tocsin':
				w.p = (w.p ?? L.wave) - dt;
				if (w.p <= 0) {
					w.p = L.wave;
					this.tocsinWave(h, L);
				}
				break;
		}
		w.t -= dt;
		if (w.t > 0) return;
		const dmg = L.dmg * dmgMul;
		switch (id) {
			case 'bolt':
			case 'swarm': {
				const count = L.count + amount;
				const targets = this.nearestEnemies(h.x, h.y, count, BOLT_RANGE);
				if (!targets.length) {
					w.t = 0.1;
					return;
				}
				for (let i = 0; i < count; i++) {
					const t = targets[i % targets.length];
					const a = Math.atan2(t.y - h.y, t.x - h.x) + (i - (count - 1) / 2) * 0.25;
					this.addProjectile(h, 'bolt', a, L.speed, dmg, L.pierce, 2.5, t, 0, { src, split: L.split ?? 0 });
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
					const speed = L.speed * h.mods.speedMul; // Серп + Лёгкость
					this.addProjectile(h, 'sickle', a, speed, dmg, Infinity, (range / speed) * 2 + 1.5, null, range / speed);
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
			case 'aura':
			case 'tocsin': {
				const r = L.radius * areaMul;
				if (L.heal) {
					for (const o of this.heroes.values()) {
						if (o !== h && o.st === 0 && dist2(o.x, o.y, h.x, h.y) < r * r) o.hp = Math.min(o.maxHp, o.hp + L.heal * L.tick);
					}
				}
				const near = this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2);
				const chill = h.passives.has('frostcore'); // Ореол + Ледяное сердце
				for (const e of near) {
					const rr = r + e.r * 0.5;
					if (e.dead || dist2(e.x, e.y, h.x, h.y) >= rr * rr) continue;
					this.hurtEnemy(e, dmg, h, src);
					if (chill && !e.dead) this.slowEnemy(e, AURA_CHILL, L.tick + 0.2);
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
					if (L.freeze > 0 && !e.boss) this.freeze(e, L.freeze * h.mods.ctrlMul * durMul);
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
				const cross = id === 'bomb' && amount >= 2 ? amount : 0; // Петарда + Эхо
				const thrown = this.throwBombs(h, L.count + amount, L.fuse, lobKind, (x, y) => ({
					x, y, r: L.radius * areaMul, pdmg: 0, edmg: dmg, owner: h, src, burn: id === 'bomb' ? BOMB_BURN : null,
					kind: lobKind === 0 ? 0 : lobKind === 1 ? 6 : 4,
					then: lobKind === 1 ? (b) => this.firePool(h, b, L) : lobKind === 2 ? (b) => this.iceBurst(h, b, L) : null,
				}), cross);
				w.t = thrown ? L.cd * cdMul : 0.2;
				return;
			}
			case 'traps':
				this.layTrap(h, { r: L.radius * areaMul, dmg, root: L.root * h.mods.ctrlMul * durMul, splash: L.splash * areaMul, max: L.max, src }); // + Песочные часы
				w.t = L.cd * cdMul;
				return;
			case 'minefield':
				this.layTrap(h, { kind: 1, r: L.trigger * areaMul, dmg, blastR: L.radius * areaMul, kb: L.kb, recharge: L.recharge, max: L.max, src, burn: MINE_BURN });
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
			case 'aurora':
			case 'blizzard': {
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
					slow: h.trait.puddleSlow, heal: L.heal, wet: true, src,
				};
				this.puddles.push(z);
				this.fx.push(['zk', z.id, 2]);
				w.t = L.every;
				return;
			}
			case 'lightning':
			case 'tempest': {
				const cand = [];
				const R2 = LIGHTNING_RANGE * LIGHTNING_RANGE;
				for (const e of this.enemies) if (!e.dead && dist2(e.x, e.y, h.x, h.y) < R2) cand.push(e);
				if (!cand.length) {
					w.t = 0.2;
					return;
				}
				if (id === 'tempest') cand.sort((a, b) => dist2(a.x, a.y, h.x, h.y) - dist2(b.x, b.y, h.x, h.y)); // the first strike hits the nearest
				for (let s = 0; s < L.strikes + amount && cand.length; s++) {
					const idx = id === 'tempest' && s === 0 ? 0 : Math.floor(Math.random() * cand.length);
					let t = cand[idx];
					cand[idx] = cand[cand.length - 1];
					cand.pop();
					this.fx.push(['zap', Math.round(t.x), Math.round(t.y - 320), Math.round(t.x), Math.round(t.y)]);
					const hit = [t];
					this.hurtEnemy(t, dmg, h, src);
					if (!t.dead && h.mods.burnDps > 0) this.burn(t, h, h.mods.burnDps, LIGHTNING_EMBER_BURN); // Гроза + Уголёк
					// Tempest: a critical strike jumps further along the chain.
					const chain = L.chain + h.trait.chainBonus + (id === 'tempest' && this.lastCrit ? L.critChain : 0);
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
			case 'lantern':
				w.t = this.lanternTick(h, L, src) ? L.tick : 0.2;
				return;
			case 'trail':
			case 'firepath':
				w.t = this.trailTick(h, L, src) ? L.every : 0.05;
				return;
			case 'spear':
			case 'volley':
			case 'banner': {
				const t = this.toughest(h, SPEAR_RANGE);
				if (!t) {
					w.t = 0.2;
					return;
				}
				const a = Math.atan2(t.y - h.y, t.x - h.x);
				const n = (L.count ?? 1) + amount;
				const bond = h.mods.bond > 0;
				for (let i = 0; i < n; i++) {
					this.addProjectile(h, 'spear', a + (i - (n - 1) / 2) * 0.12, L.speed, dmg, L.pierce, SPEAR_RANGE / L.speed + 0.25, null, 0, {
						src, kb: L.kb, r: L.width / 2, bond,
						shed: id === 'volley' ? { every: L.every, acc: 0, dmg: L.knifeDmg * dmgMul, speed: 560, life: 0.45 } : null,
						onEnd: id === 'banner' && i === 0 ? (p) => this.plantBanner(h, p.x, p.y, L) : null,
					});
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'crescent':
				this.crescentStrike(h, L, src);
				w.t = L.cd * cdMul;
				return;
			case 'bladestorm': {
				const count = L.count + amount;
				w.rot = (w.rot ?? 0) + 0.45;
				const rot = w.rot;
				for (let k = 0; k < count; k++) {
					this.after(k * L.gap, () => {
						if (h.st !== 0 || !h.weapons.has('bladestorm')) return;
						this.addProjectile(h, 'knife', rot + (k * Math.PI * 2) / count, L.speed, dmg, L.pierce, 1.0, null, 0, { src });
					});
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'fireworks': {
				const thrown = this.throwBombs(h, L.count + amount, L.fuse, 3, (x, y) => ({
					x, y, r: L.radius * areaMul, pdmg: 0, edmg: dmg, owner: h, src, kind: 8, then: (b) => this.fireworkSparks(h, b, L),
				}));
				w.t = thrown ? L.cd * cdMul : 0.2;
				return;
			}
			case 'pitfall':
				this.layTrap(h, { kind: 4, r: L.radius * areaMul, dmg, blastR: L.blastR * areaMul, root: L.root * h.mods.ctrlMul, max: L.max, src });
				w.t = L.cd * cdMul;
				return;
			case 'flask':
			case 'quagmire': {
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
					const z = { id: this.nextId++, owner: h, x, y, r: L.radius * areaMul, life: L.duration * durMul, dmg, tick: L.tick, t: 0, slow: Math.max(h.trait.puddleSlow, L.slow ?? 0), wet: true, src };
					this.puddles.push(z);
					if (z.slow > 0) this.fx.push(['slowz', z.id]);
				}
				w.t = L.cd * cdMul;
				return;
			}
		}
	}

	// --- wave 3: evolutions, new weapons, embers ---

	evoCard(h, id) {
		const E = EVOS[id];
		return {
			id, kind: 'evo', name: E.name, icon: E.icon, desc: E.desc, level: 1, from: E.from, requires: E.requires,
			fromName: WEAPONS[E.from].name, fromIcon: WEAPONS[E.from].icon, reqName: PASSIVES[E.requires].name, reqIcon: PASSIVES[E.requires].icon,
		};
	}

	// Weapon at level 5 + its artifact (any level) → evolution; null if nothing is ready or it was declined recently.
	readyEvo(h) {
		for (const [id, w] of h.weapons) {
			const evo = EVO_BY_WEAPON[id];
			if (!evo || w.lvl < MAX_LEVEL || !h.passives.has(EVOS[evo].requires)) continue;
			if (h.duoDefer[evo] > h.offerNo) continue;
			return evo;
		}
		return null;
	}

	evolve(h, card) {
		const E = EVOS[card.id];
		if (!E || !h.weapons.has(E.from)) return false;
		const next = new Map();
		for (const [id, w] of h.weapons) next.set(id === E.from ? card.id : id, id === E.from ? { lvl: 1, t: 0.3 } : w);
		h.weapons = next;
		h.evolved.add(E.from);
		this.fx.push(['evo', h.pid, card.id]);
		this.runLog?.fused(this, h, 'evo', card.id);
		return true;
	}

	emberCards(h, n) {
		return Object.entries(EMBERS).slice(0, n).map(([id, E]) => ({ id, kind: 'ember', name: E.name, icon: E.icon, desc: E.desc, level: (h.embers[id] ?? 0) + 1 }));
	}

	// The toughest enemy within range: boss > elite > most hp.
	toughest(h, range) {
		let best = null, score = -1;
		for (const e of this.grid.query(h.x, h.y, range + MAX_ENEMY_R, this.q3)) {
			if (e.dead || dist2(e.x, e.y, h.x, h.y) > range * range) continue;
			const s = (e.boss ? 1e9 : 0) + (e.elite ? 1e8 : 0) + e.hp;
			if (s > score) {
				score = s;
				best = e;
			}
		}
		return best;
	}

	// Lantern: a cone of light on the densest group marks enemies (+damage from everyone).
	lanternTick(h, L, src) {
		return this.lightCone(h, L.range * h.mods.areaMul, L.angle, L.mark, L.tick + 0.3, L.dmg * h.mods.dmgMul, src) !== null;
	}

	trailTick(h, L, src) {
		if (this.time - h.movedT > MOVE_RECENT) return false;
		const z = {
			id: this.nextId++, owner: h, x: h.x, y: h.y, r: L.radius * h.mods.areaMul, life: L.dur * h.mods.durMul, dmg: L.dmg * h.mods.dmgMul,
			tick: L.tick, t: 0, src, burn: L.burn, trail: true,
		};
		this.puddles.push(z);
		this.fx.push(['zk', z.id, 1]);
		let mine = 0;
		for (const p of this.puddles) if (p.owner === h && p.trail) mine++;
		if (mine > (L.max ?? TRAIL_MAX)) this.puddles.splice(this.puddles.findIndex((p) => p.owner === h && p.trail), 1);
		return true;
	}

	// Ward / Bastion: charges refill one per cd; a full shield starts the run full.
	wardTick(h, w, L, dt) {
		h.wardMax = L.charges + h.mods.amount;
		if (!w.init) {
			w.init = true;
			h.ward = h.wardMax;
			w.t = L.cd * h.mods.cdMul;
		}
		if (h.ward >= h.wardMax) {
			w.t = L.cd * h.mods.cdMul;
			return;
		}
		w.t -= dt;
		if (w.t <= 0) {
			h.ward++;
			w.t = L.cd * h.mods.cdMul;
			this.fx.push(['ward', h.pid, h.ward]);
		}
	}

	// A charge eats the whole hit; Ward bursts when the last charge breaks, Bastion on every charge and shares one.
	wardAbsorb(h) {
		const id = h.weapons.has('bastion') ? 'bastion' : h.weapons.has('phalanx') ? 'phalanx' : 'ward';
		const w = h.weapons.get(id);
		const L = weaponDef(id).levels[(w?.lvl ?? 1) - 1];
		h.ward--;
		h.iframes = PLAYER_IFRAMES;
		this.fx.push(['ward', h.pid, h.ward]);
		if (w && h.ward < h.wardMax) w.t = Math.min(w.t, L.cd * h.mods.cdMul);
		if (id === 'phalanx') {
			this.spearRing(h, L);
			return;
		}
		if (id === 'bastion' || h.ward <= 0) {
			this.explode({ x: h.x, y: h.y, r: L.burstR * h.mods.areaMul, pdmg: 0, edmg: L.burstDmg * h.mods.dmgMul, owner: h, kind: 7, src: SRC[id], kb: L.kb });
		}
		if (id === 'bastion') {
			for (const o of this.heroes.values()) {
				if (o === h || o.st !== 0 || dist2(o.x, o.y, h.x, h.y) > L.share * L.share) continue;
				o.ward = Math.min(Math.max(o.wardMax, 1), o.ward + 1);
				this.fx.push(['ward', o.pid, o.ward]);
				break;
			}
		}
	}

	// Фаланга: a wall of parallel spears at the toughest enemy.
	phalanxWall(h, L) {
		const t = this.toughest(h, SPEAR_RANGE);
		if (!t) return false;
		const a = Math.atan2(t.y - h.y, t.x - h.x);
		const n = L.wall + h.mods.amount, nx = -Math.sin(a), ny = Math.cos(a);
		for (let i = 0; i < n; i++) {
			const off = (i - (n - 1) / 2) * 22;
			this.addProjectile(h, 'spear', a, L.speed, L.dmg * h.mods.dmgMul, L.pierce, SPEAR_RANGE / L.speed + 0.25, null, 0, {
				x: h.x + nx * off, y: h.y + ny * off, src: SRC.phalanx, kb: L.kb, r: L.width / 2, bond: h.mods.bond > 0,
			});
		}
		return true;
	}

	// A broken Phalanx charge bristles into a ring of spears.
	spearRing(h, L) {
		for (let i = 0; i < L.ring; i++) {
			const a = (i / L.ring) * Math.PI * 2;
			this.addProjectile(h, 'spear', a, L.speed, L.dmg * h.mods.dmgMul, L.pierce, 0.45, null, 0, { src: SRC.phalanx, kb: L.kb, r: L.width / 2 });
		}
	}

	// Огненное колесо: burning wheels on an orbit; each hit ignites, the ring leaves fire patches.
	firewheelTick(h, w, L, dt) {
		const { dmgMul, areaMul, amount, durMul } = h.mods;
		const count = L.count + amount, R = L.radius * areaMul, wr = ORBIT_BLADE_R * 1.3 * areaMul;
		const key = h.pid * 10 + 9;
		const xs = [], ys = [];
		for (let i = 0; i < count; i++) {
			const a = orbitAngle(this.time, L.rps, i, count);
			xs.push(h.x + Math.cos(a) * R);
			ys.push(h.y + Math.sin(a) * R);
		}
		for (const e of this.grid.query(h.x, h.y, R + wr + MAX_ENEMY_R, this.q2)) {
			if (e.dead || (e.oh && (e.oh[key] ?? 0) > this.time)) continue;
			const rr = (wr + e.r) ** 2;
			for (let i = 0; i < count; i++) {
				if (dist2(e.x, e.y, xs[i], ys[i]) >= rr) continue;
				(e.oh ??= {})[key] = this.time + L.hitCd;
				this.hurtEnemy(e, L.dmg * dmgMul, h, SRC.firewheel);
				if (!e.dead) this.burn(e, h, L.burn, 3);
				break;
			}
		}
		w.t -= dt;
		if (w.t > 0) return;
		w.t = L.every;
		w.k = ((w.k ?? 0) + 1) % count;
		const z = {
			id: this.nextId++, owner: h, x: xs[w.k], y: ys[w.k], r: L.patchR * areaMul, life: L.patchLife * durMul, dmg: L.patchDmg * dmgMul,
			tick: L.tick, t: 0, src: SRC.firewheel, trail: true,
		};
		this.puddles.push(z);
		this.fx.push(['zk', z.id, 1]);
		let mine = 0;
		for (const p of this.puddles) if (p.owner === h && p.trail) mine++;
		if (mine > TRAIL_MAX) this.puddles.splice(this.puddles.findIndex((p) => p.owner === h && p.trail), 1);
	}

	// Enemies inside a cone; marks them. Returns {dir, list} or null when no target.
	lightCone(h, range, angleDeg, mark, markDur, dmg, src) {
		const pt = this.densestPoints(h, 1, range)[0];
		if (!pt) return null;
		const dir = Math.atan2(pt.y - h.y, pt.x - h.x);
		const half = (angleDeg * Math.PI) / 360;
		const list = [];
		for (const e of this.grid.query(h.x, h.y, range + MAX_ENEMY_R, this.q2)) {
			if (e.dead) continue;
			const dx = e.x - h.x, dy = e.y - h.y;
			if (dx * dx + dy * dy > (range + e.r) ** 2) continue;
			let da = Math.abs(Math.atan2(dy, dx) - dir);
			if (da > Math.PI) da = Math.PI * 2 - da;
			if (da > half) continue;
			if (e.markT <= this.time || mark > e.markMul) e.markMul = mark;
			e.markT = this.time + markDur;
			list.push(e);
			this.hurtEnemy(e, dmg, h, src);
		}
		this.fx.push(['cone', h.pid, Math.round(dir * 100), Math.round(range), Math.round(angleDeg / 2)]);
		return { dir, list };
	}

	// Прожектор бури: the cone marks; lightning strikes a random enemy in it and chains only through marked ones.
	stormlightTick(h, w, L, dt) {
		const { dmgMul, areaMul, amount, cdMul } = h.mods;
		w.t -= dt;
		if (w.t <= 0) {
			const c = this.lightCone(h, L.range * areaMul, L.angle, L.mark, L.tick + 0.3, L.dmg * dmgMul, SRC.stormlight);
			w.t = c ? L.tick : 0.2;
			if (c) w.cone = c.list;
		}
		w.s = (w.s ?? L.strikeCd) - dt;
		if (w.s > 0) return;
		const cand = (w.cone ?? []).filter((e) => !e.dead);
		if (!cand.length) {
			w.s = 0.1;
			return;
		}
		w.s = L.strikeCd * cdMul;
		const chain = L.chain + h.trait.chainBonus;
		for (let k = 0; k < 1 + amount && cand.length; k++) {
			const i = Math.floor(Math.random() * cand.length);
			let t = cand[i];
			cand.splice(i, 1);
			const dmg = L.strikeDmg * dmgMul;
			this.fx.push(['zap', Math.round(t.x), Math.round(t.y - 320), Math.round(t.x), Math.round(t.y)]);
			const hit = [t];
			this.hurtEnemy(t, dmg, h, SRC.stormlight);
			for (let c = 0; c < chain; c++) {
				let next = null, bd = CHAIN_RANGE * CHAIN_RANGE;
				for (const e of this.grid.query(t.x, t.y, CHAIN_RANGE, this.q3)) {
					if (e.dead || hit.includes(e) || !(e.markT > this.time)) continue;
					const d = dist2(t.x, t.y, e.x, e.y);
					if (d < bd) {
						bd = d;
						next = e;
					}
				}
				if (!next) break;
				this.fx.push(['zap', Math.round(t.x), Math.round(t.y), Math.round(next.x), Math.round(next.y)]);
				hit.push(next);
				this.hurtEnemy(next, dmg, h, SRC.stormlight);
				t = next;
			}
		}
	}

	// Маяк: beams sweep around the hero; everyone under a beam is marked (×2 XP on death).
	beaconTick(h, w, L, dt) {
		w.t -= dt;
		if (w.t > 0) return;
		w.t = L.tick;
		const range = L.range * h.mods.areaMul, half = (L.half * Math.PI) / 180;
		const key = h.pid * 10 + 6;
		const dirs = [];
		for (let b = 0; b < L.beams; b++) dirs.push(beaconAngle(this.time, h.pid, L.rps) + (b * Math.PI * 2) / L.beams);
		for (const e of this.grid.query(h.x, h.y, range + MAX_ENEMY_R, this.q2)) {
			if (e.dead) continue;
			const dx = e.x - h.x, dy = e.y - h.y;
			if (dx * dx + dy * dy > (range + e.r) ** 2) continue;
			const ang = Math.atan2(dy, dx);
			let inBeam = false;
			for (const d of dirs) {
				let da = Math.abs(ang - d) % (Math.PI * 2);
				if (da > Math.PI) da = Math.PI * 2 - da;
				if (da <= half) inBeam = true;
			}
			if (!inBeam) continue;
			if (e.markT <= this.time || L.mark > e.markMul) e.markMul = L.mark;
			e.markT = this.time + L.markDur;
			e.beaconT = e.markT;
			if ((e.oh?.[key] ?? 0) > this.time) continue;
			(e.oh ??= {})[key] = this.time + 0.5;
			this.hurtEnemy(e, L.dmg * h.mods.dmgMul, h, SRC.beacon);
		}
	}

	// Огненная тропа: a burning enemy that dies sets its neighbours on fire.
	spreadFire(e) {
		const h = e.burnOwner, L = EVOS.firepath.levels[0];
		for (const o of this.grid.query(e.x, e.y, L.spread + MAX_ENEMY_R, [])) {
			if (o !== e && !o.dead && dist2(o.x, o.y, e.x, e.y) < L.spread * L.spread) this.burn(o, h, Math.max(L.burn, e.burnDps), 3);
		}
	}

	crescentStrike(h, L, src) {
		const r = L.radius * h.mods.areaMul;
		this.fx.push(['crescent', h.pid, Math.round(r)]);
		let kills = 0;
		for (const e of this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2)) {
			const rr = r + e.r * 0.5;
			if (e.dead || dist2(e.x, e.y, h.x, h.y) >= rr * rr) continue;
			this.hurtEnemy(e, L.dmg * h.mods.dmgMul, h, src);
			if (e.dead) kills++;
		}
		const heal = Math.min(kills * L.heal, L.healCap * L.cd * h.mods.cdMul);
		if (heal > 0) h.hp = Math.min(h.maxHp, h.hp + heal);
		this.breakAround(h.x, h.y, r, h);
	}

	// Two rings of hammers spinning in opposite directions.
	millstoneHits(h, L) {
		const { dmgMul, areaMul } = h.mods;
		const blade = ORBIT_BLADE_R * areaMul;
		const pts = [];
		for (const [R, dir] of [[L.radius * areaMul, 1], [L.radius2 * areaMul, -1]]) {
			for (let i = 0; i < L.count; i++) {
				const a = dir * orbitAngle(this.time, L.rps, i, L.count);
				pts.push(h.x + Math.cos(a) * R, h.y + Math.sin(a) * R);
			}
		}
		const key = h.pid * 10 + 7;
		for (const e of this.grid.query(h.x, h.y, L.radius2 * areaMul + blade + MAX_ENEMY_R, this.q2)) {
			if (e.dead || (e.oh && (e.oh[key] ?? 0) > this.time)) continue;
			const rr = (blade + e.r) ** 2;
			for (let i = 0; i < pts.length; i += 2) {
				if (dist2(e.x, e.y, pts[i], pts[i + 1]) >= rr) continue;
				(e.oh ??= {})[key] = this.time + L.hitCd;
				this.hurtEnemy(e, L.dmg * dmgMul, h, SRC.millstones);
				if (!e.dead && !e.boss) this.knock(e, h.x, h.y, L.kb);
				break;
			}
		}
	}

	// Four sickles circling on a wide ellipse around the hero.
	moonbladeHits(h, L) {
		const { dmgMul, areaMul } = h.mods;
		const key = h.pid * 10 + 8;
		for (let i = 0; i < L.count; i++) {
			const a = orbitAngle(this.time, L.rps, i, L.count);
			const x = h.x + Math.cos(a) * L.rx * areaMul, y = h.y + Math.sin(a) * L.ry * areaMul;
			if (this.tickNo % 3 === 0) this.breakAround(x, y, L.r, h);
			for (const e of this.grid.query(x, y, L.r + MAX_ENEMY_R, this.q2)) {
				if (e.dead || (e.oh && (e.oh[key] ?? 0) > this.time)) continue;
				if (dist2(e.x, e.y, x, y) >= (L.r + e.r) ** 2) continue;
				(e.oh ??= {})[key] = this.time + L.hitCd;
				this.hurtEnemy(e, L.dmg * dmgMul, h, SRC.moonblade);
			}
		}
	}

	tocsinWave(h, L) {
		const r = L.radius * h.mods.areaMul;
		this.fx.push(['bell', h.pid, Math.round(r)]);
		for (const e of this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2)) {
			if (!e.dead && !e.boss && dist2(e.x, e.y, h.x, h.y) < (r + e.r) ** 2) this.knock(e, h.x, h.y, L.kb);
		}
	}

	// Fireworks: after the blast, sparks fly out in a ring.
	fireworkSparks(h, b, L) {
		for (let i = 0; i < L.sparks; i++) {
			const a = (i / L.sparks) * Math.PI * 2;
			this.addProjectile(h, 'bolt', a, 420, b.edmg * L.sparkFrac, 1, 0.5, null, 0, { x: b.x, y: b.y, src: SRC.fireworks });
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

	// Control caps: an enemy that just thawed cannot be frozen again for FREEZE_IMMUNE seconds, and is knocked back
	// at most once per KNOCK_EVERY (elites at half strength), so no build turns into a permanent wall.
	freeze(e, dur) {
		if (e.frozenT > this.time) {
			e.frozenT = Math.max(e.frozenT, this.time + dur);
			return true;
		}
		if (e.thawT > this.time) return false;
		e.frozenT = this.time + dur;
		e.thawT = e.frozenT + FREEZE_IMMUNE;
		return true;
	}

	knock(e, fromX, fromY, dist) {
		if (e.knockT > this.time) return;
		e.knockT = this.time + KNOCK_EVERY;
		if (e.elite) dist *= 0.5;
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
	// `cross` extra bombs land in a cross around the first point instead of other groups.
	throwBombs(h, count, fuse, lobKind, blast, cross = 0) {
		const pts = this.densestPoints(h, count - cross, BOMB_RANGE);
		if (!pts.length) return false;
		for (let k = 0; k < cross; k++) {
			const step = CROSS_STEP * (1 + (k >> 2)), a = (k % 4) * Math.PI / 2;
			pts.push({ x: pts[0].x + Math.cos(a) * step, y: pts[0].y + Math.sin(a) * step });
		}
		for (const p of pts) {
			this.fx.push(['lob', this.nextId++, Math.round(h.x), Math.round(h.y), Math.round(p.x), Math.round(p.y), round3(fuse), round3(this.time), lobKind]);
			this.blasts.push({ ...blast(p.x, p.y), t: this.time + fuse });
		}
		return true;
	}

	firePool(h, b, L) {
		const z = {
			id: this.nextId++, owner: h, x: b.x, y: b.y, r: b.r * 0.9, life: L.pool * h.mods.durMul, dmg: L.poolDmg * h.mods.dmgMul,
			tick: L.tick, t: 0, slow: h.trait.puddleSlow, src: SRC.molotov, wet: true, burn: L.poolDmg * MOLOTOV_BURN, burnDur: 1.5,
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
			this.freeze(e, dur);
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

	auroraPulse(h, L, mul = 2) {
		const R = L.radius * h.mods.areaMul * mul;
		const dur = L.freeze * h.mods.ctrlMul * h.mods.durMul;
		for (const e of this.grid.query(h.x, h.y, R + MAX_ENEMY_R, this.q2)) {
			const rr = R + e.r * 0.5;
			if (!e.dead && !e.boss && dist2(e.x, e.y, h.x, h.y) < rr * rr) this.freeze(e, dur);
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
			blastR: o.blastR ?? 0, kb: o.kb ?? 0, recharge: o.recharge ?? 0, burn: o.burn ?? null, rearm: o.rearm ?? 0, life: o.life ?? Infinity, armT: this.time + TRAP_ARM,
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
					if (h.mods.armor > 0) h.guard = Math.min(3, h.guard + 1); // Хоровод + Кольчуга
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
			r: opts.r ?? PROJ_R, kb: opts.kb ?? 0, split: opts.split ?? 0, shed: opts.shed ?? null, bond: opts.bond ?? false, onEnd: opts.onEnd ?? null,
		};
		this.projectiles.push(p);
		// Projectiles often live shorter than a snapshot interval, so clients simulate them from events.
		const ev = ['shot', p.id, p.kind, Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy),
			round3(life), target ? target.id : -1, round3(this.time)];
		if (outT > 0) ev.push(h.pid, round3(outT));
		this.fx.push(ev);
	}

	// Swarm: a spark that hits breaks into smaller sparks seeking other enemies.
	splitSpark(p, e) {
		const exclude = [e];
		for (let i = 0; i < p.split; i++) {
			const t = this.nearestFrom(e, exclude, 260);
			if (t) exclude.push(t);
			const a = t ? Math.atan2(t.y - e.y, t.x - e.x) : Math.random() * Math.PI * 2;
			this.addProjectile(p.owner, 'bolt', a, p.speed, p.dmg * 0.5, 1, 1.0, t ?? null, 0, { x: e.x, y: e.y, src: p.src });
		}
	}

	iceTrail(p, dt) {
		const tr = p.trail;
		tr.acc += dt;
		if (tr.acc < tr.every) return;
		tr.acc = 0;
		// Not sent to clients: they draw the trail from the disc's own path.
		this.puddles.push({ id: this.nextId++, owner: p.owner, x: p.x, y: p.y, r: tr.r, life: tr.life, dmg: 0, tick: 1, t: 1, slow: tr.slow, hidden: true });
	}

	// Залп: the spear drops a pair of knives to both sides every `every` px of flight.
	shedKnives(p, dt) {
		const s = p.shed;
		s.acc += p.speed * dt;
		if (s.acc < s.every) return;
		s.acc -= s.every;
		const a = Math.atan2(p.vy, p.vx);
		for (const side of [1, -1]) {
			this.addProjectile(p.owner, 'knife', a + side * (Math.PI / 2 - 0.35), s.speed, s.dmg, 1, s.life, null, 0, { x: p.x, y: p.y, src: p.src });
		}
	}

	// Копьё + Узы: a spear that flies past an ally gets +30% damage.
	spearBond(p) {
		for (const o of this.heroes.values()) {
			if (o === p.owner || o.st !== 0 || dist2(o.x, o.y, p.x, p.y) > SPEAR_BOND_R * SPEAR_BOND_R) continue;
			p.bonded = true;
			p.dmg *= SPEAR_BOND_MUL;
			return;
		}
	}

	plantBanner(h, x, y, L) {
		const b = { owner: h, x, y, r: L.radius * h.mods.areaMul, t: this.time + L.life * h.mods.durMul };
		this.banners = this.banners.filter((o) => o.owner !== h);
		this.banners.push(b);
		this.fx.push(['banner', h.pid, Math.round(x), Math.round(y), round3(L.life * h.mods.durMul), Math.round(b.r)]);
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
				if (p.onEnd) p.onEnd(p);
				if (p.spike && !p.anyHit) this.layTrap(p.owner, { kind: 3, x: p.x, y: p.y, r: 14, dmg: p.spike.dmg, root: p.spike.root, life: p.spike.life, src: p.src });
				this.endProjectile(p);
				continue;
			}
			if (p.trail) this.iceTrail(p, dt);
			if (p.shed) this.shedKnives(p, dt);
			if (p.bond && !p.bonded) this.spearBond(p);
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
			this.breakAround(p.x, p.y, p.r, p.owner);
			this.grid.query(p.x, p.y, p.r + MAX_ENEMY_R, near);
			for (const e of near) {
				if (e.dead || p.hit.includes(e.id)) continue;
				const min = e.r + p.r;
				if (dist2(e.x, e.y, p.x, p.y) >= min * min) continue;
				p.hit.push(e.id);
				p.anyHit = true;
				this.hurtEnemy(e, p.dmg, p.owner, p.src);
				if (this.lastCrit && p.src === SRC.knives && !p.critPierced) { // Ножи + Острота
					p.critPierced = true;
					p.pierce++;
				}
				if (p.freezeBack > 0 && p.outT <= 0 && !e.dead && !e.boss) this.freeze(e, p.freezeBack);
				if (p.kb && !e.dead && !e.boss) this.knock(e, e.x - p.vx, e.y - p.vy, p.kb);
				if (p.split) this.splitSpark(p, e);
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
			if (t.kind === 4) {
				// Wolf pit: a blast that roots everyone around.
				this.explode({ x: t.x, y: t.y, r: t.blastR, pdmg: 0, edmg: t.dmg, owner: t.owner, kind: 5, src });
				for (const e of this.grid.query(t.x, t.y, t.blastR + MAX_ENEMY_R, near)) {
					if (!e.dead && dist2(e.x, e.y, t.x, t.y) < (t.blastR + e.r) ** 2) this.root(e, t.root);
				}
				continue;
			}
			if (t.kind === 1) {
				// Mine: blast and recharge instead of vanishing.
				this.explode({ x: t.x, y: t.y, r: t.blastR, pdmg: 0, edmg: t.dmg, owner: t.owner, kind: 5, src, kb: t.kb, burn: t.burn });
				t.armT = this.time + t.recharge;
				this.traps[j++] = t;
				continue;
			}
			this.fx.push(['snap', Math.round(t.x), Math.round(t.y)]);
			this.root(victim, t.root);
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
						if (z.wet) {
							e.wetT = this.time + WET_HOLD;
							e.wetZ = z;
						}
						this.hurtEnemy(e, z.dmg, z.owner, z.src ?? (z.heal ? SRC.censer : SRC.flask));
						if (z.burn && !e.dead) this.burn(e, z.owner, z.burn, z.burnDur ?? 2);
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
			const auraId = ['aura', 'aurora', 'tocsin'].find((id) => h.weapons.has(id)) ?? null;
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
		for (const o of this.heroes.values()) if (o !== h) this.addXp(o, xp * o.mods.xpMul);
	}

	addXp(h, xp) {
		h.xp += xp;
		let need = xpForNext(h.level, this.heroes.size);
		while (h.xp >= need) {
			h.xp -= need;
			h.level++;
			this.fx.push(['lvl', h.pid]);
			this.grantOffer(h);
			need = xpForNext(h.level, this.heroes.size);
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
				this.runLog?.up(this, h);
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
		const log = this.runLog?.build(this, win) ?? null;
		if (log) runStore.add(log);
		this.lastLog = log;
		this.overMsg = {
			t: 'over', win, time: Math.round(this.time * 10) / 10, host: this.host,
			stats: [...this.heroes.values()].map((h) => ({ pid: h.pid, name: h.name, hero: h.hero, kills: h.kills, dmg: Math.round(h.dmg), level: h.level })),
			runId: log?.id ?? null, log,
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
			Math.floor(h.xp), xpForNext(h.level, this.heroes.size), h.st, Math.round(h.rev), r2(h.fx), r2(h.fy),
			// Orbit gets a 3rd field with extra blades (Echo) so clients draw what the server hits with.
			[...h.weapons].map(([id, w]) => (id === 'orrery' ? [id, w.lvl, h.mods.amount, this.orreryMask(h, w)]
				: (id === 'orbit' || id === 'windmill' || id === 'firewheel') && h.mods.amount > 0 ? [id, w.lvl, h.mods.amount] : [id, w.lvl])),
			h.ward,
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
		let bossBar = null;
		if (boss) {
			// Group bar: a split twin shows both halves as one bar; [hp, maxHp, enemy type].
			let hp = 0, max = 0;
			for (const o of this.bosses) if (o.group === boss.group && !o.dead) { hp += o.hp; max += o.barMax ?? o.maxHp; }
			bossBar = [Math.ceil(hp), Math.round(max), boss.type];
		}
		const msg = {
			t: 's', tm: Math.round(this.time * 100) / 100, k: this.kills, p, e, b, g, z, tr, it, syn: Math.round(this.synergy * 100),
			fx: this.fx, boss: bossBar,
		};
		// Active peak: [index into PEAKS, seconds left, duration]; drives the client's eclipse mask, dawn tint and HUD.
		if (this.peak) msg.pk = [this.peak.i, Math.round((this.peak.at + this.peak.dur - this.time) * 10) / 10, this.peak.dur];
		this.fx = [];
		this.hitFx = 0;
		this.dieFx = 0;
		this.critFx = 0;
		this.sendSnapshot(msg);
		return msg;
	}

	// Everyone gets the same delta; keys go to all every KEY_EVERY snapshots and to clients that asked;
	// clients of an older protocol get the plain snapshot.
	sendSnapshot(msg) {
		this.snapCodec ??= new SnapshotEncoder(SNAP_STRIDE);
		this.needKey ??= new Set();
		const out = this.snapCodec.encode(msg);
		let delta = null, key = null, plain = null;
		for (const pid of this.members.keys()) {
			let json;
			if (isLegacy(pid)) json = plain ??= JSON.stringify(msg);
			else if (out.isKey || this.needKey.has(pid)) json = key ??= JSON.stringify(out.key());
			else json = delta ??= JSON.stringify(out.delta);
			this.needKey.delete(pid);
			this.send(pid, msg, json);
		}
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
		this.send(pid, { t: 'welcome', v: PROTO, pid, name: p.name, room: p.room?.code ?? null });
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
