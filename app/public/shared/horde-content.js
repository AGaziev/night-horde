// The first asymmetric-mode tuning is deliberately isolated from ordinary PvE.
export const HORDE_RULESET = 'horde';
export const HORDE_MAX_HEROES = 4;
export const HORDE_SECONDS = 15 * 60;
export const HORDE_BOSS_AT = 12 * 60;
export const HORDE_BOSS_TYPE = 'boss';
export const HORDE_ARENA = Object.freeze({ minX: -1800, maxX: 1800, minY: -1200, maxY: 1200 });
export const HORDE_LIMITS = Object.freeze({ ambient: 120, manual: 180, total: 350, queued: 3, spawnDistance: 600, birthDistance: 200, warning: 1.5, preparation: 0.5, retireDistance: 1900 });
export const HORDE_ECONOMY = Object.freeze({ start: 80, cap: 180, perSecond: 5 });
export const HORDE_UPGRADE = Object.freeze({ hpPerLevel: 0.16, damagePerLevel: 0.08, weaponDamagePerLevel: 0.35 });
export const HORDE_BUILD = Object.freeze({ packSlots: 4, weaponSlots: 4, artifactSlots: 6, packMax: 5, weaponMax: 3, artifactMax: 3, rankEvery: 40, maxPicks: 22, rerolls: 2 });
export const HORDE_COMBAT = Object.freeze({ maxProcsPerTick: 3, maxHostile: 220, slowCap: 0.22, poisonStacks: 3, warning: 1.2 });

export const HORDE_PACKS = Object.freeze({
	swarm: Object.freeze({ id: 'swarm', name: 'Стая', icon: '🦇', cost: 24, at: 0, tags: ['swarm', 'melee'], units: Object.freeze(['bat', 'bat', 'bat', 'bat', 'bat', 'bat', 'bat', 'bat', 'ghoul', 'ghoul', 'ghoul', 'ghoul']), desc: 'Много хрупких бойцов: окружение и носители оружия' }),
	brutes: Object.freeze({ id: 'brutes', name: 'Громилы', icon: '☠', cost: 36, at: 0, tags: ['frontline', 'melee'], units: Object.freeze(['brute', 'brute', 'brute', 'skel', 'skel', 'skel']), desc: 'Живучая передовая удерживает героев рядом с угрозой' }),
	ranged: Object.freeze({ id: 'ranged', name: 'Стрелки', icon: '➶', cost: 32, at: 0, tags: ['ranged'], units: Object.freeze(['spitter', 'spitter', 'spitter', 'skel', 'skel', 'skel', 'skel']), desc: 'Держат дистанцию и обстреливают героев' }),
	wisps: Object.freeze({ id: 'wisps', name: 'Огоньки', icon: '✦', cost: 30, at: 0, tags: ['fast', 'swarm'], units: Object.freeze(['wisp', 'wisp', 'wisp', 'wisp', 'wisp', 'wisp', 'wisp', 'wisp']), desc: 'Быстрые преследователи для захода с фланга' }),
	bombers: Object.freeze({ id: 'bombers', name: 'Подрывники', icon: '✹', cost: 34, at: 80, tags: ['blast', 'melee'], units: Object.freeze(['bloater', 'bloater', 'bloater', 'bloater', 'bloater', 'ghoul', 'ghoul']), desc: 'Взрываются с предупреждением и вытесняют героев с позиции' }),
	shields: Object.freeze({ id: 'shields', name: 'Щитоносцы', icon: '⛨', cost: 42, at: 160, tags: ['frontline', 'guard'], units: Object.freeze(['shield', 'shield', 'skel', 'skel']), desc: 'Прикрываются спереди и совершают заметный рывок' }),
	snipers: Object.freeze({ id: 'snipers', name: 'Снайперы', icon: '⌖', cost: 46, at: 160, tags: ['ranged', 'siege'], units: Object.freeze(['sniper', 'sniper', 'ghoul', 'ghoul', 'ghoul']), desc: 'Дальний залп после прицеливания: поддержите передовой' }),
	cultists: Object.freeze({ id: 'cultists', name: 'Культисты', icon: '⚕', cost: 38, at: 80, tags: ['support'], units: Object.freeze(['ghoul', 'ghoul', 'ghoul', 'skel', 'skel']), desc: 'Раз в 4 секунды лечат соседние ручные отряды; ауры не складываются' }),
});

// These are army weapons: one shared cooldown per weapon, never one proc per unit.
export const HORDE_WEAPONS = Object.freeze({
	venom: { id: 'venom', name: 'Чумной жезл', icon: '☣', tags: ['poison', 'duration', 'projectile'], cooldown: 4.5, range: 420, damage: 4, desc: 'Ядовитый снаряд: до 3 стаков яда на 3 секунды. Уровни усиливают яд' },
	frost: { id: 'frost', name: 'Криолит', icon: '❄', tags: ['control', 'duration', 'projectile'], cooldown: 5, range: 400, damage: 5, desc: 'Ледяной снаряд замедляет героя на 18% на 2,5 секунды; без заморозки' },
	storm: { id: 'storm', name: 'Грозовой тотем', icon: 'ϟ', tags: ['chain', 'area'], cooldown: 6, range: 360, damage: 8, desc: 'Предупреждённый разряд перескакивает к соседнему герою. Одна цель получает один удар' },
	arbalest: { id: 'arbalest', name: 'Костяной арбалет', icon: '➶', tags: ['projectile'], cooldown: 3.8, range: 500, damage: 6, desc: 'Боец выпускает веер из двух костяных стрел; уровни усиливают залп' },
	ember: { id: 'ember', name: 'Погребальная искра', icon: '✹', tags: ['death', 'area'], cooldown: 5, range: 130, damage: 10, desc: 'Гибель бойца рядом с героем оставляет предупреждённый взрыв. Общий откат на всю армию' },
	reaper: { id: 'reaper', name: 'Серп охоты', icon: '☾', tags: ['melee', 'area'], cooldown: 5, range: 110, damage: 12, desc: 'Боец готовит удар по области. По ослабленной ядом или морозом цели урон выше' },
});

