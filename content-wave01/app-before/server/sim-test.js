// Headless simulation test: node server/sim-test.js
import assert from 'node:assert/strict';
import { Hub, Room } from './game.js';
import { TICK_HZ, MAX_ENEMIES, ENEMY_TYPES, PROJECTILE_KINDS, WEAPON_IDS, ENEMIES, REVIVE_SECONDS, HEROES, NO_TRAIT, heroTrait } from '../public/shared/content.js';

const isInt = (v) => Number.isInteger(v);

function checkSnapshot(s) {
	assert.equal(s.t, 's');
	assert.equal(typeof s.tm, 'number');
	assert.ok(isInt(s.k));
	assert.ok(Array.isArray(s.p));
	for (const p of s.p) {
		assert.equal(p.length, 13);
		for (let i = 0; i < 10; i++) assert.ok(isInt(p[i]), `p[${i}] int`);
		assert.ok(p[8] === 0 || p[8] === 1);
		assert.ok(p[9] >= 0 && p[9] <= 100);
		assert.equal(typeof p[10], 'number');
		assert.equal(typeof p[11], 'number');
		for (const [id, lvl] of p[12]) assert.ok(WEAPON_IDS.includes(id) && isInt(lvl));
	}
	const flat = (arr, n) => {
		assert.ok(Array.isArray(arr) && arr.length % n === 0);
		assert.ok(arr.every(isInt), 'flat arrays must be integers');
	};
	flat(s.e, 5);
	flat(s.b, 5);
	flat(s.g, 4);
	flat(s.z, 4);
	for (let i = 0; i < s.e.length; i += 5) {
		assert.ok(s.e[i + 1] >= 0 && s.e[i + 1] < ENEMY_TYPES.length);
		assert.ok(s.e[i + 4] >= 1 && s.e[i + 4] <= 100);
	}
	for (let i = 0; i < s.b.length; i += 5) assert.ok(s.b[i + 1] >= 0 && s.b[i + 1] < PROJECTILE_KINDS.length);
	for (let i = 0; i < s.g.length; i += 4) assert.ok([0, 1, 2].includes(s.g[i + 3]));
	assert.ok(Array.isArray(s.fx));
	const known = ['hit', 'die', 'zap', 'slash', 'hurt', 'down', 'up', 'lvl', 'boss', 'chest', 'shot', 'ptgt', 'pend', 'slowz'];
	const arity = { shot: 10, ptgt: 4, pend: 5 };
	for (const f of s.fx) {
		assert.ok(known.includes(f[0]), `fx ${f[0]}`);
		if (arity[f[0]]) assert.equal(f.length, arity[f[0]], `fx ${f[0]} arity`);
		if (f[0] === 'shot') assert.ok(f[2] >= 0 && f[2] < PROJECTILE_KINDS.length && f[7] > 0 && f[9] <= s.tm + 0.01); // tm has 2 decimals, event times 3
		if (f[0] === 'pend') assert.ok(f[4] <= s.tm + 0.01);
	}
	assert.ok(s.boss === null || (Array.isArray(s.boss) && s.boss.length === 2));
}

function makeHub(onMsg) {
	const hub = new Hub((pid, msg, json) => {
		if (json) msg = JSON.parse(json);
		onMsg(pid, msg, json);
		if (msg.t === 'lvl') hub.handle(pid, { t: 'pick', i: 0 });
	});
	return hub;
}

// --- main run: 3 players in circles for 6 minutes ---
const stats = { snaps: 0, bytes: 0, maxBytes: 0, lvl: 0, over: null, errs: [], maxEnemies: 0, bossSeen: false, chests: 0 };
const hub = makeHub((pid, msg, json) => {
	if (msg.t === 's') {
		if (pid !== 1) return;
		checkSnapshot(msg);
		const size = (json ?? JSON.stringify(msg)).length;
		stats.snaps++;
		stats.bytes += size;
		stats.maxBytes = Math.max(stats.maxBytes, size);
		for (const f of msg.fx) {
			if (f[0] === 'boss') stats.bossSeen = true;
			if (f[0] === 'chest') stats.chests++;
		}
	} else if (msg.t === 'lvl') stats.lvl++;
	else if (msg.t === 'over') stats.over = msg;
	else if (msg.t === 'err') stats.errs.push(msg.msg);
});

