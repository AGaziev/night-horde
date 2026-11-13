import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { PROTO } from './snapshot-codec.js';

const runtime = new URL('../../pm/test-runtime.mjs', import.meta.url).pathname;
test('HTTP: состав, владелец, частичная доставка и безопасный повтор, ссылка, отмена и рестарт', async (t) => {
	let retry = false;
	const calls = [];
	const fixture = createServer(async (req, res) => {
		let body = ''; for await (const chunk of req) body += chunk;
		let data = {};
		if (req.url === '/v1/me') data = { owner: { userId: '900', name: 'Владелец' } };
		else if (req.url.endsWith('/access')) data = { users: [{ userId: '101', userName: 'Хост' }, { userId: '102', userName: 'Борис' }, { userId: '103', userName: 'Вера' }, ...Array.from({ length: 120 }, (_, i) => ({ userId: String(1000 + i), userName: 'Ёж ' + i }))] };
		else if (req.url === '/v1/infra/servers/fixture') data = { accessPolicy: 'NAMED_USERS' };
		else if (req.url === '/v1/notifications') {
			data = JSON.parse(body); calls.push(data);
			if (data.userId === 103 && !retry) { res.writeHead(422, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code: 'NOTIFICATION_NOT_DELIVERED' } })); return; }
			data = { notificationId: calls.length };
		}
		res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data }));
	});
	fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
	const dir = mkdtempSync(join(tmpdir(), 'horde-invites-'));
	const base = 'http://127.0.0.1:34381';
	const child = spawn(process.execPath, ['--import', runtime, '--import', new URL('../../pm/lobby-platform-fixture.mjs', import.meta.url).pathname, new URL('./server.js', import.meta.url).pathname], {
		env: { ...process.env, PORT: '34381', HORDE_RUNS_DIR: dir, VIBE_APP_KEY: 'local-fixture-key', HORDE_VIBE_SERVER_ID: 'fixture', HORDE_APP_ORIGIN: 'https://game.example', HORDE_TEST_PLATFORM_URL: `http://127.0.0.1:${fixture.address().port}` }, stdio: 'ignore',
	});
	const exited = once(child, 'exit'); let ws;
	t.after(async () => { ws?.terminate(); child.kill(); await exited; await new Promise((r) => fixture.close(r)); rmSync(dir, { recursive: true, force: true }); });
	for (let i = 0; i < 70; i++) { if (await fetch(base + '/health').then((r) => r.ok, () => false)) break; await delay(40); }
	const headers = { 'X-Vibe-User-Id': '101', 'X-Vibe-User-Name': encodeURIComponent('Хост'), 'X-Vibe-Authorization': 'Bearer vibe_session_fixture' };
	const { sid } = await (await fetch(base + '/api/session', { headers })).json();
	ws = new WebSocket(base.replace('http', 'ws') + `/ws?sid=${sid}&v=${PROTO}`, { headers });
	const messages = []; ws.on('message', (raw) => messages.push(JSON.parse(raw)));
	await once(ws, 'open'); ws.send(JSON.stringify({ t: 'create', hero: 'knight' }));
	for (let i = 0; i < 50 && !messages.some((m) => m.t === 'lobby'); i++) await delay(10);
	const code = messages.findLast((m) => m.t === 'lobby').code;
	const route = base + `/api/lobby/invites?sid=${sid}&room=${code}`;
	const get = async () => (await fetch(route, { headers })).json();
	const post = async (data) => { const res = await fetch(route, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: res.status, body: await res.json() }; };
	const list = await get(); assert.equal(list.employees.length, 123); assert.equal(list.slots, 7);
	assert.ok(list.employees.some((e) => e.id === '900')); assert.ok(!list.employees.some((e) => e.id === '101'));
	assert.equal((await post({ minutes: 5, ids: ['999'] })).status, 409);
	const first = await post({ minutes: 5, ids: ['102', '103'] });
	assert.equal(first.status, 200); assert.equal(first.body.sent, 1); assert.equal(first.body.failed, 1); assert.equal(first.body.active, true);
	assert.ok(calls[0].message.includes(`https://game.example/?room=${code}`));
	assert.equal((await get()).delivery.failed, 1);
	retry = true;
	const second = await post({ minutes: 5, ids: ['102', '103'], startsAt: first.body.startsAt });
	assert.equal(second.body.sent, 2); assert.equal(second.body.failed, 0);
	assert.deepEqual(calls.map((x) => x.userId), [102, 103, 103]);
	await post({ minutes: 5, ids: ['102', '103'], startsAt: first.body.startsAt });
	assert.equal(calls.length, 3);
	ws.send(JSON.stringify({ t: 'cancel-start' })); await delay(30); assert.equal((await get()).startsAt, null);
	const restart = await post({ minutes: 1, ids: [] }); assert.equal(restart.status, 200); assert.equal(restart.body.active, true);
	assert.notEqual(restart.body.startsAt, first.body.startsAt);
	ws.send(JSON.stringify({ t: 'cancel-start' })); await delay(30); assert.equal((await get()).startsAt, null);
	ws.send(JSON.stringify({ t: 'start' }));
	for (let i = 0; i < 50 && !messages.some((m) => m.t === 'start'); i++) await delay(10);
	assert.ok(messages.some((m) => m.t === 'start'));
	assert.equal((await fetch(route, { headers })).status, 403, 'started room is no longer an invitation lobby');
	if (process.env.HORDE_BROWSER_CHECK === '1') {
		const { chromium } = await import('/Users/s.konev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
		const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
		try {
			const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { ...headers, 'X-Vibe-User-Id': '104' } });
			await page.goto(base); await page.locator('#menu-create').click();
			await page.locator('#lobby-invite').click();
			await page.locator('#lobby-invite-search').fill('еж 119');
			await page.locator('#lobby-invite-list').getByText('Ёж 119').waitFor();
			await page.locator('#lobby-invite-search').fill('Владелец');
			await page.locator('#lobby-invite-list').getByText('Владелец').waitFor();
			await page.locator('#lobby-invite-search').fill('Борис');
			await page.locator('#lobby-invite-list input').check();
			await page.locator('#lobby-invite-search').fill('Вера');
			await page.locator('#lobby-invite-list input').check();
			await page.locator('#lobby-invite-search').fill('');
			retry = false; const countBefore = calls.length;
			await page.locator('#lobby-invite-form [type=submit]').click();
			await page.waitForFunction(() => document.querySelector('#lobby-invite-status').textContent.includes('Уведомление не создано'));
			assert.equal(await page.locator('#lobby-invite-dialog').evaluate((e) => e.open), true);
			if (process.env.HORDE_BROWSER_ARTIFACT) await page.screenshot({ path: process.env.HORDE_BROWSER_ARTIFACT });
			retry = true;
			await page.locator('#lobby-invite-form [type=submit]').click();
			await page.waitForFunction(() => !document.querySelector('#lobby-invite-dialog').open);
			assert.deepEqual(calls.slice(countBefore).map((x) => x.userId), [102, 103, 103]);
			await page.locator('#lobby-cancel-start').click();
			await page.waitForFunction(() => document.querySelector('#lobby-countdown').hidden);
		} finally { await browser.close(); }
	}

});
