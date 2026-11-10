
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
		assert.ok(big && big.gold && Math.abs(Math.hypot(big.x - h.x, big.y - h.y) - 450) < 1, 'swept to the edge of the view');
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
