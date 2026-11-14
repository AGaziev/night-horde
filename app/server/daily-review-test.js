import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Room } from './game.js';
import { RunStore } from './runlog.js';
import { clientProto } from './snapshot-codec.js';
import { dailyFor } from '../public/shared/daily.js';

test('CEO54-1: midnight direct start refreshes all readiness before another explicit start', () => {
	const before = Date.now, sent = [];
	let now = Date.UTC(2026, 10, 13, 23, 59, 59); Date.now = () => now;
	try {
		const r = new Room('DAY', (pid, msg) => sent.push(msg));
		r.addPlayer(1, 'Host', 'witch'); r.addPlayer(2, 'Ally', 'ranger');
		r.handle(1, { t: 'daily', enabled: true });
		const shown = r.lobbyMsg().daily.day;
		for (const m of r.members.values()) m.ready = true;
		now += 2000; r.handle(1, { t: 'start' });
		assert.equal(r.state, 'lobby');
		assert.ok([...r.members.values()].every(m => !m.ready));
		assert.notEqual(r.lobbyMsg().daily.day, shown);
		assert.ok(!sent.some(msg => msg.t === 'start'));
		r.handle(1, { t: 'start' }); assert.equal(r.state, 'play');
		assert.equal(r.daily.day, dailyFor(now).day);
	} finally { Date.now = before; }
});

test('CEO54-3: legacy participant blocks daily start; downgraded reconnect gets no battle snapshots', () => {
	const sent = [], r = new Room('OLD', (pid, msg) => sent.push([pid, msg]));
	r.addPlayer(1, 'Host', 'witch'); r.addPlayer(2, 'Old', 'ranger');
	r.handle(1, { t: 'daily', enabled: true }); clientProto.set(2, 24);
	try {
		r.start(); assert.equal(r.state, 'lobby');
		clientProto.set(2, 28); r.start(); assert.equal(r.state, 'play');
		clientProto.set(2, 24); sent.length = 0;
		r.resync(2); r.snapshot();
		assert.ok(!sent.some(([pid, msg]) => pid === 2 && ['start', 's'].includes(msg.t)));
	} finally { clientProto.delete(2); }
});

test('CEO54-2: recovered best is durable before full-log rotation', t => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-recover-'));
	t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
	const daily = { ...dailyFor(), mode: 'night', players: 1 };
	const fixture = i => ({ id: 'R' + String(i).padStart(5, '0'), at: new Date(1700000000000 + i * 1000).toISOString(),
		mode: 'night', team: [{ name: 'P', hero: 'witch', level: 1 }], summary: [], win: false, time: 20 });
	const first = new RunStore(); first.persist(dir);
	const rename = fs.renameSync;
	fs.renameSync = (from, to) => { if (to.endsWith('.daily-best')) throw Object.assign(Error('injected once'), { code: 'EACCES' }); return rename(from, to); };
	try { first.add({ ...fixture(1), daily }, ['111']); } finally { fs.renameSync = rename; }
	const recovered = new RunStore(); recovered.persist(dir);
	for (let i = 2; i <= 502; i++) recovered.add(fixture(i), ['111']);
	assert.equal(recovered.get('R00001'), null);
	const final = new RunStore(); final.persist(dir);
	assert.equal(final.history('111').daily.best.length, 1);
});

test('Swarmv2: only ordinary and peak-ring creations enter a cumulative end-resolved cohort', () => {
 const r = new Room('SWARM', () => {}); r.addPlayer(1, 'P', 'witch'); r.handle(1, { t: 'daily', enabled: true });
 let day = Date.UTC(2026, 10, 14); while (dailyFor(day).id !== 'swarm') day += 86400000;
 r.lockDaily(day); r.start();
 assert.equal(r.daily.version, 2);
 assert.equal(r.daily.mods.xp, undefined);
 assert.equal(r.swarm.cohorts.length, 2);
});
