// Server side of the snapshot wire format (see public/js/snapshot-codec.js and DESIGN.md «Снимок s»).
// One encoder per room: every client gets the same delta, keys go out every KEY_EVERY snapshots and on request.
import {
	PROTO, CHANNELS, CHANNEL_KEYS, FX_NAMES, ALPHA, MOVE_MIN, MOVE_MAX, T_MILLI, T_REL, T_SIDE, tmMilliOf,
} from '../public/js/snapshot-codec.js';

export { PROTO };
export const KEY_EVERY = 10;

// pid -> protocol the client announced on connect; absent means the current one (tests, bots).
export const clientProto = new Map();
export const isLegacy = (pid) => (clientProto.get(pid) ?? PROTO) < PROTO;
export const isCompatible = (pid) => (clientProto.get(pid) ?? PROTO) === PROTO;

const FX_ID = new Map(FX_NAMES.map((n, i) => [n, i + 1]));
const MAX_INT = 2 ** 40;
const C_MILLI = String.fromCharCode(T_MILLI), C_REL = String.fromCharCode(T_REL), C_SIDE = String.fromCharCode(T_SIDE);

class TokenWriter {
	constructor(side, tmMilli) {
		this.s = '';
		this.side = side;
		this.tm = tmMilli;
	}

	uint(n) {
		let s = ALPHA[32 + (n % 32)];
		n = Math.floor(n / 32);
		while (n > 0) {
			s = ALPHA[n % 32] + s;
			n = Math.floor(n / 32);
		}
		this.s += s;
	}

	int(v) {
		this.uint(v >= 0 ? v * 2 : -v * 2 - 1);
	}

	val(v) {
		if (typeof v === 'number') {
			if (Number.isInteger(v) && Math.abs(v) < MAX_INT) return this.int(v);
			const m = Math.round(v * 1000);
			if (m / 1000 === v && Math.abs(m) < MAX_INT) {
				const rel = m - this.tm;
				if (Math.abs(rel) < Math.abs(m)) {
					this.s += C_REL;
					return this.int(rel);
				}
				this.s += C_MILLI;
				return this.int(m);
			}
		}
		this.s += C_SIDE;
		this.side.push(v);
	}
}

const same = (a, b) => a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

export function packFx(fx, tmMilli) {
	const side = [];
	const w = new TokenWriter(side, tmMilli);
	let extra = null;
	for (const ev of fx) {
		if (!Array.isArray(ev) || typeof ev[0] !== 'string') {
			w.uint(0);
			side.push(ev);
			continue;
		}
		let id = FX_ID.get(ev[0]);
		if (id === undefined) {
			extra ??= [];
			let j = extra.indexOf(ev[0]);
			if (j < 0) j = extra.push(ev[0]) - 1;
			id = FX_NAMES.length + 1 + j;
		}
		w.uint(id);
		w.uint(ev.length - 1);
		for (let k = 1; k < ev.length; k++) w.val(ev[k]);
	}
	return { f: w.s, fv: side.length ? side : undefined, fn: extra ?? undefined };
}

// Flattens a channel value; returns null when it cannot be delta-coded (unknown or inconsistent width).
function flatten(value, nested, stride) {
	if (!Array.isArray(value)) return null;
	if (!nested) return stride > 0 && stride < 31 && value.length % stride === 0 ? { w: stride, flat: value } : null;
	const w = value.length ? value[0]?.length : stride;
	if (!(w > 0 && w < 31)) return null;
	const flat = [];
	for (const row of value) {
		if (!Array.isArray(row) || row.length !== w) return null;
		for (let f = 0; f < w; f++) flat.push(row[f]);
	}
	return { w, flat };
}

