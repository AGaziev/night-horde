// Summarises raw/*.out: per-attempt JSONL (attempts.jsonl) and the markdown table (table.md). base = main, head = candidate.
// SET=extra reads jobs-extra.txt and raw-extra/ (the additional seeds 61–200) into attempts-extra.jsonl and table-extra.md.
import fs from 'node:fs';
import path from 'node:path';
const B = path.dirname(new URL(import.meta.url).pathname), SET = process.env.SET ? '-' + process.env.SET : '', RAW = path.join(B, 'raw' + SET);
const jobs = fs.readFileSync(path.join(B, `jobs${SET}.txt`), 'utf8').trim().split('\n').map(l => l.split(' '));
const SNIPER = new Set(['sniper:shot', 'outpost:shot']);
const rows = [];
for (const [rev, mode, n, bot, seed] of jobs) {
	const file = `${rev}-${mode}-${n}-${bot}-${seed}.out`, base = { rev, mode, n: +n, bot, seed: +seed, file };
	let r;
	try {
		const lines = fs.readFileSync(path.join(RAW, file), 'utf8').trim().split('\n');
		const j = JSON.parse(lines[lines.length - 1]), c = j.completion[0], l = j.logs[0];
		const sum = (k) => l.team.reduce((a, p) => a + (p.taken?.[k] ?? 0), 0);
		const mid = l.runLength / 2;
		r = {
			...base, completion: c, terminal: c.terminal === true && c.state === 'over' && c.finishCalls === 1, win: l.win, grade: l.grade, time: +l.time.toFixed(1),
			heroes: l.team.map(p => p.hero), downs: l.team.flatMap(p => p.downs.map(([t, by]) => [Math.round(t), by])),
			sniperTaken: sum('sniper:shot'), outpostTaken: sum('outpost:shot'), sniperShots: l.specials?.sniper?.shots ?? 0,
			weaponsAtMid: l.team.map(p => 1 + (p.picks ?? []).filter(k => k[0] <= mid && k[4] === 'weapon' && k[5] === 1).length),
			bossDmg: Math.round((l.bosses ?? []).reduce((a, b) => a + (b.dmg ?? 0), 0)), bossesKilled: (l.bosses ?? []).filter(b => b.killedAt != null).length,
			finale: l.finale ? { reached: true, win: l.win } : null, levels: l.team.map(p => p.level),
		};
	} catch (e) { r = { ...base, terminal: false, error: String(e).slice(0, 300) }; }
	rows.push(r);
}
fs.writeFileSync(path.join(B, `attempts${SET}.jsonl`), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

const wilson = (k, n) => { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const pct = x => (100 * x).toFixed(1);
const paired = (d) => { const m = d.reduce((a, x) => a + x, 0) / d.length, sd = Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, d.length - 1)), h = 1.96 * sd / Math.sqrt(d.length); return [m, m - h, m + h]; };
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const target = (bot) => bot === 'human' ? [0.25, 0.40] : [0, 0.75];
const cells = new Map();
for (const r of rows) { const k = `${r.bot} ${r.mode} ${r.n}p`; if (!cells.has(k)) cells.set(k, { bot: r.bot, base: new Map(), head: new Map() }); cells.get(k)[r.rev].set(r.seed, r); }
const out = [];
out.push('| Ячейка | main: победы/терм. (%, 95% ДИ Уилсона) | кандидат: победы/терм. (%, 95% ДИ) | Δ п.п. | пары | парная Δ п.п. (95% ДИ) | расходящиеся пары +/− | main вне цели | нетерм. main/канд. |');
out.push('|---|---|---|---|---|---|---|---|---|');
const ext = ['| Ячейка | ср. минута поражения main→канд. | падений от Трубача и гарнизона (из всех падений) main→канд. | урон Трубача и гарнизона на забег main→канд. | выстрелов Трубача на забег main→канд. | оружий у игрока к середине main→канд. | урон по боссам на забег, тыс. main→канд. | финал: дошли/выиграли main→канд. |', '|---|---|---|---|---|---|---|---|'];
const causes = new Map();
const all = [], shotD = [];
for (const [k, c] of [...cells].sort()) {
	const st = m => { const v = [...m.values()], t = v.filter(r => r.terminal); return { t, w: t.filter(r => r.win).length, bad: v.length - t.length }; };
	const b = st(c.base), h = st(c.head);
	const pairs = [...c.base.keys()].filter(s => c.base.get(s).terminal && c.head.get(s)?.terminal);
	const d = pairs.map(s => +c.head.get(s).win - +c.base.get(s).win); all.push(...d);
	const [m, lo, hi] = paired(d), up = d.filter(x => x > 0).length, down = d.filter(x => x < 0).length;
	const [bl, bh] = wilson(b.w, b.t.length), [hl, hh] = wilson(h.w, h.t.length);
	const [tl, th] = target(c.bot), bp = b.w / b.t.length;
	const off = bp < tl ? `ниже ${pct(tl)}%` : bp > th ? `выше ${pct(th)}%` : '—';
	out.push(`| ${k} | ${b.w}/${b.t.length} (${pct(bp)}%, ${pct(bl)}–${pct(bh)}) | ${h.w}/${h.t.length} (${pct(h.w / h.t.length)}%, ${pct(hl)}–${pct(hh)}) | ${(100 * (h.w / h.t.length - bp)).toFixed(1)} | ${pairs.length} | ${pct(m)} (${pct(lo)}…${pct(hi)}) | ${up}/${down} | ${off} | ${b.bad}/${h.bad} |`);
	const f = (t, g) => mean(t.map(g));
	const dn = t => `${t.reduce((a, r) => a + r.downs.filter(([, by]) => SNIPER.has(by)).length, 0)} (${t.reduce((a, r) => a + r.downs.length, 0)})`;
	const lossM = t => (mean(t.filter(r => !r.win).map(r => r.time)) / 60).toFixed(1);
	const fin = t => `${t.filter(r => r.finale).length}/${t.filter(r => r.finale && r.win).length}`;
	ext.push(`| ${k} | ${lossM(b.t)}→${lossM(h.t)} | ${dn(b.t)}→${dn(h.t)} | ${f(b.t, r => r.sniperTaken + r.outpostTaken).toFixed(0)}→${f(h.t, r => r.sniperTaken + r.outpostTaken).toFixed(0)} | ${f(b.t, r => r.sniperShots).toFixed(1)}→${f(h.t, r => r.sniperShots).toFixed(1)} | ${f(b.t, r => mean(r.weaponsAtMid)).toFixed(2)}→${f(h.t, r => mean(r.weaponsAtMid)).toFixed(2)} | ${(f(b.t, r => r.bossDmg) / 1000).toFixed(0)}→${(f(h.t, r => r.bossDmg) / 1000).toFixed(0)} | ${fin(b.t)}→${fin(h.t)} |`);
	for (const s of pairs) shotD.push(c.head.get(s).sniperShots - c.base.get(s).sniperShots);
	for (const rev of ['base', 'head']) for (const r of c[rev].values()) for (const [, by] of r.downs ?? []) { const key = `${rev} ${by}`; causes.set(key, (causes.get(key) ?? 0) + 1); }
}
const [m, lo, hi] = paired(all), [sm, slo, shi] = paired(shotD);
out.push('', `Все ячейки вместе: ${all.length} пар, парная Δ побед ${pct(m)} п.п. (95% ДИ ${pct(lo)}…${pct(hi)}); расходящихся пар +${all.filter(x => x > 0).length}/−${all.filter(x => x < 0).length}.`);
out.push(`Выстрелов Трубача за забег, парная Δ: ${sm.toFixed(2)} (95% ДИ ${slo.toFixed(2)}…${shi.toFixed(2)}).`);
out.push('', ...ext);
const top = rev => [...causes].filter(([k]) => k.startsWith(rev + ' ')).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k.slice(rev.length + 1)} ${v}`).join(', ');
out.push('', `Причины падений, все ячейки, main: ${top('base')}.`, `Кандидат: ${top('head')}.`);
const bad = rows.filter(r => !r.terminal);
out.push('', `Незавершённых или с ошибкой: ${bad.length} из ${rows.length}` + (bad.length ? ': ' + bad.map(r => `${r.file} ${r.error ?? JSON.stringify(r.completion)}`).join('; ') : ''));
fs.writeFileSync(path.join(B, `table${SET}.md`), out.join('\n') + '\n');
console.log(out.join('\n'));
