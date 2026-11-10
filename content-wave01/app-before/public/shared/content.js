// Shared game content and tuning. Imported by the server (Node ESM) and the browser.

export const TICK_HZ = 30;
export const SNAPSHOT_HZ = 10;
export const POS_HZ = 15;
export const MAX_PLAYERS = 8;
export const RUN_SECONDS = 15 * 60;
export const MAX_ENEMIES = 350;
export const MAX_GEMS = 300;
export const PLAYER_RADIUS = 14;
export const REVIVE_RADIUS = 60;
export const REVIVE_SECONDS = 3;
export const REVIVE_HP_FRACTION = 0.5;
export const PLAYER_IFRAMES = 0.4;
export const GEM_SHARE = 0.3; // fraction of a picked gem's XP that every other alive player also gets
export const MAX_LEVEL = 5; // max level of every weapon and passive
export const MAX_WEAPONS = 6;
export const MAX_PASSIVES = 6;
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
		name: 'Искра', icon: '✦', desc: 'Самонаводящийся снаряд в ближайшего врага',
		levels: [
			{ dmg: 10, cd: 1.0, count: 1, speed: 420, pierce: 1 },
			{ dmg: 12, cd: 0.9, count: 2, speed: 440, pierce: 1 },
			{ dmg: 15, cd: 0.8, count: 2, speed: 460, pierce: 2 },
			{ dmg: 18, cd: 0.7, count: 3, speed: 480, pierce: 2 },
			{ dmg: 22, cd: 0.6, count: 4, speed: 500, pierce: 3 },
		],
	},
	whip: {
		name: 'Клинок', icon: '⚔', desc: 'Широкий горизонтальный удар в сторону ближайшего врага',
		levels: [
			{ dmg: 14, cd: 1.3, range: 110, width: 40, both: false },
			{ dmg: 18, cd: 1.2, range: 120, width: 44, both: false },
			{ dmg: 22, cd: 1.1, range: 130, width: 48, both: true },
			{ dmg: 28, cd: 1.0, range: 145, width: 52, both: true },
			{ dmg: 36, cd: 0.9, range: 160, width: 58, both: true },
		],
	},
	knives: {
		name: 'Ножи', icon: '➶', desc: 'Веер быстрых ножей в ближайшего врага',
		levels: [
			{ dmg: 8, cd: 0.7, count: 1, speed: 600, pierce: 1, spread: 0.12 },
			{ dmg: 9, cd: 0.6, count: 2, speed: 620, pierce: 1, spread: 0.12 },
			{ dmg: 11, cd: 0.55, count: 3, speed: 640, pierce: 2, spread: 0.12 },
			{ dmg: 13, cd: 0.5, count: 4, speed: 660, pierce: 2, spread: 0.1 },
			{ dmg: 16, cd: 0.45, count: 5, speed: 700, pierce: 3, spread: 0.1 },
		],
	},
	orbit: {
		name: 'Хоровод', icon: '◎', desc: 'Клинки кружат вокруг героя',
		levels: [
			{ dmg: 8, count: 2, radius: 70, rps: 0.6, hitCd: 0.5 },
			{ dmg: 10, count: 3, radius: 75, rps: 0.65, hitCd: 0.5 },
			{ dmg: 12, count: 3, radius: 85, rps: 0.7, hitCd: 0.45 },
			{ dmg: 15, count: 4, radius: 90, rps: 0.75, hitCd: 0.4 },
			{ dmg: 18, count: 5, radius: 100, rps: 0.8, hitCd: 0.35 },
		],
	},
	aura: {
		name: 'Ореол', icon: '◌', desc: 'Постоянный урон врагам рядом',
		levels: [
			{ dmg: 4, radius: 70, tick: 0.5 },
			{ dmg: 5, radius: 80, tick: 0.5 },
			{ dmg: 6, radius: 90, tick: 0.45 },
			{ dmg: 8, radius: 100, tick: 0.4 },
			{ dmg: 10, radius: 115, tick: 0.35 },
		],
	},
	lightning: {
		name: 'Гроза', icon: 'ϟ', desc: 'Молния бьёт случайных врагов на экране',
		levels: [
			{ dmg: 20, cd: 2.2, strikes: 1, chain: 0 },
			{ dmg: 24, cd: 2.0, strikes: 2, chain: 0 },
			{ dmg: 28, cd: 1.8, strikes: 2, chain: 1 },
			{ dmg: 34, cd: 1.6, strikes: 3, chain: 1 },
			{ dmg: 42, cd: 1.4, strikes: 3, chain: 2 },
		],
	},
	flask: {
		name: 'Зелье', icon: '⚗', desc: 'Лужа яда рядом с героем',
		levels: [
			{ dmg: 5, cd: 3.0, count: 1, radius: 50, duration: 2.5, tick: 0.4 },
			{ dmg: 6, cd: 2.8, count: 2, radius: 55, duration: 2.8, tick: 0.4 },
			{ dmg: 7, cd: 2.6, count: 2, radius: 60, duration: 3.0, tick: 0.35 },
			{ dmg: 9, cd: 2.4, count: 3, radius: 65, duration: 3.2, tick: 0.35 },
			{ dmg: 11, cd: 2.2, count: 3, radius: 75, duration: 3.5, tick: 0.3 },
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
};

export const BASE_MAGNET = 60;
export const GEM_PULL_SPEED = 420;

export const ENEMIES = {
	bat: { name: 'Тень', hp: 6, speed: 110, dmg: 5, r: 10, xp: 1, color: '#7e57c2' },
	ghoul: { name: 'Упырь', hp: 16, speed: 60, dmg: 8, r: 14, xp: 2, color: '#66bb6a' },
	wisp: { name: 'Огонёк', hp: 10, speed: 140, dmg: 6, r: 8, xp: 2, color: '#ffb74d' },
	skel: { name: 'Костяк', hp: 30, speed: 75, dmg: 10, r: 13, xp: 3, color: '#e0e0e0' },
	brute: { name: 'Громила', hp: 120, speed: 50, dmg: 18, r: 22, xp: 10, color: '#8d6e63' },
	boss: { name: 'Владыка ночи', hp: 2500, speed: 70, dmg: 30, r: 40, xp: 100, color: '#d32f2f' },
};

// Numeric ids used in snapshots (index into this array).
export const ENEMY_TYPES = ['bat', 'ghoul', 'wisp', 'skel', 'brute', 'boss'];
export const PROJECTILE_KINDS = ['bolt', 'knife'];
export const WEAPON_IDS = Object.keys(WEAPONS);
export const PASSIVE_IDS = Object.keys(PASSIVES);

// Spawn table: from `at` seconds, spawn `rate` enemies per second (before player scaling), types weighted.
export const WAVES = [
	{ at: 0, rate: 1.2, types: { bat: 3, ghoul: 1 } },
	{ at: 60, rate: 2.0, types: { bat: 3, ghoul: 2, wisp: 1 } },
	{ at: 150, rate: 2.8, types: { ghoul: 3, wisp: 2, skel: 1 } },
	{ at: 270, rate: 3.5, types: { bat: 2, skel: 3, wisp: 2, brute: 0.3 } },
	{ at: 420, rate: 4.5, types: { skel: 3, ghoul: 2, brute: 0.6 } },
	{ at: 600, rate: 5.5, types: { skel: 3, wisp: 3, brute: 1 } },
	{ at: 780, rate: 7.0, types: { bat: 3, skel: 3, brute: 1.5 } },
];

export const enemyHpScale = (seconds, players) => (1 + 0.12 * Math.floor(seconds / 60)) * (1 + 0.35 * (players - 1));
export const spawnRateScale = (players) => 0.6 + 0.4 * players;
export const SPAWN_DISTANCE = { min: 520, max: 680 };

// Deterministic visual formulas shared by server and client.
export const orbitAngle = (gameTime, rps, index, count) => gameTime * rps * Math.PI * 2 + (index * Math.PI * 2) / count;
