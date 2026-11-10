// Shared game content and tuning. Imported by the server (Node ESM) and the browser.

export const GAME_VERSION = 'v8';
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
// Bosses (v8): regular ones at BOSS_SCHEDULE in a random order without repeats, the final one is always the Lord.
export const BOSS_SCHEDULE = [180, 360, 540, 720];
export const BOSS_POOL = ['brood', 'ram', 'gunner', 'twin'];
export const FINAL_BOSS = { at: 870, type: 'boss' };
export const BOSS_TIMES = [...BOSS_SCHEDULE, FINAL_BOSS.at];
// Boss hp = def.hp × this: follows the regular enemy curve (players included) at a gentler slope.
export const BOSS_HP = { k: 0.38, pow: 0.9, solo: 0.75 };
export const bossHpScale = (seconds, players) => BOSS_HP.k * enemyHpScale(seconds, players) ** BOSS_HP.pow * (players > 1 ? 1 : BOSS_HP.solo);

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
// Passive multipliers are applied per level (value * level). `tpl` shows the value one card adds ({v}, see passiveDesc);
// `noRarity` passives (integer steps) keep their level table and get no card rarity.
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
	mail: { name: 'Кольчуга', icon: '⛨', desc: '−1 к каждому полученному удару', tpl: '−{v} к каждому полученному удару', stat: 'armor', perLevel: 1 },
	ember: { name: 'Уголёк', icon: '♨', desc: 'Удары поджигают: шанс 8% за уровень', tpl: 'Удары поджигают: +{v}% шанса', stat: 'burnChance', perLevel: 0.08, extra: { burnDps: [3, 4, 5, 6, 8] } },
	frostcore: { name: 'Ледяное сердце', icon: '❆', desc: '+10% силы контроля; замедленные получают +6% урона за уровень', tpl: '+{v}% силы контроля; замедленные получают +6% урона за уровень', stat: 'ctrlMul', perLevel: 0.10, extra: { chillVuln: [0.06, 0.12, 0.18, 0.24, 0.30] } },
	luck: { name: 'Подкова', icon: '☘', desc: '+10% удачи: сундуки, редкие карточки, золотые кристаллы', tpl: '+{v}% удачи: сундуки, редкие карточки, золотые кристаллы', stat: 'luck', perLevel: 0.10 },
	clover: { name: 'Клевер', icon: '🍀', desc: '+15% к шансу редких карточек; эпических — вдвое больше, легендарных — втрое', tpl: '+{v}% к шансу редких карточек; эпических — вдвое больше, легендарных — втрое', stat: 'fortune', perLevel: 0.15 },
	// coop: offered only when the room has 2+ players.
	bond: { name: 'Узы', icon: '∞', desc: '+5% урона за каждого союзника в 250 px (до 3); союзникам рядом +2%', tpl: '+{v}% урона за каждого союзника в 250 px (до 3); союзникам рядом +2%', stat: 'bond', perLevel: 0.05, coop: true },
};
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
	wet: ['flask', 'molotov', 'censer', 'quagmire'],
	burn: ['trail', 'bomb', 'molotov', 'minefield', 'firewheel', 'firepath'],
	frozen: ['frost', 'icebomb', 'aurora', 'blizzard', 'icedisc', 'quagmire'],
	chill: ['frost', 'aurora', 'blizzard', 'icedisc', 'quagmire'],
	root: ['traps', 'pitfall', 'tripwire'],
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
	burnChance: 0, burnDps: 0, ctrlMul: 1, chillVuln: 0, bond: 0, fortune: 0,
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
		cd: 2.6, rage: 0.5, wave: { r: 190, warn: 0.9, dmg: 26 }, ring: { windup: 0.8, shots: 20, speed: 200, dmg: 12, life: 3 },
		call: { warn: 1.0, type: 'bat', count: 12, ring: 160 },
	},
	// Summons rings of bats around the nearest player; takes ×2 damage while calling. Charges below half hp.
	brood: {
		name: 'Матерь роя', hp: 3000, speed: 60, dmg: 24, r: 44, xp: 100, color: '#7b1fa2', boss: true, bk: 'brood',
		callCd: 7, windup: 1.5, vuln: 2, call: { type: 'bat', count: 10, ring: 150 }, rage: 0.5,
		trigger: 420, dashWarn: 0.8, dashSpeed: 520, dashTime: 0.7, rest: 1.6,
	},
	// Telegraphed charges: a red lane for dashWarn seconds, then a straight dash.
	ram: {
		name: 'Рогач', hp: 2600, speed: 70, dmg: 24, r: 38, xp: 100, color: '#a1887f', boss: true, bk: 'ram',
		trigger: 480, dashWarn: 0.8, dashSpeed: 600, dashTime: 0.75, rest: 1.8,
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
		name: 'Двуликий', hp: 1, speed: 110, dmg: 18, r: 28, xp: 40, color: '#4db6ac', boss: true, bk: 'half', blinkCd: 4.5, blinkWarn: 0.7, blinkDist: 220,
	},
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
export const ENEMY_TYPES = ['bat', 'ghoul', 'wisp', 'skel', 'brute', 'boss', 'spitter', 'bloater', 'brood', 'ram', 'gunner', 'twin', 'twinhalf'];
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
export const GROUP_LATE = { hpPerMin: [-0.008, 0.16, 0.21, 0.32], dmgPerMin: [0, 0.06, 0.07, 0.1] };
const groupLate = (key, players) => GROUP_LATE[key][Math.min(Math.max(1, players), GROUP_LATE[key].length) - 1];
export const enemyHpScale = (seconds, players) => {
	const m = Math.floor(seconds / 60), late = Math.floor(lateMin(seconds));
	const end = Math.max(0, Math.floor((seconds - PRESSURE.endFrom) / 60));
	const endQuad = PRESSURE.endQuad * (PRESSURE.endGroupMul[players - 1] ?? 1);
	return (1 + PRESSURE.hpLin * m + PRESSURE.hpQuad * late * late) * (1 + endQuad * end * end) * (1 + PRESSURE.perPlayer * (players - 1) + PRESSURE.perPlayerSq * (players - 1) ** 2)
		* (1 + groupLate('hpPerMin', players) * late);
};
export const enemyDmgScale = (seconds, players = 1) => 1 + (PRESSURE.dmgPerMin + groupLate('dmgPerMin', players)) * Math.floor(lateMin(seconds));
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
// xpMul: xp of enemies born during the peak (pressure, not a free level); spawnDist: spawn ring radius multiplier;
// sight: client view radius multiplier; burn: at the end every enemy burns and the run is won.
export const PEAK_WARN = 4;
export const PEAK_BOSS_GAP = 8;
export const PEAKS = [
	{ id: 'ring', name: 'Кольцо', hint: 'Тени смыкаются вокруг вас — держитесь вместе', frac: 1 / 6, dur: 8, ring: { type: 'bat', count: 60, r: 420, cluster: 320 }, speedMul: 1.25, xpMul: 0.3 },
	{ id: 'tide', name: 'Прилив', hint: 'Орда втрое гуще 20 секунд', frac: 1 / 2, dur: 20, spawnMul: 3, capAdd: 80, xpMul: 0.2 },
	{ id: 'eclipse', name: 'Затмение', hint: 'Тьма сужает обзор на 30 секунд, враги выходят из неё совсем близко', frac: 5 / 6, dur: 30, sight: 0.7, spawnMul: 1.3, spawnDist: 0.65, capAdd: 40, xpMul: 0.5 },
	{ id: 'dawn', name: 'Рассвет', hint: 'Последний натиск: продержитесь до рассвета', last: 30, spawnMul: 2, speedMul: 1.2, capAdd: 60, xpMul: 0.5, burn: true },
];
// Absolute schedule for a run: [{...peak, i, at, dur}]. In 15:00 the final boss (14:30) pushes «Рассвет» to 14:42.
export function peakSchedule(runLength = RUN_SECONDS, bossTimes = BOSS_TIMES) {
	return PEAKS.map((p, i) => {
		let at = p.last ? runLength - p.last : Math.round(runLength * p.frac);
		for (const b of bossTimes) {
			if (Math.abs(at - b) < PEAK_BOSS_GAP || Math.abs(at - PEAK_WARN - b) < PEAK_BOSS_GAP) at = b + PEAK_BOSS_GAP + PEAK_WARN;
		}
		return { ...p, i, at, dur: p.last ? runLength - at : p.dur };
	});
}

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
			{ dmg: 5, cd: 3.0, count: 1, radius: 70, tick: 0.5, speed: 120, life: 3.5, boom: 32, boomR: 100 },
			{ dmg: 6, cd: 2.7, count: 1, radius: 80, tick: 0.5, speed: 120, life: 3.5, boom: 44, boomR: 100 },
			{ dmg: 8, cd: 2.4, count: 2, radius: 88, tick: 0.5, speed: 120, life: 3.5, boom: 58, boomR: 100 },
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
			{ dmg: 26, cd: 2.3, count: 1, radius: 70, fuse: 0.6, pool: 2.5, poolDmg: 4, tick: 0.3 },
			{ dmg: 34, cd: 2.1, count: 2, radius: 78, fuse: 0.6, pool: 3, poolDmg: 5, tick: 0.3 },
			{ dmg: 45, cd: 1.9, count: 2, radius: 86, fuse: 0.6, pool: 3.5, poolDmg: 6, tick: 0.3 },
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
	stormlight: {
		name: 'Прожектор бури', icon: '🔦', parts: ['lantern', 'lightning'], tags: ['shock', 'aoe'],
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
			{ dmg: 44, cd: 1.9, count: 1, pierce: 8, width: 18, speed: 720, kb: 50, knifeDmg: 8, every: 65 },
			{ dmg: 58, cd: 1.7, count: 1, pierce: 10, width: 20, speed: 740, kb: 60, knifeDmg: 10, every: 60 },
			{ dmg: 76, cd: 1.5, count: 2, pierce: 99, width: 22, speed: 780, kb: 70, knifeDmg: 13, every: 60 },
		],
	},
	phalanx: {
		name: 'Фаланга', icon: '⫼', parts: ['spear', 'ward'], tags: ['phys', 'proj'],
		desc: 'Стена из копий бьёт вперёд; сломанный щит взрывается кольцом копий',
		levels: [
			{ charges: 2, cd: 9, dmg: 30, atkCd: 2.2, wall: 3, pierce: 6, width: 18, speed: 700, kb: 60, ring: 8 },
			{ charges: 2, cd: 8, dmg: 40, atkCd: 2.0, wall: 3, pierce: 8, width: 20, speed: 720, kb: 70, ring: 10 },
			{ charges: 3, cd: 7, dmg: 52, atkCd: 1.8, wall: 4, pierce: 99, width: 22, speed: 760, kb: 80, ring: 12 },
		],
	},
	firewheel: {
		name: 'Огненное колесо', icon: '☸', parts: ['orbit', 'trail'], tags: ['fire', 'aoe'],
		desc: 'Огненные колёса кружат, поджигают врагов и оставляют горящий круг',
		levels: [
			{ dmg: 10, count: 3, radius: 95, rps: 0.55, hitCd: 0.4, burn: 4, every: 0.25, patchR: 26, patchLife: 1.6, patchDmg: 3, tick: 0.3 },
			{ dmg: 14, count: 4, radius: 100, rps: 0.55, hitCd: 0.4, burn: 6, every: 0.2, patchR: 28, patchLife: 1.8, patchDmg: 4, tick: 0.3 },
			{ dmg: 19, count: 5, radius: 105, rps: 0.55, hitCd: 0.35, burn: 8, every: 0.18, patchR: 30, patchLife: 2.0, patchDmg: 5, tick: 0.3 },
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
