// node pm/sim-report.mjs <run-sim json...>: survival, downs, pressure and damage shares from run logs.
import fs from 'node:fs';
for (const f of process.argv.slice(2)) {
	const { N, pick, logs } = JSON.parse(fs.readFileSync(f, 'utf8'));
	const wins = logs.filter((l) => l.win).length;
	const downs = logs.map((l) => l.team.reduce((s, p) => s + p.downs.length, 0));
	const firstDown = logs.map((l) => Math.min(...l.team.flatMap((p) => p.downs.map((d) => d[0])), 9999)).map((t) => (t === 9999 ? '-' : Math.round(t)));
	const downsBy = (a, b) => logs.reduce((s, l) => s + l.team.reduce((x, p) => x + p.downs.filter((d) => d[0] >= a && d[0] < b).length, 0), 0);
	const lvlAt = (m) => { const v = logs.map((l) => l.minutes[m - 1]).filter(Boolean).map((x) => x.lvl.reduce((a, b) => a + b, 0) / x.lvl.length); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '—'; };
	console.log(`\n## ${f}: ${N}p ${pick}, ${logs.length} runs; win ${wins}/${logs.length}; ends ${logs.map((l) => Math.round(l.time)).join(',')}; downs ${downs.join(',')}; firstDown ${firstDown.join(',')}`);
	const avgEnd = logs.reduce((a, l) => a + (l.win ? l.runLength ?? 900 : l.time), 0) / logs.length / 60;
	console.log(`avg end ${avgEnd.toFixed(1)} min; win ${Math.round((wins / logs.length) * 100)}%`);
	console.log(`downs by phase: 0-3 ${downsBy(0, 180)}, 3-6 ${downsBy(180, 360)}, 6-10 ${downsBy(360, 600)}, 10-15 ${downsBy(600, 901)}; lvl@3 ${lvlAt(3)} @5 ${lvlAt(5)} @10 ${lvlAt(10)} @15 ${lvlAt(15)}`);
	const M = 15;
	const row = (name, fn) => console.log(name.padEnd(7) + '|' + Array.from({ length: M }, (_, m) => { const v = logs.map((l) => l.minutes[m]).filter((x) => x && x.alive > 0).map(fn); return (v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(0) : '—').padStart(6); }).join(''));
	console.log('min    |' + Array.from({ length: M }, (_, m) => String(m + 1).padStart(6)).join(''));
	row('load%', (x) => (x.taken / Math.max(1, x.alive) / x.maxHp) * 100);
	row('enemy', (x) => x.enemies);
	row('dps', (x) => x.dps);
	row('hpMul', (x) => x.hpMul);
	const bs = {};
	for (const l of logs) for (const b of l.bosses ?? []) {
		const k = `${b.type}@${Math.round(b.at / 60 * 2) / 2}`;
		const x = (bs[k] ??= { n: 0, killed: 0, sec: [], downs: 0, by: 0, near: 0, dmg: 0 });
		x.n++;
		x.near += b.near ?? 0;
		x.dmg += b.dmg ?? 0;
		if (b.sec !== null) { x.killed++; x.sec.push(b.sec); }
		x.downs += Object.values(b.downs).reduce((a, v) => a + v, 0);
		x.by += b.downsByBoss;
	}
	const med = (v) => (v.length ? v.sort((a, b) => a - b)[v.length >> 1].toFixed(0) : '—');
	if (Object.keys(bs).length) console.log('bosses: ' + Object.entries(bs).sort((a, b) => +a[0].split('@')[1] - +b[0].split('@')[1] || a[0].localeCompare(b[0])).map(([k, x]) => `${k} kill ${x.killed}/${x.n} med ${med(x.sec)}s near-dps ${x.near ? Math.round(x.dmg / x.near) : '—'} downs ${x.downs}(by boss ${x.by})`).join('; '));
	const dmg = {};
	let tot = 0, over40 = 0, players = 0;
	const top = {};
	for (const l of logs) for (const p of l.team) {
		players++;
		for (const d of p.dmgBy) { dmg[d.id] = (dmg[d.id] ?? 0) + d.dmg; tot += d.dmg; }
		const t = p.dmgBy[0];
		if (t && t.pct > 40) { over40++; top[t.id] = (top[t.id] ?? 0) + 1; }
	}
	console.log('share: ' + Object.entries(dmg).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${(v / tot * 100).toFixed(1)}%`).join(', '));
	console.log(`players whose top source >40%: ${over40}/${players} ${JSON.stringify(top)}`);
	const own = {};
	for (const l of logs) for (const p of l.team) for (const d of p.dmgBy) { (own[d.id] ??= []).push(d.pct); }
	console.log('avg own-share when owned: ' + Object.entries(own).filter(([, v]) => v.length >= 2).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length, v.length]).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, a, n]) => `${k} ${a.toFixed(0)}%(n${n})`).join(', '));
}
