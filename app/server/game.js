import {
	TICK_HZ, SNAPSHOT_HZ, MAX_PLAYERS, RUN_SECONDS, MAX_ENEMIES, MAX_GEMS, PLAYER_RADIUS,
	REVIVE_RADIUS, REVIVE_SECONDS, REVIVE_HP_FRACTION, PLAYER_IFRAMES, MAX_LEVEL,
	MAX_WEAPONS, MAX_PASSIVES, BOSS_TIMES, xpForNext, PLAYER_COLORS, HEROES, HERO_PERKS, WEAPONS, PASSIVES,
	BASE_MAGNET, GEM_PULL_SPEED, ENEMIES, ENEMY_TYPES, PROJECTILE_KINDS, WEAPON_IDS, PASSIVE_IDS,
	WAVES, enemyHpScale, spawnRateScale, SPAWN_DISTANCE, orbitAngle, heroTrait, enemyDmgScale, INVASION, invasionCount, ELITE_EVERY_LATE,
	passiveValue, baseMods, REROLLS_START, SKIP_XP, RARE_CHANCE, CHEST_RARE_CHANCE, HEAL_OFFER_HP, ST,
	ELITE_START, ELITE_EVERY, ELITE_HP_MUL, ELITE_R_MUL, ELITE_CHEST_CHANCE, ELITE_AFFIXES,
	GOLD_GEM_CHANCE, GOLD_GEM_MUL, GEM_SWEEP_EVERY, GEM_SWEEP_PLACE, gemTier, ITEMS, ITEM_TYPES, ITEM_LIFE,
	MAGNET_ITEM_EVERY, BREAK_TILE, BREAK_R, BREAK_DROPS, breakableAt, HOSTILE_R,
	DUOS, DUO_IDS, DUO_BY_PAIR, duoKey, MAX_DUOS, DUO_MIN_LEVEL, DUO_DEFER_OFFERS, duoStartLevel, weaponDef, weaponMaxLevel,
	SYNERGY_PER, SYNERGY_MAX, ROMAN, EVOS, EVO_IDS, EVO_BY_WEAPON, EMBERS,
	BOSS_SCHEDULE, BOSS_POOL, FINAL_BOSS, bossHpScale, REACT, REACTION_IDS, REACTIONS, reactionHint, SYNERGIES,
	beaconAngle, PEAK_WARN, peakSchedule, EMBER_WEAK, DEW_DROP, RARITIES, CHEST_FLOOR, rollRarity, passiveStep, passiveDesc,
	FINALE, finaleFight, finaleRingR, finaleHpMul, finaleDmgMul, finaleAddScale, finaleAddCap, clampToRing,
	MODES, DEFAULT_MODE, timeScale, bossTimes, modeHpMul, modeDmgMul, SPECIALS, specialCap, SHIELD_DIRS, SHIELD_SHIFT, ALTAR_DEALS,
	OVERCLOCKS, weaponLevel, attackLevel, overclockId, BANS_START, FORGE_MIN_LEVEL, forgeRecipe,
	AFFINITY, AFFINITY_IDS, AFFINITY_WINDOW, AFFINITY_EVERY, affinityOf,
	DUO_SIGNATURE_POWER, duoPartLevel, duoLineagePower,
} from '../public/shared/content.js';
import { OUTPOST, updateOutposts, guardKilled, openOutpostChest, closeOutposts, confineGuard as confineOutpostGuard, outpostSnapshot, boundGuardShot } from './outposts.js';
import { CARAVAN, updateCaravan, caravanGuardKilled, confineCaravanGuard, caravanSnapshot } from './caravans.js';
import { Events, STREAK_MUL, FOG_DEF } from './events.js';
import { castConfluence } from './confluences.js';
import { blockHeroHit, heroShieldReady, canRepeatCast, onWeaponHit, repeatCast, scoutKnife, stormMarked } from './hero-perks.js';
import { RunLog, runStore, enemyKey } from './runlog.js';
import { movingCircleImpact } from '../public/shared/combat-geometry.js';
import { newSupport, supportStats, healSupport, controlTick } from './support.js';
import { SnapshotEncoder, PROTO, isLegacy } from './snapshot-codec.js';
import { requestDash, stepMobility, mobilitySnapshot } from './mobility.js';
import { segmentDistance2 } from '../public/shared/mobility.js';

const SNAPSHOT_EVERY = Math.max(1, Math.round(TICK_HZ / SNAPSHOT_HZ));
function confineGuard(e) { confineOutpostGuard(e); confineCaravanGuard(e); }
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
const HEAL_AMOUNT = 40;
const REVIVE_IFRAMES = 1.5;
const STREAK_WINDOW = 10; // v23: seconds of the kill streak on the results card
const SLOW_HOLD = 0.1; // seconds a puddle slow lingers after the last check
const MAX_CRIT_FX = 12;
const WET_HOLD = 0.5;
const FREEZE_IMMUNE = 1.5;
const TRAIL_MAX = 24;
const SPEAR_RANGE = 500;
const KNOCK_EVERY = 1.0;
const BURN_TICK = 0.5;
const WEAPON_PAIR_HINTS = [
	{ a: 'tuning', b: 'whip', desc: 'Клинок снимает резонансную метку и даёт импульс по соседям' },
	{ a: 'anchor', b: 'flask', desc: 'Якорь стягивает врагов в лужу и продлевает её действие' },
];
const BUILD_FAMILIES = [
	new Set(['lightning', 'tempest', 'flask', 'quagmire', 'anchor', 'coil']),
	new Set(['bomb', 'trail', 'firepath', 'molotov', 'ember', 'ashseal', 'coil']),
	new Set(['ward', 'phalanx', 'bastion', 'mail', 'counterweight', 'anchor']),
	new Set(['prism', 'sickle', 'knives', 'spear', 'lens', 'crit']),
	new Set(['tuning', 'whip', 'orbit', 'frost', 'frostcore', 'hourglass']),
];
const SICKLE_CATCH = PLAYER_RADIUS + 10;
const TRAP_ARM = 0.25;
const TRAP_FAR2 = 1200 * 1200;
const TRAP_BEHIND = 30;
const MOVE_RECENT = 0.3;
const SPLASH_FRAC = 0.5;
const DENSE_R = 80;
const ORB_AIM_EVERY = 0.4;
const ORB_AIM_RANGE = 320;
const ORB_AIM_MIN = 24;
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
// v27 review: ticks of the «Петарда + Пепельная печать» zone count for the bomb but wake no hero perks.
const SRC_ASH_ZONE = { weapon: 'bomb', tags: ['fire', 'aoe'], perk: true };
// The bolt of a charged puddle (Кузня «Живая вода»): counts for the flask, wakes no perks.
const SRC_CHARGED = { weapon: 'flask', tags: ['shock'], perk: true };
const RING_FX_EVERY = 0.35; // seconds between trail rings of a sickle with the frost imprint
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
const SRC_STAR = { weapon: 'star', tags: ['aoe'], raw: true };
const SPECIAL_IDS = Object.keys(SPECIALS);
const SHIELD_COS = Math.cos((ENEMIES.shield.arc * Math.PI) / 180);
const WEAPON_SHORT = { count: 3, frac: 0.4 }; // v29: see makeChoices
const OVR_REGULAR_MAX = 2; // the overclock pair comes once fewer regular cards than this are left
const OVR_SPIKE = { frac: 0.25, root: 0.5, life: 4, max: 14 }; // spikes of the «Осколки» and «Шипы» overclocks
const FORGE_CARD = { id: 'forge', kind: 'rare', name: 'Кузня удачи', icon: '⚒', desc: 'Случайный предмет: +1 уровень с легендарным бонусом', level: 0 };
const fieldSource = (src) => (src?.weapon ?? 'other') + ':' + (src?.component ?? 'signature');
function trimOwned(list, owner, max, match) {
	let excess = list.filter(item => item.owner === owner && match(item)).length - max;
	if (excess <= 0) return;
	let kept = 0;
	for (const item of list) {
		if (excess > 0 && item.owner === owner && match(item)) { excess--; continue; }
		list[kept++] = item;
	}
	list.length = kept;
}
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
const sanitizeMode = (v) => (typeof v === 'string' && Object.hasOwn(MODES, v) ? v : null);
// Heroes a client says it has opened (trusted, see UNLOCKS); null = no list, everything allowed.
export const sanitizeUnlocked = (v) => {
	if (!Array.isArray(v)) return null;
	const set = new Set(v.slice(0, 32).map(sanitizeHero).filter(Boolean));
	return set.size ? set : null;
};
// Kills by knives or anything grown out of them count for the «Следопыт» unlock.
const KNIFE_SRC = new Set(['knives', EVO_BY_WEAPON.knives, ...DUO_IDS.filter((id) => DUOS[id].parts.includes('knives'))]);

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

function upgradeDesc(weaponId, toLevel, fromLevel = toLevel - 1) {
	const W = weaponDef(weaponId);
	const a = W.levels[fromLevel - 1], b = W.levels[toLevel - 1];
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
		perk: { readyAt: HERO_PERKS[member.hero]?.cooldown ?? 0, receivedBellAt: -Infinity },
		passives: new Map(),
		mods: baseMods(),
		kills: 0, dmg: 0, dmgBy: {}, supportDamage: 0, support: newSupport(), revives: 0, knifeKills: 0,
		offer: null, queue: 0, boostQueue: 0, floors: [], offerBoost: false, offerFloor: 0, pval: {}, rerolls: REROLLS_START, lastOfferNewW: false, combos: [],
		forgeUsed: false, forgeDefer: 0, buildChestDone: false, swapPending: false, swapUsed: false, fused: new Set(), duoDefer: {}, offerNo: 0, startWeapon: h.weapon, evolved: new Set(), embers: {}, ward: 0, wardMax: 0,
		guard: 0, blockCharge: 0, bondMul: 1, bannerT: 0, fireW: !!WEAPONS[h.weapon].tags?.includes('fire'),
		bans: BANS_START, banned: new Set(), spinQueue: 0, offerSpin: false,
		affN: Object.fromEntries(AFFINITY_IDS.map((id) => [id, 0])), affSeen: new Set(), // v24 affinity triggers
		// v23 results card: the strongest single hit [dmg, source, time], kill times of the last STREAK_WINDOW s, best streak [kills, time].
		bestHit: [0, null, 0], kq: [], kqi: 0, bestStreak: [0, 0],
		streakT: 0, altarDmgT: 0, altarCurseT: 0, altarXpT: 0, altarDeal: null, downT: 0, offline: false,
	};
}

export class Room {
	constructor(code, send) {
		this.code = code;
		this.send = send;
		this.mode = DEFAULT_MODE;
		this.runLength = RUN_SECONDS; // setMode() or a sim may change it before start(); peaks, bosses and waves follow it
		this.tscale = 1;
		this.xpMul = 1;
		this.modeHp = 1;
		this.paused = false; // solo pause from the menu
		this.frozen = false; // pause or a solo level-up offer: the tick stands still
		this.state = 'lobby';
		this.startsAt = null;
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

	// Night time: the clock of waves, pressure and elites (runs faster in shorter modes).
	get nt() {
		return this.time * this.tscale;
	}

	setMode(id) {
		const mode = sanitizeMode(id);
		if (!mode) return false;
		this.mode = mode;
		this.runLength = MODES[mode].seconds;
		return true;
	}

	addPlayer(pid, name, hero, unlocked = null, uid = null) {
		if (this.state !== 'lobby') return 'Игра уже идёт';
		if (this.members.size >= MAX_PLAYERS) return 'Комната заполнена';
		const usedColors = new Set([...this.members.values()].map((m) => m.color));
		const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0];
		let pick = sanitizeHero(hero) ?? 'knight';
		if (unlocked && !unlocked.has(pick)) pick = unlocked.has('knight') ? 'knight' : unlocked.values().next().value;
		this.members.set(pid, { pid, name, hero: pick, ready: false, color, unlocked, uid });
		if (this.host === null) this.host = pid;
		this.sendLobby();
		return null;
	}

	removePlayer(pid) {
		if (!this.members.delete(pid)) return;
		const had = this.heroes.size;
		this.heroes.delete(pid);
		if (this.host === pid) this.host = this.members.keys().next().value ?? null;
		if (this.members.size === 0) return;
		if (this.state === 'lobby') this.sendLobby();
		else if (this.state === 'play') {
			if (this.heroes.size && this.heroes.size < had) this.rescaleGroup(had, this.heroes.size);
			this.checkAllDown();
			this.updateFrozen();
		}
	}

	// v19: a player left mid-run — living enemies, bosses and the mode multipliers follow the new group size,
	// so the rest does not fight enemies sized for the old group.
	rescaleGroup(from, to) {
		const nt = this.nt;
		const own = MODES[this.mode].seconds === this.runLength;
		const hpOld = own ? modeHpMul(this.mode, from) : 1, hpNew = own ? modeHpMul(this.mode, to) : 1;
		const dmgOld = own ? modeDmgMul(this.mode, from) : 1, dmgNew = own ? modeDmgMul(this.mode, to) : 1;
		this.modeHp = hpNew;
		this.modeDmg = dmgNew;
		const hpK = (enemyHpScale(nt, to) / enemyHpScale(nt, from)) * (hpNew / hpOld);
		const bossK = (bossHpScale(nt, to) / bossHpScale(nt, from)) * (hpNew / hpOld);
		const dmgK = (enemyDmgScale(nt, to) / enemyDmgScale(nt, from)) * (dmgNew / dmgOld);
		const cohortNt = this.outposts?.creationNt ?? nt;
		const guardHpK = (enemyHpScale(cohortNt, to) / enemyHpScale(cohortNt, from)) * (hpNew / hpOld);
		const guardDmgK = (enemyDmgScale(cohortNt, to) / enemyDmgScale(cohortNt, from)) * (dmgNew / dmgOld);
		if (this.fin?.lord) this.finDmg = finaleDmgMul(to);
		for (const e of this.enemies) {
			if (e.dead) continue;
			// The finale Lord also follows his own per-group multiplier; the arena keeps its size.
			const k = e.outpost ? guardHpK : e.finLord ? bossK * (finaleHpMul(this.mode, to) / finaleHpMul(this.mode, from)) : e.boss ? bossK : hpK;
			e.hp *= k;
			e.maxHp *= k;
			if (e.barMax) e.barMax *= k;
			e.dmg *= e.outpost ? guardDmgK : dmgK;
			e.dmgMul *= e.outpost ? guardDmgK : dmgK;
		}
		this.runLog?.groupChange(this, from, to);
	}

	// v19: a dropped connection mid-run. The hero lies down at once (allies can lift it) instead of standing as a
	// free target; with nobody left online the run waits (solo too). The server keeps the hero for PLAY_GRACE.
	setOffline(pid, off) {
		const h = this.heroes.get(pid);
		if (!h || this.state !== 'play' || h.offline === off) return;
		h.offline = off;
		this.runLog?.offline(this, h, off);
		const online = [...this.heroes.values()].some((o) => !o.offline);
		if (off && online && h.st === 0) this.downHero(h, 'offline');
		this.updateFrozen();
	}

