import assert from 'node:assert/strict';
import {Room} from './game.js';
import {DUOS} from '../public/shared/content.js';
for(const level of [1,2,3]) {
 const r=new Room('FOCUS',()=>{});r.addPlayer(1,'A','knight');r.start();r.time=100;r.enemies=[];
 const h=r.heroes.get(1);h.x=h.y=0;h.perk.readyAt=Infinity;const w={lvl:level,t:0};h.weapons=new Map([['arclaser',w]]);
 for(const x of [100,140,180]){const e=r.spawnEnemy('brute',[h],1);Object.assign(e,{x,y:0,hp:1e6,maxHp:1e6});}
 r.rebuildGrid();const calls=[],hurt=r.hurtEnemy.bind(r);r.hurtEnemy=(e,dmg,owner,src)=>{calls.push({e,dmg,src});return hurt(e,dmg,owner,src);};
 r.updateWeapon(h,'arclaser',w,1/30);
 const L=DUOS.arclaser.levels[level-1];
 assert.equal(calls.filter(c=>c.dmg===L.dmg*4).length,1,'one central target gets the signature focus budget');
 assert.equal(calls.filter(c=>c.dmg===L.dmg).length,2,'other direct beams keep the bounded crowd budget');
 assert.ok(calls.some(c=>Math.abs(c.dmg-L.dmg*.35)<1e-6),'chain damage is not amplified by focus');
 assert.ok(calls.every(c=>c.src.weapon==='arclaser'),'no component casts or separate sources');
}
console.log('arclaser: single focused target, bounded crowd/chain, own signature at I/II/III');
