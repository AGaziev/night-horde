// Headless simulation test: node server/sim-test.js
import assert from 'node:assert/strict';
import { Hub, Room } from './game.js';
import {
	TICK_HZ, MAX_ENEMIES, ENEMY_TYPES, PROJECTILE_KINDS, WEAPON_IDS, ENEMIES, REVIVE_SECONDS, HEROES, NO_TRAIT, heroTrait,
	ITEM_TYPES, ST, ELITE_AFFIXES, ELITE_HP_MUL, MAX_GEMS, SKIP_XP, REROLLS_START, PASSIVES, WEAPONS, BREAK_TILE,
	breakableAt, xpForNext, PLAYER_RADIUS, ITEMS, MAX_LEVEL,
} from '../public/shared/content.js';

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
		for (const [id, lvl, extra] of p[12]) assert.ok(WEAPON_IDS.includes(id) && isInt(lvl) && (extra === undefined || (id === 'orbit' && isInt(extra))));
	}
	const flat = (arr, n) => {
		assert.ok(Array.isArray(arr) && arr.length % n === 0);
		assert.ok(arr.every(isInt), 'flat arrays must be integers');
	};
	flat(s.e, 6);
	flat(s.b, 5);
	flat(s.g, 4);
	flat(s.z, 4);
	flat(s.tr, 3);
	flat(s.it, 4);
	for (let i = 0; i < s.e.length; i += 6) {
		assert.ok(s.e[i + 1] >= 0 && s.e[i + 1] < ENEMY_TYPES.length);
		assert.ok(s.e[i + 4] >= 1 && s.e[i + 4] <= 100);
		assert.ok(s.e[i + 5] >= 0 && s.e[i + 5] < 512, 'state mask');
	}
	for (let i = 0; i < s.it.length; i += 4) assert.ok(s.it[i + 1] >= 0 && s.it[i + 1] < ITEM_TYPES.length);
	for (let i = 0; i < s.b.length; i += 5) assert.ok(s.b[i + 1] >= 0 && s.b[i + 1] < PROJECTILE_KINDS.length);
	for (let i = 0; i < s.g.length; i += 4) assert.ok([0, 1, 2, 3].includes(s.g[i + 3]));
	assert.ok(Array.isArray(s.fx));
	const known = ['hit', 'die', 'zap', 'slash', 'hurt', 'down', 'up', 'lvl', 'boss', 'chest', 'shot', 'ptgt', 'pend', 'slowz',
		'eshot', 'epend', 'lob', 'boom', 'warn', 'frost', 'snap', 'brk', 'item', 'open', 'elite', 'blink'];
	const arity = {
		ptgt: 4, pend: 5, eshot: 8, epend: 3, lob: 8, boom: 5, warn: 5, frost: 3, snap: 3, brk: 3, item: 5, open: 4, elite: 3, blink: 3,
	};
	for (const f of s.fx) {
		assert.ok(known.includes(f[0]), `fx ${f[0]}`);
		if (arity[f[0]]) assert.equal(f.length, arity[f[0]], `fx ${f[0]} arity`);
		if (f[0] === 'shot') assert.ok(f.length === (f[2] === PROJECTILE_KINDS.indexOf('sickle') ? 12 : 10), 'shot arity');
		if (f[0] === 'hit') assert.ok(f.length === 4 || (f.length === 6 && f[4] === 1), 'hit arity');
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
	// Six max-level weapons per player, rotated so every weapon (old and new) is in play, plus Echo.
	for (const h of r.heroes.values()) {
		h.weapons = new Map();
		for (let k = 0; k < 6; k++) h.weapons.set(WEAPON_IDS[(h.pid * 3 + k) % WEAPON_IDS.length], { lvl: 5, t: Math.random() });
		h.passives.set('echo', 5);
		h.passives.set('crit', 5);
		r.recalcMods(h);
	}
	r.time = 400;
	r.bossIdx = 2;
	const alive = [...r.heroes.values()];
	let ms = 0, n = 0, worst = 0;
	const tickTimes = [];
	for (let i = 0; i < 30 * TICK_HZ; i++) {
		while (r.enemies.length < MAX_ENEMIES) {
			const e = r.spawnEnemy(['skel', 'ghoul', 'bat', 'brute', 'spitter', 'bloater'][r.enemies.length % 6], alive, 50);
			if (r.enemies.length % 40 === 0) r.setElite(e, ELITE_AFFIXES[(r.enemies.length / 40) % ELITE_AFFIXES.length].id);
		}
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
			tickTimes.push(d);
		}
	}
	assert.ok(Object.keys([...r.heroes.values()].reduce((a, h) => Object.assign(a, h.dmgBy), {})).length >= WEAPON_IDS.length, 'all weapons dealt damage');
	console.log('--- stress: 8 players, %d enemies, %d gems, %d traps ---', r.enemies.length, r.gems.length, r.traps.length);
	// Average without the worst 1%: a single OS scheduling stall on a busy machine must not fail the run.
	tickTimes.sort((a, b) => a - b);
	const kept = tickTimes.slice(0, Math.ceil(tickTimes.length * 0.99));
	const trimmed = kept.reduce((a, b) => a + b, 0) / kept.length;
	console.log('tick avg %s ms (without worst 1%%: %s ms), worst %s ms; snapshot avg %d B', (ms / n).toFixed(3), trimmed.toFixed(3), worst.toFixed(2), Math.round(snapBytes / snaps));
	assert.ok(trimmed < 3, 'tick under 3 ms');
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

