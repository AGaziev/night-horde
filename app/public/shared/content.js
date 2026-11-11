// Shared game content and tuning. Imported by the server (Node ESM) and the browser.
import { CONFLUENCES } from './confluences.js';

// The one place for the game version: run logs, summaries and /api/runs read it. Bump on every release.
export const GAME_VERSION = 'v34';
export const TICK_HZ = 30;
export const SNAPSHOT_HZ = 10;
export const POS_HZ = 15;
export const MAX_PLAYERS = 8;
export const RUN_SECONDS = 15 * 60;
export const MAX_ENEMIES = 350;
export const MAX_GEMS = 200;
export const PLAYER_RADIUS = 14;
export const REVIVE_RADIUS = 60;
export const REVIVE_SECONDS = 3;
export const REVIVE_HP_FRACTION = 0.5;
export const PLAYER_IFRAMES = 0.4;
// Team XP: every gem gives its full XP to every player in the room (downed ones too, so a revived ally is not behind).
// The level threshold grows with the party so the pace matches the old 30% share: n / (1 + 0.3 (n - 1)).
export const OLD_GEM_SHARE = 0.3;
export const teamXpMul = (players) => Math.max(1, players) / (1 + OLD_GEM_SHARE * (Math.max(1, players) - 1));
export const MAX_LEVEL = 5; // max level of every weapon and passive
// Slots are scarce on purpose: a full build is 6 weapons + 6 artifacts (v26: artifacts 4 → 6), so choices differ between players.
export const MAX_WEAPONS = 6;
export const MAX_PASSIVES = 6;
// Bosses (v8): regular ones at BOSS_SCHEDULE in a random order without repeats, the final one is always the Lord.
export const BOSS_SCHEDULE = [180, 360, 540, 720];
export const BOSS_POOL = ['brood', 'ram', 'gunner', 'twin'];
// v21 «Последний рубеж»: the Lord comes FINALE.fight seconds before the end into a closed arena (see FINALE below).
export const FINAL_BOSS = { at: RUN_SECONDS - 75, type: 'boss' };
export const BOSS_TIMES = [...BOSS_SCHEDULE, FINAL_BOSS.at];
// Boss hp = def.hp × this: follows the regular enemy curve (players included) at a gentler slope.
// slot: extra hp per boss in spawn order, the last one is the final boss (player damage outgrows enemy hp; v15 live
// logs: a usual build should need ~40–60 s next to a boss; the final boss stays the toughest).
export const BOSS_HP = { k: 0.38, pow: 0.9, solo: 0.75, slot: [1.2, 3.1, 4.2, 3.4, 2] };
export const bossHpScale = (seconds, players, slot = -1) => BOSS_HP.k * enemyHpScale(seconds, players) ** BOSS_HP.pow * (players > 1 ? 1 : BOSS_HP.solo)
	* (BOSS_HP.slot[slot] ?? 1);

export const xpForNext = (level, players = 1) => Math.round((5 + (level - 1) * 8) * teamXpMul(players));

// Player colors by join order.
export const PLAYER_COLORS = ['#4fc3f7', '#ff8a65', '#aed581', '#ba68c8', '#ffd54f', '#4db6ac', '#f06292', '#90a4ae'];

export const HERO_PERKS = {
	knight: { name: 'Щит', desc: 'Раз в 20 с щит поглощает один удар.', cooldown: 20 },
	witch: { name: 'Эхо атаки', desc: 'Раз в 8 с повторяет атаку с 60% урона и её эффектами.', cooldown: 8, damage: 0.6 },
	ranger: { name: 'Бросок на ходу', desc: 'На бегу раз в 3 с бросает клинок в преследователя или ближайшего врага.', cooldown: 3 },
	smith: { name: 'Удар молота', desc: 'Серия попаданий вызывает удар молотом. Разное оружие набирает серию быстрее.', cooldown: 4 },
	stormcaller: { name: 'Разряд', desc: 'Раз в 6 с отмечает врага. Следующее попадание выпускает молнию из цели.', cooldown: 6 },
	alchemist: { name: 'Осадок', desc: 'Раз в 6 с попадание оставляет лужу сырости. Она перенимает холод или горение атаки.', cooldown: 6 },
	spearmaiden: { name: 'Прокол', desc: 'Раз в 6 с попадание пробивает линию врагов через цель.', cooldown: 6 },
	herald: { name: 'Целительный звон', desc: 'Попадание раз в 15 с лечит вас на 6 и одного союзника рядом на 12.', cooldown: 15, self: 6, ally: 12, range: 145 },
};

export const HEROES = {
	knight: { name: 'Страж', desc: 'Крепкий воин с клинком', hp: 140, speed: 150, weapon: 'whip', color: '#90caf9' },
	witch: { name: 'Ведьма', desc: 'Самонаводящиеся искры', hp: 100, speed: 160, weapon: 'bolt', color: '#ce93d8' },
	ranger: { name: 'Следопыт', desc: 'Быстрый, метает ножи', hp: 110, speed: 175, weapon: 'knives', color: '#a5d6a7' },
	herald: {
		name: 'Звонарь', desc: 'Поддержка с ореолом', hp: 140, speed: 145, weapon: 'aura', color: '#ffe082',
	},
	smith: {
		name: 'Кузнец', desc: 'Танк с кружащими молотами', hp: 170, speed: 135, weapon: 'orbit', color: '#ffab91',
		trait: { dmgTaken: 0.8, taunt: 250 }, traitDesc: '−20% урона; враги ближе 250 идут на него',
		orbitSkin: 'hammer',
	},
	stormcaller: {
		name: 'Заклинательница бурь', desc: 'Хрупкая, бьёт молниями', hp: 90, speed: 160, weapon: 'lightning', color: '#80deea',
		trait: { chainBonus: 1 }, traitDesc: 'Молния перескакивает на 1 цель больше',
	},
	alchemist: {
		name: 'Алхимик', desc: 'Контроль толпы зельями', hp: 110, speed: 155, weapon: 'flask', color: '#e6ee9c',
		trait: { puddleSlow: 0.35 }, traitDesc: 'Лужи замедляют врагов на 35%',
	},
	spearmaiden: {
		name: 'Копейщица', desc: 'Прошивает строй копьём', hp: 150, speed: 150, weapon: 'spear', color: '#ef9a9a',
		trait: { spearRam: 0.12, spearKb: 2 }, traitDesc: 'Таран: копья отбрасывают вдвое дальше и бьют на 12% сильнее за каждого пронзённого',
	},
};

// Run modes: «Обед» squeezes the night into 10 minutes. Night time (`nightTime`) drives waves, pressure,
// bosses and elites, so every minute of «Обед» plays like 1.5 minutes of the night; xp follows (xpMul),
// hpMul (index = players - 1, the last one for bigger groups) keeps the share of wins close to the night.
// dmgMul (v18, same indexing): pairs fell to hits (Трубач shots first), not to enemy hp, so only their enemy damage is softer.
export const MODES = {
	// v23: three players fell mid-run (9–10 min, mostly to spit and Трубач shots; 17% wins at night, 7% at lunch) — ×0.9 / ×0.8.
	// v28: v25–v26 (3 new weapons and 4 artifacts in the pool) thinned builds: from 6:00 the human bot took +30–50% damage,
	// wins fell to 14% solo and 8% for pairs. Enemy damage for 1–2 players brings them back to 25–40% (pm/balance-v28.md).
	night: { id: 'night', name: 'Полная ночь', short: 'Ночь', seconds: RUN_SECONDS, xpMul: 1, hpMul: 1, dmgMul: [0.75, 0.6, 0.49, 0.6] }, // v30: night trios, pm/balance-v30.md
	// v20: pairs at lunch ×0.85 → ×0.8 (overclocks replace embers, the pair fell to 17–22%).
	lunch: { id: 'lunch', name: 'Обед', short: 'Обед', seconds: 10 * 60, xpMul: 1.5, hpMul: [1, 1.13], dmgMul: [0.75, 0.5, 0.5, 0.52] }, // v30: lunch 4+, pm/balance-v30.md
};
export const MODE_IDS = Object.keys(MODES);
export const DEFAULT_MODE = 'night';
export const modeOf = (id) => MODES[id] ?? MODES[DEFAULT_MODE];
export const modeHpMul = (id, players = 1) => {
	const m = modeOf(id).hpMul ?? 1;
	return Array.isArray(m) ? m[Math.min(Math.max(1, players), m.length) - 1] : m;
};
// v18: enemy damage of a mode by players (same indexing as hpMul); «Обед» softens it for pairs only.
export const modeDmgMul = (id, players = 1) => {
	const m = modeOf(id).dmgMul ?? 1;
	return Array.isArray(m) ? m[Math.min(Math.max(1, players), m.length) - 1] : m;
};
export const modeLabel = (id) => `${modeOf(id).name} · ${Math.round(modeOf(id).seconds / 60)} мин`;
// Real seconds -> night seconds factor for a run length.
export const timeScale = (runLength = RUN_SECONDS) => RUN_SECONDS / runLength;
// Boss times for a run length: regular ones scale, the final boss keeps its distance from the end.
export const bossTimes = (runLength = RUN_SECONDS) => {
	const k = timeScale(runLength);
	return [...BOSS_SCHEDULE.map((t) => Math.round(t / k)), runLength - (finaleFight(runLength) || FINALE.legacyLord)];
};

// v21 finale «Последний рубеж». Timeline from the end T of the run: T − fight − prelude − warn banner; T − fight − prelude
// a ring of darkness closes on the group and regular spawn stops; T − fight the Lord absorbs the horde and comes out
// in the middle; hp ≤ rageAt — rage (charges, one group revive); the last `last` s — the «Светает» peak.
// Killing the Lord ends the run at once (grade 2), living to T is grade 1.
export const FINALE = {
	fight: { night: 75, lunch: 60 },   // seconds of the fight before the end of the run
	minRun: 150,                        // shorter runs (sims, tests) have no finale: the Lord comes legacyLord s before the end
	legacyLord: 30,
	prelude: 10,                        // the ring closes, regular spawn is off
	warn: 4,                            // banner before the prelude
	ring: { r: 440, perPlayer: 25, shrink: 260, pad: 80, addsOut: 30 },
	lordSpawnWarn: 1.5,                 // warn circle at the ring centre: the Lord stands still, harmless and immune
	lordSpawnR: 120,
	// callOver: the Lord's swarm may exceed the cap by this much. v23 (#9FKPYY, three players fell to the packs): from
	// `groupFrom` players a pack is sized for one player (`groupScale` × the solo pack) and the field cap is `groupCap`.
	adds: { first: 3, every: 6, rate: 0.4, cap: 160, xpMul: 0.5, callOver: 40, groupFrom: 3, groupScale: 1, groupCap: 80 },
	// × the regular final-boss hp, index = players − 1 (the last one for bigger groups)
	hpMul: { night: [2.5, 1.4, 1.4, 1.4], lunch: [2.5, 1, 1, 1] },
	dmgMul: [1, 1.3, 1.1, 1],      // the Lord's hits and the adds' damage in the finale (lever)
	rageRevive: true,                   // groups: every downed hero who is online rises once, at rage
	// v23, 3+ players (#9FKPYY never reached rage): the ray comes at rage or at this share of the fight, whichever is
	// first — and waits until somebody is down, so a healthy group does not waste it. Pairs keep the v21 rule.
	rayAt: 0.5,
	lastCd: 0.8,                        // the Lord's cooldown during «Светает»
	killHold: 0.6,                      // client freeze frame on the last hit
};
const byPlayers = (arr, players) => arr[Math.min(Math.max(1, players), arr.length) - 1];
export const finaleFight = (runLength = RUN_SECONDS) => {
	if (runLength < FINALE.minRun) return 0;
	const own = Object.values(MODES).find((m) => m.seconds === runLength);
	return own ? FINALE.fight[own.id] : Math.min(FINALE.fight.night, Math.round(runLength * 0.1));
};
export const finaleRingR = (players) => FINALE.ring.r + FINALE.ring.perPlayer * (Math.max(1, players) - 1);
export const finaleHpMul = (mode, players) => byPlayers(FINALE.hpMul[mode] ?? FINALE.hpMul.night, players);
export const finaleDmgMul = (players) => byPlayers(FINALE.dmgMul, players);
// v23: the packs' size factor and field cap by players (solo and pair keep the group spawn scale).
export const finaleAddScale = (players) => (players >= FINALE.adds.groupFrom ? FINALE.adds.groupScale : spawnRateScale(players));
export const finaleAddCap = (players) => (players >= FINALE.adds.groupFrom ? FINALE.adds.groupCap : FINALE.adds.cap);
// Projects a point into the ring; shared by the server (heroes, the Lord) and the client's own-hero prediction.
export function clampToRing(x, y, cx, cy, r) {
	const dx = x - cx, dy = y - cy;
	const d2 = dx * dx + dy * dy;
	if (d2 <= r * r) return [x, y];
	if (r <= 0) return [cx, cy];
	const k = r / Math.sqrt(d2);
	return [cx + dx * k, cy + dy * k];
}

// Hero unlocks (M2): one hero per role is open from the start, the rest open by achievements.
// The server counts per-run stats (`runAchievements`) and sends them in `over`; totals live in the browser, for portal users (v22) on the server.
// agg: how a run's value joins the total — sum or best.
export const START_HEROES = ['knight', 'witch', 'alchemist'];
export const UNLOCKS = {
	stormcaller: { stat: 'wins', agg: 'sum', need: 1, text: 'Победите любым героем' },
	smith: { stat: 'knightBest', agg: 'max', need: 300, text: 'Продержитесь 5:00 Стражем', time: true },
	herald: { stat: 'revives', agg: 'sum', need: 10, text: 'Поднимите союзников' },
	ranger: { stat: 'knifeKills', agg: 'sum', need: 600, text: 'Убейте врагов ножами' },
	spearmaiden: { stat: 'bosses', agg: 'sum', need: 5, text: 'Одолейте боссов' },
};
export const ACH_STATS = ['wins', 'knightBest', 'revives', 'knifeKills', 'bosses', 'lords'];
export const unlockAgg = (stat) => Object.values(UNLOCKS).find((u) => u.stat === stat)?.agg ?? 'sum';
// Adds one run's stats to the stored totals (both plain objects); returns a new object.
export function mergeAchStats(total, run) {
	const out = {};
	for (const k of ACH_STATS) {
		const a = Math.max(0, +total?.[k] || 0), b = Math.max(0, +run?.[k] || 0);
		out[k] = unlockAgg(k) === 'max' ? Math.max(a, b) : a + b;
	}
	return out;
}
// Hero ids open for these totals (start heroes first, in HEROES order).
export const unlockedHeroes = (stats) => Object.keys(HEROES).filter((id) => START_HEROES.includes(id) || (UNLOCKS[id] && (+stats?.[UNLOCKS[id].stat] || 0) >= UNLOCKS[id].need));
// «Поднимите союзников: 3/10», «Продержитесь 5:00 Стражем: 3:12/5:00».
export function unlockProgress(id, stats) {
	const u = UNLOCKS[id];
	if (!u) return '';
	const fmt = (v) => (u.time ? `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}` : String(Math.floor(v)));
	const v = Math.min(u.need, Math.max(0, +stats?.[u.stat] || 0));
	return `${u.text}: ${fmt(v)}/${fmt(u.need)}`;
}

