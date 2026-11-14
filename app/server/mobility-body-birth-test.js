import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
const dt=1/30;
function scene(pid=1,stationary=false,parentX=40){
 const r=new Room('BIRTH',()=>{});r.addPlayer(pid,'P','witch');r.start();r.time=100;r.spawn=()=>{};r.breakAround=()=>{};r.events.next=Infinity;r.peaks=[];
 const h=r.heroes.get(pid);Object.assign(h,{x:stationary?40:0,y:0,hp:100,maxHp:100,iframes:0,ward:0});h.weapons.clear();h.perk.readyAt=Infinity;
 const twin=r.spawnEnemy('twin',[h],1);Object.assign(twin,{x:parentX,y:0,hp:twin.maxHp*twin.def.splitAt});
 if(!stationary)r.handle(pid,{t:'dash',x:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});
 return{r,h,twin};
}
for(const pid of [1,7])for(const stationary of[false,true])test(`native Twin splits at tick end without prebirth body contact, pid${pid}/stationary${stationary}`,()=>{
 const{r,h,twin}=scene(pid,stationary);r.step(dt);assert.ok(twin.split&&twin.dead);const halves=r.enemies.filter(e=>e.bk==='half');assert.equal(halves.length,2);
 assert.ok(halves.every(e=>e.born===r.time));assert.ok(halves.every(e=>Math.hypot(e.x-h.x,e.y-h.y)>e.r+14));assert.equal(h.x,40);assert.equal(h.hp,100);assert.equal(h.iframes,0);
});
for(const stationary of[false,true])test(`native newborn half retains genuine birth-endpoint overlap, stationary${stationary}`,()=>{
 const{r,h}=scene(1,stationary,60);r.step(dt);const half=r.enemies.find(e=>e.bk==='half'&&Math.hypot(e.x-h.x,e.y-h.y)<e.r+14);assert.ok(half);assert.equal(h.hp,100-half.dmg);assert.ok(Math.abs(h.iframes-.4)<1e-9,'new protection begins at birth, not frame start');
});

for(const endpoint of [false,true])for(const reverse of [false,true])test(`newborn body after native Ward impulse stays birth-clipped, endpoint${endpoint}/reverse${reverse}`,()=>{
 const r=new Room('BIRTH-KNOCK',()=>{});r.addPlayer(reverse?2:1,'D','witch');r.addPlayer(reverse?1:2,'Ward','witch');r.start();r.time=100;r.breakAround=()=>{};r.events.next=Infinity;r.peaks=[];
 const [h,ally]=[...r.heroes.values()];for(const p of[h,ally]){Object.assign(p,{x:0,y:0,hp:100,maxHp:100,iframes:0,ward:0});p.weapons.clear();p.perk.readyAt=Infinity;}
 if(reverse)r.heroes=new Map([[ally.pid,ally],[h.pid,h]]);ally.x=endpoint?-120:-180;ally.ward=1;
 const shooter=r.spawnEnemy('spitter',[h,ally],1);Object.assign(shooter,{x:ally.x-10,y:0});r.fireHostile(shooter,{x:ally.x+50,y:0});r.enemies=[];
 let born;r.spawn=function(_dt,alive){born=this.spawnEnemy('ghoul',alive,1);Object.assign(born,{x:endpoint?-5:-65,y:0,speed:0,hp:10000,maxHp:10000});this.spawn=()=>{};};
 for(const p of[h,ally])r.handle(p.pid,{t:'dash',x:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});
 r.step(dt);assert.equal(ally.ward,0);assert.equal(born.born,r.time);assert.ok(Math.abs(born.x-(endpoint?55:-5))<1e-9,'actual Ward knock moved the newly created body');assert.equal(h.hp,endpoint?100-born.dmg:100);assert.ok(Math.abs(h.iframes-(endpoint?.4:0))<1e-9);
});
