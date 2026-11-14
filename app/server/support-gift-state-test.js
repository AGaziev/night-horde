import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
function arena(){const r=new Room('GIFT',()=>{});for(let i=1;i<=3;i++)r.addPlayer(i,'P'+i,'ranger');r.start();r.time=100;const [a,b,c]=r.heroes.values();for(const h of [a,b,c]){h.x=h.y=0;h.perk.readyAt=Infinity;h.weapons.clear();}a.weapons.set('bastion',{lvl:1,t:5,init:true});a.ward=a.wardMax=2;return {r,a,b,c};}
function gift(r,a,b){r.hurtPlayer(a,20);assert.equal(b.sharedWard?.owner,a);}
test('CEO41.1 gift neither fills nor resets the recipient own recharge',()=>{
 const {r,a,b}=arena();b.weapons.set('ward',{lvl:3,t:1,init:true});b.ward=1;b.wardMax=2;gift(r,a,b);
 assert.equal(b.ward,1,'temporary gift stays outside own capacity');r.updateWeapon(b,'ward',b.weapons.get('ward'),.25);
 assert.equal(b.ward,1);assert.equal(b.weapons.get('ward').t,.75,'own recharge keeps progressing');r.hurtPlayer(b,20);assert.equal(b.ward,1,'gift is spent first without spending own charge');assert.equal(a.support.blocked,40);
});
test('CEO41.1 own initialization and capacity changes preserve a separate gift',()=>{
 const {r,a,b}=arena();gift(r,a,b);b.weapons.set('ward',{lvl:3,t:0});r.updateWeapon(b,'ward',b.weapons.get('ward'),1/30);const own=b.ward;
 assert.ok(b.sharedWard,'initial own ward does not destroy an unexpired gift');b.mods.amount+=1;r.updateWeapon(b,'ward',b.weapons.get('ward'),1/30);assert.equal(b.ward,own);
 r.time+=8;r.updatePlayers(1/30,[...r.heroes.values()]);assert.equal(b.ward,own,'gift expiration cannot subtract an own charge');assert.equal(b.sharedWard,null);
});
test('CEO41.2 expired gift cannot absorb an early AI hazard',()=>{
 const {r,a,b}=arena();gift(r,a,b);r.time+=8;const hp=b.hp;r.hurtPlayer(b,20,'bloater:blast');
 assert.equal(b.hp,hp-20);assert.equal(a.support.blocked,20,'only the original Bastion own hit is credited');assert.equal(b.sharedWard,null);
});
test('CEO41.1 Quick Shield overclock and expiry cannot delete its own remaining charge',()=>{
 const {r,a,b}=arena();b.weapons.set('ward',{lvl:5,t:7,init:true});b.ward=1;b.wardMax=3;gift(r,a,b);
 const card=r.ovrCards(b,'ward').find(c=>c.name==='Быстрый щит');assert.ok(card);assert.ok(r.overclock(b,card));
 assert.equal(b.ward,1);assert.ok(b.sharedWard);r.time+=8;r.updatePlayers(1/30,[...r.heroes.values()]);assert.equal(b.sharedWard,null);assert.equal(b.ward,1,'only the expired independent gift disappears');
});
test('CEO41.2 real Room tick expires the gift before an early bloater blast',()=>{
 const {r,a,b,c}=arena();gift(r,a,b);a.x=c.x=500;const hp=b.hp,blocked=a.support.blocked;
 const e=r.spawnEnemy('bloater',[b],1);Object.assign(e,{x:0,y:0,speed:0,fuseT:.001});r.time=108;r.tick(1/30);
 assert.ok(e.exploded,'native AI fuse really detonated');assert.ok(b.hp<hp,'expired gift cannot absorb an AI-phase explosion');assert.equal(a.support.blocked,blocked,'expired donation earns no phantom prevention');
});
