// Solo balance: bot runs in a circle, always picks the first choice, 5 minutes.
import { Room } from '../app/server/game.js';
import { TICK_HZ, HEROES } from '../app/public/shared/content.js';

const RUNS = +(process.argv[2] || 8), LIMIT = 300, dt = 1 / TICK_HZ;
const rows = [];
for (const id of Object.keys(HEROES)) {
	const res = [];
	for (let run = 0; run < RUNS; run++) {
		const r = new Room('BAL', (pid, msg) => { if (msg.t === 'lvl') queueMicrotask(() => r.handle(pid, { t: 'pick', i: 0 })); });
		r.addPlayer(1, 'Bot', id);
		r.start();
		const h = r.heroes.get(1);
		const R = +(process.argv[3] || 250), w = (h.speed * 0.9) / R;
		let ang = 0;
		while (r.state === 'play' && r.time < LIMIT) {
			ang += w * h.mods.speedMul * dt;
			r.handle(1, { t: 'pos', x: Math.cos(ang) * R, y: Math.sin(ang) * R, fx: -Math.sin(ang), fy: Math.cos(ang) });
			r.tick(dt);
			await null;
		}
		res.push({ t: Math.min(LIMIT, r.time), lvl: h.level, kills: h.kills, survived: r.state === 'play' });
	}
	const avg = (k) => res.reduce((s, x) => s + x[k], 0) / res.length;
	const med = (k) => { const a = res.map((x) => x[k]).sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
	rows.push({ id, name: HEROES[id].name, avgT: avg('t'), medT: med('t'), avgLvl: avg('lvl'), avgKills: avg('kills'), surv: res.filter((x) => x.survived).length });
}
console.log('| Герой | Живёт, с (сред./мед.) | Дожили до 5:00 | Уровень (сред.) | Убийств (сред.) |');
console.log('|---|---|---|---|---|');
for (const x of rows) console.log(`| ${x.name} | ${x.avgT.toFixed(0)} / ${x.medT.toFixed(0)} | ${x.surv}/${RUNS} | ${x.avgLvl.toFixed(1)} | ${x.avgKills.toFixed(0)} |`);
