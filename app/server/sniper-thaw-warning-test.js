import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Room } from './game.js';
import { packFx } from './snapshot-codec.js';
import { unpackFx } from '../public/js/snapshot-codec.js';
import { ENEMIES, enemyHpScale } from '../public/shared/content.js';

// Issue #23: a Трубач volley always flies along the five lanes on the player's screen, shown for the whole windup, and
// no other lanes of that sniper are on screen meanwhile — through freezes, roots, knocks and a steady pull.
// The server's fx go through the wire codec into the real client Game, which keeps what the player sees.
const file = new URL('../public/js/game.js', import.meta.url);
const source = fs.readFileSync(file, 'utf8').replace("'/shared/content.js'", JSON.stringify(new URL('../public/shared/content.js', import.meta.url).href));
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const dt = 1 / 30, W = ENEMIES.sniper.windup, FAN = ENEMIES.sniper.fan, eps = 1e-6;
function arena(kind, mode) {
	const r = new Room('THAW', () => {}); r.setMode(mode); r.addPlayer(1, 'One', 'knight'); r.start();
	r.enemies.length = 0; r.time = r.runLength * 2 / 3;
	const h = r.heroes.get(1); h.weapons.clear(); h.perk.readyAt = Infinity; h.hp = h.maxHp = 1e9;
	let e, center = { x: h.x, y: h.y };
	if (kind === 'guard') {
		r.updateOutposts([h]); center = r.outposts.posts[0]; h.x = center.x; h.y = center.y; r.updateOutposts([h]);
		e = r.enemies.find(e => e.outpost === center && e.ai === 'sniper'); assert.ok(e);
		for (const other of r.enemies) if (other !== e) r.killEnemy(other, h);
		r.compactEnemies(); r.time = Math.max(r.time, e.guardReadyAt ?? 0);
		e.x = center.x + 210; e.y = center.y;
	} else {
		e = r.spawnEnemy('sniper', [h], enemyHpScale(r.nt, 1));
		e.x = h.x + 500; e.y = h.y;
	}
	e.shotT = 0; e.windT = 0; e.hp = e.maxHp = 1e9;
	r.fx.length = 0;
	const g = new Game({ send() {} }); g.me = 1;
	g.begin({ players: [{ pid: 1, hero: 'knight', name: 'One', x: h.x, y: h.y }] });
	return { r, h, e, g, fan: null, volleys: [] };
}

// One server tick, delivered to the client; checks the picture against every volley.
function tick(f, step) {
	const { r, h, e, g } = f;
	r.time += dt; r.fx.length = 0;
	step();
	const tm = Math.round(r.time * 1000), packed = packFx(r.fx, tm);
	const fx = unpackFx(packed.f, packed.fv, packed.fn, tm);
	for (const ev of fx) g.effect(ev);
	const seen = g.blines; // the arena holds this one sniper
	assert.ok(seen.length === 0 || seen.length === FAN, `${f.label}: one fan on screen, not ${seen.length} lanes`);
	if (fx.some(ev => ev[0] === 'bline')) f.fan = { at: r.time, lanes: seen.map(l => ({ ...l })) };
	const orbs = fx.filter(ev => ev[0] === 'eorb');
	if (orbs.length) {
		const fan = f.fan;
		assert.ok(fan, `${f.label}: a volley never comes without lanes`);
		const age = r.time - fan.at;
		assert.ok(age >= W - dt / 2 - eps, `${f.label}: volley ${age.toFixed(3)} s after its lanes, expected ≥ ${W}`);
		assert.ok(seen.length === FAN || age >= W - eps, `${f.label}: the lanes are on screen until the volley`);
		assert.ok(age <= W + dt + eps, `${f.label}: the lanes were still on screen a moment ago`);
		assert.equal(orbs.length, FAN);
		for (const [i, o] of orbs.entries()) {
			const s = r.hostile.find(s => s.id === o[1]), lane = fan.lanes[i];
			assert.equal(lane.x1, Math.round(s.x)); assert.equal(lane.y1, Math.round(s.y));
			const endX = s.x + s.vx * s.life, endY = s.y + s.vy * s.life;
			assert.ok(Math.abs(lane.x2 - endX) <= 1 && Math.abs(lane.y2 - endY) <= 1, `${f.label}: orb ${i} flies along its lane`);
		}
		f.fan = null;
		f.volleys.push(r.time);
		r.hostile.length = 0;
	}
	g.updateEffects(dt);
}

