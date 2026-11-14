import assert from'node:assert/strict';import{test}from'node:test';import{Room}from'./game.js';
const dt=1/30;
function setup(){const r=new Room('TTL',()=>{});r.addPlayer(1,'P','witch');r.start();r.spawn=()=>{};r.breakAround=()=>{};const h=r.heroes.get(1);Object.assign(h,{x:100000,y:0,hp:100,maxHp:100,iframes:0,ward:0});h.weapons.clear();h.perk.readyAt=Infinity;r.handle(1,{t:'dash',x:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});return{r,h};}
for(const offset of[-1/524288,0,1/524288])test(`own dash contact TTL is exclusive at expiry, offset${offset}`,()=>{
 const{r,h}=setup(),life=1/64;r.hostile.push({id:r.nextId++,x:h.x-21-512*(life+offset),y:0,vx:512,vy:0,life,dmg:8,from:'spitter:shot'});r.step(dt);assert.equal(h.hp,offset<0?92:100);assert.equal(r.hostile.length,0);
});
for(const life of[1,0,-1])test(`positive-life newborn at dash tick end still tests birth overlap, life${life}`,()=>{
 const{r,h}=setup();r.hostile.push({id:r.nextId++,x:h.x,y:0,vx:512,vy:0,bornAt:dt,life,dmg:8,from:'spitter:shot'});r.step(dt);assert.equal(h.hp,life>0?92:100);
});
