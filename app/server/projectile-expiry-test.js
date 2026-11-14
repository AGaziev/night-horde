import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
import {movingCircleImpact} from '../public/shared/combat-geometry.js';
const dt=1/30,life=1/64;
function arena(){const r=new Room('TTL',()=>{});r.addPlayer(1,'P','ranger');r.start();r.time=100;r.enemies=[];const h=r.heroes.get(1);h.x=h.y=0;h.weapons.clear();h.perk.readyAt=Infinity;h.iframes=0;return {r,h};}
for(const offset of [-1/524288,0,1/524288])test('r13-45 strict lifetime entry offset '+offset,()=>{
 const {r,h}=arena(),hp=h.hp,start=r.time,x=-29-512*offset;
 r.hostile=[{id:800,x,y:0,vx:512,vy:0,life,dmg:20,from:'expiry'}];r.tick(dt);
 assert.equal(h.hp,hp-(offset<0?20:0),'contact must enter the circle before the exclusive lifetime endpoint');assert.equal(r.hostile.length,0);
 const end=r.fx.find(e=>e[0]==='epend'&&e[1]===800);assert.equal(end[5],offset<0?1:0,'FX distinguishes real impact from expiration');
 assert.equal(end[2],Math.round((start+life+(offset<0?offset:0))*1000)/1000,'FX time is the clipped impact or exact expiry');
 assert.equal(movingCircleImpact(x,0,x+512*life,0,0,0,0,0,21)!==null,offset<0);
});
for(const remaining of [1,0,-1])test('r13-45 newborn endpoint lifetime '+remaining,()=>{
 const {r,h}=arena(),hp=h.hp;r.hostile=[{id:801,x:0,y:0,vx:512,vy:0,life:remaining,dmg:20,bornAt:r.time+dt}];r.tick(dt);assert.equal(h.hp,hp-(remaining>0?20:0));
 const end=r.fx.find(e=>e[0]==='epend'&&e[1]===801);assert.equal(end[5],remaining>0?1:0);
});