	downHero(h, from) {
		h.hp = 0;
		h.st = 1;
		h.rev = 0;
		h.downT = this.time;
		this.fx.push(['down', h.pid]);
		this.events.onDown(h);
		this.runLog?.down(this, h, from);
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
			t: 'lobby', code: this.code, host: this.host, mode: this.mode,
			startsAt: this.startsAt, serverNow: Date.now(),
			players: [...this.members.values()].map(({ pid, name, hero, ready, color }) => ({ pid, name, hero, ready, color })),
		};
	}

	sendLobby() {
		this.broadcast(this.lobbyMsg());
	}

	startMsg() {
		return {
			t: 'start', mode: this.mode, len: this.runLength, paused: this.frozen, menu: this.paused,
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
			if (h) {
				this.sendEmbers(h);
				this.sendPassives(h);
				if (h.lastReforge) this.send(pid, h.lastReforge);
			}
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
					if (m.unlocked && !m.unlocked.has(hero)) {
						this.send(pid, { t: 'err', msg: 'Этот герой ещё не открыт' });
						break;
					}
					m.hero = hero;
					this.sendLobby();
				}
				break;
			}
			case 'heroes':
				// A hero opened during the session (end of a run): the client resends its list.
				m.unlocked = sanitizeUnlocked(msg.heroes) ?? m.unlocked;
				break;
			case 'mode':
				if (this.state !== 'lobby') break;
				if (pid !== this.host) this.send(pid, { t: 'err', msg: 'Режим выбирает хост' });
				else if (this.setMode(msg.mode)) this.sendLobby();
				break;
			case 'pause':
				this.setPaused(msg.v === true);
				break;
			case 'quit':
				// Solo only: leave the run for the room lobby without results.
				if (this.state === 'play' && this.isSolo()) this.toLobby();
				break;
			case 'ready':
				if (this.state === 'lobby') {
					m.ready = msg.v === true;
					this.sendLobby();
				}
				break;
			case 'start':
				if (this.state !== 'lobby') break;
				if (pid !== this.host) this.send(pid, { t: 'err', msg: 'Начать игру может только хост' });
				else if (this.startsAt === null) this.start();
				break;
			case 'cancel-start':
				if (pid === this.host) this.cancelStart();
				break;
			case 'again':
				if (this.state !== 'over') break;
				if (pid !== this.host) this.send(pid, { t: 'err', msg: 'Перезапустить может только хост' });
				else this.toLobby();
				break;
			case 'pos':
				this.onPos(pid, msg);
				break;
			case 'dash':
				requestDash(this, pid, msg);
				break;
			case 'pick':
				this.onPick(pid, msg);
				break;
			case 'reroll':
				this.onReroll(pid, msg);
				break;
			case 'ban':
				this.onBan(pid, msg);
				break;
			case 'skip':
				this.onSkip(pid, msg);
				break;
			case 'kf':
				this.needKey?.add(pid);
				break;
		}
	}

	toLobby() {
		this.state = 'lobby';
		this.paused = false;
		this.frozen = false;
		this.heroes.clear();
		this.resetSim();
		for (const m of this.members.values()) m.ready = false;
		this.sendLobby();
	}

	resetSim() {
		this.time = 0;
		this.bossKills = 0;
		this.tscale = timeScale(this.runLength);
		this.xpMul = MODES[this.mode].seconds === this.runLength ? MODES[this.mode].xpMul : this.tscale;
		this.bossAt = bossTimes(this.runLength);
		this.modeHp = MODES[this.mode].seconds === this.runLength ? modeHpMul(this.mode, this.members.size) : 1;
		this.modeDmg = MODES[this.mode].seconds === this.runLength ? modeDmgMul(this.mode, this.members.size) : 1;
		this.paused = false;
		this.frozen = false;
		this.kills = 0;
		this.tickNo = 0;
		this.nextId = 1;
		this.enemies = [];
		this.projectiles = [];
		this.coldWaves = [];
		this.gems = [];
		this.puddles = [];
		this.bosses = [];
		this.bossIdx = 0;
		this.bossPlan = shuffle([...BOSS_POOL]);
		this.hostile = [];
		this.outposts = null;
		this.caravan = null;
		this.nextCaravanTry = 0;
		this.blasts = [];
		this.traps = [];
		this.items = [];
		this.broken = new Set();
		this.brokenList = [];
		this.nextEliteT = ELITE_START / this.tscale;
		this.nextInvasionT = INVASION.from / this.tscale;
		this.peaks = peakSchedule(this.runLength, this.bossAt);
		// v21 finale: plan (absolute times) or null for runs too short for it; this.fin lives from the prelude on.
		const fight = finaleFight(this.runLength);
		this.finPlan = fight ? { warn: this.runLength - fight - FINALE.prelude - FINALE.warn, pre: this.runLength - fight - FINALE.prelude, lord: this.runLength - fight, fight } : null;
		this.fin = null;
		this.finWarned = false;
		this.finDmg = 1;
		this.grade = 0;
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
		this.SRC_STAR = SRC_STAR;
		this.specialT = Object.fromEntries(SPECIAL_IDS.map((id) => [id, 0]));
		this.events = new Events(this);
	}

	cancelStart(startsAt = this.startsAt) {
		if (this.state !== 'lobby' || startsAt === null || this.startsAt !== startsAt) return false;
		this.startsAt = null;
		this.sendLobby();
		return true;
	}

	start() {
		this.startsAt = null;
		this.resetSim();
		this.state = 'play';
		this.heroes.clear();
		const list = [...this.members.values()];
		this.runUids = list.map((m) => m.uid).filter(Boolean);
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

	// --- solo pause: the menu (Esc / ⏸) and an open level-up offer both stop the tick ---

	isSolo() {
		return this.heroes.size === 1;
	}

	setPaused(on) {
		if (this.state !== 'play' || (on && !this.isSolo())) return;
		this.paused = on;
		this.updateFrozen();
	}

	updateFrozen() {
		const solo = this.isSolo();
		if (!solo) this.paused = false;
		const offer = solo && [...this.heroes.values()].some((h) => h.offer);
		const away = this.heroes.size > 0 && [...this.heroes.values()].every((h) => h.offline);
		const frozen = this.state === 'play' && (this.paused || offer || away);
		if (frozen === this.frozen) return;
		this.frozen = frozen;
		// The last tick's state goes out first so the client freezes on it.
		if (frozen && this.tickNo % SNAPSHOT_EVERY !== 0) this.snapshot();
		this.broadcast({ t: 'pause', on: frozen, menu: this.paused });
	}

	onPos(pid, msg) {
		if (this.state !== 'play' || this.frozen) return;
		const h = this.heroes.get(pid);
		if (!h || h.st !== 0) return;
		if (h.dash || (msg.epoch ?? 0) !== (h.moveEpoch ?? 0)) return;
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
			if (this.fin) [h.x, h.y] = clampToRing(h.x, h.y, this.fin.cx, this.fin.cy, this.fin.r - PLAYER_RADIUS);
			h.lastPosT = this.time;
			if (Number.isSafeInteger(msg.seq) && msg.seq > 0) h.posAck = msg.seq;
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

	// `boost` — extra chance for «Кузня удачи» (small chest); `floor` — lowest rarity of the best card (chests).
	// `spin` — a boss chest: the client reveals the cards one by one.
	grantOffer(h, boost = false, floor = 0, spin = false) {
		if (boost) h.boostQueue++;
		if (spin) h.spinQueue++;
		if (floor > 0) h.floors.push(floor);
		if (h.offer) {
			h.queue++;
			this.sendOffer(h);
		} else {
			h.offer = this.makeChoices(h);
			this.sendOffer(h);
		}
	}

	// Embers taken so far: the HUD shows the totals (v20).
	sendEmbers(h) {
		this.send(h.pid, { t: 'emb', e: { ...h.embers } });
	}

	sendPassives(h) {
		this.send(h.pid, { t: 'ps', levels: Object.fromEntries(h.passives), values: { ...h.pval } });
	}

	sendOffer(h) {
		const signature = JSON.stringify(h.offer);
		if (h.offer !== h.sentOffer || signature !== h.offerSignature) {
			h.offerEpoch = this.offerSequence = (this.offerSequence ?? 0) + 1;
			h.sentOffer = h.offer;
			h.offerSignature = signature;
		}
		const swap = h.offer?.[0]?.kind === 'swap';
		const closed = !h.offer?.length;
		this.send(h.pid, {
			t: 'lvl', choices: closed ? null : h.offer, closed: closed || undefined, offerEpoch: h.offerEpoch, pending: h.queue, rerolls: swap ? 0 : h.rerolls, bans: h.bans, spin: !swap && h.offerSpin ? 1 : undefined, skipXp: swap ? 0 : SKIP_XP,
			slots: [h.weapons.size, MAX_WEAPONS, h.passives.size, MAX_PASSIVES],
		});
	}

	// Untokened internal/legacy callers remain compatible until an asynchronous reward
	// replaces their offer. Browser actions always echo the epoch sent with `lvl`.
	acceptOfferAction(h, msg = {}) {
		if (!h) return false;
		const epoch = msg.offerEpoch;
		if (h.offer && ((epoch === undefined && !h.offerEpochRequired)
			|| (Number.isSafeInteger(epoch) && epoch === h.offerEpoch))) {
			if (epoch !== undefined) h.offerEpochRequired = true;
			return true;
		}
		// Game.pick updates passives optimistically. A stale pick must restore the
		// authoritative inventory as well as reopening the current card array.
		this.sendPassives(h);
		this.sendOffer(h);
		return false;
	}

	// Weighted offer (G4): slot 1 — upgrade of something owned, slot 2 — 50/50 upgrade or new, slot 3 — anything.
	// A new weapon is offered in at most every other offer; low hp turns slot 3 into healing.
	// A reroll keeps the chest boost and rarity floor of the offer it replaces.
	makeChoices(h, reroll = false) {
		// The altar swap is built for a fresh offer only: a reroll keeps rerolling the regular cards.
		if (h.swapPending && !reroll) {
			const swap = this.swapCards(h);
			if (swap.length) return swap;
			h.swapPending = false;
		}
		if (!reroll) {
			h.offerBoost = h.boostQueue > 0;
			if (h.offerBoost) h.boostQueue--;
			h.offerFloor = h.floors.shift() ?? 0;
			h.offerSpin = h.spinQueue > 0;
			if (h.offerSpin) h.spinQueue--;
		} else h.offerSpin = false;
		const boost = h.offerBoost;
		h.offerNo++;
		this.updateCombos(h);
		const ups = [], newW = [], newP = [];
		for (const id of [...WEAPON_IDS, ...DUO_IDS, ...EVO_IDS]) {
			const w = h.weapons.get(id);
			const W = weaponDef(id);
			if (h.banned.has('weapon:' + id)) continue;
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
			if ((P.coop && this.heroes.size < 2) || h.banned.has('passive:' + id)) continue;
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
		// A single weapon is a trap: new weapons are offered every time and marked as recommended.
		const lonely = h.weapons.size < 2;
		// v29: fewer than WEAPON_SHORT.count weapons by WEAPON_SHORT.frac of the run (live logs: two weapons and all picks in
		// artifacts by 5:00) — new weapons every offer, ahead of new artifacts, marked as recommended.
		const short = !lonely && h.weapons.size < WEAPON_SHORT.count && this.time >= WEAPON_SHORT.frac * this.runLength && newW.length > 0;
		const allowNewW = lonely || short || !h.lastOfferNewW;
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
		const available = [...newW, ...newP];
		const compatible = shuffle(available.filter((c) => this.fitsBuild(h, c)));
		const fresh = () => short ? [...shuffle([...newW]), ...shuffle([...newP])]
			: Math.random() < 0.55 ? [...compatible, ...shuffle(available)] : shuffle(available);
		// A ready duo goes to slot 1 (unless the player declined it recently).
		// An evolution or a ready duo goes to slot 1 (unless the player declined it recently).
		const forge = this.forgeCards(h);
		const evo = this.readyEvo(h);
		const ready = h.combos.find((c) => c.ready && !(h.duoDefer[c.id] > h.offerNo));
		// v20: a weapon ready for an overclock brings both variants as two cards (unless declined recently) — once the build
		// is nearly done: while two or more regular cards (upgrades or new picks) are available, the overclock waits.
		// An overclock replaces embers, it does not compete with upgrades (with it mid-run the human bot fell 43% → 27%).
		const regular = ups.length + (h.weapons.size < MAX_WEAPONS ? newW.length : 0) + newP.length;
		const ovr = forge.length || evo || ready || regular >= OVR_REGULAR_MAX ? null : this.readyOvr(h);
		const alternate = !short && h.offerFloor > 0 && !h.buildChestDone && compatible.length
			? shuffle(available.filter((c) => !this.fitsBuild(h, c) && c.kind === 'passive')) : [];
		if (!forge.length && !evo && !ready && alternate.length && compatible.some((c) => c.kind === 'passive' || allowNewW)) {
			take(compatible);
			take(alternate);
			out[0].draft = 'fit';
			out[1].draft = 'pivot';
		} else if (forge.length) out.push(...forge);
		else if (evo) out.push(this.evoCard(h, evo));
		else if (ready) out.push(this.duoCard(h, ready));
		else if (ovr) out.push(...this.ovrCards(h, ovr));
		else if (!take(ups)) take(fresh());
		if (out.length < 2) {
			if (short) {
				if (!take(fresh())) take(ups); // v29: short of weapons — slot 2 is a new pick, a new weapon first
			} else if (Math.random() < 0.5) {
				if (!take(ups)) take(fresh());
			} else if (!take(fresh())) take(ups);
		}
		if (short && !newWTaken) take(newW); // v29: and a new weapon somewhere in every offer
		take(shuffle([...ups, ...newW, ...newP]));
		h.lastOfferNewW = newWTaken;
		// Nothing left to upgrade: a free weapon slot beats embers, the new-weapon pacing rules give way.
		for (const c of shuffle([...newW, ...newP])) {
			if (out.length >= 3) break;
			if (used.has(c.kind + c.id)) continue;
			used.add(c.kind + c.id);
			out.push(c);
		}
		const heal = { id: 'heal', kind: 'heal', name: 'Лечение', icon: '✚', desc: `+${HEAL_AMOUNT} здоровья`, level: 0 };
		// Not enough to upgrade: overclocks fill the offer, the recently declined ones too.
		if (out.length < 3 && !ovr) {
			for (const id of this.ovrList(h, true)) {
				const cards = this.ovrCards(h, id);
				if (out.length + cards.length > 3) continue;
				out.unshift(...cards);
			}
		}
		// v20: embers are the fallback — only when there is nothing left to upgrade or overclock.
		if (!out.length) out.push(...this.emberCards(h, 3));
		for (const c of out) {
			if ((lonely || short) && c.kind === 'weapon' && !h.weapons.has(c.id)) c.rec = lonely ? 1 : 2; // 2: «мало оружия» (v29)
			this.duoHint(h, c);
			this.waveHints(h, c);
		}
		const slot3 = Math.min(2, out.length);
		if (h.st === 0 && h.hp < h.maxHp * HEAL_OFFER_HP) {
			out[slot3] = { ...heal, desc: `+${HEAL_AMOUNT} здоровья (здоровья меньше ${Math.round(HEAL_OFFER_HP * 100)}%)` };
		} else {
			const rare = (boost ? CHEST_RARE_CHANCE : RARE_CHANCE) * (1 + h.mods.luck);
			if (Math.random() < rare && this.reforgePool(h).length) out[slot3] = { ...FORGE_CARD };
		}
		this.rollRarities(h, out, h.offerFloor);
		return out;
	}

	// Every plain weapon or artifact card rolls a rarity; a chest floor lifts one of them if none reached it.
	rollRarities(h, out, floor = 0) {
		const fortune = h.mods.fortune + h.mods.luck;
		const cards = out.filter((c) => (c.kind === 'weapon' && WEAPONS[c.id]) || (c.kind === 'passive' && !PASSIVES[c.id].noRarity));
		for (const c of cards) this.setRarity(h, c, rollRarity(fortune));
		if (floor > 0 && cards.length && !cards.some((c) => c.rar >= floor)) {
			this.setRarity(h, cards[Math.floor(Math.random() * cards.length)], rollRarity(fortune, floor));
		}
	}

	// Final numbers of a card at rarity `rar`: weapons +levels (and rerolls), artifacts a scaled step.
	setRarity(h, c, rar) {
		const R = RARITIES[rar];
		c.rar = rar;
		if (c.kind === 'weapon') {
			const from = h.weapons.get(c.id)?.lvl ?? 0;
			c.from = from;
			c.add = Math.max(1, Math.min(weaponMaxLevel(c.id) - from, R.levels));
			c.level = from + c.add;
			c.desc = from ? upgradeDesc(c.id, c.level, from) : WEAPONS[c.id].desc;
			if (R.rerolls) c.rerolls = R.rerolls;
			else delete c.rerolls;
		} else {
			c.val = passiveStep(c.id, rar);
			c.desc = passiveDesc(c.id, c.val);
		}
	}

	// One entry per owned item: slots and item kinds do not bias the random choice.
	reforgePool(h) {
		return [...[...h.weapons].filter(([id, w]) => w.lvl < weaponMaxLevel(id)).map(([id]) => ({ id, kind: 'weapon' })),
			...[...h.passives].filter(([id, lvl]) => lvl < MAX_LEVEL && !PASSIVES[id].noRarity).map(([id]) => ({ id, kind: 'passive' }))];
	}

	legendaryReforge(h, source = 'forge') {
		const pool = this.reforgePool(h);
		const item = pool[Math.floor(Math.random() * pool.length)];
		if (!item) {
			h.lastReforge = { t: 'reforge', source, result: null };
			this.send(h.pid, h.lastReforge);
			return null;
		}
		const { id, kind } = item;
		const from = kind === 'weapon' ? h.weapons.get(id).lvl : h.passives.get(id);
		const def = kind === 'weapon' ? weaponDef(id) : PASSIVES[id];
		const result = { id, kind, name: def.name, from, to: from + 1, rar: 3 };
		if (kind === 'weapon') {
			h.weapons.get(id).lvl++;
			h.rerolls++;
			result.bonus = '+1 переброс';
			this.updateCombos(h);
		} else {
			const val = passiveStep(id, 3);
			h.pval[id] = (h.pval[id] ?? passiveValue(id, from)) + val;
			h.passives.set(id, from + 1);
			const before = h.maxHp;
			this.recalcMods(h);
			if (h.st === 0) h.hp += Math.max(0, h.maxHp - before);
			result.val = val;
			result.bonus = passiveDesc(id, val);
			this.sendPassives(h);
		}
		h.lastReforge = { t: 'reforge', source, result };
		this.send(h.pid, h.lastReforge);
		this.runLog?.reforged(this, h, source, result);
		// A reward can arrive while a card is open: rebase it, or replace a now-maxed card.
		if (source !== 'forge' && kind === 'weapon' && h.offer?.some(c => c.kind === 'duo' && c.parts?.includes(id))) {
			// Replace the array even if the tier stays the same: inherited part levels changed.
			h.offerEpochRequired = true;
			h.offer = h.offer.filter(c => !(c.kind === kind && c.id === id && result.to === weaponMaxLevel(id))
				&& !(c.kind === 'rare' && c.id === 'forge' && !this.reforgePool(h).length)).map(c => {
				if (c.kind === 'duo' && c.parts?.includes(id)) {
					const current = this.currentDuoCard(h, c);
					if (current) return { ...c, ...current };
				}
				if (c.kind === kind && c.id === id) {
					const rebased = { ...c, level: result.to + 1 };
					if (c.rar !== undefined) this.setRarity(h, rebased, c.rar);
					else rebased.desc = upgradeDesc(id, rebased.level);
					return rebased;
				}
				return c;
			});
		} else if (source !== 'forge' && h.offer && (h.offer.some(c => c.kind === kind && c.id === id)
			|| (h.offer.some(c => c.kind === 'rare' && c.id === 'forge') && !this.reforgePool(h).length))) {
			h.offerEpochRequired = true;
			if (result.to === (kind === 'weapon' ? weaponMaxLevel(id) : MAX_LEVEL)) h.offer = this.makeChoices(h, true);
			else for (const c of h.offer) if (c.kind === kind && c.id === id) {
				c.level = result.to + 1;
				if (c.rar !== undefined) this.setRarity(h, c, c.rar);
				else if (kind === 'weapon') c.desc = upgradeDesc(id, c.level);
			}
		}
		if (source !== 'forge' && h.offer) this.sendOffer(h);
		return result;
	}

	fitsBuild(h, card) {
		const ids = [...h.weapons.keys(), ...h.passives.keys()];
		if (BUILD_FAMILIES.some((family) => family.has(card.id) && ids.some((id) => family.has(id)))) return true;
		if (card.kind !== 'weapon') return false;
		return !!reactionHint(card.id, [...h.weapons.keys()]) || [...h.weapons.keys()].some((id) =>
			!h.weapons.get(id).imprint && (forgeRecipe(card.id, id) || DUO_BY_PAIR[duoKey(card.id, id)]));
	}

	offerAltarSwap(h) {
		if (h.swapUsed || h.swapPending || !this.swapCards(h).length) return;
		h.swapPending = true;
		this.grantOffer(h);
	}

	swapCards(h) {
		if (h.passives.size < MAX_PASSIVES) return [];
		const replace = [...h.passives].map(([id, level]) => ({ id, name: PASSIVES[id].name, level }));
		const available = shuffle(PASSIVE_IDS.filter((id) => !h.passives.has(id) && !h.banned.has('passive:' + id)
			&& (!PASSIVES[id].coop || this.heroes.size > 1)));
		available.sort((a, b) => Number(this.fitsBuild(h, { id: b })) - Number(this.fitsBuild(h, { id: a })));
		return available.slice(0, 3).map((id) => ({
			id, kind: 'swap', level: 1, replace,
			name: PASSIVES[id].name, icon: PASSIVES[id].icon, desc: PASSIVES[id].desc,
		}));
	}

	forgeCards(h) {
		if (h.forgeUsed || h.offerNo < h.forgeDefer) return [];
		const ready = [...h.weapons].filter(([id, w]) => WEAPONS[id] && w.lvl >= FORGE_MIN_LEVEL);
		for (const [a] of ready) {
			const pair = ready.find(([b]) => b !== a && forgeRecipe(a, b));
			if (!pair) continue;
			const [b] = pair;
			return [[a, b], [b, a]].map(([carrier, donor]) => ({
				id: carrier, donor, kind: 'imprint', level: h.weapons.get(carrier).lvl,
				icon: WEAPONS[carrier].icon, carrierName: WEAPONS[carrier].name, donorName: WEAPONS[donor].name,
				...forgeRecipe(carrier, donor),
			}));
		}
		return [];
	}

	imprint(h, { id, donor }) {
		const carrier = h.weapons.get(id), part = h.weapons.get(donor);
		if (h.forgeUsed || !forgeRecipe(id, donor) || !carrier || !part
			|| carrier.lvl < FORGE_MIN_LEVEL || part.lvl < FORGE_MIN_LEVEL) return false;
		carrier.imprint = donor;
		h.weapons.delete(donor);
		h.fused.add(donor);
		h.forgeUsed = true;
		this.fx.push(['lvl', h.pid]);
		return true;
	}

	duoCard(h, c) {
		const D = DUOS[c.id];
		const level = duoStartLevel(h.weapons.get(c.a).lvl + h.weapons.get(c.b).lvl);
		return {
			id: c.id, kind: 'duo', name: D.name, icon: D.icon, desc: D.desc, level, parts: [c.a, c.b],
			partNames: [WEAPONS[c.a].name, WEAPONS[c.b].name], partIcons: [WEAPONS[c.a].icon, WEAPONS[c.b].icon],
			loseOvr: this.ovrNames(h, [c.a, c.b]),
		};
	}

	currentDuoCard(h, card) {
		if (!DUOS[card.id] || !Array.isArray(card.parts) || card.parts.length !== 2 || h.weapons.has(card.id) || this.duoCount(h) >= MAX_DUOS) return null;
		const [a, b] = card.parts, first = h.weapons.get(a), second = h.weapons.get(b);
		if (DUO_BY_PAIR[duoKey(a, b)] !== card.id || !first || !second || first.imprint || second.imprint
			|| first.lvl < DUO_MIN_LEVEL || second.lvl < DUO_MIN_LEVEL) return null;
		return this.duoCard(h, { id: card.id, a, b });
	}

	// «🔗 с Грозой → Громовой разрез (нужно 3 + 3)» on weapon cards that pair with something already owned.
	// v24: every owned partner (`duoHints`, the highest level first, at most two; `duoHint` = the first one for old clients)
	// and, when this weapon pairs with nothing owned, the affinity with the first owned plain weapon (`affHint`).
	duoHint(h, c) {
		if (c.kind !== 'weapon' || !WEAPONS[c.id] || h.weapons.get(c.id)?.imprint) return;
		if (!h.forgeUsed) {
			const donor = [...h.weapons.keys()].find((id) => id !== c.id && forgeRecipe(c.id, id));
			if (donor) c.forgeHint = { withName: WEAPONS[donor].name, need: FORGE_MIN_LEVEL };
		}
		// A weapon carrying an imprint (Кузня) joins no duo, but keeps its affinities: it still attacks on its own.
		if (this.duoCount(h) < MAX_DUOS) {
			const list = [];
			for (const [id, w] of h.weapons) {
				if (w.imprint || id === c.id || !WEAPONS[id]) continue;
				const duo = DUO_BY_PAIR[duoKey(c.id, id)];
				if (duo) list.push({ with: id, withName: WEAPONS[id].name, id: duo, name: DUOS[duo].name, need: DUO_MIN_LEVEL, lvl: w.lvl });
			}
			list.sort((a, b) => b.lvl - a.lvl);
			if (list.length) {
				c.duoHints = list.slice(0, 2);
				c.duoHint = c.duoHints[0];
				return;
			}
		}
		for (const [id, w] of h.weapons) {
			const a = affinityOf(c.id, id);
			if (a) {
				c.affHint = { id: a, with: id, withName: WEAPONS[id].name, name: AFFINITY[a].name, desc: AFFINITY[a].desc };
				return;
			}
		}
	}

	// «💥 реакция «Проводник» с «Зелье» (союзник)» on new weapons; «✦ …» for weapon + artifact synergies.
	waveHints(h, c) {
		if (c.kind === 'weapon' && c.level === 1 && WEAPONS[c.id]) {
			for (const { a, b, desc } of WEAPON_PAIR_HINTS) {
				const partner = c.id === a ? b : c.id === b ? a : null;
				if (!partner) continue;
				const mine = h.weapons.has(partner);
				if (mine || [...this.heroes.values()].some((o) => o !== h && o.weapons.has(partner))) {
					c.pairHint = { withName: WEAPONS[partner].name, ally: !mine, desc };
					break;
				}
			}
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

	// --- v20: overclocks and banishing ---

	// Names of the overclocks that a duo or an evolution of these weapons would drop (shown on the card), or undefined.
	ovrNames(h, ids) {
		const out = ids.map((id) => OVERCLOCKS[id]?.[(h.weapons.get(id)?.oc ?? 0) - 1]?.name).filter(Boolean);
		return out.length ? out : undefined;
	}

	// Weapons that may be overclocked now: plain, level 5, no overclock yet, a variant left in the pool.
	// A weapon whose duo partner is owned (and a duo slot is left) waits for the duo. A weapon whose evolution is still within reach waits: the artifact is owned (the evolution card comes by itself,
	// unless it was declined) or can still be taken into a free slot. `all` ignores a recent refusal.
	ovrList(h, all = false) {
		const out = [];
		const duoOpen = this.duoCount(h) < MAX_DUOS;
		for (const [id, w] of h.weapons) {
			if (!OVERCLOCKS[id] || w.oc || w.lvl < MAX_LEVEL) continue;
			if (!OVERCLOCKS[id].some((_, k) => !h.banned.has(`ovr:${id}:${k + 1}`))) continue;
			if (!all && h.duoDefer['ovr:' + id] > h.offerNo) continue;
			// v24: a duo partner of level ≥ DUO_MIN_LEVEL is owned: the duo is at hand (it would drop the overclock), wait for it.
			// With 4 partners per weapon a merely owned partner would starve overclocks. Imprints (Кузня) take no part.
			if (!w.imprint && duoOpen && [...h.weapons].some(([o, part]) => o !== id && !part.imprint && WEAPONS[o] && part.lvl >= DUO_MIN_LEVEL && DUO_BY_PAIR[duoKey(id, o)])) continue;
			const evo = !w.imprint && EVO_BY_WEAPON[id];
			if (evo) {
				const req = EVOS[evo].requires;
				if (h.passives.has(req)) {
					if (!(h.duoDefer[evo] > h.offerNo)) continue;
				} else if (h.passives.size < MAX_PASSIVES && !h.banned.has('passive:' + req) && !(PASSIVES[req].coop && this.heroes.size < 2)) continue;
			}
			out.push(id);
		}
		return out;
	}

	readyOvr(h) {
		return this.ovrList(h)[0] ?? null;
	}

	ovrCards(h, id) {
		const W = WEAPONS[id];
		return OVERCLOCKS[id].map((O, k) => ({ id, kind: 'ovr', v: k + 1, name: O.name, icon: W.icon, desc: O.desc, level: 0, wName: W.name }))
			.filter((c) => !h.banned.has(`ovr:${id}:${c.v}`));
	}

	// «Изгнать»: the card leaves the pool for the rest of the run, the offer is rebuilt for free.
	// Duos, evolutions, healing, embers and «Кузня удачи» cannot be banished.
	onBan(pid, msg) {
		if (this.state !== 'play') return;
		const h = this.heroes.get(pid);
		const i = num(msg.i);
		if (!this.acceptOfferAction(h, msg) || h.bans <= 0 || i === null || !Number.isInteger(i) || i < 0 || i >= h.offer.length) return;
		const c = h.offer[i];
		if (c.kind !== 'weapon' && c.kind !== 'passive' && c.kind !== 'ovr') return;
		if (c.kind === 'weapon' && !WEAPONS[c.id]) return;
		this.runLog?.choice(this, h, 'ban', c, h.offer);
		h.banned.add(c.kind === 'ovr' ? `ovr:${c.id}:${c.v}` : `${c.kind}:${c.id}`);
		h.bans--;
		h.offer = this.makeChoices(h, true); // like a reroll: the new cards show at once, no chest reveal
		this.sendOffer(h);
	}

	overclock(h, c) {
		const w = h.weapons.get(c.id);
		if (!w || w.oc || w.lvl < MAX_LEVEL || !OVERCLOCKS[c.id]?.[c.v - 1]) return false;
		w.oc = c.v;
		w.t = Math.min(w.t, 0.3);
		if (c.id === 'ward') h.ward = Math.min(h.ward, weaponLevel('ward', w.lvl, w.oc).charges + h.mods.amount);
		this.fx.push(['ovr', h.pid, c.id, c.v]);
		return true;
	}

	duoCount(h) {
		let n = 0;
		for (const id of h.weapons.keys()) if (DUOS[id]) n++;
		return n;
	}

	// The two parts leave, the duo takes the first part's slot (Map order is the HUD order).
	fuseDuo(h, card) {
		const current = this.currentDuoCard(h, card);
		if (!current || current.level !== card.level) return false;
		const [a, b] = card.parts;
		const next = new Map();
		for (const [id, w] of h.weapons) {
			if (id === a) next.set(card.id, { lvl: card.level, t: 0.3,
				parts: [a, b].map((part) => ({ id: part, lvl: h.weapons.get(part).lvl, t: 0.3 })) });
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
		if (!this.acceptOfferAction(h, msg) || i === null || !Number.isInteger(i) || i < 0 || i >= h.offer.length) return;
		const c = h.offer[i];
		if (c.kind === 'duo') {
			const current = this.currentDuoCard(h, c);
			if (!current || current.level !== c.level) {
				if (current) {
					h.offer = h.offer.map(card => card === c ? { ...card, ...current } : card);
					h.offerEpochRequired = true;
				}
				this.sendPassives(h);
				this.sendOffer(h);
				return;
			}
		}
		if (c.kind === 'rare' && c.id === 'forge' && !this.reforgePool(h).length) {
			h.offerEpochRequired = true;
			h.offer = this.makeChoices(h, true);
			this.sendPassives(h);
			this.sendOffer(h);
			return;
		}
		if (c.kind === 'imprint' && !this.imprint(h, c)) return;
		if (c.kind === 'swap') {
			if (h.swapUsed || !h.swapPending || !c.replace.some(({ id }) => id === msg.drop)
				|| !h.passives.has(msg.drop) || h.passives.has(c.id)) return;
			h.passives.delete(msg.drop);
			delete h.pval[msg.drop];
			h.passives.set(c.id, 1);
			h.swapPending = false;
			h.swapUsed = true;
			const before = h.maxHp;
			this.recalcMods(h);
			if (h.st === 0) h.hp = Math.min(h.maxHp, h.hp + Math.max(0, h.maxHp - before)); // not a downed hero
			this.sendPassives(h);
		}
		this.runLog?.choice(this, h, 'pick', c, h.offer);
		this.deferSkippedDuos(h, c);
		if (c.kind === 'duo') {
			if (!this.fuseDuo(h, c)) return;
		} else if (c.kind === 'evo') {
			this.evolve(h, c);
		} else if (c.kind === 'ovr') {
			this.overclock(h, c);
		} else if (c.kind === 'ember') {
			h.embers[c.id] = (h.embers[c.id] ?? 0) + 1;
			this.sendEmbers(h);
			const before = h.maxHp;
			this.recalcMods(h);
			if (h.st === 0) h.hp = Math.min(h.maxHp, h.hp + (h.maxHp - before) + (EMBERS[c.id].heal ?? 0));
		} else if (c.kind === 'weapon') {
			const w = h.weapons.get(c.id);
			if (w?.lvl >= weaponMaxLevel(c.id)) { this.nextOffer(h); return; }
			const add = c.add ?? 1;
			if (w) w.lvl = Math.min(weaponMaxLevel(c.id), w.lvl + add);
			else h.weapons.set(c.id, { lvl: Math.min(weaponMaxLevel(c.id), add), t: 0.2 });
			if (c.rerolls) h.rerolls += c.rerolls;
		} else if (c.kind === 'passive') {
			const lvl = h.passives.get(c.id) ?? 0;
			if (lvl >= MAX_LEVEL) { this.nextOffer(h); return; }
			if (c.val !== undefined) h.pval[c.id] = (h.pval[c.id] ?? passiveValue(c.id, lvl)) + c.val;
			h.passives.set(c.id, Math.min(MAX_LEVEL, lvl + 1));
			const before = h.maxHp;
			this.recalcMods(h);
			if (h.maxHp > before && h.st === 0) h.hp += h.maxHp - before;
			this.sendPassives(h);
		} else if (c.kind === 'rare') {
			this.legendaryReforge(h);
		} else if (c.kind === 'heal' && h.st === 0) {
			h.hp = Math.min(h.maxHp, h.hp + HEAL_AMOUNT);
		}
		if (c.kind === 'weapon' || c.kind === 'rare' || c.kind === 'duo' || c.kind === 'evo' || c.kind === 'imprint') this.updateCombos(h);
		this.runLog?.picked(this, h);
		this.nextOffer(h);
	}

	// A duo card that was not taken (another card or «Отказаться») comes back after DUO_DEFER_OFFERS offers.
	deferSkippedDuos(h, picked) {
		for (const c of h.offer ?? []) {
			if (c.draft) h.buildChestDone = true;
			if (c.kind === 'imprint' && picked?.kind !== 'imprint') h.forgeDefer = h.offerNo + DUO_DEFER_OFFERS;
			if ((c.kind === 'duo' || c.kind === 'evo') && c !== picked) h.duoDefer[c.id] = h.offerNo + DUO_DEFER_OFFERS;
			// Taking the other variant is not a refusal.
			if (c.kind === 'ovr' && !(picked?.kind === 'ovr' && picked.id === c.id)) h.duoDefer['ovr:' + c.id] = h.offerNo + DUO_DEFER_OFFERS;
		}
	}

	// The single place where owned weapon pairs are matched against DUOS: h.combos = [{id, a, b, ready}].
	updateCombos(h) {
		h.fireW = [...h.weapons.keys()].some((id) => weaponDef(id).tags?.includes('fire')
			|| DUOS[id]?.parts.some((part) => WEAPONS[part].tags?.includes('fire')));
		const own = [...h.weapons].filter(([id, w]) => !DUOS[id] && !w.imprint);
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

	onReroll(pid, msg = {}) {
		if (this.state !== 'play') return;
		const h = this.heroes.get(pid);
		if (!this.acceptOfferAction(h, msg) || h.rerolls <= 0 || h.offer[0]?.kind === 'swap') return;
		this.runLog?.choice(this, h, 'reroll', null, h.offer);
		h.rerolls--;
		h.offer = this.makeChoices(h, true);
		this.sendOffer(h);
	}

	// Declining the whole offer gives SKIP_XP instead (no junk in slots).
	onSkip(pid, msg = {}) {
		if (this.state !== 'play') return;
		const h = this.heroes.get(pid);
		if (!this.acceptOfferAction(h, msg)) return;
		this.runLog?.choice(this, h, 'skip', null, h.offer);
		this.deferSkippedDuos(h, null);
		const swap = h.offer[0]?.kind === 'swap';
		if (swap) h.swapPending = false;
		this.nextOffer(h);
		if (!swap) this.addXp(h, SKIP_XP);
	}

	recalcMods(h) {
		const m = { ...baseMods(), maxHp: 0 };
		for (const [id, lvl] of h.passives) {
			const P = PASSIVES[id];
			m[P.stat] += !P.values && h.pval?.[id] !== undefined ? h.pval[id] : passiveValue(id, lvl);
			for (const [k, arr] of Object.entries(P.extra ?? {})) m[k] = Math.max(m[k], arr[Math.min(arr.length, lvl) - 1]);
			for (const [k, v] of Object.entries(P.bonus ?? {})) m[k] += v * lvl;
		}
		for (const [id, n] of Object.entries(h.embers ?? {})) m[EMBERS[id].stat] += EMBERS[id].value * n;
		m.cdMul = Math.max(0.3, m.cdMul);
		h.maxHp = h.baseHp + m.maxHp;
		delete m.maxHp;
		if (h.victoryBanner) { m.dmgMul *= 1.25; m.areaMul *= 1.15; }
		h.mods = m;
		if (!m.brace) h.blockCharge = 0;
	}

	updateOutposts(alive) { updateOutposts(this, alive); }
	guardKilled(e) { guardKilled(this, e); }
	openOutpostChest(p) { return openOutpostChest(this, p); }
	closeOutposts() { closeOutposts(this); }
	confineGuard(e) { confineGuard(e); }

	// --- simulation ---

	tick(dt) {
		if (!this.fin?.lord || this.state !== 'play') return this.step(dt);
		const t0 = performance.now();
		this.step(dt);
		if (this.state === 'play') this.runLog?.finTick(performance.now() - t0); // the last tick also builds the log
	}

	step(dt) {
		if (this.state !== 'play') return;
		if (this.frozen) {
			this.updateFrozen();
			if (this.frozen) return;
		}
		this.time += dt;
		this.tickNo++;
		this.lightBudget = 8; // death sparks and patches of lit enemies per tick
		if (this.tickNo % SNAPSHOT_EVERY === 1 % SNAPSHOT_EVERY) this.reactFx = 0;
		const alive = [];
		for (const h of this.heroes.values()) if (h.st === 0) alive.push(h);
		stepMobility(this, dt);

		this.updatePeaks(alive);
		this.updateFinale(dt, alive);
		updateCaravan(this, alive, dt);
		this.events.tick(alive);
		if (alive.length) {
			this.spawn(dt, alive);
			this.moveEnemies(dt, alive);
		}
		if (this.fin) this.finaleWall();
		this.rebuildGrid();
		this.updatePlayers(dt, alive);
		this.updateProjectiles(dt);
		this.updateColdWaves(dt);
		this.updateHostile(dt);
		this.updateBlasts();
		this.updateOrbs(dt);
		this.updateTimers();
		this.updateTraps(dt);
		this.updatePuddles(dt);
		for (const e of this.enemies) if (e.outpost || e.caravan) confineGuard(e);
		this.compactEnemies();
		this.updateGems(dt, alive);
		this.updateItems(dt, alive);
		this.updateRevive(dt);
		if (alive.length) {
			if (this.fin) this.nextEliteT = this.nextInvasionT = Infinity; // no elites or invasions from the prelude on
			if (this.time >= this.nextEliteT) {
				this.nextEliteT = this.time + (this.nt >= 600 ? ELITE_EVERY_LATE : ELITE_EVERY) / this.tscale;
				this.makeElite(alive);
			}
			if (this.time >= this.nextInvasionT) {
				this.nextInvasionT = this.time + INVASION.every / this.tscale;
				if (!this.nearPeak()) this.invasion(alive);
			}
			if (this.time >= this.nextGemSweep) {
				this.nextGemSweep = this.time + GEM_SWEEP_EVERY;
				this.sweepFarGems(alive);
			}
		}

		this.runLog?.tick(this);
		// The Lord fell this tick: dawn comes at once, even if the last hero fell with him.
		if (this.fin?.killed) {
			this.burnAll();
			this.finish(true, 2);
			return;
		}
		if (this.checkAllDown()) return;
		if (this.time >= this.runLength) {
			if (this.peaks.some((p) => p.burn)) this.burnAll();
			this.finish(true, 1);
			return;
		}
		if (this.tickNo % SNAPSHOT_EVERY === 0) this.snapshot();
		this.updateFrozen();
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
		const hp = E.hp * hpMul * this.modeHp;
		const e = {
			id: this.nextId++, type: TYPE_INDEX[type], def: E, x, y, hp, maxHp: hp,
			speed: E.speed * (0.9 + Math.random() * 0.2), dmg: E.dmg * enemyDmgScale(this.nt, this.heroes.size) * this.modeDmg * this.finDmg, dmgMul: enemyDmgScale(this.nt, this.heroes.size) * this.modeDmg * this.finDmg, r: E.r, xp: E.xp * (this.peak?.xpMul ?? 1),
			dead: false, zig: type === 'wisp', phase: Math.random() * Math.PI * 2, oh: null,
			boss: E.boss === true, ai: E.ai ?? null, bk: E.bk ?? null, bs: 0, bt: 0, bcd: 2, dcd: 1, vulnT: 0, group: 0, tx: 0, ty: 0, bvx: 0, bvy: 0, split: false,
			slow: 0, slowT: 0, frozenT: 0, thawT: 0, knockT: 0, rootT: 0, wetT: 0, markT: 0, markMul: 0,
			affW: null, affPid: 0, affT: 0, affCd: null, dragT: 0, drag: 0, soakT: 0, soakPid: 0, aimT: 0,
			burnT: 0, burnDps: 0, burnOwner: null, burnAcc: 0,
			elite: null, windT: 0, fuseT: 0, shotT: E.shotCd ? E.shotCd * (0.5 + Math.random() * 0.5) : 0,
			fuseBy: null, exploded: false, auxT: 0, fa: 0, born: this.time,
		};
		if (E.ai === 'shield' && alive.length) e.fa = Math.atan2(alive[0].y - y, alive[0].x - x);
		this.enemies.push(e);
		return e;
	}

	// Outpost guards own a separate, bounded budget and never thin ordinary encounters.
	ordinaryEnemyCount() {
		let n = 0;
		for (const e of this.enemies) if (!e.dead && !e.outpost && !e.caravan) n++;
		return n;
	}

	spawn(dt, alive) {
		this.updateOutposts(alive);
		const n = this.heroes.size;
		// v19: downed (and dropped) players do not thin the spawn for the rest, but one lying ally cuts it by one at most.
		const spawnN = Math.max(alive.length, n - 1);
		while (this.bossIdx < this.bossAt.length && this.time >= this.bossAt[this.bossIdx]) {
			const slot = this.bossIdx;
			const type = slot < BOSS_SCHEDULE.length ? this.bossPlan[slot % this.bossPlan.length] : FINAL_BOSS.type;
			this.bossIdx++;
			if (type === FINAL_BOSS.type && this.finPlan) this.finaleLord(alive, slot);
			else this.spawnBoss(type, alive, slot);
		}
		if (this.fin) return; // v21: from the prelude on the horde comes only as the finale's packs
		this.spawnSpecials(alive);
		const wave = this.currentWave();
		const pk = this.peak;
		const peakMul = pk?.spawnMul ? 1 + (pk.spawnMul - 1) * Math.min(1, pk.ramp ? (this.time - pk.at) / pk.ramp : 1) : 1;
		this.spawnAcc += wave.rate * spawnRateScale(spawnN) * peakMul * dt;
		if (this.spawnAcc < 1) return;
		const hpMul = enemyHpScale(this.nt, n);
		const cap = MAX_ENEMIES + (this.peak?.capAdd ?? 0);
		let count = this.ordinaryEnemyCount();
		while (this.spawnAcc >= 1) {
			this.spawnAcc -= 1;
			if (count >= cap) {
				this.spawnAcc = 0;
				break;
			}
			this.spawnEnemy(this.waveType(wave), alive, hpMul);
			count++;
		}
	}

	// v18: snipers and shieldbearers from the middle of the run, a few at a time (SPECIALS).
	spawnSpecials(alive) {
		const frac = this.time / this.runLength;
		let count = this.ordinaryEnemyCount();
		for (const id of SPECIAL_IDS) {
			if (count >= MAX_ENEMIES) break;
			const S = SPECIALS[id];
			const cap = specialCap(S, frac, this.heroes.size);
			if (!cap || this.time < this.specialT[id]) continue;
			this.specialT[id] = this.time + S.every / this.tscale;
			let n = 0;
			for (const e of this.enemies) if (!e.dead && !e.outpost && e.def === ENEMIES[id]) n++;
			if (n >= cap) continue;
			const e = this.spawnEnemy(id, alive, enemyHpScale(this.nt, this.heroes.size));
			count++;
			this.runLog?.special(this, e, 'spawned');
		}
	}

	spawnBoss(type, alive, slot = -1) {
		const b = this.spawnEnemy(type, alive, bossHpScale(this.nt, this.heroes.size, slot));
		b.group = b.id;
		this.bosses.push(b);
		this.fx.push(['boss', ENEMIES[type].name]);
		this.runLog?.bossSpawn(this, b);
		return b;
	}

	currentWave() {
		let wave = WAVES[0];
		for (const w of WAVES) if (w.at <= this.nt) wave = w;
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
		const hpMul = enemyHpScale(this.nt, this.heroes.size);
		const left = new Set(alive);
		let spawned = 0;
		let ordinary = this.ordinaryEnemyCount();
		for (const h of alive) {
			if (!left.has(h)) continue;
			const group = [...left].filter((o) => dist2(o.x, o.y, h.x, h.y) < R.cluster * R.cluster);
			for (const o of group) left.delete(o);
			const cx = group.reduce((s, o) => s + o.x, 0) / group.length, cy = group.reduce((s, o) => s + o.y, 0) / group.length;
			const r = R.r + Math.max(...group.map((o) => Math.hypot(o.x - cx, o.y - cy)));
			const count = Math.round(R.count * spawnRateScale(group.length));
			this.fx.push(['pring', Math.round(cx), Math.round(cy), Math.round(r)]);
			for (let i = 0; i < count && ordinary < MAX_ENEMIES + 120; i++) {
				const e = this.spawnEnemy(R.type ?? this.waveType(wave), alive, hpMul);
				const a = (i / count) * Math.PI * 2;
				e.x = cx + Math.cos(a) * r;
				e.y = cy + Math.sin(a) * r;
				spawned++;
				ordinary++;
			}
		}
		this.runLog?.peakNote(this, 'spawned', spawned);
	}

	// --- v21 finale «Последний рубеж» (FINALE): prelude → the Lord absorbs the horde → rage → «Светает».
	// this.fin = {cx, cy, r, r1, lord, fightAt, nextAdd, rage, last, revived, killed}.
	updateFinale(dt, alive) {
		const P = this.finPlan;
		if (!P) return;
		if (!this.finWarned && this.time >= P.warn) {
			this.finWarned = true;
			if (this.time < P.pre) this.fx.push(['finw']);
		}
		if (!this.fin) {
			if (this.time < P.pre) return;
			this.startFinale(alive);
		}
		const f = this.fin;
		if (f.r > f.r1) f.r = Math.max(f.r1, f.r - FINALE.ring.shrink * dt);
		const lord = f.lord;
		if (!lord || lord.dead) return;
		if (!f.rage && this.time >= lord.immuneT && lord.hp <= lord.maxHp * lord.def.rage) {
			f.rage = true;
			f.rageT = this.time;
			this.fx.push(['fin', 3]);
			this.runLog?.finRage(this);
		}
		// The ray of dawn (groups, once): pairs get it at rage as in v21; from FINALE.adds.groupFrom players it comes at rage
		// or at the middle of the fight, whichever is first, as soon as somebody online lies down (v23, #9FKPYY).
		const big = this.heroes.size >= FINALE.adds.groupFrom;
		const due = f.rage || (big && this.time >= f.fightAt + this.finPlan.fight * FINALE.rayAt);
		if (!f.ray && FINALE.rageRevive && this.heroes.size >= 2 && this.time >= lord.immuneT && due
			&& (!big || [...this.heroes.values()].some((h) => h.st === 1 && !h.offline))) {
			f.ray = true;
			f.revived = this.dawnRevive();
			this.fx.push(['ray', f.revived]);
			this.runLog?.finRay(this, f.revived);
		}
		if (!f.last && this.peak?.id === 'dawn') {
			f.last = true;
			this.fx.push(['fin', 4]);
		}
		if (this.time >= f.nextAdd && alive.length) {
			f.nextAdd += FINALE.adds.every;
			this.finaleAdds(alive);
		}
	}

	// The ring: centred on the alive hero closest to the middle of the group, starts wide enough for everyone.
	startFinale(alive) {
		this.closeOutposts();
		const all = [...this.heroes.values()];
		const pool = alive.length ? alive : all;
		const mx = pool.reduce((s, h) => s + h.x, 0) / (pool.length || 1), my = pool.reduce((s, h) => s + h.y, 0) / (pool.length || 1);
		let c = pool[0] ?? { x: 0, y: 0 };
		for (const h of pool) if (dist2(h.x, h.y, mx, my) < dist2(c.x, c.y, mx, my)) c = h;
		const r1 = finaleRingR(this.heroes.size);
		const far = Math.max(0, ...all.map((h) => Math.hypot(h.x - c.x, h.y - c.y)));
		this.fin = { cx: Math.round(c.x), cy: Math.round(c.y), r: Math.max(r1, far) + FINALE.ring.pad, r1, lord: null, fightAt: 0, nextAdd: Infinity, rage: false, rageT: 0, ray: false, last: false, revived: 0, killed: null };
		this.fx.push(['fin', 1]);
		this.runLog?.finStart(this);
	}

	finPhase() {
		const f = this.fin;
		return !f ? 0 : f.last ? 4 : f.rage ? 3 : f.lord ? 2 : 1;
	}

	// The wall holds heroes (the downed and the dropped are dragged inside too) and the Lord; the horde walks through it.
	finaleWall() {
		const f = this.fin;
		for (const h of this.heroes.values()) [h.x, h.y] = clampToRing(h.x, h.y, f.cx, f.cy, f.r - PLAYER_RADIUS);
		const e = f.lord;
		if (e && !e.dead) [e.x, e.y] = clampToRing(e.x, e.y, f.cx, f.cy, f.r - e.r);
	}

	// The Lord absorbs the whole horde (no xp, gems, chests or kills) and comes out in the middle of the ring.
	finaleLord(alive, slot) {
		if (!this.fin) this.startFinale(alive);
		const f = this.fin;
		let n = 0;
		for (const e of this.enemies) if (!e.dead) {
			e.dead = true;
			n++;
		}
		for (const b of this.bosses) this.runLog?.bossAbsorbed(this, b);
		this.bosses.length = 0;
		this.hostile.length = 0;
		this.blasts = this.blasts.filter((b) => b.kind === 0);
		this.fx.push(['absorb', n, f.cx, f.cy]);
		const players = this.heroes.size;
		this.finDmg = finaleDmgMul(players);
		let x = f.cx, y = f.cy;
		if (alive.some((h) => dist2(h.x, h.y, x, y) < 150 * 150)) {
			// Somebody stands in the middle: the spot inside half the arena that is farthest from the alive heroes.
			let best = -1;
			for (let i = 0; i < 16; i++) {
				const a = (i / 16) * Math.PI * 2;
				const px = f.cx + Math.cos(a) * f.r1 * 0.5, py = f.cy + Math.sin(a) * f.r1 * 0.5;
				const d = Math.min(...alive.map((h) => dist2(h.x, h.y, px, py)));
				if (d > best) [best, x, y] = [d, px, py];
			}
		}
		const b = this.spawnEnemy(FINAL_BOSS.type, alive, bossHpScale(this.nt, players, slot) * finaleHpMul(this.mode, players));
		b.x = x;
		b.y = y;
		b.group = b.id;
		b.finLord = true;
		b.by = new Map();
		b.immuneT = this.time + FINALE.lordSpawnWarn;
		this.bosses.push(b);
		f.lord = b;
		f.fightAt = this.time;
		f.nextAdd = this.time + FINALE.adds.first;
		this.fx.push(['warn', Math.round(x), Math.round(y), FINALE.lordSpawnR, round3(FINALE.lordSpawnWarn)]);
		this.fx.push(['boss', b.def.name]);
		this.runLog?.bossSpawn(this, b);
		this.runLog?.finFight(this, b, n);
		return b;
	}

	// A pack of the current wave steps out of the dark, evenly around the arena, while the field is under the cap.
	finaleAddCount(alive) {
		const A = FINALE.adds;
		const spawnN = Math.max(alive.length, this.heroes.size - 1);
		return Math.round(A.rate * this.currentWave().rate * finaleAddScale(spawnN) * A.every);
	}

	finaleAdds(alive) {
		const f = this.fin, A = FINALE.adds;
		let cur = 0;
		for (const e of this.enemies) if (!e.dead && !e.boss) cur++;
		const count = Math.max(0, Math.min(this.finaleAddCount(alive), finaleAddCap(this.heroes.size) - cur));
		const wave = this.currentWave();
		const hpMul = enemyHpScale(this.nt, this.heroes.size);
		const a0 = Math.random() * Math.PI * 2, r = f.r1 + FINALE.ring.addsOut;
		for (let i = 0; i < count; i++) {
			const e = this.spawnEnemy(this.waveType(wave), alive, hpMul);
			const a = a0 + (i / count) * Math.PI * 2;
			e.x = f.cx + Math.cos(a) * r;
			e.y = f.cy + Math.sin(a) * r;
			e.xp *= A.xpMul;
			e.add = true;
		}
		this.runLog?.finAdds(count);
		return count;
	}

	// The ray of dawn (groups only, once): every downed hero who is online gets up. Nobody is credited with a revive.
	dawnRevive() {
		let n = 0;
		for (const h of this.heroes.values()) {
			if (h.st !== 1 || h.offline) continue;
			h.st = 0;
			h.rev = 0;
			h.hp = h.maxHp * REVIVE_HP_FRACTION;
			h.iframes = REVIVE_IFRAMES;
			h.lastPosT = this.time;
			this.fx.push(['up', h.pid]);
			this.runLog?.up(this, h);
			n++;
		}
		return n;
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
		const count = invasionCount(this.nt, this.heroes.size);
		if (count <= 0) return;
		const hpMul = enemyHpScale(this.nt, this.heroes.size);
		const cap = MAX_ENEMIES + 60;
		let ordinary = this.ordinaryEnemyCount();
		for (const h of alive) {
			this.fx.push(['inv', h.pid, INVASION.radius]);
			for (let i = 0; i < count && ordinary < cap; i++) {
				const e = this.spawnEnemy(this.waveType(wave), alive, hpMul);
				const a = (i / count) * Math.PI * 2;
				e.x = h.x + Math.cos(a) * INVASION.radius;
				e.y = h.y + Math.sin(a) * INVASION.radius;
				ordinary++;
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
		const fog = this.events.active?.id === 'fog';
		for (const e of this.enemies) {
			if (e.dead) continue;
			try {
				if (e.burnT > now) this.burnTick(e, dt);
				if (e.dead) continue;
				if ((e.outpost || e.caravan) && e.guardReadyAt > now) continue;
				controlTick(e, now, dt);
				let best = null, bd = Infinity;
				for (const p of alive) {
					if (e.outpost && dist2(p.x, p.y, e.outpost.x, e.outpost.y) > OUTPOST.pursuit ** 2) continue;
					if (e.caravan && dist2(p.x, p.y, e.caravan.x, e.caravan.y) > CARAVAN.pursuit ** 2) continue;
					const d = dist2(e.x, e.y, p.x, p.y);
					if (d < bd) {
						bd = d;
						best = p;
					}
				}
				if (!e.outpost && !e.caravan && bd > FAR_DIST2 && e.ai !== 'flee') {
					[e.x, e.y] = this.randomRingPos(alive);
					e.windT = 0;
					e.bs = 0;
					continue;
				}
				if (!best && (e.outpost || e.caravan)) {
					const anchor = e.outpost ?? e.caravan;
					const dx = anchor.x - e.x, dy = anchor.y - e.y, d = Math.hypot(dx, dy) || 1;
					const step = e.frozenT > now || e.rootT > now ? 0 : Math.min(d, e.speed * dt);
					e.x += dx / d * step;
					e.y += dy / d * step;
					e.bs = 0;
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
				let speed = (e.slowT > now ? e.speed * (1 - e.slow) : e.speed) * speedMul;
				if (e.dragT > now) speed *= 1 - e.drag; // affinity «Вязкость»: a slow that is not cold
				if (fog && this.events.inFog(e)) speed *= FOG_DEF.speedMul;
				let maxStep = Math.max(0, d - e.r - PLAYER_RADIUS + 2);
				if (e.bk && this.bossTick(e, best, d, dx, dy, speed, dt)) continue;
				if (e.ai === 'sniper') {
					if (this.sniperTick(e, best, d, dt)) continue;
					const [kmin, kmax] = e.outpost ? OUTPOST.sniperKeep : e.def.keep;
					if (d < kmin) {
						dx = -dx;
						dy = -dy;
						maxStep = Infinity;
					} else if (d <= kmax) {
						const s = Math.sin(e.phase + now * 0.4) >= 0 ? 1 : -1;
						[dx, dy] = [-dy * s, dx * s];
						speed *= 0.4;
					}
				} else if (e.ai === 'shield') {
					if (this.dashTick(e, best, d, dt, true)) {
						if (e.bs === 'aim' || e.bs === 'dash') e.fa = Math.atan2(e.bvy, e.bvx);
						continue;
					}
					this.turnShield(e, dx, dy, dt);
				} else if (e.ai === 'flee') {
					// Loops around the nearest player: mostly sideways (the side flips every `turn` s), away when close,
					// back when far, so a hero cutting the circle catches up.
					const F = e.def;
					const side = Math.floor((now - e.born) / F.turn + e.phase) % 2 ? 1 : -1;
					const showing = now - e.born < F.show;
					const out = showing ? 0 : d < F.near ? 1.2 : d > F.far ? -0.8 : 0.2;
					if (showing) speed *= F.showSpeed;
					[dx, dy] = [-dy * side - dx * out, dx * side - dy * out];
					const l = Math.hypot(dx, dy) || 1;
					dx /= l;
					dy /= l;
					maxStep = Infinity;
				} else if (e.ai === 'ranged') {
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
			} finally { confineGuard(e); }
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
				if (e.immuneT > this.time) return true; // coming out of the dark: stands still
				return this.lordTick(e, t, d, dt, rage);
		}
		return false;
	}

	bossStep(e, dx, dy, speed, dt) {
		e.x += dx * speed * dt;
		e.y += dy * speed * dt;
		confineGuard(e);
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
		e.dcd = E.dashCd ?? 0.5;
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
		// v21: in rage the finale Lord also charges; his attack cooldown keeps running meanwhile.
		if (e.finLord && (rage || e.bs) && this.dashTick(e, t, d, dt, rage)) {
			e.bcd = Math.max(0.3, e.bcd - dt);
			return true;
		}
		e.bcd -= dt;
		if (e.bcd > 0 || d > 700) return false;
		e.bcd = E.cd * (rage ? 0.65 : 1) * (e.finLord && this.fin?.last ? FINALE.lastCd : 1);
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
		const hpMul = enemyHpScale(this.nt, this.heroes.size);
		// v21: in the arena the swarm stays near the packs' cap (weak devices, a crowded ring).
		const cap = this.fin ? finaleAddCap(this.heroes.size) + FINALE.adds.callOver : MAX_ENEMIES + 60;
		let ordinary = this.ordinaryEnemyCount();
		for (let i = 0; i < count && ordinary < cap; i++) {
			const m = this.spawnEnemy(call.type, alive, hpMul);
			const a = (i / count) * Math.PI * 2;
			m.x = x + Math.cos(a) * call.ring;
			m.y = y + Math.sin(a) * call.ring;
			ordinary++;
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
			life: E.shotLife, dmg: E.shotDmg * e.dmgMul * (this.events.inFog(e) ? FOG_DEF.dmgMul : 1), from: (e.elite ? 'elite' : enemyKey(e)) + ':shot',
		};
		boundGuardShot(e, s);
		this.hostile.push(s);
		this.fx.push(['eshot', s.id, Math.round(s.x), Math.round(s.y), Math.round(s.vx), Math.round(s.vy), round3(s.life), round3(this.time)]);
	}

	// Sniper: a lane telegraph (as bosses' charges) for `windup` s, then one slow big orb along it. True while standing.
	sniperTick(e, target, d, dt) {
		const E = e.def;
		if (e.outpost && e.windT > 0 && e.guardAim && (e.x !== e.guardAim.x || e.y !== e.guardAim.y)) {
			e.windT = 0;
			e.shotT = 0;
		}
		if (e.windT > 0) {
			e.windT -= dt;
			if (e.windT <= 0) {
				e.windT = 0;
				const a0 = Math.atan2(e.bvy, e.bvx);
				const dmg = E.shotDmg * e.dmgMul * (this.events.inFog(e) ? FOG_DEF.dmgMul : 1);
				for (let i = 0; i < E.fan; i++) {
					const a = a0 + (i - (E.fan - 1) / 2) * E.spread;
					const s = {
						id: this.nextId++, x: e.x, y: e.y, vx: Math.cos(a) * E.shotSpeed, vy: Math.sin(a) * E.shotSpeed, r: E.shotR,
						life: E.shotLife, dmg, from: 'sniper:shot',
					};
					boundGuardShot(e, s);
					this.hostile.push(s);
					this.fx.push(['eorb', s.id, Math.round(s.x), Math.round(s.y), Math.round(s.vx), Math.round(s.vy), round3(s.life), round3(this.time), s.r]);
				}
				this.runLog?.special(this, e, 'shots');
			}
			return true;
		}
		e.shotT -= dt;
		const keep = e.outpost ? OUTPOST.sniperKeep : E.keep;
		if (e.shotT <= 0 && d < keep[1] + 150) {
			// Aim where the target will be in `lead` s if it keeps moving (the lane shows it; turning dodges).
			const moving = target.movedT !== undefined && this.time - target.movedT < 0.3;
			const lead = moving ? E.lead * target.speed * (target.mods?.speedMul ?? 1) : 0;
			const tx = target.x + (target.mvx ?? 0) * lead, ty = target.y + (target.mvy ?? 0) * lead;
			const l = Math.hypot(tx - e.x, ty - e.y) || 1;
			e.bvx = (tx - e.x) / l;
			e.bvy = (ty - e.y) / l;
			e.windT = E.windup;
			e.shotT = E.shotCd;
			if (e.outpost) e.guardAim = { x: e.x, y: e.y };
			// v19: one lane per orb of the fan, so the safe gaps are where the picture shows them.
			const a0 = Math.atan2(e.bvy, e.bvx);
			for (let i = 0; i < E.fan; i++) {
				const a = a0 + (i - (E.fan - 1) / 2) * E.spread;
				const ca = Math.cos(a), sa = Math.sin(a);
				const preview = boundGuardShot(e, { x: e.x, y: e.y, vx: ca * E.shotSpeed, vy: sa * E.shotSpeed, life: E.shotLife });
				const len = E.shotSpeed * preview.life;
				this.fx.push(['bline', Math.round(e.x), Math.round(e.y), Math.round(e.x + ca * len), Math.round(e.y + sa * len), E.shotR * 2 + 8, round3(E.windup)]);
			}
			return true;
		}
		return false;
	}

	// The shield turns toward its target at `turn` rad/s; circling players get behind it.
	turnShield(e, dx, dy, dt) {
		const want = Math.atan2(dy, dx);
		let da = want - e.fa;
		while (da > Math.PI) da -= Math.PI * 2;
		while (da < -Math.PI) da += Math.PI * 2;
		const step = e.def.turn * dt;
		e.fa += Math.abs(da) <= step ? da : Math.sign(da) * step;
	}

	// Damage multiplier of the shield for a hit by `h` (from the hero's side); burn and raw hits ignore it.
	shieldMul(e, h) {
		const ax = h.x - e.x, ay = h.y - e.y;
		const l = Math.hypot(ax, ay) || 1;
		return (ax * Math.cos(e.fa) + ay * Math.sin(e.fa)) / l >= SHIELD_COS ? e.def.front : 1;
	}

	updateHostile(dt) {
		let j = 0;
		for (const s of this.hostile) {
			const ox=s.x, oy=s.y, step=Math.min(dt,Math.max(0,s.life));
			s.life -= dt; s.x += s.vx * step; s.y += s.vy * step;
			let target=null, impact=Infinity;
			for (const h of this.heroes.values()) {
				if(h.st !== 0) continue;
				const prev=h.dashPath ?? h.hostilePos ?? h;
				const t=movingCircleImpact(ox,oy,s.x,s.y,prev.x,prev.y,h.x,h.y,(s.r ?? HOSTILE_R)+PLAYER_RADIUS);
				if(t !== null && t < impact){impact=t;target=h;}
			}
			if(target && target.iframes <= 0) this.hurtPlayer(target,s.dmg,s.from);
			const done=target || s.life<=0 || (s.outpost && dist2(s.x,s.y,s.outpost.x,s.outpost.y)>OUTPOST.shotRange**2);
			if(done) this.fx.push(['epend',s.id,round3(this.time-dt+(target?impact*step:step))]);
			else this.hostile[j++]=s;
		}
		this.hostile.length=j;
		for(const h of this.heroes.values()) h.hostilePos={x:h.x,y:h.y};
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
			confineGuard(e);
		}
	}

	// Once in a while a regular enemy near the players turns into an elite with one affix.
	makeElite(alive) {
		const cand = [];
		for (const e of this.enemies) {
			if (e.dead || e.outpost || e.caravan || e.boss || e.elite || e.ai === 'exploder' || e.def.special) continue;
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
		if (e.outpost || e.caravan) return;
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
			if (e.outpost && dist2(p.x, p.y, e.outpost.x, e.outpost.y) > OUTPOST.pursuit ** 2) continue;
			if (e.caravan && dist2(p.x, p.y, e.caravan.x, e.caravan.y) > CARAVAN.pursuit ** 2) continue;
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
		if (e.ai === 'flee' && !h) return 0; // the golden shade is the players' catch only
		if (e.immuneT > this.time) return 0; // the finale Lord while he comes out
		src = this.weaponSource(h, src);
		if (!src.raw && !src.react) dmg *= src.scale ?? 1;
		const now = this.time;
		const weaponDamage = dmg;
		let crit = false;
		if (!src.raw && e.markT > now) dmg *= 1 + e.markMul;
		if (!src.raw && e.aimT > now) dmg *= 1 + AFFINITY.aim.vuln; // affinity «Наводка», on top of any mark
		if (e.vulnT > now) dmg *= e.def.vuln ?? 1;
		let critAdd = 0;
		if (h && !src.raw && WEAPONS[src.weapon] && !this.affinityOff) {
			const a = this.affinity(e, h, src.weapon);
			if (a) {
				const A = AFFINITY[a];
				if (A.mul && a !== 'soak') dmg *= 1 + A.mul;
				if (A.crit) critAdd = A.crit;
			}
			if (e.soakT > now && e.soakPid === h.pid && WEAPONS[src.weapon].role === 'trace') dmg *= 1 + AFFINITY.soak.mul;
		}
		if (h && !src.raw) {
			if (h.rageT > now) dmg *= ITEMS.rage.mul;
			if (h.streakT > now) dmg *= STREAK_MUL;
			if (h.altarDmgT > now) dmg *= ALTAR_DEALS[0].dmgMul;
			if (this.synergy > 0) dmg *= 1 + this.synergy;
			if (h.bondMul > 1) dmg *= h.bondMul;
			if (h.bannerT > now) dmg *= 1 + EVOS.banner.levels[0].dmgBuff;
			if (h.mods.chillVuln > 0 && e.slowT > now) dmg *= 1 + h.mods.chillVuln;
			if (h.mods.critChance + critAdd > 0 && Math.random() < h.mods.critChance + critAdd) {
				crit = true;
				dmg *= h.mods.critMul;
			}
		}
		const resonant = e.resonanceT > now;
		const canSeedAsh = h?.mods.ashHops > 0 && !src.raw && !src.react && !src.perk && src.coilJumps === undefined;
		const burning = e.burnT > now && e.burnOwner?.mods.ashHops > 0;
		if (h && !src.react && !src.raw && h.blockCharge > 0) {
			dmg *= 1 + 0.55 * h.blockCharge;
			h.blockCharge = 0;
			this.fx.push(['buildring', Math.round(e.x), Math.round(e.y), 56, 2]);
		}
		// Reaction additions belong to this hit, including when splash damage nests hurtEnemy calls.
		const reaction = { fixed: 0, flash: 0 };
		if (!src.react && !src.raw && src.tags.length) dmg = this.react(e, dmg, h, src, reaction);
		if (e.elite === 'armored' && src.tags.includes('proj')) {
			dmg *= 0.5;
			reaction.fixed *= 0.5;
			reaction.flash *= 0.5;
		}
		if (e.ai === 'shield' && h && !src.raw && src !== SRC_BURN) {
			const m = this.shieldMul(e, h);
			if (m < 1) {
				this.runLog?.special(this, e, 'blocked', dmg * (1 - m));
				dmg *= m;
				reaction.fixed *= m;
				reaction.flash *= m;
			}
		}
		const dealt = Math.min(dmg, e.hp);
		let withoutLocalMark = dmg;
		if (!src.raw && e.markT > now && e.markOwner && e.markMul > 0) {
			withoutLocalMark = reaction.fixed + (dmg - reaction.fixed) / (1 + e.markMul);
			const gain = Math.max(0, dealt - Math.min(e.hp, withoutLocalMark));
			e.markOwner.supportDamage += gain;
			if(h !== e.markOwner) e.markOwner.support.allyDamage += gain;
		}
		if (!src.raw && src.markSupport) {
			// A reaction can carry another target's mark into this hit. Credit that
			// inherited gain before the local mark, so their cross term is counted once.
			const withoutEitherMark = withoutLocalMark - withoutLocalMark * src.markSupport.fraction;
			const gain = Math.max(0, Math.min(e.hp, withoutLocalMark) - Math.min(e.hp, withoutEitherMark));
			src.markSupport.owner.supportDamage += gain;
			if(h !== src.markSupport.owner) src.markSupport.owner.support.allyDamage += gain;
		}
		const flashPart = Math.min(reaction.flash, dealt);
		if (h) {
			h.dmg += dealt;
			h.dmgBy[src.weapon] = (h.dmgBy[src.weapon] ?? 0) + dealt - flashPart;
			if (flashPart > 0) h.dmgBy.r_flash = (h.dmgBy.r_flash ?? 0) + flashPart;
			if (dmg > h.bestHit[0]) h.bestHit = [dmg, src.weapon, this.time];
		}
		e.hp -= dmg;
		if (e.boss) this.runLog?.bossHit(this, e, dealt, h);
		if (e.finLord && h) e.by.set(h.pid, (e.by.get(h.pid) ?? 0) + dealt);
		this.lastCrit = crit;
		if (crit && this.critFx < MAX_CRIT_FX) {
			this.critFx++;
			this.fx.push(['hit', Math.round(e.x), Math.round(e.y), Math.max(1, Math.round(dmg)), 1, h.pid]);
		} else if (this.hitFx < MAX_HIT_FX) {
			this.hitFx++;
			this.fx.push(['hit', Math.round(e.x), Math.round(e.y), Math.max(1, Math.round(dmg))]);
		}
		if (e.hp <= 0) {
			this.killEnemy(e, h, src);
			if (burning) this.spreadAsh(e);
			else if (canSeedAsh && this.seedAsh(e, h, weaponDamage)) this.spreadAsh(e);
			if (h?.mods.coil > 0 && !src.react && !src.raw) this.coilJump(e, h,
				{ ...src, coilPower: src.coilPower ?? (src.tags.includes('shock') || resonant ? 0.66 : 0.38) }, dmg);
		} else if (h && h.mods.burnChance > 0 && !src.react) {
			if (h.fireW) {
				if (Math.random() < h.mods.burnChance) this.burn(e, h, h.mods.burnDps, 3);
			} else if (e.burnT <= this.time + 1) this.burn(e, h, h.mods.burnDps * EMBER_WEAK.frac, EMBER_WEAK.dur);
		}
		if (!e.dead && canSeedAsh) this.seedAsh(e, h, weaponDamage);
		if (h?.st === 0 && !h.offline && dealt > 0 && !src.raw && !src.react && !src.perk
			&& src.coilJumps === undefined && Object.hasOwn(SRC, src.weapon)) onWeaponHit(this, h, e, weaponDamage, src);
		this.lastCrit = crit;
		return dmg;
	}

	// Affinity (v24): a hit by plain weapon `w` on an enemy this player hit with another plain weapon within AFFINITY_WINDOW s.
	// Returns the rule id when it fires (side effects applied here, damage and crit by the caller), else null.
	affinity(e, h, w) {
		const now = this.time, prev = e.affW;
		const fresh = prev && prev !== w && e.affPid === h.pid && now - e.affT <= AFFINITY_WINDOW;
		e.affW = w;
		e.affPid = h.pid;
		e.affT = now;
		if (!fresh || !h.weapons.has(prev) || !h.weapons.has(w)) return null;
		const a = affinityOf(prev, w);
		if (!a) return null;
		const key = prev < w ? prev + '+' + w : w + '+' + prev;
		if ((e.affCd?.[key] ?? 0) > now) return null;
		(e.affCd ??= {})[key] = now + AFFINITY_EVERY;
		const A = AFFINITY[a];
		if (a === 'recoil' && !e.boss) this.knock(e, h.x, h.y, A.kb);
		else if (a === 'drag' && !e.boss) {
			e.drag = Math.max(e.dragT > now ? e.drag : 0, A.slow);
			e.dragT = now + A.dur;
		} else if (a === 'aim') e.aimT = now + A.dur;
		else if (a === 'soak') {
			e.soakT = now + A.dur;
			e.soakPid = h.pid;
		}
		h.affN[a]++;
		if (!h.affSeen.has(a)) {
			h.affSeen.add(a);
			this.send(h.pid, { t: 'aff', id: a, a: prev, b: w });
		}
		return a;
	}

	seedAsh(e, h, damage) {
		// A weapon can start a fire, but its own lightning cannot both ignite and detonate the same hit.
		// Haste, Echo and overlapping zones cannot refresh this ignition more than once per 2.5 seconds.
		if ((e.ashSeedAt?.[h.pid] ?? -Infinity) > this.time) return false;
		(e.ashSeedAt ??= {})[h.pid] = this.time + 2.5;
		this.burn(e, h, Math.max(1, damage * 0.08), 2.5, e.burnT > this.time ? e.ashHops : undefined);
		return true;
	}

	spreadAsh(e) {
		const h = e.burnOwner;
		const hops = e.ashHops ?? h.mods.ashHops;
		if (h.st !== 0 || hops <= 0) return;
		const radius = (59 + 7 * h.passives.get('ashseal')) * h.mods.areaMul;
		const targets = this.grid.query(e.x, e.y, radius, []).filter((o) =>
			!o.dead && o.burnT <= this.time && dist2(e.x, e.y, o.x, o.y) <= radius ** 2);
		if (!targets.length) return;
		this.fx.push(['buildring', Math.round(e.x), Math.round(e.y), Math.round(radius), 3]);
		for (const o of targets) this.burn(o, h, e.burnDps * 0.8, 2.6, hops - 1);
	}

	coilJump(e, h, src, dmg) {
		const jumps = src.coilJumps ?? h.mods.coil;
		if (h.st !== 0 || jumps <= 0) return;
		const next = this.nearestFrom(e, [e], 115 + 10 * h.passives.get('coil'));
		if (!next) return;
		this.fx.push(['zap', Math.round(e.x), Math.round(e.y), Math.round(next.x), Math.round(next.y)]);
		this.hurtEnemy(next, Math.min(260, dmg * (src.coilPower ?? 0.66)), h,
			{ weapon: src.weapon, tags: ['shock'], coilJumps: jumps - 1, coilPower: src.coilPower ?? 0.66 });
	}

	// Carry only the primary mark's proportional contribution, excluding fixed
	// reaction additions. This is accounting metadata; combat damage stays intact.
	reactionSource(e, src, dmg, fixed = 0) {
		const markable = dmg - fixed;
		if (!(e.markT > this.time && e.markOwner && e.markMul > 0 && markable > 0)) return src;
		const extra = markable - markable / (1 + e.markMul);
		return { ...src, markSupport: { owner: e.markOwner, fraction: extra / dmg } };
	}

	// Reactions (5.3): the enemy's states meet the hit's tags; returns the (possibly multiplied) damage.
	react(e, dmg, h, src, reaction = {}) {
		const now = this.time, t = src.tags;
		const fire = t.includes('fire'), cold = t.includes('cold'), shock = t.includes('shock');
		if (t.includes('phys') && e.resonanceT > now) {
			e.resonanceT = 0;
			const r = 58;
			this.fx.push(['buildring', Math.round(e.x), Math.round(e.y), r, 1]);
			this.splash(e.x, e.y, r, dmg * 0.65 * e.resonancePower, h,
				this.reactionSource(e, { weapon: 'tuning', tags: [], react: true }, dmg), e);
		}
		if (fire && e.rootT > now && t.includes('aoe')) {
			dmg *= REACT.blastMul;
			this.reacted('blast', e.x, e.y, 0);
		}
		if (t.includes('phys') && e.frozenT > now) {
			dmg *= REACT.shatterMul;
			e.frozenT = now;
			e.thawT = now + FREEZE_IMMUNE;
			this.reacted('shatter', e.x, e.y, REACT.shatterR);
			this.splash(e.x, e.y, REACT.shatterR, dmg * REACT.shatterFrac, h, this.reactionSource(e, SRC_R.shatter, dmg), e);
		}
		if (shock && e.burnT > now) {
			e.burnT = 0;
			this.reacted('flash', e.x, e.y, REACT.flashR);
			const fixed = REACT.flashBase * (h?.mods.dmgMul ?? 1);
			const flash = fixed + dmg * REACT.flashFrac;
			this.splash(e.x, e.y, REACT.flashR, flash, h, this.reactionSource(e, SRC_R.flash, flash, fixed), e);
			dmg += flash;
			reaction.fixed = fixed;
			reaction.flash = flash; // hurtEnemy books this part as r_flash, rather than weapon damage
		}
		if (shock && e.wetT > now && e.wetZ && e.wetZ.life > 0 && !(e.wetZ.condT > now)) {
			const z = e.wetZ;
			z.condT = now + REACT.condEvery;
			this.reacted('cond', z.x, z.y, z.r);
			this.splash(z.x, z.y, z.r, dmg * REACT.condFrac, h, this.reactionSource(e, SRC_R.cond, dmg, reaction.fixed), e);
		}
		if (cold && e.wetT > now && !e.boss && e.frozenT <= now && this.freeze(e, REACT.icingFreeze * (h?.mods.ctrlMul ?? 1), h)) this.reacted('icing', e.x, e.y, 0);
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

	root(e, dur, owner) {
		if (e.boss || dur <= 0) return;
		if(this.time + dur > e.rootT) e.rootOwner = owner;
		e.rootT = Math.max(e.rootT, this.time + dur);
	}

	burn(e, h, dps, dur, ashHops) {
		const fresh = e.burnT <= this.time;
		if (fresh) e.burnAcc = 0;
		if (fresh || dps >= e.burnDps) {
			e.burnDps = dps;
			e.burnOwner = h;
			e.ashHops = ashHops;
		}
		e.burnT = Math.max(e.burnT, this.time + dur * h.mods.durMul);
	}

	burnTick(e, dt) {
		e.burnAcc += dt;
		if (e.burnAcc < BURN_TICK) return;
		e.burnAcc -= BURN_TICK;
		this.hurtEnemy(e, e.burnDps * BURN_TICK, e.burnOwner, SRC_BURN);
	}

	slowEnemy(e, slow, dur, owner) {
		slow = Math.min(e.boss ? 0.25 : 0.7, Math.max(0, slow));
		if (e.slowT <= this.time || slow >= e.slow) { e.slow = slow; e.slowOwner = owner; }
		e.slowT = Math.max(e.slowT, this.time + dur);
	}

	killEnemy(e, h, src = SRC_NONE) {
		if (e.dead) return;
		e.dead = true;
		if (e.outpost) this.guardKilled(e);
		if (e.caravan) caravanGuardKilled(this, e);
		this.kills++;
		if (h) {
			h.kills++;
			if (KNIFE_SRC.has(src.weapon)) h.knifeKills++;
			this.countStreak(h);
		}
		if (this.dieFx < MAX_DIE_FX) {
			this.dieFx++;
			this.fx.push(['die', Math.round(e.x), Math.round(e.y), e.type]);
		}
		const luck = h ? h.mods.luck : 0;
		const gold = Math.random() < GOLD_GEM_CHANCE * (1 + luck);
		let xp = e.beaconT > this.time ? e.xp * EVOS.beacon.levels[0].xpMul : e.xp;
		if (this.events.inFog(e)) xp *= FOG_DEF.xpMul;
		this.dropGem(e.x, e.y, gold ? xp * GOLD_GEM_MUL : xp, gold);
		this.events.onKill(e, h);
		if (e.def.special && e.ai !== 'flee') this.runLog?.special(this, e, 'killed');
		if (e.add) this.runLog?.finAddKilled();
		if (e.burnT > this.time && e.burnOwner?.weapons.has('firepath')) this.spreadFire(e);
		if (e.markT > this.time && e.lightBy) this.lightDeath(e);
		if (h && src.weapon === 'fireworks') this.gems[this.gems.length - 1].pull = h;
		if (e.ai === 'exploder' && !e.exploded) {
			e.exploded = true;
			const E = e.def;
			// Killed by a player: short fuse at the spot; fuse burnt out: blows up right away.
			this.addBlast(e.x, e.y, E.blastR, E.blastDmg * e.dmgMul, E.blastEnemyDmg, h, 1, e.fuseT > 0 || src === SRC_BLAST ? 0 : E.fuse);
		}
		if (e.elite && !e.outpost) {
			if (e.elite === 'volatile') this.addBlast(e.x, e.y, VOLATILE_R, ENEMIES.bloater.blastDmg, ENEMIES.bloater.blastEnemyDmg, h, 2, ENEMIES.bloater.fuse);
			if (Math.random() < ELITE_CHEST_CHANCE * (1 + luck)) this.dropItem('chest', e.x, e.y);
			else this.dropGem(e.x + 12, e.y, e.xp * GOLD_GEM_MUL, true);
		}
		if (h && h.st === 0 && !e.boss && Math.random() < DEW_DROP.chance * (h.hp < h.maxHp * DEW_DROP.lowHp ? DEW_DROP.lowMul : 1)) this.dropItem('dew', e.x, e.y);
		if (e.type === TYPE_INDEX.brute && this.time >= this.nextMagnetT) {
			this.nextMagnetT = this.time + MAGNET_ITEM_EVERY;
			this.dropItem('magnet', e.x, e.y + 10);
		}
		const bi = this.bosses.indexOf(e);
		if (bi >= 0) {
			this.bosses.splice(bi, 1);
			if (e.finLord) {
				// The finale Lord leaves no chest: the run ends at the end of this tick (step()).
				this.runLog?.bossKilled(this, e);
				this.bossKills++;
				this.fin.killed = { pid: h?.pid ?? null, name: h?.name ?? null, t: this.time };
				this.fx.push(['lorddie', h?.pid ?? 0, Math.round(e.x), Math.round(e.y)]);
			} else if (!this.bosses.some((o) => o.group === e.group)) {
				this.fx.push(['chest', Math.round(e.x), Math.round(e.y)]);
				this.runLog?.bossKilled(this, e);
				this.bossKills++;
				// Every hero, downed too: team xp keeps a downed ally level with the rest, chests do the same (v18.1).
				for (const p of this.heroes.values()) this.grantOffer(p, false, CHEST_FLOOR.boss, true);
			}
		}
	}

	// v23: the best kill streak — most kills within STREAK_WINDOW seconds (a queue of kill times with a moving head).
	countStreak(h) {
		const q = h.kq, t = this.time;
		q.push(t);
		while (q[h.kqi] < t - STREAK_WINDOW) h.kqi++;
		const n = q.length - h.kqi;
		if (n > h.bestStreak[0]) h.bestStreak = [n, t];
		if (h.kqi > 256) {
			q.splice(0, h.kqi);
			h.kqi = 0;
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
		if (b.src === SRC.bomb && b.owner.mods.ashHops > 0) {
			// Петарда + Пепельная печать: a burning zone of its own (not the owner's trail), drawn as fire; its ticks wake no perks.
			this.addPatch(b.owner, b.x, b.y, b.r * 0.7, 1.6, b.edmg * 0.15, 0.4, SRC_ASH_ZONE, b.edmg * 0.1, 'ash', 12);
		}
		const near = this.grid.query(b.x, b.y, b.r + MAX_ENEMY_R, []);
		for (const e of near) {
			const rr = b.r + e.r * 0.5;
			if (e.dead || e === b.skip || dist2(e.x, e.y, b.x, b.y) >= rr * rr) continue;
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
					this.hurtEnemy(e, e.boss || e.elite || e.def.special ? e.maxHp * ITEMS.cracker.bigFrac : e.hp + 1, h, SRC_CRACKER);
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
				h.bans++;
				if (h.offer) this.sendOffer(h);
				break;
			case 'chest':
				// Shared like a boss chest: elites do not multiply with players, so every hero (downed too) gets an offer,
				// the one who opened it with the boost (v18.1).
				this.fx.push(['open', h.pid, Math.round(it.x), Math.round(it.y)]);
				for (const o of this.heroes.values()) this.grantOffer(o, o === h, CHEST_FLOOR.elite);
				break;
			case 'star':
				this.events.starShard();
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
		const fog = this.events.active?.id === 'fog';
		this.updateBuffs(alive);
		for (const h of alive) {
			if (h.st !== 0) continue;
			if(h.sharedWard && h.sharedWard.until <= now) { h.sharedWard=null; h.ward=Math.max(0,h.ward-1); }
			h.iframes = Math.max(0, h.iframes - dt);
			if (h.mods.regen > 0) h.hp = Math.min(h.maxHp, h.hp + h.mods.regen * dt);

			const from = h.dashPath ?? h;
			this.grid.query((h.x + from.x) / 2, (h.y + from.y) / 2, PLAYER_RADIUS + MAX_ENEMY_R + Math.hypot(h.x - from.x, h.y - from.y) / 2, near);
			for (const e of near) {
				if (e.dead || ((e.outpost || e.caravan) && e.guardReadyAt > now)) continue;
				const min = e.r + PLAYER_RADIUS;
				if (segmentDistance2(e.x, e.y, from.x, from.y, h.x, h.y) >= min * min) continue;
				if (e.ai === 'exploder') {
					if (e.fuseT <= 0) {
						e.fuseT = e.def.fuse;
						e.fuseBy = null;
					}
					continue;
				}
				if (h.iframes > 0 || e.dmg <= 0 || e.frozenT > now || e.immuneT > now) continue;
				const cd = (e.steamT > now && this.inSteam(e) ? e.dmg * REACT.steamContact : e.dmg) * (fog && this.events.inFog(e) ? FOG_DEF.dmgMul : 1);
				const braced = this.time - h.movedT >= 0.45 ? Math.min(0.55, h.mods.brace) : 0;
				this.hurtPlayer(h, cd * (1 - braced), e.caravan ? 'caravan' : e.outpost ? 'outpost' : e.elite ? 'elite' : e.finLord && e.bs === 'dash' ? 'boss:dash' : enemyKey(e));
				if (h.st !== 0) break;
			}
			if (h.st !== 0) continue;
			this.breakAround(h.x, h.y, PLAYER_RADIUS, h);
			for (const [id, w] of h.weapons) this.updateWeapon(h, id, w, dt);
			if (h.hero === 'ranger' && !h.offline) scoutKnife(this, h);
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

	healSupport(owner, target, amount, field = false) { return healSupport(this, owner, target, amount, field); }

	hurtPlayer(h, dmg, from = 'other') {
		const prevented = Math.min(h.hp, Math.max(1, dmg * (h.altarCurseT > this.time ? ALTAR_DEALS[1].takenMul : 1) * h.trait.dmgTaken - h.mods.armor - h.guard));
		if (h.ward > 0) {
			(h.sharedWard?.owner ?? h).support.blocked += prevented;
			this.wardAbsorb(h);
			return;
		}
		if (blockHeroHit(this, h)) { h.support.blocked += prevented; return; }
		const guard = h.guard;
		h.guard = 0;
		if (h.altarCurseT > this.time) dmg *= ALTAR_DEALS[1].takenMul;
		const lost = Math.min(h.hp, Math.max(1, dmg * h.trait.dmgTaken - h.mods.armor - guard));
		h.hp -= lost;
		this.runLog?.hurt(this, h, lost, from);
		h.iframes = PLAYER_IFRAMES;
		this.fx.push(['hurt', h.pid]);
		if (h.hp <= 0) {
			h.hp = 0;
			h.st = 1;
			h.rev = 0;
			h.downT = this.time;
			this.fx.push(['down', h.pid]);
			this.events.onDown(h);
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

	weaponSource(h, src) {
		const context = this.weaponContext;
		if (!context || context.h !== h || src.weapon !== context.part || src.lineage || src.react || src.raw) return src;
		return { ...src, weapon: context.weapon, component: context.part, scale: context.scale, lineage: true };
	}

	updateWeapon(h, id, w, dt) {
		if (DUOS[id]) {
			w.parts ??= DUOS[id].parts.map((part) => ({ id: part, lvl: duoPartLevel(w.lvl), t: 0.2 }));
			const previous = this.weaponContext;
			try {
				for (const part of w.parts) part.lvl = Math.max(part.lvl, duoPartLevel(w.lvl));
				this.weaponContext = { h, weapon: id, part: id,
					scale: (DUOS[id].signaturePower ?? DUO_SIGNATURE_POWER) * duoLineagePower(w.lvl, w.parts) };
				if (h.hero === 'witch' && !h.offline && this.time >= h.perk.readyAt && w.t <= dt && canRepeatCast(id)) repeatCast(this, h, id, w, dt);
				else this.castWeapon(h, id, w, dt);
			} finally { this.weaponContext = previous; }
			return;
		}
		if (h.hero === 'witch' && !h.offline && this.time >= h.perk.readyAt && w.t <= dt && canRepeatCast(id)) {
			repeatCast(this, h, id, w, dt);
			return;
		}
		this.castWeapon(h, id, w, dt);
	}

	castWeapon(h, id, w, dt, damageScale = 1) {
		const L = attackLevel(id, w.lvl, w.oc, h.mods, w.parts);
		const oc = overclockId(id, w.oc);
		const { cdMul, areaMul, amount, durMul } = h.mods;
		const dmgMul = h.mods.dmgMul * damageScale;
		const src = this.weaponSource(h, SRC[id]);
		if (DUOS[id]?.effect) {
			if (L.charges) this.wardTick(h, w, L, dt);
			w.castT = (w.castT ?? 0) - dt;
			if (w.castT <= 0) w.castT = castConfluence(this, h, L, src, DUOS[id].effect) ? L.castCd * cdMul : 0.15;
			return;
		}
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
			case 'guide':
				this.guideTick(h, w, L, dt);
				return;
			case 'glow':
				w.t -= dt;
				if (w.t <= 0) w.t = this.glowTick(h, L) ? L.tick : 0.2;
				return;
			case 'dome':
				this.wardTick(h, w, L, dt);
				w.a = (w.a ?? 0.2) - dt;
				if (w.a <= 0) {
					w.a = L.tick;
					this.domeTick(h, L);
				}
				return;
			case 'riposte':
				this.wardTick(h, w, L, dt);
				w.a = (w.a ?? 0.3) - dt;
				if (w.a <= 0) w.a = this.riposteSwing(h, L) ? L.atkCd * cdMul : 0.1;
				return;
			case 'rod':
				this.wardTick(h, w, L, dt);
				w.a = (w.a ?? 0.3) - dt;
				if (w.a <= 0) w.a = this.rodStrikes(h, L) ? L.atkCd * cdMul : 0.2;
				return;
			case 'whirlwind':
				this.whirlwindTick(h, w, L, dt);
				return;
			case 'pitch':
				w.t -= dt;
				if (w.t <= 0) w.t = this.pitchTick(h, L) ? L.every : 0.05;
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
					this.auroraPulse(h, L, 1);
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
			case 'prism':
				w.t = this.prismAttack(h, L, dmg, src) ? L.cd * cdMul : 0.2;
				return;
			case 'tuning':
				w.t = this.tuningWave(h, L, dmg, src) ? L.cd * cdMul : 0.2;
				return;
			case 'anchor':
				w.t = this.anchorPull(h, L, dmg, src) ? L.cd * cdMul : 0.2;
				return;
			case 'bolt':
			case 'swarm': {
				const count = L.count + amount;
				const targets = this.nearestEnemies(h.x, h.y, count, BOLT_RANGE);
				if (!targets.length) {
					w.t = 0.1;
					return;
				}
				if (oc === 'ball') {
					// One big slow spark carries the damage of the whole volley and keeps seeking after every hit.
					const t = targets[0];
					this.addProjectile(h, 'bolt', Math.atan2(t.y - h.y, t.x - h.x), L.speed * 0.7, dmg * count * 0.34, L.pierce + 4, 3, t, 0, { src, r: 13, seek: true, big: 1 });
					w.t = L.cd * cdMul;
					return;
				}
				if (oc === 'ring') {
					const n = count * 2;
					w.rot = (w.rot ?? 0) + 0.4;
					for (let i = 0; i < n; i++) this.addProjectile(h, 'bolt', w.rot + (i * Math.PI * 2) / n, L.speed, dmg * 0.75, L.pierce, 1.2, null, 0, { src });
					w.t = L.cd * cdMul;
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
					this.addProjectile(h, 'knife', base + (i - (count - 1) / 2) * L.spread, L.speed, dmg, L.pierce, oc === 'fan' ? 0.5 : 1.1, null, 0, { seek: oc === 'ricochet' });
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
					const a = oc === 'whirl' ? (w.rot ?? 0) + (i * Math.PI * 2) / count : Math.atan2(t.y - h.y, t.x - h.x) + spread;
					const speed = L.speed * h.mods.speedMul; // Серп + Лёгкость
					const trail = w.imprint === 'frost' ? { acc: 0, every: 0.11, r: 24, life: 1.6, slow: 0.3 } : null;
					this.addProjectile(h, 'sickle', a, speed, dmg, Infinity, (range / speed) * 2 + 1.5, null, range / speed, { trail, returnTrail: !!trail });
				}
				if (oc === 'whirl') w.rot = (w.rot ?? 0) + 0.5;
				w.t = L.cd * cdMul;
				return;
			}
			case 'whip': {
				const range = L.range * areaMul, width = L.width * areaMul;
				const target = this.nearestEnemies(h.x, h.y, 1, range + width)[0];
				const dir = target ? (target.x >= h.x ? 1 : -1) : (h.fx >= 0 ? 1 : -1);
				this.slash(h, dir, range, width, dmg);
				if (L.both) this.slash(h, -dir, range, width, dmg);
				if (oc === 'twin') {
					const equipped = h.weapons.get(id);
					this.after(0.25, () => {
						if (h.st !== 0 || h.weapons.get('whip') !== equipped) return;
						const t2 = this.nearestEnemies(h.x, h.y, 1, range + width)[0];
						const d2 = t2 ? (t2.x >= h.x ? 1 : -1) : dir;
						this.slash(h, d2, range, width, dmg);
						this.slash(h, -d2, range, width, dmg);
					});
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'aura':
			case 'tocsin': {
				const r = L.radius * areaMul;
				if (L.heal) {
					for (const o of this.heroes.values()) {
						if (o !== h && o.st === 0 && dist2(o.x, o.y, h.x, h.y) < r * r) this.healSupport(h, o, L.heal * L.tick, true);
					}
				}
				const near = this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2);
				const chill = h.passives.has('frostcore'); // Ореол + Ледяное сердце
				for (const e of near) {
					const rr = r + e.r * 0.5;
					if (e.dead || dist2(e.x, e.y, h.x, h.y) >= rr * rr) continue;
					let heat = 1;
					if (id === 'aura') {
						const key = h.pid + ':' + src.weapon;
						const prev = e.auraContact?.[key];
						const held = prev && this.time - prev.last <= L.tick + 0.15 ? Math.min(2, prev.held + this.time - prev.last) : 0;
						(e.auraContact ??= {})[key] = { held, last: this.time };
						heat += held * 0.25;
						if (held >= 2 && !(e.heatFxT > this.time)) {
							e.heatFxT = this.time + 0.7;
							this.fx.push(['buildring', Math.round(e.x), Math.round(e.y), 22, 3]);
						}
					}
					this.hurtEnemy(e, dmg * heat, h, src);
					if (chill && !e.dead) this.slowEnemy(e, AURA_CHILL, L.tick + 0.2, h);
				}
				this.breakAround(h.x, h.y, r, h);
				if (oc === 'pulse') this.fx.push(['apulse', h.pid, Math.round(r)]);
				w.t = L.tick;
				return;
			}
			case 'frost': {
				const target = this.densestPoints(h, 1, L.radius * areaMul)[0];
				if (!target) { w.t = 0.2; return; }
				const a = Math.atan2(target.y - h.y, target.x - h.x);
				const wave = { owner: h, x: h.x, y: h.y, dx: Math.cos(a), dy: Math.sin(a), distance: 0,
					range: L.radius * areaMul, width: L.width * areaMul, speed: 420, dmg, src, hit: new Set(),
					slow: L.slow, dur: L.dur * durMul, freeze: L.freeze * h.mods.ctrlMul * durMul };
				this.coldWaves.push(wave);
				this.fx.push(['coldwave', Math.round(h.x), Math.round(h.y), round3(a), Math.round(wave.range), Math.round(wave.width), wave.speed]);
				if (w.imprint === 'sickle') for (const off of [-0.55, 0, 0.55])
					this.addProjectile(h, 'sickle', a + off, 320, dmg * 0.55, Infinity, 1.7, null, 0.46, { src });
				w.t = L.cd * cdMul;
				return;
			}
			case 'bomb':
			case 'molotov':
			case 'icebomb': {
				const lobKind = id === 'bomb' ? 0 : id === 'molotov' ? 1 : 2;
				// Overclocks: «Большой заряд» — one bomb (Echo widens it), «Кассета» — every bomb in a cross around one point.
				const n = oc === 'big' ? 1 : L.count + amount;
				const cross = oc === 'big' ? 0 : oc === 'cluster' ? n - 1 : id === 'bomb' && amount >= 2 ? amount : 0; // Петарда + Эхо
				const bigMul = oc === 'big' ? 1 + 0.1 * amount : 1;
				const thrown = this.throwBombs(h, n, L.fuse, lobKind, (x, y) => ({
					x, y, r: L.radius * areaMul * bigMul, pdmg: 0, edmg: dmg, owner: h, src, burn: id === 'bomb' ? BOMB_BURN : null,
					kind: lobKind === 0 ? 0 : lobKind === 1 ? 6 : 4,
					then: lobKind === 1 ? (b) => this.firePool(h, b, L, damageScale) : lobKind === 2 ? (b) => this.iceBurst(h, b, L) : null,
				}), cross);
				w.t = thrown ? L.cd * cdMul : 0.2;
				return;
			}
			case 'traps': {
				const target = this.nearestEnemies(h.x, h.y, 1, 260)[0];
				const d = target ? Math.hypot(target.x - h.x, target.y - h.y) || 1 : 1;
				const reach = Math.min(120, d * 0.7);
				const o = { r: L.radius * areaMul, dmg, root: L.root * h.mods.ctrlMul * durMul, splash: L.splash * areaMul, max: L.max, src, shards: oc === 'shards', uses: 2, rearm: 1.8 * cdMul, rootTargets: 2 + Math.floor(w.lvl / 2),
					...(target ? { x: h.x + (target.x - h.x) / d * reach, y: h.y + (target.y - h.y) / d * reach } : {}) }; // + Песочные часы
				if (oc === 'circle') {
					w.rot = (w.rot ?? 0) + 0.7;
					for (let k = 0; k < 3; k++) this.layTrap(h, { ...o, x: h.x + Math.cos(w.rot + k * 2.094) * 64, y: h.y + Math.sin(w.rot + k * 2.094) * 64 });
				} else this.layTrap(h, o);
				w.t = L.cd * cdMul;
				return;
			}
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
				if (big) this.thunderFan(h, L, range, src, dmgMul);
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
						r: L.radius * areaMul, dmg, tick: L.tick, t: L.tick, boom: L.boom * dmgMul, boomR: L.boomR * areaMul, zap: (L.zap ?? 0) * dmgMul, src, aimT: ORB_AIM_EVERY,
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
			case 'frostsnare':
				this.layTrap(h, {
					r: L.radius * areaMul, dmg, root: L.root * h.mods.ctrlMul * durMul, max: L.max, src,
					frost: { r: L.waveR * areaMul, dmg: L.waveDmg * dmgMul, slow: L.slow, dur: L.slowDur * durMul, freeze: L.freeze * h.mods.ctrlMul * durMul },
				});
				w.t = L.cd * cdMul;
				return;
			case 'abatis':
				w.t = this.abatisSwing(h, L) ? L.cd * cdMul : 0.1;
				return;
			case 'harpoon': {
				const t = this.toughest(h, L.range * areaMul + 60);
				if (!t) {
					w.t = 0.2;
					return;
				}
				const a = Math.atan2(t.y - h.y, t.x - h.x), n = L.count + amount, range = L.range * areaMul;
				for (let i = 0; i < n; i++) {
					this.addProjectile(h, 'spear', a + (i - (n - 1) / 2) * 0.14, L.speed, dmg, L.pierce, (range / L.speed) * 2 + 1.2, null, range / L.speed, { src, kb: L.kb, r: L.width / 2 });
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'rockets': {
				const pts = this.densestPoints(h, L.count + amount, 420);
				if (!pts.length) {
					w.t = 0.2;
					return;
				}
				for (const p of pts) {
					const t = this.nearestEnemies(p.x, p.y, 1, 120)[0] ?? null;
					this.addProjectile(h, 'bolt', Math.atan2(p.y - h.y, p.x - h.x), L.speed, dmg, 1, 2.5, t, 0, {
						src, boom: { r: L.radius * areaMul, burn: L.burn },
					});
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'stingers': {
				const count = L.count + amount;
				const target = this.nearestEnemies(h.x, h.y, 1, KNIFE_AIM_RANGE)[0];
				const base = target ? Math.atan2(target.y - h.y, target.x - h.x) : Math.atan2(h.fy, h.fx);
				const drop = { r: L.dropR * areaMul, life: L.dropLife * durMul, dmg: L.dropDmg * dmgMul, tick: L.tick, max: L.max };
				for (let i = 0; i < count; i++) {
					this.addProjectile(h, 'knife', base + (i - (count - 1) / 2) * L.spread, L.speed, dmg, L.pierce, 1.1, null, 0, { src, drop });
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'firescythe': {
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
					const speed = L.speed * h.mods.speedMul;
					this.addProjectile(h, 'sickle', a, speed, dmg, Infinity, (range / speed) * 2 + 1.5, null, range / speed, {
						src, burnHit: L.burn,
						fire: { every: L.every, acc: L.every, r: L.patchR * areaMul, life: L.patchLife * durMul, dmg: L.patchDmg * dmgMul, tick: L.tick, burn: L.burn },
					});
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
					if (!e.dead) this.slowEnemy(e, L.slow, L.tick + 0.2, h);
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
				if (id === 'tempest' || oc === 'near') cand.sort((a, b) => dist2(a.x, a.y, h.x, h.y) - dist2(b.x, b.y, h.x, h.y)); // the first strike hits the nearest
				for (let s = 0; s < L.strikes + amount && cand.length; s++) {
					const idx = id === 'tempest' && s === 0 ? 0 : Math.floor(Math.random() * cand.length);
					let t = cand[idx];
					if (oc === 'near') t = cand.shift();
					else {
						cand[idx] = cand[cand.length - 1];
						cand.pop();
					}
					this.fx.push(['zap', Math.round(t.x), Math.round(t.y - 320), Math.round(t.x), Math.round(t.y)]);
					const hit = [t];
					if (s === 0 && w.imprint === 'flask') {
						this.puddles.push({ id: this.nextId++, owner: h, x: t.x, y: t.y, r: 72 * areaMul, life: 2.4,
							dmg: dmg * 0.12, tick: 0.5, t: 0, wet: true, src: SRC.flask });
					}
					this.hurtEnemy(t, dmg, h, src);
					if (!t.dead && h.mods.burnDps > 0) this.burn(t, h, h.mods.burnDps * damageScale, LIGHTNING_EMBER_BURN); // Гроза + Уголёк
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
					if (oc === 'blast') this.explode({ x: t.x, y: t.y, r: 70 * areaMul, pdmg: 0, edmg: dmg * 0.5, owner: h, kind: 0, src });
				}
				w.t = L.cd * cdMul;
				return;
			}
			case 'lantern':
				w.t = this.lanternTick(h, L, src) ? L.tick : 0.2;
				return;
			case 'trail':
			case 'firepath':
				w.t = this.trailTick(h, L, src, w, damageScale) ? L.every : 0.05;
				return;
			case 'spear':
			case 'volley':
			case 'sunspear':
			case 'banner': {
				const t = this.toughest(h, SPEAR_RANGE);
				if (!t) {
					w.t = 0.2;
					return;
				}
				const a = Math.atan2(t.y - h.y, t.x - h.x);
				const n = (L.count ?? 1) + amount;
				const bond = h.mods.bond > 0;
				const fly = SPEAR_RANGE / L.speed;
				for (let i = 0; i < n; i++) {
					this.addProjectile(h, 'spear', a + (i - (n - 1) / 2) * 0.12, L.speed, dmg, L.pierce, oc === 'back' ? fly * 2 + 1 : fly + 0.25, null, oc === 'back' ? fly * 0.8 : 0, {
						src, kb: L.kb, r: L.width / 2, bond,
						caltrop: oc === 'caltrop' ? { every: 90, acc: 45, dmg: dmg * OVR_SPIKE.frac } : null,
						shed: id === 'volley' ? { every: L.every, acc: 0, dmg: L.knifeDmg * dmgMul, speed: 560, life: 0.45 } : null,
						lane: id === 'sunspear' ? { every: L.laneR * 1.6, acc: 0, r: L.laneR * areaMul, life: L.laneLife * durMul, mark: L.mark, dmg: L.laneDmg * dmgMul, tick: L.tick } : null,
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
				const total = L.count + amount;
				const count = oc === 'lake' ? 1 : total;
				const targets = this.nearestEnemies(h.x, h.y, count, 300);
				if (oc === 'moat') w.rot = (w.rot ?? 0) + 1;
				for (let i = 0; i < count; i++) {
					let x, y;
					const t = targets[i];
					if (oc === 'moat') {
						x = h.x + Math.cos(w.rot + (i * Math.PI * 2) / count) * 70;
						y = h.y + Math.sin(w.rot + (i * Math.PI * 2) / count) * 70;
					} else if (t) {
						x = t.x;
						y = t.y;
					} else {
						const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 100;
						x = h.x + Math.cos(a) * d;
						y = h.y + Math.sin(a) * d;
					}
					const zr = L.radius * areaMul * (oc === 'lake' ? Math.sqrt(total) * 1.25 : 1);
					const z = { id: this.nextId++, owner: h, x, y, r: zr, life: L.duration * durMul, dmg, tick: L.tick, t: 0, slow: Math.max(h.trait.puddleSlow, L.slow ?? 0), wet: true, src, charged: w.imprint === 'lightning' };
					this.puddles.push(z);
					if (z.slow > 0) this.fx.push(['slowz', z.id]);
				}
				w.t = L.cd * cdMul;
				return;
			}
		}
	}

	updateColdWaves(dt) {
		let n = 0;
		for (const wave of this.coldWaves) {
			const from = wave.distance;
			wave.distance = Math.min(wave.range, from + wave.speed * dt);
			const middle = (from + wave.distance) / 2;
			const x = wave.x + wave.dx * middle, y = wave.y + wave.dy * middle;
			for (const e of this.grid.query(x, y, wave.width + wave.speed * dt + MAX_ENEMY_R, [])) {
				if (e.dead || wave.hit.has(e)) continue;
				const ex = e.x - wave.x, ey = e.y - wave.y;
				const along = ex * wave.dx + ey * wave.dy;
				const across = Math.abs(ex * wave.dy - ey * wave.dx);
				if (along < from - e.r || along > wave.distance + e.r || across > wave.width + e.r) continue;
				wave.hit.add(e);
				this.hurtEnemy(e, wave.dmg, wave.owner, wave.src);
				if (e.dead) continue;
				this.slowEnemy(e, wave.slow, wave.dur, wave.owner);
				if (!e.boss && wave.freeze > 0) this.freeze(e, wave.freeze, wave.owner);
				if (wave.resonance) { e.resonanceT = this.time + wave.dur; e.resonancePower = wave.resonance; }
			}
			if (wave.distance < wave.range) this.coldWaves[n++] = wave;
		}
		this.coldWaves.length = n;
	}

	prismAttack(h, L, dmg, src) {
		const target = this.nearestEnemies(h.x, h.y, 1, L.range)[0];
		if (!target) return false;
		const x = target.x, y = target.y;
		const angle = Math.atan2(y - h.y, x - h.x);
		const fx = (x1, y1, x2, y2) => this.fx.push(['buildbeam', Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)]);
		fx(h.x, h.y, x, y);
		this.hurtEnemy(target, dmg, h, src);
		const seen = new Set([target]);
		const lens = Math.min(0.65, h.mods.piercePower);
		const reach = L.range * 0.65;
		const nearby = this.grid.query(x, y, reach + MAX_ENEMY_R, []);
		for (const turn of lens ? [-0.48, 0, 0.48] : [-0.42, 0.42]) {
			const dx = Math.cos(angle + turn), dy = Math.sin(angle + turn);
			fx(x, y, x + dx * reach, y + dy * reach);
			for (const e of nearby) {
				if (e.dead || seen.has(e)) continue;
				const ex = e.x - x, ey = e.y - y;
				const along = ex * dx + ey * dy, across = Math.abs(ex * dy - ey * dx);
				if (along <= 0 || along > reach || across > L.width * h.mods.areaMul + e.r) continue;
				seen.add(e);
				this.hurtEnemy(e, dmg * (L.branch ?? 0.58) * (1 + lens), h, src);
			}
		}
		return true;
	}

	tuningWave(h, L, dmg, src) {
		const r = L.radius * h.mods.areaMul;
		const hit = this.grid.query(h.x, h.y, r, []).filter((e) => !e.dead && dist2(e.x, e.y, h.x, h.y) <= r ** 2);
		if (!hit.length) return false;
		this.fx.push(['buildring', Math.round(h.x), Math.round(h.y), Math.round(r), 1]);
		for (const e of hit) {
			this.hurtEnemy(e, dmg, h, src);
			if (e.dead) continue;
			e.resonanceT = this.time + L.dur * h.mods.durMul;
			e.resonancePower = L.resonance ?? 1;
		}
		return true;
	}

	anchorPull(h, L, dmg, src) {
		const center = this.densestPoints(h, 1, L.range)[0];
		if (!center) return false;
		const { x, y } = center;
		const r = L.radius * h.mods.areaMul;
		this.fx.push(['buildring', Math.round(x), Math.round(y), Math.round(r), 0]);
		const hit = this.grid.query(x, y, r, []).filter((e) => !e.dead && dist2(e.x, e.y, x, y) <= r ** 2);
		let pulled = 0;
		for (const e of hit) {
			if (!e.boss && !e.elite && !e.def.special && (e.x !== x || e.y !== y)) {
				const force = Math.min(0.65, 52 / Math.max(1, Math.hypot(e.x - x, e.y - y)));
				e.x += (x - e.x) * force;
				e.y += (y - e.y) * force;
				confineGuard(e);
				pulled++;
			}
		}
		if (pulled) this.rebuildGrid();
		for (const e of hit) this.hurtEnemy(e, dmg, h, src);
		if (pulled >= 2 && h.mods.brace > 0) {
			this.fx.push(['buildring', Math.round(x), Math.round(y), 55, 2]);
			this.splash(x, y, 55, dmg, h, { ...src, react: true }, null);
		}
		const pool = this.puddles.find((z) => z.life > 0 && z.wet && !z.anchorExtended && dist2(x, y, z.x, z.y) < z.r ** 2);
		if (pool) {
			pool.anchorExtended = true;
			pool.life += 1.6;
		}
		return true;
	}

	// --- wave 3: evolutions, new weapons, embers ---

	evoCard(h, id) {
		const E = EVOS[id];
		return {
			id, kind: 'evo', name: E.name, icon: E.icon, desc: E.desc, level: 1, from: E.from, requires: E.requires,
			fromName: WEAPONS[E.from].name, fromIcon: WEAPONS[E.from].icon, reqName: PASSIVES[E.requires].name, reqIcon: PASSIVES[E.requires].icon,
			loseOvr: this.ovrNames(h, [E.from]),
		};
	}

	// Weapon at level 5 + its artifact (any level) → evolution; null if nothing is ready or it was declined recently.
	readyEvo(h) {
		for (const [id, w] of h.weapons) {
			const evo = EVO_BY_WEAPON[id];
			if (!evo || w.imprint || w.lvl < MAX_LEVEL || !h.passives.has(EVOS[evo].requires)) continue;
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
		return this.lightCone(h, L.range * h.mods.areaMul, L.angle, L.mark, 3 * h.mods.durMul, L.dmg * h.mods.dmgMul, src,
			this.toughest(h, L.range * h.mods.areaMul)) !== null;
	}

	trailTick(h, L, src, w = {}, damageScale = 1) {
		if (this.time - h.movedT > MOVE_RECENT) return false;
		const r = L.radius * h.mods.areaMul;
		const last = w.lastTrail;
		const distance = last ? Math.hypot(h.x - last.x, h.y - last.y) : 0;
		const steps = last && distance < 500 ? Math.min(8, Math.max(1, Math.ceil(distance / r))) : 1;
		for (let i = 1; i <= steps; i++) {
			const z = { id: this.nextId++, owner: h, x: last && distance < 500 ? last.x + (h.x - last.x) * i / steps : h.x,
				y: last && distance < 500 ? last.y + (h.y - last.y) * i / steps : h.y, r, life: L.dur * h.mods.durMul,
				dmg: L.dmg * h.mods.dmgMul * damageScale, tick: L.tick, t: 0, src, burn: L.burn * damageScale,
				burnDur: 3.5, trail: true, baseTrail: true };
			this.puddles.push(z);
			this.fx.push(['zk', z.id, 1]);
		}
		w.lastTrail = { x: h.x, y: h.y };
		trimOwned(this.puddles, h, L.max ?? TRAIL_MAX, p => p.trail && fieldSource(p.src) === fieldSource(src));
		return true;
	}

	wardBash(h, w, L, dt, src = SRC.ward) {
		// Independent offensive clock: it never grants extra charges or changes the knight's passive.
		if (h.ward > 0 && L.burstDmg) {
			w.bashT = (w.bashT ?? 0) - dt;
			if (w.bashT <= 0) {
				w.bashT = 3 * h.mods.cdMul;
				const e = this.nearestEnemies(h.x, h.y, 1, 180 * h.mods.areaMul)[0];
				if (e) {
					this.hurtEnemy(e, L.burstDmg * 0.7 * h.mods.dmgMul, h, src);
					if (!e.dead && !e.boss) this.knock(e, h.x, h.y, 20);
					this.fx.push(['buildbeam', Math.round(h.x), Math.round(h.y), Math.round(e.x), Math.round(e.y)]);
				}
			}
		}
	}

	// Ward / Bastion: charges refill one per cd; a full shield starts the run full.
	wardTick(h, w, L, dt) {
		h.wardMax = L.charges + h.mods.amount;
		if (h.ward > h.wardMax && w.init) h.ward = h.wardMax;
		if (!w.init) {
			w.init = true;
			h.ward = h.wardMax;
			w.t = L.cd * h.mods.cdMul;
		}
		if (!DUOS[this.weaponContext?.weapon]) this.wardBash(h, w, L, dt, h.weapons.has('bastion') ? SRC.bastion : SRC.ward);
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
		if(h.sharedWard) {
			h.sharedWard = null; h.ward--; h.iframes = PLAYER_IFRAMES;
			this.fx.push(['ward', h.pid, h.ward]); return;
		}
		const id = [...h.weapons.keys()].find((k) => k === 'bastion' || DUOS[k]?.parts.includes('ward')) ?? 'ward';
		const w = h.weapons.get(id);
		const L = attackLevel(id, w?.lvl ?? 1, w?.oc, h.mods, w?.parts);
		h.ward--;
		if (h.mods.brace > 0) h.blockCharge = Math.min(3, h.blockCharge + 1);
		h.iframes = PLAYER_IFRAMES;
		this.fx.push(['ward', h.pid, h.ward]);

		if (DUOS[id]?.effect === 'sonicShield') {
			this.tuningWave(h, L, L.dmg * 1.8 * h.mods.dmgMul, SRC[id]);
			return;
		}
		if (w && h.ward < h.wardMax) w.t = Math.min(w.t, L.cd * h.mods.cdMul);
		if (id === 'phalanx') {
			this.spearRing(h, L);
			return;
		}
		if (id === 'dome') {
			this.explode({ x: h.x, y: h.y, r: L.burstR * h.mods.areaMul, pdmg: 0, edmg: L.burstDmg * h.mods.dmgMul, owner: h, kind: 7, src: SRC.dome, kb: L.kb });
			return;
		}
		if (id === 'riposte') {
			this.riposteAnswer(h, L);
			return;
		}
		if (id === 'rod') {
			const t = this.nearestEnemies(h.x, h.y, 1, 260)[0];
			if (t) this.strikeAt(h, t, L.counter * h.mods.dmgMul, L.counterChain + h.trait.chainBonus, SRC.rod);
			return;
		}
		if (id === 'ward' || id === 'bastion' || h.ward <= 0 || overclockId(id, w?.oc) === 'thorns') {
			this.explode({ x: h.x, y: h.y, r: L.burstR * h.mods.areaMul, pdmg: 0, edmg: L.burstDmg * h.mods.dmgMul, owner: h, kind: 7, src: SRC[id], kb: L.kb });
		}
		if (id === 'bastion') {
			for (const o of this.heroes.values()) {
				if (o === h || o.st !== 0 || o.offline || o.sharedWard || o.ward >= Math.max(o.wardMax, 1) || dist2(o.x, o.y, h.x, h.y) > L.share * L.share) continue;
				o.ward++; o.sharedWard = { owner: h, until: this.time + 8 };
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
			tick: L.tick, t: 0, src: this.weaponSource(h, SRC.firewheel), trail: true,
		};
		this.puddles.push(z);
		this.fx.push(['zk', z.id, 1]);
		trimOwned(this.puddles, h, TRAIL_MAX, p => p.trail && fieldSource(p.src) === fieldSource(z.src));
	}

	// Enemies inside a cone; marks them. Returns {dir, list} or null when no target.
	lightCone(h, range, angleDeg, mark, markDur, dmg, src, priority = null) {
		const pt = priority ?? this.densestPoints(h, 1, range)[0];
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
			if (e.markT <= this.time || mark >= e.markMul) {
				e.markMul = mark;
				e.markT = this.time + markDur;
				e.markOwner = h;
			}
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
			if (e.markT <= this.time || L.mark > e.markMul) { e.markMul = L.mark; e.markOwner = h; }
			e.markT = this.time + L.markDur;
			e.beaconT = e.markT;
			if ((e.oh?.[key] ?? 0) > this.time) continue;
			(e.oh ??= {})[key] = this.time + 0.5;
			this.hurtEnemy(e, L.dmg * h.mods.dmgMul, h, SRC.beacon);
		}
	}

	// --- v24 duos (связки v2) ---

	// Путеводный огонь: the cone marks a group; sparks fly only at marked enemies and stretch the mark.
	guideTick(h, w, L, dt) {
		const { dmgMul, areaMul, amount, cdMul } = h.mods;
		w.t -= dt;
		if (w.t <= 0) {
			const c = this.lightCone(h, L.range * areaMul, L.angle, L.mark, L.tick + 0.3, L.dmg * dmgMul, SRC.guide);
			w.t = c ? L.tick : 0.2;
			if (c) {
				w.cone = c.list;
				for (const e of c.list) e.lightBy = h;
			}
		}
		w.s = (w.s ?? 0.3) - dt;
		if (w.s > 0) return;
		const cand = (w.cone ?? []).filter((e) => !e.dead && e.markT > this.time);
		if (!cand.length) {
			w.s = 0.1;
			return;
		}
		cand.sort((a, b) => dist2(a.x, a.y, h.x, h.y) - dist2(b.x, b.y, h.x, h.y));
		const n = L.count + amount;
		for (let i = 0; i < n; i++) {
			const t = cand[i % cand.length];
			const a = Math.atan2(t.y - h.y, t.x - h.x) + (i - (n - 1) / 2) * 0.2;
			this.addProjectile(h, 'bolt', a, L.speed, L.sparkDmg * dmgMul, L.pierce, 2.5, t, 0, { src: SRC.guide, markExt: 1 });
		}
		w.s = L.sparkCd * cdMul;
	}

	// Зарево: the cone marks and ignites.
	glowTick(h, L) {
		const c = this.lightCone(h, L.range * h.mods.areaMul, L.angle, L.mark, L.tick + 0.3, L.dmg * h.mods.dmgMul, SRC.glow);
		if (!c) return false;
		for (const e of c.list) {
			e.lightBy = h;
			if (!e.dead) this.burn(e, h, L.burn, 2);
		}
		return true;
	}

	// A marked enemy lit by Путеводный огонь or Зарево dies: sparks into neighbours or a burning patch.
	lightDeath(e) {
		const h = e.lightBy;
		if (!this.heroes.has(h.pid)) return;
		const gw = h.weapons.get('guide');
		if (gw && this.lightBudget > 0) {
			const L = attackLevel('guide', gw.lvl, gw.oc, h.mods);
			const exclude = [e];
			for (let i = 0; i < L.deathSparks && this.lightBudget > 0; i++, this.lightBudget--) {
				const t = this.nearestFrom(e, exclude, 260);
				if (!t) break;
				exclude.push(t);
				this.addProjectile(h, 'bolt', Math.atan2(t.y - e.y, t.x - e.x), L.speed, L.sparkDmg * 0.5 * h.mods.dmgMul, 1, 1.0, t, 0, { x: e.x, y: e.y, src: SRC.guide });
			}
		}
		const lw = h.weapons.get('glow');
		if (lw && e.burnT > this.time && this.lightBudget > 0) {
			this.lightBudget--;
			const L = attackLevel('glow', lw.lvl, lw.oc, h.mods);
			this.addPatch(h, e.x, e.y, L.patchR * h.mods.areaMul, L.patchLife * h.mods.durMul, L.patchDmg * h.mods.dmgMul, L.patchTick, SRC.glow, 0, 'glowp', 12);
		}
	}

	// A burning patch of a duo (zk 1); at most `max` of this `tag` per player, the oldest goes.
	addPatch(h, x, y, r, life, dmg, tick, src, burn, tag, max, extra = null) {
		const z = { id: this.nextId++, owner: h, x, y, r, life, dmg, tick, t: 0, src: this.weaponSource(h, src), burn, tag, ...extra };
		this.puddles.push(z);
		const zk = extra?.zk ?? (extra?.mark ? 3 : 1);
		if (zk) this.fx.push(['zk', z.id, zk]);
		let mine = 0;
		for (const p of this.puddles) if (p.owner === h && p.tag === tag) mine++;
		if (mine > max) this.puddles.splice(this.puddles.findIndex((p) => p.owner === h && p.tag === tag), 1);
		return z;
	}

	// Солнечное копьё: a lane of light behind the spear marks everyone in it.
	dropLane(p, dt) {
		const l = p.lane;
		l.acc += p.speed * dt;
		if (l.acc < l.every) return;
		l.acc -= l.every;
		this.addPatch(p.owner, p.x, p.y, l.r, l.life, l.dmg, l.tick, p.src, 0, 'lane', 60, { mark: l.mark });
	}

	// Огненный серп: a burning strip along the whole flight, both ways.
	dropFire(p, dt) {
		const f = p.fire;
		f.acc += p.speed * dt;
		if (f.acc < f.every) return;
		f.acc -= f.every;
		this.addPatch(p.owner, p.x, p.y, f.r, f.life, f.dmg, f.tick, p.src, f.burn, 'scythe', 48);
	}

	// Купол: an aura that is wider and stronger while the shield holds a charge.
	domeTick(h, L) {
		const charged = h.ward > 0;
		const r = L.radius * h.mods.areaMul * (charged ? L.chargeArea : 1);
		const dmg = L.dmg * h.mods.dmgMul * (charged ? L.chargeMul : 1);
		for (const e of this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2)) {
			const rr = r + e.r * 0.5;
			if (e.dead || dist2(e.x, e.y, h.x, h.y) >= rr * rr) continue;
			this.hurtEnemy(e, dmg, h, SRC.dome);
		}
		this.breakAround(h.x, h.y, r, h);
	}

	// Контрудар: a swing to both sides.
	riposteSwing(h, L) {
		const range = L.range * h.mods.areaMul, width = L.width * h.mods.areaMul;
		const target = this.nearestEnemies(h.x, h.y, 1, range + width)[0];
		if (!target) return false;
		const dir = target.x >= h.x ? 1 : -1;
		const hit = [];
		for (const d of [dir, -dir]) {
			this.fx.push(['slash', h.pid, d, Math.round(range), Math.round(width), round3(h.x), round3(h.y), round3(this.time)]);
			this.slashHits(h, d, range, width, L.dmg * h.mods.dmgMul, SRC.riposte, hit);
			this.breakAround(h.x + (d * range) / 2, h.y, range / 2, h);
		}
		return true;
	}

	// A charge eaten by Контрудар answers with a round swing.
	riposteAnswer(h, L) {
		const r = L.ripR * h.mods.areaMul;
		this.fx.push(['crescent', h.pid, Math.round(r)]);
		for (const e of this.grid.query(h.x, h.y, r + MAX_ENEMY_R, this.q2)) {
			const rr = r + e.r * 0.5;
			if (e.dead || dist2(e.x, e.y, h.x, h.y) >= rr * rr) continue;
			this.hurtEnemy(e, L.dmg * L.ripMul * h.mods.dmgMul, h, SRC.riposte);
			if (!e.dead && !e.boss) this.knock(e, h.x, h.y, L.kb);
		}
		this.breakAround(h.x, h.y, r, h);
	}

	// Громоотвод: lightning into the enemies nearest to the hero.
	rodStrikes(h, L) {
		const near = this.nearestEnemies(h.x, h.y, L.strikes + h.mods.amount, L.radius * h.mods.areaMul);
		if (!near.length) return false;
		for (const t of near) this.strikeAt(h, t, L.dmg * h.mods.dmgMul, L.chain + h.trait.chainBonus, SRC.rod);
		return true;
	}

	// Смола: burning pitch behind a moving hero, wide pools that burn and slow.
	pitchTick(h, L) {
		if (this.time - h.movedT > MOVE_RECENT) return false;
		const z = this.addPatch(h, h.x, h.y, L.radius * h.mods.areaMul, L.dur * h.mods.durMul, L.dmg * h.mods.dmgMul, L.tick, SRC.pitch, L.burn, 'pitch', L.max);
		// Not a cold slow: with its own fire a cold slow would make «Пар» on every tick and put the burn out.
		z.drag = Math.max(L.slow, h.trait.puddleSlow);
		return true;
	}

	// Ледяные силки: a trap that goes off bursts into a cold wave (slow, freeze) around it.
	frostWave(t, src) {
		const f = t.frost;
		this.fx.push(['frost', t.owner.pid, Math.round(f.r), Math.round(t.x), Math.round(t.y)]);
		for (const e of this.grid.query(t.x, t.y, f.r + MAX_ENEMY_R, this.q2)) {
			const rr = f.r + e.r * 0.5;
			if (e.dead || dist2(e.x, e.y, t.x, t.y) >= rr * rr) continue;
			this.hurtEnemy(e, f.dmg, t.owner, src);
			if (e.dead) continue;
			this.slowEnemy(e, f.slow, f.dur, t.owner);
			if (!e.boss) this.freeze(e, f.freeze, t.owner);
		}
	}

	// Засека: a swing to both sides, rooted enemies take more; a trap at the end of each arc.
	abatisSwing(h, L) {
		const range = L.range * h.mods.areaMul, width = L.width * h.mods.areaMul;
		const target = this.nearestEnemies(h.x, h.y, 1, range + width)[0];
		if (!target) return false;
		const dir = target.x >= h.x ? 1 : -1, now = this.time;
		for (const d of [dir, -dir]) {
			this.fx.push(['slash', h.pid, d, Math.round(range), Math.round(width), round3(h.x), round3(h.y), round3(this.time)]);
			const cx = h.x + (d * range) / 2;
			const x0 = d > 0 ? h.x : h.x - range, x1 = d > 0 ? h.x + range : h.x;
			for (const e of this.grid.query(cx, h.y, range / 2 + width / 2 + MAX_ENEMY_R, this.q2)) {
				if (e.dead || e.x + e.r < x0 || e.x - e.r > x1 || Math.abs(e.y - h.y) > width / 2 + e.r) continue;
				this.hurtEnemy(e, L.dmg * h.mods.dmgMul * (e.rootT > now ? L.rootMul : 1), h, SRC.abatis);
			}
			this.breakAround(cx, h.y, range / 2, h);
		}
		const n = L.traps;
		for (let k = 0; k < n; k++) {
			const d = k % 2 === 0 ? dir : -dir;
			this.layTrap(h, {
				x: h.x + d * range * 0.9, y: h.y + (Math.random() - 0.5) * width, r: L.radius * h.mods.areaMul, dmg: L.trapDmg * h.mods.dmgMul,
				root: L.root * h.mods.ctrlMul * h.mods.durMul, max: L.max, src: SRC.abatis,
			});
		}
		return true;
	}

	// Ядовитые жала: a knife breaks into a small wet poison puddle where it hits or falls (once per knife).
	dropPoison(p, x, y) {
		p.dropped = true;
		const d = p.drop;
		this.addPatch(p.owner, x, y, d.r, d.life, d.dmg, d.tick, p.src, 0, 'sting', d.max, { wet: true, zk: 0 });
	}

	// Смерч: the aura pulls enemies toward the ring of blades (bosses and elites stay, Щитоносец at half speed).
	whirlwindTick(h, w, L, dt) {
		const { dmgMul, areaMul, amount } = h.mods;
		const R = L.radius * areaMul, ring = L.ring * areaMul;
		for (const e of this.grid.query(h.x, h.y, R + MAX_ENEMY_R, this.q2)) {
			if (e.dead || e.boss || e.elite) continue;
			const dx = h.x - e.x, dy = h.y - e.y, d = Math.hypot(dx, dy) || 1;
			if (d > R + e.r * 0.5 || d <= ring) continue;
			const step = Math.min(d - ring, L.pull * (e.ai === 'shield' ? 0.5 : 1) * dt);
			e.x += (dx / d) * step;
			e.y += (dy / d) * step;
			confineGuard(e);
		}
		this.orbitHits(h, { count: L.count, radius: L.ring, rps: L.rps, hitCd: L.hitCd, dmg: L.bladeDmg }, dmgMul, areaMul, amount, SRC.whirlwind);
		w.t -= dt;
		if (w.t > 0) return;
		w.t = L.tick;
		for (const e of this.grid.query(h.x, h.y, R + MAX_ENEMY_R, this.q2)) {
			const rr = R + e.r * 0.5;
			if (e.dead || dist2(e.x, e.y, h.x, h.y) >= rr * rr) continue;
			this.hurtEnemy(e, L.dmg * dmgMul, h, SRC.whirlwind);
		}
		this.breakAround(h.x, h.y, R, h);
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
	freeze(e, dur, owner) {
		if(e.boss || dur <= 0) return false;
		if(this.time + dur > e.frozenT && !(e.thawT > this.time && e.frozenT <= this.time)) e.frozenOwner = owner;
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
		confineGuard(e);
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
	thunderFan(h, L, range, src, dmgMul) {
		const R = range * 1.3;
		this.fx.push(['tfan', h.pid, Math.round(R)]);
		const cand = this.grid.query(h.x, h.y, R + MAX_ENEMY_R, this.q2).filter((e) => !e.dead && dist2(e.x, e.y, h.x, h.y) < R * R);
		const ang = (e) => Math.atan2(e.y - h.y, e.x - h.x);
		cand.sort((a, b) => ang(a) - ang(b));
		const dmg = L.fanDmg * dmgMul;
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

	firePool(h, b, L, damageScale) {
		const z = {
			id: this.nextId++, owner: h, x: b.x, y: b.y, r: b.r * 0.9, life: L.pool * h.mods.durMul, dmg: L.poolDmg * h.mods.dmgMul * damageScale,
			tick: L.tick, t: 0, slow: h.trait.puddleSlow, src: SRC.molotov, wet: true, burn: L.poolDmg * MOLOTOV_BURN * damageScale, burnDur: 1.5,
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
			this.freeze(e, dur, h);
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
			if (!e.dead && !e.boss && dist2(e.x, e.y, h.x, h.y) < rr * rr) this.freeze(e, dur, h);
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
			id: this.nextId++, owner: h, x, y, kind, r: o.r, dmg: o.dmg, root: o.root ?? 0, splash: o.splash ?? 0, src: o.src ? this.weaponSource(h, o.src) : o.src, shards: o.shards ?? false,
			uses: o.uses, rootTargets: o.rootTargets ?? 1, blastR: o.blastR ?? 0, kb: o.kb ?? 0, recharge: o.recharge ?? 0, burn: o.burn ?? null, rearm: o.rearm ?? 0, life: o.life ?? Infinity, armT: this.time + TRAP_ARM, frost: o.frost ?? null,
		});
		if (o.max) {
			const source = fieldSource(this.traps.at(-1).src);
			trimOwned(this.traps, h, o.max, t => t.kind === kind && fieldSource(t.src) === source);
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

	// The densest spot within `range` of (x, y): the enemy with the most neighbors among the 12 nearest.
	densestNear(x, y, range) {
		let best = null, bn = -1;
		for (const c of this.nearestEnemies(x, y, 12, range)) {
			let n = 0;
			for (const o of this.grid.query(c.x, c.y, DENSE_R, this.q3)) if (!o.dead && dist2(o.x, o.y, c.x, c.y) < DENSE_R * DENSE_R) n++;
			if (n > bn) {
				bn = n;
				best = c;
			}
		}
		return best;
	}

	// Ball lightning homes in on the densest group near it; clients get the new leg as 'orbm'.
	aimOrb(o) {
		o.aimT = ORB_AIM_EVERY;
		const c = this.densestNear(o.x, o.y, ORB_AIM_RANGE);
		if (!c || dist2(c.x, c.y, o.tx, o.ty) < ORB_AIM_MIN * ORB_AIM_MIN) return;
		o.tx = c.x;
		o.ty = c.y;
		this.fx.push(['orbm', o.id, Math.round(o.x), Math.round(o.y), Math.round(o.tx), Math.round(o.ty), o.speed, round3(o.life), round3(this.time), Math.round(o.r)]);
	}

	updateOrbs(dt) {
		if (!this.orbs.length) return;
		let j = 0;
		for (const o of this.orbs) {
			o.aimT -= dt;
			if (o.aimT <= 0) this.aimOrb(o);
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
				let zaps = 0, core = null, cd = Infinity;
				for (const e of this.grid.query(o.x, o.y, o.r + MAX_ENEMY_R, this.q1)) {
					const rr = o.r + e.r * 0.5;
					const d = dist2(e.x, e.y, o.x, o.y);
					if (e.dead || d >= rr * rr) continue;
					if (zaps++ < 3) this.fx.push(['zap', Math.round(o.x), Math.round(o.y), Math.round(e.x), Math.round(e.y)]);
					this.hurtEnemy(e, o.dmg, o.owner, o.src);
					if (!e.dead && d < cd) {
						cd = d;
						core = e;
					}
				}
				// The core discharge: the nearest enemy takes a heavy bolt, so a lone boss still melts.
				if (core && o.zap > 0) this.hurtEnemy(core, o.zap, o.owner, o.src);
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
		// Kill-triggered chains can search while an area attack is iterating q2.
		const near = this.grid.query(from.x, from.y, range, []);
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
		this.fx.push(['slash', h.pid, dir, Math.round(range), Math.round(width), round3(h.x), round3(h.y), round3(this.time)]);
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

	orbitHits(h, L, dmgMul, areaMul, amount, src = SRC.orbit) {
		src = this.weaponSource(h, src);
		// Inherited Orbit and the duo's signature ring each own one clock for all their blades.
		const key = `${h.pid}:${src.weapon}:${src.component ?? src.weapon}`;
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
			if (e.oh && (e.oh[key] ?? 0) > this.time) continue;
			const rr = (bladeR + e.r) * (bladeR + e.r);
			for (let i = 0; i < bx.length; i++) {
				if (dist2(e.x, e.y, bx[i], by[i]) < rr) {
					(e.oh ??= {})[key] = this.time + L.hitCd;
					this.hurtEnemy(e, L.dmg * dmgMul, h, src);
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
			id: this.nextId++, kind: KIND_INDEX[kind], src: this.weaponSource(h, opts.src ?? SRC[kind === 'knife' ? 'knives' : kind]), owner: h,
			x: opts.x ?? h.x, y: opts.y ?? h.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, speed, dmg, pierce, life, target,
			hit: [], outT, returns: outT > 0, spike: opts.spike ?? null, trail: opts.trail ?? null, freezeBack: opts.freezeBack ?? 0, anyHit: false,
			r: opts.r ?? PROJ_R, kb: opts.kb ?? 0, split: opts.split ?? 0, shed: opts.shed ?? null, bond: opts.bond ?? false, onEnd: opts.onEnd ?? null,
			seek: opts.seek ?? false, caltrop: opts.caltrop ?? null, returnTrail: opts.returnTrail ?? false, lane: opts.lane ?? null, fire: opts.fire ?? null,
			burnHit: opts.burnHit ?? 0, markExt: opts.markExt ?? 0, boom: opts.boom ?? null, drop: opts.drop ?? null,
		};
		this.projectiles.push(p);
		// Projectiles often live shorter than a snapshot interval, so clients simulate them from events.
		const ev = ['shot', p.id, p.kind, Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy),
			round3(life), target ? target.id : -1, round3(this.time)];
		if (outT > 0) ev.push(h.pid, round3(outT));
		else if (opts.big) ev.push(-1, 0, opts.big); // v20: a big projectile («Шаровая молния»)
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

	seekNext(p, from) {
		let best = null, bd = 260 * 260;
		for (const e of this.grid.query(from.x, from.y, 260, this.q3)) {
			if (e.dead || p.hit.includes(e.id)) continue;
			const d = dist2(from.x, from.y, e.x, e.y);
			if (d < bd) {
				bd = d;
				best = e;
			}
		}
		return best;
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
				if (p.drop && !p.dropped) this.dropPoison(p, p.x, p.y);
				this.endProjectile(p);
				continue;
			}
			if (p.trail && (!p.returnTrail || p.outT <= 0)) {
				this.iceTrail(p, dt);
				// One ring every RING_FX_EVERY s, not every trail patch (0.11 s): fx budget.
				if (p.returnTrail && p.trail.acc < dt && this.time >= (p.ringT ?? 0)) {
					p.ringT = this.time + RING_FX_EVERY;
					this.fx.push(['buildring', Math.round(p.x), Math.round(p.y), p.trail.r, 2]);
				}
			}
			if (p.shed) this.shedKnives(p, dt);
			if (p.lane) this.dropLane(p, dt);
			if (p.fire) this.dropFire(p, dt);
			if (p.caltrop && !(p.returns && p.outT <= 0)) {
				p.caltrop.acc += p.speed * dt;
				if (p.caltrop.acc >= p.caltrop.every) {
					p.caltrop.acc -= p.caltrop.every;
					this.layTrap(p.owner, { kind: 3, x: p.x, y: p.y, r: 14, dmg: p.caltrop.dmg, root: OVR_SPIKE.root, life: OVR_SPIKE.life, max: OVR_SPIKE.max, src: p.src });
				}
			}
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
					p.target = p.seek ? this.seekNext(p, p) : this.nearestEnemies(p.x, p.y, 1, 400)[0] ?? null;
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
				// «Таран» (Копейщица): her spears hit harder for every enemy already pierced.
				const ram = p.kind === KIND_INDEX.spear ? p.owner.trait.spearRam : 0;
				if (p.src === SRC.sickle && p.outT > 0 && p.owner.mods.piercePower > 0) (p.outHits ??= new Set()).add(e.id);
				const followUp = p.hit.length > 1 || (p.outT <= 0 && p.outHits?.has(e.id));
				const lens = followUp ? Math.min(0.65, p.owner.mods.piercePower) : 0;
				this.hurtEnemy(e, p.dmg * (1 + ram * (p.hit.length - 1)) * (1 + lens), p.owner, p.src);
				if (this.lastCrit && p.src === SRC.knives && !p.critPierced) { // Ножи + Острота
					p.critPierced = true;
					p.pierce++;
				}
				if (p.freezeBack > 0 && p.outT <= 0 && !e.dead && !e.boss) this.freeze(e, p.freezeBack, p.owner);
				if (p.kb && !e.dead && !e.boss && !(p.returns && p.outT <= 0)) this.knock(e, e.x - p.vx, e.y - p.vy, ram ? p.kb * p.owner.trait.spearKb : p.kb);
				if (p.split) this.splitSpark(p, e);
				if (p.burnHit && !e.dead) this.burn(e, p.owner, p.burnHit, 2);
				if (p.markExt && !e.dead && e.markT > this.time) e.markT = Math.max(e.markT, this.time + p.markExt);
				if (p.boom) {
					this.explode({ x: e.x, y: e.y, r: p.boom.r, pdmg: 0, edmg: p.dmg, owner: p.owner, kind: 0, src: p.src, burn: { frac: p.boom.burn / Math.max(1, p.dmg), dur: 2 }, skip: e });
				}
				if (p.drop && !p.dropped) this.dropPoison(p, e.x, e.y);
				if (--p.pierce <= 0) break;
				if (p.seek) {
					// Overclocks «Рикошет» and «Шаровая молния»: after a hit the projectile turns to a neighbour it has not hit yet.
					p.target = this.seekNext(p, e);
					this.fx.push(['ptgt', p.id, p.target ? p.target.id : -1, round3(this.time)]);
				} else if (p.target === e) {
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
		const near = [];
		const shards = [];
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
			const stays = t.rearm > 0 && (t.uses === undefined || t.uses > 1);
			if (t.uses > 0) t.uses--; // Растяжка: traps hold the thread net and re-arm instead of vanishing
			if (t.kind === 4) {
				// Wolf pit: a blast that roots everyone around.
				this.explode({ x: t.x, y: t.y, r: t.blastR, pdmg: 0, edmg: t.dmg, owner: t.owner, kind: 5, src });
				for (const e of this.grid.query(t.x, t.y, t.blastR + MAX_ENEMY_R, near)) {
					if (!e.dead && dist2(e.x, e.y, t.x, t.y) < (t.blastR + e.r) ** 2) this.root(e, t.root, t.owner);
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
			this.root(victim, t.root, t.owner);
			this.hurtEnemy(victim, t.dmg * (t.uses !== undefined && victim.boss ? 1.5 : 1), t.owner, src);
			if (t.frost) this.frostWave(t, src);
			if (stays) {
				t.armT = this.time + t.rearm;
				this.traps[j++] = t;
			}
			if (t.shards) shards.push(t);
			if (t.splash > 0) {
				let rooted = 1;
				for (const e of this.grid.query(t.x, t.y, t.splash + MAX_ENEMY_R, near)) {
					const rr = t.splash + e.r * 0.5;
					if (e !== victim && !e.dead && dist2(e.x, e.y, t.x, t.y) < rr * rr) {
						this.hurtEnemy(e, t.dmg * SPLASH_FRAC * (t.uses !== undefined && e.boss ? 1.5 : 1), t.owner, src);
						if (rooted++ < t.rootTargets) this.root(e, t.root, t.owner);
					}
				}
			}
		}
		this.traps.length = j;
		// «Осколки»: three spikes around a trap that went off.
		for (const t of shards) {
			const a0 = Math.random() * Math.PI * 2;
			for (let k = 0; k < 3; k++) {
				this.layTrap(t.owner, { kind: 3, x: t.x + Math.cos(a0 + k * 2.094) * 38, y: t.y + Math.sin(a0 + k * 2.094) * 38, r: 14, dmg: t.dmg * OVR_SPIKE.frac, root: OVR_SPIKE.root, life: OVR_SPIKE.life, max: OVR_SPIKE.max, src: t.src });
			}
		}
	}

	updatePuddles(dt) {
		const near = [];
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
						let entry = false;
						if (z.baseTrail) {
							const key = z.owner.pid + ':' + z.src.weapon;
							const previous = e.trailHits?.[key];
							if (previous && previous.next > this.time) continue;
							entry = !previous || this.time - previous.last > 0.6;
							(e.trailHits ??= {})[key] = { next: this.time + z.tick - 1e-8, last: this.time };
						}
						if (z.wet) {
							e.wetT = this.time + WET_HOLD;
							e.wetZ = z;
						}
						if (z.charged) {
							z.charged = false;
							this.fx.push(['zap', Math.round(e.x), Math.round(e.y - 180), Math.round(e.x), Math.round(e.y)]);
							this.hurtEnemy(e, z.dmg * 2.4, z.owner, SRC_CHARGED); // wakes no perks (DESIGN: perks only from weapon hits)
						}
						this.hurtEnemy(e, z.dmg * (entry ? 2.5 : 1), z.owner, z.src ?? (z.heal ? SRC.censer : SRC.flask));
						if (z.burn && !e.dead) this.burn(e, z.owner, z.burn, z.burnDur ?? 2);
						if (z.resonance && !e.dead) { e.resonanceT = this.time + 1; e.resonancePower = z.resonance; }
						if (z.drag && !e.dead && !e.boss) {
							e.drag = Math.max(e.dragT > this.time ? e.drag : 0, z.drag);
							e.dragT = this.time + z.tick + 0.1;
						}
						if (z.mark && !e.dead) {
							if (e.markT <= this.time || z.mark > e.markMul) { e.markMul = z.mark; e.markOwner = z.owner; }
							e.markT = Math.max(e.markT, this.time + z.tick + 0.3);
						}
					}
					this.breakAround(z.x, z.y, z.r, z.owner);
				}
			}
			if (z.heal > 0) {
				for (const o of this.heroes.values()) {
					if (o !== z.owner && o.st === 0 && dist2(o.x, o.y, z.x, z.y) < z.r * z.r) this.healSupport(z.owner, o, z.heal * dt, true);
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
			this.slowEnemy(e, z.slow, SLOW_HOLD, z.owner);
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
		xp *= this.xpMul;
		const greed = (o) => (o.altarXpT > this.time ? ALTAR_DEALS[1].xpMul : 1);
		this.addXp(h, xp * h.mods.xpMul * greed(h));
		for (const o of this.heroes.values()) if (o !== h) this.addXp(o, xp * o.mods.xpMul * greed(o));
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
			const helpers = [];
			for (const o of this.heroes.values()) {
				if (o.st === 0 && dist2(o.x, o.y, h.x, h.y) < REVIVE_RADIUS * REVIVE_RADIUS) helpers.push(o);
			}
			const helped = helpers.length > 0;
			h.rev = helped ? h.rev + rate : Math.max(0, h.rev - rate * 0.5);
			if (h.rev >= 100) {
				h.st = 0;
				h.rev = 0;
				h.hp = h.maxHp * REVIVE_HP_FRACTION;
				h.iframes = REVIVE_IFRAMES;
				h.lastPosT = this.time;
				for (const o of helpers) o.revives++;
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

	// This run's share of the hero-unlock stats (UNLOCKS) for one player; the client adds it to its totals.
	runAchievements(h, win) {
		return {
			wins: win ? 1 : 0,
			// v19: a Knight lying at the end counts up to his last down; lifted ones go on counting.
			knightBest: h.hero === 'knight' ? Math.floor(h.st === 0 ? this.time : h.downT) : 0,
			revives: h.revives,
			knifeKills: h.knifeKills,
			bosses: this.bossKills ?? 0,
			lords: this.grade === 2 ? 1 : 0,
		};
	}

	// What the finale came to, for `over` and the run log: null if the Lord never came out.
	finaleResult() {
		const f = this.fin, L = f?.lord;
		if (!L) return null;
		const total = [...L.by.values()].reduce((s, v) => s + v, 0) || 1;
		const end = f.killed?.t ?? this.time;
		return {
			killedAt: f.killed ? Math.round(end * 10) / 10 : null, sec: Math.round((end - f.fightAt) * 10) / 10,
			hpLeft: f.killed ? 0 : Math.max(0.001, round3(Math.max(0, L.hp) / L.maxHp)), lastHit: f.killed?.name ?? null,
			by: [...L.by].map(([pid, d]) => ({ pid, share: Math.round((d / total) * 100) / 100 })),
		};
	}

	// grade: 0 — the group fell, 1 — «Ночь пережита» (lived to the end), 2 — «Владыка повержен». `win` is true for both.
	finish(win, grade = win ? 1 : 0) {
		this.grade = grade;
		this.snapshot();
		this.state = 'over';
		this.paused = false;
		this.frozen = false;
		for (const h of this.heroes.values()) {
			h.offer = null;
			h.queue = 0;
		}
		const log = this.runLog?.build(this, win) ?? null;
		this.lastLog = log;
		const stats = [...this.heroes.values()].map((h) => ({
			pid: h.pid, name: h.name, hero: h.hero, kills: h.kills, dmg: Math.round(h.dmg), level: h.level, ach: this.runAchievements(h, win),
		}));
		// v22: the server keeps the totals of portal users; `tot` is a player's totals after this run.
		if (this.onRunEnd) {
			const duos = new Map([...this.heroes.values()].map((h) => [h.pid, [...h.weapons.keys()].filter((id) => DUOS[id])]));
			try {
				const tot = this.onRunEnd({ win, grade, mode: this.mode, time: Math.round(this.time), players: stats.length, stats, duos });
				for (const s of stats) if (tot?.has(s.pid)) s.tot = tot.get(s.pid);
			} catch (e) {
				console.error('run end hook', e);
			}
		}
		let card = null;
		try {
			card = this.runLog?.card(this, log) ?? null;
		} catch (e) {
			console.error('results card', e);
		}
		if (log) runStore.add(log, this.runUids, card);
		this.overMsg = {
			t: 'over', win, grade, fin: this.finaleResult(), card, time: Math.round(this.time * 10) / 10, host: this.host, mode: this.mode, len: this.runLength,
			stats,
			runId: log?.id ?? null, log,
		};
		this.broadcast(this.overMsg);
	}

	enemyState(en) {
		const t = this.time;
		let st = en.outpost || en.caravan ? ST.guard : 0;
		if (en.burnT > t) st |= ST.burn;
		if (en.resonanceT > t) st |= ST.resonance;
		if (stormMarked(en, t)) st |= ST.stormMarked;
		if (en.slowT > t) st |= ST.chill;
		if (en.frozenT > t) st |= ST.frozen;
		if (en.wetT > t) st |= ST.wet;
		if (en.markT > t) st |= ST.mark;
		if (en.rootT > t) st |= ST.root;
		if (en.elite) st |= ST.elite;
		if (en.windT > 0 || en.fuseT > 0) st |= ST.windup;
		if (en.ai === 'shield') {
			const k = Math.round((en.fa / (Math.PI * 2)) * SHIELD_DIRS);
			st |= ST.shield | ((((k % SHIELD_DIRS) + SHIELD_DIRS) % SHIELD_DIRS) << SHIELD_SHIFT);
		}
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
			// v20: an overclocked weapon gets a 4th field with the variant (1 or 2).
			[...h.weapons].map(([id, w]) => (DUOS[id] ? [id, w.lvl, h.mods.amount, id === 'orrery' ? this.orreryMask(h, w) : 0, 0, (w.parts ?? DUOS[id].parts.map((part) => ({ id: part, lvl: duoPartLevel(w.lvl) }))).map((part) => [part.id, part.lvl])]
				: w.imprint ? [id, w.lvl, h.mods.amount, w.oc ?? 0, w.imprint]
				: w.oc ? [id, w.lvl, h.mods.amount, w.oc]
				: (id === 'orbit' || id === 'windmill' || id === 'firewheel') && h.mods.amount > 0 ? [id, w.lvl, h.mods.amount] : [id, w.lvl])),
			h.ward, heroShieldReady(h, this.time) ? 1 : 0,
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
			pa: ps.filter((h) => h.posAck !== undefined).map((h) => [h.pid, h.posAck, h.moveEpoch ?? 0]),
			mob: mobilitySnapshot(this),
			cv: caravanSnapshot(this),
			support: ps.filter((h) => h.supportDamage > 0 || Object.values(h.support).some(n=>n>0)).map((h) => [h.pid, Math.round(h.supportDamage), ...Object.values(supportStats(h))]),
			fx: this.fx, boss: bossBar, op: outpostSnapshot(this), trophy: ps.filter(h => h.victoryBanner).map(h => h.pid),
		};
		// Active peak: [index into PEAKS, seconds left, duration]; drives the client's eclipse mask, dawn tint and HUD.
		if (this.peak) msg.pk = [this.peak.i, Math.round((this.peak.at + this.peak.dur - this.time) * 10) / 10, this.peak.dur];
		// v21 finale: [phase 1..4, seconds left (prelude: to the Lord, then to the end), ring centre x, y, radius now, final radius].
		if (this.fin) {
			const f = this.fin;
			msg.fin = [this.finPhase(), Math.max(0, Math.round(((f.lord ? this.runLength : this.finPlan.lord) - this.time) * 10) / 10), f.cx, f.cy, Math.round(f.r), f.r1];
		}
		const ev = this.events?.snap();
		if (ev) msg.ev = ev;
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
		this.isConnected = () => true;
		this.onRunEnd = null; // v22: (info) => Map pid -> totals, given to every room
	}

	addPlayer(pid, name, uid = null) {
		this.players.set(pid, { pid, name, uid, room: null });
	}

	// Deploy check (/api/busy): rooms in a run and players in them, no names or codes.
	busy() {
		let playing = 0, players = 0, scheduled = 0;
		for (const r of this.rooms.values()) {
			if (r.startsAt !== null) scheduled++;
			if (r.state !== 'play') continue;
			playing++;
			players += r.heroes.size;
		}
		return { playing, players, online: this.players.size, scheduled };
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

	// v19: is the player in a running game (the server keeps a dropped one longer then)?
	inRun(pid) {
		return this.players.get(pid)?.room?.state === 'play';
	}

	setOffline(pid, off) {
		this.players.get(pid)?.room?.setOffline(pid, off);
	}

	leaveRoom(pid) {
		const p = this.players.get(pid);
		const room = p?.room;
		if (!room) return;
		p.room = null;
		room.removePlayer(pid);
		if (room.size === 0 && room.startsAt === null) this.rooms.delete(room.code);
		this.pushRooms();
	}

	roomList() {
		const out = [];
		for (const r of this.rooms.values()) {
			if (r.state !== 'lobby' || r.size === 0) continue;
			out.push({ code: r.code, host: r.members.get(r.host)?.name ?? '', players: r.size, state: r.state, mode: r.mode });
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
				room.onRunEnd = this.onRunEnd;
				room.setMode(msg.mode);
				this.rooms.set(room.code, room);
				room.addPlayer(pid, p.name, msg.hero, sanitizeUnlocked(msg.heroes), p.uid);
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
				const e = room.addPlayer(pid, p.name, msg.hero, sanitizeUnlocked(msg.heroes), p.uid);
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
				if (msg.t === 'start' || msg.t === 'again' || msg.t === 'mode') this.pushRooms();
			}
		}
	}

	hostLobby(pid, code) {
		const room = this.players.get(pid)?.room;
		return room?.host === pid && room.code === code && room.state === 'lobby' ? room : null;
	}

	scheduleStart(room, pid, startsAt) {
		if (this.hostLobby(pid, room.code) !== room || room.startsAt !== null) return false;
		room.startsAt = startsAt;
		room.sendLobby();
		return true;
	}

	tick(dt, now = Date.now()) {
		let started = false;
		for (const room of this.rooms.values()) {
			if (room.startsAt === null || room.startsAt > now) {
				room.tick(dt);
				continue;
			}
			for (const pid of room.members.keys()) if (!this.isConnected(pid)) this.leaveRoom(pid);
			if (room.size > 0) {
				room.start();
				started = true;
			} else {
				this.rooms.delete(room.code);
			}
		}
		if (started) this.pushRooms();
	}
}
