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
	let retry = false, gateAccess = false, releaseAccess;
	const calls = [];
	const fixture = createServer(async (req, res) => {
		let body = ''; for await (const chunk of req) body += chunk;
		let data = {};
		if (req.url.endsWith('/access') && gateAccess) { gateAccess = false; await new Promise((resolve) => { releaseAccess = resolve; }); }
		if (req.url === '/v1/me') data = { owner: { userId: '900', name: 'Владелец' } };
		else if (req.url.endsWith('/access')) data = { users: [{ userId: '101', userName: 'Хост' }, { userId: '102', userName: 'Борис' }, { userId: '103', userName: 'Вера' }, ...Array.from({ length: 120 }, (_, i) => ({ userId: String(1000 + i), userName: 'Ёж ' + i }))] };
		else if (req.url === '/v1/infra/servers/fixture') data = { accessPolicy: 'NAMED_USERS' };
		else if (req.url === '/v1/notifications') {
			data = JSON.parse(body); calls.push(data);
			if (data.userId === 1000) { req.socket.destroy(); return; }
			if (data.userId === 103 && !retry) { res.writeHead(422, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code: 'NOTIFICATION_NOT_DELIVERED' } })); return; }
			data = { notificationId: calls.length };
		}
		res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data }));
	});
	fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
	const dir = mkdtempSync(join(tmpdir(), 'horde-invites-'));
	const base = 'http://127.0.0.1:34381';
	const child = spawn(process.execPath, ['--import', runtime, '--import', new URL('../../pm/lobby-platform-fixture.mjs', import.meta.url).pathname, new URL('./server.js', import.meta.url).pathname], {
		env: { ...process.env, PORT: '34381', HORDE_RUNS_DIR: dir, VIBE_APP_KEY: 'local-fixture-key', HORDE_VIBE_SERVER_ID: 'fixture', HORDE_APP_ORIGIN: 'https://game.example', HORDE_TEST_PLATFORM_URL: `http://127.0.0.1:${fixture.address().port}` }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
	});
	const exited = once(child, 'exit'); let ws, guest, racingHost, staleHost;
	t.after(async () => { ws?.terminate(); guest?.terminate(); racingHost?.terminate(); staleHost?.terminate(); child.kill(); await exited; await new Promise((r) => fixture.close(r)); rmSync(dir, { recursive: true, force: true }); });
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
	const link = new URL(calls[0].message.match(/\[URL=([^\]]+)\]/)[1]);
	const invitedCode = link.searchParams.get('room');
	const guestHeaders = { ...headers, 'X-Vibe-User-Id': '102' };
	const guestSid = (await (await fetch(base + '/api/session', { headers: guestHeaders })).json()).sid;
	guest = new WebSocket(base.replace('http', 'ws') + `/ws?sid=${guestSid}&v=${PROTO}`, { headers: guestHeaders });
	const guestMessages = []; guest.on('message', (raw) => guestMessages.push(JSON.parse(raw)));
	await once(guest, 'open'); guest.send(JSON.stringify({ t: 'join', code: invitedCode, hero: 'knight' }));
	for (let i = 0; i < 50 && !guestMessages.some((m) => m.t === 'lobby'); i++) await delay(10);
	assert.equal(guestMessages.findLast((m) => m.t === 'lobby').code, code);
	assert.equal(guestMessages.findLast((m) => m.t === 'lobby').startsAt, first.body.startsAt);

	assert.equal((await get()).delivery.failed, 1);
	retry = true;
	const second = await post({ minutes: 5, ids: ['102', '103'], startsAt: first.body.startsAt });
	assert.equal(second.body.sent, 2); assert.equal(second.body.failed, 0);
	assert.deepEqual(calls.slice(0, 2).map((x) => x.userId).sort(), [102, 103]);
	assert.deepEqual(calls.slice(2).map((x) => x.userId), [103]);
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
	// A retry awaiting the platform access list must not survive WS cancellation/restart.
	const raceHeaders = { ...headers, 'X-Vibe-User-Id': '105' };
	const raceSid = (await (await fetch(base + '/api/session', { headers: raceHeaders })).json()).sid;
	racingHost = new WebSocket(base.replace('http', 'ws') + `/ws?sid=${raceSid}&v=${PROTO}`, { headers: raceHeaders });
	const raceMessages = []; racingHost.on('message', (raw) => raceMessages.push(JSON.parse(raw)));
	await once(racingHost, 'open'); racingHost.send(JSON.stringify({ t: 'create', hero: 'knight' }));
	for (let i = 0; i < 50 && !raceMessages.some((m) => m.t === 'lobby'); i++) await delay(10);
	const raceCode = raceMessages.findLast((m) => m.t === 'lobby').code;
	const racePost = async (data) => { const response = await fetch(base + `/api/lobby/invites?sid=${raceSid}&room=${raceCode}`, { method: 'POST', headers: { ...raceHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: response.status, body: await response.json() }; };
	retry = false;
	const raceFirst = await racePost({ minutes: 5, ids: ['102', '103'] });
	assert.equal(raceFirst.body.failed, 1);
	const callsBeforeRace = calls.length;
	gateAccess = true;
	const pendingRetry = racePost({ minutes: 5, ids: ['103'], startsAt: raceFirst.body.startsAt });
	for (let i = 0; i < 100 && !releaseAccess; i++) await delay(5);
	assert.ok(releaseAccess, 'retry is blocked in actual HTTP access lookup');
	racingHost.send(JSON.stringify({ t: 'cancel-start' }));
	for (let i = 0; i < 100 && raceMessages.findLast((m) => m.t === 'lobby').startsAt !== null; i++) await delay(5);
	assert.equal(raceMessages.findLast((m) => m.t === 'lobby').startsAt, null);
	const pendingRestart = racePost({ minutes: 1, ids: [] });
	releaseAccess(); releaseAccess = null;
	const cancelledRetry = await pendingRetry;
	assert.equal(cancelledRetry.status, 409, 'stale retry is rejected after cancellation, never sent with null/restarted deadline');
	const raceRestart = await pendingRestart;
	assert.equal(raceRestart.status, 200); assert.equal(raceRestart.body.active, true);
	assert.notEqual(raceRestart.body.startsAt, raceFirst.body.startsAt);
	assert.equal(calls.length, callsBeforeRace, 'no stale notification is emitted');
	racingHost.send(JSON.stringify({ t: 'cancel-start' }));

	// An explicit retry token stays a retry after cancellation and after the cooldown expires.
	const staleHeaders = { ...headers, 'X-Vibe-User-Id': '106' };
	const staleSid = (await (await fetch(base + '/api/session', { headers: staleHeaders })).json()).sid;
	staleHost = new WebSocket(base.replace('http', 'ws') + `/ws?sid=${staleSid}&v=${PROTO}`, { headers: staleHeaders });
	const staleMessages = []; staleHost.on('message', (raw) => staleMessages.push(JSON.parse(raw)));
	await once(staleHost, 'open'); staleHost.send(JSON.stringify({ t: 'create', hero: 'knight' }));
	for (let i = 0; i < 50 && !staleMessages.some((m) => m.t === 'lobby'); i++) await delay(10);
	const staleCode = staleMessages.findLast((m) => m.t === 'lobby').code;
	const staleRoute = base + `/api/lobby/invites?sid=${staleSid}&room=${staleCode}`;
	const stalePost = async (data) => { const response = await fetch(staleRoute, { method: 'POST', headers: { ...staleHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: response.status, body: await response.json() }; };
	retry = false;
	const staleFirst = await stalePost({ minutes: 5, ids: ['103', '1000'] });
	assert.equal(staleFirst.body.failed, 1); assert.equal(staleFirst.body.unknown, 1);
	retry = true;
	const acceptedRetry = await stalePost({ minutes: 5, ids: ['103'], startsAt: staleFirst.body.startsAt });
	assert.equal(acceptedRetry.body.sent, 1); assert.equal(acceptedRetry.body.unknown, 1);
	const clockAdvanced = once(child, 'message'); child.send({ t: 'advance-test-clock', ms: 16000 }); await clockAdvanced;
	staleHost.send(JSON.stringify({ t: 'cancel-start' }));
	for (let i = 0; i < 100 && staleMessages.findLast((m) => m.t === 'lobby').startsAt !== null; i++) await delay(5);
	assert.equal(staleMessages.findLast((m) => m.t === 'lobby').startsAt, null);
	const callsBeforeStale = calls.length;
	const obsolete = await stalePost({ minutes: 5, ids: ['103', '1000'], startsAt: staleFirst.body.startsAt });
	assert.equal(obsolete.status, 409, 'cancelled batch identity cannot become a new batch after cooldown');
	assert.equal(calls.length, callsBeforeStale, 'neither known success nor unknown outcome is resent');

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
			assert.deepEqual(calls.slice(countBefore, countBefore + 2).map((x) => x.userId).sort(), [102, 103]);
			assert.deepEqual(calls.slice(countBefore + 2).map((x) => x.userId), [103]);
			await page.locator('#lobby-cancel-start').click();
			await page.waitForFunction(() => document.querySelector('#lobby-countdown').hidden);
			// Hold an actual partial POST response from room A, then enter a different room B.
			let releaseResponse, responseHeld;
			const held = new Promise((resolve) => { responseHeld = resolve; });
			await page.route('**/api/lobby/invites?**', async (route) => {
				if (route.request().method() !== 'POST') return route.continue();
				const response = await route.fetch();
				responseHeld(); await new Promise((resolve) => { releaseResponse = resolve; });
				await route.fulfill({ response });
			});
			await page.locator('#lobby-invite').click();
			await page.locator('#lobby-invite-search').fill('Вера');
			await page.locator('#lobby-invite-list input').check();
			retry = false;
			await page.locator('#lobby-invite-form [type=submit]').click(); await held;
			const oldCode = await page.locator('#lobby-code').textContent();
			await page.locator('#lobby-invite-dialog header button').click();
			await page.locator('#lobby-leave').click();
			await page.locator('#menu-create').click();
			await page.waitForFunction((old) => document.querySelector('#lobby-code').textContent !== old, oldCode);
			releaseResponse(); await page.unrouteAll({ behavior: 'wait' });
			assert.equal(await page.locator('#lobby-invite-dialog').evaluate((e) => e.open), false, 'delayed room A partial response cannot reopen over room B');
			await page.locator('#lobby-invite').click();
			await page.locator('#lobby-invite-fields').waitFor({ state: 'visible' });
			await page.waitForFunction(() => !document.querySelector('#lobby-invite-fields').disabled);
			assert.equal(await page.locator('#lobby-invite-status').textContent(), '', 'new room does not inherit old delivery errors or retry state');

		} finally { await browser.close(); }
	}

});
