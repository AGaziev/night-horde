// Smoke server for G5 peaks: the run starts at T seconds with tough heroes. PORT=3594 T=745 node smoke-g5.mjs
import { Room } from './app/server/game.js';
const T = +(process.env.T || 145);
const start = Room.prototype.start;
Room.prototype.start = function () {
	start.call(this);
	for (const h of this.heroes.values()) {
		h.weapons = new Map([['lightning', { lvl: 5, t: 0.3 }], ['flask', { lvl: 5, t: 0.3 }]]);
		h.hp = h.maxHp = h.baseHp = 50000;
	}
	this.time = T;
	this.bossIdx = 5;
};
await import('./app/server/server.js');
