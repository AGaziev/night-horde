// Snapshot wire format (protocol PROTO): row channels as deltas against the previous snapshot,
// fx packed into a token string. Shared by the client decoder and server/snapshot-codec.js.
// Format reference: DESIGN.md, «Снимок s».

export const PROTO = 24; // Offer actions carry offerEpoch; old pages reload before asynchronous reforge replacements.

// Row channels: x/y are the row offsets sent as small moves. Row width comes from the server (key `w`).
// `n`: the channel is an array of rows instead of a flat array.
export const CHANNELS = {
	p: { x: 1, y: 2, n: 1 },
	e: { x: 2, y: 3 },
	g: { x: 1, y: 2 },
	z: { x: 1, y: 2 },
	tr: { x: 1, y: 2 },
	it: { x: 2, y: 3 },
};
export const CHANNEL_KEYS = Object.keys(CHANNELS);

// Frequent fx names get 1-char ids; unknown names travel in the message (`fn`).
export const FX_NAMES = [
	'hit', 'shot', 'pend', 'zap', 'ptgt', 'eshot', 'epend', 'shard', 'boom', 'zk', 'lob', 'die', 'tslash', 'hurt', 'snap',
	'orb', 'tfan', 'crescent', 'bell', 'frost', 'ward', 'warn', 'bline', 'brk', 'inv', 'elite', 'boss', 'slash', 'down',
	'up', 'lvl', 'chest', 'slowz', 'duo', 'evo', 'cone', 'item', 'open', 'blink', 'react', 'banner',
	'eorb', 'evt', 'evte', 'altar', 'apulse', 'ovr', 'finw', 'fin', 'absorb', 'lorddie', 'ray',
	'buildring', 'buildbeam', // v27 (v25–v26 perks and forge)
];

// 64 symbols; '.', '*', '!', '~', '^' stay free as markers.
export const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const CODE = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHA.length; i++) CODE[ALPHA.charCodeAt(i)] = i;
export const MOVE_MIN = -32, MOVE_MAX = 31;

// Move stream markers.
export const M_SAME = 46, M_RUN = 42, M_GONE = 33, M_FAR = 126; // . * ! ~
// Value token markers: milli-units absolute / relative to tm, side value (JSON).
export const T_MILLI = 33, T_REL = 94, T_SIDE = 126; // ! ^ ~

export const tmMilliOf = (tm) => Math.round((+tm || 0) * 1000);

export class TokenReader {
	constructor(s, side, tmMilli) {
		this.s = typeof s === 'string' ? s : '';
		this.side = Array.isArray(side) ? side : [];
		this.si = 0;
		this.tm = tmMilli;
		this.i = 0;
	}

	get done() { return this.i >= this.s.length; }

	uint() {
		let n = 0;
		for (;;) {
			const c = CODE[this.s.charCodeAt(this.i++)];
			if (c === undefined || c < 0) throw new Error('bad token');
			if (c < 32) n = n * 32 + c;
			else return n * 32 + (c - 32);
		}
	}

	int() {
		const z = this.uint();
		return z % 2 ? -(z + 1) / 2 : z / 2;
	}

	val() {
		const c = this.s.charCodeAt(this.i);
		if (c === T_MILLI) { this.i++; return this.int() / 1000; }
		if (c === T_REL) { this.i++; return (this.tm + this.int()) / 1000; }
		if (c === T_SIDE) { this.i++; return this.side[this.si++]; }
		return this.int();
	}
}

export function unpackFx(s, side, names, tmMilli) {
	const r = new TokenReader(s, side, tmMilli);
	const out = [];
	while (!r.done) {
		const id = r.uint();
		if (id === 0) { out.push(r.side[r.si++]); continue; }
		const name = id <= FX_NAMES.length ? FX_NAMES[id - 1] : names?.[id - 1 - FX_NAMES.length];
		const n = r.uint();
		const ev = [name];
		for (let k = 0; k < n; k++) ev.push(r.val());
		out.push(ev);
	}
	return out;
}

const toRows = (flat, w) => {
	const rows = [];
	for (let i = 0; i + w <= flat.length; i += w) rows.push(flat.slice(i, i + w));
	return rows;
};

