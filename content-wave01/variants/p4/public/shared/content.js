// Shared game content and tuning. Imported by the server (Node ESM) and the browser.

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
export const GEM_SHARE = 0.3; // fraction of a picked gem's XP that every other alive player also gets
export const MAX_LEVEL = 5; // max level of every weapon and passive
// Slots are scarce on purpose: a full build is 4 weapons + 4 artifacts, so choices differ between players.
export const MAX_WEAPONS = 4;
export const MAX_PASSIVES = 4;
export const BOSS_TIMES = [300, 600];

export const xpForNext = (level) => 5 + (level - 1) * 8;

// Player colors by join order.
export const PLAYER_COLORS = ['#4fc3f7', '#ff8a65', '#aed581', '#ba68c8', '#ffd54f', '#4db6ac', '#f06292', '#90a4ae'];

export const HEROES = {
	knight: { name: 'Страж', desc: 'Крепкий воин с клинком', hp: 140, speed: 150, weapon: 'whip', color: '#90caf9' },
	witch: { name: 'Ведьма', desc: 'Самонаводящиеся искры', hp: 100, speed: 160, weapon: 'bolt', color: '#ce93d8' },
	ranger: { name: 'Следопыт', desc: 'Быстрый, метает ножи', hp: 110, speed: 175, weapon: 'knives', color: '#a5d6a7' },
	herald: {
		name: 'Звонарь', desc: 'Поддержка с ореолом', hp: 140, speed: 145, weapon: 'aura', color: '#ffe082',
		trait: { auraHeal: 1 }, traitDesc: 'Союзники в его ореоле лечатся на 1\u00a0❤/\u2060с',
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
};

// Hero traits (all optional, read by the server from HEROES[id].trait):
//   auraHeal   — hp/s healed to other alive players inside this hero's aura
//   dmgTaken   — multiplier for damage taken
//   taunt      — enemies within this distance target this hero instead of the nearest player
//   chainBonus — extra lightning chain jumps
//   puddleSlow — fraction of speed enemies lose while inside this hero's puddles
export const NO_TRAIT = Object.freeze({ auraHeal: 0, dmgTaken: 1, taunt: 0, chainBonus: 0, puddleSlow: 0 });
export const heroTrait = (heroId) => ({ ...NO_TRAIT, ...(HEROES[heroId]?.trait ?? {}) });

// Weapon stats per level: index 0 = level 1. `cd` is cooldown in seconds.
// Visual-relevant formulas (orbit, aura) are defined below so the client draws exactly what the server simulates.
export const WEAPONS = {
	bolt: {
		name: 'Искра', icon: '✦', desc: 'Самонаводящийся снаряд в ближайшего врага', tags: ['proj'],
		levels: [
			{ dmg: 10, cd: 1.0, count: 1, speed: 420, pierce: 1 },
			{ dmg: 12, cd: 0.9, count: 2, speed: 440, pierce: 1 },
			{ dmg: 15, cd: 0.8, count: 2, speed: 460, pierce: 2 },
			{ dmg: 18, cd: 0.7, count: 3, speed: 480, pierce: 2 },
			{ dmg: 22, cd: 0.6, count: 4, speed: 500, pierce: 3 },
		],
	},
	whip: {
		name: 'Клинок', icon: '⚔', desc: 'Широкий горизонтальный удар в сторону ближайшего врага', tags: ['phys'],
		levels: [
			{ dmg: 14, cd: 1.3, range: 110, width: 40, both: false },
			{ dmg: 18, cd: 1.2, range: 120, width: 44, both: false },
			{ dmg: 22, cd: 1.1, range: 130, width: 48, both: true },
			{ dmg: 28, cd: 1.0, range: 145, width: 52, both: true },
			{ dmg: 36, cd: 0.9, range: 160, width: 58, both: true },
		],
	},
	knives: {
		name: 'Ножи', icon: '➶', desc: 'Веер быстрых ножей в ближайшего врага', tags: ['phys', 'proj'],
		levels: [
			{ dmg: 8, cd: 0.7, count: 1, speed: 600, pierce: 1, spread: 0.12 },
			{ dmg: 9, cd: 0.6, count: 2, speed: 620, pierce: 1, spread: 0.12 },
			{ dmg: 11, cd: 0.55, count: 3, speed: 640, pierce: 2, spread: 0.12 },
			{ dmg: 13, cd: 0.5, count: 4, speed: 660, pierce: 2, spread: 0.1 },
			{ dmg: 16, cd: 0.45, count: 5, speed: 700, pierce: 3, spread: 0.1 },
		],
	},
	orbit: {
		name: 'Хоровод', icon: '◎', desc: 'Клинки кружат вокруг героя', tags: ['phys'],
		levels: [
			{ dmg: 8, count: 2, radius: 70, rps: 0.6, hitCd: 0.5 },
			{ dmg: 10, count: 3, radius: 75, rps: 0.65, hitCd: 0.5 },
			{ dmg: 12, count: 3, radius: 85, rps: 0.7, hitCd: 0.45 },
			{ dmg: 15, count: 4, radius: 90, rps: 0.75, hitCd: 0.4 },
			{ dmg: 18, count: 5, radius: 100, rps: 0.8, hitCd: 0.35 },
		],
	},
	aura: {
		name: 'Ореол', icon: '◌', desc: 'Постоянный урон врагам рядом', tags: ['aoe'],
		levels: [
			{ dmg: 4, radius: 70, tick: 0.5 },
			{ dmg: 5, radius: 80, tick: 0.5 },
			{ dmg: 6, radius: 90, tick: 0.45 },
			{ dmg: 8, radius: 100, tick: 0.4 },
			{ dmg: 10, radius: 115, tick: 0.35 },
		],
	},
	lightning: {
		name: 'Гроза', icon: 'ϟ', desc: 'Молния бьёт случайных врагов на экране', tags: ['shock'],
		levels: [
			{ dmg: 20, cd: 2.2, strikes: 1, chain: 0 },
			{ dmg: 24, cd: 2.0, strikes: 2, chain: 0 },
			{ dmg: 28, cd: 1.8, strikes: 2, chain: 1 },
			{ dmg: 34, cd: 1.6, strikes: 3, chain: 1 },
			{ dmg: 42, cd: 1.4, strikes: 3, chain: 2 },
		],
	},
	flask: {
		name: 'Зелье', icon: '⚗', desc: 'Лужа яда рядом с героем', tags: ['aoe'],
		levels: [
			{ dmg: 5, cd: 3.0, count: 1, radius: 50, duration: 2.5, tick: 0.4 },
			{ dmg: 6, cd: 2.8, count: 2, radius: 55, duration: 2.8, tick: 0.4 },
			{ dmg: 7, cd: 2.6, count: 2, radius: 60, duration: 3.0, tick: 0.35 },
			{ dmg: 9, cd: 2.4, count: 3, radius: 65, duration: 3.2, tick: 0.35 },
			{ dmg: 11, cd: 2.2, count: 3, radius: 75, duration: 3.5, tick: 0.3 },
		],
	},
	sickle: {
		name: 'Серп', icon: '☾', desc: 'Летит к врагу и возвращается, режет всех на пути', tags: ['phys', 'proj'],
		levels: [
			{ dmg: 12, cd: 1.4, count: 1, range: 260, speed: 480 },
			{ dmg: 15, cd: 1.3, count: 1, range: 280, speed: 500 },
			{ dmg: 18, cd: 1.2, count: 2, range: 300, speed: 520 },
			{ dmg: 22, cd: 1.1, count: 2, range: 320, speed: 540 },
			{ dmg: 28, cd: 1.0, count: 3, range: 350, speed: 560 },
		],
	},
	bomb: {
		name: 'Петарда', icon: '✹', desc: 'Взрывается в гуще врагов', tags: ['fire', 'aoe'],
		levels: [
			{ dmg: 22, cd: 2.4, count: 1, radius: 60, fuse: 0.7 },
			{ dmg: 28, cd: 2.2, count: 1, radius: 66, fuse: 0.7 },
			{ dmg: 34, cd: 2.0, count: 2, radius: 72, fuse: 0.65 },
			{ dmg: 42, cd: 1.8, count: 2, radius: 80, fuse: 0.6 },
			{ dmg: 55, cd: 1.6, count: 3, radius: 90, fuse: 0.55 },
		],
	},
	frost: {
		name: 'Иней', icon: '❄', desc: 'Волна холода ранит и замедляет врагов вокруг', tags: ['cold', 'aoe'],
		levels: [
			{ dmg: 8, cd: 3.0, radius: 110, slow: 0.30, dur: 1.5, freeze: 0 },
			{ dmg: 10, cd: 2.8, radius: 125, slow: 0.35, dur: 1.6, freeze: 0 },
			{ dmg: 13, cd: 2.6, radius: 140, slow: 0.40, dur: 1.8, freeze: 0 },
			{ dmg: 16, cd: 2.3, radius: 155, slow: 0.45, dur: 2.0, freeze: 0 },
			{ dmg: 20, cd: 2.0, radius: 170, slow: 0.50, dur: 2.2, freeze: 0.6 },
		],
	},
	traps: {
		name: 'Капканы', icon: '⊓', desc: 'Капканы на пути отступления держат врагов', tags: ['phys', 'trap'],
		levels: [
			{ dmg: 20, cd: 2.0, max: 4, root: 1.0, radius: 26, splash: 0 },
			{ dmg: 26, cd: 1.8, max: 5, root: 1.2, radius: 28, splash: 0 },
			{ dmg: 32, cd: 1.6, max: 6, root: 1.4, radius: 30, splash: 40 },
			{ dmg: 40, cd: 1.4, max: 7, root: 1.6, radius: 32, splash: 50 },
			{ dmg: 50, cd: 1.2, max: 8, root: 2.0, radius: 34, splash: 60 },
		],
	},
};

// Passive multipliers are applied per level (value * level).
export const PASSIVES = {
	might: { name: 'Сила', icon: '💪', desc: '+10% урона', stat: 'dmgMul', perLevel: 0.10 },
	haste: { name: 'Спешка', icon: '⏱', desc: '−8% перезарядки', stat: 'cdMul', perLevel: -0.08 },
	vigor: { name: 'Крепость', icon: '❤', desc: '+20 к макс. здоровью', stat: 'maxHp', perLevel: 20 },
	swift: { name: 'Лёгкость', icon: '👟', desc: '+8% скорости', stat: 'speedMul', perLevel: 0.08 },
	magnet: { name: 'Магнит', icon: '🧲', desc: '+30% радиуса сбора', stat: 'magnetMul', perLevel: 0.30 },
	area: { name: 'Размах', icon: '⬤', desc: '+10% площади оружия', stat: 'areaMul', perLevel: 0.10 },
	regen: { name: 'Восстановление', icon: '✚', desc: '+0.5 здоровья в секунду', stat: 'regen', perLevel: 0.5 },
	crit: { name: 'Острота', icon: '✧', desc: '+6% шанс крита (×2 урона)', stat: 'critChance', perLevel: 0.06 },
	echo: { name: 'Эхо', icon: '≋', desc: '+1 снаряд, лужа, удар или клинок (+2 с 4 ур.)', stat: 'amount', values: [1, 1, 1, 2, 2] },
	hourglass: { name: 'Песочные часы', icon: '⧗', desc: '+12% длительности луж, холода и заморозки', stat: 'durMul', perLevel: 0.12 },
	mail: { name: 'Кольчуга', icon: '⛨', desc: '−1 к каждому полученному удару', stat: 'armor', perLevel: 1 },
};
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
	burnChance: 0, burnDps: 0, ctrlMul: 1, chillVuln: 0, bond: 0,
});