// Delta of one channel against `prev` (flat, width w). Returns {rec, next}; rec is null when nothing changed.
export function encodeChannel(prev, cur, w, cfg, tmMilli) {
	const curAt = new Map();
	for (let o = 0; o < cur.length; o += w) curAt.set(cur[o], o);
	const kept = new Set();
	const next = [];
	const side = [];
	const cw = new TokenWriter(side, tmMilli);
	let m = '', run = 0;
	const flush = () => {
		if (run >= 3) {
			m += '*';
			const t = new TokenWriter(null, 0);
			t.uint(run);
			m += t.s;
		} else m += '.'.repeat(run);
		run = 0;
	};
	const rows = prev.length / w;
	for (let i = 0; i < rows; i++) {
		const po = i * w;
		const co = curAt.get(prev[po]);
		if (co === undefined || kept.has(prev[po])) {
			flush();
			m += '!';
			continue;
		}
		kept.add(prev[po]);
		for (let f = 0; f < w; f++) next.push(cur[co + f]);
		let mask = 0;
		for (let f = 1; f < w; f++) if (f !== cfg.x && f !== cfg.y && !same(prev[po + f], cur[co + f])) mask |= 1 << f;
		const dx = cur[co + cfg.x] - prev[po + cfg.x], dy = cur[co + cfg.y] - prev[po + cfg.y];
		if (dx === 0 && dy === 0 && mask === 0) {
			run++;
			continue;
		}
		flush();
		if (Number.isInteger(dx) && Number.isInteger(dy) && dx >= MOVE_MIN && dx <= MOVE_MAX && dy >= MOVE_MIN && dy <= MOVE_MAX) {
			m += ALPHA[dx - MOVE_MIN] + ALPHA[dy - MOVE_MIN];
		} else {
			m += '~';
			mask |= (1 << cfg.x) | (1 << cfg.y);
		}
		if (mask) {
			cw.uint(i);
			cw.uint(mask);
			for (let f = 1; f < w; f++) if (mask & (1 << f)) cw.val(cur[co + f]);
		}
	}
	// Trailing unchanged rows are implied.
	const aw = new TokenWriter(side, tmMilli);
	for (let o = 0; o < cur.length; o += w) {
		if (kept.has(cur[o])) continue;
		kept.add(cur[o]);
		for (let f = 0; f < w; f++) {
			next.push(cur[o + f]);
			aw.val(cur[o + f]);
		}
	}
	// A pending run is never flushed, so an empty `m` means no kept row changed.
	if (!m && !aw.s) return { rec: null, next };
	const rec = {};
	if (m) rec.m = m;
	if (cw.s) rec.c = cw.s;
	if (aw.s) rec.a = aw.s;
	if (side.length) rec.v = side;
	return { rec, next };
}

export class SnapshotEncoder {
	// strides: row widths of the flat channels, e.g. {e: 6, g: 4, ...}.
	constructor(strides) {
		this.strides = strides;
		this.sq = 0;
		this.state = {}; // key -> {w, flat}; w 0 = sent raw, no delta base
		this.last = null;
	}

	// Encodes a plain snapshot. Returns {delta, key()} with lazily built key message; both share sq.
	encode(msg) {
		const sq = ++this.sq;
		const tmMilli = tmMilliOf(msg.tm);
		const base = { t: 's', sq };
		for (const k in msg) if (k !== 't' && k !== 'fx' && !(k in CHANNELS)) base[k] = msg[k];
		Object.assign(base, packFx(msg.fx ?? [], tmMilli));
		const delta = { ...base };
		const next = {};
		for (const k of CHANNEL_KEYS) {
			const cfg = CHANNELS[k];
			const val = msg[k] ?? [];
			const fl = flatten(val, cfg.n, this.strides[k] ?? 0);
			const st = this.state[k];
			if (!fl) {
				next[k] = { w: 0, flat: null, raw: val };
				delta[k] = { r: val, w: 0, n: cfg.n };
				continue;
			}
			if (!st || st.w !== fl.w) {
				next[k] = { w: fl.w, flat: fl.flat };
				delta[k] = { r: val, w: fl.w, n: cfg.n };
				continue;
			}
			const { rec, next: flat } = encodeChannel(st.flat, fl.flat, fl.w, cfg, tmMilli);
			next[k] = { w: fl.w, flat };
			if (rec) delta[k] = rec;
		}
		this.state = next;
		let key = null;
		const makeKey = () => {
			if (key) return key;
			key = { ...base, K: 1 };
			for (const k of CHANNEL_KEYS) {
				const st = next[k];
				const n = CHANNELS[k].n;
				if (!st.w) {
					key[k] = { r: st.raw, w: 0, n };
					continue;
				}
				const { rec } = encodeChannel([], st.flat, st.w, CHANNELS[k], tmMilli);
				key[k] = { w: st.w, ...rec };
			}
			return key;
		};
		return { sq, delta, key: makeKey, isKey: sq % KEY_EVERY === 1 };
	}
}
