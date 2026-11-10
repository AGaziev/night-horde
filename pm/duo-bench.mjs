// Duo bench on dummies: dps of a duo at I/II/III vs the sum of its two parts at 3+3 / 4+4 / 5+5.
// node pm/duo-bench.mjs [seconds=40] [duo ids csv]   APP=<dir> picks a code variant (default ../app). Prints a markdown table + JSON.
// Layouts: crowd — 50 immortal harmless dummies walking at the hero (ghoul speed), boss — one big one; a dummy that
// reaches the hero steps back to a ring 300–340 px away, so the stream never ends. The hero walks a small circle.
const APP = process.env.APP ?? new URL('../app/', import.meta.url).pathname;
const { Room } = await import(APP + '/server/game.js');
const C = await import(APP + '/public/shared/content.js');
const { TICK_HZ, DUOS, WEAPONS } = C;

const [secS = '40', only = ''] = process.argv.slice(2);
const SECS = +secS, dt = 1 / TICK_HZ;
const ids = only ? only.split(',') : Object.keys(DUOS);

function seeded(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function dps(weapons, layout, seed = 1) {
	const rnd = seeded(seed);
	const orig = Math.random;
	Math.random = rnd;
	try {
		const r = new Room('BENCH', () => {});
		r.addPlayer(1, 'B', 'knight');
		r.start();
		r.spawn = () => {};
		r.nextEliteT = r.nextInvasionT = Infinity;
		r.peaks = [];
		r.bossAt = [];
		const h = r.heroes.get(1);
		h.weapons = new Map(weapons.map(([id, lvl]) => [id, { lvl, t: 0.2 }]));
		h.hp = h.maxHp = 1e9;
		const home = [];
		const add = (type, x, y) => {
			const e = r.spawnEnemy(type, [h], 1);
			e.hp = e.maxHp = 1e9;
			e.x = x; e.y = y; e.speed = 60; e.dmg = 0; e.shotT = 1e9;
			home.push(e);
		};
		if (layout === 'boss') add('brute', 200, 0);
		else for (let i = 0; i < 50; i++) {
			const a = rnd() * Math.PI * 2, d = 40 + Math.sqrt(rnd()) * 280;
			add('ghoul', Math.cos(a) * d, Math.sin(a) * d);
		}
		if (layout === 'boss') home[0].r = 38;
		let a = 0;
		for (let i = 0; i < SECS * TICK_HZ; i++) {
			a += (120 / 60) * dt;
			const nx = Math.cos(a) * 60, ny = Math.sin(a) * 60;
			h.fx = nx - h.x || 1; h.fy = ny - h.y;
			const l = Math.hypot(h.fx, h.fy); h.fx /= l; h.fy /= l;
			h.mvx = h.fx; h.mvy = h.fy; h.movedT = r.time;
			h.x = nx; h.y = ny;
			r.tick(dt);
			for (const e of home) {
				e.dead = false; e.hp = 1e9;
				if ((e.x - h.x) ** 2 + (e.y - h.y) ** 2 < (e.r + 16) ** 2) {
					const b = rnd() * Math.PI * 2, d = 300 + rnd() * 40;
					e.x = h.x + Math.cos(b) * d; e.y = h.y + Math.sin(b) * d;
				}
			}
			r.fx.length = 0;
		}
		return h.dmg / SECS;
	} finally {
		Math.random = orig;
	}
}

export const avg = (w, layout) => (dps(w, layout, 1) + dps(w, layout, 2) + dps(w, layout, 3)) / 3;
export { DUOS };
if (!process.env.NO_MAIN) main();
function main() {
const rows = [];
for (const id of ids) {
	const [pa, pb] = DUOS[id].parts;
	const row = { id, name: DUOS[id].name };
	for (const layout of ['crowd', 'boss']) {
		for (const [lv, pl] of [[1, 3], [2, 4], [3, 5]]) {
			const duo = avg([[id, lv]], layout);
			const parts = avg([[pa, pl], [pb, pl]], layout);
			row[`${layout}${lv}`] = { duo: Math.round(duo), parts: Math.round(parts), k: Math.round((duo / parts) * 100) / 100 };
		}
	}
	rows.push(row);
	process.stderr.write(`${id} `);
}
process.stderr.write('\n');
const fmt = (c) => `${c.duo} / ${c.parts} (×${c.k})`;
console.log('| Связка | толпа I vs 3+3 | толпа II vs 4+4 | толпа III vs 5+5 | босс I vs 3+3 | босс III vs 5+5 |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${fmt(r.crowd1)} | ${fmt(r.crowd2)} | ${fmt(r.crowd3)} | ${fmt(r.boss1)} | ${fmt(r.boss3)} |`);
console.log('\n' + JSON.stringify(rows));
}
