// Local visual check of DUOS v2 (not for prod): the real server, every run starts at 5:00 with a given build.
// PORT=3024 HORDE_RUNS_DIR=/tmp/horde-v24 WEAPONS=guide:3,dome:2,frost:2 node pm/v24-visual.mjs
// WEAPONS: «id:level» of plain weapons or duos. OFFER=1: a level-up offer right at the start (card hints).
// Players take hits (shield duos answer them) but cannot die: hp is topped up every tick.
const APP = new URL('../app/', import.meta.url).pathname;
const { Room } = await import(APP + 'server/game.js');
const LIST = (process.env.WEAPONS ?? 'guide:3,dome:2,frost:2').split(',').map((s) => s.split(':'));

const start = Room.prototype.start;
Room.prototype.start = function startLate() {
	start.call(this);
	this.time = 300;
	this.events.next = Infinity;
	this.nextEliteT = this.nextInvasionT = Infinity;
	for (const h of this.heroes.values()) {
		h.weapons = new Map(LIST.map(([id, lvl]) => [id, { lvl: +lvl || 1, t: 0.3 }]));
		this.recalcMods(h);
		this.updateCombos(h);
		if (process.env.OFFER) this.grantOffer(h);
	}
};
const step = Room.prototype.step;
Room.prototype.step = function stepImmortal(dt) {
	for (const h of this.heroes?.values() ?? []) if (h.st === 0) h.hp = h.maxHp;
	return step.call(this, dt);
};
await import(APP + 'server/server.js');