export const BASE_MAGNET = 60;
export const GEM_PULL_SPEED = 420;

export const ENEMIES = {
	bat: { name: 'Тень', hp: 6, speed: 110, dmg: 5, r: 10, xp: 1, color: '#7e57c2' },
	ghoul: { name: 'Упырь', hp: 16, speed: 60, dmg: 8, r: 14, xp: 2, color: '#66bb6a' },
	wisp: { name: 'Огонёк', hp: 10, speed: 140, dmg: 6, r: 8, xp: 2, color: '#ffb74d' },
	skel: { name: 'Костяк', hp: 30, speed: 75, dmg: 10, r: 13, xp: 3, color: '#e0e0e0' },
	brute: { name: 'Громила', hp: 120, speed: 50, dmg: 18, r: 22, xp: 10, color: '#8d6e63' },
	boss: { name: 'Владыка ночи', hp: 2500, speed: 70, dmg: 30, r: 40, xp: 100, color: '#d32f2f' },
	spitter: {
		name: 'Плевун', hp: 20, speed: 70, dmg: 6, r: 12, xp: 3, color: '#9ccc65',
		ai: 'ranged', keep: [260, 320], shotCd: 2.6, windup: 0.6, shotSpeed: 230, shotDmg: 8, shotLife: 2,
	},
	bloater: {
		name: 'Пузырь', hp: 14, speed: 95, dmg: 0, r: 13, xp: 2, color: '#ef9a9a',
		ai: 'exploder', fuse: 0.5, blastR: 60, blastDmg: 12, blastEnemyDmg: 30,
	},
};

