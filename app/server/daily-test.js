import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunStore } from './runlog.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room, Hub } from './game.js';
import { DAILY_RULES, dailyFor, dailyKey, compareDaily } from '../public/shared/daily.js';
import { HEROES, MODES, ENEMIES } from '../public/shared/content.js';

function make(id, mode = 'lunch', n = 1) {
 const sent = [];
 const r = new Room('DAILY1', (pid, msg) => sent.push(msg));
 for (let i = 1; i <= n; i++) r.addPlayer(i, 'Player ' + i, 'witch');
 r.setMode(mode);
 if (id) {
  r.handle(1, { t: 'daily', enabled: true });
  let day = Date.UTC(2026, 10, 13);
  while (dailyFor(day).id !== id) day += 86400000;
  r.lockDaily(day);
 }
 return { r, sent };
}

test('four canonical pairs rotate by server UTC date, independently of local offsets', () => {
 const dates = Array.from({ length: 8 }, (_, i) => dailyFor(Date.UTC(2026, 10, 13 + i)));
 assert.equal(new Set(dates.slice(0, 4).map(d => d.id)).size, 4);
 assert.equal(dates[0].id, dates[4].id);
 assert.deepEqual(dailyFor('2026-11-13T01:00:00+02:00'), dailyFor('2026-11-12T23:00:00Z'));
 assert.notEqual(dailyFor('2026-11-13T23:59:59Z').id, dailyFor('2026-11-14T00:00:00Z').id);
 assert.ok(Object.isFrozen(DAILY_RULES[0].mods));
});

test('only host can select; countdown freezes day/mode; cancel and retry obtain a new contract', () => {
 const hub = new Hub(() => {});
 hub.addPlayer(1, 'Host'); hub.addPlayer(2, 'Guest');
 hub.handle(1, { t: 'create', hero: 'witch', mode: 'lunch' });
 const r = hub.players.get(1).room;
 hub.handle(2, { t: 'join', code: r.code, hero: 'witch' });
 r.handle(2, { t: 'daily', enabled: true });
 assert.equal(r.dailySelected, false);
 r.handle(1, { t: 'daily', enabled: true });
 assert.equal(r.lobbyMsg().dailySelected, true);
 r.lockDaily(Date.UTC(2026, 10, 13, 23, 59));
 const locked = r.daily;
 assert.equal(hub.scheduleStart(r, 1, Date.now() + 60000), true);
 r.handle(1, { t: 'daily', enabled: false });
 r.handle(1, { t: 'mode', mode: 'night' });
 assert.equal(r.mode, 'lunch'); assert.equal(r.daily.day, locked.day);
 r.addPlayer(3, 'Invited', 'ranger');
 r.start();
 assert.equal(r.daily.day, locked.day); assert.equal(r.daily.players, 3);
 assert.equal(r.startMsg().daily, r.daily);
 r.removePlayer(3);
 assert.equal(r.daily.players, 3, 'leaving cannot improve the record category');
 r.toLobby();
 assert.equal(r.daily, null); assert.equal(r.dailySelected, true);
 r.lockDaily(Date.UTC(2026, 10, 14));
 assert.notEqual(r.daily.day, locked.day);
 assert.equal(hub.scheduleStart(r, 1, Date.now() + 60000), true);
 r.cancelStart(); assert.equal(r.daily, null);
});

test('health/damage modifiers survive upgrades without compounding; normal modes keep baseline', () => {
 for (const mode of Object.keys(MODES)) {
  const { r } = make('glass', mode); r.start(); const h = r.heroes.get(1);
  assert.equal(r.runLength, MODES[mode].seconds);
  assert.equal(h.hp, HEROES.witch.hp * 0.7); assert.equal(h.mods.dmgMul, 1.2);
  h.passives.set('vigor', 1); r.recalcMods(h);
  const maximum = h.maxHp; r.recalcMods(h);
  assert.equal(h.maxHp, maximum); assert.equal(maximum, (HEROES.witch.hp + 20) * 0.7);
  assert.ok(Math.abs(h.mods.dmgMul - 1.025 * 1.2) < 1e-9);
  const { r: ordinary } = make(null, mode); ordinary.start();
  assert.equal(ordinary.heroes.get(1).hp, HEROES.witch.hp);
  assert.equal(ordinary.heroes.get(1).mods.dmgMul, 1);
  r.setPaused(true); r.step(1); assert.equal(r.time, 0, 'solo pause is preserved');
 }
});

