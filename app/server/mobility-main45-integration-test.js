import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
const dt=1/30;
const permutations = values => values.length ? values.flatMap((v,i)=>permutations(values.filter((_,j)=>j!==i)).map(rest=>[v,...rest])) : [[]];
function scene(ids=[1,2,3],order=[0,1,2]) {
 const r=new Room('MAIN45',()=>{});
 for(const pid of ids)r.addPlayer(pid,'P'+pid,'witch');
 r.start();r.time=1;r.spawn=()=>{};r.events.next=Infinity;r.breakAround=()=>{};
 const h=ids.map(pid=>r.heroes.get(pid));
 for(const p of h){Object.assign(p,{x:0,y:0,hp:100,maxHp:100,iframes:0,ward:0});p.weapons.clear();p.perk.readyAt=Infinity;}
 r.heroes=new Map(order.map(i=>[ids[i],h[i]]));return{r,a:h[0],b:h[1],d:h[2]};
}
function fire(r,x=-10,y=0,aim=50) {
 const e=r.spawnEnemy('spitter',[...r.heroes.values()],1);Object.assign(e,{x,y});
 r.fireHostile(e,{x:aim,y});r.enemies=[];return r.hostile.at(-1);
}
function dash(r,h,x=-1,y=0){r.handle(h.pid,{t:'dash',x,y,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});}
for(const ids of permutations([1,2,3]))for(const order of permutations([0,1,2]))test(`main45 ordinary path/time and RNG unchanged by remote dash: ids${ids}/Map${order}`,()=>{
 const observations=[];
 for(const moving of [false,true]){
  const {r,a,b,d}=scene(ids,order);a.x=18;b.x=0;d.x=1000;fire(r);if(moving)dash(r,d,1,0);
  let rng=0;const random=Math.random;Math.random=()=>{rng++;return random();};
  try{r.tick(dt);}finally{Math.random=random;}
  observations.push({hp:[a.hp,b.hp],shots:r.hostile.map(s=>[s.id,s.x,s.y,s.life]),ends:r.fx.filter(e=>e[0]==='epend'),rng});
 }
 assert.deepEqual(observations[1],observations[0]);assert.ok(observations[0].hp[1]<100);assert.equal(observations[0].hp[0],100);
});
for(const ordinaryPid of [1,2])for(const dasherFirst of [false,true])for(const protectedDash of [false,true])test(`r18 actual earlier ordinary wins both PID/Map orders, pid${ordinaryPid}/dashFirst${dasherFirst}/protected${protectedDash}`,()=>{
 const ids=[ordinaryPid,3,3-ordinaryPid],order=dasherFirst?[2,0,1]:[0,2,1];
 const {r,a,b,d}=scene(ids,order);b.x=1000;d.x=23.65836;if(protectedDash)d.iframes=1;
 const s=fire(r),damage=s.dmg;dash(r,d);r.tick(dt);
 assert.equal(a.hp,100-damage);assert.equal(d.hp,100);assert.equal(r.hostile.length,0);
 assert.equal(r.fx.filter(e=>e[0]==='epend'&&e[1]===s.id).length,1);
});
for(const ordinaryPid of [1,2])for(const dasherFirst of [false,true])for(const protection of ['none','ward','shield','short','frame'])test(`main45 early interception cannot reopen a past fallback, pid${ordinaryPid}/dashFirst${dasherFirst}/${protection}`,()=>{
 const {r,a,b,d}=scene([ordinaryPid,3,3-ordinaryPid],dasherFirst?[2,0,1]:[0,2,1]);b.x=1000;d.x=23.65836;a.hp=4;
 if(protection==='ward')d.ward=1;
 if(protection==='shield'){d.hero='knight';d.perk.readyAt=0;}
 if(protection==='short')d.iframes=.012;
 if(protection==='frame')d.iframes=dt;
 fire(r,-10,20);const early=fire(r);early.dmg=3;early.from='test:early';
 const late=fire(r,-25,0,-100);late.dmg=9;late.from='test:late';dash(r,d);r.tick(dt);
 assert.equal(a.st,0);assert.equal(a.hp,1,'early S1 also protects ordinary A against the later killer');
 assert.equal(d.hp,['ward','shield','frame'].includes(protection)?100:91);
 const lateAt=(23.65836+25-21)/(1200-230);
 assert.ok(Math.abs(d.iframes-(protection==='frame'?0:.4-dt+lateAt))<1e-8);
 assert.equal(r.runLog.p.get(d.pid).taken['test:early'],undefined,'already intercepted shot has no retroactive fallback');
 if(protection==='ward')assert.equal(d.ward,0);
 if(protection==='shield')assert.ok(d.perk.readyAt>r.time);
});
test('main45 unified timeline keeps lower-pid tie and actual dash path-only contact',()=>{
 const {r,a,b,d}=scene([2,3,1],[2,0,1]);b.x=1000;a.x=0;d.x=10;
 const s=fire(r),damage=s.dmg;dash(r,d);r.tick(dt);assert.equal(d.hp,100-damage);assert.equal(a.hp,100);
 const q=scene();q.a.x=q.b.x=1000;Object.assign(q.d,{x:10,y:20});const path=fire(q.r),pathDamage=path.dmg;dash(q.r,q.d,0,-1);q.r.tick(dt);
 assert.ok(Math.hypot(path.x-q.d.x,path.y-q.d.y)>21);assert.equal(q.d.hp,100-pathDamage);
 const end=q.r.fx.find(e=>e[0]==='epend'&&e[1]===path.id);assert.equal(end[5],1);assert.ok(end[2]>1&&end[2]<1+dt);assert.ok(Number.isFinite(end[3])&&Number.isFinite(end[4]));
});
