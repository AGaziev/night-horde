import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
const source = fs.readFileSync(new URL('../public/js/lobby-invites.js', import.meta.url), 'utf8').replace("import { fmtTime } from './ui.js';", "const fmtTime = (seconds) => String(seconds);");
const { setupLobbyInvites } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
class Element {
	constructor() { this.events = new Map(); this.children = []; this.value = ''; this.open = false; this.disabled = false; }
	addEventListener(name, handler) { this.events.set(name, handler); }
	emit(name) { return this.events.get(name)?.({ preventDefault() {} }); }
	replaceChildren() { this.children = []; this.textContent = ''; }
	append(...nodes) { this.children.push(...nodes); }
	querySelectorAll() { return this.children.flatMap((node) => node.type === 'checkbox' ? [node] : node.children ?? []).filter((node) => node.type === 'checkbox'); }
	querySelector() { return this.submit; }
	showModal() { this.open = true; }
	close() { if (this.open) { this.open = false; this.emit('close'); } }
	get childElementCount() { return this.children.length; }
}
function fixture() {
	const old = { document: globalThis.document, fetch: globalThis.fetch, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, performance: globalThis.performance };
	let now = 0; globalThis.performance = { now: () => now };
	const ids = ['lobby-invite','lobby-invite-dialog','lobby-invite-form','lobby-invite-fields','lobby-invite-list','lobby-invite-search','lobby-invite-search-field','lobby-invite-status','lobby-invite-count','lobby-countdown','lobby-countdown-time','lobby-cancel-start','lobby-start'];
	const dom = Object.fromEntries(ids.map((id) => [id, new Element()]));
	const form = dom['lobby-invite-form']; form.elements = { minutes: { value: '5' } }; form.submit = new Element();
	globalThis.document = { getElementById: (id) => dom[id], createElement: () => new Element(), createTextNode: (textContent) => ({ textContent }) };
	globalThis.setInterval = () => 0; globalThis.clearInterval = () => {};
	const requests = [], toasts = [];
	globalThis.fetch = (url, options = {}) => new Promise((resolve) => requests.push({ url, options, resolve: (data) => resolve(Response.json(data)) }));
	const ui = setupLobbyInvites({ sid: 'test', invites: true, send() {} }, (msg) => toasts.push(msg));
	const lobby = (code, host = 1, state = {}) => ({ code, host, startsAt: null, serverNow: 0, inviteBatchId: null, inviteRevision: 0, ...state });
	async function open(code, host = 1, me = 1) {
		ui.update(lobby(code, host), me);
		const pending = dom['lobby-invite'].emit('click');
		assert.equal(requests.at(-1).options.method, undefined, 'opening the current room loads its employees');
		requests.at(-1).resolve({ employees: [{ id: '2', name: 'Two' }, { id: '3', name: 'Three' }], slots: 7, startsAt: null, batchId: null, revision: 0, serverNow: 0 }); await pending;
		for (const checkbox of dom['lobby-invite-list'].querySelectorAll()) { checkbox.checked = true; checkbox.emit('change'); }
	}
	return { dom, ui, lobby, open, requests, toasts, now: (value) => { now = value; }, restore() { Object.assign(globalThis, old); } };
}
const partial = { active: true, startsAt: 300000, batchId: 'batch-a', revision: 1, serverNow: 0, sent: 1, failed: 1, unknown: 0, recipients: [{ id: '2', status: 'failed', error: 'Undelivered' }, { id: '3', status: 'sent' }] };
for (const target of ['new host room', 'new guest room', 'changed host']) test(`stale delivery response is ignored after ${target}`, async () => {
	const f = fixture();
	try {
		await f.open('AAAA');
		const pending = f.dom['lobby-invite-form'].emit('submit'); const request = f.requests.at(-1);
		f.dom['lobby-invite-dialog'].close();
		f.ui.update(f.lobby(target === 'changed host' ? 'AAAA' : 'BBBB', target === 'new host room' ? 1 : 3), 1);
		request.resolve(partial); await pending;
		assert.equal(f.dom['lobby-invite-dialog'].open, false, 'old partial response cannot reopen the new context');
		assert.equal(f.toasts.length, 0);
		assert.equal(f.requests.length, 2, 'stale response must not start another room request');
	} finally { f.restore(); }
});
test('a previous response and finally cannot overwrite a new room request', async () => {
	const f = fixture();
	try {
		await f.open('AAAA'); const previous = f.dom['lobby-invite-form'].emit('submit'); const oldRequest = f.requests.at(-1);
		f.dom['lobby-invite-dialog'].close();
		await f.open('BBBB'); const current = f.dom['lobby-invite-form'].emit('submit'); const newRequest = f.requests.at(-1);
		assert.equal(new URL(newRequest.url, 'http://local').searchParams.get('room'), 'BBBB');
		oldRequest.resolve(partial); await previous;
		assert.equal(f.dom['lobby-invite-dialog'].open, true);
		assert.equal(f.dom['lobby-invite-fields'].disabled, true, 'old finally must not unlock the new request');
		newRequest.resolve({ active: true, startsAt: 400000, batchId: 'batch-b', revision: 1, serverNow: 0, sent: 1, failed: 0, unknown: 0, recipients: [{ id: '2', status: 'sent' }] }); await current;
		assert.equal(f.dom['lobby-invite-dialog'].open, false);
		assert.equal(f.toasts.length, 1);
	} finally { f.restore(); }
});

