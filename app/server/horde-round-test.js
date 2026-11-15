import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hub } from './game.js';
import { HORDE_ECONOMY, HORDE_PACKS } from '../public/shared/horde-content.js';

function encounter() {
	const messages = [];
	const hub = new Hub((pid, msg) => messages.push({ pid, msg: structuredClone(msg) }));
	hub.addPlayer(1, 'Director', 'round-director'); hub.addPlayer(2, 'Hero', 'round-hero');
	hub.handle(1, { t: 'create', hero: 'ranger', ruleset: 'horde' });
	const room = hub.players.get(1).room;
	hub.handle(2, { t: 'join', code: room.code, hero: 'ranger' });
	hub.handle(1, { t: 'start' });
	return { hub, room, messages };
}

test('a delayed first-round order cannot spend the rematch wallet or consume its first sequence', () => {
	const { hub, room } = encounter();
	const first = room.horde;
	const delayed = { t: 'horde', roundId: first.offerPrefix, action: 'spawn', pack: 'swarm', x: 1100, y: 0, seq: 1 };
	room.finish(false, 0, 'wipe');
	hub.handle(1, { t: 'again' }); hub.handle(1, { t: 'start' });
	const second = room.horde;
	assert.notEqual(second, first);
	hub.handle(1, delayed); // Represents an old POST accepted after the next round began.
	assert.equal(second.resource, HORDE_ECONOMY.start, 'the previous round cannot pay from the new wallet');
	assert.equal(second.pending.length, 0);
	assert.equal(second.lastSeq, 0, 'round validation must run before sequence acknowledgement');
	assert.notEqual(second.roundId, first.roundId);
	hub.handle(1, { ...delayed, roundId: second.roundId });
	assert.equal(second.lastSeq, 1, 'the current round can still use sequence one');
	assert.equal(second.resource, HORDE_ECONOMY.start - HORDE_PACKS.swarm.cost);
	assert.equal(second.pending.length, 1);
});

test('every Horde action requires the exact current round before validating its sequence', () => {
	const { hub, room } = encounter();
	const mode = room.horde;
	const offer = mode.offer, initial = mode.resource;
	for (const action of ['spawn', 'pick', 'reroll', 'unknown']) {
		for (const roundId of [undefined, null, '', `${mode.roundId}:old`]) {
			hub.handle(1, { t: 'horde', roundId, action, seq: 1, pack: 'swarm', x: 1100, y: 0, offerId: offer.id, choice: 0 });
			assert.equal(mode.lastSeq, 0, `${action} with stale/missing round cannot consume a sequence`);
			assert.equal(mode.resource, initial);
			assert.equal(mode.pending.length, 0);
			assert.equal(mode.offer, offer);
			assert.equal(mode.rerolls, 2);
		}
	}
	hub.handle(1, { t: 'horde', roundId: mode.roundId, seq: 1, action: 'pick', offerId: offer.id, choice: 0 });
	assert.equal(mode.lastSeq, 1); assert.equal(mode.picksTaken, 1);
});

test('rejoin keeps the same round identity and acknowledges a replay without paying twice', () => {
	const { hub, room, messages } = encounter();
	const mode = room.horde, id = mode.roundId;
	assert.equal(typeof id, 'string'); assert.ok(id.length >= 32);
	assert.equal(mode.privateState().roundId, id);
	const purchase = { t: 'horde', roundId: id, action: 'spawn', pack: 'swarm', x: 1100, y: 0, seq: 1 };
	hub.handle(1, purchase);
	const paid = mode.resource;
	hub.handle(1, { t: 'join', code: room.code });
	const restored = messages.findLast(({ pid, msg }) => pid === 1 && msg.t === 'horde').msg;
	assert.equal(restored.roundId, id); assert.equal(restored.lastSeq, 1);
	hub.handle(1, purchase);
	assert.equal(mode.resource, paid); assert.equal(mode.pending.length, 1);
	assert.equal(mode.roundId, id);
});