// Hero traits (all optional, read by the server from HEROES[id].trait):
//   dmgTaken   — multiplier for damage taken
//   taunt      — enemies within this distance target this hero instead of the nearest player
//   chainBonus — extra lightning chain jumps
//   puddleSlow — fraction of speed enemies lose while inside this hero's puddles
//   spearRam   — spear damage bonus per enemy the spear has already pierced; spearKb — spear knockback multiplier
export const NO_TRAIT = Object.freeze({ dmgTaken: 1, taunt: 0, chainBonus: 0, puddleSlow: 0, spearRam: 0, spearKb: 1 });
export const heroTrait = (heroId) => ({ ...NO_TRAIT, ...(HEROES[heroId]?.trait ?? {}) });

// Weapon stats per level: index 0 = level 1. `cd` is cooldown in seconds.
// Visual-relevant formulas (orbit, aura) are defined below so the client draws exactly what the server simulates.
export const WEAPONS = {
	bolt: {
		name: 'Искра', icon: '✦', desc: 'Самонаводящийся снаряд в ближайшего врага', tags: ['proj'], role: 'shot',
		levels: [
			{ dmg: 10, cd: 1.0, count: 1, speed: 420, pierce: 1 },
			{ dmg: 12, cd: 0.9, count: 2, speed: 440, pierce: 1 },
			{ dmg: 15, cd: 0.8, count: 2, speed: 460, pierce: 2 },
			{ dmg: 18, cd: 0.7, count: 3, speed: 480, pierce: 2 },
			{ dmg: 22, cd: 0.6, count: 4, speed: 500, pierce: 3 },
		],
	},
	whip: {
		name: 'Клинок', icon: '⚔', desc: 'Широкий горизонтальный удар в сторону ближайшего врага', tags: ['phys'], role: 'ring',
		levels: [
			{ dmg: 14, cd: 1.3, range: 110, width: 40, both: false },
			{ dmg: 18, cd: 1.2, range: 120, width: 44, both: false },
			{ dmg: 22, cd: 1.1, range: 130, width: 48, both: true },
			{ dmg: 28, cd: 1.0, range: 145, width: 52, both: true },
			{ dmg: 36, cd: 0.9, range: 160, width: 58, both: true },
		],
	},
	knives: {
		name: 'Ножи', icon: '➶', desc: 'Веер быстрых ножей в ближайшего врага', tags: ['phys', 'proj'], role: 'shot',
		levels: [
			{ dmg: 8, cd: 0.7, count: 1, speed: 600, pierce: 1, spread: 0.12 },
			{ dmg: 9, cd: 0.6, count: 2, speed: 620, pierce: 1, spread: 0.12 },
			{ dmg: 11, cd: 0.55, count: 3, speed: 640, pierce: 2, spread: 0.12 },
			{ dmg: 13, cd: 0.5, count: 4, speed: 660, pierce: 2, spread: 0.1 },
			{ dmg: 16, cd: 0.45, count: 5, speed: 700, pierce: 3, spread: 0.1 },
		],
	},
	orbit: {
		name: 'Хоровод', icon: '◎', desc: 'Клинки кружат вокруг героя', tags: ['phys'], role: 'ring',
		levels: [
			{ dmg: 8, count: 2, radius: 70, rps: 0.6, hitCd: 0.5 },
			{ dmg: 10, count: 3, radius: 75, rps: 0.65, hitCd: 0.5 },
			{ dmg: 12, count: 3, radius: 85, rps: 0.7, hitCd: 0.45 },
			{ dmg: 15, count: 4, radius: 90, rps: 0.75, hitCd: 0.4 },
			{ dmg: 18, count: 5, radius: 100, rps: 0.8, hitCd: 0.35 },
		],
	},
	aura: {
		name: 'Ореол', icon: '◌', desc: 'Жжёт врагов рядом. За 2 с непрерывного контакта урон по цели вырастает до ×1,5', tags: ['aoe'], role: 'ring',
		levels: [
			{ dmg: 4, radius: 70, tick: 0.5 },
			{ dmg: 5, radius: 80, tick: 0.5 },
			{ dmg: 6, radius: 90, tick: 0.45 },
			{ dmg: 8, radius: 100, tick: 0.4 },
			{ dmg: 10, radius: 115, tick: 0.35 },
		],
	},
	lightning: {
		name: 'Гроза', icon: 'ϟ', desc: 'Молния бьёт случайных врагов на экране', tags: ['shock'], role: 'shot',
		levels: [
			{ dmg: 20, cd: 2.2, strikes: 1, chain: 0 },
			{ dmg: 24, cd: 2.0, strikes: 2, chain: 0 },
			{ dmg: 28, cd: 1.8, strikes: 2, chain: 1 },
			{ dmg: 34, cd: 1.6, strikes: 3, chain: 1 },
			{ dmg: 42, cd: 1.4, strikes: 3, chain: 2 },
		],
	},
	flask: {
		name: 'Зелье', icon: '⚗', desc: 'Лужа яда рядом с героем', tags: ['aoe'], role: 'trace',
		levels: [
			{ dmg: 5, cd: 3.0, count: 1, radius: 50, duration: 2.5, tick: 0.4 },
			{ dmg: 6, cd: 2.8, count: 2, radius: 55, duration: 2.8, tick: 0.4 },
			{ dmg: 7, cd: 2.6, count: 2, radius: 60, duration: 3.0, tick: 0.35 },
			{ dmg: 9, cd: 2.4, count: 3, radius: 65, duration: 3.2, tick: 0.35 },
			{ dmg: 11, cd: 2.2, count: 3, radius: 75, duration: 3.5, tick: 0.3 },
		],
	},
	sickle: {
		name: 'Серп', icon: '☾', desc: 'Летит к врагу и возвращается, режет всех на пути', tags: ['phys', 'proj'], role: 'shot',
		levels: [
			{ dmg: 12, cd: 1.4, count: 1, range: 260, speed: 480 },
			{ dmg: 15, cd: 1.3, count: 1, range: 280, speed: 500 },
			{ dmg: 18, cd: 1.2, count: 2, range: 300, speed: 520 },
			{ dmg: 22, cd: 1.1, count: 2, range: 320, speed: 540 },
			{ dmg: 28, cd: 1.0, count: 3, range: 350, speed: 560 },
		],
	},
	bomb: {
		name: 'Петарда', icon: '✹', desc: 'Взрывается в гуще врагов', tags: ['fire', 'aoe'], role: 'trace',
		levels: [
			{ dmg: 22, cd: 2.4, count: 1, radius: 60, fuse: 0.7 },
			{ dmg: 28, cd: 2.2, count: 1, radius: 66, fuse: 0.7 },
			{ dmg: 34, cd: 2.0, count: 2, radius: 72, fuse: 0.65 },
			{ dmg: 42, cd: 1.8, count: 2, radius: 80, fuse: 0.6 },
			{ dmg: 55, cd: 1.6, count: 3, radius: 90, fuse: 0.55 },
		],
	},
	frost: {
		name: 'Иней', icon: '❄', desc: 'Ледяная волна летит сквозь толпу и ненадолго замораживает с первого уровня', tags: ['cold', 'aoe'], role: 'ring',
		levels: [
			{ dmg: 12, cd: 2.8, radius: 230, width: 55, slow: 0.30, dur: 1.5, freeze: 0.25 },
			{ dmg: 15, cd: 2.6, radius: 255, width: 60, slow: 0.35, dur: 1.7, freeze: 0.35 },
			{ dmg: 19, cd: 2.4, radius: 280, width: 68, slow: 0.40, dur: 1.9, freeze: 0.45 },
			{ dmg: 24, cd: 2.1, radius: 310, width: 76, slow: 0.45, dur: 2.1, freeze: 0.55 },
			{ dmg: 30, cd: 1.8, radius: 340, width: 85, slow: 0.50, dur: 2.3, freeze: 0.65 },
		],
	},
	traps: {
		name: 'Капканы', icon: '⊓', desc: 'Ставит капкан навстречу врагам: задевает группу, удерживает и срабатывает дважды', tags: ['phys', 'trap'], role: 'trace',
		levels: [
			{ dmg: 24, cd: 2, max: 4, root: 1, radius: 30, splash: 46 },
			{ dmg: 30, cd: 1.8, max: 5, root: 1.2, radius: 32, splash: 54 },
			{ dmg: 40, cd: 1.6, max: 6, root: 1.4, radius: 34, splash: 62 },
			{ dmg: 50, cd: 1.4, max: 7, root: 1.6, radius: 36, splash: 72 },
			{ dmg: 64, cd: 1.2, max: 8, root: 1.8, radius: 38, splash: 82 },
		],
	},
	// Wave 3 weapons that need no wave-2 states (mark and burn already exist in hurtEnemy).
	lantern: {
		name: 'Фонарь', icon: '🏮', desc: 'Выделяет сильнейшего врага: метка на 3 с усиливает весь урон по нему на 25–40%', tags: ['aoe'], role: 'trace',
		levels: [
			{ dmg: 6, tick: 0.5, range: 200, angle: 50, mark: 0.25 },
			{ dmg: 7, tick: 0.5, range: 220, angle: 55, mark: 0.28 },
			{ dmg: 9, tick: 0.45, range: 240, angle: 60, mark: 0.32 },
			{ dmg: 11, tick: 0.45, range: 260, angle: 65, mark: 0.36 },
			{ dmg: 14, tick: 0.4, range: 300, angle: 75, mark: 0.40 },
		],
	},
	trail: {
		name: 'Пламенный след', icon: '🔥', desc: 'Широкая огненная дорожка обжигает при входе и продолжает жечь после выхода', tags: ['fire', 'aoe'], role: 'trace',
		levels: [
			{ dmg: 4, every: 0.25, radius: 34, dur: 3, tick: 0.3, burn: 4 },
			{ dmg: 5, every: 0.25, radius: 37, dur: 3.2, tick: 0.3, burn: 6 },
			{ dmg: 6, every: 0.22, radius: 40, dur: 3.5, tick: 0.3, burn: 8 },
			{ dmg: 8, every: 0.2, radius: 44, dur: 3.8, tick: 0.25, burn: 10 },
			{ dmg: 10, every: 0.18, radius: 48, dur: 4, tick: 0.25, burn: 12 },
		],
	},
	spear: {
		name: 'Копьё', icon: '↟', desc: 'Пробивает строй насквозь, бьёт сильнейшего', tags: ['phys', 'proj'], role: 'shot',
		levels: [
			{ dmg: 30, cd: 2.5, pierce: 5, width: 16, speed: 700, kb: 40 },
			{ dmg: 38, cd: 2.3, pierce: 6, width: 16, speed: 720, kb: 50 },
			{ dmg: 48, cd: 2.1, pierce: 8, width: 18, speed: 740, kb: 60 },
			{ dmg: 60, cd: 1.9, pierce: 10, width: 20, speed: 760, kb: 70 },
			{ dmg: 80, cd: 1.6, pierce: 99, width: 22, speed: 800, kb: 80 },
		],
	},
	ward: {
		name: 'Оберег', icon: '⛉', desc: 'Оружие: блокирует удары, отвечает вспышкой на каждый блок и бьёт щитом раз в 3 с, пока есть заряд', tags: ['aoe'], role: 'ring',
		levels: [
			{ charges: 1, cd: 12, burstDmg: 15, burstR: 90, kb: 60 },
			{ charges: 1, cd: 10, burstDmg: 20, burstR: 100, kb: 70 },
			{ charges: 2, cd: 10, burstDmg: 25, burstR: 110, kb: 80 },
			{ charges: 2, cd: 8, burstDmg: 32, burstR: 120, kb: 90 },
			{ charges: 3, cd: 7, burstDmg: 40, burstR: 140, kb: 100 },
		],
	},
	// v28 balance: Призма ×2 and Теневой якорь ×1.6 damage — at level 5 they dealt 181 and 262 dps in a crowd against ~400
	// of the other weapons, and the human bot lost 10+ points of wins picking them (pm/balance-v28.md).
	prism: {
		name: 'Призма', icon: '◇', desc: 'Луч раздваивается за первой целью и поражает врагов за ней', tags: ['proj'], role: 'shot',
		levels: [
			{ dmg: 32, cd: 2.4, range: 260, width: 22 },
			{ dmg: 40, cd: 2.2, range: 290, width: 24 },
			{ dmg: 50, cd: 2.0, range: 320, width: 27 },
			{ dmg: 62, cd: 1.8, range: 350, width: 30 },
			{ dmg: 80, cd: 1.6, range: 380, width: 34 },
		],
	},
	tuning: {
		name: 'Камертон', icon: '♬', desc: 'Волна метит врагов. Следующий физический удар по метке даёт новый импульс', tags: ['aoe'], role: 'ring',
		levels: [
			{ dmg: 12, cd: 2.8, radius: 95, dur: 2.2 },
			{ dmg: 15, cd: 2.6, radius: 108, dur: 2.5 },
			{ dmg: 20, cd: 2.4, radius: 123, dur: 2.7 },
			{ dmg: 25, cd: 2.2, radius: 140, dur: 3 },
			{ dmg: 32, cd: 2, radius: 160, dur: 3.3 },
		],
	},
	anchor: {
		name: 'Теневой якорь', icon: '⚓', desc: 'Стягивает обычных врагов в центр толпы. В луже Зелья продлевает её действие', tags: ['aoe'], role: 'trace',
		levels: [
			{ dmg: 19, cd: 4.2, radius: 95, range: 260 },
			{ dmg: 26, cd: 4, radius: 108, range: 280 },
			{ dmg: 32, cd: 3.7, radius: 124, range: 300 },
			{ dmg: 42, cd: 3.4, radius: 140, range: 320 },
			{ dmg: 54, cd: 3.1, radius: 158, range: 350 },
		],
	},
};