// --- wave 0/1: offers, crits, new weapons, artifacts, enemies, props, elites, gems ---
{
	const dtt = 1 / TICK_HZ;
	const sent = [];
	const mkRoom = (heroes = ['knight']) => {
		sent.length = 0;
		const r = new Room('NEW', (pid, msg) => sent.push([pid, msg]));
		heroes.forEach((hero, i) => r.addPlayer(i + 1, `N${i + 1}`, hero));
		r.start();
		r.spawn = () => {};
		for (const h of r.heroes.values()) { h.x = 0; h.y = 0; }
		return r;
	};
	const put = (r, type, x, y, hp = 1000) => {
		const e = r.spawnEnemy(type, [...r.heroes.values()], 1);
		e.x = x; e.y = y; e.hp = e.maxHp = hp; e.speed = 0;
		return e;
	};
	const lastOffer = (pid = 1) => sent.filter(([p, m]) => p === pid && m.t === 'lvl').at(-1)?.[1];
	const fxOf = (r, kind) => r.fx.filter((f) => f[0] === kind);
	const only = (h, id, lvl = 1) => { h.weapons = new Map([[id, { lvl, t: 0 }]]); };

	// Reroll and skip.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		r.grantOffer(h);
		let o = lastOffer();
		assert.equal(o.rerolls, REROLLS_START);
		assert.equal(o.skipXp, SKIP_XP);
		assert.ok(o.choices.length >= 1 && o.choices.length <= 3);
		r.handle(1, { t: 'reroll' });
		assert.equal(h.rerolls, REROLLS_START - 1);
		assert.equal(lastOffer().rerolls, REROLLS_START - 1);
		r.handle(1, { t: 'reroll' });
		const n = sent.length;
		r.handle(1, { t: 'reroll' }); // none left
		assert.equal(h.rerolls, 0);
		assert.equal(sent.length, n, 'no reroll without charges');
		h.level = 5; h.xp = 0;
		r.handle(1, { t: 'skip' });
		assert.equal(h.offer, null, 'skip closes the offer');
		assert.equal(h.xp, SKIP_XP, 'skip gives xp');
		r.handle(1, { t: 'skip' }); // nothing to skip
		assert.equal(h.xp, SKIP_XP);
		console.log('reroll/skip: ok');
	}

	// G4: slot 1 upgrades what is owned, new weapons not in two offers in a row, heal at low hp.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		let prevNew = false, newInRow = 0;
		for (let k = 0; k < 200; k++) {
			const c = r.makeChoices(h);
			assert.equal(c[0].kind, 'weapon', 'slot 1 upgrades the owned weapon');
			assert.equal(c[0].id, 'whip');
			const hasNew = c.some((x) => x.kind === 'weapon' && x.level === 1);
			assert.ok(c.filter((x) => x.kind === 'weapon' && x.level === 1).length <= 1, 'one new weapon per offer');
			if (hasNew && prevNew) newInRow++;
			prevNew = hasNew;
		}
		assert.equal(newInRow, 0, 'new weapon at most every other offer');
		h.hp = h.maxHp * 0.3;
		const low = r.makeChoices(h);
		assert.equal(low[2].kind, 'heal', 'heal in slot 3 at low hp');
		h.hp = h.maxHp;
		// Rare card from a chest-boosted offer, applied: +1 to two weapons.
		h.weapons = new Map([['whip', { lvl: 1, t: 0 }], ['bolt', { lvl: 2, t: 0 }], ['aura', { lvl: 5, t: 0 }]]);
		let rare = null;
		for (let k = 0; k < 400 && !rare; k++) {
			h.boostQueue = 1;
			rare = r.makeChoices(h).find((c) => c.kind === 'rare');
		}
		assert.ok(rare, 'rare card shows up');
		h.offer = [rare];
		r.handle(1, { t: 'pick', i: 0 });
		assert.equal(h.weapons.get('whip').lvl + h.weapons.get('bolt').lvl, 5, 'rare: two weapons +1');
		assert.equal(h.weapons.get('aura').lvl, 5);
		console.log('G4 weighted offers + rare: ok');
	}

	// Crits: chance 1 doubles damage and marks the hit event; damage is counted per weapon.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		const e = put(r, 'brute', 300, 0);
		r.fx = [];
		r.hurtEnemy(e, 10, h, { weapon: 'knives', tags: ['phys', 'proj'] });
		assert.equal(e.hp, 990);
		assert.deepEqual(fxOf(r, 'hit')[0].slice(3), [10]);
		h.passives.set('crit', 5);
		r.recalcMods(h);
		assert.ok(Math.abs(h.mods.critChance - 0.3) < 1e-9, 'Острота: +6% per level');
		h.mods.critChance = 1;
		r.fx = [];
		r.hurtEnemy(e, 10, h, { weapon: 'knives', tags: ['phys', 'proj'] });
		assert.equal(e.hp, 970, 'crit ×2');
		assert.deepEqual(fxOf(r, 'hit')[0].slice(3), [20, 1, 1], 'crit flag and owner');
		assert.equal(Math.round(h.dmgBy.knives), 30);
		console.log('crits: ok');
	}

	// Sickle: hits on the way out and again on the way back, then returns to the owner.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		only(h, 'sickle');
		const e = put(r, 'brute', 150, 0);
		r.fx = [];
		let shot = null;
		for (let i = 0; i < 3 * TICK_HZ; i++) {
			r.tick(dtt);
			shot ??= r.fx.find((f) => f[0] === 'shot');
			if (r.projectiles.length === 0 && shot) break;
		}
		assert.ok(shot && shot.length === 12 && shot[10] === 1, 'sickle shot carries owner and out time');
		assert.ok(1000 - e.hp >= 24, `sickle hits twice: ${1000 - e.hp}`);
		console.log('weapon sickle: ok');
	}

	// Petard: lob, then a blast after the fuse in the densest group.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		only(h, 'bomb');
		const lone = put(r, 'brute', -200, 0);
		const pack = [put(r, 'brute', 200, 0), put(r, 'brute', 220, 10), put(r, 'brute', 205, -15)];
		r.tick(dtt);
		const lob = r.fx.find((f) => f[0] === 'lob') ?? sent.flatMap(([, m]) => m.t === 's' ? m.fx : []).find((f) => f[0] === 'lob');
		assert.ok(r.blasts.length === 1, 'bomb thrown');
		assert.ok(r.blasts[0].x > 150, 'aimed at the pack');
		for (let i = 0; i < TICK_HZ; i++) r.tick(dtt);
		for (const e of pack) assert.ok(e.hp < 1000, 'pack damaged');
		assert.equal(lone.hp, 1000, 'lone enemy untouched');
		void lob;
		console.log('weapon bomb: ok');
	}

	// Frost: damage + slow; level 5 freezes (no contact damage, frozen bit in the snapshot).
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		only(h, 'frost', 5);
		const e = put(r, 'ghoul', 60, 0);
		e.speed = 60;
		r.tick(dtt);
		assert.ok(e.hp < 1000 && e.slowT > r.time && e.frozenT > r.time, 'frost hits, slows, freezes');
		assert.equal(r.enemyState(e) & (ST.chill | ST.frozen), ST.chill | ST.frozen);
		e.x = 20; // touching the hero while frozen
		const hp = h.hp;
		r.tick(dtt);
		assert.equal(h.hp, hp, 'frozen enemies do not bite');
		const snap = r.snapshot();
		const i = snap.e.indexOf(e.id);
		assert.ok(i >= 0 && (snap.e[i + 5] & ST.frozen), 'frozen bit in snapshot');
		console.log('weapon frost: ok');
	}

	// Traps: laid behind a moving hero, catch the first enemy: damage + root.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		only(h, 'traps');
		h.lastPosT = 0;
		r.handle(1, { t: 'pos', x: 10, y: 0, fx: 1, fy: 0 });
		r.tick(dtt);
		assert.equal(r.traps.length, 1);
		assert.ok(r.traps[0].x < h.x - 10, 'trap behind the hero');
		const e = put(r, 'ghoul', r.traps[0].x, r.traps[0].y + 4);
		e.speed = 60;
		r.time += 0.5;
		r.fx = [];
		r.tick(dtt);
		assert.equal(r.traps.length, 0, 'trap used');
		assert.ok(e.hp < 1000 && e.rootT > r.time, 'damage + root');
		assert.ok(r.enemyState(e) & ST.root);
		assert.ok(r.snapshot().fx.some((f) => f[0] === 'snap'));
		console.log('weapon traps: ok');
	}

	// Artifacts: Echo adds projectiles and orbit blades, Hourglass lengthens puddles, Mail blocks damage.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		only(h, 'knives');
		put(r, 'brute', 200, 0);
		const knives = () => {
			r.fx = [];
			h.weapons.get('knives').t = 0;
			r.updateWeapon(h, 'knives', h.weapons.get('knives'), dtt);
			return r.fx.filter((f) => f[0] === 'shot').length;
		};
		assert.equal(knives(), 1);
		h.passives.set('echo', 1);
		r.recalcMods(h);
		assert.equal(knives(), 2, 'Эхо 1: +1');
		h.passives.set('echo', 4);
		r.recalcMods(h);
		assert.equal(knives(), 3, 'Эхо 4: +2');
		h.weapons.set('orbit', { lvl: 1, t: 0 });
		const row = r.snapshot().p.find((p) => p[0] === 1);
		assert.deepEqual(row[12].find((w) => w[0] === 'orbit'), ['orbit', 1, 2], 'orbit extra blades in snapshot');

		only(h, 'flask');
		r.updateWeapon(h, 'flask', h.weapons.get('flask'), dtt);
		const plain = r.puddles.at(-1).life;
		h.passives = new Map([['hourglass', 5]]);
		r.recalcMods(h);
		h.weapons.get('flask').t = 0;
		r.updateWeapon(h, 'flask', h.weapons.get('flask'), dtt);
		assert.ok(Math.abs(r.puddles.at(-1).life - plain * 1.6) < 1e-9, 'Песочные часы 5: ×1.6');

		h.passives = new Map([['mail', 3]]);
		r.recalcMods(h);
		h.hp = 100;
		r.hurtPlayer(h, 10);
		assert.equal(h.hp, 93, 'Кольчуга 3: −3');
		h.iframes = 0;
		r.hurtPlayer(h, 2);
		assert.equal(h.hp, 92, 'at least 1 damage');
		console.log('artifacts echo/hourglass/mail: ok');
	}

	// Spitter: winds up, spits; the blob hits a standing player and misses one who steps aside.
	{
		const run = (dodge) => {
			const r = mkRoom();
			const h = r.heroes.get(1);
			h.weapons = new Map();
			const e = put(r, 'spitter', 290, 0, 1000);
			e.speed = ENEMIES.spitter.speed;
			e.shotT = 0;
			let wind = false, shot = false, hurt = false;
			for (let i = 0; i < 3 * TICK_HZ; i++) {
				if (dodge && shot) {
					h.lastPosT = r.time - 0.1;
					r.handle(1, { t: 'pos', x: h.x, y: h.y + 150 * dtt, fx: 0, fy: 1 });
				}
				r.fx = [];
				r.tick(dtt);
				wind ||= (r.enemyState(e) & ST.windup) !== 0;
				shot ||= r.fx.some((f) => f[0] === 'eshot');
				hurt ||= r.fx.some((f) => f[0] === 'hurt');
			}
			return { wind, shot, hurt };
		};
		const still = run(false);
		assert.ok(still.wind && still.shot && still.hurt, `spitter hits a standing player ${JSON.stringify(still)}`);
		const moving = run(true);
		assert.ok(moving.shot && !moving.hurt, 'stepping aside dodges the blob');
		console.log('spitter + hostile shots: ok');
	}

	// Bloater: contact lights a fuse, blast hurts players and enemies; killing it leaves a delayed blast.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.weapons = new Map();
		const b = put(r, 'bloater', 20, 0, 10);
		const other = put(r, 'brute', 40, 30, 1000);
		r.tick(dtt);
		assert.ok(b.fuseT > 0 && (r.enemyState(b) & ST.windup), 'fuse lit on contact');
		const hp = h.hp;
		r.fx = [];
		for (let i = 0; i < TICK_HZ; i++) r.tick(dtt);
		assert.ok(b.dead, 'bloater blew up');
		assert.ok(hp - h.hp >= ENEMIES.bloater.blastDmg - 0.01, 'player hurt by the blast');
		assert.equal(other.hp, 1000 - ENEMIES.bloater.blastEnemyDmg, 'enemies hurt by the blast');
		const b2 = put(r, 'bloater', 300, 0, 10);
		r.fx = [];
		r.hurtEnemy(b2, 50, h);
		assert.ok(r.fx.some((f) => f[0] === 'warn') && r.blasts.length === 1, 'kill leaves a telegraphed blast');
		for (let i = 0; i < TICK_HZ; i++) r.tick(dtt);
		assert.equal(r.blasts.length, 0);
		console.log('bloater: ok');
	}

	// Breakable props and pickups.
	{
		const r = mkRoom(['knight', 'witch']);
		const [h, h2] = [r.heroes.get(1), r.heroes.get(2)];
		let prop = null;
		for (let tx = -6; tx <= 6 && !prop; tx++) for (let ty = -6; ty <= 6 && !prop; ty++) prop = breakableAt(tx, ty);
		assert.ok(prop, 'props exist');
		let props = 0;
		for (let tx = -20; tx < 20; tx++) for (let ty = -20; ty < 20; ty++) if (breakableAt(tx, ty)) props++;
		assert.ok(props > 300 && props < 500, `prop density ~25%: ${props}`);
		r.fx = [];
		r.breakAround(prop.x, prop.y, 5, h);
		assert.ok(r.fx.some((f) => f[0] === 'brk' && f[1] === prop.tx && f[2] === prop.ty));
		const items0 = r.items.length;
		r.fx = [];
		r.breakAround(prop.x, prop.y, 5, h);
		assert.equal(r.fx.length, 0, 'breaks once');
		assert.ok(r.startMsg().broken.length === 2, 'broken props resent on reconnect');
		void items0;
		const pick = (type, setup = () => {}) => {
			r.items = [];
			const it = r.dropItem(type, h.x, h.y);
			setup();
			r.fx = [];
			r.updateItems(dtt, [h, h2]);
			assert.equal(r.items.length, 0, `${type} picked`);
			assert.ok(r.fx.some((f) => f[0] === 'item' && f[2] === it.type));
		};
		h.hp = 10;
		pick('dew');
		assert.equal(h.hp, 10 + ITEMS.dew.heal);
		const rr = h.rerolls;
		pick('feather');
		assert.equal(h.rerolls, rr + 1);
		h2.x = 100;
		pick('rage');
		assert.ok(h.rageT > r.time && h2.rageT > r.time, 'rage for allies nearby');
		r.gems = [{ id: 1, x: 2000, y: 0, xp: 5, gold: false, pull: null }];
		pick('magnet');
		assert.equal(r.gems[0].pull, h, 'magnet pulls every gem');
		const e1 = put(r, 'skel', 200, 0, 30), boss = put(r, 'boss', 300, 0, 1000);
		boss.boss = true;
		pick('cracker');
		assert.ok(e1.dead && Math.abs(boss.hp - 900) < 1e-6, 'cracker: kills small, −10% to big');
		const e2 = put(r, 'skel', 200, 0);
		pick('slowtime');
		assert.ok(e2.slowT > r.time + 5 && e2.slow === ITEMS.slowtime.slow);
		sent.length = 0;
		h.offer = null;
		pick('chest');
		assert.ok(lastOffer(), 'chest gives an offer');
		console.log('props + pickups: ok');
	}

	// Elites and their reward.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.weapons = new Map();
		const e = put(r, 'skel', 300, 0, 100);
		r.fx = [];
		const el = r.makeElite([h]);
		assert.equal(el, e);
		assert.equal(e.maxHp, 100 * ELITE_HP_MUL);
		assert.ok(r.enemyState(e) & ST.elite);
		assert.ok(r.fx.some((f) => f[0] === 'elite' && f[1] === e.id && f[2] >= 0 && f[2] < ELITE_AFFIXES.length));
		const rnd = Math.random;
		Math.random = () => 0.01;
		try {
			r.hurtEnemy(e, 1e9, h);
		} finally {
			Math.random = rnd;
		}
		assert.ok(r.items.some((it) => ITEM_TYPES[it.type] === 'chest'), 'elite drops a chest');
		const e2 = put(r, 'skel', 300, 0, 100);
		r.setElite(e2, 'armored');
		const hp = e2.hp;
		r.hurtEnemy(e2, 10, h, { weapon: 'knives', tags: ['proj'] });
		r.hurtEnemy(e2, 10, h, { weapon: 'aura', tags: ['aoe'] });
		assert.equal(hp - e2.hp, 15, 'armored elite: −50% from projectiles');
		Math.random = () => 0.99;
		try {
			r.gems = [];
			r.hurtEnemy(e2, 1e9, h);
		} finally {
			Math.random = rnd;
		}
		assert.ok(r.gems.some((g) => g.gold) && r.snapshot().g.includes(3), 'otherwise a gold gem (tier 3)');
		// Elites start at 4:00.
		const r2 = mkRoom();
		r2.time = 230;
		for (let i = 0; i < 3; i++) put(r2, 'skel', 200 + i * 40, 0);
		for (let i = 0; i < 9 * TICK_HZ; i++) r2.tick(dtt);
		assert.equal(r2.enemies.filter((x) => x.elite).length, 0, 'no elites before 4:00');
		for (let i = 0; i < 2 * TICK_HZ; i++) r2.tick(dtt);
		assert.equal(r2.enemies.filter((x) => x.elite).length, 1, 'elite at 4:00');
		console.log('elites + small chest: ok');
	}

	// G1: at the gem cap the farthest gem folds into the new one; far gems are swept next to the player.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		r.gems = [];
		for (let i = 0; i < MAX_GEMS; i++) r.gems.push({ id: 10000 + i, x: 100 + i, y: 50, xp: 1, gold: false, pull: null });
		r.gems[7].x = 5000;
		r.gems[7].xp = 40;
		r.dropGem(30, 30, 2);
		assert.equal(r.gems.length, MAX_GEMS);
		assert.ok(!r.gems.some((g) => g.x === 5000), 'farthest gem folded');
		const total = r.gems.reduce((s, g) => s + g.xp, 0);
		assert.equal(total, MAX_GEMS - 1 + 40 + 2, 'no xp lost');
		r.gems = [
			{ id: 1, x: 3000, y: 0, xp: 7, gold: false, pull: null },
			{ id: 2, x: 3200, y: 100, xp: 5, gold: true, pull: null },
			{ id: 3, x: 50, y: 0, xp: 1, gold: false, pull: null },
		];
		r.sweepFarGems([h]);
		assert.equal(r.gems.length, 2);
		const big = r.gems.find((g) => g.xp === 12);
		assert.ok(big && !big.gold && Math.abs(Math.hypot(big.x - h.x, big.y - h.y) - 450) < 1, 'swept to the edge of the view');
		// Brutes drop «Зов углей» once per two minutes.
		r.time = 200;
		r.nextMagnetT = 120;
		r.items = [];
		r.hurtEnemy(put(r, 'brute', 300, 0, 5), 99, h);
		r.hurtEnemy(put(r, 'brute', 300, 0, 5), 99, h);
		assert.equal(r.items.filter((it) => ITEM_TYPES[it.type] === 'magnet').length, 1);
		console.log('G1 gems: ok');
	}
}

console.log('OK');
process.exit(0);