const heroes = ['knight', 'witch', 'ranger'];
for (let pid = 1; pid <= 3; pid++) hub.addPlayer(pid, `Бот ${pid}`);
hub.handle(1, { t: 'create', hero: 'knight' });
const room = [...hub.rooms.values()][0];
hub.handle(2, { t: 'join', code: room.code.toLowerCase(), hero: 'witch' });
hub.handle(3, { t: 'join', code: room.code, hero: 'ranger' });
hub.handle(2, { t: 'start' }); // not host: err
assert.equal(room.state, 'lobby');
hub.handle(1, { t: 'start' });
assert.equal(room.state, 'play');
assert.equal(room.heroes.size, 3);
hub.handle(3, { t: 'pos', x: NaN, y: 'x', fx: Infinity, fy: 0 }); // garbage must be ignored
hub.handle(3, { t: 'pos', x: 99999, y: 99999, fx: 1, fy: 0 }); // teleport must be clamped
assert.ok(Math.hypot(room.heroes.get(3).x, room.heroes.get(3).y) < 200);

const dt = 1 / TICK_HZ;
const SIM_SECONDS = 360;
let tickMs = 0, ticks = 0, worstMs = 0;
for (let i = 0; i < SIM_SECONDS * TICK_HZ && room.state === 'play'; i++) {
	const t = i * dt;
	for (let pid = 1; pid <= 3; pid++) {
		const h = room.heroes.get(pid);
		if (!h) continue;
		// Keep the bots alive so the run reaches 6 minutes.
		h.hp = Math.max(h.hp, h.maxHp * 0.6);
		const a = t * 0.5 + pid * 2.1;
		const cx = Math.cos(pid) * 150, cy = Math.sin(pid) * 150;
		hub.handle(pid, { t: 'pos', x: cx + Math.cos(a) * 250, y: cy + Math.sin(a) * 250, fx: -Math.sin(a), fy: Math.cos(a) });
	}
	const t0 = performance.now();
	room.tick(dt);
	const ms = performance.now() - t0;
	tickMs += ms;
	worstMs = Math.max(worstMs, ms);
	ticks++;
	stats.maxEnemies = Math.max(stats.maxEnemies, room.enemies.length);
}

console.log('--- 3 players, %d s simulated ---', Math.round(room.time));
console.log('enemies alive: %d (max %d), kills: %d', room.enemies.length, stats.maxEnemies, room.kills);
for (const h of room.heroes.values()) {
	console.log('  %s [%s] level %d, kills %d, dmg %d, weapons: %s, passives: %s', h.name, h.hero, h.level, h.kills, Math.round(h.dmg),
		[...h.weapons].map(([id, w]) => `${id}:${w.lvl}`).join(' '), [...h.passives].map(([id, l]) => `${id}:${l}`).join(' '));
}
console.log('lvl offers: %d, boss seen: %s, chests: %d, errs: %j', stats.lvl, stats.bossSeen, stats.chests, stats.errs);
console.log('snapshot avg %d B, max %d B over %d snapshots', Math.round(stats.bytes / stats.snaps), stats.maxBytes, stats.snaps);
console.log('tick avg %s ms, worst %s ms', (tickMs / ticks).toFixed(3), worstMs.toFixed(2));
assert.equal(room.state, 'play');
assert.ok(room.time >= SIM_SECONDS - 1);
assert.ok(room.kills > 100);
assert.ok(stats.bossSeen);
assert.deepEqual(stats.errs, ['Начать игру может только хост']);

// --- revive ---
{
	const [a, b] = [room.heroes.get(1), room.heroes.get(2)];
	b.x = a.x + 20;
	b.y = a.y;
	room.hurtPlayer(b, 1e9);
	assert.equal(b.st, 1);
	for (let i = 0; i < (REVIVE_SECONDS + 0.5) * TICK_HZ; i++) {
		a.hp = a.maxHp;
		room.tick(dt);
	}
	assert.equal(b.st, 0, 'revived');
	console.log('revive: ok');

	const lvlBefore = stats.lvl;
	const aliveCount = [...room.heroes.values()].filter((h) => h.st === 0).length;
	const boss = room.bosses[0] ?? room.spawnEnemy('boss', [a], 1);
	if (!room.bosses.includes(boss)) room.bosses.push(boss);
	room.hurtEnemy(boss, 1e9, a);
	for (let i = 0; i < 3; i++) room.tick(dt);
	assert.ok(stats.chests >= 1, 'chest fx');
	assert.ok(stats.lvl >= lvlBefore + aliveCount, 'chest offers');
	console.log('boss chest: ok');
}