// Applies one channel record to the previous flat state. Returns the new flat array (a fresh one when changed).
export function applyChannel(prev, w, rec, cfg, tmMilli) {
	const m = typeof rec.m === 'string' ? rec.m : '';
	const r = new TokenReader(rec.c, rec.v, tmMilli);
	const mr = new TokenReader(m, null, 0);
	const out = [];
	let nextIdx = r.done ? -1 : r.uint();
	let row = 0;
	const rowsPrev = w ? prev.length / w : 0;
	const copy = (k) => { for (let f = 0; f < w; f++) out.push(prev[k * w + f]); };
	const patch = (k) => {
		if (nextIdx !== k) return;
		const mask = r.uint();
		const base = out.length - w;
		for (let f = 0; f < w; f++) if (mask & (1 << f)) out[base + f] = r.val();
		nextIdx = r.done ? -1 : r.uint();
	};
	while (!mr.done) {
		const c = m.charCodeAt(mr.i);
		if (c === M_SAME) { mr.i++; copy(row++); continue; }
		if (c === M_RUN) { mr.i++; const k = mr.uint(); for (let j = 0; j < k; j++) copy(row++); continue; }
		if (c === M_GONE) { mr.i++; row++; continue; }
		if (c === M_FAR) { mr.i++; copy(row); patch(row); row++; continue; }
		const dx = CODE[c] + MOVE_MIN, dy = CODE[m.charCodeAt(mr.i + 1)] + MOVE_MIN;
		mr.i += 2;
		copy(row);
		out[out.length - w + cfg.x] += dx;
		out[out.length - w + cfg.y] += dy;
		patch(row);
		row++;
	}
	while (row < rowsPrev) copy(row++);
	if (nextIdx !== -1) throw new Error('unused patch');
	// Added rows: the rest of the token stream after patches, in the `a` string.
	const ar = new TokenReader(rec.a, r.side, tmMilli);
	ar.si = r.si;
	while (!ar.done) for (let f = 0; f < w; f++) out.push(ar.val());
	return out;
}

// Client decoder: keeps the last applied snapshot per channel and turns wire messages back into plain snapshots.
export class SnapshotDecoder {
	constructor() { this.reset(); }

	reset() {
		this.sq = -1;
		this.ch = {}; // key -> {w, n, flat, out}
	}

	// Events of a message that cannot be applied (fx do not depend on the previous snapshot).
	events(msg) {
		if (typeof msg.sq !== 'number') return Array.isArray(msg.fx) ? msg.fx : [];
		return unpackFx(msg.f, msg.fv, msg.fn, tmMilliOf(msg.tm));
	}

	// Returns the plain snapshot, or null when the delta does not follow the last applied one.
	decode(msg) {
		if (typeof msg.sq !== 'number') return msg; // older server: plain snapshot
		const key = msg.K === 1;
		if (!key && msg.sq !== this.sq + 1) return null;
		const tmMilli = tmMilliOf(msg.tm);
		const out = {};
		for (const k in msg) if (k !== 'f' && k !== 'fv' && k !== 'fn' && k !== 'K' && !(k in CHANNELS)) out[k] = msg[k];
		out.fx = unpackFx(msg.f, msg.fv, msg.fn, tmMilli);
		const next = {};
		for (const k of CHANNEL_KEYS) {
			const rec = msg[k];
			const st = key ? null : this.ch[k];
			let ns;
			if (rec && rec.r !== undefined) {
				const w = rec.w | 0;
				const flat = rec.n && w ? rec.r.flat() : rec.r;
				ns = { w, n: rec.n ? 1 : 0, flat, out: rec.r };
			} else if (key) {
				const w = rec?.w | 0;
				const flat = rec && w ? applyChannel([], w, rec, CHANNELS[k], tmMilli) : [];
				ns = { w, n: CHANNELS[k].n ? 1 : 0, flat, out: null };
			} else if (!rec) {
				ns = st ?? { w: 0, n: 0, flat: [], out: [] };
			} else {
				if (!st || !st.w) return null;
				ns = { w: st.w, n: st.n, flat: applyChannel(st.flat, st.w, rec, CHANNELS[k], tmMilli), out: null };
			}
			if (ns.out === null) ns.out = ns.n ? toRows(ns.flat, ns.w) : ns.flat;
			next[k] = ns;
			out[k] = ns.out;
		}
		this.ch = next;
		this.sq = msg.sq;
		return out;
	}
}
