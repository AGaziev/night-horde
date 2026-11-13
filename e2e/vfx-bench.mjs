// Issue #11: checks the visual settings in a real browser and measures frame time with many enemies.
// Starts the game server in this process with a stress hook (heroes immortal, cards picked automatically,
// the run fast-forwarded to FF seconds with seeded Math.random), then plays solo in headless Chrome (--mute-audio).
//
//   node e2e/vfx-bench.mjs                       # checks + measurement of this checkout
//   APP=/path/to/other/app CHECK=0 node e2e/vfx-bench.mjs   # baseline: measurement only (no settings UI there)
//
// Env: APP (default ../app), PORT (3571), BOTS (server-side heroes next to the player, 7), FF (seconds to skip, 360), MS (measured ms per run, 8000), ROUNDS (3),
// GPU (1; 0 = --disable-gpu, canvas rasterized on the CPU like a weak laptop), THROTTLE (CDP CPU slowdown, 1), HERO (stormcaller), VARIANTS ("all/full,crits/full,off/lite"), SHOT (settings screenshot path), PLAYWRIGHT (module path).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const APP = path.resolve(process.env.APP ?? new URL('../app/', import.meta.url).pathname);
const PORT = +(process.env.PORT ?? 3571);
const FF = +(process.env.FF ?? 360);
const MS = +(process.env.MS ?? 8000);
const ROUNDS = +(process.env.ROUNDS ?? 3);
const HERO = process.env.HERO ?? 'stormcaller';
const BOTS = +(process.env.BOTS ?? 7);
const GPU = process.env.GPU !== '0';
const THROTTLE = +(process.env.THROTTLE ?? 1);
const CHECK = process.env.CHECK !== '0';
const VARIANTS = (process.env.VARIANTS ?? 'all/full,crits/full,off/lite').split(',').map((v) => {
	const [numbers, effects] = v.split('/');
	return { numbers, effects };
});

function loadPlaywright() {
	const tries = [process.env.PLAYWRIGHT, 'playwright'];
	try {
		const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
		tries.push(path.join(root, 'playwright'), path.join(root, '@playwright/test'));
	} catch { /* no npm */ }
	for (const t of tries.filter(Boolean)) {
		try { return createRequire(import.meta.url)(t); } catch { /* next */ }
	}
	throw new Error('playwright not found: npm i -g playwright or set PLAYWRIGHT=<path to the module>');
}

// --- server with the stress hook ---
process.env.PORT = String(PORT);
const ownRuns = !process.env.HORDE_RUNS_DIR;
process.env.HORDE_RUNS_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'horde-bench-runs-'));
const { Room } = await import(path.join(APP, 'server/game.js'));
const { TICK_HZ } = await import(path.join(APP, 'public/shared/content.js'));

function seeded(seed) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function keepAlive(room) {
	for (const h of room.heroes.values()) {
		if (h.offer?.length) room.handle(h.pid, { t: 'pick', i: 0, offerEpoch: h.offerEpoch });
		if (h.st === 0) h.hp = h.maxHp;
	}
}
// Bots: silent members that stand at the spawn with the player, so the horde and the effects gather on screen.
const BOT_HEROES = ['knight', 'witch', 'ranger', 'herald', 'smith', 'alchemist', 'spearmaiden'];
const start = Room.prototype.start;
Room.prototype.start = function (...a) {
	for (let i = 0; i < BOTS && this.members.size < 8; i++) this.addPlayer(90000 + i, `Бот ${i + 1}`, BOT_HEROES[i % BOT_HEROES.length]);
	return start.apply(this, a);
};
const tick = Room.prototype.tick;
Room.prototype.tick = function (dt) {
	if (this.state === 'play') {
		if (!this.benchFF) {
			this.benchFF = true;
			Math.random = seeded(11);
			const send = this.send;
			this.send = () => {};
			const step = 1 / TICK_HZ;
			for (let i = 0; i < FF * TICK_HZ && this.state === 'play'; i++) {
				keepAlive(this);
				tick.call(this, step);
			}
			this.send = send;
		}
		keepAlive(this);
	}
	return tick.call(this, dt);
};
await import(path.join(APP, 'server/server.js'));

// --- browser ---
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true, args: ['--mute-audio', ...(GPU ? [] : ['--disable-gpu'])] });
const base = `http://localhost:${PORT}/`;
const failures = [];
const check = (ok, msg) => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
	if (!ok) failures.push(msg);
};

