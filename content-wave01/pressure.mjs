// node pressure.mjs <bal json files...>: per-minute pressure table averaged over runs + survival.
import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
	const d = JSON.parse(fs.readFileSync(f, 'utf8'));
	const runs = d.runs;
	const M = runs[0].pm.dmgPerBotMin.length;
	const avg = (key, m) => {
		const v = runs.filter((r) => r.pm.aliveT[m] > 0).map((r) => r.pm[key][m]);
		return v.length ? (v.reduce((a, b) => a + b, 0) / v.length) : NaN;
	};
	const wins = runs.filter((r) => r.win).length;
	const lv = (k) => { const v = runs.filter((r) => k in r.lvlMs).map((r) => r.lvlMs[k]); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) + ` (n=${v.length})` : '—'; };
	console.log(`\n## ${f}: ${d.N} bot(s), ${runs.length} runs; survived to 15:00: ${wins}/${runs.length}; ends ${runs.map((r) => r.end).join(',')}; downs ${runs.map((r) => r.downs).join(',')}; lvl 5:00 ${lv(300)}, 15:00 ${lv(900)}; heroes ${runs.map((r) => r.heroes.join('+')).join(' | ')}`);
	console.log('min   | ' + Array.from({ length: M }, (_, m) => String(m + 1).padStart(5)).join(''));
	const row = (name, key, digits = 0) => console.log(name.padEnd(6) + '| ' + Array.from({ length: M }, (_, m) => { const v = avg(key, m); return (Number.isNaN(v) ? '—' : v.toFixed(digits)).padStart(5); }).join(''));
	row('dmg/m', 'dmgPerBotMin');
	row('hp<50', 'lowHpPct');
	row('near', 'nearAvg', 1);
	row('life', 'lifeAvg', 1);
	console.log('alive runs per minute: ' + Array.from({ length: M }, (_, m) => runs.filter((r) => r.pm.aliveT[m] > 0).length).join(' '));
}
