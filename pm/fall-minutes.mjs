// node pm/fall-minutes.mjs <run-sim json...>: wins and the minute the group fell (share of all runs), plus who hit last.
import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
	const { logs } = JSON.parse(fs.readFileSync(f, 'utf8'));
	const n = logs.length, len = logs[0]?.runLength ?? 900;
	const step = len >= 900 ? 60 : 40; // lunch minutes are 40 s of night time per… keep real minutes of the mode
	const buckets = new Array(Math.ceil(len / 60)).fill(0);
	for (const l of logs) if (!l.win) buckets[Math.min(buckets.length - 1, Math.floor(l.time / 60))]++;
	const by = {};
	for (const l of logs) if (!l.win) for (const p of l.team) for (const d of p.deaths ?? []) { const k = d.from.split(':')[0]; by[k] = (by[k] ?? 0) + 1; }
	const wins = logs.filter((l) => l.win).length;
	console.log(`${f.split('/').pop()}: win ${wins}/${n} = ${Math.round((wins / n) * 100)}%; fell by minute: ${buckets.map((b, i) => `${i + 1}:${b}`).filter((s) => !s.endsWith(':0')).join(' ')}; downs by ${Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ')}`);
	void step;
}
