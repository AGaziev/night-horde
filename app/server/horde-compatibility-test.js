import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import WebSocket from 'ws';
import { Hub } from './game.js';
import * as codec from './snapshot-codec.js';

const { PROTO, clientProto } = codec;

test('Horde compatibility requires the exact protocol; unannounced test players remain compatible', () => {
	assert.equal(typeof codec.isCompatible, 'function');
	const pid = 900_001;
	try {
		assert.equal(codec.isCompatible(pid), true);
		for (const version of [PROTO - 1, PROTO, PROTO + 1]) {
			clientProto.set(pid, version);
			assert.equal(codec.isCompatible(pid), version === PROTO);
		}
	} finally { clientProto.delete(pid); }
});

test('Horde checks every member before switching rules and starting, including direct Hub callers', () => {
	const frames = [];
	const hub = new Hub((pid, msg) => frames.push({ pid, ...msg }));
	const host = 900_002, hero = 900_003;
	hub.addPlayer(host, 'Host'); hub.addPlayer(hero, 'Hero');
	try {
		hub.handle(host, { t: 'create' });
		const room = hub.players.get(host).room;
		hub.handle(hero, { t: 'join', code: room.code });
		clientProto.set(hero, PROTO - 1);
		hub.handle(host, { t: 'ruleset', id: 'horde' });
		assert.equal(room.isHorde, false, 'an old PvE member must prevent switching everyone into Horde');
		clientProto.set(hero, PROTO);
		hub.handle(host, { t: 'ruleset', id: 'horde' });
		assert.equal(room.isHorde, true);
		hub.handle(hero, { t: 'ready', v: true });
		clientProto.set(hero, PROTO + 1);
		hub.handle(host, { t: 'start' });
		assert.equal(room.state, 'lobby', 'a protocol change after ready must prevent the start');
		assert.equal(frames.some((m) => m.t === 'start'), false);
	} finally { clientProto.delete(host); clientProto.delete(hero); }
});

async function transportServer(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horde-compatibility-'));
	const preload = path.join(dir, 'ephemeral-port.mjs');
	fs.writeFileSync(preload, `import { Server } from 'node:net';
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
 if (typeof args[0] === 'number') {
  args[0] = 0;
  this.once('listening', () => console.log('TEST_LISTENING:' + this.address().port));
 }
 return listen.apply(this, args);
};\n`);
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
		if (port) { origin = `http://127.0.0.1:${port}`; healthy = await fetch(origin + '/health').then((r) => r.ok, () => false); }
		if (healthy) break;
		await setTimeout(50);
	}
	assert.ok(healthy, output);
	async function connect(sid = null, version = PROTO, onOpen = null) {
		if (!sid) sid = (await (await fetch(origin + '/api/session')).json()).sid;
		const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?sid=${encodeURIComponent(sid)}&v=${version}`);
		const frames = [], client = { sid, socket, frames, send: (msg) => socket.send(JSON.stringify(msg)) };
		clients.push(client);
		if (onOpen) socket.on('open', () => onOpen(client));
		socket.on('message', (data) => frames.push(JSON.parse(data.toString())));
		socket.on('error', () => {});
		client.wait = async (predicate, from = 0) => {
			const until = Date.now() + 3_000;
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
	async function action(client, msg) {
		const from = client.frames.length;
		client.send(msg);
		return client.wait((m) => m.t === 'err' || m.t === 'lobby' || m.t === 'start', from);
	}
	return { connect, action, origin, output: () => output };
}

test('real WS refuses old or future Horde entry and keeps plain PvE playable', { timeout: 15_000 }, async (t) => {
	const { connect, action, output } = await transportServer(t);
	const legacy = await connect(null, PROTO - 1);
	await legacy.wait((m) => m.t === 'err');
	assert.equal((await action(legacy, { t: 'create', ruleset: 'horde' })).t, 'err', 'old client cannot create Horde');
	assert.equal((await action(legacy, { t: 'create' })).ruleset, 'pve');
	assert.equal((await action(legacy, { t: 'ruleset', id: 'horde' })).t, 'err');
	assert.equal((await action(legacy, { t: 'start' })).ruleset, 'pve', 'plain PvE still accepts the older protocol');
	legacy.send({ t: 'leave' });

	const director = await connect(), future = await connect(null, PROTO + 1);
	director.send({ t: 'create', ruleset: 'horde' });
	const lobby = await director.wait((m) => m.t === 'lobby' && m.ruleset === 'horde');
	for (const client of [legacy, future]) {
		assert.equal((await action(client, { t: 'join', code: lobby.code })).t, 'err', 'mismatched client cannot join Horde');
	}
	assert.doesNotMatch(output(), /handle error|TypeError|ReferenceError/);
});

test('real WS and SSE reject mismatched Horde reconnect without resync, replacing the live connection or accepting stale WS commands', { timeout: 15_000 }, async (t) => {
	const { connect, origin, output } = await transportServer(t);
	const director = await connect(), hero = await connect();
	director.send({ t: 'create', ruleset: 'horde' });
	const lobby = await director.wait((m) => m.t === 'lobby' && m.ruleset === 'horde');
	hero.send({ t: 'join', code: lobby.code });
	await hero.wait((m) => m.t === 'lobby' && m.players.length === 2);
	hero.send({ t: 'ready', v: true });
	await director.wait((m) => m.t === 'lobby' && m.players.some((p) => p.pid === hero.pid && p.ready));
	director.send({ t: 'start' });
	await hero.wait((m) => m.t === 'start' && m.ruleset === 'horde');
	await director.wait((m) => m.t === 'horde');
	for (const version of [PROTO - 1, PROTO + 1]) {
		const rejected = await connect(director.sid, version, (client) => client.send({ t: 'leave' }));
		assert.equal(rejected.frames.find((m) => m.t === 'welcome').v, PROTO);
		await rejected.wait((m) => m.t === 'err' && /обновите/.test(m.msg));
		assert.equal(rejected.frames.some((m) => ['start', 'horde', 's'].includes(m.t)), false, 'rejection must not resync Horde');
		for (let i = 0; i < 50 && rejected.socket.readyState !== WebSocket.CLOSED; i++) await setTimeout(10);
		assert.equal(rejected.socket.readyState, WebSocket.CLOSED, 'rejection must close the incompatible connection');
		assert.equal(director.socket.readyState, WebSocket.OPEN, 'rejection must preserve the current connection');
		const from = director.frames.length;
		director.send({ t: 'ping', c: version });
		await director.wait((m) => m.t === 'pong' && m.c === version, from);
		assert.equal(hero.frames.some((m) => m.t === 'over'), false, 'a rejected connection cannot issue leave as the current pid');
	}
	const rejectedSse = await fetch(`${origin}/api/events?sid=${director.sid}&v=${PROTO - 1}`).then((res) => res.text());
	assert.match(rejectedSse, /"t":"welcome"/);
	assert.match(rejectedSse, /"t":"err"/);
	assert.doesNotMatch(rejectedSse, /"t":"(?:start|horde|s)"/);
	assert.equal(director.socket.readyState, WebSocket.OPEN);
	assert.equal((await (await fetch(origin + '/api/busy')).json()).playing, 1);
	assert.doesNotMatch(output(), /handle error|TypeError|ReferenceError/);
});