// Passive multipliers are applied per level (value * level). `tpl` shows the value one card adds ({v}, see passiveDesc);
// `noRarity` passives (integer steps) keep their level table and get no card rarity.
// `bonus`: a fixed side effect per level, untouched by card rarity (luck artifacts get a combat use).
// Ember without a fire weapon: every hit burns for EMBER_WEAK.dur s at EMBER_WEAK.frac of the ember burn.
export const PASSIVES = {
	might: { name: 'Сила', icon: '💪', desc: '+10% урона', tpl: '+{v}% урона', stat: 'dmgMul', perLevel: 0.10 },
	haste: { name: 'Спешка', icon: '⏱', desc: '−8% перезарядки', tpl: '−{v}% перезарядки', stat: 'cdMul', perLevel: -0.08 },
	vigor: { name: 'Крепость', icon: '❤', desc: '+20 к макс. здоровью', tpl: '+{v} к макс. здоровью', stat: 'maxHp', perLevel: 20 },
	swift: { name: 'Лёгкость', icon: '👟', desc: '+8% скорости', tpl: '+{v}% скорости', stat: 'speedMul', perLevel: 0.08 },
	magnet: { name: 'Магнит', icon: '🧲', desc: '+30% радиуса сбора', tpl: '+{v}% радиуса сбора', stat: 'magnetMul', perLevel: 0.30 },
	area: { name: 'Размах', icon: '⬤', desc: '+10% площади оружия', tpl: '+{v}% площади оружия', stat: 'areaMul', perLevel: 0.10 },
	regen: { name: 'Восстановление', icon: '✚', desc: '+0.5 здоровья в секунду', tpl: '+{v} здоровья в секунду', stat: 'regen', perLevel: 0.5 },
	crit: { name: 'Острота', icon: '✧', desc: '+6% шанс крита (×2 урона)', tpl: '+{v}% шанс крита (×2 урона)', stat: 'critChance', perLevel: 0.06 },
	echo: { name: 'Эхо', icon: '≋', desc: '+1 снаряд, лужа, удар или клинок (+2 с 4 ур.)', stat: 'amount', values: [1, 1, 1, 2, 2], noRarity: true },
	hourglass: { name: 'Песочные часы', icon: '⧗', desc: '+12% длительности луж, холода и заморозки', tpl: '+{v}% длительности луж, холода и заморозки', stat: 'durMul', perLevel: 0.12 },
	mail: { name: 'Кольчуга', icon: '⛨', desc: 'Броня: −1 к каждому полученному удару', tpl: 'Броня: −{v} к каждому полученному удару', stat: 'armor', perLevel: 1 },
	ember: { name: 'Уголёк', icon: '♨', desc: 'Удары поджигают: шанс 8% за уровень; без огненного оружия любой удар слабо поджигает', tpl: 'Удары поджигают: +{v}% шанса; без огненного оружия любой удар слабо поджигает', stat: 'burnChance', perLevel: 0.08, extra: { burnDps: [3, 4, 5, 6, 8] } },
	frostcore: { name: 'Ледяное сердце', icon: '❆', desc: '+10% силы контроля; замедленные получают +6% урона за уровень', tpl: '+{v}% силы контроля; замедленные получают +6% урона за уровень', stat: 'ctrlMul', perLevel: 0.10, extra: { chillVuln: [0.06, 0.12, 0.18, 0.24, 0.30] } },
	luck: { name: 'Подкова', icon: '☘', desc: '+10% удачи: сундуки, редкие карточки, золотые кристаллы; +4% шанс крита за уровень', tpl: '+{v}% удачи: сундуки, редкие карточки, золотые кристаллы; +4% шанс крита за уровень', stat: 'luck', perLevel: 0.10, bonus: { critChance: 0.04 } },
	clover: { name: 'Клевер', icon: '🍀', desc: '+15% к шансу редких карточек; +5% урона за уровень', tpl: '+{v}% к шансу редких карточек; +5% урона за уровень', stat: 'fortune', perLevel: 0.15, bonus: { dmgMul: 0.05 } },
	lens: { name: 'Гранёная линза', icon: '◈', desc: 'Попадания по следующим целям одной атаки сильнее', tpl: '+{v}% урона по следующим целям одной атаки', stat: 'piercePower', perLevel: 0.12 },
	coil: { name: 'Грозовая катушка', icon: 'ϟ', desc: 'Убийство электрическим ударом пересылает молнию ближайшему врагу. С уровнем разряд бьёт дальше, до трёх прыжков.', stat: 'coil', values: [1, 1, 2, 2, 3], noRarity: true },
	counterweight: { name: 'Противовес', icon: '⚖', desc: 'Снижает контактный урон на месте. Блок Оберега заряжает следующий разряд', tpl: 'На месте −{v}% контактного урона. Блок Оберега заряжает следующий разряд', stat: 'brace', perLevel: 0.10 },
	ashseal: { name: 'Пепельная печать', icon: '☄', desc: 'Смерть горящего врага передаёт огонь соседям. С уровнем пожар расходится дальше', stat: 'ashHops', values: [1, 1, 2, 2, 3], noRarity: true },
	// coop: offered only when the room has 2+ players.
	bond: { name: 'Узы', icon: '∞', desc: '+5% урона за каждого союзника в 250 px (до 3); союзникам рядом +2%', tpl: '+{v}% урона за каждого союзника в 250 px (до 3); союзникам рядом +2%', stat: 'bond', perLevel: 0.05, coop: true },
};
// Every artifact has a combat use for every weapon, including a starting weapon on its own.
// Defensive/utility artifacts retain their main purpose; their smaller combat side is independent of rarity.
export const ARTIFACT_COMBAT = {
	vigor: { bonus: { dmgMul: 0.025 }, text: '+2,5% урона оружия за уровень' },
	swift: { bonus: { cdMul: -0.015 }, text: 'оружие атакует на 1,5% чаще за уровень' },
	magnet: { bonus: { areaMul: 0.035, dmgMul: 0.01 }, text: '+3,5% размера и +1% урона оружия за уровень' },
	area: { bonus: { dmgMul: 0.015 }, text: '+1,5% урона за уровень, в том числе точечным атакам' },
	regen: { bonus: { dmgMul: 0.025 }, text: '+2,5% урона оружия за уровень' },
	echo: { bonus: { dmgMul: 0.025 }, text: '+2,5% урона всем атакам за уровень, включая волны и лучи' },
	hourglass: { bonus: { dmgMul: 0.025 }, text: '+2,5% урона оружия за уровень' },
	mail: { bonus: { dmgMul: 0.025 }, text: '+2,5% урона оружия за уровень' },
	frostcore: { bonus: { dmgMul: 0.02 }, text: '+2% урона оружия за уровень' },
	lens: { bonus: { dmgMul: 0.025 }, text: '+2,5% урона первого попадания за уровень' },
	counterweight: { bonus: { dmgMul: 0.025 }, text: '+2,5% урона оружия за уровень; заряд блока усиливает любую атаку' },
};
for (const [id, rule] of Object.entries(ARTIFACT_COMBAT)) {
	const p = PASSIVES[id];
	p.bonus = { ...p.bonus, ...rule.bonus };
	p.desc += '; ' + rule.text;
	if (p.tpl) p.tpl += '; ' + rule.text;
}
PASSIVES.coil.desc = 'Убийство любым оружием выпускает разряд; электрические и резонансные атаки передают более сильную молнию. До трёх прыжков.';
PASSIVES.ashseal.desc = 'Любая атака оставляет тлеющую печать. Смерть горящего врага передаёт огонь соседям; число поколений ограничено уровнем.';
// Direct weapon + artifact synergies (5.3): shown as hints on cards, applied on the server.
export const SYNERGIES = [
	{ weapon: 'knives', passive: 'crit', desc: 'крит-нож пробивает ещё одного врага' },
	{ weapon: 'orbit', passive: 'mail', desc: 'удар хоровода снимает 1 урона со следующего удара по вам (до 3)' },
	{ weapon: 'aura', passive: 'frostcore', desc: 'ореол холодит врагов на 15%' },
	{ weapon: 'lightning', passive: 'ember', desc: 'первый удар молнии всегда поджигает' },
	{ weapon: 'bomb', passive: 'echo', desc: 'с +2 лишними петардами взрывы ложатся крестом' },
	{ weapon: 'traps', passive: 'hourglass', desc: 'корни дольше на 12% за уровень' },
	{ weapon: 'sickle', passive: 'swift', desc: 'серп летит быстрее вместе с героем' },
	{ weapon: 'spear', passive: 'bond', desc: 'копьё рядом с союзником +30% урона' },
	{ weapon: 'prism', passive: 'lens', desc: 'луч получает третью ветвь' },
	{ weapon: 'sickle', passive: 'lens', desc: 'удар на обратном пути сильнее по уже задетым целям' },
	{ weapon: 'tuning', passive: 'coil', desc: 'враг под резонансной меткой передаёт электрический разряд при смерти' },
	{ weapon: 'lightning', passive: 'coil', desc: 'убийство молнией запускает цепь разрядов' },
	{ weapon: 'ward', passive: 'counterweight', desc: 'блок заряжает следующий электрический удар' },
	{ weapon: 'anchor', passive: 'counterweight', desc: 'стягивание двух или более врагов вызывает удар в центре' },
	{ weapon: 'bomb', passive: 'ashseal', desc: 'взрыв оставляет горящую зону' },
];
// Reactions (5.3): enemy state + hit tag, from any player. Index = kind in the ['react', kind, x, y, r] event.
export const REACTIONS = {
	cond: { name: 'Проводник', color: '#4fc3f7', desc: 'сырость + молния: разряд по всей луже' },
	flash: { name: 'Вспышка', color: '#ff9800', desc: 'горение + молния: взрыв' },
	shatter: { name: 'Раскол', color: '#e1f5fe', desc: 'заморозка + физический удар: ×2 и осколки' },
	steam: { name: 'Пар', color: '#eceff1', desc: 'горение + холод: облако, враги в нём бьют вдвое слабее' },
	blast: { name: 'Подрыв', color: '#ff7043', desc: 'корни + огонь по площади: ×1,25' },
	icing: { name: 'Наледь', color: '#b3e5fc', desc: 'сырость + холод: заморозка' },
	light: { name: 'Свет', color: '#ffd54f', desc: 'метка: весь урон больше' },
	chill: { name: 'Озноб', color: '#90caf9', desc: 'холод + Ледяное сердце: больше урона' },
};
export const REACTION_IDS = Object.keys(REACTIONS);
// Which weapons leave a state, and which state + hit tag makes which reaction (for card hints; the server rules live in Room.react).
export const STATE_SOURCES = {
	wet: ['flask', 'molotov', 'censer', 'quagmire', 'stingers'],
	burn: ['inferno', 'trail', 'bomb', 'molotov', 'minefield', 'firewheel', 'firepath', 'glow', 'pitch', 'firescythe', 'rockets'],
	frozen: ['crystalchoir', 'frost', 'icebomb', 'aurora', 'blizzard', 'icedisc', 'quagmire', 'frostsnare'],
	chill: ['crystalchoir', 'frost', 'aurora', 'blizzard', 'icedisc', 'quagmire', 'frostsnare'],
	root: ['blacksnare', 'traps', 'pitfall', 'tripwire', 'frostsnare', 'abatis'],
};
export const REACTION_RULES = [
	{ id: 'cond', state: 'wet', tags: ['shock'] },
	{ id: 'flash', state: 'burn', tags: ['shock'] },
	{ id: 'shatter', state: 'frozen', tags: ['phys'] },
	{ id: 'steam', state: 'burn', tags: ['cold'] },
	{ id: 'steam', state: 'chill', tags: ['fire'] },
	{ id: 'blast', state: 'root', tags: ['fire', 'aoe'] },
	{ id: 'icing', state: 'wet', tags: ['cold'] },
];
// First reaction a new weapon `id` makes together with one of `owned` (either side may leave the state): {reaction, with}.
export function reactionHint(id, owned) {
	const tagsOf = (w) => (WEAPONS[w] ?? DUOS[w] ?? EVOS[w])?.tags ?? [];
	for (const R of REACTION_RULES) {
		const src = STATE_SOURCES[R.state];
		for (const o of owned) {
			if (o === id) continue;
			if (src.includes(o) && R.tags.every((t) => tagsOf(id).includes(t))) return { reaction: R.id, with: o };
			if (src.includes(id) && R.tags.every((t) => tagsOf(o).includes(t))) return { reaction: R.id, with: o };
		}
	}
	return null;
}
export const REACT = {
	condFrac: 0.5, condEvery: 0.5,
	flashR: 50, flashBase: 10, flashFrac: 0.3,
	shatterMul: 2, shatterR: 40, shatterFrac: 0.3,
	steamR: 60, steamLife: 2, steamContact: 0.5,
	blastMul: 1.25,
	icingFreeze: 0.8,
};
// Beacon beams: deterministic so the client draws them where the server hits.
export const beaconAngle = (gameTime, pid, rps) => gameTime * rps * Math.PI * 2 + pid * 1.3;
// Value of a passive at a level: `values[level - 1]` for non-linear passives, otherwise perLevel * level.
export const passiveValue = (id, level) => {
	const p = PASSIVES[id];
	if (!p || level <= 0) return 0;
	return p.values ? p.values[Math.min(p.values.length, level) - 1] : p.perLevel * level;
};
// Neutral hero modifiers; passives add to them (server recalcMods).
export const baseMods = () => ({
	dmgMul: 1, cdMul: 1, speedMul: 1, magnetMul: 1, areaMul: 1, regen: 0,
	critChance: 0, critMul: 2, amount: 0, durMul: 1, luck: 0, xpMul: 1, armor: 0,
	burnChance: 0, burnDps: 0, ctrlMul: 1, chillVuln: 0, bond: 0, fortune: 0, piercePower: 0, coil: 0, brace: 0, ashHops: 0,
});

