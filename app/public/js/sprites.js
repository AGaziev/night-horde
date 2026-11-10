// Pixel-art sprite atlas: frame strips facing right, plus mirrored copies and per-colour hero tints.
// Everything is optional: until a sheet loads, get() returns null and the renderer keeps its vector art.

const BASE = '/sprites/';

function canvas(w, h) {
	if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return c;
}

function ctx2d(c) {
	const x = c.getContext('2d');
	x.imageSmoothingEnabled = false;
	return x;
}

// Immutable GPU-friendly copy; canvases touched by getImageData would otherwise be re-uploaded on every draw.
const bitmap = (src) => (typeof createImageBitmap === 'function' ? createImageBitmap(src).catch(() => src) : Promise.resolve(src));

function loadImage(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = src;
	});
}

// Each cell mirrored in place, so frame k stays at column k.
function mirror(img, cw, ch, frames) {
	const c = canvas(cw * frames, ch);
	const x = ctx2d(c);
	for (let k = 0; k < frames; k++) {
		x.setTransform(-1, 0, 0, 1, (k + 1) * cw, 0);
		x.drawImage(img, k * cw, 0, cw, ch, 0, 0, cw, ch);
	}
	return c;
}

// Drops small detached blobs touching a cell's side edge: slivers of a neighbouring frame left by slicing.
function cleanEdges(img, cw, ch, frames) {
	const W = cw * frames;
	const c = canvas(W, ch);
	const x = ctx2d(c);
	x.drawImage(img, 0, 0);
	const data = x.getImageData(0, 0, W, ch);
	const a = data.data;
	const label = new Int32Array(cw * ch);
	const stack = [];
	let dirty = false;
	for (let f = 0; f < frames; f++) {
		label.fill(0);
		const comps = [];
		for (let i = 0; i < cw * ch; i++) {
			if (label[i] || a[((i / cw | 0) * W + f * cw + i % cw) * 4 + 3] === 0) continue;
			const id = comps.length + 1;
			const comp = { size: 0, edge: false, px: [] };
			comps.push(comp);
			label[i] = id;
			stack.push(i);
			while (stack.length) {
				const j = stack.pop();
				const cx = j % cw, cy = j / cw | 0;
				comp.size++;
				comp.px.push(j);
				if (cx < 2 || cx > cw - 3) comp.edge = true;
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						const nx = cx + dx, ny = cy + dy;
						if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
						const n = ny * cw + nx;
						if (label[n] || a[(ny * W + f * cw + nx) * 4 + 3] === 0) continue;
						label[n] = id;
						stack.push(n);
					}
				}
			}
		}
		const big = comps.reduce((m, q) => Math.max(m, q.size), 0);
		for (const q of comps) {
			if (!q.edge || q.size >= big * 0.15) continue;
			dirty = true;
			for (const j of q.px) a[((j / cw | 0) * W + f * cw + j % cw) * 4 + 3] = 0;
		}
	}
	if (!dirty) return img;
	x.putImageData(data, 0, 0);
	return c;
}

