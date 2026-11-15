import { dailyKey, compareDaily } from '/shared/daily.js';
const KEY = 'nh.dailyRecords';
export function localDailyRecords(storage) {
	try {
		storage ??= globalThis.localStorage;
		const rows = JSON.parse(storage.getItem(KEY) || '[]');
		return Array.isArray(rows) ? rows.filter(row => row?.daily?.day && row.id && Array.isArray(row.players)) : [];
	} catch { return []; }
}
export function rememberDaily(storage, msg) {
	if (!msg.daily || !msg.runId) return;
	try { storage ??= globalThis.localStorage; } catch { return; }
	const row = { id: msg.runId, at: new Date().toISOString(), daily: msg.daily, mode: msg.mode,
		win: msg.win, grade: msg.grade, time: msg.time, kills: msg.card?.kills ?? 0,
		players: (msg.stats ?? []).map(({ name, hero, level }) => ({ name, hero, level })), detailsAvailable: false };
	const records = localDailyRecords(storage), key = dailyKey(row.daily);
	const previous = records.find(r => dailyKey(r.daily) === key);
	const best = previous && compareDaily(row, previous) <= 0 ? previous : row;
	const next = [{ ...best, completed: !!(previous?.completed || row.win) }, ...records.filter(r => dailyKey(r.daily) !== key)]
		.sort((a, b) => b.daily.day.localeCompare(a.daily.day));
	const days = new Set([...new Set(next.map(r => r.daily.day))].slice(0, 90));
	try { storage.setItem(KEY, JSON.stringify(next.filter(r => days.has(r.daily.day)))); } catch { /* storage can be unavailable in private tabs */ }
}
