// Local smoke server for the ally arrows / minimap check: PORT=3611 node smoke-allies.mjs
import { Room } from '../../app/server/game.js';
const start = Room.prototype.start;
Room.prototype.start = function () {
	start.call(this);
	for (const h of this.heroes.values()) {
		h.weapons = new Map([['ward', { lvl: 2, t: 0.3 }], ['whip', { lvl: 1, t: 0.3 }]]);
		h.passives = new Map([['mail', 1]]);
		this.recalcMods(h);
		h.hp = h.maxHp = h.baseHp = 50000;
	}
	this.dropItem('chest', 900, -700);
	this.dropItem('chest', -1300, 400);
	this.downAt = this.time + 14;
};
const step = Room.prototype.step;
Room.prototype.step = function (dt) {
	step.call(this, dt);
	if (this.downAt && this.time > this.downAt) {
		this.downAt = 0;
		const hs = [...this.heroes.values()];
		const h = hs[hs.length - 1];
		if (h) { h.hp = 0; h.st = 1; h.rev = 0; h.downT = this.time; this.fx.push(['down', h.pid]); }
	}
	for (const h of this.heroes.values()) if (h.st === 0) h.hp = h.maxHp;
};
await import('../../app/server/server.js');
