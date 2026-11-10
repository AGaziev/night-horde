// Group outcome: wins, mean end and when the group fell, by run minute. node pm/groups.mjs <batch.json...>
import fs from 'node:fs';
const BUCKETS = { night: [[0, 6], [6, 9], [9, 12], [12, 14], [14, 15]], lunch: [[0, 4], [4, 6], [6, 8], [8, 9], [9, 10]] };
console.log('| Файл | забегов | побед | ср. конец, мин | падения группы по минутам |');
console.log('|---|---|---|---|---|');
for (const f of process.argv.slice(2)) {
	const { logs } = JSON.parse(fs.readFileSync(f, 'utf8'));
	const mode = logs[0].mode, n = logs.length;
	const wins = logs.filter((L) => L.win).length, end = logs.reduce((s, L) => s + L.time, 0) / n / 60;
	const dist = BUCKETS[mode].map(([a, b]) => {
		const k = logs.filter((L) => !L.win && L.time >= a * 60 && L.time < b * 60).length;
		return `${a}–${b}: ${Math.round((k / n) * 100)}%`;
	}).join(', ');
	console.log(`| ${f.split('/').pop()} | ${n} | ${Math.round((wins / n) * 100)}% | ${end.toFixed(1)} | ${dist} |`);
}
