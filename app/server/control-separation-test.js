import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {Room} from './game.js';
import {ENEMY_TYPES} from '../public/shared/content.js';
const dt=1/30;
import {projectControlSeparation} from './control-observation.js';
export function neighborScene({slow,edge=true,guard=true}={}) {
 const original=Math.random;let state=117,draws=0;Math.random=()=>{draws++;state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
 try{const r=new Room('SEPARATION',()=>{});r.addPlayer(1,'Sand','ranger');r.addPlayer(2,'Freezer','ranger');r.start();r.time=100;r.enemies=[];const [h,b]=r.heroes.values();for(const p of [h,b]){p.weapons.clear();p.perk.readyAt=Infinity;p.hp=p.maxHp=100;p.y=0;}h.x=26;b.x=27;
 const a=r.spawnEnemy('skel',[h],1),neighbor=r.spawnEnemy('skel',[h],1);for(const e of [a,neighbor]){e.y=0;e.hp=e.maxHp=1e6;if(guard)e.outpost={x:0,y:0};assert.equal(e.type,ENEMY_TYPES.indexOf('skel'));}a.x=edge?520:500;neighbor.x=edge?502.5:480;
 assert.equal(r.freeze(neighbor,2,b),true);const item=r.dropItem('slowtime',h.x,0);r.updateItems(dt,[h,b]);assert.ok(!r.items.includes(item));for(const e of [a,neighbor]){assert.equal(e.slowOwner,h);assert.ok(e.slowT>r.time);if(!slow){e.slowSources.clear();e.slowT=0;e.slow=0;e.slowOwner=null;}}
 const timeline=[];for(let n=0;n<30;n++){r.tick(dt);timeline.push({enemies:[a,neighbor].map(e=>({id:e.id,type:e.type,x:e.x,y:e.y,hp:e.hp,fa:e.fa,bs:e.bs,bt:e.bt})),heroes:[h,b].map(p=>[p.hp,p.iframes]),shots:r.hostile.map(s=>[s.x,s.y,s.life])});}
 return {timeline,sandControl:h.support.control,freezeControl:b.support.control,draws,types:[a.type,neighbor.type]};
 }finally{Math.random=original;}
}
const results=[];
for(const [id,options] of [['two-skel-leash',{edge:true,guard:true}],['inset-separation',{edge:false,guard:true}],['ordinary-separation',{edge:false,guard:false}]])test('r17 '+id+' projects full separation before claiming slow',()=>{const plain=neighborScene({...options,slow:false}),controlled=neighborScene({...options,slow:true}),negative=id==='two-skel-leash';results.push({id,plain,controlled});assert.equal(JSON.stringify(plain.timeline)===JSON.stringify(controlled.timeline),negative,'full traces of BOTH real skeletons and heroes');if(negative)assert.equal(controlled.draws,plain.draws);assert.ok(Math.abs(controlled.sandControl-(negative?0:1))<1e-9);assert.ok(Math.abs(controlled.freezeControl-1)<1e-9,'other caster actual freeze is separately owned, not confused with Sand');});
process.on('exit',()=>{if(process.env.CONTROL_SEPARATION_OUTPUT)fs.writeFileSync(process.env.CONTROL_SEPARATION_OUTPUT,JSON.stringify({runtime:process.version,results},null,2));});
test('r17 pure separation preserves bucket order/limit and never mutates query cache',()=>{
 const r=new Room('PURE',()=>{});r.addPlayer(1,'P','ranger');r.start();const e={id:1,x:0,y:0,r:10},a={id:2,x:5,y:0,r:10},b={id:3,x:10,y:0,r:10};r.enemies=[e,a,b];r.rebuildGrid();const near=r.grid.query(0,0,50,r.q1),before=JSON.stringify([r.enemies,[...r.grid.cells],near]);const random=Math.random,query=r.grid.query;r.grid.query=()=>{throw Error('observer cannot call actual query');};Math.random=()=>{throw Error('observer cannot draw RNG');};
 try{assert.deepEqual(projectControlSeparation(r.grid,e,0,0,50,1),[-3.75,0]);assert.deepEqual(projectControlSeparation(r.grid,e,0,0,50,2),[-5.3125,0]);assert.equal(JSON.stringify([r.enemies,[...r.grid.cells],near]),before);}finally{Math.random=random;r.grid.query=query;}
});
test('r17 projected query uses the plain endpoint footprint and marks RNG overlap unresolved',()=>{
 const r=new Room('PURE2',()=>{});r.addPlayer(1,'P','ranger');r.start();const e={id:1,x:0,y:0,r:10},a={id:2,x:200,y:0,r:10};r.enemies=[e,a];r.rebuildGrid();assert.ok(!r.grid.query(90,0,50,[]).includes(a));assert.deepEqual(projectControlSeparation(r.grid,e,190,0,50,10),[187.5,0]);assert.equal(projectControlSeparation(r.grid,e,200,0,50,10),null,'unobserved random overlap does not manufacture an effect');
});
export function randomOverlapScene() {
 const original=Math.random;let state=117,draws=0;Math.random=()=>{draws++;state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
 try{const r=new Room('RNG-OVERLAP',()=>{});r.addPlayer(1,'Sand','ranger');r.addPlayer(2,'Freezer','ranger');r.start();r.time=100;r.enemies=[];const [h,b]=r.heroes.values();for(const p of [h,b]){p.weapons.clear();p.perk.readyAt=Infinity;p.y=0;}h.x=1000;b.x=1100;const a=r.spawnEnemy('skel',[h],1),neighbor=r.spawnEnemy('skel',[h],1);a.x=a.y=neighbor.y=0;a.hp=neighbor.hp=1e6;r.slowEnemy(a,.7,2,h);neighbor.x=a.speed*(1-a.slow)*dt;r.freeze(neighbor,2,b);const before=draws;r.tick(dt);return {tickDraws:draws-before,draws,sandControl:h.support.control,enemies:[a,neighbor].map(e=>[e.x,e.y,e.hp]),heroes:[h.hp,b.hp]};}finally{Math.random=original;}
}
test('r17 an actual random overlap is conservatively uncredited without adding RNG draws',()=>{const result=randomOverlapScene();results.push({id:'native-random-overlap',result});assert.equal(result.tickDraws,1,'only the existing native separation jitter draw');assert.equal(result.sandControl,0,'uncertain random-overlap projection does not claim an effect');});
