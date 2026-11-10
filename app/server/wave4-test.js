// v18 checks: the two specials (Трубач, Щитоносец) and the Wave 4 events. node server/wave4-test.js
import assert from 'node:assert/strict';
import { Room } from './game.js';
import { summarize } from './runlog.js';
import { SnapshotDecoder } from '../public/js/snapshot-codec.js';
import {
	TICK_HZ, ENEMIES, ENEMY_TYPES, ST, SPECIALS, specialCap, SHIELD_DIRS, SHIELD_SHIFT, EVENTS, EVENT_INDEX, EVENT_RULES,
	ALTAR_DEALS, ITEM_TYPES, xpForNext, RARITIES, peakSchedule, bossTimes, modeDmgMul, HEROES,
} from '../public/shared/content.js';

const dt = 1 / TICK_HZ;
const SRC = { weapon: 'test', tags: [] };

function room(heroes = ['knight'], mode = 'night') {
	const r = new Room('W4', () => {});
	r.setMode(mode);
	heroes.forEach((hero, i) => r.addPlayer(i + 1, 'P' + (i + 1), hero));
	r.start();
	r.enemies.length = 0;
	r.time = 400;
	return r;
}
const hero = (r, pid = 1) => r.heroes.get(pid);
const alive = (r) => [...r.heroes.values()].filter((h) => h.st === 0);
function foe(r, type, x, y, hpMul = 1) {
	const e = r.spawnEnemy(type, alive(r), hpMul);
	e.x = x;
	e.y = y;
	return e;
}
// Enemies move, shots fly, timers run; no spawning, no events of their own.
function run(r, sec, each) {
	for (let i = 0; i < sec * TICK_HZ; i++) {
		r.time += dt;
		each?.(i);
		r.moveEnemies(dt, alive(r));
		r.rebuildGrid();
		r.updateHostile(dt);
		r.updateTimers();
		r.compactEnemies();
	}
}
const fxOf = (r, name) => r.fx.filter((f) => f[0] === name);

// --- content ---
{
	for (const id of ['sniper', 'shield', 'goldshade']) {
		assert.ok(ENEMY_TYPES.includes(id) && ENEMIES[id].special, id);
		assert.ok(ENEMY_TYPES.indexOf(id) >= 13, `${id} appended after the old types`);
	}
	assert.deepEqual(EVENTS.map((e) => e.id), ['star', 'gold', 'fog', 'altar', 'cursed', 'streak']);
	for (const E of EVENTS) assert.ok(E.name && E.hint && E.done.length, E.id);
	assert.ok(EVENT_RULES.gap[0] >= 90);
	assert.equal(specialCap(SPECIALS.sniper, 0.39, 1), 0);
	assert.ok(specialCap(SPECIALS.sniper, 0.4, 1) >= 1 && specialCap(SPECIALS.sniper, 0.8, 4) > specialCap(SPECIALS.sniper, 0.4, 1));
	assert.equal(SHIELD_DIRS << SHIELD_SHIFT, 8192);
	// v18: pairs get softer enemy hits; v23: three players too; solo and 4+ stay at ×1.
	for (const m of ['lunch', 'night']) {
		assert.ok(modeDmgMul(m, 2) < 1 && modeDmgMul(m, 3) < 1, `${m}: pairs and three players`);
		assert.ok(modeDmgMul(m, 1) === 1 && modeDmgMul(m, 4) === 1 && modeDmgMul(m, 8) === 1, `${m}: solo and 4+ untouched`);
	}
	console.log('content: OK');
}

