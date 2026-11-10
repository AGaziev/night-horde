// Smoke server for wave 2: every hero starts with a reaction-heavy kit. PORT=3593 node smoke-w2.mjs
import { Room } from './app/server/game.js';
const kit = (process.env.KIT || 'flask:5,lightning:5,firewheel:3,frost:5').split(',').map((s) => s.split(':'));
const start = Room.prototype.start;
Room.prototype.start = function () {
	start.call(this);
	for (const h of this.heroes.values()) {
		h.weapons = new Map(kit.map(([id, l]) => [id, { lvl: +l, t: 0.3 }]));
		h.hp = h.maxHp = h.baseHp = 5000;
	}
	this.time = 200;
};
await import('./app/server/server.js');