// Card rarity: every weapon or artifact card in a level-up offer rolls one (index = card.rar).
// Artifacts: the card adds perLevel × PASSIVE_BASE × mul. Weapons: +levels (capped by the max level) and +rerolls.
// Duos, evolutions, embers, healing and «Кузня удачи» have no rarity.
export const RARITIES = [
	{ id: 'common', name: 'Обычная', w: 70, mul: 1, levels: 1, rerolls: 0, color: '#9e9e9e' },
	{ id: 'rare', name: 'Редкая', w: 22, mul: 1.5, levels: 1, rerolls: 1, color: '#42a5f5' },
	{ id: 'epic', name: 'Эпическая', w: 7, mul: 2.2, levels: 2, rerolls: 0, color: '#ab47bc' },
	{ id: 'legend', name: 'Легендарная', w: 1, mul: 3.5, levels: 2, rerolls: 1, color: '#ffc107' },
];
// A common artifact card gives 75% of the old per-level step: the table average is ×1.22, players pick rarer cards.
export const PASSIVE_BASE = 0.75;
// Chest floors: an elite chest has at least a rare card, a boss chest at least an epic one.
export const CHEST_FLOOR = { elite: 1, boss: 2 };
// Fortune (Клевер + Подкова): weight of rarity i is w × (1 + fortune × i).
export const rarityWeights = (fortune = 0) => RARITIES.map((r, i) => r.w * (1 + Math.max(0, fortune) * i));
export function rollRarity(fortune = 0, floor = 0, rnd = Math.random) {
	const w = rarityWeights(fortune).map((x, i) => (i < floor ? 0 : x));
	let r = rnd() * w.reduce((a, b) => a + b, 0);
	for (let i = 0; i < w.length; i++) if ((r -= w[i]) < 0) return i;
	return w.length - 1;
}
const PASSIVE_INT = new Set(['maxHp']);
const PASSIVE_DEC = new Set(['regen', 'armor']);
// Value one artifact card adds, rounded to what the card shows.
export function passiveStep(id, rar = 0) {
	const P = PASSIVES[id];
	const v = P.perLevel * PASSIVE_BASE * (RARITIES[rar]?.mul ?? 1);
	if (PASSIVE_INT.has(P.stat)) return Math.round(v);
	if (PASSIVE_DEC.has(P.stat)) return Math.round(v * 10) / 10;
	return Math.round(v * 100) / 100;
}
export function passiveDesc(id, v) {
	const P = PASSIVES[id];
	if (!P.tpl) return P.desc;
	const a = Math.abs(v);
	const txt = PASSIVE_INT.has(P.stat) ? String(Math.round(a)) : PASSIVE_DEC.has(P.stat) ? String(a).replace('.', ',') : String(Math.round(a * 100));
	return P.tpl.replace('{v}', txt);
}

export const EMBER_WEAK = { frac: 0.6, dur: 3 };
export const BASE_MAGNET = 60;
export const GEM_PULL_SPEED = 420;

export const ENEMIES = {
	bat: { name: 'Тень', hp: 6, speed: 110, dmg: 5, r: 10, xp: 1, color: '#7e57c2' },
	ghoul: { name: 'Упырь', hp: 16, speed: 60, dmg: 8, r: 14, xp: 2, color: '#66bb6a' },
	wisp: { name: 'Огонёк', hp: 10, speed: 140, dmg: 6, r: 8, xp: 2, color: '#ffb74d' },
	skel: { name: 'Костяк', hp: 30, speed: 75, dmg: 10, r: 13, xp: 3, color: '#e0e0e0' },
	brute: { name: 'Громила', hp: 120, speed: 50, dmg: 18, r: 22, xp: 10, color: '#8d6e63' },
	// Final boss: shock ring around itself, ring of bolts, swarm call; all three faster below half hp.
	boss: {
		name: 'Владыка ночи', hp: 5000, speed: 70, dmg: 30, r: 40, xp: 150, color: '#d32f2f', boss: true, bk: 'lord',
		cd: 2.6, rage: 0.5, wave: { r: 190, warn: 1.2, dmg: 26 }, ring: { windup: 0.8, shots: 20, speed: 200, dmg: 12, life: 3 },
		call: { warn: 1.0, type: 'bat', count: 12, ring: 160 },
		// v21: charges in rage (the finale only), same fields as the Ram's.
		trigger: 480, dashWarn: 1.2, dashSpeed: 520, dashTime: 0.6, rest: 1.2, dashCd: 6,
	},
	// Summons rings of bats around the nearest player; takes ×2 damage while calling. Charges below half hp.
	brood: {
		name: 'Матерь роя', hp: 3000, speed: 60, dmg: 24, r: 44, xp: 100, color: '#7b1fa2', boss: true, bk: 'brood',
		callCd: 7, windup: 1.5, vuln: 2, call: { type: 'bat', count: 10, ring: 150 }, rage: 0.5,
		trigger: 420, dashWarn: 1.2, dashSpeed: 520, dashTime: 0.7, rest: 1.6,
	},
	// Telegraphed charges: a red lane for dashWarn seconds, then a straight dash.
	ram: {
		name: 'Рогач', hp: 2600, speed: 70, dmg: 24, r: 38, xp: 100, color: '#a1887f', boss: true, bk: 'ram',
		trigger: 480, dashWarn: 1.2, dashSpeed: 600, dashTime: 0.75, rest: 1.8,
	},
	// Keeps distance and fires rings of bone shards; two rings in a row below half hp.
	gunner: {
		name: 'Костяной органист', hp: 1500, speed: 65, dmg: 20, r: 36, xp: 100, color: '#b0bec5', boss: true, bk: 'gunner',
		keep: [180, 280], cd: 3.2, windup: 0.8, shots: 16, shotSpeed: 210, shotDmg: 12, shotLife: 3, rage: 0.5,
	},
	// Splits into two quick halves at half hp; the halves blink to the player after a marked spot.
	twin: {
		name: 'Двуликий', hp: 2800, speed: 80, dmg: 24, r: 40, xp: 60, color: '#26a69a', boss: true, bk: 'twin', splitAt: 0.5, halfHp: 0.32,
	},
	twinhalf: {
		name: 'Двуликий', hp: 1, speed: 110, dmg: 18, r: 28, xp: 40, color: '#4db6ac', boss: true, bk: 'half', blinkCd: 4.5, blinkWarn: 1.2, blinkDist: 220,
	},
	spitter: {
		name: 'Плевун', hp: 20, speed: 70, dmg: 6, r: 12, xp: 3, color: '#9ccc65',
		ai: 'ranged', keep: [260, 320], shotCd: 2.6, windup: 0.6, shotSpeed: 230, shotDmg: 8, shotLife: 2,
	},
	bloater: {
		name: 'Пузырь', hp: 14, speed: 95, dmg: 0, r: 13, xp: 2, color: '#ef9a9a',
		ai: 'exploder', fuse: 0.5, blastR: 60, blastDmg: 12, blastEnemyDmg: 30,
	},
	// v18 specials (SPECIALS): mid-run enemies a strong build cannot wipe before they come close.
	// Holds 350–450 px, backs off when approached; after a lane telegraph fires `fan` slow big orbs, aimed `lead` s ahead.
	sniper: {
		name: 'Трубач', hp: 60, speed: 100, dmg: 8, r: 17, xp: 14, color: '#80cbc4', special: true,
		ai: 'sniper', keep: [350, 450], shotCd: 3.2, windup: 0.9, shotSpeed: 170, shotDmg: 13, shotLife: 3.8, shotR: 13, fan: 5, spread: 0.2, lead: 0.8,
	},
	// Shield facing its target: hits from the front half-angle `arc` (degrees) deal ×front; sides and back take full damage.
	// Up close it bashes: a lane telegraph for dashWarn s, then a short dash (like Рогач).
	shield: {
		name: 'Щитоносец', hp: 150, speed: 44, dmg: 16, r: 21, xp: 16, color: '#90a4ae', special: true,
		ai: 'shield', front: 0.2, arc: 65, turn: 0.85, trigger: 230, dashWarn: 1.2, dashSpeed: 420, dashTime: 0.6, rest: 1.2, dashCd: 3,
	},
	// Event «Золотая тень»: slower than every hero, runs loops around the nearest player (away when close, back when far),
	// a kill drops a chest. Leaves after `life` s, or when farther than `escape` px from everyone after `grace` s (v18.1).
	// The first `show` s it only circles around the hero at the spot it appeared (no running off), so it is seen on a phone too.
	goldshade: {
		name: 'Золотая тень', hp: 180, speed: 115, dmg: 0, r: 13, xp: 20, color: '#ffd54f', special: true, ai: 'flee', life: 20, escape: 1600, grace: 8,
		near: 480, far: 780, turn: 3, show: 3, showSpeed: 1,
	},
};

// v19: every charge, blink and the Lord's shock wave warn ≥ WARN_MIN s ahead (a person needs ~1–1.5 s to react and step out).
export const WARN_MIN = 1.2;

// Numeric ids used in snapshots (index into this array).
// New types are appended at the end so old indexes stay valid.
export const ENEMY_TYPES = ['bat', 'ghoul', 'wisp', 'skel', 'brute', 'boss', 'spitter', 'bloater', 'brood', 'ram', 'gunner', 'twin', 'twinhalf', 'sniper', 'shield', 'goldshade'];
export const PROJECTILE_KINDS = ['bolt', 'knife', 'sickle', 'icedisc', 'spear'];
export const HOSTILE_R = 7;
export const WEAPON_IDS = Object.keys(WEAPONS);
export const PASSIVE_IDS = Object.keys(PASSIVES);

// Spawn table: from `at` seconds, spawn `rate` enemies per second (before player scaling), types weighted.
export const WAVES = [
	{ at: 0, rate: 1.2, types: { bat: 3, ghoul: 1 } },
	{ at: 60, rate: 2.0, types: { bat: 3, ghoul: 2, wisp: 1 } },
	{ at: 120, rate: 2.4, types: { bat: 3, ghoul: 2, wisp: 1, bloater: 0.6 } },
	{ at: 180, rate: 2.8, types: { ghoul: 3, wisp: 2, skel: 1, spitter: 0.5, bloater: 0.5 } },
	{ at: 270, rate: 3.5, types: { bat: 2, skel: 3, wisp: 2, brute: 0.3, spitter: 0.6 } },
	{ at: 420, rate: 4.5, types: { skel: 3, ghoul: 2, brute: 0.6, bloater: 0.6 } },
	{ at: 480, rate: 4.8, types: { skel: 3, ghoul: 1, brute: 0.6, spitter: 0.8, bloater: 0.6 } },
	{ at: 600, rate: 5.5, types: { skel: 3, wisp: 3, brute: 1, spitter: 0.5 } },
	{ at: 660, rate: 6.5, types: { skel: 3, wisp: 2, brute: 1.2, spitter: 0.8, bloater: 0.6 } },
	{ at: 780, rate: 8.5, types: { bat: 3, skel: 3, brute: 1.5, spitter: 0.8, bloater: 0.8 } },
];

// Pressure curve. Up to PRESSURE_FROM enemies grow as before (+12% hp per minute); after that hp grows faster
// (quadratic term) and contact/shot damage starts to grow, so the middle and the end keep up with player builds.
export const PRESSURE_FROM = 180;
// From ENDGAME_FROM the final stretch adds another quadratic factor so full builds still meet resistance.
export const PRESSURE = { hpLin: 0.12, hpQuad: 0.02, dmgPerMin: 0.06, endFrom: 540, endQuad: 0.08, endGroupMul: [0.4, 0.85], perPlayer: 0.55, perPlayerSq: 0.05 };
const lateMin = (seconds) => Math.max(0, seconds - PRESSURE_FROM) / 60;
// Groups (2+) out-level solo through team XP and stacked duos, so after PRESSURE_FROM they get extra hp and damage
// per minute (index = players - 1, 4+ use the last value). Solo gets a small hp relief that offsets the v8 evolution nerfs.
export const GROUP_LATE = { hpPerMin: [0.035, 0.11, 0.21, 0.32], dmgPerMin: [0, 0, 0.07, 0.1] };
const groupLate = (key, players) => GROUP_LATE[key][Math.min(Math.max(1, players), GROUP_LATE[key].length) - 1];
// Early grace for hp too: enemies born before EARLY_HP.until night seconds are tougher step by step (v15).
export const EARLY_HP = { from: 0.75, until: 480 };
const earlyHp = (seconds) => (seconds >= EARLY_HP.until ? 1 : EARLY_HP.from + (1 - EARLY_HP.from) * Math.max(0, seconds) / EARLY_HP.until);
export const enemyHpScale = (seconds, players) => earlyHp(seconds) * baseHpScale(seconds, players);
const baseHpScale = (seconds, players) => {
	const m = Math.floor(seconds / 60), late = Math.floor(lateMin(seconds));
	const end = Math.max(0, Math.floor((seconds - PRESSURE.endFrom) / 60));
	const endQuad = PRESSURE.endQuad * (PRESSURE.endGroupMul[players - 1] ?? 1);
	return (1 + PRESSURE.hpLin * m + PRESSURE.hpQuad * late * late) * (1 + endQuad * end * end) * (1 + PRESSURE.perPlayer * (players - 1) + PRESSURE.perPlayerSq * (players - 1) ** 2)
		* (1 + groupLate('hpPerMin', players) * late);
};
// Early grace (v15): enemy hits start at EARLY_DMG.from and reach full strength by EARLY_DMG.until (night seconds);
// live players died at 3–6 min long before their builds came together.
export const EARLY_DMG = { from: 0.6, until: 480 };
const earlyDmg = (seconds) => (seconds >= EARLY_DMG.until ? 1 : EARLY_DMG.from + (1 - EARLY_DMG.from) * Math.max(0, seconds) / EARLY_DMG.until);
export const enemyDmgScale = (seconds, players = 1) => earlyDmg(seconds) * (1 + (PRESSURE.dmgPerMin + groupLate('dmgPerMin', players)) * Math.floor(lateMin(seconds)));
// Invasions: from INVASION.from every INVASION.every seconds a ring of enemies closes in around every alive player.
// Small groups get smaller rings: none solo, duo ×0.75 (fewer weapons on screen per enemy).
// Big groups (4+) clear the middle too fast with duos and «Слаженность»: from 6:00 their rings are 25% larger.
export const INVASION = { from: 210, every: 60, radius: 430, base: 10, perMin: 2, max: 40, groupMul: [0, 0.75], bigFrom: 360, bigMul: 1.25 };
export const invasionCount = (seconds, players = 1) =>
	Math.round(Math.min(INVASION.max, INVASION.base + INVASION.perMin * (seconds / 60 - 3))
		* (INVASION.groupMul[players - 1] ?? (players >= 4 && seconds >= INVASION.bigFrom ? INVASION.bigMul : 1)));
