// Transport layer: WebSocket first, SSE + POST fallback, reconnect with the same sid.
import { PROTO, SnapshotDecoder } from './snapshot-codec.js';

const SID_KEY = 'nh.sid';
const WS_OPEN_TIMEOUT = 3000;
const KEY_REQUEST_MS = 300;
const RELOAD_KEY = 'nh.protoReload';
const RELOAD_GUARD_MS = 60_000;

function readSid() {
	try { return sessionStorage.getItem(SID_KEY); } catch { return null; }
}
function writeSid(sid) {
	try {
		if (sid) sessionStorage.setItem(SID_KEY, sid);
		else sessionStorage.removeItem(SID_KEY);
	} catch { /* storage unavailable */ }
}

export class Net {
	constructor() {
		this.sid = readSid();
		this.name = '';
		this.invites = false;
		this.transport = null; // 'WS' | 'SSE'
		this.forceSse = new URLSearchParams(location.search).get('transport') === 'sse';
		this.connected = false;
		this.ping = null;
		this.handlers = new Map();
		this.ws = null;
		this.es = null;
		this.outbox = [];
		this.posting = false;
		this.failedAttempts = 0;
		this.reconnectTimer = 0;
		this.attempt = 0;
		this.snapDec = new SnapshotDecoder();
		this.keyAskedAt = -Infinity;
		setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
	}

	on(type, fn) {
		if (!this.handlers.has(type)) this.handlers.set(type, []);
		this.handlers.get(type).push(fn);
	}

	emit(type, msg) {
		const list = this.handlers.get(type);
		if (list) for (const fn of list) fn(msg);
	}

	async start() {
		await this.newSession();
		this.connect();
	}

	async newSession() {
		for (;;) {
			try {
				const q = this.sid ? '?sid=' + encodeURIComponent(this.sid) : '';
				const res = await fetch('/api/session' + q, { cache: 'no-store' });
				if (!res.ok) throw new Error('HTTP ' + res.status);
				const data = await res.json();
				this.sid = data.sid;
				this.name = data.name || '';
				this.invites = data.invites === true;
				writeSid(this.sid);
				return;
			} catch {
				this.emit('status', { connected: false });
				await new Promise((r) => setTimeout(r, 1500));
			}
		}
	}

	connect() {
		clearTimeout(this.reconnectTimer);
		const id = ++this.attempt;
		if (this.forceSse) this.connectSse(id);
		else this.connectWs(id);
	}

	connectWs(id) {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		let ws;
		try {
			ws = new WebSocket(`${proto}//${location.host}/ws?sid=${encodeURIComponent(this.sid)}&v=${PROTO}`);
		} catch {
			this.fallbackToSse(id);
			return;
		}
		this.ws = ws;
		let opened = false;
		let gotMessage = false;
		const timer = setTimeout(() => {
			if (!opened) {
				ws.onclose = null;
				try { ws.close(); } catch { /* ignore */ }
				this.fallbackToSse(id);
			}
		}, WS_OPEN_TIMEOUT);

		ws.onopen = () => { opened = true; };
		ws.onmessage = (ev) => {
			if (!gotMessage) {
				gotMessage = true;
				this.onConnected('WS');
			}
			this.receive(ev.data);
		};
		ws.onclose = (ev) => {
			clearTimeout(timer);
			if (id !== this.attempt) return;
			this.ws = null;
			if (ev.code === 4001) {
				this.resetSession();
				return;
			}
			if (!gotMessage && this.transport !== 'WS') {
				this.fallbackToSse(id);
				return;
			}
			this.onDisconnected(gotMessage);
		};
		ws.onerror = () => { /* onclose follows */ };
	}

	fallbackToSse(id) {
		if (id !== this.attempt) return;
		this.forceSse = true;
		this.ws = null;
		this.connectSse(++this.attempt);
	}

