// Server chooses the UTC day. Clients only display the received contract.
export const DAILY_VERSION = 1;
const rule = (id, name, description, mods) => Object.freeze({ id, name, description, mods: Object.freeze(mods) });
export const DAILY_RULES = Object.freeze([
	rule('glass', 'Хрупкая мощь', 'Максимум здоровья −30%, ваш урон +20%.', { hp: 0.7, damage: 1.2 }),
	rule('swarm', 'Щедрая орда', 'Обычные враги появляются на 15% чаще, весь опыт +15%.', { enemyRate: 1.15, xp: 1.15 }),
	rule('armor', 'Тяжёлый доспех', 'Броня +2, скорость передвижения −10%.', { armor: 2, speed: 0.9 }),
	rule('gather', 'Охота за опытом', 'Радиус сбора опыта +30%, здоровье всех врагов +15%.', { pickup: 1.3, enemyHp: 1.15 }),
]);
export function dailyFor(now = Date.now()) {
	const date = new Date(now);
	const day = date.toISOString().slice(0, 10);
	const index = ((Math.floor(date.getTime() / 86400000) % DAILY_RULES.length) + DAILY_RULES.length) % DAILY_RULES.length;
	return Object.freeze({ version: DAILY_VERSION, day, ...DAILY_RULES[index] });
}
export function dailyKey(daily) {
	return `${daily.version}:${daily.day}:${daily.mode}:${daily.players}`;
}
// A personal best, never a promise of identical drops or a global leaderboard.
export function compareDaily(a, b) {
	return (a.grade ?? (a.win ? 1 : 0)) - (b.grade ?? (b.win ? 1 : 0))
		|| a.time - b.time || (a.kills ?? 0) - (b.kills ?? 0);
}
export const dailyLabel = (daily) => `Испытание ${daily.day} (UTC): ${daily.name}`;
