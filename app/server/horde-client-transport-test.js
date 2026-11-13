import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { Hub } from './game.js';
import { HORDE_PACKS } from '../public/shared/horde-content.js';

const source = (name) => fs.readFileSync(new URL('../public/js/' + name, import.meta.url), 'utf8')
	.replaceAll("'/shared/", "'" + new URL('../public/shared/', import.meta.url).href);
const moduleUrl = (text) => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const { Net } = await import(moduleUrl(source('net.js').replace("'./snapshot-codec.js'", JSON.stringify(new URL('../public/js/snapshot-codec.js', import.meta.url).href))));
const { HordeUI } = await import(moduleUrl(source('horde-ui.js').replace("import { P } from './game.js';", 'const P = { st: 8, x: 1, y: 2 };')
	.replace("import { fmtTime } from './ui.js';", 'const fmtTime = String;')));

function transport() {
	return Object.assign(Object.create(Net.prototype), { sid: 'client-transport-test', connected: true, transport: 'SSE', outbox: [], posting: null,
		attempt: 1, handlers: new Map(), failedAttempts: 0, reconnectTimer: 0 });
}
function controls(net, roundId = 'round-1') {
	return Object.assign(Object.create(HordeUI.prototype), { net, game: { running: true, roundId, isDirector: () => true }, enabled: true,
		ready: true, state: { roundId, lastSeq: 0 }, inflight: null, paint() {}, cancelPointer() {} });
}
function retry(ui) { ui.inflight.sentAt -= 4000; ui.retryPending(); }
const settle = () => new Promise((resolve) => queueMicrotask(resolve));

test('a lost SSE POST retries the identical round, sequence and payload until private acknowledgement', async (t) => {
	const net = transport(), ui = controls(net), delivered = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => { delivered.push(JSON.parse(options.body)); if (delivered.length === 1) throw Error('lost request'); return new Response('ok'); });
	ui.command('pick', { offerId: 'offer-1', choice: 2 }); await settle(); await settle();
	const pending = ui.inflight;
	ui.receive({ t: 'horde', roundId: 'round-1', lastSeq: 0 });
	assert.equal(ui.inflight, pending, 'ordinary private frames must retain an unacknowledged command');
	assert.equal(ui.canCommand(), false);
	retry(ui); await settle(); await settle();
	assert.equal(delivered.length, 2);
	assert.deepEqual(delivered[1], delivered[0]);
	assert.equal(delivered[0].roundId, 'round-1');
	ui.denied();
	assert.equal(ui.inflight, pending, 'an unrelated error is not a command acknowledgement');
	ui.receive({ t: 'horde', roundId: 'round-1', lastSeq: 1 });
	assert.equal(ui.inflight, null); assert.equal(ui.canCommand(), true);
});

test('lost response and lost SSE acknowledgement recover without paying for a troop twice', async (t) => {
	let ui; let hideAck = true;
	const hub = new Hub((pid, msg) => { if (!hideAck && pid === 1 && msg.t === 'horde') ui.receive(msg); });
	hub.addPlayer(1, 'Director'); hub.addPlayer(2, 'Hero');
	hub.handle(1, { t: 'create', ruleset: 'horde', hero: 'ranger' });
	const room = hub.players.get(1).room;
	hub.handle(2, { t: 'join', code: room.code, hero: 'ranger' }); hub.handle(1, { t: 'start' });
	const roundId = room.horde.roundId || room.horde.offerPrefix;
	const net = transport(); ui = controls(net, roundId);
	const wallet = room.horde.resource, posts = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		const msg = JSON.parse(options.body); posts.push(msg); hub.handle(1, msg);
		if (posts.length === 1) throw Error('response lost after server accepted');
		return new Response('ok');
	});
	ui.command('spawn', { pack: 'swarm', x: 1100, y: 0 }); await settle(); await settle();
	assert.equal(room.horde.resource, wallet - HORDE_PACKS.swarm.cost);
	assert.ok(ui.inflight);
	hideAck = false; retry(ui); await settle(); await settle();
	assert.deepEqual(posts[1], posts[0]);
	assert.equal(room.horde.resource, wallet - HORDE_PACKS.swarm.cost);
	assert.equal(room.horde.pending.length, 1);
	assert.equal(ui.inflight, null, 'the duplicate command obtains a fresh authoritative ack');
});

test('HTTP failure is reported, while ordinary PvE commands are never replayed', async (t) => {
	const net = transport(), errors = []; let calls = 0;
	net.on('send-error', (msg) => errors.push(msg));
	t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('no', { status: 503 }); });
	net.outbox.push({ t: 'reroll', offerEpoch: 1 }); await net.flush(); await settle();
	assert.equal(errors.length, 1); assert.equal(calls, 1); assert.equal(net.outbox.length, 0);
});

test('a stalled POST response body is aborted within the timeout, allowing queued POSTs to proceed', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const net = transport(); let aborted = false, resolveBody, calls = 0;
	t.mock.method(globalThis, 'fetch', async (url, options) => {
		calls++;
		if (calls > 1) return new Response('ok');
		options.signal?.addEventListener('abort', () => { aborted = true; resolveBody?.(); });
		return { ok: true, text: () => new Promise((resolve) => { resolveBody = resolve; }) };
	});
	net.outbox.push({ t: 'horde', roundId: 'old', seq: 1 }); const request = net.flush(); await settle();
	net.send({ t: 'ping' }); t.mock.timers.tick(5000); await settle();
	assert.equal(aborted, true, 'timeout must also bound reading the response body');
	resolveBody?.(); await request; await settle();
	assert.equal(calls, 2);
});

test('disconnect cancels active and queued POSTs; a late completion cannot release a newer request', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const net = transport(); let oldSignal, finishOld, finishNew;
	t.mock.method(globalThis, 'fetch', (url, options) => new Promise((resolve) => {
		if (!oldSignal) { oldSignal = options.signal; finishOld = () => resolve(new Response('ok')); }
		else finishNew = () => resolve(new Response('ok'));
	}));
	net.outbox.push({ t: 'horde', roundId: 'old', seq: 1 }); const oldRequest = net.flush();
	net.outbox.push({ t: 'horde', roundId: 'old', seq: 2 }); net.onDisconnected(true);
	assert.equal(oldSignal?.aborted, true); assert.equal(net.outbox.length, 0);
	net.connected = true; net.attempt++; net.outbox.push({ t: 'ping' }); const nextRequest = net.flush(), active = net.posting;
	finishOld(); await oldRequest;
	assert.equal(net.posting, active, 'stale request finalization must not clear a newer POST');
	finishNew(); await nextRequest;
});

test('fresh private state is required after reconnect and old-round frames cannot acknowledge new commands', () => {
	const sent = [], net = { connected: true, send: (msg) => sent.push(msg) }, ui = controls(net);
	ui.command('reroll', { offerId: 'old-offer' }); ui.connection();
	assert.equal(ui.inflight, null); assert.equal(ui.canCommand(), false);
	ui.game.roundId = 'round-2'; ui.state = null;
	ui.receive({ t: 'horde', roundId: 'round-1', lastSeq: 10 });
	assert.equal(ui.ready, false);
	ui.receive({ t: 'horde', roundId: 'round-2', lastSeq: 0 });
	ui.command('pick', { offerId: 'new-offer', choice: 0 });
	ui.receive({ t: 'horde', roundId: 'round-1', lastSeq: 1 });
	assert.ok(ui.inflight); assert.equal(sent.at(-1).roundId, 'round-2');
	assert.notEqual(sent.at(-1).offerId, sent[0].offerId);
});
