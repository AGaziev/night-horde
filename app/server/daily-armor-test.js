import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
import { dailyFor } from '../public/shared/daily.js';

let day = Date.UTC(2026, 10, 14);
while (dailyFor(day).id !== 'armor') day += 86400000;
function scene(mode, players = 1, old = null) {
	const r = new Room('ARMOR5', () => {}); r.setMode(mode);
	for (let pid = 1; pid <= players; pid++) r.addPlayer(pid, `P${pid}`, 'witch');
	r.handle(1, { t: 'daily', enabled: true }); r.dailyPreview = dailyFor(day);
	r.lockDaily(day, old ?? r.dailyPreview); r.start();
	return r;
}

for (const mode of ['lunch', 'night']) for (let players = 1; players <= 8; players++) {
	test(`Armor v5 ${mode}/${players}: locked terms and native hit retain fractional armor`, () => {
		const r = scene(mode, players), h = r.heroes.get(1), armor = mode === 'lunch' ? .5 : 1;
		assert.equal(r.daily.version, 5); assert.equal(h.mods.armor, armor); assert.equal(h.mods.speedMul, .9);
		const before = h.hp; r.hurtPlayer(h, 10);
		assert.equal(before - h.hp, 10 * h.trait.dmgTaken - armor);
		r.hurtPlayer(h, .1); assert.equal(before - h.hp, 10 * h.trait.dmgTaken - armor + 1);
		const locked = structuredClone(r.daily); r.resync(1); assert.deepEqual(r.daily, locked);
	});
}

for (const version of [1, 2, 3, 4]) test(`Armor v${version} keeps the actual locked bonus`, () => {
	const armor = version <= 2 ? 2 : 1;
	const old = { ...dailyFor(day), version, mods: { armor, speed: .9 } };
	const r = scene('lunch', 1, old), h = r.heroes.get(1);
	assert.equal(h.mods.armor, armor); assert.deepEqual(r.daily.mods, old.mods);
	r.resync(1); assert.equal(r.daily.version, version);
});

test('Armor preview resolves the selected mode before its countdown lock', () => {
	const r = new Room('PREVIEW', () => {}); r.addPlayer(1, 'P', 'witch');
	r.handle(1, { t: 'daily', enabled: true }); r.dailyPreview = dailyFor(day);
	r.setMode('lunch'); assert.equal(r.lobbyMsg().daily.mods.armor, .5); assert.match(r.lobbyMsg().daily.description, /\+0,5/);
	r.setMode('night'); assert.equal(r.lobbyMsg().daily.mods.armor, 1);
	r.setMode('lunch'); r.lockDaily(day); r.start(); assert.equal(r.daily.mods.armor, .5);
});