// --- Трубач: keeps 350–450 px, backs off, lane telegraph then a fan of slow orbs ---
{
	const r = room(), h = hero(r);
	const e = foe(r, 'sniper', 250, 0);
	e.shotT = 99;
	run(r, 1.5);
	assert.ok(Math.hypot(e.x - h.x, e.y - h.y) > 300, `backs off when approached (${Math.round(e.x)})`);
	const far = foe(r, 'sniper', 900, 0);
	far.shotT = 99;
	run(r, 2);
	assert.ok(Math.hypot(far.x, far.y) < 800, 'walks in from afar');
	e.dead = far.dead = true;
	r.compactEnemies();
	console.log('sniper keeps range: OK');
}
{
	const r = room(), h = hero(r);
	const e = foe(r, 'sniper', 400, 0);
	e.shotT = 0;
	r.fx.length = 0;
	run(r, 0.1);
	const lane = fxOf(r, 'bline');
	assert.equal(lane.length, ENEMIES.sniper.fan, 'a lane per orb of the fan (v19)');
	assert.ok(lane[0][6] >= 0.6, 'telegraph ≥ 0.6 s');
	const mid = Math.atan2(lane[2][4] - lane[2][2], lane[2][3] - lane[2][1]);
	const ang = lane.map((l) => { let a = Math.atan2(l[4] - l[2], l[3] - l[1]) - mid; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; });
	assert.ok(Math.abs(Math.max(...ang) - Math.min(...ang) - ENEMIES.sniper.spread * (ENEMIES.sniper.fan - 1)) < 0.02, 'lanes span the fan');
	assert.equal(fxOf(r, 'eorb').length, 0, 'no orb during the windup');
	assert.ok(r.enemyState(e) & ST.windup, 'windup bit while aiming');
	run(r, ENEMIES.sniper.windup);
	const orbs = fxOf(r, 'eorb');
	assert.equal(orbs.length, ENEMIES.sniper.fan, 'a fan of orbs after the windup');
	assert.equal(orbs[0].length, 9);
	assert.ok(r.hostile.every((s) => s.r === ENEMIES.sniper.shotR && Math.hypot(s.vx, s.vy) < 200), 'slow and big');
	// Standing still: the middle orb hits.
	const hp0 = h.hp;
	run(r, 3);
	assert.ok(h.hp < hp0, 'a standing player is hit');
	assert.ok(r.runLog.p.get(1).taken['sniper:shot'] > 0, 'logged as sniper:shot');
	console.log('sniper telegraph + orbs: OK');
}
{
	// Sidestepping after the telegraph dodges the whole fan.
	const r = room(), h = hero(r);
	const e = foe(r, 'sniper', 400, 0);
	e.shotT = 0;
	run(r, ENEMIES.sniper.windup + 0.1);
	const hp0 = h.hp;
	run(r, 3, () => { h.y += 170 * dt; h.x -= 60 * dt; });
	assert.equal(h.hp, hp0, 'dodged by moving out of the lane');
	console.log('sniper dodgeable: OK');
}
{
	// Lead: a player running straight is aimed ahead of.
	const r = room(), h = hero(r);
	const e = foe(r, 'sniper', 400, 0);
	e.shotT = 0;
	h.mvx = 0;
	h.mvy = 1;
	h.movedT = r.time;
	run(r, 0.05);
	assert.ok(e.bvy > 0.2, `aims ahead (${e.bvy.toFixed(2)})`);
	console.log('sniper lead: OK');
}

