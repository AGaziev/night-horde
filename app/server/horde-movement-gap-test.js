import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
import {HORDE_PACKS} from '../public/shared/horde-content.js';

function encounter() {
 const room=new Room('POSITION-GAP',()=>{});
 room.addPlayer(1,'Director','witch');room.setRuleset('horde');room.addPlayer(2,'Hero','witch');room.start();
 const hero=room.heroes.get(2);hero.speed=150;hero.perk.readyAt=Infinity;
 room.onPos(hero.pid,{x:0,y:0,seq:1});
 return{room,hero};
}

test('holding only pos for1.1s cannot spend retroactive movement or repeat its allowance',()=>{
 const{room,hero}=encounter();room.time=1.1;
 room.onPos(hero.pid,{x:1700,y:0,seq:2});
 assert.ok(hero.x<=150/30*1.1+1e-7,'stale positions may spend only the current server tick');
 const before=hero.x;room.resync(hero.pid);
 room.onPos(hero.pid,{x:1700,y:0,seq:3});assert.equal(hero.x,before);assert.equal(hero.posAck,3);
});

test('holding pos cannot cancel a paid formation that ordinary paced movement cannot reach',()=>{
 function scene(held){
  const{room,hero}=encounter();
  for(let n=1;n<=33;n++){room.time=n/30;if(!held)room.onPos(hero.pid,{x:0,y:0});}
  assert.equal(room.horde.buy(HORDE_PACKS.swarm,665,0),null);
  room.onPos(hero.pid,{x:1700,y:0});
  for(let n=1;n<=60;n++){
   room.time=1.1+n/30;room.onPos(hero.pid,{x:hero.x+5,y:0});
  }
  room.horde.tick(0,[hero]);
  return{x:hero.x,units:room.enemies.filter(e=>e.hordeSource==='manual').length};
 }
 const normal=scene(false),held=scene(true);
 assert.equal(normal.units,12);assert.equal(held.units,12,JSON.stringify({normal,held}));
 assert.ok(held.x-normal.x<=5.5+1e-7);
});

test('a held pos cannot backdate movement under chill to escape its warned blast',()=>{
 const{room,hero}=encounter();room.horde.combat.chill(hero,{duration:3});
 room.addBlast(0,0,100,8,0,null,1,1.1);const hp=hero.hp;
 room.time=1.1;room.onPos(hero.pid,{x:1700,y:0});room.updateBlasts();
 assert.ok(hero.x<=150*.82/30*1.1+1e-7);assert.ok(hero.hp<hp);
});

test('ordinary packet jitter and its ACK keep honest movement without a repeatable bonus',()=>{
 const{room,hero}=encounter();room.time=.12;room.onPos(hero.pid,{x:18,y:0,seq:2});
 assert.equal(hero.x,18);assert.equal(hero.posAck,2);
 room.onPos(hero.pid,{x:1700,y:0,seq:3});assert.equal(hero.x,18);
 room.time+=1/30;room.onPos(hero.pid,{x:23,y:0,seq:4});assert.equal(hero.x,23);assert.equal(hero.posAck,4);
});

test('the stale Horde position rule does not change ordinary PvE positioning',()=>{
 const room=new Room('PVE-CONTROL',()=>{});room.addPlayer(1,'P','witch');room.start();
 const hero=room.heroes.get(1);room.onPos(1,{x:0,y:0});room.time=1.1;room.onPos(1,{x:200,y:0,seq:2});
 assert.equal(hero.x,200);assert.equal(hero.posAck,2);
});
