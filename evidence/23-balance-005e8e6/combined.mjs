// Combined view of the primary (seeds 1–60) and additional (61–200) attempts, for reference only: paired win Δ per cell.
import fs from 'node:fs';
import path from 'node:path';
const B = path.dirname(new URL(import.meta.url).pathname);
const rows = ['attempts.jsonl', 'attempts-extra.jsonl'].flatMap(f => fs.readFileSync(path.join(B, f), 'utf8').trim().split('\n').map(JSON.parse));
const cells = new Map();
for (const r of rows) { const k = `${r.bot} ${r.mode} ${r.n}p`; if (!cells.has(k)) cells.set(k, { base: new Map(), head: new Map() }); cells.get(k)[r.rev].set(r.seed, r); }
const pct = x => (100 * x).toFixed(1);
console.log('| Ячейка (seeds 1–200) | main | кандидат | пары | парная Δ п.п. (95% ДИ) |\n|---|---|---|---|---|');
for (const [k, c] of [...cells].sort()) {
	const pairs = [...c.base.keys()].filter(s => c.base.get(s).terminal && c.head.get(s)?.terminal);
	const d = pairs.map(s => +c.head.get(s).win - +c.base.get(s).win), m = d.reduce((a, x) => a + x, 0) / d.length;
	const h = 1.96 * Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / (d.length - 1)) / Math.sqrt(d.length);
	const w = rev => pairs.filter(s => c[rev].get(s).win).length;
	console.log(`| ${k} | ${w('base')}/${pairs.length} | ${w('head')}/${pairs.length} | ${pairs.length} | ${pct(m)} (${pct(m - h)}…${pct(m + h)}) |`);
}
