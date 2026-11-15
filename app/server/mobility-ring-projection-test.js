import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
import {ringShotScene} from './mobility-ring-fixture.js';
for(const aPid of[1,2])for(const reverse of[false,true])for(const shortLife of[false,true])test(`zero outward dash retains ordinary native ring shot recipient/lifetime, pid${aPid}/reverse${reverse}/short${shortLife}`,()=>{
 const normal=ringShotScene(Room,{aPid,reverse,shortLife}),blocked=ringShotScene(Room,{aPid,reverse,shortLife,press:true});
 assert.deepEqual(blocked.positions,normal.positions);assert.ok(blocked.path.duration<1e-10);
 assert.deepEqual(blocked.hp,normal.hp);assert.deepEqual(blocked.taken,normal.taken);assert.deepEqual(blocked.impact,normal.impact);
 assert.deepEqual(normal.taken,shortLife?[0,0]:[0,normal.damage]);assert.equal(normal.impact[5],shortLife?0:1);
});
for(const shortLife of[false,true])test(`zero outward dash without ring shrink retains its ordinary control, short${shortLife}`,()=>{
 const normal=ringShotScene(Room,{still:true,shortLife}),blocked=ringShotScene(Room,{still:true,shortLife,press:true});assert.deepEqual(blocked.hp,normal.hp);assert.deepEqual(blocked.impact,normal.impact);
});
for(const aPid of[1,2])for(const reverse of[false,true])for(const shortLife of[false,true])test(`two-pixel partial dash preserves its real ray before the native ring projection, pid${aPid}/reverse${reverse}/short${shortLife}`,()=>{
 const result=ringShotScene(Room,{aPid,reverse,shortLife,press:true,inward:2});
 assert.ok(Math.abs(result.path.moveX-2)<1e-8);assert.equal(result.path.moveY,0);
 assert.ok(Math.abs(result.path.duration-2/1200)<1e-10);assert.ok(result.positions[0].x<result.path.x,'the next native ring is smaller than the dash start');
 assert.deepEqual(result.taken,shortLife?[0,0]:[0,result.damage]);assert.equal(result.impact[5],shortLife?0:1);
});
for(const previous of[false,true])test(`invalid world start is projected without sweeping its discarded prefix, previous${previous}`,()=>{
 const r=new Room('WORLD-PROJECTION',()=>{});r.addPlayer(1,'P','witch');r.start();r.spawn=()=>{};r.breakAround=()=>{};r.events.next=Infinity;
 const h=r.heroes.get(1);Object.assign(h,{x:100010,y:0,hp:100,maxHp:100,iframes:0,ward:0});h.weapons.clear();h.perk.readyAt=Infinity;
 if(previous)h.hostilePos={x:100000,y:0};else delete h.hostilePos;
 r.hostile.push({id:r.nextId++,x:100030,y:0,vx:0,vy:0,life:1,dmg:8,from:'spitter:shot'});
 r.handle(1,{t:'dash',x:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});r.step(1/30);
 assert.equal(h.x,100000);assert.equal(h.dashPath.moveX,0);assert.equal(h.hp,100);assert.equal(r.hostile.length,1);
});