// Numeric ids used in snapshots (index into this array).
// New types are appended at the end so old indexes stay valid.
export const ENEMY_TYPES = ['bat', 'ghoul', 'wisp', 'skel', 'brute', 'boss', 'spitter', 'bloater'];
export const PROJECTILE_KINDS = ['bolt', 'knife', 'sickle'];
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
	{ at: 480, rate: 5.0, types: { skel: 3, ghoul: 1, brute: 0.6, spitter: 0.8, bloater: 0.6 } },
	{ at: 600, rate: 6.0, types: { skel: 3, wisp: 3, brute: 1, spitter: 0.5 } },
	{ at: 660, rate: 6.5, types: { skel: 3, wisp: 2, brute: 1.2, spitter: 0.8, bloater: 0.6 } },
	{ at: 780, rate: 8.5, types: { bat: 3, skel: 3, brute: 1.5, spitter: 0.8, bloater: 0.8 } },
];

// Pressure curve. Up to PRESSURE_FROM enemies grow as before (+12% hp per minute); after that hp grows faster
// (quadratic term) and contact/shot damage starts to grow, so the middle and the end keep up with player builds.
export const PRESSURE_FROM = 180;
// From ENDGAME_FROM the final stretch adds another quadratic factor so full builds still meet resistance.
export const PRESSURE = { hpLin: 0.12, hpQuad: 0.02, dmgPerMin: 0.06, endFrom: 540, endQuad: 0.08, endGroupMul: [0.6, 0.85], perPlayer: 0.45 };
const lateMin = (seconds) => Math.max(0, seconds - PRESSURE_FROM) / 60;
export const enemyHpScale = (seconds, players) => {
	const m = Math.floor(seconds / 60), late = Math.floor(lateMin(seconds));
	const end = Math.max(0, Math.floor((seconds - PRESSURE.endFrom) / 60));
	const endQuad = PRESSURE.endQuad * (PRESSURE.endGroupMul[players - 1] ?? 1);
	return (1 + PRESSURE.hpLin * m + PRESSURE.hpQuad * late * late) * (1 + endQuad * end * end) * (1 + PRESSURE.perPlayer * (players - 1));
};
export const enemyDmgScale = (seconds) => 1 + PRESSURE.dmgPerMin * Math.floor(lateMin(seconds));
// Invasions: from INVASION.from every INVASION.every seconds a ring of enemies closes in around every alive player.
// Small groups get smaller rings: they have fewer weapons on screen per enemy.
export const INVASION = { from: 210, every: 60, radius: 430, base: 10, perMin: 2, max: 40, groupMul: [0.5, 0.75] };
export const invasionCount = (seconds, players = 1) =>
	Math.round(Math.min(INVASION.max, INVASION.base + INVASION.perMin * (seconds / 60 - 3)) * (INVASION.groupMul[players - 1] ?? 1));
