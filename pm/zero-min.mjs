// Share of minutes with zero damage taken, by run minute (only runs alive at that minute). node pm/zero-min.mjs <from> <to> <batch.json...>
import fs from 'node:fs';
const [a, b, ...files] = process.argv.slice(2);
console.log(`| Файл | минуты ${a}–${b}: доля без урона | по минутам |`);
console.log('|---|---|---|');
for (const f of files) {
	const { logs } = JSON.parse(fs.readFileSync(f, 'utf8'));
	const z = {}, n = {};
	for (const L of logs) for (const m of L.minutes) if (m.m >= +a && m.m <= +b) { n[m.m] = (n[m.m] ?? 0) + 1; if (m.taken === 0) z[m.m] = (z[m.m] ?? 0) + 1; }
	const tz = Object.values(z).reduce((s, v) => s + v, 0), tn = Object.values(n).reduce((s, v) => s + v, 0);
	console.log(`| ${f.split('/').pop()} | ${Math.round((tz / tn) * 100)}% | ${Object.keys(n).map((m) => Math.round(((z[m] ?? 0) / n[m]) * 100)).join(' ')} |`);
}
