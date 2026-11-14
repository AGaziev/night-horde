import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DprController } from '../public/js/display.js';

function fixture() {
	const previous = { window: globalThis.window, performance: globalThis.performance };
	let now = 1000;
	globalThis.window = { devicePixelRatio: 2, matchMedia: () => ({ matches: false }) };
	globalThis.performance = { now: () => now };
	const changes = [];
	const controller = new DprController(() => changes.push({ at: now, dpr: controller.value }));
	controller.frame();
	return {
		controller, changes, now: () => now,
		jump(ms) { now += ms; controller.frame(); },
		run(ms, frame = () => 1000 / 60) {
			const until = now + ms;
			let i = 0;
			while (now < until) { now += frame(i++); controller.frame(); }
		},
		restore() { globalThis.window = previous.window; globalThis.performance = previous.performance; },
	};
}

test('sustained missed frames reduce DPR even when mean frame interval stays below 20ms', () => {
	const f = fixture();
	try {
		// ~55 FPS: one missed 60Hz frame in twelve, mean ~18.1ms, p95 ~33.3ms.
		f.run(3600, (i) => i % 12 === 11 ? 1000 / 30 : 1000 / 60);
		assert.equal(f.controller.value, 1.5, 'three consistently uneven windows should reduce pixel work one step');
		assert.equal(f.changes.length, 1);
	} finally { f.restore(); }
});

test('one isolated long frame and ordinary 60Hz jitter keep native DPR', () => {
	const f = fixture();
	try {
		f.run(5000, (i) => i === 75 ? 110 : i % 2 ? 18 : 15.3);
		assert.equal(f.controller.value, 2);
		assert.equal(f.changes.length, 0);
	} finally { f.restore(); }
});

test('manual resolution stays pinned under a slow workload', () => {
	const f = fixture();
	try {
		f.controller.lock(1.5);
		f.run(6000, () => 1000 / 30);
		assert.equal(f.controller.value, 1.5);
		assert.equal(f.changes.length, 1);
	} finally { f.restore(); }
});

test('brief unevenness keeps resolution; recovery waits for backoff and eight healthy windows', () => {
	const f = fixture();
	try {
		const uneven = (i) => i % 12 === 11 ? 1000 / 30 : 1000 / 60;
		f.run(2200, uneven); assert.equal(f.controller.value, 2);
		f.run(1600, uneven); assert.equal(f.controller.value, 1.5);
		const retryAt = f.controller.retryAt;
		f.run(4000); assert.equal(f.controller.value, 1.5, 'short relief must not cause quality oscillation');
		f.run(Math.max(0, retryAt - f.now()) + 8500);
		assert.equal(f.controller.value, 2);
		assert.ok(f.changes.at(-1).at >= retryAt + 7000);
	} finally { f.restore(); }
});

test('persistent heavy frames stop at the existing DPR floor', () => {
	const f = fixture();
	try {
		f.run(15000, () => 1000 / 30);
		assert.equal(f.controller.value, 1);
		assert.deepEqual(f.changes.map((x) => x.dpr), [1.5, 1.25, 1]);
	} finally { f.restore(); }
});


test('a background suspension resets partial windows and recovery streaks', () => {
	const f = fixture();
	try {
		const uneven = (i) => i % 12 === 11 ? 1000 / 30 : 1000 / 60;
		f.run(2200, uneven); assert.equal(f.controller.value, 2);
		f.jump(10000); f.run(1200, uneven);
		assert.equal(f.controller.value, 2, 'old slow windows must not combine with resumed frames');
		f.run(2200, uneven); assert.equal(f.controller.value, 1.5);
		f.jump(60000); f.run(3000);
		assert.equal(f.controller.value, 1.5, 'suspended time is not a sequence of healthy frames');
		f.run(6000); assert.equal(f.controller.value, 2);
	} finally { f.restore(); }
});
