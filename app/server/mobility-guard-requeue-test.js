import assert from'node:assert/strict';import{test}from'node:test';import{Room}from'./game.js';
const dt=1/30;
for(const ready of[false,true])test(`r16 real outpost guard requeue preserves preparation eligibility, ready${ready}`,()=>{
 const r=new Room('PREP',()=>{});r.addPlayer(1,'Target','witch');r.addPlayer(2,'Ward','witch');r.start();r.time=r.runLength*2/3;
 const h=r.heroes.get(1),a=r.heroes.get(2),alive=[h,a];r.updateOutposts(alive);const post=r.outposts.posts[0];for(const p of alive){p.x=post.x;p.y=post.y;}r.updateOutposts(alive);const e=r.enemies.find(e=>e.outpost===post);assert.ok(e?.guardReadyAt>r.time,'native encounter actually creates a preparing guard');
 Object.assign(post,{x:0,y:0});r.enemies=[e];Object.assign(e,{x:35,y:-60,speed:0,hp:10000,maxHp:10000});r.time=e.guardReadyAt+(ready?1:-2*dt);r.spawn=()=>{};r.breakAround=()=>{};r.events.next=Infinity;
 for(const p of alive){Object.assign(p,{hp:100,maxHp:100,iframes:0,ward:0});p.weapons.clear();p.perk.readyAt=Infinity;}Object.assign(h,{x:0,y:0});Object.assign(a,{x:35,y:-60,ward:1});
 r.hostile.push({id:r.nextId++,x:35,y:-82,vx:0,vy:230,life:5,dmg:8,from:'spitter:shot'});for(const p of alive)r.handle(p.pid,{t:'dash',x:p===h?1:0,y:p===h?0:-1,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});r.step(dt);
 assert.equal(a.ward,0);assert.ok(Math.abs(e.y)<1e-6,'actual Ward displacement placed the surviving guard in the remaining path');assert.equal(h.hp<100,ready);if(!ready)assert.ok(e.guardReadyAt>r.time);
});
