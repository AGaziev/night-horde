import assert from 'node:assert/strict';
import { Room } from './game.js';
import { WEAPONS, DUOS, EVOS, PASSIVES, attackLevel } from '../public/shared/content.js';

// Exercise the real damage entry point for every weapon, evolution and duo, not just a description table.
const ids = [...Object.keys(WEAPONS), ...Object.keys(DUOS), ...Object.keys(EVOS)];
const room = new Room('ART', () => {});
room.addPlayer(1, 'One', 'knight');
room.addPlayer(2, 'Two', 'knight');
room.start();
room.time = 100;
room.enemies.length = 0;
const h = room.heroes.get(1), ally = room.heroes.get(2);
h.x = h.y = ally.x = ally.y = 0;
h.perk.readyAt = Infinity;
const originalRandom = Math.random;
try {
  Math.random = () => 0;
  for (const id of ids) {
    const W = WEAPONS[id] ?? DUOS[id] ?? EVOS[id];
    for (const artifact of Object.keys(PASSIVES)) {
      room.enemies.length = 0;
      h.passives = new Map([[artifact, 3]]);
      h.pval = {};
      h.embers = {};
      h.dmg = 0;
      h.dmgBy = {};
      h.weapons = new Map([[id, { lvl: 1, t: 0 }]]);
      h.blockCharge = 0;
      room.recalcMods(h);
      room.updateBuffs([h, ally]);
      const target = room.spawnEnemy('ghoul', [h], 1);
      Object.assign(target, { x: 40, y: 0, hp: 10000, maxHp: 10000 });
      const neighbor = room.spawnEnemy('ghoul', [h], 1);
      Object.assign(neighbor, { x: 90, y: 0, hp: 10000, maxHp: 10000 });
      room.rebuildGrid();
      const source = { weapon: id, tags: W.tags ?? [] };
      if (artifact === 'coil') {
        target.hp = 1;
        room.hurtEnemy(target, 100, h, source);
        assert.ok(neighbor.hp < 10000, `${id}: coil can discharge from this weapon`);
      } else if (artifact === 'ashseal' || artifact === 'ember') {
        room.hurtEnemy(target, 100, h, source);
        assert.ok(target.burnT > room.time || target.steamT > room.time || h.dmgBy.r_flash > 0, `${id}: ignition or its elemental reaction works without another artifact`);
      } else if (artifact === 'haste' || artifact === 'swift') {
        const normal = attackLevel(id, 1, 0, { cdMul: 1 });
        const faster = attackLevel(id, 1, 0, h.mods);
        assert.ok(h.mods.cdMul < 1, `${id}: shorter cast cooldown`);
        for (const clock of ['tick', 'every', 'hitCd']) {
          if (normal[clock]) assert.ok(faster[clock] < normal[clock], `${id}: ${clock} respects haste`);
        }
      } else {
        const dealt = room.hurtEnemy(target, 100 * h.mods.dmgMul, h, source);
        assert.ok(dealt > 100, `${id} + ${artifact}: an otherwise unmodified hit gains combat power (${dealt})`);
      }
    }
  }
} finally { Math.random = originalRandom; }
console.log(`artifact combat coverage: ${ids.length} weapons × ${Object.keys(PASSIVES).length} artifacts passed`);
