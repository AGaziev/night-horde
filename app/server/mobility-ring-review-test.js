import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
import {stepMobility,dashContactTime} from './mobility.js';
import {PLAYER_RADIUS,ENEMIES} from '../public/shared/content.js';
const dt=1/30;
function room(n=1){const r=new Room('CLIP',()=>{});for(let i=1;i<=n;i++)r.addPlayer(i,'P'+i,'witch');r.start();r.spawn=()=>{};r.breakAround=()=>{};r.events.next=Infinity;for(const h of r.heroes.values()){Object.assign(h,{x:0,y:0,hp:100,maxHp:100,iframes:0,ward:0});h.weapons.clear();h.perk.readyAt=Infinity;}return r;}
function dash(r,h,x=1,y=0){r.handle(h.pid,{t:'dash',x,y,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});}
test('CEO55-r11 ring clip keeps true55% travel and stationary remainder against review Lord trajectory',()=>{
 const r=room(),h=r.heroes.get(1);h.x=404;r.fin={cx:0,cy:0,r:440};dash(r,h);stepMobility(r,dt);
 assert.equal(h.x,426);assert.ok(Math.abs(h.dashPath.duration-dt*.55)<1e-9);
 const dx=-Math.sin(Math.PI/10)*520*dt,dy=-Math.cos(Math.PI/10)*520*dt;
 assert.equal(dashContactTime(h,391,54,391+dx,54+dy,dt,54),null,'physical minimum55.10>54; stretched path minimum52.96 is not physical');
});
test('CEO55-r11 actual Lord windup then native Room.step near ring keeps68HP',()=>{
 const r=room(),h=r.heroes.get(1);r.time=r.finPlan.lord;r.startFinale([h]);Object.assign(r.fin,{cx:0,cy:0,r:440,r1:440,nextAdd:Infinity,rage:true});r.finaleLord([h],r.bossAt.length-1);r.bossIdx=r.bossAt.length;
 const lord=r.fin.lord;Object.assign(lord,{x:391,y:54,immuneT:0,bs:0,dcd:0,dmg:36});h.x=391-54*Math.tan(Math.PI/10);h.hp=68;
 r.dashTick(lord,h,Math.hypot(lord.x-h.x,lord.y-h.y),dt,true);assert.equal(lord.bs,'aim');
 assert.ok(r.fx.some(f=>f[0]==='bline'),'real reachable windup is announced');
 for(let i=0;i<100&&lord.bs==='aim';i++)r.step(dt);assert.equal(lord.bs,'dash');
 r.onPos(1,{x:404,y:0,fx:1,fy:0});assert.equal(h.x,404);dash(r,h);r.step(dt);
 assert.equal(h.x,426);assert.ok(Math.abs(lord.x-385.6437054)<1e-5);assert.ok(Math.abs(lord.y-37.5150204)<1e-5);assert.equal(h.hp,68,'safe trajectory after a real windup must not deal36 damage');
});
for(const [name,x,y,dirx,diry,fin,wantX,wantY,duration] of [
 ['world partial',99990,0,1,0,null,100000,0,10/1200],
 ['world zero',100000,0,1,0,null,100000,0,0],
 ['ring zero',426,0,1,0,{cx:0,cy:0,r:440},426,0,0],
 ['collapsed ring',0,0,1,0,{cx:0,cy:0,r:PLAYER_RADIUS},0,0,0],
])test(`clip boundary: ${name}`,()=>{const r=room(),h=r.heroes.get(1);Object.assign(h,{x,y});r.fin=fin;dash(r,h,dirx,diry);stepMobility(r,dt);assert.equal(h.x,wantX);assert.equal(h.y,wantY);assert.ok(Math.abs(h.dashPath.duration-duration)<1e-9);});
test('nonradial ring clip stops on the requested ray at its first boundary',()=>{
 const r=room(),h=r.heroes.get(1);Object.assign(h,{x:420,y:0});r.fin={cx:0,cy:0,r:440};dash(r,h,1,1);stepMobility(r,dt);
 assert.ok(Math.abs(Math.hypot(h.x,h.y)-426)<1e-8);assert.ok(Math.abs(h.x-420-h.y)<1e-8,'clipping cannot bend the trajectory');assert.ok(h.dashPath.duration<dt);
});
for(const reverse of [false,true])test(`CEO55-r11 ordinary body chronology ignores enemy array order ${reverse}`,()=>{
 const r=room(),h=r.heroes.get(1);for(const[type,at,dmg]of[['skel',.00055,4.5],['brute',.028333333,8.1]]){const e=r.spawnEnemy(type,[h],1);Object.assign(e,{x:e.r+PLAYER_RADIUS+1200*at,y:0,speed:0,dmg});}if(reverse)r.enemies.reverse();dash(r,h);r.step(dt);assert.equal(h.hp,95.5);
});
for(const allyFirst of [false,true])test(`CEO55-r11 ally Nabat cannot rewrite prior enemy motion ${allyFirst}`,()=>{
 const r=room(2),h=r.heroes.get(1),ally=r.heroes.get(2);ally.x=45;ally.y=88;if(allyFirst)r.heroes=new Map([[2,ally],[1,h]]);
 const e=r.spawnEnemy('ghoul',[h,ally],1);Object.assign(e,{x:44.7,y:28,speed:0});
 ally.weapons.set('tocsin',{lvl:1,t:999,p:0});dash(r,h);r.step(dt);
 assert.ok(e.y<0,'actual Nabat impulse occurs after movement');assert.equal(h.hp,100);
});
