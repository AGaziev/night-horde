import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
import {DUOS} from '../public/shared/content.js';
const dt=1/30;
function arena(id){const r=new Room('CEO31',()=>{});r.addPlayer(1,'One','knight');r.addPlayer(2,'Ally','ranger');r.start();r.time=100;r.enemies=[];const h=r.heroes.get(1);h.x=h.y=0;h.perk.readyAt=Infinity;h.weapons=new Map(DUOS[id].parts.map(p=>[p,{lvl:3,t:0}]));return {r,h};}
function fuse(r,h,id){const [a,b]=DUOS[id].parts;h.offer=[r.duoCard(h,{id,a,b})];r.sendOffer(h);r.handle(h.pid,{t:'pick',i:0,offerEpoch:h.offerEpoch});assert.ok(h.weapons.has(id),'actual pick fuses');}
function foe(r,h,x){const e=r.spawnEnemy('ghoul',[h],1);Object.assign(e,{x,y:0,hp:1e6,maxHp:1e6,speed:0,dmg:0});r.rebuildGrid();return e;}
for(const id of ['phalanx','dome','riposte','rod','resonantshield'])test('CEO31.1 '+id+' preserves depleted live shield and recharge',()=>{
 const {r,h}=arena(id),ward=h.weapons.get('ward');r.updateWeapon(h,'ward',ward,dt);
 while(h.ward>0)r.hurtPlayer(h,5,'test');ward.t=7;const hp=h.hp;
 fuse(r,h,id);const w=h.weapons.get(id);r.updateWeapon(h,id,w,dt);
 assert.equal(h.ward,0,'fusion cannot grant free blocks');assert.equal(w.init,true);assert.ok(Math.abs(w.t-(7-dt))<1e-9,'remaining recharge survives first tick');
 r.hurtPlayer(h,10,'test');assert.ok(h.hp<hp,'next hit really damages the depleted shield owner');
 r.updateWeapon(h,id,w,6.9);assert.equal(h.ward,0);r.updateWeapon(h,id,w,.1);assert.equal(h.ward,1,'one charge refills at the inherited remaining deadline');
});
