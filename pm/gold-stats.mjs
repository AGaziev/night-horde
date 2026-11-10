// Golden shade: caught share, mean seconds to the catch, escapes before 8 s. node pm/gold-stats.mjs <batch.json...>
import fs from 'node:fs';
console.log('| Файл | теней | поймано | ср. время поимки, с | сбежало раньше 8 с |');
console.log('|---|---|---|---|---|');
for (const f of process.argv.slice(2)) {
	const { logs } = JSON.parse(fs.readFileSync(f, 'utf8'));
	const g = logs.flatMap((L) => L.events.filter((e) => e.id === 'gold' && e.end !== null));
	const caught = g.filter((e) => e.res === 1), early = g.filter((e) => e.res === 0 && e.end - e.at < 8);
	const t = caught.reduce((s, e) => s + e.end - e.at, 0) / Math.max(1, caught.length);
	console.log(`| ${f.split('/').pop()} | ${g.length} | ${caught.length} (${Math.round((caught.length / Math.max(1, g.length)) * 100)}%) | ${t.toFixed(1)} | ${early.length} |`);
}
