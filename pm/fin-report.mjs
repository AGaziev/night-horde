// node pm/fin-report.mjs <run-sim json...>: the v21 finale by cell — wins, «повержен» / «пережил», falls in the finale,
// kill time, the Lord's hp left. Several files of one cell: pass them together, a total line follows.
import fs from 'node:fs';
const med = (v) => (v.length ? v.slice().sort((a, b) => a - b)[v.length >> 1] : null);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
function stat(logs) {
	const n = logs.length, wins = logs.filter((l) => l.win), gold = logs.filter((l) => l.grade === 2);
	const reached = logs.filter((l) => l.finale?.at != null), lostFin = reached.filter((l) => !l.win);
	const pre = logs.filter((l) => l.finale), lostPre = pre.filter((l) => !l.win && l.finale.at == null);
	const left = wins.filter((l) => l.grade === 1 && l.finale?.hpLeft != null).map((l) => l.finale.hpLeft);
	const leftLost = lostFin.map((l) => l.finale.hpLeft);
	const taken = (k) => Math.round(reached.reduce((s, l) => s + l.finale.taken[k], 0) / (reached.length || 1));
	const dn = {};
	for (const l of reached) for (const [k, v] of Object.entries(l.finale.downsBy)) dn[k] = (dn[k] ?? 0) + v;
	const wall = reached.flatMap((l) => Object.values(l.finale.wall)), close = reached.flatMap((l) => Object.values(l.finale.close));
	const avg = (v) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0);
	return [
		`runs ${n}; win ${wins.length} = ${pct(wins.length, n)} (повержен ${gold.length} = ${pct(gold.length, n)}, пережил ${wins.length - gold.length} = ${pct(wins.length - gold.length, n)}); gold among wins ${pct(gold.length, wins.length)}`,
		`reached the Lord ${reached.length} = ${pct(reached.length, n)}; fell in the fight ${lostFin.length} = ${pct(lostFin.length, reached.length)} of reached; fell in the prelude ${lostPre.length}`,
		`kill time med ${med(gold.map((l) => l.finale.sec)) ?? '—'} s (min ${gold.length ? Math.min(...gold.map((l) => l.finale.sec)) : '—'}, max ${gold.length ? Math.max(...gold.map((l) => l.finale.sec)) : '—'}); rage at med ${med(reached.filter((l) => l.finale.rageAt != null).map((l) => l.finale.rageAt)) ?? '—'} s, reached rage ${pct(reached.filter((l) => l.finale.rageAt != null).length, reached.length)}`,
		`Lord hp left: survived med ${left.length ? Math.round(med(left) * 100) + '%' : '—'}, lost med ${leftLost.length ? Math.round(med(leftLost) * 100) + '%' : '—'}; Lord hp med ${med(reached.map((l) => l.finale.lordHp))}`,
		`dmg to players per run: wave ${taken('wave')}, shot ${taken('shot')}, dash ${taken('dash')}, contact ${taken('contact')}, adds ${taken('adds')}; downs by ${JSON.stringify(dn)}; revived by the ray in ${reached.filter((l) => l.finale.revived > 0).length} runs`,
		`avg seconds per hero: close to the Lord ${avg(close)}, at the wall ${avg(wall)}; adds per run ${avg(reached.map((l) => l.finale.adds.spawned))}, killed ${avg(reached.map((l) => l.finale.adds.killed))}; enemies max ${Math.max(0, ...reached.map((l) => l.finale.load.enemiesMax))}, tick max ${Math.max(0, ...reached.map((l) => l.finale.load.tickMs))} ms`,
	];
}
const all = [];
for (const f of process.argv.slice(2)) {
	const { N, pick, logs } = JSON.parse(fs.readFileSync(f, 'utf8'));
	all.push(...logs);
	console.log(`\n## ${f.split('/').pop()}: ${N}p ${pick}\n` + stat(logs).join('\n'));
}
if (process.argv.length > 3) console.log(`\n## total\n` + stat(all).join('\n'));
