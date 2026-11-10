import { Hub } from '../app/server/game.js';
import { TICK_HZ } from '../app/public/shared/content.js';
const shots = new Map(); let hit = 0, total = 0;
const hub = new Hub((pid, msg, json) => {
	if (json) msg = JSON.parse(json);
	if (msg.t === 'lvl') hub.handle(pid, { t: 'pick', i: 0 });
	if (msg.t !== 's') return;
	for (const f of msg.fx) {
		if (f[0] === 'shot' && f[2] === 1) shots.set(f[1], f[9] + f[7]);
		if (f[0] === 'pend' && shots.has(f[1])) { total++; if (f[4] < shots.get(f[1]) - 0.05) hit++; shots.delete(f[1]); }
	}
});
hub.addPlayer(1, 'R');
hub.handle(1, { t: 'create', hero: 'ranger' });
hub.handle(1, { t: 'start' });
const room = [...hub.rooms.values()][0];
let x = 0, y = 0, t = 0;
for (let i = 0; i < TICK_HZ * 120; i++) {
	t += 1 / TICK_HZ;
	// Kite: run in a big circle, facing the movement direction (away from the chasing horde).
	const a = t * 0.25, fx = -Math.sin(a), fy = Math.cos(a);
	x += fx * 170 / TICK_HZ; y += fy * 170 / TICK_HZ;
	hub.handle(1, { t: 'pos', x, y, fx, fy });
	for (const h of room.heroes.values()) h.hp = h.maxHp;
	room.tick(1 / TICK_HZ);
}
console.log(`knives that hit: ${hit}/${total} (${Math.round((hit / total) * 100)}%)`);
