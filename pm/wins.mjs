// node pm/wins.mjs <run-sim json...>: wins per file (several files of one cell can be listed, the last line sums them).
import fs from 'node:fs';
let W = 0, N = 0;
for (const f of process.argv.slice(2)) {
	const { logs } = JSON.parse(fs.readFileSync(f, 'utf8'));
	const w = logs.filter((l) => l.win).length;
	W += w; N += logs.length;
	const end = logs.reduce((a, l) => a + (l.win ? l.runLength ?? 900 : l.time), 0) / logs.length / 60;
	console.log(`${f.split('/').pop().padEnd(34)} ${w}/${logs.length} = ${Math.round((w / logs.length) * 100)}%  avg end ${end.toFixed(1)} min`);
}
if (process.argv.length > 3) console.log(`${'total'.padEnd(34)} ${W}/${N} = ${Math.round((W / N) * 100)}%`);
