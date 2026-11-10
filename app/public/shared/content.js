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
// Team XP: every gem gives its full XP to every player in the room (downed ones too, so a revived ally is not behind).
// The level threshold grows with the party so the pace matches the old 30% share: n / (1 + 0.3 (n - 1)).
export const OLD_GEM_SHARE = 0.3;
export const teamXpMul = (players) => Math.max(1, players) / (1 + OLD_GEM_SHARE * (Math.max(1, players) - 1));
export const MAX_LEVEL = 5; // max level of every weapon and passive
// Slots are scarce on purpose: a full build is 4 weapons + 4 artifacts, so choices differ between players.
export const MAX_WEAPONS = 4;
export const MAX_PASSIVES = 4;
export const BOSS_TIMES = [300, 600];

export const xpForNext = (level, players = 1) => Math.round((5 + (level - 1) * 8) * teamXpMul(players));

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
	// Wave 3 weapons that need no wave-2 states (mark and burn already exist in hurtEnemy).
	lantern: {
		name: 'Фонарь', icon: '🏮', desc: 'Свет помечает врагов: они получают больше урона от всех', tags: ['aoe'],
		levels: [
			{ dmg: 3, tick: 0.5, range: 200, angle: 50, mark: 0.15 },
			{ dmg: 4, tick: 0.5, range: 220, angle: 55, mark: 0.18 },
			{ dmg: 5, tick: 0.45, range: 240, angle: 60, mark: 0.21 },
			{ dmg: 6, tick: 0.45, range: 260, angle: 65, mark: 0.25 },
			{ dmg: 8, tick: 0.4, range: 300, angle: 75, mark: 0.30 },
		],
	},
	trail: {
		name: 'Пламенный след', icon: '🔥', desc: 'Огонь на пройденном пути поджигает врагов', tags: ['fire', 'aoe'],
		levels: [
			{ dmg: 3, every: 0.25, radius: 22, dur: 2.0, tick: 0.3, burn: 2 },
			{ dmg: 4, every: 0.25, radius: 24, dur: 2.2, tick: 0.3, burn: 3 },
			{ dmg: 5, every: 0.22, radius: 26, dur: 2.5, tick: 0.3, burn: 3 },
			{ dmg: 6, every: 0.2, radius: 28, dur: 2.8, tick: 0.25, burn: 4 },
			{ dmg: 8, every: 0.18, radius: 32, dur: 3.0, tick: 0.25, burn: 5 },
		],
	},
	spear: {
		name: 'Копьё', icon: '↟', desc: 'Пробивает строй насквозь, бьёт сильнейшего', tags: ['phys', 'proj'],
		levels: [
			{ dmg: 30, cd: 2.5, pierce: 5, width: 16, speed: 700, kb: 40 },
			{ dmg: 38, cd: 2.3, pierce: 6, width: 16, speed: 720, kb: 50 },
			{ dmg: 48, cd: 2.1, pierce: 8, width: 18, speed: 740, kb: 60 },
			{ dmg: 60, cd: 1.9, pierce: 10, width: 20, speed: 760, kb: 70 },
			{ dmg: 80, cd: 1.6, pierce: 99, width: 22, speed: 800, kb: 80 },
		],
	},
	ward: {
		name: 'Оберег', icon: '⛉', desc: 'Щит поглощает удары и взрывается, когда ломается', tags: ['aoe'],
		levels: [
			{ charges: 1, cd: 12, burstDmg: 15, burstR: 90, kb: 60 },
			{ charges: 1, cd: 10, burstDmg: 20, burstR: 100, kb: 70 },
			{ charges: 2, cd: 10, burstDmg: 25, burstR: 110, kb: 80 },
			{ charges: 2, cd: 8, burstDmg: 32, burstR: 120, kb: 90 },
			{ charges: 3, cd: 7, burstDmg: 40, burstR: 140, kb: 100 },
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
export const enemyHpScale = (seconds, players) => {
	const m = Math.floor(seconds / 60), late = Math.floor(lateMin(seconds));
	const end = Math.max(0, Math.floor((seconds - PRESSURE.endFrom) / 60));
	const endQuad = PRESSURE.endQuad * (PRESSURE.endGroupMul[players - 1] ?? 1);
	return (1 + PRESSURE.hpLin * m + PRESSURE.hpQuad * late * late) * (1 + endQuad * end * end) * (1 + PRESSURE.perPlayer * (players - 1) + PRESSURE.perPlayerSq * (players - 1) ** 2);
};
export const enemyDmgScale = (seconds) => 1 + PRESSURE.dmgPerMin * Math.floor(lateMin(seconds));
// Invasions: from INVASION.from every INVASION.every seconds a ring of enemies closes in around every alive player.
// Small groups get smaller rings: none solo, duo ×0.75 (fewer weapons on screen per enemy).
// Big groups (4+) clear the middle too fast with duos and «Слаженность»: from 6:00 their rings are 25% larger.
export const INVASION = { from: 210, every: 60, radius: 430, base: 10, perMin: 2, max: 40, groupMul: [0, 0.75], bigFrom: 360, bigMul: 1.25 };
export const invasionCount = (seconds, players = 1) =>
	Math.round(Math.min(INVASION.max, INVASION.base + INVASION.perMin * (seconds / 60 - 3))
		* (INVASION.groupMul[players - 1] ?? (players >= 4 && seconds >= INVASION.bigFrom ? INVASION.bigMul : 1)));
// Per-player spawn stays close to solo (1.0, 0.85, 0.78 for 1, 2, 4 players) so groups do not get it easier.
export const spawnRateScale = (players) => 0.3 + 0.7 * players;
export const SPAWN_DISTANCE = { min: 520, max: 680 };

// Deterministic visual formulas shared by server and client.
export const orbitAngle = (gameTime, rps, index, count) => gameTime * rps * Math.PI * 2 + (index * Math.PI * 2) / count;

// --- Wave 0/1 systems ---

// Duos (5.8): two weapons of one player, both at level ≥ DUO_MIN_LEVEL, fuse into a new weapon with its own
// attack. The duo takes the first weapon's slot, the second slot frees up. Levels I–III; at most MAX_DUOS per player.
// Pairs are matched in one place on the server (Room.updateCombos). Lantern + Storm («Прожектор бури») waits for wave 2.
export const MAX_DUOS = 2;
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
			{ dmg: 30, cd: 1.0, range: 150, width: 62, rodFrac: 0.45, chain: 2, fanDmg: 40, fan: 5 },
			{ dmg: 40, cd: 0.9, range: 165, width: 66, rodFrac: 0.45, chain: 3, fanDmg: 55, fan: 5 },
			{ dmg: 55, cd: 0.8, range: 180, width: 70, rodFrac: 0.45, chain: 4, fanDmg: 75, fan: 5 },
		],
	},
	orb: {
		name: 'Шаровая молния', icon: '◉', parts: ['bolt', 'lightning'], tags: ['shock', 'aoe'],
		desc: 'Медленный шар разрядами бьёт всех рядом и взрывается',
		levels: [
			{ dmg: 6, cd: 3.0, count: 1, radius: 75, tick: 0.5, speed: 120, life: 4, boom: 40, boomR: 110 },
			{ dmg: 8, cd: 2.6, count: 1, radius: 85, tick: 0.5, speed: 120, life: 4, boom: 55, boomR: 110 },
			{ dmg: 11, cd: 2.2, count: 2, radius: 95, tick: 0.5, speed: 120, life: 4, boom: 75, boomR: 110 },
		],
	},
	orrery: {
		name: 'Планетарий', icon: '✺', parts: ['bolt', 'orbit'], tags: ['proj'],
		desc: 'Искры кружат вокруг и срываются в подошедших врагов',
		levels: [
			{ dmg: 34, count: 4, radius: 90, rps: 0.5, trigger: 220, respawn: 0.6, pierce: 3, speed: 460 },
			{ dmg: 42, count: 5, radius: 90, rps: 0.5, trigger: 220, respawn: 0.6, pierce: 3, speed: 480 },
			{ dmg: 56, count: 6, radius: 90, rps: 0.5, trigger: 220, respawn: 0.6, pierce: 3, speed: 500 },
		],
	},
	windmill: {
		name: 'Мельница', icon: '✢', parts: ['orbit', 'whip'], tags: ['phys'],
		desc: 'Длинные лопасти вращаются вокруг героя и откидывают врагов',
		levels: [
			{ dmg: 15, count: 2, len: 170, width: 22, rps: 0.5, hitCd: 0.4, kb: 10 },
			{ dmg: 20, count: 3, len: 185, width: 22, rps: 0.5, hitCd: 0.4, kb: 10 },
			{ dmg: 27, count: 4, len: 200, width: 24, rps: 0.5, hitCd: 0.4, kb: 10 },
		],
	},
	tripwire: {
		name: 'Растяжка', icon: '⋈', parts: ['knives', 'traps'], tags: ['phys', 'trap'],
		desc: 'Капканы связаны режущей нитью; промахнувшиеся ножи становятся шипами',
		levels: [
			{ dmg: 11, cd: 0.55, count: 3, speed: 640, pierce: 2, spread: 0.12, max: 4, link: 220, wireDmg: 8, wireTick: 0.3, rearm: 2.5, trapDmg: 26, trapCd: 1.6, root: 1.2, radius: 28, spikeDmg: 6, spikeLife: 4, spikeRoot: 0.5 },
			{ dmg: 13, cd: 0.5, count: 4, speed: 660, pierce: 2, spread: 0.1, max: 5, link: 220, wireDmg: 11, wireTick: 0.3, rearm: 2.5, trapDmg: 32, trapCd: 1.4, root: 1.4, radius: 30, spikeDmg: 8, spikeLife: 4, spikeRoot: 0.5 },
			{ dmg: 16, cd: 0.45, count: 5, speed: 700, pierce: 3, spread: 0.1, max: 6, link: 220, wireDmg: 16, wireTick: 0.3, rearm: 2.5, trapDmg: 40, trapCd: 1.2, root: 1.6, radius: 32, spikeDmg: 11, spikeLife: 4, spikeRoot: 0.5 },
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
			{ dmg: 30, cd: 2.2, count: 1, radius: 70, fuse: 0.6, pool: 3, poolDmg: 5, tick: 0.3 },
			{ dmg: 40, cd: 2.0, count: 2, radius: 80, fuse: 0.6, pool: 3.5, poolDmg: 7, tick: 0.3 },
			{ dmg: 55, cd: 1.8, count: 2, radius: 90, fuse: 0.6, pool: 4, poolDmg: 9, tick: 0.3 },
		],
	},
	minefield: {
		name: 'Минное поле', icon: '◈', parts: ['bomb', 'traps'], tags: ['fire', 'aoe', 'trap'],
		desc: 'Капканы становятся минами, которые перезаряжаются',
		levels: [
			{ dmg: 45, cd: 1.6, max: 5, radius: 80, kb: 60, recharge: 6, trigger: 26 },
			{ dmg: 60, cd: 1.4, max: 6, radius: 90, kb: 60, recharge: 6, trigger: 28 },
			{ dmg: 80, cd: 1.2, max: 8, radius: 100, kb: 60, recharge: 6, trigger: 30 },
		],
	},
	icebomb: {
		name: 'Ледяная граната', icon: '❅', parts: ['bomb', 'frost'], tags: ['cold', 'aoe'],
		desc: 'Взрыв замораживает, замёрзшие раскалываются осколками',
		levels: [
			{ dmg: 25, cd: 2.4, count: 1, radius: 80, fuse: 0.6, freeze: 1.0, shardR: 40, shardFrac: 0.5 },
			{ dmg: 34, cd: 2.2, count: 2, radius: 90, fuse: 0.6, freeze: 1.2, shardR: 40, shardFrac: 0.5 },
			{ dmg: 46, cd: 2.0, count: 2, radius: 100, fuse: 0.6, freeze: 1.5, shardR: 40, shardFrac: 0.5 },
		],
	},
	aurora: {
		name: 'Полярное сияние', icon: '❋', parts: ['aura', 'frost'], tags: ['cold', 'aoe'],
		desc: 'Холодный ореол; раз в 3 с волна замораживает',
		levels: [
			{ dmg: 6, tick: 0.4, radius: 110, slow: 0.3, pulse: 3, freeze: 0.8 },
			{ dmg: 8, tick: 0.4, radius: 125, slow: 0.35, pulse: 3, freeze: 1.0 },
			{ dmg: 11, tick: 0.4, radius: 140, slow: 0.4, pulse: 3, freeze: 1.2 },
		],
	},
	censer: {
		name: 'Кадило', icon: '☁', parts: ['aura', 'flask'], tags: ['aoe'],
		desc: 'Шлейф облаков: врагам урон, союзникам лечение',
		levels: [
			{ dmg: 5, every: 0.4, radius: 45, life: 3, tick: 0.4, heal: 2 },
			{ dmg: 7, every: 0.4, radius: 50, life: 3, tick: 0.4, heal: 3 },
			{ dmg: 9, every: 0.4, radius: 55, life: 3, tick: 0.4, heal: 4 },
		],
	},
	icedisc: {
		name: 'Ледяной диск', icon: '❂', parts: ['frost', 'sickle'], tags: ['cold', 'phys', 'proj'],
		desc: 'Диск оставляет ледяной след и замораживает на обратном пути',
		levels: [
			{ dmg: 40, cd: 1.3, count: 1, range: 300, speed: 520, trailR: 24, trailLife: 2.5, trailSlow: 0.4, freeze: 0.6 },
			{ dmg: 50, cd: 1.2, count: 2, range: 320, speed: 540, trailR: 24, trailLife: 2.5, trailSlow: 0.4, freeze: 0.8 },
			{ dmg: 64, cd: 1.1, count: 2, range: 340, speed: 560, trailR: 24, trailLife: 2.5, trailSlow: 0.4, freeze: 1.0 },
		],
	},
};
export const DUO_IDS = Object.keys(DUOS);
export const duoKey = (a, b) => (a < b ? `${a}+${b}` : `${b}+${a}`);
export const DUO_BY_PAIR = Object.fromEntries(DUO_IDS.map((id) => [duoKey(...DUOS[id].parts), id]));
// Evolutions (5.4): weapon at level 5 + its artifact at any level → a single-level weapon that replaces it.
// The artifact stays; an evolved weapon cannot join a duo, a weapon in a duo cannot evolve.
export const EVOS = {
	swarm: {
		name: 'Рой светляков', icon: '❋', from: 'bolt', requires: 'echo', tags: ['proj'], color: '#ce93d8',
		desc: '6 искр, попав, распадаются на 2 искорки', levels: [{ dmg: 26, cd: 0.5, count: 6, speed: 520, pierce: 1, split: 2 }],
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
		desc: '5 молний; первая в ближайшего, крит перескакивает цепью', levels: [{ dmg: 50, cd: 1.0, strikes: 5, chain: 1, critChain: 2 }],
	},
	moonblade: {
		name: 'Лунный серп', icon: '◐', from: 'sickle', requires: 'swift', tags: ['phys'], color: '#e1f5fe',
		desc: '4 серпа кружат по широкому эллипсу', levels: [{ dmg: 40, count: 4, rx: 300, ry: 200, rps: 0.3, hitCd: 0.5, r: 18 }],
	},
	fireworks: {
		name: 'Салют', icon: '🎆', from: 'bomb', requires: 'magnet', tags: ['fire', 'aoe'], color: '#ffb74d',
		desc: 'Большой взрыв с искрами; опыт с убитых летит к вам', levels: [{ dmg: 70, cd: 1.8, count: 2, radius: 110, fuse: 0.55, sparks: 6, sparkFrac: 0.3 }],
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
