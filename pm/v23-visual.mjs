// Local visual check of the v23 results screen (not for prod): the real server, the run starts 6 s before the finale's
// warning with a mid build, BOTS=<n> standing bots join every started room, KILL=<s> kills the Lord that many seconds into
// the fight (default 8; 0 — the run lives to the dawn). Players take no damage unless HURT=1.
// PORT=3023 HORDE_RUNS_DIR=/tmp/horde-v23 BOTS=2 node pm/v23-visual.mjs
const APP = new URL('../app/', import.meta.url).pathname;
const { Room } = await import(APP + 'server/game.js');
const BOTS = +(process.env.BOTS ?? 2), KILL = +(process.env.KILL ?? 8);
const HEROES = ['witch', 'ranger', 'smith', 'herald', 'alchemist', 'stormcaller', 'spearmaiden'];
const LISTS = [['whip', 'bolt', 'knives', 'aura'], ['bolt', 'lightning', 'flask'], ['knives', 'sickle', 'trap'], ['orbit', 'frost', 'spear']];

const start = Room.prototype.start;
Room.prototype.start = function startLate() {
	for (let i = 0; i < BOTS; i++) this.addPlayer(900 + i, `Бот ${i + 1}`, HEROES[i % HEROES.length]);
	start.call(this);
	this.time = this.finPlan.warn - 6;
	this.bossIdx = this.bossAt.length - 1;
	this.events.next = Infinity;
	this.nextEliteT = this.nextInvasionT = Infinity;
	let k = 0;
	for (const h of this.heroes.values()) {
		const list = LISTS[k++ % LISTS.length];
		h.weapons = new Map(list.map((id) => [id, { lvl: 3 + (k % 3), t: 0.3, oc: 0 }]));
		this.recalcMods(h);
		this.updateCombos(h);
	}
	// A few fake facts so every block of the card has something: an event, a down, a lift, embers, an evolution time.
	this.runLog.events.push({ id: 'gold', name: 'Золотая тень', at: 380, end: 384, res: 1 }, { id: 'fog', name: 'Красный туман', at: 736, end: 766, res: 0 });
	const bots = [...this.heroes.values()].filter((h) => h.pid >= 900);
	if (bots[0]) {
		const p = this.runLog.p.get(bots[0].pid);
		p.downs.push([700, 'brute']);
		p.ups.push(705);
		bots[0].embers = { ember_dmg: 4, ember_cd: 2 };
	}
	for (const h of this.heroes.values()) this.runLog.p.get(h.pid)?.evos.push([540, 'blizzard']);
	if (bots[1]) bots[1].revives = 2;
};
const step = Room.prototype.step;
Room.prototype.step = function stepScripted(dt) {
	const L = this.fin?.lord;
	if (KILL && L && !L.dead && this.state === 'play' && this.time >= L.immuneT && this.time - this.fin.fightAt >= KILL) {
		const hs = [...this.heroes.values()];
		this.hurtEnemy(L, L.hp * 0.4, hs[1] ?? hs[0]);
		this.hurtEnemy(L, L.hp + 1, hs[0]);
	}
	for (const h of this.heroes.values()) while (h.pid >= 900 && h.offer) this.handle(h.pid, { t: 'pick', i: 0 });
	return step.call(this, dt);
};
if (!process.env.HURT) Room.prototype.hurtPlayer = function noHurt() {};
Room.prototype.grantOffer = function noOffer() {};
await import(APP + 'server/server.js');
