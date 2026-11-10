import { Hub } from '../app/server/game.js';
import { TICK_HZ } from '../app/public/shared/content.js';
const seenIn = new Map(); // id -> snapshots count
const hub = new Hub((pid, msg, json) => {
	if (json) msg = JSON.parse(json);
	if (msg.t === 'lvl') hub.handle(pid, { t: 'pick', i: 0 });
	if (msg.t === 's' && pid === 1) for (let i = 0; i < msg.b.length; i += 5) seenIn.set(msg.b[i], (seenIn.get(msg.b[i]) || 0) + 1);
});
hub.addPlayer(1, 'A'); hub.addPlayer(2, 'B');
hub.handle(1, { t: 'create', hero: 'witch' });
const room = [...hub.rooms.values()][0];
hub.handle(2, { t: 'join', code: room.code, hero: 'ranger' });
hub.handle(1, { t: 'start' });
const created = new Set();
const orig = room.addProjectile.bind(room);
room.addProjectile = (...a) => { orig(...a); created.add(room.projectiles.at(-1).id); };
const dt = 1 / TICK_HZ;
for (let i = 0; i < TICK_HZ * 90; i++) {
	for (const h of room.heroes?.values?.() ?? []) h.hp = h.maxHp;
	room.tick(dt);
}
let never = 0, once = 0;
for (const id of created) { const n = seenIn.get(id) || 0; if (!n) never++; else if (n === 1) once++; }
console.log('created', created.size, 'never in snapshot', never, 'only once', once);
