// Smoke server for card rarity: tough heroes, the first offer is legendary/epic/common, a small chest lies next to the start.
// PORT=3596 node smoke-rarity.mjs (a chest drops under every hero 6 s after start; offers are logged)
import { Room } from './app/server/game.js';
const start = Room.prototype.start;
const roll = Room.prototype.rollRarities;
Room.prototype.rollRarities = function (h, out, floor) {
	roll.call(this, h, out, floor);
	if (h.smokeForce) {
		h.smokeForce = false;
		const forced = [3, 2, 0];
		out.forEach((c, i) => { if (c.rar !== undefined) this.setRarity(h, c, forced[i] ?? 0); });
	}
};
Room.prototype.start = function () {
	start.call(this);
	for (const h of this.heroes.values()) {
		h.hp = h.maxHp = h.baseHp = 50000;
		h.smokeForce = true;
		this.grantOffer(h);
	}
	setTimeout(() => { for (const h of this.heroes.values()) this.dropItem('chest', h.x, h.y); }, 6000);
};
const make = Room.prototype.makeChoices;
Room.prototype.makeChoices = function (h, reroll) {
	const out = make.call(this, h, reroll);
	console.log(`offer floor=${h.offerFloor} reroll=${!!reroll}: ${out.map((c) => `${c.id}${c.rar === undefined ? '' : '*' + c.rar}`).join(', ')}`);
	return out;
};
await import('./app/server/server.js');
