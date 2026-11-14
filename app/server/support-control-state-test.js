import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
function arena(){const r=new Room('CTRL',()=>{});r.addPlayer(1,'Sand','ranger');r.addPlayer(2,'Frost','ranger');r.start();r.time=100;r.enemies=[];const [a,b]=r.heroes.values();for(const h of [a,b]){h.x=1000;h.y=0;h.weapons.clear();h.perk.readyAt=Infinity;}const e=r.spawnEnemy('ghoul',[a],1);Object.assign(e,{x:0,y:0,hp:1e6,maxHp:1e6,speed:20});return {r,a,b,e};}
test('CEO41.3 equal short frost cannot take ownership of long boss sand',()=>{
 const {r,a,b,e}=arena();e.boss=true;r.slowEnemy(e,.7,6,a);r.time+=.37;r.slowEnemy(e,.4,1.9,b);assert.equal(e.slowOwner,a);assert.equal(e.slowT,106);
 r.time=103;r.moveEnemies(1/30,[a,b]);assert.equal(e.slowOwner,a);assert.equal(e.slow,.4);assert.equal(b.support.control,0);
});
test('CEO41.3 stronger expiry reveals only the weaker still-active source',()=>{
 const {r,a,b,e}=arena();r.slowEnemy(e,.7,2,a);r.time++;r.slowEnemy(e,.3,6,b);assert.equal(e.slow,.7);assert.equal(e.slowT,102);
 r.time=102.1;r.moveEnemies(.1,[a,b]);assert.equal(e.slow,.3);assert.equal(e.slowOwner,b);assert.equal(e.slowT,107);assert.ok(b.support.control>0);
 r.time=107.1;r.moveEnemies(.1,[a,b]);assert.equal(e.slow,0);assert.equal(e.slowOwner,null);
});
test('CEO41.4 Pitch is real native non-cold control, overlaps count once',()=>{
 const {r,a,b,e}=arena();r.rebuildGrid();r.puddles=[{id:900,x:0,y:0,r:100,life:3,t:0,tick:.5,dmg:1,drag:.35,owner:a,src:{weapon:'pitch',tags:[]}}];r.updatePuddles(1/30);assert.equal(e.dragOwner,a);assert.ok(e.dragT>r.time);
 r.moveEnemies(.1,[a,b]);assert.ok(Math.abs(a.support.control-.1)<1e-9);
 r.slowEnemy(e,.4,2,b);r.moveEnemies(.1,[a,b]);assert.ok(Math.abs(a.support.control+b.support.control-.2)<1e-9,'one union interval, no double credit');
});
test('CEO41.4 ordinary affinity Drag credits its owner and shares the control union',()=>{
 const {r,a,b,e}=arena();a.weapons.set('orbit',{lvl:1,t:0});a.weapons.set('flask',{lvl:1,t:0});
 r.affinity(e,a,'orbit');assert.equal(r.affinity(e,a,'flask'),'drag');assert.equal(e.dragOwner,a);r.moveEnemies(.1,[a,b]);assert.equal(a.support.control,.1);
 r.slowEnemy(e,.4,2,b);r.moveEnemies(.1,[a,b]);assert.ok(Math.abs(a.support.control+b.support.control-.2)<1e-9);
});
