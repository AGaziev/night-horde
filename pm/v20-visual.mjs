// Local visual check of v20 (not for prod): the real server, players take no damage, every hero starts at 45% of the run with
// six level-5 weapons and four artifacts, so overclock offers come at once.
// PORT=3020 HORDE_RUNS_DIR=/tmp/horde-v20 node pm/v20-visual.mjs
// SCN=ovr (default): 3 queued offers — overclock pair + an artifact upgrade, then a boss chest (cards one by one), then one more.
// SCN=emb: everything is maxed and overclocked — embers only (HUD totals). SCN=shown: every weapon already overclocked
// with variant V (1|2) from WEAPONS csv, no offers — to look at the weapons themselves.
const APP = new URL('../app/', import.meta.url).pathname;
const C = await import(APP + 'public/shared/content.js');
const { Room } = await import(APP + 'server/game.js');
const SCN = process.env.SCN ?? 'ovr';
const LIST = (process.env.WEAPONS ?? 'whip,bolt,knives,ward,lantern,frost').split(',');
const V = +(process.env.V ?? 1);
// Defaults: no duo pairs among the weapons and no evolutions with these artifacts.
const PASS = (process.env.PASS ?? 'crit,mail,area,regen').split(',');

const start = Room.prototype.start;
Room.prototype.start = function startLate() {
	start.call(this);
	this.time = this.runLength * 0.45;
	this.bossIdx = this.bossAt.filter((t) => t < this.time).length;
	this.events.next = Infinity;
	for (const h of this.heroes.values()) {
		h.weapons = new Map(LIST.map((id) => [id, { lvl: 5, t: 0.3, oc: SCN === 'ovr' ? 0 : V }]));
		// SCN=ovr: one artifact upgrade left, so the overclock pair is offered (it waits while 2+ regular cards remain).
		h.passives = new Map(PASS.map((id, k) => [id, SCN === 'ovr' && k === 0 ? 4 : 5]));
		if (SCN !== 'ovr') for (const id of PASS) h.banned.add('passive:' + id);
		this.recalcMods(h);
		this.updateCombos(h);
		// The offers go out once the client has the start message and a first snapshot.
		setTimeout(() => {
			if (SCN === 'ovr') {
				this.grantOffer(h);
				this.grantOffer(h, false, C.CHEST_FLOOR.boss, true);
				this.grantOffer(h);
			} else if (SCN === 'emb') {
				for (let k = 0; k < 4; k++) this.grantOffer(h);
			}
			this.updateFrozen();
		}, 1500);
	}
};
Room.prototype.hurtPlayer = function noHurt() {};
await import(APP + 'server/server.js');
