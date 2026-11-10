// Damage per second of each duo vs its two parts, same dense crowd, standing god-mode hero, 40 s.
const APP = process.env.APP ?? new URL('../app/', import.meta.url).pathname;
const { Room } = await import(APP + '/server/game.js');
const { DUOS, TICK_HZ } = await import(APP + '/public/shared/content.js');
const dt = 1 / TICK_HZ;
function dps(weapons, seed = 1) {
	const r = new Room('B', () => {});
	r.addPlayer(1, 'b', 'witch');
	r.start();
	r.spawn = () => {};
	r.nextInvasionT = r.nextEliteT = Infinity;
	const h = r.heroes.get(1);
	h.x = h.y = 0; h.hp = h.maxHp = 1e9;
	h.weapons = new Map(weapons.map(([id, lvl]) => [id, { lvl, t: 0 }]));
	let total = 0;
	const keep = () => {
		while (r.enemies.length < 60) {
			const e = r.spawnEnemy('skel', [h], 1);
			const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 260;
			e.x = Math.cos(a) * d; e.y = Math.sin(a) * d; e.hp = e.maxHp = 400; e.dmg = 0; e.speed = 40;
		}
	};
	for (let i = 0; i < 40 * TICK_HZ; i++) { keep(); r.tick(dt); }
	for (const v of Object.values(h.dmgBy)) total += v;
	return total / 40;
}
const rows = [];
for (const [id, D] of Object.entries(DUOS)) {
	const [a, b] = D.parts;
	const p3 = dps([[a, 3], [b, 3]]), d1 = dps([[id, 1]]), p5 = dps([[a, 5], [b, 5]]), d3 = dps([[id, 3]]);
	rows.push([D.name, Math.round(p3), Math.round(d1), (d1 / p3).toFixed(2), Math.round(p5), Math.round(d3), (d3 / p5).toFixed(2)]);
}
console.log('| Связка | части 3+3 | I | I / части | части 5+5 | III | III / части |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) console.log('| ' + r.join(' | ') + ' |');
