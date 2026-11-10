// v22: player progress and the weekly records on the server, in the Vibecode app storage (/v1/storage, S3).
// One object per portal user `players/<bitrixUserId>.json`, one per ISO week `leaderboard/week-<YYYY-Www>.json`.
// The server is the only writer: everything lives in a memory cache, writes go out in batches with a per-object
// minimum interval and never two at once for the same object. Without a key or while the storage fails the game
// keeps the old behaviour: progress stays in the browser (localStorage).
import { HEROES, DUOS, MODES, ACH_STATS, mergeAchStats, unlockedHeroes } from '../public/shared/content.js';

export const SCHEMA = 1;
export const BASE_URL = 'https://vibecode.bitrix24.tech/v1';
const REQ_TIMEOUT_MS = 10_000;

// Only a plain numeric X-Vibe-User-Id is a portal user; `net_…`, `share:…`, `vibe:…` and a missing header stay in the browser.
export const bitrixUid = (v) => (typeof v === 'string' && /^[1-9][0-9]{0,11}$/.test(v) ? v : null);

// Upper bounds for stored stats: well above any honest total, they only stop absurd values from a migrated browser.
const MAX_RUN_SEC = Math.max(...Object.values(MODES).map((m) => m.seconds));
export const ACH_LIMITS = { wins: 100_000, knightBest: MAX_RUN_SEC, revives: 1_000_000, knifeKills: 100_000_000, bosses: 1_000_000, lords: 100_000 };
const MAX_DUOS = Object.keys(DUOS).length;

const intIn = (v, max) => {
	const n = Math.floor(Number(v));
	return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};

export function sanitizeAch(raw) {
	const out = {};
	for (const k of ACH_STATS) out[k] = intIn(raw?.[k], ACH_LIMITS[k] ?? 0);
	// Every Lord slain is a win.
	out.lords = Math.min(out.lords, out.wins);
	return out;
}

export function sanitizeDuos(raw) {
	if (!Array.isArray(raw)) return [];
	const set = new Set();
	for (const id of raw.slice(0, MAX_DUOS * 2)) if (typeof id === 'string' && Object.hasOwn(DUOS, id)) set.add(id);
	return [...set];
}

// Bigger progress wins: opened stays opened, every counter takes the maximum.
export function mergeProgress(a, b) {
	const x = sanitizeAch(a?.ach), y = sanitizeAch(b?.ach);
	const ach = {};
	for (const k of ACH_STATS) ach[k] = Math.max(x[k], y[k]);
	return { ach, duos: sanitizeDuos([...(a?.duos ?? []), ...(b?.duos ?? [])]) };
}

export const emptyRecord = (uid) => ({ schema: SCHEMA, uid, ach: sanitizeAch({}), duos: [], migrated: false, runs: 0, updatedAt: 0 });

// Reads a stored player object of any known schema; null for garbage.
export function parseRecord(text, uid) {
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!raw || typeof raw !== 'object' || !(raw.schema >= 1)) return null;
	return {
		schema: raw.schema, uid, ach: sanitizeAch(raw.ach), duos: sanitizeDuos(raw.duos),
		migrated: raw.migrated === true, runs: intIn(raw.runs, 1e9), updatedAt: intIn(raw.updatedAt, 1e15),
	};
}

export const recordJson = (rec) => JSON.stringify({ schema: SCHEMA, uid: rec.uid, ach: rec.ach, duos: rec.duos, migrated: rec.migrated, runs: rec.runs, updatedAt: rec.updatedAt });
export const unlockedOf = (rec) => unlockedHeroes(rec.ach);

// ISO 8601 week of a date (UTC): «2026-W46».
export function isoWeek(date = new Date()) {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	const day = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - day);
	const year = d.getUTCFullYear();
	const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
	return `${year}-W${String(week).padStart(2, '0')}`;
}

export const playerKey = (uid) => `players/${uid}.json`;
export const boardKey = (week) => `leaderboard/week-${week}.json`;

// A weekly record: «Владыка повержен» > win > fall, then longer, then more kills.
export function sanitizeEntry(e) {
	if (!e || typeof e !== 'object') return null;
	const hero = typeof e.hero === 'string' && Object.hasOwn(HEROES, e.hero) ? e.hero : null;
	if (!hero) return null;
	const name = typeof e.name === 'string' ? e.name.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').trim().slice(0, 20) : '';
	const lord = e.lord === true;
	return {
		name: name || 'Игрок', hero, win: e.win === true || lord, lord, time: intIn(e.time, MAX_RUN_SEC), kills: intIn(e.kills, 1e7),
		mode: typeof e.mode === 'string' && Object.hasOwn(MODES, e.mode) ? e.mode : 'night', players: Math.max(1, intIn(e.players, 8)), at: intIn(e.at, 1e15),
	};
}
const rank = (e) => (e.lord ? 2 : e.win ? 1 : 0);
export const betterEntry = (a, b) => rank(a) - rank(b) || a.time - b.time || a.kills - b.kills;

