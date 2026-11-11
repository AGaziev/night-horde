// Test-only checkpoint: use the real altar offer, inventory mutation, freeze and Room.finish paths.
const { Room } = await import(process.env.APP + '/server/game.js');
const originalStart = Room.prototype.start;
Room.prototype.start = function (...args) {
	const result = originalStart.apply(this, args);
	this.time = this.runLength - 0.1;
	this.enemies.length = 0;
	this.spawn = () => {};
	this.bossAt = []; this.peaks = [];
	this.events.next = this.nextEliteT = this.nextInvasionT = Infinity;
	const h = this.heroes.get(1);
	h.iframes = 1e9;
	if (process.env.SIM_CHECKPOINT === 'stuck' || process.env.SIM_CHECKPOINT === 'pause') {
		this.setPaused(true);
		if (process.env.SIM_CHECKPOINT === 'pause') {
			const tick = this.tick;
			let calls = 0;
			this.tick = function (...tickArgs) {
				if (++calls === 12) this.setPaused(false);
				return tick.apply(this, tickArgs);
			};
		}
		return result;
	}
	if (process.env.SIM_CHECKPOINT === 'null') this.send(h.pid, { t: 'lvl', choices: null, closed: true });
	h.passives = new Map(['crit', 'mail', 'area', 'regen', 'magnet', 'swift'].map((id) => [id, 2]));
	this.recalcMods(h);
	this.offerAltarSwap(h);
	if (process.env.SIM_CHECKPOINT === 'epoch') {
		// Exercise epoch-aware transport even on an older APP which has no epoch guard itself.
		h.offerEpoch = 24;
		const handle = this.handle;
		this.handle = function (pid, msg) {
			if (['pick', 'ban', 'skip', 'reroll'].includes(msg.t) && msg.offerEpoch !== this.heroes.get(pid).offerEpoch) {
				throw new Error('offer action must echo the current epoch (24)');
			}
			return handle.call(this, pid, msg);
		};
	}
	this.updateFrozen();
	return result;
};
