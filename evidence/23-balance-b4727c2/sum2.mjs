// Summarises raw2/*.out: per-attempt JSONL (attempts.jsonl) and the markdown table (table.md).
import fs from 'node:fs';
import path from 'node:path';
const B = path.dirname(new URL(import.meta.url).pathname), RAW = path.join(B, 'raw2');
const jobs = fs.readFileSync(path.join(B, 'jobs.txt'), 'utf8').trim().split('\n').map(l => l.split(' '));
const rows = [];
for (const [rev, mode, n, bot, seed] of jobs) {
	const file = `${rev}-${mode}-${n}-${bot}-${seed}.out`, base = { rev, mode, n: +n, bot, seed: +seed, file };
	let r;
	try {
		const lines = fs.readFileSync(path.join(RAW, file), 'utf8').trim().split('\n');
		const j = JSON.parse(lines[lines.length - 1]), c = j.completion[0], l = j.logs[0];
		const sum = (k) => l.team.reduce((a, p) => a + (p.taken?.[k] ?? 0), 0);
		const downs = l.team.flatMap(p => p.downs.map(([t, by]) => [Math.round(t), by]));
		r = {
			...base, completion: c, terminal: c.terminal === true && c.state === 'over' && c.finishCalls === 1, win: l.win, grade: l.grade, time: +l.time.toFixed(1),
			heroes: l.team.map(p => p.hero), downs, sniperTaken: sum('sniper:shot'), outpostTaken: sum('outpost:shot'),
			sniperShots: l.specials?.sniper?.shots ?? 0, bossesKilled: (l.bosses ?? []).filter(b => b.killedAt != null).length,
			finale: l.finale ? { reached: true, win: l.win } : null, levels: l.team.map(p => p.level),
		};
	} catch (e) { r = { ...base, terminal: false, error: String(e).slice(0, 300) }; }
	rows.push(r);
}
fs.writeFileSync(path.join(B, 'attempts.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const pct = x => (100 * x).toFixed(1);
const paired = (d) => { const m = d.reduce((a, x) => a + x, 0) / d.length, sd = Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, d.length - 1)), h = 1.96 * sd / Math.sqrt(d.length); return [m, m - h, m + h]; };
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const cells = new Map();
for (const r of rows) { const k = `${r.bot} ${r.mode} ${r.n}p`; if (!cells.has(k)) cells.set(k, { base: new Map(), head: new Map() }); cells.get(k)[r.rev].set(r.seed, r); }
const out = [];
out.push('| Ячейка | base: победы/терм. (%, 95% ДИ) | head: победы/терм. (%, 95% ДИ) | Δ п.п. | пары | парная Δ п.п. (95% ДИ) | расходящиеся пары base→head (+/−) | нетерм./ошибки base/head |');
out.push('|---|---|---|---|---|---|---|---|');
const ext = ['| Ячейка | выстрелов Трубача за забег base→head | урон sniper:shot + outpost:shot на забег base→head | падений от Трубача и гарнизона base→head | ср. время поражения, с base→head | боссов убито на забег base→head |', '|---|---|---|---|---|---|'];
const all = [], shotD = [];
for (const [k, c] of [...cells].sort()) {
	const st = m => { const v = [...m.values()], t = v.filter(r => r.terminal); return { t, w: t.filter(r => r.win).length, bad: v.length - t.length }; };
	const b = st(c.base), h = st(c.head);
	const pairs = [...c.base.keys()].filter(s => c.base.get(s).terminal && c.head.get(s)?.terminal);
	const d = pairs.map(s => +c.head.get(s).win - +c.base.get(s).win); all.push(...d);
	const [m, lo, hi] = paired(d), up = d.filter(x => x > 0).length, down = d.filter(x => x < 0).length;
	const [bl, bh] = wilson(b.w, b.t.length), [hl, hh] = wilson(h.w, h.t.length);
	out.push(`| ${k} | ${b.w}/${b.t.length} (${pct(b.w / b.t.length)}%, ${pct(bl)}–${pct(bh)}) | ${h.w}/${h.t.length} (${pct(h.w / h.t.length)}%, ${pct(hl)}–${pct(hh)}) | ${(100 * (h.w / h.t.length - b.w / b.t.length)).toFixed(1)} | ${pairs.length} | ${pct(m)} (${pct(lo)}…${pct(hi)}) | ${up}/${down} | ${b.bad}/${h.bad} |`);
	const f = (t, g) => mean(t.map(g));
	const dn = t => t.reduce((a, r) => a + r.downs.filter(([, by]) => by === 'sniper:shot' || by === 'outpost:shot').length, 0);
	const lossT = t => mean(t.filter(r => !r.win).map(r => r.time));
	ext.push(`| ${k} | ${f(b.t, r => r.sniperShots).toFixed(1)}→${f(h.t, r => r.sniperShots).toFixed(1)} | ${f(b.t, r => r.sniperTaken + r.outpostTaken).toFixed(0)}→${f(h.t, r => r.sniperTaken + r.outpostTaken).toFixed(0)} | ${dn(b.t)}→${dn(h.t)} | ${lossT(b.t).toFixed(0)}→${lossT(h.t).toFixed(0)} | ${f(b.t, r => r.bossesKilled).toFixed(2)}→${f(h.t, r => r.bossesKilled).toFixed(2)} |`);
	for (const s of pairs) shotD.push(c.head.get(s).sniperShots - c.base.get(s).sniperShots);
}
const [m, lo, hi] = paired(all), [sm, slo, shi] = paired(shotD);
out.push('', `Все ячейки вместе: ${all.length} пар, парная Δ побед ${pct(m)} п.п. (95% ДИ ${pct(lo)}…${pct(hi)}); расходящихся пар +${all.filter(x => x > 0).length}/−${all.filter(x => x < 0).length}.`);
out.push(`Выстрелов Трубача за забег, парная Δ: ${sm.toFixed(2)} (95% ДИ ${slo.toFixed(2)}…${shi.toFixed(2)}).`);
out.push('', ...ext);
const bad = rows.filter(r => !r.terminal);
out.push('', `Незавершённых или с ошибкой: ${bad.length}` + (bad.length ? ': ' + bad.map(r => `${r.file} ${r.error ?? JSON.stringify(r.completion)}`).join('; ') : ''));
fs.writeFileSync(path.join(B, 'table.md'), out.join('\n') + '\n');
console.log(out.join('\n'));