// Per-player spawn stays close to solo (1.0, 0.85, 0.78 for 1, 2, 4 players) so groups do not get it easier.
export const spawnRateScale = (players) => 0.3 + 0.7 * players;
export const SPAWN_DISTANCE = { min: 520, max: 680 };

// Deterministic visual formulas shared by server and client.
export const orbitAngle = (gameTime, rps, index, count) => gameTime * rps * Math.PI * 2 + (index * Math.PI * 2) / count;

// --- Wave 0/1 systems ---

// Weapon pairs that unlock a combined attack (spec pending): { id, weapons: [a, b], name }.
// The server checks owned pairs in one place (Room.updateCombos) whenever the weapon set changes.
export const WEAPON_COMBOS = [];

// Level-up offers.
export const REROLLS_START = 2;
export const SKIP_XP = 10;
export const RARE_CHANCE = 0.05; // chance that the 3rd card is rare, × (1 + luck)
export const CHEST_RARE_CHANCE = 0.3;
export const HEAL_OFFER_HP = 0.35; // below this hp fraction the 3rd card is always healing

// Enemy state bits in snapshot `e` (6th field).
export const ST = { burn: 1, chill: 2, frozen: 4, wet: 8, mark: 16, root: 32, elite: 64, shield: 128, windup: 256 };

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
	feather: { name: 'Перо', desc: '+1 «Перебросить»' },
	chest: { name: 'Малый сундук', desc: 'Улучшение на выбор' },
};
export const ITEM_TYPES = Object.keys(ITEMS);
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
