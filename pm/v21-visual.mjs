// Local visual check of the v21 finale (not for prod): the real server, every run starts 6 s before the finale's warning
// with a mid build. PORT=3021 HORDE_RUNS_DIR=/tmp/horde-v21 node pm/v21-visual.mjs
// HURT=1: players take damage (default: they do not). KILL=<s>: the Lord dies that many seconds into the fight
// (the gold ending); without it the run lives to the dawn (grade 1). RAGE=<s>: the Lord drops to 45% hp at that second.
const APP = new URL('../app/', import.meta.url).pathname;
const { Room } = await import(APP + 'server/game.js');
const LIST = (process.env.WEAPONS ?? 'whip,bolt,knives,aura').split(',');
const KILL = +(process.env.KILL ?? 0), RAGE = +(process.env.RAGE ?? 0);

const start = Room.prototype.start;
Room.prototype.start = function startLate() {
	start.call(this);
	this.time = this.finPlan.warn - 6;
	this.bossIdx = this.bossAt.length - 1;
	this.events.next = Infinity;
	this.nextEliteT = this.nextInvasionT = Infinity;
	for (const h of this.heroes.values()) {
		h.weapons = new Map(LIST.map((id) => [id, { lvl: 3, t: 0.3, oc: 0 }]));
		this.recalcMods(h);
		this.updateCombos(h);
	}
};
const step = Room.prototype.step;
Room.prototype.step = function stepScripted(dt) {
	const L = this.fin?.lord;
	if (L && !L.dead && this.state === 'play' && this.time >= L.immuneT) {
		const t = this.time - this.fin.fightAt, h = [...this.heroes.values()][0];
		if (RAGE && t >= RAGE && L.hp > L.maxHp * 0.45) this.hurtEnemy(L, L.hp - L.maxHp * 0.45, h);
		if (KILL && t >= KILL) this.hurtEnemy(L, L.hp + 1, h);
	}
	return step.call(this, dt);
};
if (!process.env.HURT) Room.prototype.hurtPlayer = function noHurt() {};
// No level-up cards: in solo an offer pauses the run and hides the finale.
Room.prototype.grantOffer = function noOffer() {};
await import(APP + 'server/server.js');
