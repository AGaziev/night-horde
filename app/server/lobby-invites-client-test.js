import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
const source = fs.readFileSync(new URL('../public/js/lobby-invites.js', import.meta.url), 'utf8').replace("import { fmtTime } from './ui.js';", "const fmtTime = () => '';");
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
	const old = { document: globalThis.document, fetch: globalThis.fetch, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
	const ids = ['lobby-invite','lobby-invite-dialog','lobby-invite-form','lobby-invite-fields','lobby-invite-list','lobby-invite-search','lobby-invite-search-field','lobby-invite-status','lobby-invite-count','lobby-countdown','lobby-countdown-time','lobby-cancel-start','lobby-start'];
	const dom = Object.fromEntries(ids.map((id) => [id, new Element()]));
	const form = dom['lobby-invite-form']; form.elements = { minutes: { value: '5' } }; form.submit = new Element();
	globalThis.document = { getElementById: (id) => dom[id], createElement: () => new Element(), createTextNode: (textContent) => ({ textContent }) };
	globalThis.setInterval = () => 0; globalThis.clearInterval = () => {};
	const requests = [], toasts = [];
	globalThis.fetch = (url, options = {}) => new Promise((resolve) => requests.push({ url, options, resolve: (data) => resolve(Response.json(data)) }));
	const ui = setupLobbyInvites({ sid: 'test', invites: true, send() {} }, (msg) => toasts.push(msg));
	const lobby = (code, host = 1) => ({ code, host, startsAt: null, serverNow: 0 });
	async function open(code, host = 1, me = 1) {
		ui.update(lobby(code, host), me);
		const pending = dom['lobby-invite'].emit('click');
		assert.equal(requests.at(-1).options.method, undefined, 'opening the current room loads its employees');
		requests.at(-1).resolve({ employees: [{ id: '2', name: 'Two' }], slots: 7, startsAt: null }); await pending;
		const checkbox = dom['lobby-invite-list'].querySelectorAll()[0]; checkbox.checked = true; checkbox.emit('change');
	}
	return { dom, ui, lobby, open, requests, toasts, restore() { Object.assign(globalThis, old); } };
}
const partial = { active: true, startsAt: 300000, sent: 0, failed: 1, unknown: 0, recipients: [{ id: '2', status: 'failed', error: 'Undelivered' }] };
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
		newRequest.resolve({ active: true, startsAt: 400000, sent: 1, failed: 0, unknown: 0, recipients: [{ id: '2', status: 'sent' }] }); await current;
		assert.equal(f.dom['lobby-invite-dialog'].open, false);
		assert.equal(f.toasts.length, 1);
	} finally { f.restore(); }
});
