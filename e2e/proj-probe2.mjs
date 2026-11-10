import { Hub } from '../app/server/game.js';
import { TICK_HZ } from '../app/public/shared/content.js';
const shot = new Map(), ended = new Set(); let bytes = 0, snaps = 0;
const hub = new Hub((pid, msg, json) => {
	if (json) msg = JSON.parse(json);
	if (msg.t === 'lvl') hub.handle(pid, { t: 'pick', i: 0 });
	if (msg.t === 's' && pid === 1) { snaps++; bytes += (json ?? JSON.stringify(msg)).length;
		for (const f of msg.fx) { if (f[0] === 'shot') shot.set(f[1], f[9]); if (f[0] === 'pend') ended.add(f[1]); } }
});
hub.addPlayer(1, 'A'); hub.addPlayer(2, 'B');
hub.handle(1, { t: 'create', hero: 'witch' });
const room = [...hub.rooms.values()][0];
hub.handle(2, { t: 'join', code: room.code, hero: 'ranger' });
hub.handle(1, { t: 'start' });
let created = 0; const orig = room.addProjectile.bind(room); room.addProjectile = (...a) => { orig(...a); created++; };
for (let i = 0; i < TICK_HZ * 90; i++) room.tick(1 / TICK_HZ);
console.log('created', created, 'shot events', shot.size, 'ended', ended.size, 'avg snapshot', Math.round(bytes / snaps), 'B');