// Peaks on top of WAVES, timed by run length (frac of it, or the `last` seconds of it) so shorter modes reuse them.
// Announced PEAK_WARN s ahead; peakSchedule moves a peak past a boss rather than the boss (bosses stay absolute).
// ring: a closing circle around every cluster of players; spawnMul/speedMul: regular spawn and enemy speed;
// ramp: seconds over which spawnMul grows from ×1; xpMul: xp of enemies born during the peak (pressure, not a free level); spawnDist: spawn ring radius multiplier;
// sight: client view radius multiplier; burn: at the end every enemy burns and the run is won.
export const PEAK_WARN = 4;
export const PEAK_BOSS_GAP = 8;
export const PEAKS = [
	{ id: 'ring', name: 'Кольцо', hint: 'Тени смыкаются вокруг вас — держитесь вместе', frac: 1 / 6, dur: 8, ring: { type: 'bat', count: 60, r: 420, cluster: 320 }, speedMul: 1.25, xpMul: 0.3 },
	{ id: 'tide', name: 'Прилив', hint: 'Орда вдвое гуще 20 секунд', frac: 1 / 2, dur: 20, spawnMul: 2, ramp: 6, capAdd: 60, xpMul: 0.2 },
	{ id: 'eclipse', name: 'Затмение', hint: 'Тьма сужает обзор на 30 секунд, враги выходят из неё совсем близко', frac: 5 / 6, dur: 30, sight: 0.7, spawnMul: 1.3, spawnDist: 0.65, capAdd: 40, xpMul: 0.5 },
	// v21: the last seconds of the fight with the Lord — no extra horde, everything is faster.
	{ id: 'dawn', name: 'Светает', hint: 'Рассвет близко: добейте Владыку или продержитесь', last: 15, speedMul: 1.25, burn: true },
];
// Absolute schedule for a run: [{...peak, i, at, dur}].
export function peakSchedule(runLength = RUN_SECONDS, bossTimes = BOSS_TIMES) {
	return PEAKS.map((p, i) => {
		let at = p.last ? runLength - p.last : Math.round(runLength * p.frac);
		// A peak tied to the end of the run (`last`) lies inside the fight with the Lord and never moves.
		for (const b of p.last ? [] : bossTimes) {
			if (Math.abs(at - b) < PEAK_BOSS_GAP || Math.abs(at - PEAK_WARN - b) < PEAK_BOSS_GAP) at = b + PEAK_BOSS_GAP + PEAK_WARN;
		}
		return { ...p, i, at, dur: p.last ? runLength - at : p.dur };
	});
}

// v18 specials on top of WAVES, timed by run length like PEAKS: from `from` of the run one more of the type every `every`
// night seconds while fewer than max[players - 1] are alive (the last value for bigger groups); from `late` the cap is lateMax.
export const SPECIALS = {
	sniper: { from: 0.4, every: 20, max: [3, 3, 5], late: 0.7, lateMax: [4, 4, 6] },
	shield: { from: 0.45, every: 20, max: [2, 3, 4], late: 0.7, lateMax: [3, 4, 6] },
};
export const specialCap = (S, frac, players) => {
	if (frac < S.from) return 0;
	const m = frac >= S.late ? S.lateMax : S.max;
	return m[Math.min(Math.max(1, players), m.length) - 1];
};
// Shield facing angle travels in enemy state bits above ST (16 directions).
export const SHIELD_DIRS = 16;
export const SHIELD_SHIFT = 9;

// Wave 4 random events: one at a time, the first at `from` of the run, then every gap[0]–gap[1] real seconds,
// never next to a peak or a boss spawn. One event for the whole group (any number of players).
// Snapshot `ev`: [index, seconds left, phase, x, y, r, a, b] — see DESIGN.md «События».
export const EVENT_RULES = { from: 0.12, gap: [90, 120], peakGap: 8, bossGap: 12, retry: 10 };
export const EVENTS = [
	{
		id: 'star', name: 'Падающая звезда', arrow: 'Звезда', hint: 'Звезда упадёт в красный круг — выйдите из него. На месте удара останется осколок звезды',
		warn: 3.5, r: 150, pdmg: 30, bigFrac: 0.25, done: ['Осколок звезды ждёт на месте удара', 'Осколок звезды забран: опыт и здоровье всем'],
	},
	{
		id: 'gold', name: 'Золотая тень', arrow: 'Тень', banner: 'Золотая тень! Догони за 20 с', hint: 'Догоните и убейте золотую тень, пока не сбежала: за неё сундук',
		dist: 240, done: ['Золотая тень сбежала', 'Золотая тень поймана — сундук!'],
	},
	{
		id: 'fog', name: 'Красный туман', hint: 'В тумане враги злее и быстрее, зато опыта с них вдвое больше',
		dur: 30, r: 300, dmgMul: 1.3, speedMul: 1.15, xpMul: 2, done: ['Красный туман рассеялся'],
	},
	{
		id: 'altar', name: 'Алтарь', arrow: 'Алтарь', hint: 'Встаньте на алтарь, чтобы принять сделку. Не хотите — пройдите мимо, штрафа нет',
		life: 30, r: 34, dist: 220, done: ['Алтарь угас', 'Сделка заключена'],
	},
	{
		id: 'cursed', name: 'Проклятый сундук', arrow: 'Сундук', hint: 'Откройте сундук — нахлынет волна. Продержитесь 20 с, и каждому выпадет эпическая награда',
		life: 35, r: 28, dist: 230, hold: 20, ring: 380, base: 16, perMin: 1.6, done: ['Проклятый сундук остался закрыт', 'Волна пережита — эпическая награда!', 'Волна не пережита'],
	},
	{
		id: 'streak', name: 'Серия убийств', hint: 'Убейте {n} врагов за {t} с — короткий бонус урона и магнит для всех',
		dur: 20, pace: 1.0, min: 30, bonus: { mul: 1.3, dur: 12 }, done: ['Серия сорвалась', 'Серия! +30% урона на 12 с и кристаллы к вам'],
	},
];
export const EVENT_INDEX = Object.fromEntries(EVENTS.map((e, i) => [e.id, i]));
// Altar deals: the cost is paid on the spot or lasts `dur`, the boon lasts `dur`.
export const ALTAR_DEALS = [
	{ id: 'blood', name: 'Кровь за силу', desc: '−30% здоровья сейчас → +40% урона на 45 с', hpCost: 0.3, dmgMul: 1.4, dur: 45 },
	{ id: 'greed', name: 'Жадность', desc: '+35% получаемого урона на 45 с → ×1,6 опыта на 45 с', takenMul: 1.35, xpMul: 1.6, dur: 45 },
];
export const STAR_SHARD = { lvlFrac: 0.3, heal: 20 };

// Per-player spawn stays close to solo (1.0, 0.85, 0.78 for 1, 2, 4 players) so groups do not get it easier.
export const spawnRateScale = (players) => 0.3 + 0.7 * players;
export const SPAWN_DISTANCE = { min: 520, max: 680 };

// Deterministic visual formulas shared by server and client.
export const orbitAngle = (gameTime, rps, index, count) => gameTime * rps * Math.PI * 2 + (index * Math.PI * 2) / count;

// --- Wave 0/1 systems ---

