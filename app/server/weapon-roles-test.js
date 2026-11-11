import assert from 'node:assert/strict';
import { Room } from './game.js';
import { WEAPONS } from '../public/shared/content.js';

function arena(id, level = 1) {
  const r = new Room('ROLES', () => {});
  r.addPlayer(1, 'One', 'knight'); r.addPlayer(2, 'Two', 'knight'); r.start();
  r.time = 100; r.enemies.length = 0;
  const h = r.heroes.get(1);
  h.x = h.y = 0; h.perk.readyAt = Infinity;
  h.weapons = new Map([[id, { lvl: level, t: 0 }]]);
  const foe = (x, y = 0, type = 'ghoul') => {
    const e = r.spawnEnemy(type, [h], 1);
    Object.assign(e, { x, y, hp: 10000, maxHp: 10000, speed: 0, dmg: 0 });
    r.rebuildGrid(); return e;
  };
  return { r, h, w: h.weapons.get(id), foe };
}
{
  const {r,h,w,foe} = arena('aura'); const e = foe(40);
  const hits = [];
  for (let i=0;i<6;i++) { w.t=0; const hp=e.hp; r.updateWeapon(h,'aura',w,1/30); hits.push(hp-e.hp); r.time+=0.5; }
  assert.equal(hits[0],4); assert.equal(hits[4],6); assert.equal(hits[5],6);
  r.time+=2; w.t=0; const hp=e.hp; r.updateWeapon(h,'aura',w,1/30); assert.equal(hp-e.hp,4,'leaving contact loses the heat ramp');
}
{
  const {r,h,w,foe} = arena('frost'); const front=foe(90), back=foe(-90);
  r.updateWeapon(h,'frost',w,1/30);
  assert.equal(front.hp,10000,'a wave is not an instant aura');
  for(let i=0;i<9;i++){r.time+=1/30;r.updateColdWaves(1/30);}
  assert.ok(front.hp<10000 && front.frozenT>r.time,'level-one wave damages and freezes');
  assert.equal(back.hp,10000,'a directional wave does not hit behind the caster');
}
{
  const {r,h,w,foe} = arena('traps'); const a=foe(65), b=foe(70);
  r.updateWeapon(h,'traps',w,1/30); const trap=r.traps[0];
  assert.ok(trap.x>0,'trap is placed toward the approaching enemies');
  a.x=b.x=trap.x; r.rebuildGrid(); r.time+=0.3; r.updateTraps(0.3);
  assert.ok(a.hp<10000 && b.hp<10000 && a.rootT>r.time && b.rootT>r.time,'the first level damages and holds a group');
  assert.equal(r.traps.length,1); assert.equal(trap.uses,1);
  r.time+=2; r.updateTraps(0.1); assert.equal(r.traps.length,0,'second activation consumes the trap');
}
{
  const {r,h,w,foe} = arena('lantern'); const e=foe(70);
  r.updateWeapon(h,'lantern',w,1/30);
  assert.equal(e.markMul,0.25); assert.equal(e.markT,r.time+3);
  const support=h.supportDamage, ally=r.heroes.get(2), teamDamage=h.dmg+ally.dmg;
  r.hurtEnemy(e,100,ally,{weapon:'whip',tags:['phys']});
  assert.equal(h.supportDamage-support,25,'support credits only added damage');
  assert.equal(h.dmg+ally.dmg-teamDamage,125,'support credit does not count damage twice');
  const snapshot=r.snapshot(); assert.ok(snapshot.support.some(([pid,n])=>pid===h.pid && n>0));
  const beforeOverkill=h.supportDamage;e.hp=1;r.hurtEnemy(e,100,ally,{weapon:'whip',tags:['phys']});
  assert.equal(h.supportDamage,beforeOverkill,'a mark gets no credit when the unmarked hit already kills');
}
{
  const {r,h,w,foe} = arena('trail'); const e=foe(0);
  h.movedT=r.time;
  for(let i=0;i<12;i++) r.trailTick(h,WEAPONS.trail.levels[0],{weapon:'trail',tags:['fire','aoe']},w);
  r.updatePuddles(1/30);
  assert.equal(h.dmg,10,'overlapping segments have one entry hit, not twelve');
  assert.ok(e.burnT>=r.time+3.5,'burn survives walking out of the path');
  h.x=150;r.time+=0.2;h.movedT=r.time;r.trailTick(h,WEAPONS.trail.levels[0],{weapon:'trail',tags:['fire','aoe']},w);
  assert.ok(r.puddles.some(z=>z.x>20&&z.x<140),'fast movement gets intermediate path segments');
  for(let i=0;i<100;i++){h.x+=480;r.time+=0.1;h.movedT=r.time;r.trailTick(h,WEAPONS.trail.levels[0],{weapon:'trail',tags:['fire','aoe']},w);}
  assert.ok(r.puddles.filter(z=>z.baseTrail).length<=24,'interpolation never bypasses the fire-segment ceiling');
}
{
  const {r,h,w,foe}=arena('ward',5); const e=foe(70);
  r.updateWeapon(h,'ward',w,1/30);assert.ok(e.hp<10000,'charged Ward attacks without being hit');
  const ready=h.perk.readyAt;
  for(let i=0;i<2;i++){const n=r.fx.filter(f=>f[0]==='boom').length;r.hurtPlayer(h,50);assert.equal(r.fx.filter(f=>f[0]==='boom').length,n+1);}
  assert.equal(h.perk.readyAt,ready,'Ward does not spend or reset the innate shield');
  assert.equal(h.ward,1,'one charge per incoming hit');
}
console.log('six weapon roles: contact ramp, traveling frost, reusable group traps, support accounting, bounded fire and shield offense passed');