test('XP, armor/speed, and pickup/enemy health apply at their actual consumers', () => {
 const { r: swarm } = make('swarm'); swarm.start(); const sh = swarm.heroes.get(1);
 swarm.addXp(sh, 1); assert.equal(sh.xp, 1.15);
 const { r: ordinary } = make(null); ordinary.start();
 swarm.spawn(0.01, [sh]); ordinary.spawn(0.01, [...ordinary.heroes.values()]);
 assert.ok(Math.abs(swarm.spawnAcc / ordinary.spawnAcc - 1.15) < 1e-9);
 const { r: armor } = make('armor'); armor.start(); const ah = armor.heroes.get(1);
 assert.equal(ah.mods.armor, 2); assert.equal(ah.mods.speedMul, 0.9);
 armor.hurtPlayer(ah, 10); assert.equal(ah.hp, ah.maxHp - 8);
 const { r: gather } = make('gather'); gather.start(); const gh = gather.heroes.get(1);
 assert.equal(gh.mods.magnetMul, 1.3);
 for (const type of ['skel', 'boss']) {
  const enemy = gather.spawnEnemy(type, [gh], 1);
  assert.equal(enemy.maxHp, ENEMIES[type].hp * gather.modeHp * 1.15);
 }
});

test('run result and reconnect retain contract; daily runs never grant ordinary achievements', () => {
 const { r, sent } = make('armor', 'night', 2); r.start();
 r.time = 80; r.kills = 15; r.finish(true, 2);
 assert.equal(r.overMsg.daily.players, 2);
 assert.ok(r.overMsg.stats.every(s => s.ach === null && s.tot === undefined));
 r.resync(1); assert.equal(sent.at(-1), r.overMsg);
 assert.equal(dailyKey(r.daily), `1:${r.daily.day}:night:2`);
 assert.ok(compareDaily({ grade: 2, time: 50 }, { grade: 1, time: 900 }) > 0);
 assert.ok(compareDaily({ grade: 0, time: 90, kills: 1 }, { grade: 0, time: 50, kills: 900 }) > 0);
});


test('daily history, personal best and completion persist separately, including after log pruning', (t) => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'horde-daily-'));
 t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
 const store = new RunStore(); store.persist(dir);
 const daily = { ...dailyFor(Date.UTC(2026, 10, 13)), mode: 'lunch', players: 2 };
 const record = (i, data = {}) => ({ id: 'D' + String(i).padStart(5, '0'), at: new Date(Date.UTC(2026, 10, 13) + i * 1000).toISOString(),
  mode: 'lunch', team: [{ name: 'Player', hero: 'witch', level: 1 }], summary: [], win: false, grade: 0, time: 40, kills: 3, ...data });
 store.add(record(1, { daily, win: true, grade: 2 }), ['111', '222']);
 store.add(record(2, { daily, time: 600, kills: 999 }), ['111']);
 store.add(record(3, { daily: { ...daily, players: 1 }, time: 200 }), ['111']);
 let history = store.history('111');
 assert.equal(history.recent.length, 0); assert.equal(history.daily.mine.length, 3);
 assert.equal(history.daily.best.length, 2);
 assert.equal(history.daily.best.find(r => r.daily.players === 2).id, 'D00001');
 assert.equal(history.daily.best.find(r => r.daily.players === 2).completed, true);
 assert.equal(store.history('222').daily.best.length, 1);
 assert.deepEqual(store.history(null).daily.best, []);
 assert.doesNotMatch(JSON.stringify(history), /"uid"|111|222/);
 for (let i = 4; i <= 505; i++) store.add(record(i), ['111']);
 assert.equal(store.get('D00001'), null);
 const restored = new RunStore(); restored.persist(dir); history = restored.history('111');
 assert.equal(history.mine.length, 20); assert.equal(history.daily.mine.length, 0);
 const best = history.daily.best.find(r => r.daily.players === 2);
 assert.equal(best.id, 'D00001'); assert.equal(best.completed, true); assert.equal(best.detailsAvailable, false);
 assert.equal(fs.statSync(path.join(dir, '.daily-best')).mode & 0o777, 0o600);
});
