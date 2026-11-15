import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
import {DUOS,ITEM_TYPES} from '../public/shared/content.js';
const dt=1/30;
function arena(type='shield'){const r=new Room('CTRL-AI',()=>{});r.addPlayer(1,'Owner','ranger');r.start();r.time=100;r.enemies=[];const h=r.heroes.get(1);h.x=1000;h.y=0;h.weapons.clear();h.perk.readyAt=Infinity;const e=r.spawnEnemy(type,[h],1);Object.assign(e,{x:0,y:0,hp:1e6,maxHp:1e6,bs:'dash',bt:.75,bvx:1,bvy:0});return {r,h,e};}
function path(type,mode,frames=23){const {r,h,e}=arena(type),points=[];
 if(mode==='sand'){
  h.x=100;
  const item=r.dropItem('slowtime',h.x,h.y);
  assert.equal(item.type,ITEM_TYPES.indexOf('slowtime'));
  r.updateItems(dt,[h]);
  assert.ok(!r.items.includes(item),'the collector actually picks up the sand');
  assert.equal(e.slowOwner,h,'sand must reach the charging target before measuring control');
  assert.ok(e.slow>0&&e.slowT>r.time,'the target has an active slow, not merely an unaffected path');
  h.x=1000;
 }
 if(mode==='pitch'){h.weapons=new Map(DUOS.pitch.parts.map(id=>[id,{lvl:3,t:0}]));h.offer=[r.duoCard(h,{id:'pitch',a:'flask',b:'trail'})];r.sendOffer(h);r.handle(h.pid,{t:'pick',i:0,offerEpoch:h.offerEpoch});assert.ok(h.weapons.has('pitch'));}
 for(let i=0;i<frames;i++){
  r.time+=dt;
  if(mode==='pitch'){h.x=e.x;h.movedT=r.time;r.pitchTick(h,DUOS.pitch.levels[0]);r.rebuildGrid();r.updatePuddles(dt);h.x=1000;}
  r.moveEnemies(dt,[h]);points.push([e.x,e.y,e.bs]);
 }
 return {points,control:h.support.control};
}
for(const [type,mode] of [['ram','sand'],['shield','pitch']])test('r13-41 '+type+' unaffected charge receives no '+mode+' control credit',()=>{
 const plain=path(type,null),controlled=path(type,mode);assert.deepEqual(controlled.points,plain.points,'actual AI charge path/timing is unaffected');assert.equal(controlled.control,0,'status presence is not delivered control');
});
for(const phase of ['aim','rest','wind'])test('r13-41 unaffected AI wait phase '+phase+' earns no slow credit',()=>{
 const {r,h,e}=arena(phase==='wind'?'gunner':'shield');e.bs=phase;e.bt=1;r.slowEnemy(e,.4,2,h);r.time+=dt;r.moveEnemies(dt,[h]);assert.equal(h.support.control,0);
});
test('r13-41 ordinary walking and gunner walking retain real slowdown credit',()=>{
 for(const type of ['ghoul','gunner']){const {r,h,e}=arena(type);e.bs=0;e.bcd=10;e.dcd=10;const speed=e.speed;r.slowEnemy(e,.4,2,h);r.time+=dt;r.moveEnemies(dt,[h]);assert.ok(e.x>0&&e.x<speed*dt);assert.equal(h.support.control,dt);}
});
test('r13-41 contact-limited movement cannot claim ineffective slow',()=>{
 const {r,h,e}=arena('ghoul');e.bs=0;h.x=e.r+14-2;r.slowEnemy(e,.4,2,h);r.time+=dt;r.moveEnemies(dt,[h]);assert.equal(e.x,0);assert.equal(h.support.control,0);
});
test('r13-41 root/freeze really pause a charge and overlapping control remains one interval',()=>{
 const {r,h,e}=arena();r.root(e,1,h);r.freeze(e,1,h);r.slowEnemy(e,.4,2,h);r.time+=dt;r.moveEnemies(dt,[h]);assert.equal(e.x,0);assert.equal(h.support.control,dt);
});
