import assert from 'node:assert/strict';
import { Room } from './game.js';
import { ENEMIES, SPECIALS, specialCap, EVENT_INDEX } from '../public/shared/content.js';

function setup(n = 8) {
 const r = new Room('BUDGET', () => {});
 for (let i = 1; i <= n; i++) r.addPlayer(i, `P${i}`, 'knight');
 r.start(); r.enemies.length = 0; r.time = r.runLength * 2 / 3; r.bossIdx = r.bossAt.length;
 const hs = [...r.heroes.values()]; r.updateOutposts(hs);
 return {r, hs, net:r.outposts};
}
const ordinary = r => r.enemies.filter(e => !e.dead && !e.outpost);
function fillOrdinary(r, hs, n) { while (ordinary(r).length < n) r.spawnEnemy('bat', hs, 1); }
function allPosts(r, hs) {
 r.outposts.posts.forEach((p, i) => { p.x = i * 2400; p.y = 5000; });
 for (const p of r.outposts.posts) { hs[0].x = p.x; hs[0].y = p.y; r.updateOutposts(hs); }
 assert.ok(r.enemies.some(e => e.outpost && !e.dead), 'real activated guards occupy their budget');
}

// Compare each ordinary spawn path at the same ordinary occupancy, with/without real activated garrisons.
const paths = {
	horde(r, hs) { r.specialT = { sniper: Infinity, shield: Infinity }; r.spawnAcc = 1000; r.spawn(0, hs); },
	specials(r, hs) { r.specialT = { sniper: 0, shield: 0 }; r.spawnSpecials(hs); },
	peak(r, hs) { r.peakRing({ count: 200, cluster: 1000, r: 800, type: 'bat' }, hs); },
	invasion(r, hs) { r.invasion(hs); },
	call(r, hs) { r.summon({ dead: false }, { count: 200, type: 'bat', ring: 160 }, 0, 0); },
	cursed(r, hs) { r.events.begin(EVENT_INDEX.cursed, hs); r.events.openCursed(r.events.active, hs[0], hs); },
	gold(r, hs) { r.events.begin(EVENT_INDEX.gold, hs); },
};
for (const [name, spawn] of Object.entries(paths)) {
	const counts = [];
	for (const withGuards of [false, true]) {
		const { r, hs, net } = setup(8);
		if (withGuards) allPosts(r, hs);
		else net.status = 'closed';
		hs.forEach(h => { h.x = 0; h.y = 0; });
		fillOrdinary(r, hs, name === 'specials' ? 340 : name === 'horde' ? 345 : 350);
		const before = ordinary(r).length;
		spawn(r, hs);
		counts.push(ordinary(r).length);
		assert.ok(ordinary(r).length > before, `${name}: still spawns ordinary enemies with/without guards`);
	}
	assert.equal(counts[1], counts[0], `${name}: guards do not consume ordinary capacity`);
	console.log(`density spawn ${name}: ordinary=${counts[0]} with/without real guards`);
}
{
	const { r, hs } = setup(8); allPosts(r, hs);
	r.specialT = { sniper: 0, shield: 0 };
	const cap = specialCap(SPECIALS.sniper, r.time / r.runLength, 8);
	for (let i = 0; i < cap; i++) { r.specialT.sniper = 0; r.spawnSpecials(hs); }
	assert.equal(ordinary(r).filter(e => e.def === ENEMIES.sniper).length, cap, 'guard snipers never consume the ordinary special quota');
}

console.log('Outpost spawn budgets: ordinary caps and special quotas independent of real guards: OK');
