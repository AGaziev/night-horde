import fs from 'node:fs';
const all = { w: [], p: [], s3: [], late: 0, empty: 0, evos: [] };
const jacc = (a, b) => { const A = new Set(a.split('+')), B = new Set(b.split('+')); let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); };
process.on('exit', () => {
	if (!all.w.length) return;
	let s = 0, n = 0;
	for (let i = 0; i < all.w.length; i++) for (let j = i + 1; j < all.w.length; j++) { s += jacc(all.w[i], all.w[j]); n++; }
	const cnt = (arr) => { const m = {}; for (const x of arr) for (const id of x.split('+')) m[id] = (m[id] ?? 0) + 1; return m; };
	console.log('DIVERSITY bots %d: distinct weapon sets %d, distinct weapon+passive builds %d, mean pairwise weapon overlap (Jaccard) %s, avg weapons %s, avg passives %s',
		all.w.length, new Set(all.w).size, new Set(all.w.map((w, i) => w + '|' + all.p[i])).size, (s / n).toFixed(2),
		(all.w.reduce((a, w) => a + w.split('+').length, 0) / all.w.length).toFixed(1), (all.p.reduce((a, w) => a + (w ? w.split('+').length : 0), 0) / all.p.length).toFixed(1));
	console.log('  weapon pick counts', JSON.stringify(cnt(all.w)));
	let sj = 0, sn = 0;
	for (let i = 0; i < all.s3.length; i++) for (let j = i + 1; j < all.s3.length; j++) { sj += jacc(all.s3[i], all.s3[j]); sn++; }
	console.log('START sets at 3:00: %d bots, distinct %d, mean overlap %s; LATE offers 10:00+: %d, only heal/embers %d (%s%%); evolutions owned at the end: %d %s',
		all.s3.length, new Set(all.s3).size, (sj / Math.max(1, sn)).toFixed(2), all.late, all.empty, ((all.empty / Math.max(1, all.late)) * 100).toFixed(0), all.evos.length, JSON.stringify(cnt(all.evos.length ? [all.evos.join('+')] : [])));
	const DUO = new Set(['thunderslash', 'orb', 'orrery', 'windmill', 'tripwire', 'fanback', 'molotov', 'minefield', 'icebomb', 'aurora', 'censer', 'icedisc']);
	const arch = {};
	for (const w of all.w) { const k = w.split('+').filter((x) => DUO.has(x)).join('+') || '(без связок)'; arch[k] = (arch[k] ?? 0) + 1; }
	const withDuo = all.w.filter((w) => w.split('+').some((x) => DUO.has(x))).length;
	console.log('ARCHETYPES bots with a duo %d/%d, distinct duo sets %d: %s', withDuo, all.w.length, Object.keys(arch).filter((k) => k[0] !== '(').length, JSON.stringify(Object.entries(arch).sort((a, b) => b[1] - a[1])));
});
for (const f of process.argv.slice(2)) {
	const d = JSON.parse(fs.readFileSync(f, 'utf8'));
	const runs = d.runs;
	for (const r of runs) { all.w.push(...(r.wsets ?? [])); all.p.push(...(r.psets ?? [])); all.s3.push(...(r.start3 ?? [])); all.late += r.offersLate ?? 0; all.empty += r.emptyLate ?? 0; all.evos.push(...(r.evos ?? [])); }
	const avg = (k) => { const v = runs.filter((r) => k in r.lvlMs).map((r) => r.lvlMs[k]); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) + ` (n=${v.length})` : '—'; };
	const dmg = {};
	let tot = 0;
	for (const r of runs) for (const [k, v] of Object.entries(r.dmgBy)) { dmg[k] = (dmg[k] ?? 0) + v; tot += v; }
	const share = Object.entries(dmg).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / tot * 100).toFixed(1)}%`).join(', ');
	console.log(f, { heroes: d.heroes.join(','), lvl300: avg(300), lvl600: avg(600), lvl900: avg(900), end: runs.map((r) => r.end), downs: runs.map((r) => r.downs), revives: runs.map((r) => r.revives), elites: runs.map((r) => r.elites), items: runs.map((r) => r.items), brk: runs.map((r) => r.brk), tickMs: runs.map((r) => r.tickMs), snap: runs.map((r) => r.snapAvg) });
	console.log('  dmg share:', share);
	for (const r of runs) console.log('  ', r.build);
}
