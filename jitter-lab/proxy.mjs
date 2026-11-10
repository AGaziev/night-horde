// TCP proxy that delays server->client bytes with jitter and stalls (order preserved).
import net from 'node:net';
const [listen, target, seed] = [+process.argv[2], +process.argv[3], +(process.argv[4] || 1)];
let s = seed >>> 0 || 1;
const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const expo = (m) => -Math.log(1 - rnd()) * m;
function delay() {
	// one-way ~40 ms + exponential jitter, occasional tunnel stall
	let d = 40 + expo(25);
	if (rnd() < 0.03) d += 150 + rnd() * 250;
	return d;
}
net.createServer((c) => {
	const u = net.connect(target, '127.0.0.1');
	c.setNoDelay(true); u.setNoDelay(true);
	const pipe = (dst, delayFn) => {
		const q = []; let timer = null, last = 0;
		const pump = () => {
			timer = null;
			const now = Date.now();
			while (q.length && q[0].at <= now) { const it = q.shift(); if (!dst.destroyed) dst.write(it.buf); }
			if (q.length) timer = setTimeout(pump, q[0].at - now);
		};
		return (buf) => {
			const at = Math.max(last, Date.now() + delayFn()); last = at;
			q.push({ at, buf });
			if (!timer) timer = setTimeout(pump, Math.max(0, q[0].at - Date.now()));
		};
	};
	u.on('data', pipe(c, delay));
	c.on('data', pipe(u, () => 40));
	const end = () => { c.destroy(); u.destroy(); };
	c.on('error', end); u.on('error', end); c.on('close', end); u.on('close', end);
}).listen(listen, () => console.log('proxy', listen, '->', target));
