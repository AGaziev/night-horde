// node pm/power.mjs <run-sim json...>: per-source power index = damage share / owned-time share within each player.
import fs from 'node:fs';
const APP = process.env.APP ?? new URL('../app/', import.meta.url).pathname;
const { DUOS, EVOS, HEROES } = await import(APP + '/public/shared/content.js');
const agg = {};
for (const f of process.argv.slice(2)) {
	const { logs } = JSON.parse(fs.readFileSync(f, 'utf8'));
	for (const l of logs) for (const p of l.team) {
		const own = {}; // id -> [from, to]
		own[HEROES[p.hero].weapon] = [0, l.time];
		for (const e of p.picks) if (e[2] === 'pick' && e[4] === 'weapon' && e[5] === 1 && !own[e[3]]) own[e[3]] = [e[0], l.time];
		for (const [t, id] of [...p.duos, ...p.evos]) {
			own[id] = [t, l.time];
			for (const part of DUOS[id]?.parts ?? [EVOS[id]?.from]) if (own[part]) own[part][1] = Math.min(own[part][1], t);
		}
		const owned = Object.entries(own).map(([id, [a, b]]) => [id, Math.max(1, b - a)]);
		const T = owned.reduce((s, [, v]) => s + v, 0);
		const D = p.dmgBy.filter((d) => own[d.id]).reduce((s, d) => s + d.dmg, 0) || 1;
		for (const [id, sec] of owned) {
			if (sec < 60) continue;
			const d = p.dmgBy.find((x) => x.id === id)?.dmg ?? 0;
			(agg[id] ??= []).push((d / D) / (sec / T));
		}
	}
}
const rows = Object.entries(agg).map(([id, v]) => [id, v.reduce((a, b) => a + b, 0) / v.length, v.length, v.sort((a, b) => a - b)[Math.floor(v.length / 2)]]).sort((a, b) => b[1] - a[1]);
for (const [id, m, n, med] of rows) console.log(id.padEnd(13), 'index', m.toFixed(2), 'median', med.toFixed(2), 'n', n);