// --- game over + again ---
for (const h of room.heroes.values()) room.hurtPlayer(h, 1e9);
room.tick(dt);
assert.equal(room.state, 'over');
assert.equal(stats.over?.win, false);
assert.equal(stats.over.stats.length, 3);
hub.handle(1, { t: 'again' });
assert.equal(room.state, 'lobby');
hub.handle(2, { t: 'leave' });
hub.handle(1, { t: 'leave' });
assert.equal(room.host, 3);
hub.removePlayer(3);
assert.equal(hub.rooms.size, 0);
console.log('over/again/leave: ok');

// --- stress: 8 players, 350 enemies ---
{
	let snapBytes = 0, snaps = 0;
	const r = new Room('TEST', (pid, msg, json) => {
		if (msg.t === 's' && pid === 1) {
			snapBytes += (json ?? JSON.stringify(msg)).length;
			snaps++;
		}
		if (msg.t === 'lvl') r.handle(pid, { t: 'pick', i: 0 });
	});
	for (let pid = 1; pid <= 8; pid++) r.addPlayer(pid, `P${pid}`, Object.keys(HEROES)[pid % Object.keys(HEROES).length]);
	r.start();
	// Give everyone all weapons at max level so every code path is exercised.
	for (const h of r.heroes.values()) for (const id of WEAPON_IDS.slice(0, 6)) h.weapons.set(id, { lvl: 5, t: Math.random() });
	r.time = 400;
	r.bossIdx = 2;
	const alive = [...r.heroes.values()];
	let ms = 0, n = 0, worst = 0;
	for (let i = 0; i < 30 * TICK_HZ; i++) {
		while (r.enemies.length < MAX_ENEMIES) r.spawnEnemy(['skel', 'ghoul', 'bat', 'brute'][r.enemies.length % 4], alive, 50);
		for (const h of r.heroes.values()) {
			h.hp = h.maxHp;
			const a = i * dt * 0.7 + h.pid;
			r.handle(h.pid, { t: 'pos', x: Math.cos(a) * (100 + h.pid * 40), y: Math.sin(a) * (100 + h.pid * 40), fx: -Math.sin(a), fy: Math.cos(a) });
		}
		const t0 = performance.now();
		r.tick(dt);
		const d = performance.now() - t0;
		if (i > 30) {
			ms += d;
			n++;
			worst = Math.max(worst, d);
		}
	}
	console.log('--- stress: 8 players, %d enemies ---', r.enemies.length);
	console.log('tick avg %s ms, worst %s ms; snapshot avg %d B', (ms / n).toFixed(3), worst.toFixed(2), Math.round(snapBytes / snaps));
	assert.ok(ms / n < 3, 'tick under 3 ms');
}

