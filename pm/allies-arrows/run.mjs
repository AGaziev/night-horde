import { createRequire } from 'node:module';
const require = createRequire('/Users/a.gaziev/src/modules/node_modules/');
const { chromium } = require('playwright');
const URL = 'http://localhost:3611/';
const browser = await chromium.launch({ args: ['--mute-audio'] });
const mute = () => {
	class Dead { constructor() { this.state = 'suspended'; this.destination = {}; this.currentTime = 0; this.sampleRate = 44100; }
		resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
		createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} }; } }
	window.AudioContext = window.webkitAudioContext = Dead;
	window.__muted = true;
};
const clients = [
	{ name: 'Хост', vp: { width: 1280, height: 800 }, move: [] },
	{ name: 'Телефонщица', vp: { width: 375, height: 812 }, mobile: true, move: [['KeyA', 3500]] },
	{ name: 'Северянин', vp: { width: 900, height: 700 }, move: [['KeyD', 2600], ['KeyW', 1800]] },
	{ name: 'Лучник', vp: { width: 900, height: 700 }, move: [['KeyD', 3000], ['KeyW', 1500]] },
	{ name: 'Длинноимённый', vp: { width: 900, height: 700 }, move: [['KeyS', 3200]] },
];
const pages = [];
for (const c of clients) {
	const ctx = await browser.newContext({ viewport: c.vp, deviceScaleFactor: c.mobile ? 2 : 1, isMobile: !!c.mobile, hasTouch: !!c.mobile });
	const p = await ctx.newPage();
	p.on('pageerror', (e) => console.log(c.name, 'pageerror', e.message));
	p.on('console', (m) => { if (m.type() === 'error') console.log(c.name, 'console', m.text()); });
	await p.goto(URL + '?unlockall=1');
	await p.fill('#menu-name', c.name);
	pages.push(p);
}
await pages[0].click('#menu-create');
await pages[0].waitForFunction(() => /^[A-Z0-9]{3,}$/.test(document.getElementById('lobby-code').textContent.trim()));
const code = (await pages[0].textContent('#lobby-code')).trim();
console.log('room', code);
for (const p of pages.slice(1)) { await p.fill('#menu-code', code); await p.click('#menu-join'); }
await pages[0].waitForTimeout(800);
for (const p of pages.slice(1)) { const b = await p.$('#lobby-ready'); if (b && await b.isVisible()) await b.click(); }
await pages[0].waitForTimeout(500);
await pages[0].click('#lobby-start');
await pages[0].waitForFunction(() => !document.getElementById('hud').hidden, null, { timeout: 15000 });
console.log('started; muted:', await pages[0].evaluate(() => window.__muted));
await Promise.all(pages.map(async (p, i) => {
	for (const [k, ms] of clients[i].move) { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); }
}));
const pick = () => Promise.all(pages.map(async (p) => { for (let k = 0; k < 4; k++) { if (await p.evaluate(() => !document.getElementById('levelup').hidden)) { await p.keyboard.press('Digit1'); await p.waitForTimeout(250); } } }));
await pick();
await pages[0].waitForTimeout(600);
const shot = async (i, f) => { await pages[i].screenshot({ path: f }); console.log('shot', f); };
const clean = async (i, f) => { await pages[i].evaluate(() => { document.getElementById('levelup').hidden = true; }); await pages[i].waitForTimeout(150); await shot(i, f); };
await shot(0, 'desk-standing.png');
await shot(1, 'phone-standing-cards.png');
await clean(1, 'phone-standing.png');
const dump = (i) => pages[i].evaluate(() => [...document.querySelectorAll('.fx-arrow')].filter((e) => e.style.display !== 'none').map((e) => e.className + ' ' + e.textContent));
console.log('host arrows', JSON.stringify(await dump(0)));
console.log('phone arrows', JSON.stringify(await dump(1)));
// wait for the downed ally (server downs the last hero at ~14 s)
await pages[0].waitForTimeout(9000);
await pick();
await pages[0].waitForTimeout(400);
await shot(0, 'desk-down.png');
await shot(1, 'phone-down-cards.png');
await clean(1, 'phone-down.png');
console.log('host arrows', JSON.stringify(await dump(0)));
console.log('phone arrows', JSON.stringify(await dump(1)));
// level-up cards on the phone, if open
const lv = await pages[1].evaluate(() => !document.getElementById('levelup').hidden);
console.log('phone levelup open', lv);
const titles = await pages[0].evaluate(() => [...document.querySelectorAll('#hud-weapons .hud-icon, #hud-passives .hud-icon')].map((e) => e.title));
console.log('hud titles', JSON.stringify(titles));
await browser.close();