// Duos (5.8): two weapons of one player, both at level ≥ DUO_MIN_LEVEL, fuse into a new weapon with its own
// attack. The duo takes the first weapon's slot, the second slot frees up. Levels I–III; at most MAX_DUOS per player.
// Pairs are matched in one place on the server (Room.updateCombos).
export const MAX_DUOS = 2;
// Fusion retains both attacks, then adds the signature interaction. These are combat multipliers, not offer odds.
export const DUO_INHERIT_POWER = 1.2;
export const DUO_SIGNATURE_POWER = 0.35;
export const duoPartLevel = (level) => Math.min(5, level + 2);
export const DUO_MIN_LEVEL = 3;
export const DUO_MAX_LEVEL = 3;
export const DUO_DEFER_OFFERS = 2; // a declined duo card comes back after this many offers
export const SYNERGY_PER = 0.04; // «Слаженность»: team damage per unique duo in the party
export const SYNERGY_MAX = 0.2;
export const duoStartLevel = (partLevels) => (partLevels >= 10 ? 3 : partLevels >= 8 ? 2 : 1);
export const DUOS = {
	thunderslash: {
		name: 'Громовой разрез', icon: '⚡', parts: ['whip', 'lightning'], tags: ['phys', 'shock'],
		desc: 'Удар в обе стороны; задетых через миг бьёт молния с цепью, каждый 3-й удар — веер молний',
		levels: [
			{ dmg: 21, cd: 1.0, range: 150, width: 62, rodFrac: 0.45, chain: 2, fanDmg: 28, fan: 5 },
			{ dmg: 30, cd: 0.9, range: 165, width: 66, rodFrac: 0.45, chain: 3, fanDmg: 42, fan: 5 },
			{ dmg: 37, cd: 0.8, range: 180, width: 70, rodFrac: 0.45, chain: 4, fanDmg: 51, fan: 5 },
		],
	},
	orb: {
		name: 'Шаровая молния', icon: '◉', parts: ['bolt', 'lightning'], tags: ['shock', 'aoe'],
		desc: 'Шар летит к самой плотной группе врагов, разрядами бьёт всех рядом и взрывается',
		levels: [
			{ dmg: 2, zap: 20, cd: 2.6, count: 1, radius: 75, tick: 0.4, speed: 200, life: 4, boom: 14, boomR: 100 },
			{ dmg: 4, zap: 30, cd: 2.4, count: 1, radius: 82, tick: 0.4, speed: 210, life: 4, boom: 29, boomR: 105 },
			{ dmg: 4, zap: 25, cd: 2.2, count: 2, radius: 90, tick: 0.4, speed: 220, life: 4, boom: 30, boomR: 110 },
		],
	},
	orrery: {
		name: 'Планетарий', icon: '✺', parts: ['bolt', 'orbit'], tags: ['proj'],
		desc: 'Искры кружат вокруг и срываются в подошедших врагов',
		levels: [
			{ dmg: 24, count: 4, radius: 90, rps: 0.5, trigger: 220, respawn: 0.6, pierce: 3, speed: 460 },
			{ dmg: 42, count: 5, radius: 90, rps: 0.5, trigger: 220, respawn: 0.6, pierce: 3, speed: 480 },
			{ dmg: 56, count: 6, radius: 90, rps: 0.5, trigger: 220, respawn: 0.6, pierce: 3, speed: 500 },
		],
	},
	windmill: {
		name: 'Мельница', icon: '✢', parts: ['orbit', 'whip'], tags: ['phys'],
		desc: 'Длинные лопасти вращаются вокруг героя и откидывают врагов',
		levels: [
			{ dmg: 16, count: 2, len: 170, width: 22, rps: 0.5, hitCd: 0.4, kb: 10 },
			{ dmg: 20, count: 3, len: 185, width: 22, rps: 0.5, hitCd: 0.4, kb: 10 },
			{ dmg: 27, count: 4, len: 200, width: 24, rps: 0.5, hitCd: 0.4, kb: 10 },
		],
	},
	tripwire: {
		name: 'Растяжка', icon: '⋈', parts: ['knives', 'traps'], tags: ['phys', 'trap'],
		desc: 'Капканы связаны режущей нитью; промахнувшиеся ножи становятся шипами',
		levels: [
			{ dmg: 11, cd: 0.55, count: 3, speed: 640, pierce: 2, spread: 0.12, max: 4, link: 220, wireDmg: 2.5, wireTick: 0.3, rearm: 2.5, trapDmg: 26, trapCd: 1.6, root: 1.2, radius: 28, spikeDmg: 2, spikeLife: 4, spikeRoot: 0.5 },
			{ dmg: 14, cd: 0.5, count: 4, speed: 660, pierce: 2, spread: 0.1, max: 5, link: 220, wireDmg: 3, wireTick: 0.3, rearm: 2.5, trapDmg: 35, trapCd: 1.4, root: 1.4, radius: 30, spikeDmg: 2, spikeLife: 4, spikeRoot: 0.5 },
			{ dmg: 17, cd: 0.45, count: 5, speed: 700, pierce: 3, spread: 0.1, max: 6, link: 220, wireDmg: 6, wireTick: 0.3, rearm: 2.5, trapDmg: 42, trapCd: 1.2, root: 1.6, radius: 32, spikeDmg: 4, spikeLife: 4, spikeRoot: 0.5 },
		],
	},
	fanback: {
		name: 'Возвратный веер', icon: '⟲', parts: ['knives', 'sickle'], tags: ['phys', 'proj'],
		desc: 'Веер ножей разворачивается и режет на обратном пути',
		levels: [
			{ dmg: 14, cd: 0.8, count: 5, range: 240, speed: 600, spread: 0.13 },
			{ dmg: 18, cd: 0.7, count: 6, range: 240, speed: 620, spread: 0.12 },
			{ dmg: 24, cd: 0.6, count: 7, range: 240, speed: 640, spread: 0.11 },
		],
	},
	molotov: {
		name: 'Коктейль', icon: '♨', parts: ['bomb', 'flask'], tags: ['fire', 'aoe'],
		desc: 'Взрыв оставляет горящую лужу',
		levels: [
			{ dmg: 81, cd: 2.3, count: 1, radius: 70, fuse: 0.6, pool: 2.5, poolDmg: 12, tick: 0.3 },
			{ dmg: 82, cd: 2.1, count: 2, radius: 78, fuse: 0.6, pool: 3, poolDmg: 13, tick: 0.3 },
			{ dmg: 124, cd: 1.9, count: 2, radius: 86, fuse: 0.6, pool: 3.5, poolDmg: 16, tick: 0.3 },
		],
	},
	minefield: {
		name: 'Минное поле', icon: '◈', parts: ['bomb', 'traps'], tags: ['fire', 'aoe', 'trap'],
		desc: 'Капканы становятся минами, которые перезаряжаются',
		levels: [
			{ dmg: 68, cd: 1.6, max: 5, radius: 80, kb: 0, recharge: 6, trigger: 26 },
			{ dmg: 92, cd: 1.4, max: 6, radius: 90, kb: 0, recharge: 6, trigger: 28 },
			{ dmg: 160, cd: 1.2, max: 8, radius: 100, kb: 0, recharge: 6, trigger: 30 },
		],
	},
	icebomb: {
		signaturePower: 0.42, name: 'Ледяная граната', icon: '❅', parts: ['bomb', 'frost'], tags: ['cold', 'aoe'],
		desc: 'Взрыв замораживает, замёрзшие раскалываются осколками',
		levels: [
			{ dmg: 55, cd: 2.4, count: 1, radius: 80, fuse: 0.6, freeze: 1.0, shardR: 40, shardFrac: 0.5 },
			{ dmg: 56, cd: 2.2, count: 2, radius: 90, fuse: 0.6, freeze: 1.2, shardR: 40, shardFrac: 0.5 },
			{ dmg: 78, cd: 2.0, count: 2, radius: 100, fuse: 0.6, freeze: 1.5, shardR: 40, shardFrac: 0.5 },
		],
	},
	aurora: {
		name: 'Полярное сияние', icon: '❋', parts: ['aura', 'frost'], tags: ['cold', 'aoe'],
		desc: 'Холодный ореол; раз в 3 с волна замораживает',
		levels: [
			{ dmg: 11, tick: 0.4, radius: 110, slow: 0.3, pulse: 3, freeze: 0.8 },
			{ dmg: 16, tick: 0.4, radius: 125, slow: 0.35, pulse: 3, freeze: 1.0 },
			{ dmg: 19, tick: 0.4, radius: 140, slow: 0.4, pulse: 3, freeze: 1.2 },
		],
	},
	censer: {
		name: 'Кадило', icon: '☁', parts: ['aura', 'flask'], tags: ['aoe'],
		desc: 'Шлейф облаков: врагам урон, союзникам лечение',
		levels: [
			{ dmg: 9, every: 0.4, radius: 45, life: 3, tick: 0.4, heal: 2 },
			{ dmg: 16, every: 0.4, radius: 50, life: 3, tick: 0.4, heal: 3 },
			{ dmg: 29, every: 0.4, radius: 55, life: 3, tick: 0.4, heal: 4 },
		],
	},
	icedisc: {
		inheritPower: 1.4, name: 'Ледяной диск', icon: '❂', parts: ['frost', 'sickle'], tags: ['cold', 'phys', 'proj'],
		desc: 'Диск оставляет ледяной след и замораживает на обратном пути',
		levels: [
			{ dmg: 68, cd: 1.3, count: 1, range: 300, speed: 520, trailR: 24, trailLife: 2.5, trailSlow: 0.4, freeze: 0.6 },
			{ dmg: 69, cd: 1.2, count: 2, range: 320, speed: 540, trailR: 24, trailLife: 2.5, trailSlow: 0.4, freeze: 0.8 },
			{ dmg: 96, cd: 1.1, count: 2, range: 340, speed: 560, trailR: 24, trailLife: 2.5, trailSlow: 0.4, freeze: 1.0 },
		],
	},
	stormlight: {
		inheritPower: 1.5, name: 'Прожектор бури', icon: '🔦', parts: ['lantern', 'lightning'], tags: ['shock', 'aoe'],
		desc: 'Луч метит врагов, в луче бьют молнии; цепь только по помеченным',
		levels: [
			{ dmg: 4, tick: 0.4, range: 260, angle: 70, mark: 0.25, strikeCd: 0.8, strikeDmg: 28, chain: 2 },
			{ dmg: 5, tick: 0.4, range: 290, angle: 80, mark: 0.30, strikeCd: 0.7, strikeDmg: 38, chain: 3 },
			{ dmg: 7, tick: 0.4, range: 320, angle: 90, mark: 0.35, strikeCd: 0.6, strikeDmg: 52, chain: 4 },
		],
	},
	volley: {
		name: 'Залп', icon: '⇶', parts: ['knives', 'spear'], tags: ['phys', 'proj'],
		desc: 'Копьё в сильнейшего на лету роняет веер ножей в стороны',
		levels: [
			{ dmg: 99, cd: 1.9, count: 1, pierce: 8, width: 18, speed: 720, kb: 50, knifeDmg: 18, every: 65 },
			{ dmg: 133, cd: 1.7, count: 1, pierce: 10, width: 20, speed: 740, kb: 60, knifeDmg: 23, every: 60 },
			{ dmg: 134, cd: 1.5, count: 2, pierce: 99, width: 22, speed: 780, kb: 70, knifeDmg: 24, every: 60 },
		],
	},
	phalanx: {
		name: 'Фаланга', icon: '⫼', parts: ['spear', 'ward'], tags: ['phys', 'proj'],
		desc: 'Стена из копий бьёт вперёд; сломанный щит взрывается кольцом копий',
		levels: [
			{ charges: 2, cd: 9, dmg: 30, atkCd: 2.2, wall: 3, pierce: 6, width: 18, speed: 700, kb: 60, ring: 8 },
			{ charges: 2, cd: 8, dmg: 40, atkCd: 2.0, wall: 3, pierce: 8, width: 20, speed: 720, kb: 70, ring: 10 },
			{ charges: 3, cd: 7, dmg: 37, atkCd: 1.8, wall: 4, pierce: 99, width: 22, speed: 760, kb: 80, ring: 12 },
		],
	},
	firewheel: {
		name: 'Огненное колесо', icon: '☸', parts: ['orbit', 'trail'], tags: ['fire', 'aoe'],
		desc: 'Огненные колёса кружат, поджигают врагов и оставляют горящий круг',
		levels: [
			{ dmg: 16, count: 3, radius: 95, rps: 0.55, hitCd: 0.4, burn: 7, every: 0.25, patchR: 26, patchLife: 1.6, patchDmg: 5, tick: 0.3 },
			{ dmg: 24, count: 4, radius: 100, rps: 0.55, hitCd: 0.4, burn: 10, every: 0.2, patchR: 28, patchLife: 1.8, patchDmg: 7, tick: 0.3 },
			{ dmg: 42, count: 5, radius: 105, rps: 0.55, hitCd: 0.35, burn: 18, every: 0.18, patchR: 30, patchLife: 2.0, patchDmg: 11, tick: 0.3 },
		],
	},
	// v24 (связки v2, поставка А): по 4 связки на оружие, см. pm/DUOS-v2-design.md.
	guide: {
		name: 'Путеводный огонь', icon: '✧', parts: ['bolt', 'lantern'], tags: ['proj', 'aoe'],
		desc: 'Луч метит группу, искры летят в помеченных и продлевают метку; помеченный враг при смерти выпускает искру',
		levels: [
			{ dmg: 4, tick: 0.45, range: 260, angle: 60, mark: 0.22, sparkDmg: 20, sparkCd: 0.7, count: 2, pierce: 2, speed: 480, deathSparks: 1 },
			{ dmg: 5, tick: 0.45, range: 280, angle: 65, mark: 0.26, sparkDmg: 26, sparkCd: 0.65, count: 3, pierce: 2, speed: 490, deathSparks: 1 },
			{ dmg: 6, tick: 0.4, range: 300, angle: 70, mark: 0.30, sparkDmg: 32, sparkCd: 0.6, count: 4, pierce: 3, speed: 500, deathSparks: 2 },
		],
	},
	sunspear: {
		name: 'Солнечное копьё', icon: '☀', parts: ['spear', 'lantern'], tags: ['phys', 'proj'],
		desc: 'Копьё в сильнейшего оставляет полосу света: все в ней помечены и получают больше урона от всех',
		levels: [
			{ dmg: 55, cd: 2.0, count: 1, pierce: 8, width: 18, speed: 740, kb: 50, laneR: 20, laneLife: 2, mark: 0.22, laneDmg: 12, tick: 0.4 },
			{ dmg: 72, cd: 1.8, count: 1, pierce: 10, width: 20, speed: 760, kb: 60, laneR: 22, laneLife: 2, mark: 0.27, laneDmg: 12, tick: 0.4 },
			{ dmg: 90, cd: 1.6, count: 1, pierce: 99, width: 22, speed: 780, kb: 70, laneR: 24, laneLife: 2.2, mark: 0.32, laneDmg: 14, tick: 0.4 },
		],
	},
	glow: {
		name: 'Зарево', icon: '🔆', parts: ['lantern', 'trail'], tags: ['fire', 'aoe'],
		desc: 'Луч метит и поджигает; помеченный горящий враг при смерти оставляет горящее пятно',
		levels: [
			{ dmg: 15, tick: 0.45, range: 240, angle: 60, mark: 0.20, burn: 12, patchR: 30, patchLife: 2, patchDmg: 6, patchTick: 0.3 },
			{ dmg: 21, tick: 0.45, range: 260, angle: 65, mark: 0.24, burn: 20, patchR: 34, patchLife: 2.2, patchDmg: 8, patchTick: 0.3 },
			{ dmg: 32, tick: 0.4, range: 290, angle: 70, mark: 0.28, burn: 36, patchR: 38, patchLife: 2.5, patchDmg: 10, patchTick: 0.3 },
		],
	},
	dome: {
		name: 'Купол', icon: '⛫', parts: ['aura', 'ward'], tags: ['aoe'],
		desc: 'Пока у щита есть заряд, ореол шире и сильнее; каждый поглощённый удар — вспышка ореола',
		levels: [
			{ dmg: 7, tick: 0.4, radius: 100, chargeMul: 1.3, chargeArea: 1.15, charges: 2, cd: 9, burstDmg: 30, burstR: 120, kb: 70 },
			{ dmg: 9, tick: 0.4, radius: 110, chargeMul: 1.3, chargeArea: 1.15, charges: 2, cd: 8, burstDmg: 40, burstR: 130, kb: 80 },
			{ dmg: 11, tick: 0.4, radius: 120, chargeMul: 1.35, chargeArea: 1.15, charges: 3, cd: 7, burstDmg: 52, burstR: 140, kb: 90 },
		],
	},
	riposte: {
		name: 'Контрудар', icon: '⚔', parts: ['whip', 'ward'], tags: ['phys'],
		desc: 'Удар клинка в обе стороны; поглощённый щитом удар сразу отвечает круговым ударом с удвоенным уроном',
		levels: [
			{ dmg: 20, atkCd: 1.0, range: 150, width: 56, charges: 2, cd: 9, ripMul: 2, ripR: 160, kb: 80 },
			{ dmg: 26, atkCd: 0.9, range: 160, width: 60, charges: 2, cd: 8, ripMul: 2, ripR: 170, kb: 80 },
			{ dmg: 30, atkCd: 0.85, range: 175, width: 64, charges: 3, cd: 7, ripMul: 2.5, ripR: 180, kb: 90 },
		],
	},
	rod: {
		name: 'Громоотвод', icon: '🗲', parts: ['lightning', 'ward'], tags: ['shock', 'aoe'],
		desc: 'Молнии бьют ближайших к герою врагов; поглощённый щитом удар — молния в ближайшего с длинной цепью',
		levels: [
			{ dmg: 30, atkCd: 1.6, strikes: 2, chain: 2, radius: 260, charges: 2, cd: 9, counter: 45, counterChain: 3 },
			{ dmg: 36, atkCd: 1.5, strikes: 3, chain: 2, radius: 270, charges: 2, cd: 8, counter: 55, counterChain: 3 },
			{ dmg: 44, atkCd: 1.3, strikes: 3, chain: 3, radius: 280, charges: 3, cd: 7, counter: 70, counterChain: 4 },
		],
	},
	pitch: {
		name: 'Смола', icon: '♨', parts: ['flask', 'trail'], tags: ['fire', 'aoe'],
		desc: 'За героем тянется горящая смола: широкие лужи жгут и замедляют',
		levels: [
			{ dmg: 12, every: 0.3, radius: 34, dur: 3, tick: 0.3, burn: 8, slow: 0.2, max: 12 },
			{ dmg: 18, every: 0.28, radius: 38, dur: 3.2, tick: 0.3, burn: 11, slow: 0.25, max: 13 },
			{ dmg: 26, every: 0.25, radius: 42, dur: 3.5, tick: 0.3, burn: 18, slow: 0.3, max: 15 },
		],
	},
	firescythe: {
		name: 'Огненный серп', icon: '☾', parts: ['sickle', 'trail'], tags: ['fire', 'phys', 'proj'],
		desc: 'Серп летит к врагу и возвращается, оставляя горящую полосу; задетых поджигает',
		levels: [
			{ dmg: 30, cd: 1.3, count: 1, range: 300, speed: 520, patchR: 24, patchLife: 2, patchDmg: 7, tick: 0.3, burn: 5.5, every: 40 },
			{ dmg: 36, cd: 1.2, count: 2, range: 320, speed: 540, patchR: 24, patchLife: 2, patchDmg: 6, tick: 0.3, burn: 5, every: 40 },
			{ dmg: 46, cd: 1.1, count: 2, range: 340, speed: 560, patchR: 28, patchLife: 2.2, patchDmg: 10.5, tick: 0.3, burn: 9, every: 40 },
		],
	},
	// v28 (связки v2, поставка Б).
	frostsnare: {
		inheritPower: 2, signaturePower: 0.8, name: 'Ледяные силки', icon: '❄', parts: ['frost', 'traps'], tags: ['cold', 'phys', 'trap'],
		desc: 'Сработавший капкан взрывается волной холода: всех вокруг замедляет и замораживает',
		levels: [
			{ dmg: 32, cd: 1.6, max: 6, root: 1.4, radius: 30, waveR: 70, waveDmg: 46, slow: 0.4, slowDur: 2, freeze: 0.8 },
			{ dmg: 50, cd: 1.4, max: 7, root: 1.5, radius: 31, waveR: 80, waveDmg: 52, slow: 0.4, slowDur: 2, freeze: 1.0 },
			{ dmg: 62, cd: 1.2, max: 8, root: 1.7, radius: 32, waveR: 90, waveDmg: 57, slow: 0.45, slowDur: 2.2, freeze: 1.2 },
		],
	},
	abatis: {
		name: 'Засека', icon: '⚔', parts: ['whip', 'traps'], tags: ['phys', 'trap'],
		desc: 'Удар клинка оставляет капкан на конце дуги; по врагу в корнях клинок бьёт в полтора раза сильнее',
		levels: [
			{ dmg: 29, cd: 1.1, range: 140, width: 50, traps: 1, max: 6, trapDmg: 36, root: 1.3, radius: 30, rootMul: 1.5 },
			{ dmg: 36, cd: 1.0, range: 150, width: 52, traps: 1, max: 7, trapDmg: 46, root: 1.5, radius: 31, rootMul: 1.5 },
			{ dmg: 47, cd: 0.9, range: 165, width: 56, traps: 2, max: 8, trapDmg: 59, root: 1.7, radius: 32, rootMul: 1.5 },
		],
	},
	harpoon: {
		name: 'Гарпун', icon: '⥉', parts: ['sickle', 'spear'], tags: ['phys', 'proj'],
		desc: 'Копьё на цепи летит в сильнейшего, пробивает строй и возвращается, на обратном пути бьёт ещё раз',
		levels: [
			{ dmg: 92, cd: 1.8, count: 1, pierce: 8, range: 340, width: 18, speed: 720, kb: 50 },
			{ dmg: 88, cd: 1.6, count: 1, pierce: 10, range: 360, width: 20, speed: 740, kb: 60 },
			{ dmg: 84, cd: 1.5, count: 2, pierce: 99, range: 380, width: 22, speed: 760, kb: 70 },
		],
	},
	rockets: {
		name: 'Ракетница', icon: '➹', parts: ['bolt', 'bomb'], tags: ['proj', 'fire', 'aoe'],
		desc: 'Искры-ракеты летят к самой плотной группе и взрываются при попадании, поджигая',
		levels: [
			{ dmg: 51, cd: 1.2, count: 2, speed: 440, radius: 55, burn: 3 },
			{ dmg: 50, cd: 1.1, count: 3, speed: 450, radius: 60, burn: 4 },
			{ dmg: 82, cd: 1.0, count: 4, speed: 460, radius: 66, burn: 5 },
		],
	},
	stingers: {
		name: 'Ядовитые жала', icon: '➶', parts: ['knives', 'flask'], tags: ['phys', 'proj', 'aoe'],
		desc: 'Веер ножей; нож, попав или упав, разбивается каплей — малой лужей яда',
		levels: [
			{ dmg: 11, cd: 0.55, count: 3, speed: 640, pierce: 2, spread: 0.12, dropR: 32, dropLife: 1.8, dropDmg: 7, tick: 0.4, max: 12 },
			{ dmg: 13, cd: 0.5, count: 4, speed: 660, pierce: 2, spread: 0.11, dropR: 36, dropLife: 1.8, dropDmg: 12, tick: 0.4, max: 12 },
			{ dmg: 16, cd: 0.45, count: 5, speed: 700, pierce: 3, spread: 0.1, dropR: 40, dropLife: 2.2, dropDmg: 16, tick: 0.4, max: 12 },
		],
	},
	whirlwind: {
		name: 'Смерч', icon: '🌀', parts: ['orbit', 'aura'], tags: ['phys', 'aoe'],
		desc: 'Ореол-вихрь медленно стягивает врагов к кольцу кружащих клинков',
		levels: [
			{ dmg: 5, tick: 0.45, radius: 110, count: 3, bladeDmg: 14, ring: 100, rps: 0.7, hitCd: 0.4, pull: 30 },
			{ dmg: 6, tick: 0.45, radius: 120, count: 4, bladeDmg: 18, ring: 110, rps: 0.7, hitCd: 0.4, pull: 35 },
			{ dmg: 8, tick: 0.4, radius: 130, count: 5, bladeDmg: 22, ring: 120, rps: 0.75, hitCd: 0.4, pull: 40 },
		],
	},
};
Object.assign(DUOS, CONFLUENCES);
export const DUO_IDS = Object.keys(DUOS);
export const duoKey = (a, b) => (a < b ? `${a}+${b}` : `${b}+${a}`);
export const DUO_BY_PAIR = Object.fromEntries(DUO_IDS.map((id) => [duoKey(...DUOS[id].parts), id]));
// Affinity (v24, связки v2): two plain weapons of one player with no duo between them. An enemy hit by one of them and
// within AFFINITY_WINDOW s by the other gets the rule's effect on the second hit, at most once per AFFINITY_EVERY s per enemy and pair.
// The rule comes from the two weapons' roles (WEAPONS[id].role). Numbers fitted on `AFF=1 node pm/duo-bench.mjs`.
export const ROLES = {
	ring: { name: 'Круг', icon: '●', desc: 'бьёт вокруг героя' },
	shot: { name: 'Выстрел', icon: '➶', desc: 'летит к врагу' },
	trace: { name: 'След', icon: '▲', desc: 'оставляет на поле лужу, огонь, капкан, взрыв или метку' },
};
export const AFFINITY_WINDOW = 1.5;
export const AFFINITY_EVERY = 1;
export const AFFINITY = {
	vise: { roles: ['ring', 'ring'], name: 'Тиски', icon: '⊂⊃', desc: 'удар по врагу, только что задетому другим, +35% урона', mul: 0.35 },
	crossfire: { roles: ['shot', 'shot'], name: 'Перекрёстный огонь', icon: '✕', desc: '+40% к шансу крита по врагу, только что задетому другим', crit: 0.4 },
	soak: { roles: ['trace', 'trace'], name: 'Пропитка', icon: '≈', desc: 'враг, задетый обоими, 2 с получает от ваших следов +15%', mul: 0.15, dur: 2 },
	recoil: { roles: ['ring', 'shot'], name: 'Отдача', icon: '⇤', desc: 'перекрёстный удар бьёт на 50% сильнее и чуть откидывает', mul: 0.5, kb: 10 },
	drag: { roles: ['ring', 'trace'], name: 'Вязкость', icon: '≋', desc: 'перекрёстный удар бьёт на 45% сильнее и замедляет на 15% на 1 с (не холод)', mul: 0.45, slow: 0.15, dur: 1 },
	aim: { roles: ['shot', 'trace'], name: 'Наводка', icon: '◎', desc: 'перекрёстный удар метит на 2 с: +16% урона от всех, поверх других меток', vuln: 0.16, dur: 2 },
};
export const AFFINITY_IDS = Object.keys(AFFINITY);
const roleKey = (a, b) => [a, b].sort().join('+');
const AFFINITY_BY_ROLES = Object.fromEntries(AFFINITY_IDS.map((id) => [roleKey(...AFFINITY[id].roles), id]));
// Affinity rule id of two plain weapons, or null (same weapon, not plain, or the pair has a duo).
export const affinityOf = (a, b) => {
	if (a === b || !WEAPONS[a] || !WEAPONS[b] || DUO_BY_PAIR[duoKey(a, b)]) return null;
	return AFFINITY_BY_ROLES[roleKey(WEAPONS[a].role, WEAPONS[b].role)] ?? null;
};

