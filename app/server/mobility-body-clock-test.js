import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
const dt=1/30;
for(const mode of['early','ordinary','blocked'])test(`native body contact forwards its actual clock, ${mode}`,()=>{
 const r=new Room('BODY-CLOCK',()=>{});r.addPlayer(1,'P','witch');r.start();r.time=100;r.spawn=()=>{};r.breakAround=()=>{};r.events.next=Infinity;r.peaks=[];
 const h=r.heroes.get(1);Object.assign(h,{x:mode==='early'?0:mode==='blocked'?435:40,y:0,hp:100,maxHp:100,iframes:0,ward:0});h.weapons.clear();h.perk.readyAt=Infinity;
 const e=r.spawnEnemy('ghoul',[h],1);Object.assign(e,{x:mode==='blocked'?449:55,y:0,speed:0});
 if(mode==='blocked'){r.startFinale([h]);Object.assign(r.fin,{cx:0,cy:0,r:449});}
 const calls=[],hurt=r.hurtPlayer;r.hurtPlayer=function(...args){calls.push({at:args[3],roomTime:this.time,damage:args[1],source:args[2]});return hurt.apply(this,args);};
 if(mode!=='ordinary')r.handle(1,{t:'dash',x:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});
 r.step(dt);assert.equal(calls.length,1);assert.equal(calls[0].source,'ghoul');assert.equal(h.hp,100-e.dmg);assert.equal(calls[0].roomTime,r.time);
 const expected=mode==='early'?100+(55-e.r-14)/1200:r.time;assert.ok(Math.abs(calls[0].at-expected)<1e-9,JSON.stringify(calls));
 if(mode==='early')assert.ok(calls[0].at<r.time);else assert.equal(h.iframes,.4);
});
