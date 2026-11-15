import assert from 'node:assert/strict';import{test}from'node:test';import{Room}from'./game.js';
const dt=1/30;
function room(){const r=new Room('COOP',()=>{});r.addPlayer(1,'Target','witch');r.addPlayer(2,'Ally','witch');r.start();r.spawn=()=>{};r.breakAround=()=>{};r.events.next=Infinity;for(const h of r.heroes.values()){Object.assign(h,{x:0,y:0,hp:100,maxHp:100,iframes:0,ward:0});h.weapons.clear();h.perk.readyAt=Infinity;}return r;}
function dash(r,h,x=1,y=0){r.handle(h.pid,{t:'dash',x,y,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});}
for(const type of['ghoul','bloater'])test(`CEO55-r13 earlier real ward impulse invalidates later ${type} body contact`,()=>{
 const r=room(),h=r.heroes.get(1),a=r.heroes.get(2);Object.assign(a,{x:type==='ghoul'?35:-5,y:0,ward:1});
 const e=r.spawnEnemy(type,[h,a],1);Object.assign(e,{x:type==='ghoul'?35:55,y:type==='ghoul'?26:0,speed:0,hp:10000,maxHp:10000,fuseT:0});
 // Early protected shot triggers the ally's real Ward burst/knock; hero1 crosses later.
 r.hostile.push({id:r.nextId++,x:a.x,y:a.y-22,vx:0,vy:230,life:5,dmg:8,from:'spitter:shot'});dash(r,h);dash(r,a,0,-1);r.step(dt);
 assert.equal(a.ward,0);assert.ok(e.x>80||e.y>70,'living enemy was actually displaced');assert.equal(h.hp,100);if(type==='bloater')assert.equal(e.fuseT,0);
});
test('CEO55-r13 a ward impulse into the remaining path creates a real earlier contact ahead of a later shot',()=>{
 const r=room(),h=r.heroes.get(1),a=r.heroes.get(2);Object.assign(a,{x:35,y:-60,ward:1});
 const e=r.spawnEnemy('ghoul',[h,a],1);Object.assign(e,{x:35,y:-60,speed:0,hp:10000,maxHp:10000});const damage=e.dmg;
 r.hostile.push({id:r.nextId++,x:35,y:-82,vx:0,vy:230,life:5,dmg:8,from:'spitter:shot'});
 r.hostile.push({id:r.nextId++,x:31,y:0,vx:0,vy:0,life:5,dmg:19,from:'spitter:shot'});
 dash(r,h);dash(r,a,0,-1);r.step(dt);assert.ok(Math.abs(e.y)<1e-6);assert.equal(h.hp,100-damage,'new body entry after warp precedes the later shot');
});
