import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
import {ringShotScene,zeroBodyScene} from './mobility-ring-fixture.js';
for(const pid of[1,2])for(const reverse of[false,true])for(const enemyX of[462,449,480])test(`zero dash uses ordinary body endpoint, pid${pid}/reverse${reverse}/enemy${enemyX}`,()=>{
 const normal=zeroBodyScene(Room,{pid,reverse,enemyX}),zero=zeroBodyScene(Room,{pid,reverse,enemyX,press:true});
 assert.equal(zero.path.moveX,0);assert.equal(zero.path.moveY,0);assert.ok(Math.abs(zero.x-426.3333333333333)<1e-8);
 for(const field of['hp','iframes','st','x','taken'])assert.deepEqual(zero[field],normal[field],field);
 assert.equal(normal.hp,enemyX===449?100-normal.damage:100);assert.equal(normal.iframes,enemyX===449?.4:0);
});
for(const pid of[1,2])for(const reverse of[false,true])test(`zero dash retains ordinary body phase after native Ward impulse, pid${pid}/reverse${reverse}`,()=>{
 const options={pid,reverse,enemyX:462,ward:true},normal=zeroBodyScene(Room,options),zero=zeroBodyScene(Room,{...options,press:true});
 assert.equal(normal.ward,0);assert.ok(normal.enemy.x>500,'actual Ward moves the living body');for(const field of['hp','iframes','st','taken','enemy'])assert.deepEqual(zero[field],normal[field],field);
});
for(const aPid of[1,2])for(const reverse of[false,true])test(`zero dash cannot insert body damage before the real native Spitter shot, pid${aPid}/reverse${reverse}`,()=>{
 const options={aPid,reverse,body:true},normal=ringShotScene(Room,options),zero=ringShotScene(Room,{...options,press:true});
 assert.equal(zero.path.moveX,0);assert.equal(zero.path.moveY,0);assert.deepEqual(zero.positions,normal.positions);assert.deepEqual(zero.hp,normal.hp);assert.deepEqual(zero.states,normal.states);assert.deepEqual(zero.allTaken,normal.allTaken);assert.deepEqual(zero.impact,normal.impact);
 // Accepted signature-fusion tuning in main changes Night4 damage from .60 to .48.
 assert.equal(normal.hp[0],20-normal.damage);assert.ok(Math.abs(normal.hp[0]-10.016)<1e-9);assert.deepEqual(normal.states,[0,0]);assert.deepEqual(normal.allTaken[0],{'spitter:shot':normal.damage});
});