// --- hero traits ---
{
	const dtt = 1 / TICK_HZ;
	const traitRoom = (ids) => {
		const r = new Room('TRAIT', () => {});
		ids.forEach((hero, i) => r.addPlayer(i + 1, `T${i + 1}`, hero));
		r.start();
		r.spawn = () => {}; // no random enemies
		return r;
	};
	const placeEnemy = (r, type, x, y) => {
		const e = r.spawnEnemy(type, [...r.heroes.values()], 1000);
		e.x = x;
		e.y = y;
		e.speed = ENEMIES[type].speed;
		return e;
	};
	for (const id of ['knight', 'witch', 'ranger']) assert.deepEqual(heroTrait(id), { ...NO_TRAIT }, `${id} has no trait`);
	for (const [id, h] of Object.entries(HEROES)) assert.ok(!h.trait || typeof h.traitDesc === 'string', `${id} traitDesc`);

	// Herald: allies inside his aura heal 1 hp/s, himself and allies outside do not.
	{
		const r = traitRoom(['herald', 'knight', 'witch']);
		const [hr, kn, wi] = [1, 2, 3].map((pid) => r.heroes.get(pid));
		hr.x = 0; hr.y = 0;
		kn.x = 30; kn.y = 0;
		wi.x = 500; wi.y = 0;
		hr.hp = kn.hp = wi.hp = 50;
		for (let i = 0; i < 2 * TICK_HZ; i++) r.tick(dtt);
		assert.ok(Math.abs(kn.hp - 52) < 0.05, `herald heals ally: ${kn.hp}`);
		assert.equal(wi.hp, 50, 'ally outside aura is not healed');
		assert.equal(hr.hp, 50, 'herald does not heal himself');
		hr.weapons.get('aura').lvl = 5;
		hr.mods.areaMul = 1.5;
		kn.x = 160; kn.hp = 50; // 115 * 1.5 = 172.5 > 160
		for (let i = 0; i < TICK_HZ; i++) r.tick(dtt);
		assert.ok(kn.hp > 50.9, 'heal radius follows aura level and areaMul');
		r.hurtPlayer(hr, 1e9);
		kn.hp = 50;
		for (let i = 0; i < TICK_HZ; i++) r.tick(dtt);
		assert.equal(kn.hp, 50, 'downed herald does not heal');
		console.log('trait herald heal: ok');
	}

	// Smith: takes 20% less damage and pulls enemies within 250 to himself.
	{
		const r = traitRoom(['smith', 'witch']);
		const [sm, wi] = [r.heroes.get(1), r.heroes.get(2)];
		const hp0 = sm.hp;
		r.hurtPlayer(sm, 10);
		assert.ok(Math.abs(hp0 - sm.hp - 8) < 1e-9, 'smith takes 80% damage');
		const hpW = wi.hp;
		r.hurtPlayer(wi, 10);
		assert.equal(hpW - wi.hp, 10, 'others take full damage');
		const stepOf = (smithY) => {
			r.enemies = [];
			wi.x = 0; wi.y = 0;
			sm.x = 0; sm.y = smithY;
			const e = placeEnemy(r, 'ghoul', 150, 50);
			r.moveEnemies(dtt, [sm, wi]);
			return e.y - 50;
		};
		assert.ok(stepOf(200) > 0, 'enemy within 250 goes to the smith');
		assert.ok(stepOf(400) < 0, 'enemy farther than 250 goes to the nearest player');
		sm.st = 1;
		r.enemies = [];
		sm.y = 200;
		const e = placeEnemy(r, 'ghoul', 150, 50);
		r.moveEnemies(dtt, [wi]);
		assert.ok(e.y < 50, 'downed smith does not taunt');
		console.log('trait smith armor + taunt: ok');
	}

	// Stormcaller: one more chain jump than the same lightning level of another hero.
	{
		const zapsFor = (hero) => {
			const r = traitRoom([hero]);
			const h = r.heroes.get(1);
			h.x = 0; h.y = 0;
			h.weapons = new Map([['lightning', { lvl: 1, t: 0 }]]);
			for (let i = 0; i < 4; i++) placeEnemy(r, 'brute', 200 + i * 60, 0);
			r.rebuildGrid();
			r.fx = [];
			r.updateWeapon(h, 'lightning', h.weapons.get('lightning'), dtt);
			return r.fx.filter((f) => f[0] === 'zap').length;
		};
		assert.equal(zapsFor('knight'), 1, 'lightning lvl1: no chain');
		assert.equal(zapsFor('stormcaller'), 2, 'stormcaller: +1 chain');
		console.log('trait stormcaller chain: ok');
	}

	// Alchemist: enemies inside his puddles move 35% slower; other puddles do not slow.
	{
		const stepIn = (hero) => {
			const r = traitRoom([hero]);
			const h = r.heroes.get(1);
			h.x = 0; h.y = 0;
			h.weapons = new Map([['flask', { lvl: 1, t: 0 }]]);
			const e = placeEnemy(r, 'ghoul', 150, 0);
			r.rebuildGrid();
			r.fx = [];
			r.updateWeapon(h, 'flask', h.weapons.get('flask'), dtt);
			const slowFx = r.fx.filter((f) => f[0] === 'slowz').length;
			r.updatePuddles(dtt);
			const x0 = e.x;
			r.moveEnemies(dtt, [h]);
			const inside = x0 - e.x;
			// Out of the puddle the slow wears off.
			r.puddles = [];
			e.x = 150;
			r.time += 1;
			r.moveEnemies(dtt, [h]);
			const outside = 150 - e.x;
			return { inside, outside, slowFx };
		};
		const al = stepIn('alchemist'), kn = stepIn('knight');
		const full = ENEMIES.ghoul.speed * dtt;
		assert.ok(Math.abs(al.inside - full * 0.65) < 1e-6, `alchemist puddle slows: ${al.inside} vs ${full}`);
		assert.ok(Math.abs(al.outside - full) < 1e-6, 'slow ends outside the puddle');
		assert.ok(Math.abs(kn.inside - full) < 1e-6, 'other puddles do not slow');
		assert.equal(al.slowFx, 1, 'slowz fx for alchemist puddle');
		assert.equal(kn.slowFx, 0, 'no slowz fx for other puddles');
		console.log('trait alchemist slow: ok');
	}
}

console.log('OK');
process.exit(0);
