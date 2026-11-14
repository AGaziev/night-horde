import assert from 'node:assert/strict';
import {Room} from './game.js';
import {ITEM_TYPES} from '../public/shared/content.js';
const r=new Room('SUP',()=>{});for(let i=1;i<=4;i++)r.addPlayer(i,'P'+i,'knight');r.start();r.time=100;r.enemies=[];
const [h,a,b,c]=r.heroes.values();for(const p of r.heroes.values()){p.x=p.y=0;p.perk.readyAt=Infinity;p.weapons.clear();}
h.weapons.set('bastion',{lvl:1,t:0});r.updateWeapon(h,'bastion',h.weapons.get('bastion'),1/30);
a.ward=a.wardMax=2;b.ward=0;b.wardMax=2;c.ward=0;
r.hurtPlayer(h,20);assert.equal(a.ward,2);assert.equal(b.ward,0,'gift is independent of own charges');assert.equal(b.sharedWard?.owner,h,'skip a full first ally and share with an eligible one');
const charges=h.ward;r.hurtPlayer(b,20);assert.equal(h.ward,charges,'gift charge cannot generate a counterattack or share back');
assert.equal(h.support?.blocked,40,'own block and actual gifted block attributed once');
b.hp=b.maxHp-2;r.healSupport(h,b,20);assert.equal(h.support.healing,2,'overheal excluded');
const e=r.spawnEnemy('ghoul',[h],1);Object.assign(e,{x:200,y:0,speed:20,dmg:0});r.root(e,2,h);r.freeze(e,2,a);r.slowEnemy(e,.5,2,b);
r.moveEnemies(.1,[h,a,b,c]);assert.equal(h.support.control+a.support.control+b.support.control,.1,'overlapping control is one enemy-second union');
const boss=r.spawnEnemy('brute',[h],1);boss.boss=true;r.freeze(boss,2,h);r.root(boss,2,h);r.slowEnemy(boss,.9,2,h);
assert.ok(boss.frozenT<=r.time&&boss.rootT<=r.time);assert.equal(boss.slow,.4,'boss slow capped');
for(const slow of [.3,.35,.4,.5,.9]) {
 boss.slowT=0;r.slowEnemy(boss,slow,2,h);
 assert.equal(boss.slow,Math.min(slow,.4),'ordinary frost and puddle slows survive the boss limit');
}
const row=r.snapshot().support.find(p=>p[0]===h.pid);assert.equal(row[3],40);
console.log('support: effective healing, bounded shared shields, union control and boss caps');
// Shared healing field cap includes repeated/overlapping casts from different owners.
b.hp=0;b.st=0;b.maxHp=100;r.time=200;h.support.healing=0;
for(let i=0;i<12;i++)r.healSupport(h,b,1,true);
assert.equal(b.hp,6);assert.equal(h.support.healing,6);
r.healSupport(a,b,20,true);assert.equal(b.hp,6,'all casters share the same recipient budget');
r.time=201;r.healSupport(a,b,20,true);assert.equal(b.hp,12,'next active second restores the field budget');
const log=r.runLog.build(r,false),card=r.runLog.card(r,log);
assert.deepEqual(log.team[0].support,card.players[0].support,'saved history contains the actual contribution');
assert.ok(!JSON.stringify(log).includes('sharedWard'),'owner object graph is never serialized');
{
 const f=r.spawnEnemy('ghoul',[h],1);r.time=300;
 assert.equal(r.freeze(f,2,h),true);
 for(let i=1;i<=24;i++){r.time=300+i*.1;r.freeze(f,2,a);}
 assert.equal(f.frozenT,302.5,'staggered allied freezes have a finite continuous limit');
 r.time=302.6;assert.equal(r.freeze(f,2,b),false,'mandatory thaw window');
 r.time=304.01;assert.equal(r.freeze(f,2,b),true,'control returns after immunity');
}
{
 const target=r.heroes.get(4);target.ward=1;target.sharedWard={owner:h,until:r.time+8};target.weapons.set('ward',{lvl:3,t:0});
 r.updateWeapon(target,'ward',target.weapons.get('ward'),1/30);
 assert.equal(target.sharedWard?.owner,h,'own initialization preserves an independent gift');
}
{
 r.enemies=[];r.time=500;const target=r.spawnEnemy('ghoul',[h],1);
 Object.assign(target,{x:100,y:0,speed:0,dmg:0});
 const beforeH=h.support.control,beforeA=a.support.control;
 r.slowEnemy(target,.3,.5,h);r.useItem(a,{type:ITEM_TYPES.indexOf('slowtime'),x:0,y:0},[h,a,b,c]);
 assert.equal(target.slowOwner,a,'the time-sand collector owns the replacement slow');
 r.time+=1;r.moveEnemies(.1,[h,a,b,c]);
 assert.equal(h.support.control,beforeH);assert.ok(a.support.control>beforeA);
 target.boss=true;target.slowT=0;r.useItem(a,{type:ITEM_TYPES.indexOf('slowtime'),x:0,y:0},[h,a,b,c]);assert.equal(target.slow,.4,'item control follows the same boss limit');
}
