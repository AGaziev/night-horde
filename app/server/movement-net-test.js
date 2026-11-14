import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
const source = fs.readFileSync(new URL('../public/js/net.js', import.meta.url), 'utf8').replace("'./snapshot-codec.js'", JSON.stringify(new URL('../public/js/snapshot-codec.js', import.meta.url).href));
const { Net } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('discarding paused SSE prediction preserves queued non-position commands and their order', async () => {
	const net = Object.create(Net.prototype), originalFetch = globalThis.fetch, sent = [];
	const pause = { t: 'pause', v: false }, pick = { t: 'pick', i: 1 };
	net.sid = 'local'; net.posting = false;
	net.outbox = [{ t: 'pos', seq: 1, x: 100 }, pause, { t: 'pos', seq: 2, x: 200 }, pick];
	globalThis.fetch = async (url, options) => { sent.push(JSON.parse(options.body)); return Response.json({ ok: true }); };
	try {
		net.discardPositions();
		assert.deepEqual(net.outbox, [pause, pick]);
		await net.flush();
		assert.deepEqual(sent, [[pause, pick]], 'rejected positions never reach the next POST');
		assert.deepEqual(net.outbox, []);
	} finally { globalThis.fetch = originalFetch; }
});