for (const order of ['WS-before-HTTP', 'HTTP-before-WS']) test(`${order}: own batch result stays usable and retry is bound to its nonce`, async () => {
	const f = fixture();
	try {
		await f.open('AAAA'); const post = f.dom['lobby-invite-form'].emit('submit');
		const response = f.requests.at(-1);
		const started = f.lobby('AAAA', 1, { startsAt: partial.startsAt, inviteBatchId: partial.batchId, inviteRevision: 1 });
		if (order === 'WS-before-HTTP') f.ui.update(started, 1);
		response.resolve(partial); await post;
		if (order === 'HTTP-before-WS') f.ui.update(started, 1);
		assert.equal(f.dom['lobby-invite-dialog'].open, true);
		assert.match(f.dom['lobby-invite-status'].textContent, /Undelivered/);
		const again = f.dom['lobby-invite-form'].emit('submit'), req = f.requests.at(-1), body = JSON.parse(req.options.body);
		assert.equal(body.batchId, 'batch-a'); assert.equal(body.startsAt, partial.startsAt); assert.deepEqual(body.ids, ['2']);
		req.resolve({ ...partial, failed: 0, sent: 2, recipients: partial.recipients.map(r => ({ ...r, status: 'sent' })) }); await again;
		assert.equal(f.dom['lobby-invite-dialog'].open, false);
	} finally { f.restore(); }
});
for (const replacement of ['cancelled', 'same-deadline replacement']) test(`held partial HTTP cannot overwrite ${replacement} in the same room`, async () => {
	const f = fixture();
	try {
		await f.open('AAAA'); const post = f.dom['lobby-invite-form'].emit('submit'), request = f.requests.at(-1);
		f.ui.update(f.lobby('AAAA', 1, { startsAt: partial.startsAt, inviteBatchId: 'batch-a', inviteRevision: 1 }), 1);
		f.ui.update(f.lobby('AAAA', 1, { inviteBatchId: 'batch-a', inviteRevision: 2 }), 1);
		if (replacement !== 'cancelled') f.ui.update(f.lobby('AAAA', 1, { startsAt: partial.startsAt, inviteBatchId: 'batch-b', inviteRevision: 3 }), 1);
		request.resolve(partial); await post;
		assert.doesNotMatch(f.dom['lobby-invite-status'].textContent, /Отсчёт идёт|Undelivered/, 'obsolete delivery status never replaces current state');
		assert.equal(f.dom['lobby-invite-form'].submit.disabled, true, 'old retry is unavailable');
		assert.equal(f.dom['lobby-countdown'].hidden, replacement === 'cancelled');
	} finally { f.restore(); }
});
test('reopened same-room form is not overwritten or unlocked by an old batch result', async () => {
	const f = fixture();
	try {
		await f.open('AAAA'); const oldPost = f.dom['lobby-invite-form'].emit('submit'), old = f.requests.at(-1);
		f.ui.update(f.lobby('AAAA', 1, { startsAt: partial.startsAt, inviteBatchId: 'batch-a', inviteRevision: 1 }), 1);
		f.ui.update(f.lobby('AAAA', 1, { inviteBatchId: 'batch-a', inviteRevision: 2 }), 1);
		f.ui.update(f.lobby('AAAA', 1, { startsAt: partial.startsAt, inviteBatchId: 'batch-b', inviteRevision: 3 }), 1);
		f.dom['lobby-invite-dialog'].close();
		const opened = f.dom['lobby-invite'].emit('click'); const get = f.requests.at(-1);
		assert.equal(get.options.method, undefined, 'closing obsolete pending form allows fresh readback');
		get.resolve({ employees: [{ id: '2', name: 'Two' }], slots: 7, startsAt: partial.startsAt, batchId: 'batch-b', revision: 3, serverNow: 0, delivery: { ...partial, recipients: [{ id: '2', status: 'failed', error: 'Current B failure' }] } }); await opened;
		const newPost = f.dom['lobby-invite-form'].emit('submit'), current = f.requests.at(-1);
		assert.equal(JSON.parse(current.options.body).batchId, 'batch-b');
		old.resolve(partial); await oldPost;
		assert.equal(f.dom['lobby-invite-fields'].disabled, true);
		assert.doesNotMatch(f.dom['lobby-invite-status'].textContent, /Undelivered/);
		current.resolve({ ...partial, batchId: 'batch-b', revision: 3, failed: 0, sent: 2 }); await newPost;
	} finally { f.restore(); }
});
test('normal all-failed auto-cancellation still displays delivery errors after WS cancellation', async () => {
	const f = fixture();
	try {
		await f.open('AAAA'); const post = f.dom['lobby-invite-form'].emit('submit'), request = f.requests.at(-1);
		f.ui.update(f.lobby('AAAA', 1, { startsAt: partial.startsAt, inviteBatchId: 'batch-a', inviteRevision: 1 }), 1);
		f.ui.update(f.lobby('AAAA', 1, { inviteBatchId: 'batch-a', inviteRevision: 2 }), 1);
		request.resolve({ ...partial, active: false, revision: 2, sent: 0, failed: 2, recipients: [{ id: '2', status: 'failed', error: 'Rejected Two' }, { id: '3', status: 'failed', error: 'Rejected Three' }] }); await post;
		assert.match(f.dom['lobby-invite-status'].textContent, /Отсчёт остановлен.*Rejected Two.*Rejected Three/);
		assert.equal(f.dom['lobby-countdown'].hidden, true);
		assert.equal(f.dom['lobby-invite-form'].submit.disabled, false, 'a fresh batch is possible after confirmed total rejection');
	} finally { f.restore(); }
});

