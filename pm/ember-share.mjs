// node pm/ember-share.mjs <run-sim json...>: what players pick late in the run.
// Per file: share of embers among the cards taken after 2/3 of the run length (10:00 at night), ember-only offers,
// overclocks offered / taken, banished cards, when the 6 + 4 slots filled up. Works on v19 logs too (no overclocks there).
import fs from 'node:fs';
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
console.log('file | players | late picks per player | embers % | late offers with only embers % | overclocks offered / taken per player | banished | slots full (share, median)');
for (const f of process.argv.slice(2)) {
	const { logs } = JSON.parse(fs.readFileSync(f, 'utf8'));
	let n = 0, late = 0, emb = 0, offers = 0, onlyEmb = 0, seen = 0, took = 0, bans = 0, trimmed = 0;
	const full = [];
	for (const l of logs) {
		const from = (l.runLength ?? 900) * (2 / 3);
		if (JSON.stringify(l).length > 27000) trimmed++;
		for (const p of l.team) {
			n++;
			for (const e of p.picks) {
				if (e[0] < from || e[2] !== 'pick') continue;
				late++;
				if (e[4] === 'ember') emb++;
				const of = typeof e.at(-1) === 'string' && e.length > 7 ? e.at(-1).split(',') : null;
				if (of) {
					offers++;
					if (of.every((c) => c.startsWith('ember_'))) onlyEmb++;
				}
			}
			seen += p.ovr?.seen ?? 0;
			took += p.ovr?.took.length ?? 0;
			bans += p.bans?.length ?? 0;
			if (p.slotsFullAt != null) full.push(p.slotsFullAt);
		}
	}
	full.sort((a, b) => a - b);
	console.log([
		f.split('/').pop(), n, (late / n).toFixed(1), late ? Math.round((emb / late) * 100) + '%' : '—',
		offers ? Math.round((onlyEmb / offers) * 100) + '%' : '—', `${(seen / n).toFixed(1)} / ${(took / n).toFixed(1)}`, (bans / n).toFixed(1),
		full.length ? `${Math.round((full.length / n) * 100)}%, ${mmss(full[full.length >> 1])}` : '—',
	].join(' | ') + (trimmed ? ` | trimmed logs: ${trimmed}` : ''));
}
