import { Room } from '../app/server/game.js';
const parts = {}; let n = 0; const fxk = {};
const r = new Room('X', (pid, msg) => {
	if (msg.t === 'lvl') r.handle(pid, { t: 'pick', i: 0 });
	if (msg.t !== 's' || pid !== 1) return;
	n++;
	for (const k of Object.keys(msg)) parts[k] = (parts[k] ?? 0) + JSON.stringify(msg[k]).length;
	for (const f of msg.fx) fxk[f[0]] = (fxk[f[0]] ?? 0) + JSON.stringify(f).length;
});
for (let pid = 1; pid <= 3; pid++) r.addPlayer(pid, 'B' + pid, ['knight', 'witch', 'ranger'][pid - 1]);
r.start();
for (let i = 0; i < 360 * 30; i++) {
	const t = i / 30;
	for (const h of r.heroes.values()) {
		h.hp = Math.max(h.hp, h.maxHp * 0.6);
		const a = t * 0.5 + h.pid * 2.1, cx = Math.cos(h.pid) * 150, cy = Math.sin(h.pid) * 150;
		r.handle(h.pid, { t: 'pos', x: cx + Math.cos(a) * 250, y: cy + Math.sin(a) * 250, fx: 1, fy: 0 });
	}
	r.tick(1 / 30);
}
for (const k in parts) parts[k] = Math.round(parts[k] / n);
for (const k in fxk) fxk[k] = Math.round(fxk[k] / n);
console.log(parts, fxk, 'gems', r.gems.length, 'items', r.items.length);
