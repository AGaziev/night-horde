// Calm streaks mid-run: share of runs alive through the window that had ≥3 straight minutes with zero damage taken
// (and, softer, <10% hp per minute). node pm/calm.mjs <batch.json...>  Window: night 8–13, lunch 6–9.
import fs from 'node:fs';
const WIN = { night: [8, 13], lunch: [6, 9] };
const streak = (ms, ok) => { let best = 0, cur = 0; for (const m of ms) { cur = ok(m) ? cur + 1 : 0; best = Math.max(best, cur); } return best; };
console.log('| Файл | забегов | побед | ср. конец, мин | дожили до конца окна | из них ≥3 мин без урона | ≥3 мин <10% HP/мин |');
console.log('|---|---|---|---|---|---|---|');
for (const f of process.argv.slice(2)) {
	const { logs } = JSON.parse(fs.readFileSync(f, 'utf8'));
	const mode = logs[0].mode, [a, b] = WIN[mode];
	let alive = 0, zero = 0, soft = 0;
	for (const L of logs) {
		if (L.time < b * 60) continue;
		alive++;
		const ms = L.minutes.filter((m) => m.m >= a && m.m <= b);
		if (streak(ms, (m) => m.taken === 0 && m.downs === 0) >= 3) zero++;
		if (streak(ms, (m) => m.downs === 0 && m.taken / Math.max(1, m.alive) / Math.max(1, m.maxHp) < 0.1) >= 3) soft++;
	}
	const wins = logs.filter((L) => L.win).length, end = logs.reduce((s, L) => s + L.time, 0) / logs.length / 60;
	const pc = (x, n) => `${Math.round((x / Math.max(1, n)) * 100)}%`;
	console.log(`| ${f.split('/').pop()} | ${logs.length} | ${pc(wins, logs.length)} | ${end.toFixed(1)} | ${alive} | ${zero} (${pc(zero, alive)}) | ${soft} (${pc(soft, alive)}) |`);
}