// The carrier keeps its level and attack. The other weapon becomes its imprint.
export const FORGE_MIN_LEVEL = 3;
export const FORGE_RECIPES = {
	[duoKey('sickle', 'frost')]: {
		sickle: { name: 'Морозный след', desc: 'Возвращаясь, Серп оставляет замедляющий след.' },
		frost: { name: 'Ледяные серпы', desc: 'Волна Инея выпускает три возвращающихся серпа.' },
	},
	[duoKey('flask', 'lightning')]: {
		flask: { name: 'Живая вода', desc: 'Первый удар каждой лужи вызывает молнию и запускает «Проводник».' },
		lightning: { name: 'Ливень', desc: 'Первый удар Грозы оставляет лужу, проводящую следующие разряды.' },
	},
};
export const forgeRecipe = (carrier, donor) => FORGE_RECIPES[duoKey(carrier, donor)]?.[carrier];
// Evolutions (5.4): weapon at level 5 + its artifact at any level → a single-level weapon that replaces it.
// The artifact stays; an evolved weapon cannot join a duo, a weapon in a duo cannot evolve.
export const EVOS = {
	swarm: {
		name: 'Рой светляков', icon: '❋', from: 'bolt', requires: 'echo', tags: ['proj'], color: '#ce93d8',
		desc: '6 искр, попав, распадаются на 2 искорки', levels: [{ dmg: 19, cd: 0.55, count: 6, speed: 520, pierce: 1, split: 2 }],
	},
	crescent: {
		name: 'Полумесяц', icon: '☽', from: 'whip', requires: 'might', tags: ['phys'], color: '#90caf9',
		desc: 'Удар по кругу; +1 здоровья за убийство (до 3/с)', levels: [{ dmg: 45, cd: 0.8, radius: 170, heal: 1, healCap: 3 }],
	},
	bladestorm: {
		name: 'Ливень лезвий', icon: '✴', from: 'knives', requires: 'haste', tags: ['phys', 'proj'], color: '#eceff1',
		desc: 'Очередь из 6 ножей по кругу, пробивают строй', levels: [{ dmg: 18, cd: 0.9, count: 6, gap: 0.15, speed: 700, pierce: 6 }],
	},
	millstones: {
		name: 'Жернова', icon: '⊚', from: 'orbit', requires: 'mail', tags: ['phys'], color: '#b0bec5',
		desc: 'Два кольца молотов крутятся в разные стороны', levels: [{ dmg: 24, count: 6, radius: 85, radius2: 135, rps: 0.7, hitCd: 0.35, kb: 30 }],
	},
	tocsin: {
		name: 'Набат', icon: '🔔', from: 'aura', requires: 'regen', tags: ['aoe'], color: '#ffe082',
		desc: 'Мощный ореол; волна откидывает, союзники лечатся', levels: [{ dmg: 20, tick: 0.35, radius: 130, wave: 2, kb: 60, heal: 3 }],
	},
	tempest: {
		name: 'Буревал', icon: '🌩', from: 'lightning', requires: 'crit', tags: ['shock'], color: '#80deea',
		desc: '5 молний; первая в ближайшего, крит перескакивает цепью', levels: [{ dmg: 36, cd: 1.1, strikes: 5, chain: 1, critChain: 2 }],
	},
	moonblade: {
		name: 'Лунный серп', icon: '◐', from: 'sickle', requires: 'swift', tags: ['phys'], color: '#e1f5fe',
		desc: '4 серпа кружат по широкому эллипсу', levels: [{ dmg: 40, count: 4, rx: 300, ry: 200, rps: 0.3, hitCd: 0.5, r: 18 }],
	},
	fireworks: {
		name: 'Салют', icon: '🎆', from: 'bomb', requires: 'magnet', tags: ['fire', 'aoe'], color: '#ffb74d',
		desc: 'Большой взрыв с искрами; опыт с убитых летит к вам', levels: [{ dmg: 42, cd: 2.0, count: 2, radius: 100, fuse: 0.55, sparks: 5, sparkFrac: 0.25 }],
	},
	blizzard: {
		name: 'Вьюга', icon: '🌨', from: 'frost', requires: 'hourglass', tags: ['cold', 'aoe'], color: '#b3e5fc',
		desc: 'Постоянная метель вокруг: холод, урон, заморозка', levels: [{ dmg: 10, tick: 0.5, radius: 200, slow: 0.5, pulse: 3, freeze: 0.8 }],
	},
	pitfall: {
		name: 'Волчья яма', icon: '⊕', from: 'traps', requires: 'area', tags: ['phys', 'trap'], color: '#a1887f',
		desc: 'Капкан взрывается и держит всех вокруг', levels: [{ dmg: 80, cd: 1.0, max: 10, radius: 30, blastR: 80, root: 2.5 }],
	},
	bastion: {
		name: 'Бастион', icon: '🛡', from: 'ward', requires: 'vigor', tags: ['aoe'], color: '#ffd54f',
		desc: '4 заряда щита, вспышка на каждом; союзник рядом получает заряд', levels: [{ charges: 4, cd: 5, burstDmg: 40, burstR: 140, kb: 80, share: 120 }],
	},
	firepath: {
		name: 'Огненная тропа', icon: '☄', from: 'trail', requires: 'ember', tags: ['fire', 'aoe'], color: '#ff7043',
		desc: 'Огонь горит 5 с и жжёт сильнее; сгоревший враг поджигает соседей',
		levels: [{ dmg: 10, every: 0.15, radius: 36, dur: 5, tick: 0.25, burn: 8, spread: 60, max: 40 }],
	},
	beacon: {
		name: 'Маяк', icon: '✵', from: 'lantern', requires: 'luck', tags: ['aoe'], color: '#ffe082',
		desc: 'Два вращающихся луча метят всех вокруг (+40%); помеченные дают ×1,5 опыта',
		levels: [{ dmg: 16, tick: 0.1, range: 330, half: 14, rps: 0.5, beams: 2, mark: 0.4, markDur: 2.2, xpMul: 1.5 }],
	},
	banner: {
		name: 'Знамя', icon: '⚑', from: 'spear', requires: 'bond', tags: ['phys', 'proj'], color: '#ef5350',
		desc: 'Копьё втыкается знаменем: рядом +20% урона и +10% скорости всем',
		levels: [{ dmg: 130, cd: 1.7, pierce: 99, width: 24, speed: 820, kb: 80, life: 6, radius: 200, dmgBuff: 0.2, speedBuff: 0.1 }],
	},
	quagmire: {
		name: 'Трясина', icon: '♒', from: 'flask', requires: 'frostcore', tags: ['aoe'], color: '#80cbc4',
		desc: '3 широкие ледяные лужи: холод 50%, сырость, урон',
		levels: [{ dmg: 8, cd: 2.8, count: 3, radius: 80, duration: 5, tick: 0.35, slow: 0.5 }],
	},
};
export const EVO_IDS = Object.keys(EVOS);
export const EVO_BY_WEAPON = Object.fromEntries(EVO_IDS.map((id) => [EVOS[id].from, id]));

// Embers: when there is nothing left to upgrade, a level gives a small permanent bonus for this run instead of healing.
export const EMBERS = {
	ember_dmg: { name: 'Угли ярости', icon: '♦', desc: '+5% урона до конца забега', stat: 'dmgMul', value: 0.05 },
	ember_cd: { name: 'Угли спешки', icon: '♢', desc: '−4% перезарядки до конца забега', stat: 'cdMul', value: -0.04 },
	ember_hp: { name: 'Угли жизни', icon: '♥', desc: '+15 к макс. здоровью и +30 здоровья', stat: 'maxHp', value: 15, heal: 30 },
};

// Weapon, duo or evolution definition by id; duos stop at DUO_MAX_LEVEL, evolutions have one level.
export const weaponDef = (id) => WEAPONS[id] ?? DUOS[id] ?? EVOS[id];
export const weaponMaxLevel = (id) => (DUOS[id] ? DUO_MAX_LEVEL : EVOS[id] ? 1 : MAX_LEVEL);
export const ROMAN = ['I', 'II', 'III'];

