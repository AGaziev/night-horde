import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';

test('отзывы принимают короткую оценку или комментарий, переживают рестарт и читаются только администратором', async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horde-feedback-'));
	const port = 20_000 + Math.floor(Math.random() * 10_000);
	const url = 'http://127.0.0.1:' + port;
	const admin = {
		'X-Vibe-User-Id': '7654321', 'X-Vibe-User-Role': 'ADMIN',
		'X-Vibe-Authorization': 'Bearer vibe_session_' + 'x'.repeat(43),
	};
	let stop = async () => {};
	t.after(async () => {
		await stop();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	async function start() {
		const child = spawn(process.execPath, [new URL('./server.js', import.meta.url).pathname], {
			env: { ...process.env, PORT: String(port), HORDE_RUNS_DIR: dir, VIBE_APP_KEY: '' }, stdio: 'ignore',
		});
		const exited = once(child, 'exit');
		stop = async () => { child.kill(); await exited; };
		for (let i = 0; i < 50; i++) {
			if (await fetch(url + '/health').then((r) => r.ok, () => false)) return;
			await setTimeout(50);
		}
		assert.fail('сервер не запустился');
	}
	const session = async () => (await (await fetch(url + '/api/session')).json()).sid;
	const post = (body) => fetch(url + '/api/feedback', {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
	});
	await start();
	const sid = await session();
	assert.equal((await post({ sid, rating: 'hard', comment: '' })).status, 201);
	assert.equal((await post({ sid, rating: 'easy' })).status, 429);
	const sid2 = await session();
	assert.equal((await post({ sid: sid2, comment: '  Дайте цвет стрелкам.  ', runId: 'MISSING' })).status, 201);
	const sid3 = await session();
	assert.equal((await post({ sid: sid3, comment: '   ' })).status, 400);
	assert.equal((await post({ sid: sid3, rating: 'broken' })).status, 400);
	assert.equal((await post({ sid: sid3, comment: 'a'.repeat(1001) })).status, 400);
	assert.equal((await post({ sid: sid3, comment: 'a'.repeat(10_000) })).status, 413);
	assert.equal((await post({ comment: 'без сессии' })).status, 401);
	assert.equal((await fetch(url + '/api/feedback')).status, 403);
	assert.equal((await fetch(url + '/api/feedback', { headers: { 'X-Vibe-User-Role': 'ADMIN' } })).status, 403);
	assert.equal((await fetch(url + '/api/feedback', { headers: { ...admin, 'X-Vibe-Authorization': '' } })).status, 403);
	assert.equal((await fetch(url + '/api/feedback', { headers: { ...admin, 'X-Vibe-User-Role': 'MEMBER' } })).status, 403);
	await stop();
	await start();
	const response = await fetch(url + '/api/feedback', { headers: admin });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	const { feedback } = await response.json();
	assert.deepEqual(feedback.map(({ rating, comment, runId }) => ({ rating, comment, runId })), [
		{ rating: null, comment: 'Дайте цвет стрелкам.', runId: null },
		{ rating: 'hard', comment: '', runId: null },
	]);
	assert.ok(feedback.every((row) => row.v === 'v33' && Number.isFinite(Date.parse(row.at))));
	assert.ok(feedback.every((row) => !('sid' in row) && !('uid' in row)));
});
