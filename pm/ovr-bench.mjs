// v20 stand: damage of every overclock against the plain level-5 weapon in the same fight.
// node pm/ovr-bench.mjs [reps=6] [seconds=90] [from=540] [weapons csv]
// STAND=1 — the hero strolls inside the horde instead of kiting; tune on both.
// The hero is invulnerable and kites like the sim bot, carries the tested weapon plus two level-3 helpers, enemies spawn as in a
// solo night run from `from` seconds. Prints damage per second of the tested weapon and the ratio variant / plain.
const APP = process.env.APP ?? new URL('../app/', import.meta.url).pathname;
const { Room } = await import(APP + '/server/game.js');
const { TICK_HZ, WEAPON_IDS, OVERCLOCKS } = await import(APP + '/public/shared/content.js');
const [repsS = '6', secS = '90', fromS = '540', csv = WEAPON_IDS.join(',')] = process.argv.slice(2);
const STAND = process.env.STAND === '1';
const REPS = +repsS, SECS = +secS, FROM = +fromS, dt = 1 / TICK_HZ;

function run(id, oc) {
	const r = new Room('BENCH', () => {});
	r.addPlayer(1, 'B', 'knight');
	r.start();
	r.events.next = Infinity;
	const h = r.heroes.get(1);
	const helpers = ['aura', 'bolt', 'whip', 'lantern'].filter((x) => x !== id).slice(0, 2);
	h.weapons = new Map([[id, { lvl: 5, t: 0.3, oc }], ...helpers.map((x) => [x, { lvl: 3, t: 0.3 }])]);
	r.recalcMods(h);
	r.time = FROM;
	let hits = 0;
	const hurt = r.hurtPlayer.bind(r);
	r.hurtPlayer = (p, dmg, from) => { if (p.iframes <= 0) hits++; return hurt(p, dmg, from); };
	for (let i = 0; i < SECS * TICK_HZ; i++) {
		if (h.offer) { h.offer = null; h.queue = 0; r.updateFrozen(); }
		h.hp = h.maxHp;
		let vx = 0, vy = 0;
		for (const e of r.enemies) {
			const dx = h.x - e.x, dy = h.y - e.y, d2 = dx * dx + dy * dy;
			if (d2 < 260 * 260 && d2 > 1) { const w = (e.r / 12) * 4000 / d2; vx += dx / Math.sqrt(d2) * w; vy += dy / Math.sqrt(d2) * w; }
		}
		const l = Math.hypot(vx, vy);
		if (l > 0.01) { vx /= l; vy /= l; }
		// STAND=1: the hero strolls in a small circle inside the horde instead of kiting (close-range weapons get their targets).
		if (STAND) { vx = Math.cos(i / 40) * 0.35; vy = Math.sin(i / 40) * 0.35; }
		const sp = h.speed * h.mods.speedMul * dt;
		r.handle(1, { t: 'pos', x: h.x + vx * sp, y: h.y + vy * sp, fx: vx || 1, fy: vy });
		r.tick(dt);
		r.bosses.length && r.enemies.forEach((e) => { if (e.boss) e.dead = true; });
	}
	return { dps: (h.dmgBy[id] ?? 0) / SECS, hits: hits / SECS, kills: h.kills / SECS };
}
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log('weapon     variant            dps   ratio   hits/s (contact pressure)   kills/s');
for (const id of csv.split(',')) {
	const rows = [0, 1, 2].map((oc) => {
		const v = Array.from({ length: REPS }, () => run(id, oc));
		return { dps: avg(v.map((x) => x.dps)), hits: avg(v.map((x) => x.hits)), kills: avg(v.map((x) => x.kills)) };
	});
	rows.forEach((x, oc) => console.log(id.padEnd(10), (oc ? OVERCLOCKS[id][oc - 1].id : 'plain').padEnd(12), x.dps.toFixed(0).padStart(8), (x.dps / rows[0].dps).toFixed(2).padStart(7), x.hits.toFixed(2).padStart(8), x.kills.toFixed(1).padStart(22)));
}
