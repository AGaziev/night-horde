import { PROTO } from './snapshot-codec.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import WebSocket from 'ws';

test('CEO54-3 real transport: old normal client works, daily join and active downgrade are denied', async t => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-legacy-'));
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
	let output = '', port, url;
	const server = spawn(process.execPath, ['--import', new URL('../../pm/test-runtime.mjs', import.meta.url).pathname, '--import', preload, new URL('./server.js', import.meta.url).pathname], {
		env: { ...process.env, PORT: '3000', HORDE_RUNS_DIR: dir, VIBE_APP_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'],
	});
	const exit = once(server, 'exit'); const sockets = [];
	server.stdout.on('data', data => { output += data; port = Number(output.match(/TEST_LISTENING:(\d+)/)?.[1]); });
	server.stderr.on('data', data => { output += data; });
	t.after(async () => { for (const ws of sockets) ws.terminate(); server.kill(); await exit; fs.rmSync(dir, { recursive: true, force: true }); });
	let ready = false;
	for (let i = 0; i < 50 && !ready; i++) {
		if (port) { url = `http://127.0.0.1:${port}`; ready = await fetch(url + '/health', { signal: AbortSignal.timeout(2000) }).then(r => r.ok, () => false); }
		if (!ready) await wait(50);
	}
	assert.ok(ready, output);
	async function connection(sid, protocol) {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?sid=${sid}&v=${protocol}`), messages = [];
		sockets.push(ws); ws.on('error', () => {}); ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
		await once(ws, 'open');
		const until = async predicate => { for (let i = 0; i < 100; i++) { const msg = messages.find(predicate); if (msg) return msg; await wait(10); } throw Error('message timeout'); };
		return { ws, messages, until, send: msg => ws.send(JSON.stringify(msg)) };
	}
	const sid = (await (await fetch(url + '/api/session')).json()).sid;
	let c = await connection(sid, 24); await c.until(m => m.t === 'welcome');
	c.send({ t: 'create', hero: 'witch' }); await c.until(m => m.t === 'lobby');
	c.send({ t: 'start' }); await c.until(m => m.t === 'start');
	assert.ok(c.messages.some(m => m.t === 'start'), 'legacy ordinary mode remains supported');
	c.send({ t: 'quit' }); await wait(30);
	c = await connection(sid, PROTO); await c.until(m => m.t === 'lobby');
	c.send({ t: 'daily', enabled: true }); const lobby = await c.until(m => m.t === 'lobby' && m.dailySelected);
	const strangerSid = (await (await fetch(url + '/api/session')).json()).sid;
	const stranger = await connection(strangerSid, 24); stranger.send({ t: 'join', code: lobby.code, hero: 'witch' });
	await stranger.until(m => m.t === 'err' && /испытании/.test(m.msg));
	assert.ok(!stranger.messages.some(m => m.t === 'lobby' && m.code === lobby.code));
	c.send({ t: 'start' }); await c.until(m => m.t === 'start' && m.daily);
	const old = await connection(sid, 24); await old.until(m => m.t === 'err'); await wait(100);
	assert.equal(old.ws.readyState, WebSocket.CLOSED);
	assert.deepEqual(old.messages.filter(m => !['welcome', 'err'].includes(m.t)), [], 'no over, accepted pick, choices or FX reaches an unupdated client');
	// An old progress handler has no run/FX input on which it could persist a duo or achievement.
	const oldProgress = new Set();
	for (const msg of old.messages) for (const fx of msg.fx ?? []) if (fx[0] === 'duo') oldProgress.add(fx[2]);
	assert.equal(oldProgress.size, 0);
});
