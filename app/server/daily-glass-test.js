import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room, Hub } from './game.js';
import { DAILY_VERSION, dailyFor } from '../public/shared/daily.js';

let glassDay = Date.UTC(2026, 10, 14);
while (dailyFor(glassDay).id !== 'glass') glassDay += 86400000;

function lobby(mode, n = 1) {
	const r = new Room('GLASS4', () => {});
	r.setMode(mode);
	for (let i = 1; i <= n; i++) r.addPlayer(i, `P${i}`, 'witch');
	r.handle(1, { t: 'daily', enabled: true });
	r.dailyPreview = dailyFor(glassDay);
	return r;
}

for (const mode of ['lunch', 'night']) for (let n = 1; n <= 8; n++) {
	test(`Glass v${DAILY_VERSION} ${mode}/${n}: preview, locked native damage and upgrades agree`, () => {
		const r = lobby(mode, n), multiplier = mode === 'lunch' ? 1.1 : 1.2;
		assert.equal(r.lobbyMsg().daily.mods.damage, multiplier);
		assert.match(r.lobbyMsg().daily.description, mode === 'lunch' ? /\+10%/ : /\+20%/);
		r.lockDaily(glassDay); r.start();
		assert.equal(r.daily.version, DAILY_VERSION);
		assert.equal(r.daily.mods.damage, multiplier);
		assert.equal(r.daily.mods.hp, .7);
		const h = r.heroes.get(1), locked = structuredClone(r.daily);
		assert.equal(h.mods.dmgMul, multiplier);
		h.passives.set('vigor', 1); r.recalcMods(h);
		assert.ok(Math.abs(h.mods.dmgMul - 1.025 * multiplier) < 1e-9);
		const maximum = h.maxHp; r.recalcMods(h);
		assert.equal(h.maxHp, maximum);
		r.resync(1); assert.deepEqual(r.daily, locked);
		r.finish(false); assert.deepEqual(r.lastLog.daily, locked);
	});
}

test('mode changes update the shown bonus; countdown locks its checked mode and contract', () => {
	const now = Date.now; Date.now = () => glassDay;
	try {
		const hub = new Hub(() => {});
		hub.addPlayer(1, 'Host'); hub.handle(1, { t: 'create', hero: 'witch', mode: 'night' });
		const r = hub.players.get(1).room;
		r.handle(1, { t: 'daily', enabled: true });
		assert.equal(r.lobbyMsg().daily.mods.damage, 1.2);
		r.handle(1, { t: 'mode', mode: 'lunch' });
		assert.equal(r.lobbyMsg().daily.mods.damage, 1.1);
		assert.equal(hub.scheduleStart(r, 1, glassDay + 60000), true);
		const locked = structuredClone(r.daily);
		r.handle(1, { t: 'mode', mode: 'night' });
		Date.now = () => glassDay + 86400000;
		r.start(); assert.equal(r.mode, 'lunch'); assert.deepEqual(r.daily, { ...locked, players: 1 });
	} finally { Date.now = now; }
});

for (const version of [1, 2, 3]) for (const mode of ['lunch', 'night']) {
	test(`locked Glass v${version}/${mode} retains its old bonus on start and reconnect`, () => {
		const r = lobby(mode);
		const old = Object.freeze({ ...dailyFor(glassDay), version, mods: Object.freeze({ hp: .7, damage: 1.2 }) });
		r.lockDaily(glassDay, old); r.start();
		assert.equal(r.daily.version, version); assert.equal(r.heroes.get(1).mods.dmgMul, 1.2);
		const locked = structuredClone(r.daily); r.resync(1); assert.deepEqual(r.daily, locked);
	});
}