test('a delayed response for the current batch never extends its already observed countdown', async () => {
	const f = fixture();
	try {
		await f.open('AAAA'); const post = f.dom['lobby-invite-form'].emit('submit'), request = f.requests.at(-1);
		f.ui.update(f.lobby('AAAA', 1, { startsAt: 300000, inviteBatchId: 'batch-a', inviteRevision: 1 }), 1);
		f.now(100000); request.resolve(partial); await post;
		assert.equal(f.dom['lobby-countdown-time'].textContent, '200', '100s elapsed while HTTP was held; no extra countdown time is invented');
	} finally { f.restore(); }
});
test('HTTP-before-WS all-failed result stays stopped when older WS start finally arrives', async () => {
	const f = fixture();
	try {
		await f.open('AAAA'); const post = f.dom['lobby-invite-form'].emit('submit'), request = f.requests.at(-1);
		request.resolve({ ...partial, active: false, revision: 2, sent: 0, failed: 2, recipients: [{ id: '2', status: 'failed', error: 'Rejected Two' }, { id: '3', status: 'failed', error: 'Rejected Three' }] }); await post;
		f.ui.update(f.lobby('AAAA', 1, { startsAt: partial.startsAt, inviteBatchId: 'batch-a', inviteRevision: 1 }), 1);
		assert.equal(f.dom['lobby-countdown'].hidden, true);
		assert.match(f.dom['lobby-invite-status'].textContent, /Отсчёт остановлен.*Rejected Two/);
		assert.equal(f.dom['lobby-invite-fields'].disabled, false);
		f.ui.update(f.lobby('AAAA', 1, { inviteBatchId: 'batch-a', inviteRevision: 2 }), 1);
		assert.equal(f.dom['lobby-invite-dialog'].open, true);
	} finally { f.restore(); }
});