function parseBoard(text) {
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!raw || typeof raw !== 'object' || !raw.rows || typeof raw.rows !== 'object') return null;
	const rows = new Map();
	for (const [uid, e] of Object.entries(raw.rows)) {
		const s = bitrixUid(uid) && sanitizeEntry(e);
		if (s) rows.set(uid, s);
	}
	return rows;
}

class StorageError extends Error {
	constructor(op, status, code) {
		super(`${op} ${status}${code ? ' ' + code : ''}`);
		this.status = status;
		this.code = code;
	}
}

async function errorCode(res) {
	try {
		return (await res.json())?.error?.code ?? '';
	} catch {
		return '';
	}
}

// The Vibecode app storage. get() resolves to the text or null (no object / deleted), put() to nothing; both throw on failure.
// prefix keeps a local test run apart from the live objects («selftest/players/…»).
export function vibeBackend(apiKey, { base = BASE_URL, fetchImpl = fetch, prefix = '' } = {}) {
	const headers = { 'X-Api-Key': apiKey };
	return {
		async get(key) {
			key = prefix + key;
			const res = await fetchImpl(`${base}/storage/objects/${encodeURIComponent(key)}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(REQ_TIMEOUT_MS) });
			if (res.status === 404 || res.status === 410) return null;
			const loc = res.headers.get('location');
			if (res.status !== 302 || !loc) throw new StorageError('get', res.status, await errorCode(res));
			// The presigned URL carries its own signature: the API key is not sent there.
			const obj = await fetchImpl(loc, { signal: AbortSignal.timeout(REQ_TIMEOUT_MS) });
			if (!obj.ok) throw new StorageError('get-object', obj.status, '');
			return obj.text();
		},
		async put(key, text) {
			key = prefix + key;
			const form = new FormData();
			form.append('key', key);
			form.append('visibility', 'PRIVATE');
			form.append('file', new Blob([text], { type: 'application/json' }), key.split('/').pop());
			const res = await fetchImpl(`${base}/storage/objects/upload`, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(REQ_TIMEOUT_MS) });
			if (!res.ok) throw new StorageError('put', res.status, await errorCode(res));
			await res.arrayBuffer().catch(() => {});
		},
	};
}

export const PLAYER_MIN_INTERVAL_MS = 15_000;
export const BOARD_MIN_INTERVAL_MS = 30_000;
const WRITES_PER_TICK = 8;
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
const TOP_N = 10;

export class ProgressStore {
	// backend: {get, put} or null (storage off). onLoaded(uid, rec) — a player's object came in (or was retried in).
	constructor({ backend = null, log = console, now = () => Date.now(), onLoaded = null } = {}) {
		this.backend = backend;
		this.log = log;
		this.now = now;
		this.onLoaded = onLoaded;
		this.players = new Map(); // uid -> {rec|null, refs, loading, failN, retryAt, pending: [runs]}
		this.boards = new Map(); // week -> {rows|null, loading, failN, retryAt, pending: [[uid, entry]]}
		this.objects = new Map(); // storage key -> {dirty, inflight, lastWrite, failN, retryAt}
		this.errors = { read: 0, write: 0 };
	}

	get enabled() {
		return !!this.backend;
	}

	// --- players ---

	slot(uid) {
		let p = this.players.get(uid);
		if (!p) {
			p = { rec: null, refs: 0, loading: null, failN: 0, retryAt: 0, pending: [] };
			this.players.set(uid, p);
		}
		return p;
	}

	// A session of this user opened: keep its object cached and read it if needed. Resolves to the record or null.
	retain(uid) {
		if (!this.enabled || !bitrixUid(uid)) return Promise.resolve(null);
		const p = this.slot(uid);
		p.refs++;
		return this.load(uid);
	}

	release(uid) {
		const p = this.players.get(uid);
		if (p) p.refs = Math.max(0, p.refs - 1);
	}

	record(uid) {
		return this.players.get(uid)?.rec ?? null;
	}

	load(uid) {
		const p = this.slot(uid);
		if (p.rec) return Promise.resolve(p.rec);
		if (p.loading) return p.loading;
		// After a failure the next read waits for its retry time (tick() retries for players with a session).
		if (p.failN && this.now() < p.retryAt) return Promise.resolve(null);
		p.loading = (async () => {
			try {
				const text = await this.backend.get(playerKey(uid));
				let rec = text === null ? emptyRecord(uid) : parseRecord(text, uid);
				if (!rec) {
					// Unreadable object: start over rather than lock the player out, keep the event in the log.
					this.log.warn?.(`[storage] players/${uid}.json unreadable, starting empty`);
					rec = emptyRecord(uid);
				}
				if (rec.schema > SCHEMA) {
					// Written by a newer server: do not downgrade it, this server leaves the player in the browser.
					this.log.warn?.(`[storage] players/${uid}.json has schema ${rec.schema} > ${SCHEMA}, read-only`);
					p.loading = null;
					return null;
				}
				p.rec = rec;
				p.failN = 0;
				for (const run of p.pending.splice(0)) this.applyRun(uid, run);
				return rec;
			} catch (e) {
				this.fail('read', playerKey(uid), e, p);
				return null;
			} finally {
				p.loading = null;
			}
		})();
		return p.loading;
	}

	// First visit with the server: the browser hands over its localStorage once, bigger progress wins.
	migrate(uid, local) {
		const rec = this.record(uid);
		if (!rec || rec.migrated) return rec;
		const m = mergeProgress(rec, { ach: local?.ach, duos: local?.duos });
		rec.ach = m.ach;
		rec.duos = m.duos;
		rec.migrated = true;
		this.touch(rec, playerKey(uid));
		return rec;
	}

	// A run ended for this user: the server's own counts (runAchievements) join the totals. Returns the totals or null.
	addRun(uid, run) {
		if (!this.enabled || !bitrixUid(uid)) return null;
		const p = this.slot(uid);
		if (!p.rec) {
			// Not read yet (or the read failed): applied once the object comes in.
			if (p.pending.length < 50) p.pending.push(run);
			return null;
		}
		return this.applyRun(uid, run);
	}

	applyRun(uid, run) {
		const rec = this.record(uid);
		rec.ach = sanitizeAch(mergeAchStats(rec.ach, sanitizeAch(run.ach)));
		rec.duos = sanitizeDuos([...rec.duos, ...(run.duos ?? [])]);
		rec.runs++;
		this.touch(rec, playerKey(uid));
		return rec.ach;
	}

	touch(rec, key) {
		rec.updatedAt = this.now();
		this.obj(key).dirty = true;
	}

	// --- weekly records ---

	board(week) {
		let b = this.boards.get(week);
		if (!b) {
			b = { rows: null, loading: null, failN: 0, retryAt: 0, pending: [] };
			this.boards.set(week, b);
		}
		return b;
	}

	loadBoard(week) {
		const b = this.board(week);
		if (!this.enabled || b.rows) return Promise.resolve(b.rows);
		if (b.loading) return b.loading;
		if (b.failN && this.now() < b.retryAt) return Promise.resolve(null);
		b.loading = (async () => {
			try {
				const text = await this.backend.get(boardKey(week));
				b.rows = (text === null ? null : parseBoard(text)) ?? new Map();
				b.failN = 0;
				for (const [uid, e] of b.pending.splice(0)) this.applyEntry(week, uid, e);
				return b.rows;
			} catch (e) {
				this.fail('read', boardKey(week), e, b);
				return null;
			} finally {
				b.loading = null;
			}
		})();
		return b.loading;
	}

	// Keeps the user's best result of the week; the object is written only after the week was read.
	addResult(uid, entry, date = new Date(this.now())) {
		if (!this.enabled || !bitrixUid(uid)) return;
		const e = sanitizeEntry(entry);
		if (!e) return;
		const week = isoWeek(date);
		const b = this.board(week);
		if (!b.rows) {
			if (b.pending.length < 500) b.pending.push([uid, e]);
			this.loadBoard(week);
			return;
		}
		this.applyEntry(week, uid, e);
	}

	applyEntry(week, uid, e) {
		const rows = this.boards.get(week).rows;
		const old = rows.get(uid);
		if (old && betterEntry(e, old) <= 0) {
			// Same or worse result; a fresh display name still goes in.
			if (old.name === e.name) return;
			old.name = e.name;
		} else rows.set(uid, e);
		this.obj(boardKey(week)).dirty = true;
	}

	// Top of the week for the lobby; `me` marks the asking user's row. Null while the week is not read.
	top(week, askUid = null, n = TOP_N) {
		const rows = this.boards.get(week)?.rows;
		if (!rows) return null;
		return [...rows.entries()]
			.sort((a, b) => betterEntry(b[1], a[1]) || a[1].at - b[1].at)
			.slice(0, n)
			.map(([uid, e]) => ({ name: e.name, hero: e.hero, win: e.win, lord: e.lord, time: e.time, kills: e.kills, mode: e.mode, players: e.players, me: uid === askUid }));
	}

	// --- writing ---

	obj(key) {
		let o = this.objects.get(key);
		if (!o) {
			o = { dirty: false, inflight: null, lastWrite: 0, failN: 0, retryAt: 0 };
			this.objects.set(key, o);
		}
		return o;
	}

	serialize(key) {
		if (key.startsWith('players/')) {
			const rec = this.record(key.slice(8, -5));
			return rec ? recordJson(rec) : null;
		}
		const week = key.slice('leaderboard/week-'.length, -5);
		const rows = this.boards.get(week)?.rows;
		return rows ? JSON.stringify({ schema: SCHEMA, week, rows: Object.fromEntries(rows) }) : null;
	}

	write(key) {
		const o = this.obj(key);
		const text = this.serialize(key);
		if (text === null) {
			o.dirty = false;
			return Promise.resolve();
		}
		o.dirty = false;
		o.lastWrite = this.now();
		o.inflight = this.backend.put(key, text).then(
			() => {
				o.failN = 0;
				o.retryAt = 0;
			},
			(e) => {
				// The newer state is still in the cache: mark dirty again, retry later.
				o.dirty = true;
				this.fail('write', key, e, o);
			},
		).finally(() => {
			o.inflight = null;
		});
		return o.inflight;
	}

	// Called every couple of seconds: writes due objects, retries failed reads, drops idle cached players.
	tick() {
		if (!this.enabled) return [];
		const now = this.now();
		const started = [];
		for (const [key, o] of this.objects) {
			if (started.length >= WRITES_PER_TICK) break;
			if (!o.dirty || o.inflight || now < o.retryAt) continue;
			const min = key.startsWith('players/') ? PLAYER_MIN_INTERVAL_MS : BOARD_MIN_INTERVAL_MS;
			if (now - o.lastWrite < min) continue;
			started.push(this.write(key));
		}
		for (const [uid, p] of this.players) {
			if (!p.rec && !p.loading && p.refs > 0 && p.failN && now >= p.retryAt) {
				this.load(uid).then((rec) => rec && this.onLoaded?.(uid, rec));
			}
			const o = this.objects.get(playerKey(uid));
			if (p.refs === 0 && !p.loading && !p.pending.length && !(o && (o.dirty || o.inflight))) {
				this.players.delete(uid);
				this.objects.delete(playerKey(uid));
			}
		}
		const week = isoWeek(new Date(now));
		for (const [w, b] of this.boards) {
			if (!b.rows && !b.loading && now >= b.retryAt && (w === week || b.pending.length)) this.loadBoard(w);
			const o = this.objects.get(boardKey(w));
			if (w !== week && b.rows && !(o && (o.dirty || o.inflight))) {
				this.boards.delete(w);
				this.objects.delete(boardKey(w));
			}
		}
		return started;
	}

	// Shutdown: everything dirty goes out now, ignoring the intervals.
	async flush(timeoutMs = 5_000) {
		if (!this.enabled) return;
		const jobs = [];
		for (const [key, o] of this.objects) {
			if (o.inflight) jobs.push(o.inflight.then(() => o.dirty && this.write(key)));
			else if (o.dirty) jobs.push(this.write(key));
		}
		await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, timeoutMs).unref?.())]);
	}

	fail(kind, key, e, state) {
		this.errors[kind]++;
		state.failN = (state.failN ?? 0) + 1;
		state.retryAt = this.now() + Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (state.failN - 1));
		const why = e?.name === 'TimeoutError' ? 'timeout' : e?.message ?? String(e);
		this.log.warn?.(`[storage] ${kind} ${key} failed: ${why} (errors: read ${this.errors.read}, write ${this.errors.write})`);
	}
}

// `prog` to a client: whether the weekly board is on and, for a portal user whose object is read, the server totals.
export const progressMsg = (store, rec) => ({
	t: 'prog', board: store.enabled, srv: !!rec,
	...(rec ? { ach: rec.ach, duos: rec.duos, mig: rec.migrated } : {}),
});

