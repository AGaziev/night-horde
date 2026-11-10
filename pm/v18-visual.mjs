// Local visual check of v18 (not for prod): the real server with a fast Wave 4 schedule. Runs start at 45% of the
// length (specials are out), events come one after another every ~14 s in order, players take no damage.
// PORT=3018 HORDE_RUNS_DIR=/tmp/horde-v18 node pm/v18-visual.mjs
const APP = new URL('../app/', import.meta.url).pathname;
const C = await import(APP + 'public/shared/content.js');
const { Room } = await import(APP + 'server/game.js');
const { Events } = await import(APP + 'server/events.js');

C.EVENT_RULES.gap = [12, 14];
C.EVENT_RULES.peakGap = 0;
C.EVENT_RULES.bossGap = 0;
let k = +(process.env.EV0 ?? 0);
Events.prototype.pick = function pick() { return k++ % C.EVENTS.length; };
Events.prototype.blocked = () => false;
const start = Room.prototype.start;
Room.prototype.start = function startLate() {
	start.call(this);
	this.time = this.runLength * 0.45;
	this.bossIdx = this.bossAt.filter((t) => t < this.time).length;
	this.nextEliteT = this.nextInvasionT = Infinity;
	this.events.next = this.time + 4;
};
Room.prototype.hurtPlayer = function noHurt() {};
await import(APP + 'server/server.js');
const deal = Events.prototype.deal;
Events.prototype.deal = function logDeal(h, D) {
	console.log('altar deal', D.id, 'hero', Math.round(h.x), Math.round(h.y), 'altar', Math.round(this.cur.x), Math.round(this.cur.y), 'at', this.cur.at.toFixed(1), 'now', this.room.time.toFixed(1));
	return deal.call(this, h, D);
};
const onPos = Room.prototype.onPos;
Room.prototype.onPos = function logPos(pid, msg) {
	const h = this.heroes.get(pid);
	if (h && this.events.cur?.id === 'altar' && Math.hypot(msg.x - h.x, msg.y - h.y) > 1) console.log('moved', pid, msg.x, msg.y);
	return onPos.call(this, pid, msg);
};
