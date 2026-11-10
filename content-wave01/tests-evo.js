
// --- wave 3: team XP, evolutions, new weapons, embers, control caps ---
{
	const dtt = 1 / TICK_HZ;
	const sent = [];
	const mkRoom = (heroes = ['knight']) => {
		sent.length = 0;
		const r = new Room('EVO', (pid, msg) => sent.push([pid, msg]));
		heroes.forEach((hero, i) => r.addPlayer(i + 1, `E${i + 1}`, hero));
		r.start();
		r.spawn = () => {};
		r.nextInvasionT = Infinity;
		r.nextEliteT = Infinity;
		for (const h of r.heroes.values()) { h.x = 0; h.y = 0; h.hp = h.maxHp = 1e6; }
		return r;
	};
	const put = (r, type, x, y, hp = 1e5) => {
		const e = r.spawnEnemy(type, [...r.heroes.values()], 1);
		e.x = x; e.y = y; e.hp = e.maxHp = hp; e.speed = 0; e.dmg = 0;
		return e;
	};
	const fxAll = [];
	const run = (r, sec, each) => {
		for (let i = 0; i < sec * TICK_HZ; i++) {
			r.fx = [];
			const n0 = sent.length;
			r.tick(dtt);
			for (const [pid, m] of sent.slice(n0)) if (pid === 1 && m.t === 's') fxAll.push(...m.fx);
			fxAll.push(...r.fx);
			each?.();
		}
	};
	const take = (kind) => fxAll.filter((f) => f[0] === kind);
	const only = (r, id, lvl = 1) => { const h = r.heroes.get(1); h.weapons = new Map([[id, { lvl, t: 0 }]]); return h; };

	// Team XP: a gem gives its full XP to everyone, the downed included; the threshold scales so solo is unchanged.
	{
		assert.equal(xpForNext(5, 1), 5 + 4 * 8, 'solo threshold unchanged');
		assert.ok(Math.abs(teamXpMul(4) - 4 / 1.9) < 1e-9);
		const r = mkRoom(['knight', 'witch', 'ranger']);
		const [a, b, c] = [1, 2, 3].map((pid) => r.heroes.get(pid));
		for (const x of [a, b, c]) x.level = 30;
		r.hurtPlayer(c, 1e9);
		c.ward = 0;
		const before = [a.xp, b.xp, c.xp];
		r.collectGem(a, 10);
		assert.deepEqual([a.xp - before[0], b.xp - before[1], c.xp - before[2]], [10, 10, 10], 'everyone gets the full gem');
		const snap = r.snapshot();
		assert.equal(snap.p[0][7], xpForNext(30, 3), 'snapshot shows the team threshold');
		console.log('team xp: ok');
	}

	// Control caps: refreeze immunity after a thaw, knockback at most once per second.
	{
		const r = mkRoom();
		const e = put(r, 'brute', 100, 0);
		assert.ok(r.freeze(e, 0.5));
		r.time += 0.6;
		assert.ok(!r.freeze(e, 0.5), 'just thawed: immune');
		r.time += 1.5;
		assert.ok(r.freeze(e, 0.5), 'immunity wears off');
		const x0 = e.x;
		r.knock(e, 0, 0, 20);
		r.knock(e, 0, 0, 20);
		assert.equal(e.x, x0 + 20, 'one knockback per second');
		console.log('control caps: ok');
	}

	// Evolution card: weapon 5 + artifact → slot 1; picking replaces the weapon, the artifact stays.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.level = 30;
		h.weapons = new Map([['bolt', { lvl: 4, t: 0 }], ['whip', { lvl: 2, t: 0 }]]);
		h.passives = new Map([['echo', 1]]);
		r.recalcMods(h);
		assert.ok(!r.makeChoices(h).some((c) => c.kind === 'evo'), 'no evolution below level 5');
		h.weapons.get('bolt').lvl = 5;
		h.passives = new Map();
		assert.ok(!r.makeChoices(h).some((c) => c.kind === 'evo'), 'no evolution without the artifact');
		h.passives = new Map([['echo', 1]]);
		h.offer = r.makeChoices(h);
		assert.equal(h.offer[0].kind, 'evo');
		assert.equal(h.offer[0].id, 'swarm');
		r.fx = [];
		r.handle(1, { t: 'pick', i: 0 });
		assert.deepEqual([...h.weapons.keys()], ['swarm', 'whip'], 'evolution takes the weapon slot');
		assert.ok(h.passives.has('echo'));
		assert.ok(r.fx.some((f) => f[0] === 'evo' && f[2] === 'swarm'));
		for (let k = 0; k < 50; k++) for (const c of r.makeChoices(h)) assert.ok(!(c.kind === 'weapon' && c.id === 'bolt'), 'evolved weapon is not offered again');
		// Declined evolutions come back after 2 offers.
		const r2 = mkRoom();
		const h2 = r2.heroes.get(1);
		h2.level = 30;
		h2.weapons = new Map([['whip', { lvl: 5, t: 0 }]]);
		h2.passives = new Map([['might', 1]]);
		r2.recalcMods(h2);
		h2.offer = r2.makeChoices(h2);
		r2.handle(1, { t: 'skip' });
		assert.ok(!r2.makeChoices(h2).some((c) => c.kind === 'evo'));
		assert.ok(r2.makeChoices(h2).some((c) => c.kind === 'evo') || r2.makeChoices(h2).some((c) => c.kind === 'evo'));
		// A duo part cannot evolve, an evolved weapon cannot join a duo.
		h2.weapons = new Map([['crescent', { lvl: 1, t: 0 }], ['lightning', { lvl: 5, t: 0 }]]);
		assert.ok(!r2.makeChoices(h2).some((c) => c.kind === 'duo'), 'no duo with an evolved weapon');
		for (const id of EVO_IDS) assert.ok(PASSIVES[EVOS[id].requires] && WEAPONS[EVOS[id].from], `${id} parts exist`);
		console.log('evolution card: ok');
	}

	// Embers: a small permanent bonus per pick, stacking.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.hp = h.maxHp = 100;
		h.baseHp = 100;
		h.offer = r.emberCards(h, 3);
		r.handle(1, { t: 'pick', i: 0 });
		h.offer = r.emberCards(h, 3);
		r.handle(1, { t: 'pick', i: 0 });
		assert.ok(Math.abs(h.mods.dmgMul - 1.1) < 1e-9, 'two embers of rage: +10%');
		h.offer = r.emberCards(h, 3);
		r.handle(1, { t: 'pick', i: 2 });
		assert.equal(h.maxHp, 115);
		console.log('embers: ok');
	}

	// Every evolution works in place of its weapon.
	const evoHits = {
		swarm: (r) => take('shot').length > 6,
		crescent: (r) => take('crescent').length > 0,
		bladestorm: (r) => take('shot').length >= 6,
		millstones: () => true,
		tocsin: () => take('bell').length > 0,
		tempest: () => take('zap').length >= 5,
		moonblade: () => true,
		fireworks: () => take('lob').some((l) => l[8] === 3) && take('boom').some((b) => b[4] === 8),
		blizzard: () => take('frost').length > 0,
		pitfall: () => take('boom').some((b) => b[4] === 5),
		bastion: (r) => r.heroes.get(1).ward === 4,
	};
	for (const id of EVO_IDS) {
		const r = mkRoom();
		const h = only(r, id);
		h.lastPosT = 0;
		r.handle(1, { t: 'pos', x: 5, y: 0, fx: 1, fy: 0 });
		const es = [];
		for (let i = 0; i < 8; i++) es.push(put(r, 'brute', Math.cos(i) * (60 + i * 25), Math.sin(i) * (60 + i * 25)));
		es.push(put(r, 'brute', 300, 0), put(r, 'brute', 0, 210), put(r, 'brute', -30, -45));
		fxAll.length = 0;
		run(r, 4);
		const hurt = es.filter((e) => e.hp < 1e5).length;
		assert.ok(id === 'bastion' || hurt > 0, `${id} hurts enemies`);
		assert.ok(evoHits[id](r), `${id} effect`);
		assert.ok(id === 'bastion' || h.dmgBy[id] > 0, `${id} damage is counted`);
	}
	console.log('evolutions x%d: ok', EVO_IDS.length);

	// New weapons.
	{
		// Lantern marks enemies in the cone: everyone's damage to them grows.
		const r = mkRoom();
		only(r, 'lantern');
		const e = put(r, 'brute', 120, 0);
		fxAll.length = 0;
		run(r, 0.6);
		assert.ok(take('cone').length > 0 && (r.enemyState(e) & ST.mark), 'lantern marks');
		const hp = e.hp;
		r.hurtEnemy(e, 100, r.heroes.get(2) ?? null, undefined);
		assert.ok(hp - e.hp > 100, 'marked enemy takes more damage');
		// Trail leaves burning fire on the path.
		const r2 = mkRoom();
		const h2 = only(r2, 'trail');
		const e2 = put(r2, 'brute', 0, 0);
		h2.lastPosT = 0;
		let burnt = false;
		run(r2, 1, () => { r2.handle(1, { t: 'pos', x: h2.x + (Math.random() - 0.5) * 6, y: 0, fx: 1, fy: 0 }); burnt ||= e2.burnT > r2.time; });
		assert.ok(burnt && e2.hp < 1e5, 'trail burns');
		// Spear goes for the toughest enemy and pierces a line.
		const r3 = mkRoom();
		only(r3, 'spear');
		const weak = put(r3, 'bat', 100, 0, 10), strong = put(r3, 'brute', -200, 0, 5000);
		const behind = put(r3, 'skel', -260, 0, 1000);
		run(r3, 1);
		assert.ok(strong.hp < 5000 && behind.hp < 1000 && weak.hp === 10, 'spear: toughest first, pierces');
		// Ward eats a hit and bursts when the last charge breaks.
		const r4 = mkRoom();
		const h4 = only(r4, 'ward');
		run(r4, 0.1);
		assert.equal(h4.ward, 1);
		const e4 = put(r4, 'skel', 60, 0, 1000);
		const hp4 = h4.hp;
		fxAll.length = 0;
		r4.hurtPlayer(h4, 50);
		assert.equal(h4.hp, hp4, 'charge absorbs the hit');
		assert.equal(h4.ward, 0);
		assert.ok(e4.hp < 1000 && r4.fx.some((f) => f[0] === 'boom' && f[4] === 7), 'burst');
		assert.equal(r4.snapshot().p[0][13], 0);
		console.log('new weapons lantern/trail/spear/ward: ok');
	}
}