// Union of opaque pixels over the first `n` frames, so a cropped portrait does not jump while walking.
function opaqueBox(img, cw, ch, n) {
	const c = canvas(cw * n, ch);
	const x = ctx2d(c);
	x.drawImage(img, 0, 0);
	const a = x.getImageData(0, 0, cw * n, ch).data;
	let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
	for (let y = 0; y < ch; y++) {
		for (let i = 0; i < cw * n; i++) {
			if (a[(y * cw * n + i) * 4 + 3] < 20) continue;
			const px = i % cw;
			if (px < x0) x0 = px;
			if (px > x1) x1 = px;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
	}
	return x1 < 0 ? [0, 0, cw, ch] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

export class Sprites {
	constructor() {
		this.map = new Map();
		this.tints = new Map();
		this.ready = false;
		this.waiters = [];
		this.portraits = new Map();
	}

	async load() {
		try {
			const res = await fetch(BASE + 'manifest.json');
			if (!res.ok) return;
			const manifest = await res.json();
			await Promise.all(Object.entries(manifest).map(([id, m]) => this.loadOne(id, m).catch(() => {})));
			this.ready = this.map.size > 0;
		} catch {
			// No atlas: vector fallback stays.
		}
		if (this.ready) for (const f of this.waiters.splice(0)) f();
	}

	whenReady(f) {
		if (this.ready) f();
		else this.waiters.push(f);
	}

	async loadOne(id, m) {
		const [raw, mask] = await Promise.all([loadImage(BASE + m.file), m.mask ? loadImage(BASE + m.mask) : null]);
		const [cw, ch] = m.cell;
		const frames = Math.max(1, m.frames | 0);
		const clean = frames > 1 && cw >= 64 ? cleanEdges(raw, cw, ch, frames) : raw;
		const box = mask ? opaqueBox(clean, cw, ch, frames - 1) : null;
		const img = await bitmap(clean);
		const flip = frames > 1 ? await bitmap(mirror(img, cw, ch, frames)) : img;
		this.map.set(id, {
			id, img, mask, cw, ch, frames, box,
			fps: m.fps || 0,
			ax: m.anchor[0], ay: m.anchor[1],
			body: m.bodyRadius || 0,
			attack: Array.isArray(m.attackFrames) ? m.attackFrames : null,
			// Heroes keep the fallen pose in the last frame; bosses keep attack frames at the end.
			walk: m.attackFrames ? Math.min(...m.attackFrames) : m.mask ? frames - 1 : frames,
			flip,
		});
	}

	get(id) {
		return this.map.get(id) || null;
	}

	// Hero sheet with the mask area multiplied by the player's colour; built once per hero+colour.
	tinted(id, color) {
		const s = this.map.get(id);
		if (!s) return null;
		if (!s.mask) return s;
		const key = id + '|' + color;
		let t = this.tints.get(key);
		if (t) return t;
		const w = s.cw * s.frames, h = s.ch;
		const layer = canvas(w, h);
		const lx = ctx2d(layer);
		lx.drawImage(s.img, 0, 0);
		lx.globalCompositeOperation = 'multiply';
		lx.fillStyle = color;
		lx.fillRect(0, 0, w, h);
		lx.globalCompositeOperation = 'destination-in';
		lx.drawImage(s.mask, 0, 0);
		lx.drawImage(s.img, 0, 0);
		const out = canvas(w, h);
		const ox = ctx2d(out);
		ox.drawImage(s.img, 0, 0);
		ox.drawImage(layer, 0, 0);
		t = { ...s, img: out, flip: mirror(out, s.cw, s.ch, s.frames) };
		this.tints.set(key, t);
		bitmap(t.img).then((b) => { t.img = b; });
		bitmap(t.flip).then((b) => { t.flip = b; });
		return t;
	}

}

// Hero portrait as a data URL: frame cropped to the walk-cycle box, square, native art pixels.
Sprites.prototype.portrait = function (id, color, frame = 0) {
	const key = id + '|' + color + '|' + frame;
	let url = this.portraits.get(key);
	if (url) return url;
	const s = this.tinted(id, color);
	if (!s || !s.box) return null;
	const [bx, by, bw, bh] = s.box;
	const side = Math.max(bw, bh);
	const c = document.createElement('canvas');
	c.width = side;
	c.height = side;
	const x = ctx2d(c);
	x.drawImage(s.img, frame * s.cw + bx, by, bw, bh, (side - bw) >> 1, side - bh, bw, bh);
	url = c.toDataURL();
	this.portraits.set(key, url);
	return url;
};

// One atlas for the renderer and the menus.
export const sprites = new Sprites();
sprites.load();

// Draws frame `k` with the anchor (feet) at x,y; `flip` mirrors to face left.
export function blit(ctx, s, k, x, y, scale, flip) {
	const w = s.cw * scale, h = s.ch * scale;
	const ax = (flip ? s.cw - s.ax : s.ax) * scale;
	ctx.drawImage(flip ? s.flip : s.img, k * s.cw, 0, s.cw, s.ch, x - ax, y - s.ay * scale, w, h);
}

// Walk frame from time and id so neighbours are out of phase.
export function walkFrame(s, now, id) {
	const n = s.walk;
	if (n <= 1 || !s.fps) return 0;
	return (Math.floor(now * s.fps + id * 0.618 * n) % n + n) % n;
}

export function attackFrame(s, now) {
	const a = s.attack;
	return a ? a[Math.floor(now * s.fps * 1.5) % a.length] : 0;
}
