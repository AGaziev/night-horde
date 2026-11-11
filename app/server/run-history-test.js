import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { Hub } from './game.js';
import { RunStore, runStore } from './runlog.js';

function tempDir(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horde-history-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function fixture(i) {
	return {
		id: 'Z' + String(i).padStart(5, '0'), at: new Date(1_800_000_000_000 + i * 1000).toISOString(),
		v: 'v29', win: false, time: 45, team: [{ name: 'Аня', hero: 'witch', level: 1 }],
		summary: ['Сводка забега ' + i],
	};
}

test('листы истории ограничены 20 записями и фильтруются по участнику среди 500 сохранённых забегов', (t) => {
	const dir = tempDir(t);
	const archive = new RunStore();
	archive.persist(dir);
	for (let i = 1; i <= 501; i++) archive.add(fixture(i), i <= 100 ? ['111'] : ['222']);

	const restored = new RunStore();
	restored.persist(dir);
	assert.equal(fs.readdirSync(dir).length, 500);
	assert.equal(restored.get('Z00001'), null);
	assert.deepEqual(restored.get('Z00002'), fixture(2));
	assert.equal(restored.list().length, 30);
	const history = restored.history('111');
	assert.deepEqual(history.mine.map(({ id }) => id), Array.from({ length: 20 }, (_, i) => 'Z00' + String(100 - i).padStart(3, '0')));
	assert.deepEqual(history.recent.map(({ id }) => id), Array.from({ length: 20 }, (_, i) => 'Z00' + (501 - i)));
	assert.deepEqual(restored.history(null).mine, []);
});

test('при первом запуске старые логи переходят в общую историю и остаются после удаления временной папки', (t) => {
	const root = tempDir(t);
	const legacy = path.join(root, 'old');
	const dir = path.join(root, 'new');
	fs.mkdirSync(legacy);
	const old = fixture(1);
	fs.writeFileSync(path.join(legacy, old.id + '.json'), JSON.stringify(old));
	fs.writeFileSync(path.join(legacy, 'BAD000.json'), '{');
	const archive = new RunStore();
	archive.persist(dir, legacy);
	fs.rmSync(legacy, { recursive: true });
	const restored = new RunStore();
	restored.persist(dir);
	assert.deepEqual(restored.get(old.id), old);
	assert.equal(restored.history('111').recent[0].id, old.id);
	assert.deepEqual(restored.history('111').mine, []);
});

test('завершённый забег сохраняет участников по ID, а HTTP и игровые сообщения не раскрывают ID', async (t) => {
	const dir = tempDir(t);
	runStore.persist(dir);
	const messages = [];
	const hub = new Hub((pid, msg) => messages.push(msg));
	hub.addPlayer(1, 'Аня', '12345678');
	hub.addPlayer(2, 'Аня', '87654321');
	hub.handle(1, { t: 'create', hero: 'witch', mode: 'lunch' });
	const room = hub.players.get(1).room;
	hub.handle(2, { t: 'join', code: room.code, hero: 'ranger' });
	room.start();
	hub.handle(2, { t: 'leave' });
	room.time = 91;
	room.finish(false);
	const log = room.lastLog;
	assert.doesNotMatch(JSON.stringify(messages), /12345678|87654321/);

	const port = 10_000 + Math.floor(Math.random() * 10_000);
	const server = spawn(process.execPath, [new URL('./server.js', import.meta.url).pathname], {
		env: { ...process.env, PORT: String(port), HORDE_RUNS_DIR: dir, VIBE_APP_KEY: '' }, stdio: 'ignore',
	});
	const closed = once(server, 'exit');
	t.after(async () => { server.kill(); await closed; });
	const request = (route, uid) => fetch('http://127.0.0.1:' + port + route, {
		headers: uid ? { 'X-Vibe-User-Id': uid } : {},
	});
	let ready = false;
	for (let i = 0; i < 50 && !ready; i++) {
		ready = await request('/health').then((r) => r.ok, () => false);
		if (!ready) await setTimeout(50);
	}
	assert.ok(ready, 'сервер запустился с архивом из предыдущего процесса');
	const history = async (uid, query = '') => {
		const res = await request('/api/runs/history' + query, uid);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('cache-control'), 'no-store');
		const text = await res.text();
		assert.doesNotMatch(text, /12345678|87654321/);
		return JSON.parse(text);
	};
	for (const uid of ['12345678', '87654321']) {
		const rows = await history(uid);
		assert.equal(rows.personal, true);
		assert.deepEqual(rows.mine, rows.recent);
		assert.deepEqual(rows.mine[0], {
			id: log.id, at: log.at, v: log.v, mode: 'lunch', win: false, grade: 0, time: 91,
			players: [{ name: 'Аня', hero: 'witch', level: 1 }],
		});
	}
	const other = await history('11111111', '?uid=12345678');
	assert.equal(other.personal, true);
	assert.deepEqual(other.mine, []);
	for (const uid of [null, 'user-12345678']) {
		const guest = await history(uid);
		assert.equal(guest.personal, false);
		assert.deepEqual(guest.mine, []);
		assert.equal(guest.recent[0].id, log.id);
	}
	assert.deepEqual(await (await request('/api/runs/' + log.id)).json(), JSON.parse(JSON.stringify(log)));
	assert.equal(await (await request('/api/runs/' + log.id.toLowerCase() + '.summary')).text(), log.summary.join('\n'));
	assert.equal((await request('/api/runs/MISS00.summary')).status, 404);
});
