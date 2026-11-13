import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import WebSocket from 'ws';
import { PROTO } from './snapshot-codec.js';

test('real WebSocket horde purchases stay private and survive director reconnect without replaying payment', { timeout: 20_000 }, async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horde-transport-'));
	const preload = path.join(dir, 'listen.mjs');
	fs.writeFileSync(preload, `import { Server } from 'node:http';
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
 if (typeof args[0] === 'number') {
  args[0] = 0;
  this.once('listening', () => console.log('TEST_LISTENING:' + this.address().port));
 }
 return listen.apply(this, args);
};`);
	const clients = [];
	let output = '', port, origin;
	const child = spawn(process.execPath, ['--import', new URL('../../pm/test-runtime.mjs', import.meta.url).pathname, '--import', preload, new URL('./server.js', import.meta.url).pathname], {
		env: { ...process.env, PORT: '3000', HORDE_RUNS_DIR: dir, VIBE_APP_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'],
	});
	const exited = once(child, 'exit');
	child.stdout.on('data', (data) => { output += data; port = Number(output.match(/TEST_LISTENING:(\d+)/)?.[1]); });
	child.stderr.on('data', (data) => { output += data; });
	t.after(async () => {
		for (const client of clients) client.socket.terminate();
		child.kill(); await exited;
		fs.rmSync(dir, { recursive: true, force: true });
	});
	let healthy = false;
	for (let i = 0; i < 60; i++) {
		if (port) { origin = `http://127.0.0.1:${port}`; healthy = await fetch(origin + '/health', { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false); }
		if (healthy) break;
		await setTimeout(50);
	}
	assert.ok(healthy, output);

	async function connect(sid = null, version = PROTO) {
		if (!sid) sid = (await (await fetch(origin + '/api/session')).json()).sid;
		const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?sid=${encodeURIComponent(sid)}&v=${version}`);
		const frames = [], client = { sid, socket, frames, send: (msg) => socket.send(JSON.stringify(msg)) };
		clients.push(client);
		socket.on('message', (data) => frames.push(JSON.parse(data.toString())));
		socket.on('error', () => {});
		client.wait = async (predicate, from = 0) => {
			const until = Date.now() + 5_000;
			while (Date.now() < until) {
				const found = frames.slice(from).find(predicate);
				if (found) return found;
				await setTimeout(10);
			}
			assert.fail('Expected transport frame; received: ' + frames.slice(from).map((m) => m.t + (m.msg ? ':' + m.msg : '')).join(', '));
		};
		client.pid = (await client.wait((m) => m.t === 'welcome')).pid;
		return client;
	}
	const legacy = await connect(null, PROTO - 1);
	await legacy.wait((m) => m.t === 'err' && /обновите/.test(m.msg));
	legacy.socket.terminate();
	const director = await connect(), hero = await connect();
	director.send({ t: 'create', ruleset: 'horde', hero: 'knight' });
	const lobby = await director.wait((m) => m.t === 'lobby' && m.ruleset === 'horde');
	assert.equal(lobby.directorPid, director.pid);
	hero.send({ t: 'join', code: lobby.code, hero: 'knight' });
	await hero.wait((m) => m.t === 'lobby' && m.players.length === 2);
	hero.send({ t: 'ready', v: true });
	await director.wait((m) => m.t === 'lobby' && m.players.some((p) => p.pid === hero.pid && p.ready));
	director.send({ t: 'start' });
	const start = await hero.wait((m) => m.t === 'start');
	assert.equal(start.ruleset, 'horde'); assert.equal(start.len, 900);
	assert.deepEqual(start.players.map((p) => p.pid), [hero.pid]);
	const initial = await director.wait((m) => m.t === 'horde');
	assert.equal(initial.rank, 1); assert.ok(initial.offer);
	hero.send({ t: 'horde', action: 'spawn', pack: 'swarm', x: 1100, y: 0, seq: 1 });
	await hero.wait((m) => m.t === 'err' && /полководцу/.test(m.msg));
	const choice = initial.offer.choices[0];
	director.send({ t: 'horde', roundId: initial.roundId, action: 'pick', offerId: initial.offer.id, choice: 0, seq: 1 });
	const picked = await director.wait((m) => m.t === 'horde' && m.lastSeq === 1);
	const group = { pack: 'packs', weapon: 'weapons', artifact: 'artifacts' }[choice.kind];
	assert.equal(picked.build[group][choice.id], choice.level); assert.equal(picked.choicesPending, 0);
	director.send({ t: 'horde', roundId: initial.roundId, action: 'pick', offerId: initial.offer.id, choice: 0, seq: 2 });
	await director.wait((m) => m.t === 'horde' && m.lastSeq === 2);
	const purchase = { t: 'horde', roundId: initial.roundId, action: 'spawn', pack: 'swarm', x: 1100, y: 0, seq: 3 };
	director.send(purchase);
	const paid = await director.wait((m) => m.t === 'horde' && m.lastSeq === 3 && m.queued === 1);
	const count = paid.packs.find((p) => p.id === 'swarm').count;
	assert.equal(paid.population, count);
	let mark = director.frames.length;
	director.send(purchase);
	const replay = await director.wait((m) => m.t === 'horde' && m.lastSeq === 3, mark);
	assert.equal(replay.queued, 1); assert.equal(replay.population, count);
	assert.ok(replay.resource <= paid.resource + 1, 'a replay does not charge or refund another batch');
	director.socket.terminate(); await once(director.socket, 'close');
	const resumed = await connect(director.sid);
	assert.equal(resumed.pid, director.pid);
	await resumed.wait((m) => m.t === 'start');
	const restored = await resumed.wait((m) => m.t === 'horde');
	assert.equal(restored.lastSeq, 3); assert.deepEqual(restored.build, paid.build);
	assert.ok(restored.resource >= paid.resource && restored.resource <= paid.resource + 5);
	mark = resumed.frames.length; resumed.send(purchase);
	const duplicate = await resumed.wait((m) => m.t === 'horde' && m.lastSeq === 3, mark);
	assert.equal(duplicate.population, count);
	await resumed.wait((m) => m.t === 'horde' && m.queued === 0 && m.population === count);
	assert.equal(hero.frames.filter((m) => m.t === 'horde').length, 0, 'wallet and draft frames are director-private');
	resumed.send({ t: 'leave' });
	const over = await hero.wait((m) => m.t === 'over');
	assert.equal(over.reason, 'director-left'); assert.equal(over.win, true); assert.equal(over.directorWin, false);
	assert.equal(over.card, null); assert.ok(over.stats.every((s) => !('ach' in s)));
	assert.doesNotMatch(output, /handle error|TypeError|ReferenceError/);
});