// --- Щитоносец: ×0.2 from the front, full damage from the side and back, slow turn, bash ---
{
	const r = room(), h = hero(r);
	const e = foe(r, 'shield', 200, 0, 100);
	e.fa = Math.PI; // faces the hero at (0, 0)
	const hp = e.hp;
	r.hurtEnemy(e, 100, h, SRC);
	assert.ok(Math.abs(hp - e.hp - 100 * ENEMIES.shield.front) < 1e-6, `front ×${ENEMIES.shield.front}`);
	e.fa = 0; // back to the hero
	const hp2 = e.hp;
	r.hurtEnemy(e, 100, h, SRC);
	assert.ok(Math.abs(hp2 - e.hp - 100) < 1e-6, 'back ×1');
	e.fa = Math.PI / 2; // side
	const hp3 = e.hp;
	r.hurtEnemy(e, 100, h, SRC);
	assert.ok(Math.abs(hp3 - e.hp - 100) < 1e-6, 'side ×1');
	assert.ok(r.runLog.specials.shield.blocked >= 79, 'blocked damage logged');
	// Burn ignores the shield.
	e.fa = Math.PI;
	e.burnT = r.time + 3;
	e.burnDps = 10;
	e.burnOwner = h;
	e.burnAcc = 0.5;
	const hp4 = e.hp;
	r.burnTick(e, 0);
	assert.ok(Math.abs(hp4 - e.hp - 5) < 1e-6, 'burn passes the shield');
	console.log('shield front/back: OK');
}
{
	const r = room(), h = hero(r);
	const e = foe(r, 'shield', 400, 0);
	e.fa = 0; // looks away
	run(r, 1);
	assert.ok(Math.abs(e.fa) <= ENEMIES.shield.turn * 1.05 && Math.abs(e.fa) > 0.5, `turns slowly (${e.fa.toFixed(2)})`);
	// Facing in the snapshot bits.
	e.fa = Math.PI / 2;
	const st = r.enemyState(e);
	assert.ok(st & ST.shield);
	assert.equal((st >> SHIELD_SHIFT) & (SHIELD_DIRS - 1), SHIELD_DIRS / 4);
	// Bash: lane telegraph up close, then the dash.
	e.x = 150;
	e.y = 0;
	e.fa = Math.PI;
	e.dcd = 0;
	r.fx.length = 0;
	run(r, 0.1);
	assert.equal(fxOf(r, 'bline').length, 1, 'bash telegraph');
	assert.equal(e.bs, 'aim');
	const x0 = e.x;
	run(r, ENEMIES.shield.dashWarn + 0.2);
	assert.ok(x0 - e.x > 60, 'dashes after the telegraph');
	assert.ok(h.x === 0 && h.y === 0);
	console.log('shield turn + bash: OK');
}

// --- specials spawn from the middle, by fractions of the run length, capped ---
for (const mode of ['night', 'lunch']) {
	const r = room(['knight'], mode);
	r.time = r.runLength * 0.3;
	r.spawnSpecials(alive(r));
	assert.equal(r.enemies.length, 0, `${mode}: none before ${SPECIALS.sniper.from}`);
	r.time = r.runLength * 0.5;
	for (let i = 0; i < 40; i++) {
		r.time += 30;
		r.spawnSpecials(alive(r));
	}
	const n = (id) => r.enemies.filter((e) => e.def === ENEMIES[id]).length;
	assert.ok(n('sniper') >= 1 && n('sniper') <= SPECIALS.sniper.lateMax[0], `${mode}: snipers capped (${n('sniper')})`);
	assert.ok(n('shield') >= 1 && n('shield') <= SPECIALS.shield.lateMax[0], `${mode}: shields capped`);
	assert.equal(r.runLog.specials.sniper.spawned, n('sniper'));
	assert.ok(r.makeElite(alive(r)) === null, 'specials never become elites');
}
console.log('specials schedule: OK');
{
	// v18.1: a small chest is shared — every hero gets an offer (a downed one too), the opener also the boost.
	const r = room(['knight', 'witch', 'alchemist']);
	const [a, b, c] = [hero(r, 1), hero(r, 2), hero(r, 3)];
	for (const h of [a, b, c]) {
		h.offer = null;
		h.queue = 0;
		h.boostQueue = 0;
		h.floors = [];
	}
	c.st = 1;
	r.dropItem('chest', a.x, a.y);
	r.updateItems(dt, alive(r));
	assert.ok(a.offer && b.offer, 'both standing players get an offer');
	assert.ok(c.offer, 'a downed player gets one too');
	assert.ok([a, b, c].every((h) => h.offer.some((x) => (x.rar ?? -1) >= 1)), 'chest floor for all');
	assert.ok(a.offerBoost && !b.offerBoost && !c.offerBoost, 'only the opener gets the boost');
	// Boss chest: a downed pair member gets the offer as well.
	const rb = room(['knight', 'witch']);
	const [p, q] = [hero(rb, 1), hero(rb, 2)];
	p.offer = q.offer = null;
	q.st = 1;
	const boss = foe(rb, 'ram', 300, 0);
	rb.bosses.push(boss);
	boss.group = boss.id;
	rb.hurtEnemy(boss, boss.hp + 1, p, SRC);
	assert.ok(p.offer && q.offer, 'boss chest: the downed one gets an offer');
	assert.ok(q.offer.some((x) => (x.rar ?? -1) >= 2), 'boss chest: epic floor for the downed one');
	console.log('shared chest: OK');
}
{
	const r = room(['knight', 'witch'], 'lunch'), r1 = room(['knight'], 'lunch');
	const e = foe(r, 'skel', 300, 0), e1 = foe(r1, 'skel', 300, 0);
	assert.ok(Math.abs(e.dmg / e1.dmg - modeDmgMul('lunch', 2)) < 1e-9, 'lunch pair enemy damage softened');
	console.log('lunch pair damage: OK');
}

