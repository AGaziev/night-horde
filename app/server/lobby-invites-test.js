import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import WebSocket from 'ws';
import { Hub } from './game.js';
import { createLobbyInvites } from './lobby-invites.js';
import { BASE_URL } from './storage.js';
import { PROTO } from './snapshot-codec.js';

test('отсчёт принадлежит хосту, виден вошедшему игроку, отменяется и запускает комнату один раз', () => {
	const messages = [];
	const hub = new Hub((pid, msg) => messages.push({ pid, ...msg }));
	hub.addPlayer(1, 'Хост');
	hub.addPlayer(2, 'Игрок');
	hub.handle(1, { t: 'create', hero: 'witch' });
	const room = hub.players.get(1).room;
	assert.equal(hub.scheduleStart(room, 2, 10_000), false);
	assert.equal(hub.scheduleStart(room, 1, 10_000), true);
	assert.equal(hub.scheduleStart(room, 1, 20_000), false);
	hub.handle(2, { t: 'join', code: room.code, hero: 'knight' });
	assert.equal(messages.findLast((m) => m.t === 'lobby' && m.pid === 2).startsAt, 10_000);
	hub.handle(2, { t: 'cancel-start' });
	assert.equal(room.startsAt, 10_000);
	hub.handle(1, { t: 'start' });
	assert.equal(room.state, 'lobby');
	hub.handle(1, { t: 'cancel-start' });
	assert.equal(room.startsAt, null);
	hub.tick(0, 10_000);
	assert.equal(room.state, 'lobby');
	assert.equal(hub.scheduleStart(room, 1, 20_000), true);
	assert.equal(hub.busy().scheduled, 1);
	hub.tick(0, 19_999);
	assert.equal(room.state, 'lobby');
	hub.tick(0, 20_000);
	hub.tick(0, 21_000);
	assert.equal(room.state, 'play');
	assert.equal(messages.filter((m) => m.t === 'start' && m.pid === 1).length, 1);
	assert.equal(hub.busy().scheduled, 0);
});

test('приглашённый может войти в комнату по коду после ухода хоста', () => {
	const hub = new Hub(() => {});
	hub.addPlayer(1, 'Хост');
	hub.addPlayer(2, 'Игрок');
	hub.handle(1, { t: 'create', hero: 'witch' });
	const room = hub.players.get(1).room;
	hub.scheduleStart(room, 1, 10_000);
	hub.handle(1, { t: 'leave' });
	hub.handle(2, { t: 'join', code: room.code, hero: 'knight' });
	hub.tick(0, 10_000);
	assert.equal(hub.players.get(2).room, room);
	assert.equal(room.state, 'play');
});

test('сотрудники берутся только из действующего списка доступа, доставка учитывается для каждого', async () => {
	let policy = 'NAMED_USERS';
	const calls = [];
	const portal = createLobbyInvites({
		key: 'test-key', serverId: 'test-server', origin: 'https://game.example',
		fetcher: async (url, request) => {
			const route = new URL(url).pathname;
			if (route.endsWith('/access')) {
				return Response.json({ success: true, data: { users: [
					{ userId: '101', userName: 'Аня' }, { userId: '102', userName: 'Борис' }, { userId: 'net_123', userName: 'Гость' },
				], departments: [] } });
			}
			if (route.endsWith('/test-server')) return Response.json({ success: true, data: { accessPolicy: policy } });
			assert.equal(route, '/v1/notifications');
			assert.equal(request.headers.Authorization, 'Bearer vibe_session_test');
			const data = JSON.parse(request.body);
			calls.push(data);
			return Response.json(data.userId === 101
				? { success: true, data: { notificationId: 5 } }
				: { success: false, error: { code: 'NOTIFICATION_NOT_DELIVERED' } });
		},
	});
	assert.deepEqual(await portal.list(), [{ id: '101', name: 'Аня' }, { id: '102', name: 'Борис' }]);
	const results = await portal.send(['101', '102'], 'Bearer vibe_session_test', {
		code: 'TEST', startsAt: 10_000, minutes: 5, host: 'Хост',
	});
	assert.deepEqual(results, { sent: 1, failed: 1 });
	assert.deepEqual(calls.map(({ userId }) => userId), [101, 102]);
	assert.ok(calls.every(({ message }) => message.includes('https://game.example/?room=TEST') && message.includes('5 мин')));
	policy = 'OWNER_ONLY';
	await assert.rejects(portal.list(true));
});

