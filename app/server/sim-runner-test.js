import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { queueOffer, drainOffers } from '../../pm/sim-runner.mjs';

const root = new URL('../../', import.meta.url);
function run(checkpoint, seconds = '900') {
	const env = { ...process.env, APP: fileURLToPath(new URL('app', root)), MODE: 'night', SIM_CHECKPOINT: checkpoint, K0: '0' };
	for (const key of ['MODE_DMG', 'MODE_HP', 'LATE_DMG', 'LATE_HP', 'FIN_HP', 'FIN_DMG', 'FIN_RATE', 'FIN_REVIVE', 'FLEE', 'H_OVR', 'H_REACT', 'H_SEE', 'NOBAN', 'TICKS']) delete env[key];
	return spawnSync(process.execPath, [
		'--import', fileURLToPath(new URL('pm/test-runtime.mjs', root)),
		'--import', fileURLToPath(new URL('pm/fixtures/sim-runner-checkpoint.mjs', root)),
		fileURLToPath(new URL('pm/run-sim.mjs', root)), '1', '1', 'human', seconds,
	], { env, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
}
function terminal(result) {
	assert.equal(result.status, 0, result.stderr || String(result.error));
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.logs.length, 1);
	const log = payload.logs[0];
	assert.equal(log.win, true, 'the healthy hero reaches the real run ending after the checkpoint');
	assert.equal(payload.completion.length, 1);
	const completed = payload.completion[0];
	assert.equal(completed.terminal, true);
	assert.equal(completed.state, 'over');
	assert.equal(completed.finishCalls, 1, 'the log came from an actual Room.finish call');
	assert.equal(completed.k, 0);
	assert.equal(completed.logId, log.id);
	assert.equal(completed.win, log.win);
	assert.equal(completed.runLength, 900);
	assert.equal(completed.runLength, log.runLength);
	return log;
}

test('sim runner: a real altar swap chooses the first replacement, unfreezes and reaches Room.finish', () => {
	const log = terminal(run('altar'));
	assert.ok(log.team[0].picks.some((p) => p[2] === 'pick' && p[4] === 'swap'), 'the altar offer was actually accepted');
	assert.ok(!log.team[0].build.passives.some((id) => id.startsWith('crit')), 'the first selectable artifact was replaced');
});
test('sim runner: closed/null choices notifications do not crash the offer receiver', () => {
	terminal(run('null'));
});
test('sim runner: offer actions carry the current epoch, including epoch 24', () => {
	terminal(run('epoch'));
});
test('sim runner: finite paused iterations do not truncate a run into a loss', () => {
	terminal(run('pause', '0.1'));
});
test('sim runner: an unfinished room fails with diagnostics and produces no loss record', () => {
	const result = run('stuck', '0.1');
	assert.notEqual(result.status, 0, 'a nonterminal attempt must fail the CLI');
	assert.match(result.stderr, /SIMULATION_NOT_TERMINAL/);
	assert.match(result.stderr, /"state":"play"/);
	assert.match(result.stderr, /"paused":true/);
	assert.equal(result.stdout.trim(), '', 'there is no fabricated loss JSON');
});

// Transport contract tests complement the real Room checkpoint above (including APPs without native epochs).
for (const first of ['ban', 'pick']) test(`sim runner: ${first} replacement is processed with the new epoch and card array`, () => {
	const pending = [], actions = [];
	const original = [{ id: 'old', kind: 'weapon' }], replacement = [{ id: 'replacement', kind: 'weapon' }];
	const h = { pid: 1, offer: original, offerEpoch: 24, bans: first === 'ban' ? 1 : 0 };
	const room = { state: 'play', heroes: new Map([[1, h]]), handle(pid, msg) {
		assert.equal(msg.offerEpoch, h.offerEpoch, 'every action uses the current server epoch');
		actions.push({ ...msg });
		if (actions.length === 1) {
			h.offer = replacement; h.offerEpoch = 25; h.bans = 0;
			queueOffer(pending, pid, { t: 'lvl', choices: h.offer, offerEpoch: 25 });
		} else h.offer = null;
	} };
	queueOffer(pending, 1, { t: 'lvl', choices: original, offerEpoch: 24 });
	const seen = [];
	drainOffers(room, pending, (_h, choices) => { seen.push(choices[0].id); return 0; }, () => h.bans ? 0 : -1);
	assert.deepEqual(actions.map((a) => [a.t, a.offerEpoch]), [[first, 24], ['pick', 25]]);
	assert.deepEqual(seen, first === 'ban' ? ['replacement'] : ['old', 'replacement']);
	assert.equal(h.offer, null, 'the refreshed offer is consumed rather than left pending');
});

test('sim runner: an unchanged rejected offer action fails rather than hanging or counting a loss', () => {
	const h = { pid: 1, offer: [{ id: 'old', kind: 'weapon' }], offerEpoch: 24 };
	const room = { state: 'play', heroes: new Map([[1, h]]), handle() {} };
	assert.throws(() => drainOffers(room, [1], () => 0, () => -1), /SIMULATION_OFFER_REJECTED/);
});
