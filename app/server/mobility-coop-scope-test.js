import assert from 'node:assert/strict';import{test}from'node:test';import{Room}from'./game.js';
const dt=1/30;
function room(){const r=new Room('COOP',()=>{});r.addPlayer(1,'Target','witch');r.addPlayer(2,'Ally','witch');r.start();r.spawn=()=>{};r.breakAround=()=>{};r.events.next=Infinity;for(const h of r.heroes.values()){Object.assign(h,{x:0,y:0,hp:100,maxHp:100,iframes:0,ward:0});h.weapons.clear();h.perk.readyAt=Infinity;}return r;}
function dash(r,h){r.handle(h.pid,{t:'dash',x:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});}
for(const distance of [500,700,1000])for(const movingAlly of[false,true])test(`CEO55-r13 stationary target uses endpoint collision, remote dash${movingAlly}/${distance}`,()=>{
 const r=room(),h=r.heroes.get(1),a=r.heroes.get(2);a.x=distance;if(movingAlly)dash(r,a);
 r.hostile.push({id:r.nextId++,x:-3,y:20.99,vx:230,vy:0,life:5,dmg:8,from:'spitter:shot'});r.step(dt);assert.equal(h.hp,100);assert.equal(r.hostile.length,1);
});
for(const movingAlly of[false,true])test(`CEO55-r13 ordinary endpoint hit still applies with remote dash${movingAlly}`,()=>{
 const r=room(),h=r.heroes.get(1),a=r.heroes.get(2);a.x=1000;if(movingAlly)dash(r,a);r.hostile.push({id:r.nextId++,x:0,y:20,vx:0,vy:0,life:5,dmg:8,from:'spitter:shot'});r.step(dt);assert.equal(h.hp,92);assert.equal(r.hostile.length,0);
});