const lockOf = (r, e, ctrl, dur) => ctrl === 'freeze' ? assert.ok(r.freeze(e, dur)) : (e.rootT = r.time + dur);
const scenarios = [];
for (const ctrl of ['freeze', 'root']) scenarios.push({ ctrl, dur: 1.5, at: 0.3 });
for (const at of [0.1, 0.4, 0.7]) scenarios.push({ ctrl: 'freeze', dur: 0.25, at, strafe: true });
scenarios.push({ ctrl: 'none', at: 0.3 });

for (const mode of ['lunch', 'night']) for (const kind of ['guard', 'ordinary']) for (const sc of scenarios) for (const shove of ['', 'knock', 'pull']) {
	const f = arena(kind, mode), { r, h, e } = f;
	f.label = `${mode} ${kind} ${sc.ctrl}${sc.dur ? ' ' + sc.dur + ' s' : ''} at ${sc.at} s${sc.strafe ? ' while the hero strafes' : ''}${shove ? ' + ' + shove : ''}`;
	const move = () => r.moveEnemies(dt, [h]);
	tick(f, move);
	assert.ok(e.windT > 0 && f.fan, `${f.label}: windup started`);
	for (let t = dt; t < sc.at - eps; t += dt) tick(f, move);
	if (sc.ctrl !== 'none') lockOf(r, e, sc.ctrl, sc.dur);
	if (shove === 'knock') r.knock(e, h.x, h.y, 30);
	const lockEnd = r.time + (sc.dur ?? 0);
	for (let t = 0; t < (sc.dur ?? 0) + 1 + 2 * W; t += dt) tick(f, () => {
		if (sc.strafe && r.time < lockEnd + W) h.y += 200 * dt;
		if (shove === 'pull' && t < 1) e.x -= 3;
		move();
	});
	assert.ok(f.volleys.length >= 1, `${f.label}: the sniper fires after all`);
	if (sc.dur >= W) assert.ok(f.volleys[0] >= lockEnd + W - dt / 2 - eps, `${f.label}: a full windup after the thaw`);
	console.log(`${f.label}: ${f.volleys.length} volley(s), each along the only fan on screen after ${W} s: OK`);
}

// The real Смерч pulls a nearby sniper every tick: one fan follows it on screen, none is left behind.
for (const mode of ['lunch', 'night']) {
	const f = arena('ordinary', mode), { r, h, e } = f;
	f.label = `${mode} Смерч I pulling a sniper`;
	h.weapons.set('whirlwind', { lvl: 1, t: 0 });
	e.x = h.x + 118; e.y = h.y;
	let lanesSent = 0;
	for (let t = 0; t < 4; t += dt) tick(f, () => {
		r.moveEnemies(dt, [h]); r.rebuildGrid(); r.updatePlayers(dt, [h]);
		lanesSent += r.fx.filter(ev => ev[0] === 'bline').length;
	});
	assert.ok(lanesSent > FAN, `${f.label}: the pull makes the sniper aim again`);
	console.log(`${f.label}: ${lanesSent / FAN} fans sent, never more than one on screen, ${f.volleys.length} volley(s) along it: OK`);
}

// A dead sniper takes its lanes along.
{
	const f = arena('ordinary', 'night'), { r, h, e, g } = f;
	f.label = 'night sniper killed mid-windup';
	tick(f, () => r.moveEnemies(dt, [h]));
	assert.equal(g.blines.length, FAN);
	tick(f, () => r.killEnemy(e, h));
	assert.equal(g.blines.length, 0, 'the lanes of a killed sniper disappear');
	console.log(`${f.label}: its lanes disappear with it: OK`);
}