export const HORDE_ARTIFACTS = Object.freeze({
	lens: { id: 'lens', name: 'Треснувшая линза', icon: '◉', tags: ['projectile', 'siege'], requiresWeapon: true, desc: 'За уровень: +12% дальности оружия и +8% скорости снарядов' },
	hourglass: { id: 'hourglass', name: 'Песочные часы', icon: '⌛', tags: ['duration', 'poison', 'control'], requiresWeaponTags: ['duration'], desc: 'За уровень: +20% длительности яда и замедления' },
	powder: { id: 'powder', name: 'Пороховая урна', icon: '⚱', tags: ['area', 'death', 'blast'], requiresWeaponTags: ['area'], desc: 'За уровень: +15% радиуса взрывов, удара серпа, зоны разряда и цепного перескока' },
	conductor: { id: 'conductor', name: 'Медный проводник', icon: '⌁', tags: ['chain', 'projectile'], requiresWeaponTags: ['projectile', 'chain'], desc: 'За уровень: +5% урона оружия. Снаряд даёт разряд соседнему герою с шансом 25 / 40 / 55%; общий откат 3 секунды' },
	hunter: { id: 'hunter', name: 'Глаз охотника', icon: '◈', tags: ['poison', 'control'], requiresWeaponTags: ['poison', 'control'], desc: 'За уровень: +15% урона оружия по отравленным или замедленным героям' },
	tether: { id: 'tether', name: 'Узы легиона', icon: '∞', tags: ['support', 'frontline'], requiresWeapon: true, requiresPacks: 2, desc: 'Оружие сильнее рядом с другим семейством: +6% за уровень и семейство, до трёх семейств' },
	brood: { id: 'brood', name: 'Матка роя', icon: '♧', tags: ['swarm'], desc: 'За уровень: один дополнительный боец сопровождения при покупке пачки. Учитывается в населении и очереди' },
	carapace: { id: 'carapace', name: 'Хитиновый панцирь', icon: '⛨', tags: ['frontline', 'guard'], desc: 'За уровень: новые бойцы получают барьер на 12% здоровья. Барьер не восстанавливается' },
	march: { id: 'march', name: 'Барабан марша', icon: '♬', tags: ['fast', 'support'], requiresPacks: 2, desc: 'За уровень: +6% скорости рядом с другим ручным семейством; несколько барабанов не складываются' },
	supply: { id: 'supply', name: 'Военный обоз', icon: '▣', tags: ['economy'], desc: 'За уровень: пачки дешевле на 5%, запас ресурса больше на 20. Урон не усиливает' },
	idol: { id: 'idol', name: 'Кровавый идол', icon: '♦', tags: ['frontline', 'melee'], requiresWeapon: true, desc: 'За уровень: +15% урона оружия, если у бойца-носителя меньше половины здоровья' },
	censer: { id: 'censer', name: 'Чумная кадильница', icon: '♨', tags: ['poison', 'area'], requiresWeapons: ['venom'], desc: 'За уровень: +10% длительности яда. Ослабленная доза заражает одного соседа в радиусе 160 / 180 / 200; дальше не распространяется' },
});

export const HORDE_SYNERGIES = Object.freeze([
	{ id: 'fever', name: 'Лихорадка', weapons: ['venom', 'frost'], desc: 'Яд наносит на 35% больше урона замедленной цели' },
	{ id: 'conduit', name: 'Живая цепь', weapons: ['storm'], artifacts: ['conductor'], desc: 'Разряд перескакивает ещё раз; против одного живого героя зона удара шире на 25%' },
	{ id: 'cremation', name: 'Крематорий', weapons: ['ember'], artifacts: ['powder'], desc: 'После взрыва возникает второй предупреждённый импульс с 45% урона' },
	{ id: 'pursuit', name: 'Дикая охота', weapons: ['reaper'], artifacts: ['march'], desc: 'Дальность серпа +60, его откат короче на 20%' },
	{ id: 'volley', name: 'Костяной ливень', weapons: ['arbalest'], artifacts: ['lens'], desc: 'Ещё одна стрела в залпе; урон каждой стрелы 80%' },
]);

export function hordeSynergies(build) {
	return HORDE_SYNERGIES.filter((s) => (s.weapons || []).every((id) => build.weapons?.[id] > 0)
		&& (s.artifacts || []).every((id) => build.artifacts?.[id] > 0));
}

export function hordeCardDef(kind, id) {
	return ({ pack: HORDE_PACKS, weapon: HORDE_WEAPONS, artifact: HORDE_ARTIFACTS })[kind]?.[id] ?? null;
}

export function clampHordePosition(x, y, padding = 0) {
	return { x: Math.max(HORDE_ARENA.minX + padding, Math.min(HORDE_ARENA.maxX - padding, x)), y: Math.max(HORDE_ARENA.minY + padding, Math.min(HORDE_ARENA.maxY - padding, y)) };
}
