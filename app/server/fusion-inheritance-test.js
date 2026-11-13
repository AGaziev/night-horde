import assert from 'node:assert/strict';
import { Room } from './game.js';
import { DUOS, WEAPONS, duoLineagePower } from '../public/shared/content.js';

for (const [id, def] of Object.entries(DUOS)) {
  const r=new Room('FUSE',()=>{});r.addPlayer(1,'One','knight');r.start();r.time=100;r.enemies.length=0;
  const h=r.heroes.get(1);h.x=h.y=0;h.perk.readyAt=Infinity;
  h.weapons=new Map([[id,{lvl:1,t:0}]]);
  const e=r.spawnEnemy('brute',[h],1);Object.assign(e,{x:50,y:0,hp:1e7,maxHp:1e7,speed:0});r.rebuildGrid();
  for(let frame=0;frame<120;frame++){
    r.time+=1/30;h.movedT=r.time;h.x=Math.sin(frame/15)*15;
    if(r.traps.length){e.x=r.traps[0].x;e.y=r.traps[0].y;}
    r.rebuildGrid();r.updateWeapon(h,id,h.weapons.get(id),1/30);r.updateProjectiles(1/30);r.updateColdWaves(1/30);
    r.updateOrbs(1/30);r.updateTimers();r.updateBlasts();r.updateTraps(1/30);r.updatePuddles(1/30);
  }
  const state=h.weapons.get(id);
  assert.deepEqual(state.parts.map(p=>p.id),def.parts);
  assert.ok(state.parts.every(p=>p.lvl>=3));
  assert.equal(r.weaponContext,undefined,'source context cannot leak between weapons/players');
  assert.ok(h.dmgBy[id]>0,`${id}: signature attacks credited to the duo`);
  for(const part of def.parts)assert.equal(h.dmgBy[part]??0,0,`${id}: no detached damage entry for ${part}`);
  const row=r.snapshot().p[0][12];assert.equal(row.length,1);assert.equal(row[0][5].length,2,'both lineage levels are available without extra slots');
}
{
  const r=new Room('UP',()=>{});r.addPlayer(1,'One','knight');r.start();const h=r.heroes.get(1);
  h.weapons=new Map([['whip',{lvl:3,t:0}],['lightning',{lvl:5,t:0}]]);
  r.fuseDuo(h,{id:'thunderslash',parts:['whip','lightning'],level:2});
  const w=h.weapons.get('thunderslash');r.updateWeapon(h,'thunderslash',w,1/30);
  assert.deepEqual(w.parts.map(p=>p.lvl),[4,5],'fusion preserves a higher original level');
  w.lvl=3;r.updateWeapon(h,'thunderslash',w,1/30);assert.deepEqual(w.parts.map(p=>p.lvl),[5,5]);
}
assert.equal(duoLineagePower(1,[{lvl:5},{lvl:3}]),1.08);
console.log(`fusion inheritance: all ${Object.keys(DUOS).length} duos retain lineage levels, damage attribution and visual state`);
