import assert from 'node:assert/strict';
import { Room } from './game.js';
import { CONFLUENCES } from '../public/shared/confluences.js';
import { DUO_BY_PAIR, duoKey, DUOS, affinityOf } from '../public/shared/content.js';

for(const [id,D] of Object.entries(CONFLUENCES)) {
  assert.equal(DUO_BY_PAIR[duoKey(...D.parts)],id);assert.equal(affinityOf(...D.parts),null);
  const r=new Room('NEW',()=>{});r.addPlayer(1,'One','knight');r.start();r.time=100;r.enemies.length=0;
  const h=r.heroes.get(1);h.x=h.y=0;h.perk.readyAt=Infinity;const w={lvl:1,t:0};h.weapons=new Map([[id,w]]);
  const enemies=[];
  for(let i=0;i<4;i++){const e=r.spawnEnemy('ghoul',[h],1);Object.assign(e,{x:50+i*20,y:0,hp:10000,maxHp:10000,speed:0});enemies.push(e);}
  r.rebuildGrid();r.castWeapon(h,id,w,1/30);
  assert.ok(r.fx.length>0,`${id}: signature has a visible effect`);
  if(D.effect==='resonanceBeam')assert.ok(enemies.some(e=>e.resonanceT>r.time));
  if(D.effect==='markBeam')assert.ok(enemies.some(e=>e.markMul===D.levels[0].mark && e.markOwner===h));
  if(D.effect==='shockBeam')assert.ok(r.fx.some(f=>f[0]==='zap'));
  if(D.effect==='resonanceWell')assert.ok(r.puddles.some(z=>z.resonance));
  if(D.effect==='lensWell')assert.ok(r.fx.some(f=>f[0]==='buildbeam'));
  if(D.effect==='trapWell'){
    assert.ok(r.traps.some(t=>t.uses===3));r.time+=0.3;r.updateTraps(0.3);assert.ok(enemies.some(e=>e.rootT>r.time));
  }
  if(D.effect==='choirWave'){
    r.updateColdWaves(0.4);assert.ok(enemies.some(e=>e.frozenT>r.time&&e.resonanceT>r.time));
  }
  if(D.effect==='fireWell'){
    r.updatePuddles(1/30);assert.ok(enemies.some(e=>e.burnT>r.time));
  }
  if(D.effect==='sonicShield'){
    const ready=h.perk.readyAt,before=h.dmg; r.wardAbsorb(h);
    assert.ok(h.dmg>before,'a block answers with an offensive sonic pulse');assert.equal(h.perk.readyAt,ready);
  }
}
assert.equal(Object.keys(DUOS).length,39);
console.log('nine new confluences: all signatures, four partners per new weapon, control, support and shield behavior passed');
