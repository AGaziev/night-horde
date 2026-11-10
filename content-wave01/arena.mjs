// Arena: a duo stands in the 10:00 wave for 60 s (god mode), builds forced. Measures damage taken, damage dealt, freeze uptime.
// APP=<dir> node arena.mjs
const APP = process.env.APP ?? new URL('../app/', import.meta.url).pathname;
const { Room } = await import(APP + '/server/game.js');
const { TICK_HZ } = await import(APP + '/public/shared/content.js');
const dt = 1 / TICK_HZ;
const T0 = +(process.env.T0 ?? 600), SECS = 60, RUNS = 4;
const P = [['might', 3], ['area', 3], ['mail', 3], ['hourglass', 3]];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const builds = {
	'Кузнец: Хоровод+Иней': ['smith', [['orbit', 5], ['frost', 5]]],
	'Кузнец: Хоровод+Ножи': ['smith', [['orbit', 5], ['knives', 5]]],
	'Кузнец: Мельница+Иней': ['smith', [['windmill', 3], ['frost', 5]]],
	'Страж: Клинок+Иней': ['knight', [['whip', 5], ['frost', 5]]],
	'Кузнец: Мельница+Ножи': ['smith', [['windmill', 3], ['knives', 5]]],
	'Ведьма: Мельница+Иней': ['witch', [['windmill', 3], ['frost', 5]]],
	'Ведьма: Мельница+Ножи': ['witch', [['windmill', 3], ['knives', 5]]],
	'Ведьма: Хоровод+Иней': ['witch', [['orbit', 5], ['frost', 5]]],
	'Следопыт: Ножи+Искра': ['ranger', [['knives', 5], ['bolt', 5]]],
};
const out = [];
for (const [name, [hero, weapons]] of Object.entries(builds)) {
	if (ONLY && !ONLY.test(name)) continue;
	const acc = { taken: 0, allyTaken: 0, dmg: 0, allyDmg: 0, frozen: 0, near: 0 };
	for (let k = 0; k < RUNS; k++) {
		const r = new Room('A', () => {});
		r.addPlayer(1, 'X', hero);
		r.addPlayer(2, 'Y', 'stormcaller');
		r.start();
		r.time = T0;
		r.bossIdx = 2;
		r.nextEliteT = T0 + 5;
		r.nextInvasionT = T0 + 10;
		const [h, a] = [r.heroes.get(1), r.heroes.get(2)];
		h.weapons = new Map(weapons.map(([id, l]) => [id, { lvl: l, t: 0 }]));
		a.weapons = new Map([['lightning', { lvl: 5, t: 0 }], ['bolt', { lvl: 5, t: 0 }]]);
		for (const p of [h, a]) { p.passives = new Map(P); r.recalcMods(p); }
		h.x = 0; h.y = 0; a.x = 120; a.y = 0;
		const taken = new Map([[1, 0], [2, 0]]);
		const orig = r.hurtPlayer.bind(r);
		r.hurtPlayer = (p, d) => { const b = p.hp; orig(p, d); taken.set(p.pid, taken.get(p.pid) + Math.max(0, b - p.hp)); p.hp = p.maxHp; p.st = 0; };
		r.grantOffer = () => {};
		for (let i = 0; i < SECS * TICK_HZ; i++) {
			r.tick(dt);
			if (i % 15 === 0) for (const e of r.enemies) {
				if ((e.x - h.x) ** 2 + (e.y - h.y) ** 2 > 200 * 200) continue;
				acc.near++;
				if (e.frozenT > r.time) acc.frozen++;
			}
		}
		acc.taken += taken.get(1) / RUNS; acc.allyTaken += taken.get(2) / RUNS;
		acc.dmg += h.dmg / RUNS; acc.allyDmg += a.dmg / RUNS;
	}
	out.push([name, Math.round(acc.taken), Math.round(acc.allyTaken), Math.round(acc.dmg / SECS), Math.round(acc.allyDmg / SECS), Math.round((acc.frozen / Math.max(1, acc.near)) * 100) + '%']);
}
console.log('| Билд (союзник — Заклинательница бурь) | урон по нему за 60 с | по союзнику | его урон/с | союзника урон/с | заморожено рядом |');
console.log('|---|---|---|---|---|---|');
for (const r of out) console.log('| ' + r.join(' | ') + ' |');
