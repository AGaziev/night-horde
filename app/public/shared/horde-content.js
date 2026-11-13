// The first asymmetric-mode tuning is deliberately isolated from ordinary PvE.
export const HORDE_RULESET = 'horde';
export const HORDE_MAX_HEROES = 4;
export const HORDE_SECONDS = 15 * 60;
export const HORDE_BOSS_AT = 12 * 60;
export const HORDE_BOSS_TYPE = 'boss';
export const HORDE_ARENA = Object.freeze({ minX: -1800, maxX: 1800, minY: -1200, maxY: 1200 });
export const HORDE_LIMITS = Object.freeze({ ambient: 120, manual: 180, total: 350, queued: 3, spawnDistance: 600, warning: 1.5, preparation: 0.5, retireDistance: 1900 });
export const HORDE_ECONOMY = Object.freeze({ start: 80, cap: 180, perSecond: 5, upgradeCosts: Object.freeze([70, 130]), upgradeAt: Object.freeze([180, 480]) });

export const HORDE_PACKS = Object.freeze({
	swarm: Object.freeze({ id: 'swarm', name: 'Стая', icon: '🦇', cost: 24, at: 0, units: Object.freeze(['bat', 'bat', 'bat', 'bat', 'bat', 'bat', 'bat', 'bat', 'ghoul', 'ghoul', 'ghoul', 'ghoul']), desc: 'Быстрая стая и лёгкая пехота' }),
	brutes: Object.freeze({ id: 'brutes', name: 'Тяжёлый отряд', icon: '☠', cost: 36, at: 0, units: Object.freeze(['brute', 'brute', 'brute', 'skel', 'skel', 'skel']), desc: 'Громилы с сопровождением' }),
	ranged: Object.freeze({ id: 'ranged', name: 'Обстрел', icon: '➶', cost: 32, at: 120, units: Object.freeze(['spitter', 'spitter', 'spitter', 'skel', 'skel', 'skel', 'skel']), desc: 'Стрелки с прикрытием' }),
});

export function clampHordePosition(x, y, padding = 0) {
	return { x: Math.max(HORDE_ARENA.minX + padding, Math.min(HORDE_ARENA.maxX - padding, x)), y: Math.max(HORDE_ARENA.minY + padding, Math.min(HORDE_ARENA.maxY - padding, y)) };
}

export function hordeUpgradePrice(level) {
	return HORDE_ECONOMY.upgradeCosts[level] ?? null;
}
