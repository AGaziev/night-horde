// Transport and completion checks only. The bot's choices, movement and RNG live in run-sim.mjs.
function diagnostic(code, room, details = {}) {
	return new Error(`${code} ${JSON.stringify({
		...details, state: room.state, time: room.time, runLength: room.runLength, frozen: room.frozen, paused: room.paused,
		heroes: [...room.heroes.values()].map((h) => ({ pid: h.pid, st: h.st, hp: h.hp, queue: h.queue,
			offerEpoch: h.offerEpoch, offer: h.offer?.map((c) => ({ id: c.id, kind: c.kind })) })),
	})}`);
}

export function queueOffer(pending, pid, msg) {
	if (msg.t === 'lvl' && msg.choices?.length) pending.push(pid);
}

export function drainOffers(room, pending, choose, chooseBan) {
	let actions = 0;
	function act(h, action) {
		if (++actions > 1000) throw diagnostic('SIMULATION_OFFER_LIMIT', room);
		const before = { offer: h.offer, signature: JSON.stringify(h.offer), epoch: h.offerEpoch, bans: h.bans };
		// A ban or asynchronous reward can replace the queued card array. Always act on the current offer/epoch.
		if (h.offerEpoch !== undefined) action.offerEpoch = h.offerEpoch;
		room.handle(h.pid, action);
		if (room.state === 'play' && h.offer === before.offer && JSON.stringify(h.offer) === before.signature
			&& h.offerEpoch === before.epoch && h.bans === before.bans) {
			throw diagnostic('SIMULATION_OFFER_REJECTED', room, { pid: h.pid, action });
		}
	}
	while (pending.length) {
		const pid = pending.shift(), h = room.heroes.get(pid);
		if (!h?.offer?.length) continue; // An earlier action may already have consumed this notification.
		for (let b = chooseBan(h, h.offer); b >= 0 && h.offer; b = h.offer ? chooseBan(h, h.offer) : -1) act(h, { t: 'ban', i: b });
		if (h.offer) {
			const i = choose(h, h.offer), card = h.offer[i];
			if (!card) throw diagnostic('SIMULATION_INVALID_CHOICE', room, { pid, i });
			const action = { t: 'pick', i };
			if (card.kind === 'swap') {
				action.drop = card.replace?.[0]?.id; // First selectable artifact, without an additional build optimization.
				if (!action.drop) throw diagnostic('SIMULATION_INVALID_SWAP', room, { pid, i });
			}
			act(h, action);
		}
	}
	if (room.state === 'play' && [...room.heroes.values()].some((h) => h.offer?.length)) {
		throw diagnostic('SIMULATION_OFFER_PENDING', room);
	}
}

export function runToTerminal(room, { k, seconds, tickHz, maxIterations = Math.ceil(seconds * tickHz) * 2 + 1000 }, step) {
	if (!Number.isSafeInteger(maxIterations) || maxIterations <= 0) throw new Error('Invalid simulation iteration budget');
	let iterations = 0, finishCalls = 0;
	const finish = room.finish, ownFinish = Object.hasOwn(room, 'finish');
	room.finish = function (...args) { finishCalls++; return finish.apply(this, args); };
	try {
		while (room.state === 'play' && iterations < maxIterations) step(iterations++);
		if (room.state !== 'over' || !room.lastLog || finishCalls < 1) {
			throw diagnostic('SIMULATION_NOT_TERMINAL', room, { k, seconds, iterations, maxIterations, finishCalls });
		}
		const log = room.lastLog;
		return { log, completion: { k, terminal: true, state: room.state, time: room.time, runLength: room.runLength,
			win: log.win, logId: log.id, iterations, finishCalls } };
	} finally {
		if (ownFinish) room.finish = finish;
		else delete room.finish;
	}
}
