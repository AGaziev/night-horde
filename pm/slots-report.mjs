// node pm/slots-report.mjs: table over pm/sims/slots/<v>-<pick>-<mode>.json — wins, avg end, duos+evos, weapons, levels.
import fs from 'node:fs';
const dir = new URL('./sims/slots/', import.meta.url).pathname;
const rows = [];
for (const v of ['4x4', '5x4', '5x5', '6x4', '6x6']) for (const mode of ['night', 'lunch']) for (const pick of ['human', 'smart']) {
	const f = `${dir}${v}-${pick}-${mode}.json`;
	if (!fs.existsSync(f)) continue;
	const { logs } = JSON.parse(fs.readFileSync(f, 'utf8'));
	let wins = 0, end = 0, combos = 0, nW = 0, plainLv = 0, plainN = 0, maxed = 0, n = 0;
	for (const l of logs) {
		if (l.win) wins++;
		end += l.win ? l.runLength : l.time;
		for (const p of l.team) {
			n++;
			combos += p.duos.length + p.evos.length;
			nW += p.build.weapons.length;
			for (const w of p.build.weapons) {
				const m = /^([a-z]+)(\d+)$/.exec(w);
				if (!m) continue;
				const lv = +m[2];
				// Plain weapons only (max 5); duos (max 3) and evolutions (1) are counted as combos.
				if (!['thunderslash', 'orb', 'orrery', 'windmill', 'tripwire', 'fanback', 'molotov', 'minefield', 'icebomb', 'aurora', 'censer', 'icedisc', 'stormlight', 'volley', 'phalanx', 'firewheel'].includes(m[1]) && lv <= 5 && !/^(swarm|crescent|bladestorm|millstones|tocsin|tempest|moonblade|fireworks|blizzard|pitfall|bastion|firepath|beacon|banner|quagmire)$/.test(m[1])) {
					plainLv += lv; plainN++;
					if (lv === 5) maxed++;
				}
			}
		}
	}
	rows.push({ v, mode, pick, runs: logs.length, win: Math.round((wins / logs.length) * 100), end: (end / logs.length / 60).toFixed(1), combos: (combos / n).toFixed(2), weapons: (nW / n).toFixed(1), lv: plainN ? (plainLv / plainN).toFixed(2) : '—', maxed: plainN ? Math.round((maxed / plainN) * 100) : 0 });
}
console.log('| Слоты | Режим | Бот | Забегов | Победы | Конец, мин | Связок+эволюций | Оружий в конце | Ср. уровень обычного оружия | Обычных на 5 ур. |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.v.replace('x', '+')} | ${r.mode === 'night' ? 'Ночь' : 'Обед'} | ${r.pick === 'human' ? '«человек»' : 'умный'} | ${r.runs} | ${r.win}% | ${r.end} | ${r.combos} | ${r.weapons} | ${r.lv} | ${r.maxed}% |`);
