import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
for(const dir of [-1,1])for(const [x,y,hit] of [[123,33,false],[123,25,true],[124,20,true],[125,20,false],[100,33,true],[100,35,false]])for(const method of ['slash','slashHits'])test('CEO45.2 '+method+' real ghoul r14 '+dir+' '+x+','+y,()=>{
 const r=new Room('CNR',()=>{});r.addPlayer(1,'P','ranger');r.start();r.time=100;r.enemies=[];const h=r.heroes.get(1);h.x=h.y=0;h.perk.readyAt=Infinity;
 const e=r.spawnEnemy('ghoul',[h],1);Object.assign(e,{x:dir*x,y,hp:1000,maxHp:1000});assert.equal(e.r,14);r.rebuildGrid();
 if(method==='slash')r.slash(h,dir,110,40,10);else r.slashHits(h,dir,110,40,10,{weapon:'whip',tags:[]},[]);
 assert.equal(e.hp<1000,hit,'circle must overlap the actual rectangle, including rounded expanded corners');
});
