
// --- duos (5.8): rules and every pair ---
{
	const dtt = 1 / TICK_HZ;
	const sent = [];
	const mkRoom = (heroes = ['knight']) => {
		sent.length = 0;
		const r = new Room('DUO', (pid, msg) => sent.push([pid, msg]));
		heroes.forEach((hero, i) => r.addPlayer(i + 1, `D${i + 1}`, hero));
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
	const lastOffer = (pid = 1) => sent.filter(([p, m]) => p === pid && m.t === 'lvl').at(-1)?.[1];
	const fxAll = [];
	const run = (r, sec, each) => {
		for (let i = 0; i < sec * TICK_HZ; i++) {
			r.fx = [];
			r.tick(dtt);
			fxAll.push(...r.fx);
			each?.();
		}
	};
	const take = (kind) => { const out = fxAll.filter((f) => f[0] === kind); return out; };
	const duo = (r, id, lvl = 1) => { const h = r.heroes.get(1); h.weapons = new Map([[id, { lvl, t: 0 }]]); r.updateSynergy(); return h; };

	assert.equal(DUO_IDS.length, 12, '12 duos (Прожектор бури waits for the Lantern)');
	for (const [key, id] of Object.entries(DUO_BY_PAIR)) assert.equal(duoKey(...DUOS[id].parts), key);

	// Rules: card in slot 1 at 3 + 3, start level by sum, fusing frees a slot, parts are not offered again.
	{
		const r = mkRoom();
		const h = r.heroes.get(1);
		h.weapons = new Map([['whip', { lvl: 2, t: 0 }], ['lightning', { lvl: 3, t: 0 }], ['bolt', { lvl: 1, t: 0 }]]);
		assert.ok(!r.makeChoices(h).some((c) => c.kind === 'duo'), 'no duo below 3 + 3');
		const hinted = r.makeChoices(h).concat(r.makeChoices(h), r.makeChoices(h)).filter((c) => c.duoHint);
		assert.ok(hinted.length > 0 && hinted.every((c) => c.duoHint.need === 3), 'pair hint on cards');
		h.weapons.get('whip').lvl = 4;
		const c = r.makeChoices(h);
		assert.equal(c[0].kind, 'duo', 'duo card in slot 1');
		assert.equal(c[0].id, 'thunderslash');
		assert.equal(c[0].level, 1, '4 + 3 = 7 → I');
		h.weapons.get('whip').lvl = 5;
		assert.equal(r.makeChoices(h)[0].level, 2, '5 + 3 = 8 → II');
		h.weapons.get('lightning').lvl = 5;
		assert.equal(r.makeChoices(h)[0].level, 3, '5 + 5 = 10 → III');
		// Decline: comes back after 2 offers.
		h.offer = r.makeChoices(h);
		r.handle(1, { t: 'skip' });
		assert.ok(!r.makeChoices(h).some((x) => x.kind === 'duo'), 'declined duo hides for the next offer');
		assert.ok(r.makeChoices(h).some((x) => x.kind === 'duo') || r.makeChoices(h).some((x) => x.kind === 'duo'), 'and comes back');
		h.offer = r.makeChoices(h);
		assert.equal(h.offer[0].kind, 'duo');
		r.fx = [];
		r.handle(1, { t: 'pick', i: 0 });
		assert.deepEqual([...h.weapons.keys()], ['thunderslash', 'bolt'], 'duo takes the first slot, the second is freed');
		assert.equal(h.weapons.get('thunderslash').lvl, 3);
		assert.ok(r.fx.some((f) => f[0] === 'duo' && f[1] === 1 && f[2] === 'thunderslash'), 'duo event');
		assert.ok(Math.abs(r.synergy - SYNERGY_PER) < 1e-9, '«Слаженность» +4%');
		for (let k = 0; k < 50; k++) for (const x of r.makeChoices(h)) assert.ok(!(x.kind === 'weapon' && ['whip', 'lightning'].includes(x.id)), 'fused parts are not offered');
		// Limit: 2 duos.
		h.weapons = new Map([['thunderslash', { lvl: 1, t: 0 }], ['orb', { lvl: 1, t: 0 }], ['bomb', { lvl: 5, t: 0 }], ['frost', { lvl: 5, t: 0 }]]);
		assert.ok(!r.makeChoices(h).some((x) => x.kind === 'duo'), 'no third duo');
		// Duo upgrades stop at III.
		h.weapons = new Map([['orb', { lvl: 2, t: 0 }]]);
		const up = r.makeChoices(h).find((x) => x.id === 'orb');
		assert.ok(up && up.level === 3);
		h.weapons.get('orb').lvl = 3;
		assert.ok(!r.makeChoices(h).some((x) => x.id === 'orb'), 'no upgrade past III');
		// Same duo twice in the team counts once.
		const r2 = mkRoom(['knight', 'witch', 'ranger']);
		r2.heroes.get(1).weapons = new Map([['orb', { lvl: 1, t: 0 }]]);
		r2.heroes.get(2).weapons = new Map([['orb', { lvl: 1, t: 0 }]]);
		r2.heroes.get(3).weapons = new Map([['censer', { lvl: 1, t: 0 }]]);
		r2.updateSynergy();
		assert.ok(Math.abs(r2.synergy - 2 * SYNERGY_PER) < 1e-9, 'unique duos only');
		console.log('duo rules: ok');
	}

	// 1. Громовой разрез: both sides, rods struck from the sky 0.3 s later, a fan every 3rd swing.
	{
		const r = mkRoom();
		const h = duo(r, 'thunderslash');
		const left = put(r, 'brute', -100, 0), right = put(r, 'brute', 100, 0);
		fxAll.length = 0;
		run(r, 2.5);
		assert.ok(left.hp < 1e5 && right.hp < 1e5, 'both sides');
		assert.ok(take('tslash').length >= 3, 'swings');
		assert.ok(take('zap').some((z) => z[2] === z[4] - 320), 'rod struck from the sky');
		assert.ok(take('tfan').length >= 1, 'fan on the 3rd swing');
		assert.ok(h.dmgBy.thunderslash > 0);
		console.log('duo thunderslash: ok');
	}
	// 2. Шаровая молния: slow orb pulses, then explodes.
	{
		const r = mkRoom();
		duo(r, 'orb');
		const e = put(r, 'brute', 250, 0);
		fxAll.length = 0;
		run(r, 6);
		assert.ok(take('orb').length >= 1 && take('orb')[0].length === 10);
		assert.ok(take('boom').some((b) => b[4] === 3), 'orb explodes');
		assert.ok(e.hp < 1e5 - 50);
		console.log('duo orb: ok');
	}
	// 3. Планетарий: a spark leaves the orbit at an enemy in range and comes back later.
	{
		const r = mkRoom();
		const h = duo(r, 'orrery');
		put(r, 'brute', 200, 0);
		fxAll.length = 0;
		run(r, 0.5);
		assert.ok(take('shot').length >= 1, 'spark launched');
		const w = h.weapons.get('orrery');
		const row = r.snapshot().p[0][12][0];
		assert.equal(row[0], 'orrery');
		assert.ok(row[3] !== (1 << DUOS.orrery.levels[0].count) - 1, 'mask shows the empty slot');
		void w;
		console.log('duo orrery: ok');
	}
	// 4. Мельница: long blades hit and knock back.
	{
		const r = mkRoom();
		duo(r, 'windmill');
		const e = put(r, 'brute', 150, 0);
		run(r, 2);
		assert.ok(e.hp < 1e5 && Math.hypot(e.x, e.y) > 150, 'hit and knocked back');
		console.log('duo windmill: ok');
	}
	// 5. Растяжка: a wire between traps cuts; a missed knife becomes a spike.
	{
		const r = mkRoom();
		const h = duo(r, 'tripwire');
		r.layTrap(h, { x: -100, y: 60, r: 28, dmg: 1, max: 6, src: undefined });
		r.layTrap(h, { x: 100, y: 60, r: 28, dmg: 1, max: 6 });
		const e = put(r, 'brute', 0, 60);
		r.time += 1;
		const hp0 = e.hp;
		run(r, 0.4);
		assert.ok(e.hp < hp0, 'wire hits the enemy between traps');
		const r2 = mkRoom();
		duo(r2, 'tripwire');
		run(r2, 1.5);
		assert.ok(r2.traps.some((t) => t.kind === 3), 'missed knives become spikes');
		console.log('duo tripwire: ok');
	}
	// 6. Возвратный веер: knives come back and hit twice.
	{
		const r = mkRoom();
		duo(r, 'fanback');
		const e = put(r, 'brute', 150, 0);
		fxAll.length = 0;
		run(r, 1.2);
		assert.ok(take('shot').some((s) => s.length === 12 && s[2] === 1), 'returning knives');
		assert.ok(1e5 - e.hp >= 2 * 14 - 0.01, 'hit on both legs');
		console.log('duo fanback: ok');
	}
	// 7. Коктейль: blast + burning pool.
	{
		const r = mkRoom();
		duo(r, 'molotov');
		const e = put(r, 'brute', 200, 0);
		fxAll.length = 0;
		run(r, 2);
		assert.ok(take('lob').some((l) => l[8] === 1) && take('zk').some((z) => z[2] === 1), 'lob + fire pool');
		assert.ok(1e5 - e.hp > 30, 'blast and pool damage');
		console.log('duo molotov: ok');
	}
	// 8. Минное поле: a mine blows up and recharges instead of vanishing.
	{
		const r = mkRoom();
		const h = duo(r, 'minefield');
		r.layTrap(h, { kind: 1, x: 120, y: 0, r: 26, dmg: 45, blastR: 80, kb: 60, recharge: 6, max: 5 });
		r.time += 1;
		const e = put(r, 'brute', 120, 0);
		fxAll.length = 0;
		run(r, 0.2);
		assert.ok(take('boom').some((b) => b[4] === 5) && e.hp < 1e5, 'mine blast');
		const snap = r.snapshot();
		let recharging = false;
		for (let i = 0; i < snap.tr.length; i += 5) if (snap.tr[i + 3] === 2) recharging = true;
		assert.ok(recharging, 'mine stays and recharges');
		console.log('duo minefield: ok');
	}
	// 9. Ледяная граната: freeze, then shards.
	{
		const r = mkRoom();
		duo(r, 'icebomb');
		const e = put(r, 'brute', 200, 0);
		let frozen = false;
		fxAll.length = 0;
		run(r, 2, () => { frozen ||= e.frozenT > r.time; });
		assert.ok(frozen && take('shard').length >= 1, 'freeze + shards');
		console.log('duo icebomb: ok');
	}
	// 10. Полярное сияние: cold aura, a freezing ring every 3 s.
	{
		const r = mkRoom();
		duo(r, 'aurora');
		const e = put(r, 'brute', 80, 0), far = put(r, 'brute', 200, 0);
		let chilled = false, frozenFar = false;
		fxAll.length = 0;
		run(r, 3.5, () => { chilled ||= e.slowT > r.time; frozenFar ||= far.frozenT > r.time; });
		assert.ok(chilled && e.hp < 1e5, 'aura chills and hurts');
		assert.ok(frozenFar && take('frost').some((f) => f[2] === 220), 'ring to 2r freezes');
		console.log('duo aurora: ok');
	}
	// 11. Кадило: clouds hurt enemies and heal allies (not the owner).
	{
		const r = mkRoom(['herald', 'knight']);
		const [h, ally] = [r.heroes.get(1), r.heroes.get(2)];
		duo(r, 'censer');
		const e = put(r, 'brute', 0, 0);
		ally.hp = 100;
		h.hp = 100;
		run(r, 1);
		assert.ok(e.hp < 1e5 && ally.hp > 101 && h.hp === 100, 'damage enemies, heal allies');
		console.log('duo censer: ok');
	}
	// 12. Ледяной диск: ice trail slows, the way back freezes.
	{
		const r = mkRoom();
		duo(r, 'icedisc');
		const e = put(r, 'brute', 150, 0);
		let frozen = false;
		fxAll.length = 0;
		run(r, 2, () => { frozen ||= e.frozenT > r.time; });
		assert.ok(take('shot').some((s) => s[2] === PROJECTILE_KINDS.indexOf('icedisc') && s.length === 12));
		assert.ok(r.puddles.some((z) => z.hidden && z.slow > 0) || frozen, 'ice trail');
		assert.ok(frozen, 'frozen on the way back');
		console.log('duo icedisc: ok');
	}
	// Herald keeps healing allies with Aurora instead of Aura.
	{
		const r = mkRoom(['herald', 'knight']);
		const [h, ally] = [r.heroes.get(1), r.heroes.get(2)];
		h.weapons = new Map([['aurora', { lvl: 1, t: 0 }]]);
		ally.x = 40;
		ally.hp = 100;
		run(r, 1);
		assert.ok(ally.hp > 100.9, 'herald trait works with Aurora');
		console.log('duo herald trait: ok');
	}
}
