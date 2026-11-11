// Per-rule summary of `AFF=1 node pm/duo-bench.mjs … all` output: node pm/aff-sum.mjs <file>
import fs from 'node:fs';
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').pop());
const NAME = { ringring: 'Тиски', shotshot: 'Перекрёстный огонь', tracetrace: 'Пропитка', ringshot: 'Отдача', ringtrace: 'Вязкость', shottrace: 'Наводка' };
const by = {};
for (const r of rows) (by[r.rule] ??= []).push(r);
const av = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2).replace('.', ',');
console.log('| Сродство | пар | толпа 3+3 | толпа 5+5 | босс 3+3 | босс 5+5 | среднее | разброс | пар > ×1,15 |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const [k, rs] of Object.entries(by)) {
	const col = (c) => rs.map((r) => r[c].k);
	const all = ['crowd3', 'crowd5', 'boss3', 'boss5'].flatMap(col);
	const over = rs.filter((r) => ['crowd3', 'crowd5', 'boss3', 'boss5'].some((c) => r[c].k > 1.15)).map((r) => r.name);
	console.log(`| ${NAME[k] ?? k} | ${rs.length} | ×${av(col('crowd3'))} | ×${av(col('crowd5'))} | ×${av(col('boss3'))} | ×${av(col('boss5'))} | **×${av(all)}** | ${Math.min(...all).toFixed(2)}–${Math.max(...all).toFixed(2)} | ${over.length ? over.join(', ') : '—'} |`);
}
