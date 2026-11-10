// Test-only launcher: PORT=3783 node debug-server.mjs — adds {t:'dbg', ...} cheats on top of the real server.
import { Hub } from '../app/server/game.js';
const orig = Hub.prototype.handle;
Hub.prototype.handle = function (pid, msg) {
	if (msg?.t !== 'dbg') return orig.call(this, pid, msg);
	const room = this.players.get(pid)?.room;
	const h = room?.heroes?.get(pid);
	if (!h) return;
	const alive = [...room.heroes.values()].filter((x) => x.st === 0);
	if (msg.weapons) h.weapons = new Map(msg.weapons.map(([id, lvl]) => [id, { lvl, t: 0.2 }]));
	if (msg.passives) { h.passives = new Map(msg.passives); room.recalcMods(h); }
	if (msg.time !== undefined) { room.time = msg.time; room.nextEliteT = Math.max(room.nextEliteT, 0); room.bossIdx = msg.time >= 300 ? 1 : 0; }
	if (msg.god !== undefined) h.god = msg.god;
	if (msg.spawn) for (let i = 0; i < (msg.n ?? 1); i++) {
		const e = room.spawnEnemy(msg.spawn, [h], 1);
		const a = Math.random() * Math.PI * 2, d = msg.d ?? 250;
		e.x = h.x + Math.cos(a) * d; e.y = h.y + Math.sin(a) * d;
		if (msg.elite) room.setElite(e, msg.elite);
	}
	if (msg.item) room.dropItem(msg.item, h.x + (msg.dx ?? 60), h.y + (msg.dy ?? 0));
	if (msg.offer) room.grantOffer(h, !!msg.boost);
	if (msg.nospawn !== undefined) room.noSpawn = msg.nospawn;
};
// Optional god mode / no random spawns for calm screenshots.
const { Room } = await import('../app/server/game.js');
const hp = Room.prototype.hurtPlayer;
Room.prototype.hurtPlayer = function (h, dmg) { if (h.god) { this.fx.push(['hurt', h.pid]); h.iframes = 0.4; return; } return hp.call(this, h, dmg); };
const sp = Room.prototype.spawn;
Room.prototype.spawn = function (dt, alive) { if (!this.noSpawn) sp.call(this, dt, alive); };
process.chdir(new URL('../app/', import.meta.url).pathname);
await import('../app/server/server.js');
