import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {Room} from './game.js';
const dt=1/30;
export function shieldScene(rooted,angle=105) {
 const original=Math.random;let state=117,draws=0;Math.random=()=>{draws++;state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
 try{const r=new Room('TURN',()=>{});r.addPlayer(1,'Trapper','ranger');r.addPlayer(2,'Ally','ranger');r.start();r.time=100;r.enemies=[];const [h,b]=r.heroes.values();for(const p of [h,b]){p.weapons.clear();p.perk.readyAt=Infinity;p.hp=p.maxHp=105;p.y=0;}h.x=-48;b.x=1000;h.fx=-1;h.fy=0;
 const e=r.spawnEnemy('shield',[h],1);Object.assign(e,{x:0,y:0,hp:1e6,maxHp:1e6,fa:angle*Math.PI/180,dcd:10,bs:0});r.rebuildGrid();const trap={lvl:1,t:0};r.updateWeapon(h,'traps',trap,dt);assert.equal(r.traps.length,1);assert.ok(Math.abs(r.traps[0].x-e.x)<r.traps[0].r+e.r*.5,'native forward placement is in trigger range');r.time+=.25;h.x=26;r.updateTraps(dt);assert.ok(e.rootT>r.time);assert.equal(e.rootOwner,h);if(!rooted){e.rootT=r.time;e.rootOwner=null;}const start=r.time,timeline=[];let hit;
 for(let n=0;n<30;n++){r.tick(dt);if(n===26){const hp=e.hp;r.updateWeapon(h,'whip',{lvl:1,t:0},dt);hit=hp-e.hp;}timeline.push({x:e.x,y:e.y,angle:e.fa,hp:e.hp,heroHP:h.hp,bs:e.bs,bt:e.bt});}
 return {timeline,control:h.support.control,hit,angle:e.fa*180/Math.PI,draws,sourceRoot:rooted,activeSeconds:r.time-start};
 }finally{Math.random=original;}
}
const results=[];
test('r17 real Trap I credits prevented shield turning at contact with attack cooldown active',()=>{const plain=shieldScene(false),rooted=shieldScene(true);results.push({id:'trap-shield-turn',plain,rooted});assert.ok(Math.abs(plain.angle-56.2985874)<1e-5);assert.equal(rooted.angle,105);assert.ok(Math.abs(plain.hit-2.8)<1e-8);assert.ok(Math.abs(rooted.hit-14)<1e-8);assert.ok(Math.abs(rooted.control-1)<1e-9,'actual turning/armor effect must receive contribution');});
test('r17 aligned shield with inactive attack has no fabricated turning contribution',()=>{const plain=shieldScene(false,0),rooted=shieldScene(true,0);results.push({id:'aligned-shield',plain,rooted});assert.deepEqual(rooted.timeline,plain.timeline);assert.equal(rooted.control,0);});
process.on('exit',()=>{if(process.env.CONTROL_SHIELD_OUTPUT)fs.writeFileSync(process.env.CONTROL_SHIELD_OUTPUT,JSON.stringify({runtime:process.version,results},null,2));});