// The application's API runs unchanged; every platform request is redirected to this local stub.
// The preload rejects any other origin, so a dummy test key can never send real notifications.
async function inviteServer(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horde-invites-'));
	const notifications = [], clients = [];
	let heldAccess = null, output = '';
	const backend = http.createServer(async (req, res) => {
		const url = new URL(req.url, 'http://localhost');
		const reply = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
		if (url.pathname === '/v1/infra/servers/test-server') return reply({ success: true, data: { accessPolicy: 'NAMED_USERS' } });
		if (url.pathname === '/v1/infra/servers/test-server/access') {
			if (heldAccess) { heldAccess.reached(); await heldAccess.promise; }
			return reply({ success: true, data: { users: Array.from({ length: 12 }, (_, i) => ({ userId: String(101 + i), userName: 'Player ' + i })), departments: [] } });
		}
		if (url.pathname === '/v1/notifications') {
			const chunks = []; for await (const chunk of req) chunks.push(chunk);
			notifications.push(JSON.parse(Buffer.concat(chunks).toString()));
			return reply({ success: true, data: { notificationId: notifications.length } });
		}
		if (url.pathname.startsWith('/v1/storage/objects/')) return reply({ success: false }, 404);
		return reply({ error: 'Unexpected local stub request: ' + url.pathname }, 500);
	});
	backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
	const backendOrigin = `http://127.0.0.1:${backend.address().port}`;
	const preload = path.join(dir, 'local-platform.mjs');
	fs.writeFileSync(preload, `import { Server } from 'node:net';
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
 if (typeof args[0] === 'number') {
  args[0] = 0;
  this.once('listening', () => console.log('TEST_LISTENING:' + this.address().port));
 }
 return listen.apply(this, args);
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
 const url = new URL(input);
 if (url.origin !== ${JSON.stringify(new URL(BASE_URL).origin)}) throw new Error('External requests are forbidden in the invite test');
 return nativeFetch(new URL(url.pathname + url.search, ${JSON.stringify(backendOrigin)}), options);
};\n`);
	let port, origin;
	const child = spawn(process.execPath, ['--import', new URL('../../pm/test-runtime.mjs', import.meta.url).pathname, '--import', preload, new URL('./server.js', import.meta.url).pathname], {
		env: { ...process.env, PORT: '3000', HORDE_RUNS_DIR: dir, VIBE_APP_KEY: 'local-test-key', HORDE_VIBE_SERVER_ID: 'test-server', HORDE_APP_ORIGIN: 'https://local-game.invalid' },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const exited = once(child, 'exit');
	child.stdout.on('data', (data) => { output += data; port = Number(output.match(/TEST_LISTENING:(\d+)/)?.[1]); });
	child.stderr.on('data', (data) => { output += data; });
	t.after(async () => {
		heldAccess?.release();
		for (const client of clients) client.socket.terminate();
		child.kill(); await exited;
		backend.closeAllConnections(); await new Promise((resolve) => backend.close(resolve));
		fs.rmSync(dir, { recursive: true, force: true });
	});
	let healthy = false;
	for (let i = 0; i < 60; i++) {
		if (port) { origin = `http://127.0.0.1:${port}`; healthy = await fetch(origin + '/health').then((r) => r.ok, () => false); }
		if (healthy) break;
		await setTimeout(50);
	}
	assert.ok(healthy, output);
	async function connect(uid = '101') {
		const session = await (await fetch(origin + '/api/session', { headers: { 'X-Vibe-User-Id': uid } })).json();
		const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?sid=${session.sid}&v=${PROTO}`), frames = [];
		const client = { sid: session.sid, socket, frames, uid, send: (msg) => socket.send(JSON.stringify(msg)) };
		clients.push(client); socket.on('message', (data) => frames.push(JSON.parse(data.toString()))); socket.on('error', () => {});
		client.wait = async (predicate, from = 0) => {
			for (let i = 0; i < 300; i++) {
				const frame = frames.slice(from).find(predicate);
				if (frame) return frame;
				await setTimeout(10);
			}
			assert.fail('Expected invite-test transport frame: ' + JSON.stringify(frames.slice(from)));
		};
		client.pid = (await client.wait((m) => m.t === 'welcome')).pid;
		return client;
	}
	return {
		connect, notifications,
		async create(host, ruleset) {
			const from = host.frames.length; host.send({ t: 'create', ruleset });
			return host.wait((m) => m.t === 'lobby' && m.ruleset === ruleset, from);
		},
		request(host, code, ids) {
			return fetch(`${origin}/api/lobby/invites?sid=${host.sid}&room=${code}`, {
				method: ids ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Vibe-User-Id': host.uid, 'X-Vibe-Authorization': 'Bearer vibe_session_localtest' },
				body: ids ? JSON.stringify({ ids, minutes: 1 }) : undefined,
			});
		},
		holdAccess() {
			let reached, release;
			const arrived = new Promise((resolve) => { reached = resolve; });
			const promise = new Promise((resolve) => { release = resolve; });
			heldAccess = { reached, release, promise };
			return { arrived, release: () => { release(); heldAccess = null; } };
		},
		async busy() { return (await fetch(origin + '/api/busy')).json(); },
	};
}

test('HTTP invites expose four Horde slots and four new invitees fit', { timeout: 15_000 }, async (t) => {
	const api = await inviteServer(t), host = await api.connect();
	const lobby = await api.create(host, 'horde');
	const list = await api.request(host, lobby.code);
	assert.equal(list.status, 200); assert.equal((await list.json()).slots, 4);
	const sent = await api.request(host, lobby.code, ['102', '103', '104', '105']);
	assert.equal(sent.status, 200); assert.deepEqual(await sent.json(), { active: true, sent: 4, failed: 0 });
	assert.equal(api.notifications.length, 4); assert.equal((await api.busy()).scheduled, 1);
});

test('HTTP Horde rejects seven selections before notifications or scheduled start', { timeout: 15_000 }, async (t) => {
	const api = await inviteServer(t), host = await api.connect();
	const lobby = await api.create(host, 'horde');
	const response = await api.request(host, lobby.code, ['102', '103', '104', '105', '106', '107', '108']);
	assert.equal(response.status, 400);
	assert.equal(api.notifications.length, 0); assert.equal((await api.busy()).scheduled, 0);
});

test('HTTP PvE invites retain seven free slots and seven deliveries for the eight-player room', { timeout: 15_000 }, async (t) => {
	const api = await inviteServer(t), host = await api.connect();
	const lobby = await api.create(host, 'pve');
	assert.equal((await (await api.request(host, lobby.code)).json()).slots, 7);
	const sent = await api.request(host, lobby.code, ['102', '103', '104', '105', '106', '107', '108']);
	assert.equal(sent.status, 200); assert.deepEqual(await sent.json(), { active: true, sent: 7, failed: 0 });
	assert.equal(api.notifications.length, 7);
});

test('HTTP invites recheck Horde free places after access lookup while new members join', { timeout: 15_000 }, async (t) => {
	const api = await inviteServer(t), host = await api.connect(), one = await api.connect('109'), two = await api.connect('110');
	const lobby = await api.create(host, 'horde'), held = api.holdAccess();
	const pending = api.request(host, lobby.code, ['102', '103', '104', '105']);
	await held.arrived;
	one.send({ t: 'join', code: lobby.code }); two.send({ t: 'join', code: lobby.code });
	await host.wait((m) => m.t === 'lobby' && m.players.length === 3);
	held.release();
	assert.equal((await pending).status, 409);
	assert.equal(api.notifications.length, 0); assert.equal((await api.busy()).scheduled, 0);
});

test('HTTP invites recheck a PvE-to-Horde ruleset change during access lookup', { timeout: 15_000 }, async (t) => {
	const api = await inviteServer(t), host = await api.connect();
	const lobby = await api.create(host, 'pve'), held = api.holdAccess();
	const pending = api.request(host, lobby.code, ['102', '103', '104', '105', '106', '107', '108']);
	await held.arrived;
	host.send({ t: 'ruleset', id: 'horde' }); await host.wait((m) => m.t === 'lobby' && m.ruleset === 'horde');
	held.release();
	assert.equal((await pending).status, 409);
	assert.equal(api.notifications.length, 0); assert.equal((await api.busy()).scheduled, 0);
});

test('HTTP invites recheck host ownership and lobby state after access lookup', { timeout: 15_000 }, async (t) => {
	const api = await inviteServer(t), host = await api.connect();
	const lobby = await api.create(host, 'horde'), held = api.holdAccess();
	const pending = api.request(host, lobby.code, ['102']);
	await held.arrived;
	const from = host.frames.length; host.send({ t: 'leave' }); await host.wait((m) => m.t === 'rooms', from);
	held.release();
	assert.equal((await pending).status, 409);
	assert.equal(api.notifications.length, 0); assert.equal((await api.busy()).scheduled, 0);
});
