import assert from 'node:assert/strict';
import {Room} from './game.js';
const r=new Room('SUP',()=>{});for(let i=1;i<=4;i++)r.addPlayer(i,'P'+i,'knight');r.start();r.time=100;r.enemies=[];
const [h,a,b,c]=r.heroes.values();for(const p of r.heroes.values()){p.x=p.y=0;p.perk.readyAt=Infinity;p.weapons.clear();}
h.weapons.set('bastion',{lvl:1,t:0});r.updateWeapon(h,'bastion',h.weapons.get('bastion'),1/30);
a.ward=a.wardMax=2;b.ward=0;b.wardMax=2;c.ward=0;
r.hurtPlayer(h,20);assert.equal(a.ward,2);assert.equal(b.ward,1,'skip a full first ally and share with an eligible one');
const charges=h.ward;r.hurtPlayer(b,20);assert.equal(h.ward,charges,'gift charge cannot generate a counterattack or share back');
assert.equal(h.support?.blocked,40,'own block and actual gifted block attributed once');
b.hp=b.maxHp-2;r.healSupport(h,b,20);assert.equal(h.support.healing,2,'overheal excluded');
const e=r.spawnEnemy('ghoul',[h],1);Object.assign(e,{x:200,y:0,speed:20,dmg:0});r.root(e,2,h);r.freeze(e,2,a);r.slowEnemy(e,.5,2,b);
r.moveEnemies(.1,[h,a,b,c]);assert.equal(h.support.control+a.support.control+b.support.control,.1,'overlapping control is one enemy-second union');
const boss=r.spawnEnemy('brute',[h],1);boss.boss=true;r.freeze(boss,2,h);r.root(boss,2,h);r.slowEnemy(boss,.9,2,h);
assert.ok(boss.frozenT<=r.time&&boss.rootT<=r.time);assert.equal(boss.slow,.25,'boss slow capped');
const row=r.snapshot().support.find(p=>p[0]===h.pid);assert.equal(row[3],40);
console.log('support: effective healing, bounded shared shields, union control and boss caps');