// --- events ---
function evRoom(id, heroes = ['knight']) {
	const r = room(heroes);
	r.time = 200;
	r.events.force = id;
	r.events.next = 0;
	r.fx.length = 0;
	r.events.tick(alive(r));
	assert.equal(r.events.active?.id, id, `${id} started`);
	assert.deepEqual(fxOf(r, 'evt')[0].slice(0, 2), ['evt', EVENT_INDEX[id]], `${id} banner fx`);
	return r;
}
const evTick = (r, sec, each) => {
	for (let i = 0; i < sec * TICK_HZ; i++) {
		r.time += dt;
		each?.();
		r.events.tick(alive(r));
		r.updateItems(dt, alive(r));
		r.compactEnemies();
	}
};
const ends = (r) => r.runLog.events;

{
	// Падающая звезда: a warn circle, then a blast at the spot and a shard everyone shares.
	const r = evRoom('star', ['knight', 'witch']);
	const ev = r.events.active, [a, b] = [hero(r, 1), hero(r, 2)];
	assert.ok(fxOf(r, 'warn').some((w) => w[3] === EVENTS[0].r && w[4] >= 3), 'warn circle ≥ 3 s');
	const inside = foe(r, 'skel', ev.x, ev.y, 10);
	const boss = foe(r, 'brute', ev.x + 20, ev.y, 10);
	boss.boss = true;
	a.x = b.x = ev.x + 400;
	a.y = b.y = ev.y;
	evTick(r, EVENTS[0].warn + 0.1);
	assert.ok(inside.dead, 'regular enemy in the circle dies');
	assert.ok(!boss.dead && boss.hp < boss.maxHp, 'a boss takes a share');
	const shard = r.items.find((it) => ITEM_TYPES[it.type] === 'star');
	assert.ok(shard, 'shard on the spot');
	const xa = a.xp + a.level * 1000, xb = b.xp + b.level * 1000;
	b.st = 1;
	const hpB = b.hp;
	a.x = shard.x;
	a.y = shard.y;
	evTick(r, 0.2);
	assert.ok(a.xp + a.level * 1000 > xa && b.xp + b.level * 1000 > xb, 'shard: both players get xp, the downed one too');
	assert.equal(b.hp, hpB, 'shard: no heal while downed');
	assert.equal(r.events.active, null);
	assert.equal(ends(r)[0].res, 1);
	// Standing in the circle hurts.
	const r2 = evRoom('star');
	const h2 = hero(r2);
	h2.x = r2.events.active.x;
	h2.y = r2.events.active.y;
	const hp = h2.hp;
	evTick(r2, EVENTS[0].warn + 0.1);
	assert.ok(h2.hp < hp && r2.runLog.p.get(1).taken['event:star'] > 0, 'the star hurts players in the circle');
	console.log('event star: OK');
}
{
	// Золотая тень: runs away, a kill drops a chest; otherwise it escapes.
	const r = evRoom('gold');
	const e = r.events.active.shade, h = hero(r);
	assert.equal(e.def, ENEMIES.goldshade);
	const d0 = Math.hypot(e.x - h.x, e.y - h.y);
	run(r, 1);
	assert.ok(Math.hypot(e.x - h.x, e.y - h.y) > d0, 'flees');
	r.hurtEnemy(e, e.hp + 1, null, SRC);
	assert.ok(!e.dead, 'only players can catch it');
	r.hurtEnemy(e, e.hp + 1, h, SRC);
	evTick(r, 0.1);
	assert.ok(r.items.some((it) => ITEM_TYPES[it.type] === 'chest'), 'chest for the kill');
	assert.equal(ends(r)[0].res, 1);
	// v18.1: slower than every hero, no escape by distance during the grace time, then only past `escape` px.
	const G = ENEMIES.goldshade;
	assert.ok(Object.values(HEROES).every((H) => H.speed > G.speed), 'slower than the slowest hero');
	const rg = evRoom('gold');
	const sh = rg.events.active.shade, hg = hero(rg);
	hg.x = sh.x + 1300;
	hg.y = sh.y;
	evTick(rg, 3);
	assert.equal(rg.events.active?.id, 'gold', 'no early escape at 3 s even 1300 px away');
	hg.x = sh.x + G.escape + 200;
	evTick(rg, G.grace - 3 - 0.5);
	assert.equal(rg.events.active?.id, 'gold', 'no escape before the grace time ends');
	hg.x = sh.x + G.escape - 300;
	evTick(rg, 1);
	assert.equal(rg.events.active?.id, 'gold', 'inside the escape radius it stays');
	hg.x = sh.x + G.escape + 200;
	evTick(rg, 0.2);
	assert.equal(ends(rg)[0].res, 0, 'escapes past the radius after the grace time');
	assert.ok(ends(rg)[0].end - ends(rg)[0].at >= G.grace);
	// It loops instead of running straight: over 6 s it stays within reach of a standing hero.
	const rl = evRoom('gold');
	const hl = hero(rl), sl = rl.events.active.shade;
	let maxD = 0;
	run(rl, 6, () => { maxD = Math.max(maxD, Math.hypot(sl.x - hl.x, sl.y - hl.y)); });
	assert.ok(maxD < G.far + 150, `loops near the hero (max ${Math.round(maxD)} px)`);
	const r2 = evRoom('gold');
	evTick(r2, ENEMIES.goldshade.life + 0.5);
	assert.equal(ends(r2)[0].res, 0, 'escaped');
	assert.ok(!r2.enemies.includes(r2.events.cur?.shade));
	console.log('event gold: OK');
}
{
	// Красный туман: faster, harder-hitting enemies inside, double xp for kills inside.
	const r = evRoom('fog');
	const ev = r.events.active, h = hero(r);
	const inside = foe(r, 'ghoul', ev.x + 100, ev.y), out = foe(r, 'ghoul', ev.x + ev.r + 300, ev.y);
	assert.ok(r.events.inFog(inside) && !r.events.inFog(out));
	const g0 = r.gems.length;
	r.hurtEnemy(inside, inside.hp + 1, h, SRC);
	r.hurtEnemy(out, out.hp + 1, h, SRC);
	const [gi, go] = r.gems.slice(g0);
	assert.ok(Math.abs(gi.xp / go.xp - EVENTS[2].xpMul) < 0.01 || gi.gold || go.gold, 'double xp in the fog');
	const c = foe(r, 'ghoul', h.x + 20, h.y);
	h.iframes = 0;
	const hp = h.hp;
	r.rebuildGrid();
	r.updatePlayers(dt, alive(r));
	assert.ok(Math.abs(hp - h.hp - (c.dmg * EVENTS[2].dmgMul - h.mods.armor)) < 1e-6, 'contact ×1.3 in the fog');
	evTick(r, EVENTS[2].dur + 0.1);
	assert.equal(r.events.active, null);
	console.log('event fog: OK');
}
{
	// Алтарь: stepping on it takes the deal once, per player; walking past costs nothing.
	const r = evRoom('altar', ['knight', 'witch']);
	const ev = r.events.active, [a, b] = [hero(r, 1), hero(r, 2)];
	ev.a = 0; // Кровь за силу
	a.x = b.x = ev.x + 300;
	a.y = b.y = ev.y;
	const hpB = b.hp;
	a.x = ev.x;
	a.y = ev.y;
	const hpA = a.hp;
	evTick(r, 0.1);
	assert.ok(Math.abs(a.hp - hpA * (1 - ALTAR_DEALS[0].hpCost)) < 1e-6, 'cost paid');
	assert.ok(a.altarDmgT > r.time && b.altarDmgT === 0 && b.hp === hpB, 'only the one who stepped in');
	const e = foe(r, 'brute', 0, 0, 100);
	const before = e.hp;
	r.hurtEnemy(e, 100, a, SRC);
	assert.ok(Math.abs(before - e.hp - 100 * ALTAR_DEALS[0].dmgMul) < 1e-6, 'damage boon');
	evTick(r, 0.5);
	assert.ok(Math.abs(a.hp - hpA * (1 - ALTAR_DEALS[0].hpCost)) < 1e-6, 'paid once');
	evTick(r, EVENTS[3].life);
	assert.equal(ends(r)[0].res, 1);
	assert.deepEqual(ends(r)[0].took, ['P1']);
	// Greed: more damage taken, more xp.
	const r2 = evRoom('altar');
	const h = hero(r2), ev2 = r2.events.active;
	ev2.a = 1;
	h.x = ev2.x;
	h.y = ev2.y;
	evTick(r2, 0.1);
	const hp = h.hp;
	h.iframes = 0;
	r2.hurtPlayer(h, 10, 'test');
	assert.ok(Math.abs(hp - h.hp - (10 * ALTAR_DEALS[1].takenMul - h.mods.armor)) < 1e-6, 'greed: more damage taken');
	const xp0 = h.xp + h.level * 1e6;
	r2.collectGem(h, 1);
	assert.ok(h.xp + h.level * 1e6 - xp0 > 1.5 * r2.xpMul, 'greed: more xp');
	// Refusal: nobody steps in, nothing changes.
	const r3 = evRoom('altar');
	const h3 = hero(r3), hp3 = h3.hp;
	h3.x = r3.events.active.x + 500;
	evTick(r3, EVENTS[3].life + 0.1);
	assert.equal(ends(r3)[0].res, 0);
	assert.ok(h3.hp === hp3 && h3.altarDmgT === 0 && h3.altarCurseT === 0);
	console.log('event altar: OK');
}
{
	// Проклятый сундук: opening calls a wave; surviving it gives every alive player an offer of epic+ rarity.
	const r = evRoom('cursed', ['knight', 'witch']);
	const ev = r.events.active, [a, b] = [hero(r, 1), hero(r, 2)];
	a.x = ev.x;
	a.y = ev.y;
	b.x = ev.x + 50;
	b.y = ev.y;
	evTick(r, 0.1);
	assert.equal(ev.phase, 1);
	assert.ok(r.enemies.length >= EVENTS[4].base && r.enemies.some((e) => e.elite), 'a wave with an elite');
	r.enemies.length = 0;
	a.offer = b.offer = null;
	evTick(r, EVENTS[4].hold);
	assert.equal(ends(r)[0].res, 1);
	for (const h of [a, b]) {
		assert.ok(h.offer, 'an offer for each');
		const best = Math.max(...h.offer.map((c) => c.rar ?? -1));
		assert.ok(best >= 2, `epic or better (${best})`);
	}
	// A player who went down during the wave gets nothing.
	const r2 = evRoom('cursed', ['knight', 'witch']);
	const ev2 = r2.events.active, [c, d] = [hero(r2, 1), hero(r2, 2)];
	c.x = ev2.x;
	c.y = ev2.y;
	evTick(r2, 0.1);
	r2.enemies.length = 0;
	d.iframes = 0;
	r2.hurtPlayer(d, 1e6, 'test');
	d.st = 0;
	d.hp = 50;
	c.offer = d.offer = null;
	evTick(r2, EVENTS[4].hold);
	assert.ok(c.offer && !d.offer, 'downed player is left out');
	// Nobody opens it: it fades.
	const r3 = evRoom('cursed');
	hero(r3).x = r3.events.active.x + 600;
	evTick(r3, EVENTS[4].life + 0.1);
	assert.equal(ends(r3)[0].res, 0);
	console.log('event cursed: OK');
}
{
	// Серия убийств: goal from the recent kill pace; success gives everyone +30% damage and pulls the gems.
	const r = room(['knight', 'witch']);
	r.time = 200;
	r.events.next = Infinity;
	for (let i = 0; i < 60; i++) {
		r.time += 1;
		r.kills += 3;
		r.events.tick(alive(r));
	}
	r.events.force = 'streak';
	r.events.next = 0;
	r.events.tick(alive(r));
	const ev = r.events.active;
	assert.equal(ev.id, 'streak');
	assert.equal(ev.b, Math.round(3 * EVENTS[5].dur * EVENTS[5].pace), 'goal from the pace');
	r.gems.push({ id: 1, x: 900, y: 900, xp: 1, gold: false, pull: null });
	r.kills += ev.b;
	evTick(r, 0.05);
	assert.equal(ends(r)[0].res, 1);
	for (const h of alive(r)) assert.ok(h.streakT > r.time);
	assert.ok(r.gems[0].pull, 'gems pulled');
	const e = foe(r, 'brute', 0, 0, 100), h = hero(r);
	const hp = e.hp;
	r.hurtEnemy(e, 100, h, SRC);
	assert.ok(Math.abs(hp - e.hp - 100 * EVENTS[5].bonus.mul) < 1e-6, 'streak damage bonus');
	const r2 = evRoom('streak');
	evTick(r2, EVENTS[5].dur + 0.1);
	assert.equal(ends(r2)[0].res, 0, 'failed when short');
	console.log('event streak: OK');
}
{
	// Schedule: none before `from`, one at a time, gaps ≥ 90 s, never inside a peak; snapshots carry `ev`.
	for (const [mode, players] of [['night', 1], ['lunch', 3]]) {
		const r = room(Array.from({ length: players }, () => 'knight'), mode);
		r.time = 0;
		const starts = [];
		for (let t = 0; t < r.runLength; t += 0.5) {
			r.time = t;
			const was = r.events.active;
			r.events.tick(alive(r));
			const now = r.events.active;
			if (now && now !== was) starts.push(t);
			if (now) {
				// Finish every event quickly so the gap rule is what spaces them.
				if (r.time - now.at > 5) r.events.finish(0);
			}
		}
		assert.ok(starts.length >= 3, `${mode}: ${starts.length} events`);
		assert.ok(starts[0] >= r.runLength * EVENT_RULES.from - 0.01, 'not before from');
		for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= EVENT_RULES.gap[0], 'gap ≥ 90 s');
		const peaks = peakSchedule(r.runLength, bossTimes(r.runLength));
		for (const t of starts) assert.ok(!peaks.some((p) => t >= p.at - 4 && t < p.at + p.dur), `${mode}: not in a peak (${t})`);
	}
	const r = evRoom('fog');
	const msg = r.snapshot();
	assert.equal(msg.ev.length, 8);
	assert.equal(msg.ev[0], EVENT_INDEX.fog);
	const dec = new SnapshotDecoder();
	const out = r.snapCodec.encode(msg);
	assert.deepEqual(dec.decode(JSON.parse(JSON.stringify(out.key()))).ev, msg.ev, 'ev survives the codec');
	console.log('event schedule + snapshot: OK');
}
{
	// Run log: events and specials in the JSON and the summary.
	const r = evRoom('streak');
	evTick(r, EVENTS[5].dur + 0.1);
	foe(r, 'sniper', 500, 0);
	r.runLog.special(r, r.enemies[0], 'spawned');
	r.finish(false);
	const log = r.lastLog;
	assert.equal(log.events[0].id, 'streak');
	assert.ok(log.specials.sniper.spawned === 1 && 'dmgToPlayers' in log.specials.shield);
	assert.ok(log.summary.some((s) => s.startsWith('События: Серия убийств')), 'summary: events');
	assert.ok(log.summary.some((s) => s.startsWith('Новые враги: Трубач')), 'summary: specials');
	assert.ok(summarize(log).length > 3);
	assert.ok(RARITIES.length === 4 && xpForNext(1) > 0);
	console.log('run log: OK');
}
console.log('wave4-test: OK');