async function openPage(visual) {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
	await ctx.addInitScript(([hero, vfx]) => {
		if (sessionStorage.getItem('bench.init')) return;
		sessionStorage.setItem('bench.init', '1');
		localStorage.setItem('nh.unlockall', '1');
		localStorage.setItem('nh.hero', hero);
		localStorage.setItem('nh.name', 'Bench');
		if (vfx) localStorage.setItem('nh.vfx', vfx);
		else localStorage.removeItem('nh.vfx');
	}, [HERO, visual ? JSON.stringify(visual) : '']);
	const page = await ctx.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	await page.goto(base);
	await page.waitForFunction(() => window.__nh?.ui?.screen === 'menu');
	return { ctx, page, errors };
}

async function startRun(page) {
	await page.click('#menu-create');
	await page.waitForFunction(() => window.__nh.ui.screen === 'lobby');
	await page.click('#lobby-start');
	await page.waitForFunction(() => window.__nh.ui.screen === 'game' && window.__nh.game.view?.b?.e?.length > 0, null, { timeout: 60000 });
	await page.evaluate(() => window.__nh.renderer.dprCtl.lock(2));
	if (THROTTLE > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
	await page.waitForTimeout(2500);
}

// Frame intervals from rAF and the JS time of renderer.draw; also samples what is on screen.
function measure(page) {
	return page.evaluate(async (ms) => {
		const { renderer: r, game: g } = window.__nh;
		const draw = r.draw, draws = [], frames = [], seen = { enemies: 0, numbers: 0, particles: 0, n: 0, nonCrit: 0 };
		r.draw = function (...a) {
			const t0 = performance.now();
			draw.apply(this, a);
			draws.push(performance.now() - t0);
		};
		await new Promise((res) => {
			let last = performance.now();
			const end = last + ms;
			requestAnimationFrame(function f(now) {
				frames.push(now - last);
				last = now;
				let on = 0;
				const e = g.view.b?.e ?? [];
				for (let i = 0; i < e.length; i += 6) if (r.visible(e[i + 2], e[i + 3])) on++;
				seen.enemies += on;
				seen.numbers += g.numbers.length;
				seen.nonCrit += g.numbers.filter((n) => !n.crit).length;
				seen.particles += g.particles.length;
				seen.n++;
				if (now < end) requestAnimationFrame(f);
				else res();
			});
		});
		r.draw = draw;
		frames.shift();
		return { frames, draws, enemies: seen.enemies / seen.n, numbers: seen.numbers / seen.n, nonCrit: seen.nonCrit, particles: seen.particles / seen.n, tm: g.view.tm };
	}, MS);
}

const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// --- checks of the settings UI (candidate only) ---
if (CHECK) {
	const { ctx, page, errors } = await openPage(null);
	await page.click('#snd-more');
	check(await page.isVisible('#snd-panel'), 'settings panel opens from ⋯');
	const checked = (name) => page.evaluate((n) => document.querySelector(`input[name="${n}"]:checked`)?.value, name);
	check(await checked('vfx-numbers') === 'all' && await checked('vfx-effects') === 'full', 'defaults: numbers «Все», effects «Полные»');
	await page.click('input[name="vfx-numbers"][value="crits"]');
	await page.click('input[name="vfx-effects"][value="lite"]');
	const stored = await page.evaluate(() => localStorage.getItem('nh.vfx'));
	check(stored === '{"numbers":"crits","effects":"lite"}', `choice stored in localStorage: ${stored}`);
	if (process.env.SHOT) {
		const a = await page.locator('#snd').boundingBox(), b = await page.locator('#snd-panel').boundingBox();
		const x = Math.min(a.x, b.x) - 8, y = Math.min(a.y, b.y) - 8;
		const clip = { x, y, width: Math.max(a.x + a.width, b.x + b.width) + 8 - x, height: Math.max(a.y + a.height, b.y + b.height) + 8 - y };
		await page.screenshot({ path: process.env.SHOT, clip });
		console.log(`screenshot: ${process.env.SHOT}`);
	}
	await page.reload();
	await page.waitForFunction(() => window.__nh?.ui?.screen === 'menu');
	const after = await page.evaluate(() => window.__nh.game.visual);
	check(after.numbers === 'crits' && after.effects === 'lite', 'choice survives a reload');
	check(await checked('vfx-numbers') === 'crits' && await checked('vfx-effects') === 'lite', 'radios show the stored choice after reload');
	// Keyboard: arrows move the choice inside a group.
	await page.click('#snd-more');
	await page.focus('input[name="vfx-numbers"][value="crits"]');
	await page.keyboard.press('ArrowRight');
	check(await page.evaluate(() => window.__nh.game.visual.numbers) === 'off', 'keyboard arrows switch the numbers setting');
	await page.keyboard.press('Escape');
	check(await page.evaluate(() => document.getElementById('snd-panel').hidden && document.activeElement === document.body),
		'Esc closes the panel and drops focus');
	// In a run a focused radio must not swallow the movement keys.
	await startRun(page);
	await page.click('#snd-more');
	await page.click('input[name="vfx-effects"][value="full"]');
	await page.focus('input[name="vfx-effects"][value="full"]');
	const x0 = await page.evaluate(() => window.__nh.game.local.x);
	await page.keyboard.down('KeyD');
	await page.waitForTimeout(400);
	await page.keyboard.up('KeyD');
	const x1 = await page.evaluate(() => window.__nh.game.local.x);
	check(x1 - x0 > 20, `WASD moves the hero while a radio is focused (dx ${(x1 - x0).toFixed(0)})`);
	check(!errors.length, `no page errors ${errors.join(' | ')}`);
	await ctx.close();
}

// --- measurement ---
const variants = CHECK ? VARIANTS : [null];
const rows = new Map();
for (let round = 0; round < ROUNDS; round++) {
	for (const v of variants) {
		const key = v ? `${v.numbers}/${v.effects}` : 'baseline';
		const { ctx, page, errors } = await openPage(v);
		const calls = {};
		if (CHECK && v?.effects === 'lite') {
			// Dodge information must still be drawn in the simplified mode.
			await page.evaluate(() => {
				const r = window.__nh.renderer;
				window.__calls = {};
				for (const m of ['drawWarns', 'drawWindupWarnings', 'drawHostile', 'drawOrbShots', 'drawEventGround', 'drawOutposts']) {
					const f = r[m];
					r[m] = function (...a) { window.__calls[m] = (window.__calls[m] ?? 0) + 1; return f.apply(this, a); };
				}
			});
		}
		await startRun(page);
		const m = await measure(page);
		if (CHECK && v?.effects === 'lite') Object.assign(calls, await page.evaluate(() => window.__calls));
		if (CHECK && v) {
			if (v.numbers === 'off') check(m.numbers === 0, `${key}: no damage numbers on screen`);
			if (v.numbers === 'crits') check(m.nonCrit === 0, `${key}: only crit numbers on screen (avg ${m.numbers.toFixed(1)})`);
			if (v.effects === 'lite') {
				// drawOrbShots runs only while sniper orbs exist, so it is reported but not required.
				const always = ['drawWarns', 'drawWindupWarnings', 'drawHostile', 'drawEventGround', 'drawOutposts'];
				check(always.every((k) => calls[k] > 0), `${key}: warnings and enemy shots still drawn ${JSON.stringify(calls)}`);
			}
		}
		check(!errors.length, `${key}: no page errors ${errors.join(' | ')}`);
		const row = rows.get(key) ?? { frames: [], draws: [], enemies: [], numbers: [], particles: [], tm: [] };
		row.frames.push(...m.frames);
		row.draws.push(...m.draws);
		row.enemies.push(m.enemies);
		row.numbers.push(m.numbers);
		row.particles.push(m.particles);
		row.tm.push(m.tm);
		rows.set(key, row);
		await ctx.close();
	}
}

console.log(`\nAPP=${APP} BOTS=${BOTS} FF=${FF}s MS=${MS} ROUNDS=${ROUNDS} hero=${HERO} GPU=${+GPU} THROTTLE=${THROTTLE}× viewport 1440×900 @2x, headless Chrome, --mute-audio`);
console.log('variant         | game time | enemies on screen | numbers | particles | frame ms mean / p95 | FPS  | draw() ms mean / p95');
for (const [key, r] of rows) {
	const fm = mean(r.frames);
	console.log(`${key.padEnd(15)} | ${mean(r.tm).toFixed(0).padStart(6)} s  | ${mean(r.enemies).toFixed(0).padStart(17)} | ${mean(r.numbers).toFixed(1).padStart(7)} | ${mean(r.particles).toFixed(0).padStart(9)} | ${fm.toFixed(2).padStart(8)} / ${pct(r.frames, 0.95).toFixed(2).padStart(6)} | ${(1000 / fm).toFixed(1).padStart(4)} | ${mean(r.draws).toFixed(2).padStart(8)} / ${pct(r.draws, 0.95).toFixed(2)}`);
}
await browser.close();
if (ownRuns) fs.rmSync(process.env.HORDE_RUNS_DIR, { recursive: true, force: true });
if (failures.length) {
	console.log(`\n${failures.length} check(s) failed`);
	process.exit(1);
}
process.exit(0);