	connectSse(id) {
		const es = new EventSource(`/api/events?sid=${encodeURIComponent(this.sid)}&v=${PROTO}`);
		this.es = es;
		let gotMessage = false;
		es.onmessage = (ev) => {
			if (id !== this.attempt) return;
			if (!gotMessage) {
				gotMessage = true;
				this.onConnected('SSE');
			}
			this.receive(ev.data);
		};
		es.onerror = () => {
			if (id !== this.attempt) return;
			es.close();
			this.es = null;
			this.onDisconnected(gotMessage);
		};
	}

	onConnected(transport) {
		this.snapDec.reset();
		this.transport = transport;
		this.connected = true;
		this.failedAttempts = 0;
		this.emit('status', { connected: true, transport });
	}

	onDisconnected(hadMessages) {
		this.connected = false;
		this.outbox.length = 0;
		this.emit('status', { connected: false, transport: this.transport });
		if (!hadMessages) this.failedAttempts++;
		// Several silent failures in a row usually mean the server forgot our sid.
		if (this.failedAttempts >= 3) {
			this.resetSession();
			return;
		}
		const delay = Math.min(4000, 500 + this.failedAttempts * 700);
		this.reconnectTimer = setTimeout(() => this.connect(), delay);
	}

	async resetSession() {
		this.failedAttempts = 0;
		this.sid = null;
		writeSid(null);
		await this.newSession();
		this.connect();
	}

	receive(raw) {
		let msg;
		try { msg = JSON.parse(raw); } catch { return; }
		if (!msg || typeof msg !== 'object') return;
		if (Array.isArray(msg)) {
			for (const m of msg) this.dispatch(m);
		} else {
			this.dispatch(msg);
		}
	}

	dispatch(msg) {
		if (!msg || !msg.t) return;
		if (msg.t === 's') {
			this.onSnapshot(msg);
			return;
		}
		if (msg.t === 'welcome' && msg.v !== PROTO && this.reloadForUpdate()) return;
		if (msg.t === 'pong') {
			if (typeof msg.c === 'number') this.ping = Math.round(performance.now() - msg.c);
			this.emit('ping', this.ping);
			return;
		}
		this.emit(msg.t, msg);
	}

	// Snapshots are deltas against the previous one; after a gap only the events go on until a key arrives.
	onSnapshot(msg) {
		let snap = null;
		try { snap = this.snapDec.decode(msg); } catch { this.snapDec.reset(); }
		if (snap) {
			this.emit('s', snap);
			return;
		}
		const now = performance.now();
		if (now - this.keyAskedAt > KEY_REQUEST_MS) {
			this.keyAskedAt = now;
			this.send({ t: 'kf' });
		}
		let fx = [];
		try { fx = this.snapDec.events(msg); } catch { /* unreadable: skip */ }
		this.emit('s', { t: 's', gap: true, tm: msg.tm, fx });
	}

	// The server speaks another protocol: this page is outdated. Reload once a minute at most.
	reloadForUpdate() {
		let last = 0;
		try { last = +sessionStorage.getItem(RELOAD_KEY) || 0; } catch { /* storage unavailable */ }
		if (Date.now() - last < RELOAD_GUARD_MS) return false;
		try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage unavailable */ }
		location.reload();
		return true;
	}

	send(msg) {
		if (!this.connected) return;
		if (this.transport === 'WS' && this.ws && this.ws.readyState === 1) {
			this.ws.send(JSON.stringify(msg));
		} else if (this.transport === 'SSE') {
			this.outbox.push(msg);
			if (!this.posting) queueMicrotask(() => this.flush());
		}
	}

	// Keep menu/offer commands, but never replay unsent movement rejected by a pause.
	discardPositions() {
		this.outbox = this.outbox.filter((msg) => msg.t !== 'pos');
	}

	// POSTs are chained so messages keep their order; whatever queues meanwhile goes as one batch.
	async flush() {
		if (this.posting || !this.outbox.length) return;
		this.posting = true;
		const batch = this.outbox.splice(0);
		try {
			await fetch(`/api/send?sid=${encodeURIComponent(this.sid)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(batch.length === 1 ? batch[0] : batch),
			});
		} catch { /* lost; the next snapshot will tell */ }
		this.posting = false;
		if (this.outbox.length) this.flush();
	}
}
