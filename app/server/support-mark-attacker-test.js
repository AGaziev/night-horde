import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
function arena(){const r=new Room('CTRL',()=>{});r.addPlayer(1,'Sand','ranger');r.addPlayer(2,'Frost','ranger');r.start();r.time=100;r.enemies=[];const [a,b]=r.heroes.values();for(const h of [a,b]){h.x=1000;h.y=0;h.weapons.clear();h.perk.readyAt=Infinity;}const e=r.spawnEnemy('ghoul',[a],1);Object.assign(e,{x:0,y:0,hp:1e6,maxHp:1e6,speed:20});return {r,a,b,e};}
test('CEO41.5 hostile damage with no hero cannot be an ally mark boost',()=>{
 const {r,a,e}=arena();e.markT=r.time+3;e.markMul=.3;e.markOwner=a;
 r.hurtEnemy(e,20,null,{weapon:'hostile',tags:[]});assert.equal(a.support.allyDamage,0);
 e.markT=0;r.hurtEnemy(e,20,null,{weapon:'hostile',tags:[],markSupport:{owner:a,fraction:.2}});assert.equal(a.support.allyDamage,0);
});