// Overclocks (v20): a plain weapon at level 5 takes one of two behaviour changes. `mul` / `set` / `add` patch the level-5 stats
// (shared with the client so it draws what the server simulates), the rest of the behaviour lives in server/game.js by `id`.
// An overclock is lost when the weapon is fused into a duo or evolves: those have their own behaviour.
export const OVERCLOCKS = {
	bolt: [
		{ id: 'ball', name: 'Шаровая молния', desc: 'Одна большая медленная искра вместо нескольких: пробивает строй и сама ищет следующую цель' },
		{ id: 'ring', name: 'Кольцо искр', desc: 'Вдвое больше искр разлетаются кольцом, без наведения' },
	],
	whip: [
		{ id: 'lunge', name: 'Выпад', desc: 'Удар только в сторону врага, зато на 70% длиннее и в полтора раза сильнее', mul: { range: 1.7, dmg: 1.5 }, set: { both: false } },
		{ id: 'twin', name: 'Двойной взмах', desc: 'Каждый удар повторяется через четверть секунды; удары слабее', mul: { dmg: 0.6 } },
	],
	knives: [
		{ id: 'fan', name: 'Широкий веер', desc: '+3 ножа широким веером, но летят вдвое ближе', add: { count: 3 }, set: { spread: 0.2 }, mul: { dmg: 0.92 } },
		{ id: 'ricochet', name: 'Рикошет', desc: 'На нож меньше, зато нож после попадания поворачивает к соседнему врагу', add: { count: -1 } },
	],
	orbit: [
		{ id: 'wide', name: 'Большой круг', desc: 'Клинки кружат в полтора раза дальше от героя, но медленнее', mul: { radius: 1.5, rps: 0.85 } },
		{ id: 'grinder', name: 'Мясорубка', desc: 'Клинки кружат вплотную к герою и намного быстрее', mul: { radius: 0.65, rps: 1.6, hitCd: 0.95 } },
	],
	aura: [
		{ id: 'pulse', name: 'Пульс', desc: 'Вместо постоянного урона — мощная широкая волна раз в 1,4 с', set: { tick: 1.4 }, mul: { dmg: 3, radius: 1.25 } },
		{ id: 'heat', name: 'Жар', desc: 'Ореол на треть уже, но жжёт почти вдвое сильнее', mul: { radius: 0.7, dmg: 1.8 } },
	],
	lightning: [
		{ id: 'near', name: 'Ближний гром', desc: 'Молнии бьют ближайших к герою врагов, а не случайных', mul: { dmg: 1.05 } },
		{ id: 'blast', name: 'Раскат', desc: 'На молнию меньше, зато конец каждой цепи взрывается', add: { strikes: -1 } },
	],
	flask: [
		{ id: 'lake', name: 'Озеро', desc: 'Одна огромная лужа вместо нескольких' },
		{ id: 'moat', name: 'Ров', desc: 'Лужи ложатся кольцом вокруг героя и держатся в полтора раза дольше', mul: { duration: 1.5, dmg: 0.8 } },
	],
	sickle: [
		{ id: 'far', name: 'Дальний бросок', desc: 'На серп меньше, зато летят в полтора раза дальше', add: { count: -1 }, mul: { range: 1.5 } },
		{ id: 'whirl', name: 'Круговой бросок', desc: '+1 серп; серпы разлетаются во все стороны, а не в ближайших врагов', add: { count: 1 } },
	],
	bomb: [
		{ id: 'big', name: 'Большой заряд', desc: 'Одна петарда вместо нескольких: взрыв намного шире и сильнее', mul: { radius: 1.6, dmg: 1.6 } },
		{ id: 'cluster', name: 'Кассета', desc: '+2 петарды, все ложатся крестом в одну точку; каждая меньше и слабее', add: { count: 2 }, mul: { radius: 0.75, dmg: 0.85 } },
	],
	frost: [
		{ id: 'deep', name: 'Стужа', desc: 'Волна на треть уже, зато бьёт сильнее и замораживает втрое дольше', mul: { radius: 0.7, freeze: 3, dmg: 1.4 } },
		{ id: 'drift', name: 'Позёмка', desc: 'Волна шире и чаще, но слабее и больше не замораживает', mul: { radius: 1.35, cd: 0.75, dmg: 0.55 }, set: { freeze: 0 } },
	],
	traps: [
		{ id: 'shards', name: 'Осколки', desc: 'Сработавший капкан разбрасывает три шипа; сам бьёт слабее', mul: { dmg: 0.8 } },
		{ id: 'circle', name: 'Кольцо', desc: 'Ставит сразу три капкана кольцом вокруг героя, но втрое реже', mul: { cd: 2.8 } },
	],
	lantern: [
		{ id: 'beam', name: 'Узкий луч', desc: 'Луч вдвое уже и в полтора раза длиннее, метка сильнее', mul: { angle: 0.45, range: 1.45, dmg: 1.05 }, add: { mark: 0.1 } },
		{ id: 'halo', name: 'Круговой свет', desc: 'Светит во все стороны, но вдвое ближе и метка слабее', set: { angle: 360 }, mul: { range: 0.55, mark: 0.75 } },
	],
	trail: [
		{ id: 'wide', name: 'Широкая полоса', desc: 'Огонь в полтора раза шире, но ложится вдвое реже', mul: { radius: 1.6, every: 2 } },
		{ id: 'long', name: 'Долгий жар', desc: 'Огонь горит вдвое дольше, но жжёт слабее', mul: { dur: 2, dmg: 0.5 }, set: { max: 36 } },
	],
	spear: [
		{ id: 'back', name: 'Возврат', desc: 'Копьё возвращается к герою и бьёт второй раз; каждый удар слабее', mul: { dmg: 0.6 } },
		{ id: 'caltrop', name: 'Шипы', desc: 'Копьё оставляет за собой шипы, которые держат врагов; само бьёт слабее', mul: { dmg: 0.75 } },
	],
	prism: [
		{ id: 'focus', name: 'Белый луч', desc: 'Вдвое сильнее по первой цели, ветви слабее', mul: { dmg: 2 }, set: { branch: 0.2 } },
		{ id: 'spectrum', name: 'Спектр', desc: 'Ветви шире и сильнее, перезарядка дольше', mul: { width: 1.6, cd: 1.2 }, set: { branch: 0.8 } },
	],
	tuning: [
		{ id: 'low', name: 'Низкий тон', desc: 'Волна шире, резонанс держится дольше, удар слабее', mul: { radius: 1.3, dur: 1.5, dmg: 0.75 } },
		{ id: 'high', name: 'Высокий тон', desc: 'Резонанс бьёт сильнее, волна уже', mul: { radius: 0.75, dmg: 1.4 }, set: { resonance: 1.5 } },
	],
	anchor: [
		{ id: 'mass', name: 'Тяжесть', desc: 'Стягивает большую толпу, перезарядка дольше', mul: { radius: 1.4, cd: 1.3 } },
		{ id: 'collapse', name: 'Схлопывание', desc: 'Больше урона в меньшей зоне', mul: { radius: 0.8, dmg: 1.8 } },
	],
	ward: [
		{ id: 'thorns', name: 'Отдача', desc: 'На заряд меньше, зато ответная вспышка вдвое сильнее', add: { charges: -1 }, mul: { burstDmg: 2 } },
		{ id: 'quick', name: 'Быстрый щит', desc: 'Один заряд, но восстанавливается на треть быстрее; вспышка шире и слабее', set: { charges: 1 }, mul: { cd: 0.7, burstR: 1.3, burstDmg: 0.5 } },
	],
};
const ocCache = {};
// Stats of weapon `id` at `lvl` with overclock `oc` (1 or 2; 0 / unknown — plain level stats).
export function weaponLevel(id, lvl, oc = 0) {
	const base = weaponDef(id).levels[lvl - 1];
	const O = oc ? OVERCLOCKS[id]?.[oc - 1] : null;
	if (!O) return base;
	const key = `${id}:${lvl}:${oc}`;
	if (ocCache[key]) return ocCache[key];
	const L = { ...base, ...(O.set ?? {}) };
	for (const [k, v] of Object.entries(O.mul ?? {})) L[k] = Math.round(L[k] * v * 1000) / 1000;
	for (const [k, v] of Object.entries(O.add ?? {})) L[k] = Math.round((L[k] + v) * 1000) / 1000;
	return (ocCache[key] = L);
}

// Attack clocks which previously ignored haste (auras, beams, traps, burning paths and orbit contact).
// Regular cast cooldowns already use cdMul at their call sites; durations and shield cooldowns stay unchanged here.
export function attackLevel(id, lvl, oc = 0, mods = {}) {
	let base = weaponLevel(id, lvl, oc);
	if (DUOS[id]?.parts.includes('ward')) {
		const shield = weaponLevel('ward', duoPartLevel(lvl));
		base = { ...base, charges: Math.max(base.charges ?? 0, shield.charges), cd: Math.min(base.cd ?? Infinity, shield.cd) };
	}
	const speed = mods.cdMul ?? 1;
	if (speed === 1) return base;
	const out = { ...base };
	for (const field of ['tick', 'every', 'hitCd', 'recharge', 'rearm', 'wave']) {
		if (out[field] > 0) out[field] *= speed;
	}
	return out;
}
export const overclockId = (id, oc) => (oc ? OVERCLOCKS[id]?.[oc - 1]?.id ?? null : null);

// Level-up offers.
export const REROLLS_START = 2;
export const BANS_START = 2; // «Изгнать»: remove an offered card from the pool for the rest of the run
export const SKIP_XP = 10;
export const RARE_CHANCE = 0.05; // chance that the 3rd card is rare, × (1 + luck)
export const CHEST_RARE_CHANCE = 0.3;
export const HEAL_OFFER_HP = 0.5; // below this hp fraction the 3rd card is always healing

// Enemy state bits in snapshot `e` (6th field).
export const ST = { burn: 1, chill: 2, frozen: 4, wet: 8, mark: 16, root: 32, elite: 64, shield: 128, windup: 256, resonance: 8192, stormMarked: 16384, guard: 32768 };

// Elites: from ELITE_START every ELITE_EVERY seconds one regular enemy becomes an elite.
export const ELITE_START = 240;
export const ELITE_EVERY = 45;
export const ELITE_EVERY_LATE = 30; // from 10:00
export const ELITE_HP_MUL = 8;
export const ELITE_R_MUL = 1.35;
export const ELITE_CHEST_CHANCE = 0.35; // × (1 + luck), otherwise a gold gem
export const ELITE_AFFIXES = [
	{ id: 'fast', name: 'Быстрый' },
	{ id: 'leech', name: 'Кровопийца' },
	{ id: 'armored', name: 'Броня' },
	{ id: 'blink', name: 'Призрачный' },
	{ id: 'volatile', name: 'Вспыльчивый' },
];

// Gems: tier 3 is gold (×GOLD_GEM_MUL xp, GOLD_GEM_CHANCE × (1 + luck) per drop).
export const GOLD_GEM_CHANCE = 0.02;
export const GOLD_GEM_MUL = 5;
export const GEM_SWEEP_EVERY = 5; // far gems are pulled next to the nearest player this often
export const GEM_SWEEP_PLACE = 450;
export const gemTier = (xp, gold) => (gold ? 3 : xp <= 2 ? 0 : xp <= 9 ? 1 : 2);

// Pickups on the ground (snapshot `it`, type = index in ITEM_TYPES).
export const ITEMS = {
	dew: { name: 'Чаша росы', desc: '+25 здоровья', heal: 25 },
	magnet: { name: 'Зов углей', desc: 'Все кристаллы летят к вам' },
	rage: { name: 'Склянка ярости', desc: '+50% урона на 10 с всем рядом', mul: 1.5, dur: 10, radius: 300 },
	cracker: { name: 'Хлопушка', desc: 'Сметает врагов на экране', radius: 650, bigFrac: 0.1 },
	slowtime: { name: 'Песок времени', desc: 'Враги на экране замедлены на 6 с', slow: 0.7, dur: 6, radius: 650 },
	feather: { name: 'Перо', desc: '+1 «Перебросить» и +1 «Изгнать»' },
	chest: { name: 'Малый сундук', desc: 'Улучшение на выбор' },
	star: { name: 'Осколок звезды', desc: 'Всем: треть уровня опыта и +20 здоровья' },
};
export const ITEM_TYPES = Object.keys(ITEMS);
// v15: kills sometimes drop «Чаша росы», far more often for a hero below lowHp of max (live runs died of slow bleeding).
export const DEW_DROP = { chance: 0.001, lowHp: 0.45, lowMul: 60 };
export const ITEM_LIFE = 90;
export const MAGNET_ITEM_EVERY = 120; // a brute drops «Зов углей» at most this often

// Breakable props: deterministic per BREAK_TILE tile (like grass), never in snapshots.
export const BREAK_TILE = 400;
export const BREAK_CHANCE = 0.25;
export const BREAK_R = 16;
export const BREAKABLE_KINDS = ['tomb', 'barrel', 'lamp'];
// Drop table: [item | 'gems', weight].
export const BREAK_DROPS = [['dew', 35], ['gems', 30], ['magnet', 10], ['rage', 10], ['cracker', 5], ['slowtime', 5], ['feather', 5]];

function propHash(x, y) {
	let h = (Math.imul(x | 0, 1597334677) + Math.imul(y | 0, 3812015801) + 0x9e3779b9) | 0;
	h = Math.imul(h ^ (h >>> 15), 2246822519);
	h = Math.imul(h ^ (h >>> 13), 3266489917);
	return (h ^ (h >>> 16)) >>> 0;
}

// Breakable prop in tile (tx, ty) or null. The start tile (0, 0) is kept clear.
export function breakableAt(tx, ty) {
	if (tx === 0 && ty === 0) return null;
	const h = propHash(tx, ty);
	if ((h % 1000) >= BREAK_CHANCE * 1000) return null;
	const x = tx * BREAK_TILE + 50 + ((h >>> 10) % (BREAK_TILE - 100));
	const y = ty * BREAK_TILE + 50 + ((h >>> 20) % (BREAK_TILE - 100));
	return { tx, ty, x, y, kind: BREAKABLE_KINDS[(h >>> 4) % BREAKABLE_KINDS.length] };
}
