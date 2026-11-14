import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
import {REVIVE_SECONDS} from '../public/shared/content.js';
const dt=1/30;
function arena(){const r=new Room('TOI',()=>{});r.addPlayer(1,'P','ranger');r.start();r.time=100;r.enemies=[];const h=r.heroes.get(1);h.x=h.y=0;h.hp=h.maxHp=100;h.weapons.clear();h.perk.readyAt=Infinity;h.iframes=0;return {r,h};}
function shot(r,id,entry,dmg=10,life=1){const radius=21;return {id,x:-radius-600*entry,y:0,vx:600,vy:0,life,dmg,from:'test'};}
function step(r,h){r.time+=dt;r.updateHostile(dt);r.rebuildGrid();r.updatePlayers(dt,[h]);}
for(const protection of [dt,.015])test('CEO45.1 swept hit uses existing protection at entry '+protection,()=>{
 const {r,h}=arena();h.iframes=protection;r.hostile=[shot(r,1,.005)];step(r,h);assert.equal(h.hp,100);assert.equal(r.hostile.length,0);assert.ok(Math.abs(h.iframes-Math.max(0,protection-dt))<1e-9);
});
for(const reverse of [false,true])test('CEO45.1 chronological hostile order '+reverse,()=>{
 const {r,h}=arena();const early=shot(r,1,.005,7),late=shot(r,2,.022,25);r.hostile=reverse?[late,early]:[early,late];step(r,h);assert.equal(h.hp,93);assert.equal(r.hostile.length,0);assert.ok(h.iframes>0&&h.iframes<.6);
});
test('CEO45.1 protection can expire between two contacts in one frame',()=>{
 const {r,h}=arena();h.iframes=.01;r.hostile=[shot(r,2,.02,13),shot(r,1,.005,7)];step(r,h);assert.equal(h.hp,87);
});
for(const reverse of [false,true])test('CEO45.1 earlier shot precedes endpoint body '+reverse,()=>{
 const {r,h}=arena();const e=r.spawnEnemy('ghoul',[h],1);Object.assign(e,{x:0,y:0,dmg:30,speed:0});const far=r.spawnEnemy('ghoul',[h],1);Object.assign(far,{x:500,y:0,dmg:50,speed:0});if(reverse)r.enemies.reverse();r.hostile=[shot(r,1,.005,7)];step(r,h);assert.equal(h.hp,93,'shot at .005 establishes protection before body at frame end');
});
test('CEO45.1 expired and zero-life projectiles cannot contact beyond their lifetime',()=>{
 const {r,h}=arena();r.hostile=[shot(r,1,.02,10,.01),{id:2,x:0,y:0,vx:0,vy:0,life:0,dmg:20}];step(r,h);assert.equal(h.hp,100);assert.equal(r.hostile.length,0);
});
test('CEO45.1 newborn uses birth time and cannot traverse earlier hero movement',()=>{
 const {r,h}=arena();h.hostilePos={x:-100,y:0};h.x=100;r.hostile=[{id:1,x:0,y:0,vx:0,vy:0,life:1,dmg:20,bornAt:r.time+dt}];step(r,h);assert.equal(h.hp,100);assert.equal(r.hostile.length,1);
});
test('CEO45.1 sorted accepted hits spend ward once and use armor on later unprotected frames',()=>{
 const {r,h}=arena();h.weapons.set('ward',{lvl:1,t:9,init:true});h.ward=h.wardMax=1;h.mods.armor=3;r.hostile=[shot(r,2,.02,20),shot(r,1,.005,9)];step(r,h);assert.equal(h.ward,0);assert.equal(h.hp,100);assert.equal(r.hostile.length,0);
 h.iframes=0;r.hostile=[shot(r,3,.005,9)];step(r,h);assert.equal(h.hp,94);
});

test('CEO45.1 actual Room tick respects a partial revive protection grant and phase order',()=>{
 const {r,h}=arena();h.iframes=.015;r.hostile=[shot(r,1,.005,20)];r.tick(dt);assert.equal(h.hp,100,'real tick cannot expire protection before an earlier swept contact');assert.equal(r.hostile.length,0);
 h.iframes=0;r.hostile=[shot(r,3,.02,25),shot(r,2,.005,7)];r.tick(dt);assert.equal(h.hp,93,'real tick orders contacts before weapon/body phases');
});
test('CEO45.1 real revive plus 44 actual ticks protects a swept entry before expiry',()=>{
 const r=new Room('REV',()=>{});r.addPlayer(1,'Revived','ranger');r.addPlayer(2,'Helper','ranger');r.start();r.time=1;const [h,helper]=r.heroes.values();for(const p of [h,helper]){p.x=p.y=0;p.weapons.clear();p.perk.readyAt=Infinity;}
 r.hurtPlayer(h,1e6);assert.equal(h.st,1);r.updateRevive(REVIVE_SECONDS);assert.equal(h.st,0);assert.equal(helper.revives,1);helper.x=1000;
 for(let i=0;i<44;i++)r.tick(dt);assert.ok(Math.abs(h.iframes-dt)<1e-8);const hp=h.hp;
 r.hostile=[shot(r,1,.005,20)];r.tick(dt);assert.equal(h.hp,hp,'44-tick revive protection is live at the visible contact time');
});
test('CEO45.1 body at the preceding endpoint protects the following projectile',()=>{
 const {r,h}=arena();const e=r.spawnEnemy('ghoul',[h],1);Object.assign(e,{x:0,y:0,dmg:12,speed:0});r.rebuildGrid();r.updatePlayers(dt,[h]);assert.equal(h.hp,88);
 r.hostile=[shot(r,1,.005,20)];r.tick(dt);assert.equal(h.hp,88);
});
test('CEO45.1 chronological contacts trigger innate shield once',()=>{
 const {r,h}=arena();h.hero='knight';h.perk.readyAt=0;r.hostile=[shot(r,2,.022,20),shot(r,1,.005,7)];r.tick(dt);assert.equal(h.hp,100);assert.ok(h.perk.readyAt>r.time);// Actual perk state, no mocked damage callback.
 const ready=h.perk.readyAt;r.hostile=[shot(r,3,.005,20)];r.tick(dt);assert.equal(h.perk.readyAt,ready,'protected subsequent contact cannot trigger the perk again');assert.equal(h.hp,100);
});
for(const life of [1,0,-1])test('CEO45.1 newborn zero-travel birth overlap, life '+life,()=>{
 const {r,h}=arena();r.hostile=[{id:1,x:0,y:0,vx:600,vy:0,life,dmg:20,bornAt:r.time+dt}];r.tick(dt);assert.equal(h.hp,life>0?80:100,'birth endpoint is a contact only while alive');
});
