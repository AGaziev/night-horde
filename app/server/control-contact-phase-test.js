import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {Room} from './game.js';
import {runStore} from './runlog.js';
import {HOSTILE_R,PLAYER_RADIUS} from '../public/shared/content.js';
const dt=1/30,results=[];
export function frostScene({mode='night',frozen=true,shots='first',contactAlly=false,frames=1,enemyType='ghoul'}={}) {
 const random=Math.random;let state=832,draws=0;Math.random=()=>{draws++;state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
 try {
  const r=new Room('FROST-PHASE',()=>{});r.setMode(mode);r.addPlayer(1,'Frost','ranger');r.addPlayer(2,'Ally','ranger');r.start();r.time=100-dt;r.enemies=[];r.events.next=Infinity;
  const [h,b]=r.heroes.values();for(const p of [h,b]){p.y=0;p.hp=p.maxHp=100;p.weapons.clear();p.perk.readyAt=Infinity;}h.x=26;b.x=contactAlly?-26:1000;
  const e=r.spawnEnemy(enemyType,[h,b],1);Object.assign(e,{x:0,y:0,hp:1e6,maxHp:1e6,dmg:0});if(enemyType==='shield')Object.assign(e,{fa:105*Math.PI/180,dcd:10,bs:0});h.weapons.set('frost',{lvl:1,t:0});r.tick(dt);
  assert.ok(e.frozenT>r.time,'actual FrostI from preceding Room.tick reached the target');assert.equal(e.frozenOwner,h);assert.equal(h.support.control,0,'preparation did not earn prevention');
  if(!frozen){e.frozenT=0;e.frozenOwner=null;}e.dmg=30;for(const p of [h,b]){p.iframes=0;p.hp=100;}
  const radius=HOSTILE_R+PLAYER_RADIUS,shot=(id,p,dir)=>({id,x:p.x-dir*(radius+600*.005),y:0,vx:dir*600,vy:0,life:1,dmg:10,from:'early-protection'});
  if(shots!=='none')r.hostile=[shot(800,h,-1)];if(shots==='both')r.hostile.push(shot(801,b,1));
  const trace=[];for(let n=0;n<frames;n++){r.tick(dt);trace.push({time:r.time,x:e.x,y:e.y,hp:[h.hp,b.hp],iframes:[h.iframes,b.iframes],enemyHP:e.hp,angle:e.fa,phase:e.bs,shots:r.hostile.map(s=>[s.id,s.x,s.y,s.life])});}
  const control=h.support.control,snapshot=r.snapshot();r.finish(false);const stored=runStore.get(r.lastLog.id);return {mode,frozen,shots,contactAlly,frames,trace,control,allyControl:b.support.control,draws,snapshotControl:snapshot.support.find(row=>row[0]===h.pid)?.[4]??0,storedControl:stored.team.find(p=>p.pid===h.pid).support.control};
 }finally{Math.random=random;}
}
for(const mode of ['night','lunch'])for(const [name,options,delivered]of [['early-shot',{shots:'first'},false],['no-shot',{shots:'none'},true],['both-protected',{shots:'both',contactAlly:true},false],['one-unprotected-ally',{shots:'first',contactAlly:true},true]])for(const frames of [1,3])test(`CEO6880837720 FrostI body prevention after projectiles ${mode} ${name} ${frames}`,()=>{
 const plain=frostScene({mode,...options,frames,frozen:false}),controlled=frostScene({mode,...options,frames});results.push({name,plain,controlled});
 assert.equal(controlled.control,delivered?frames*dt:0,'only body events still available after early projectile protection can be prevented');assert.equal(controlled.allyControl,0);assert.equal(controlled.snapshotControl,Math.round(controlled.control*10)/10);assert.equal(controlled.storedControl,Math.round(controlled.control*10)/10);
 assert.deepEqual(controlled.trace.at(-1).hp,[options.shots==='none'?100:90,options.contactAlly&&options.shots==='both'?90:100]);
 assert.deepEqual(plain.trace.at(-1).hp,[options.shots==='none'?70:90,options.contactAlly?(options.shots==='both'?90:70):100]);
});
for(const mode of ['night','lunch'])test('CEO6880837720 protected hero does not erase actual shield turn prevention '+mode,()=>{
 const plain=frostScene({mode,enemyType:'shield',frozen:false}),controlled=frostScene({mode,enemyType:'shield'});results.push({name:'protected-shield-action',plain,controlled});assert.equal(controlled.control,dt);assert.deepEqual(controlled.trace[0].hp,plain.trace[0].hp);assert.notEqual(controlled.trace[0].angle,plain.trace[0].angle,'defensive turn is independently prevented despite hero protection');
});
test('CEO6880837720 contribution budget resets each native frame, finish and new run',()=>{
 const r=new Room('UNION',()=>{});r.addPlayer(1,'Owner','ranger');r.start();r.time=100;const h=r.heroes.get(1);h.x=300;h.y=0;h.weapons.clear();h.perk.readyAt=Infinity;const e=r.spawnEnemy('ghoul',[h],1);e.x=e.y=0;r.root(e,1,h);r.moveEnemies(dt,[h]);assert.equal(h.support.control,dt);assert.equal(r.controlCredited.size,1);
 r.time+=dt;r.moveEnemies(dt,[h]);assert.equal(h.support.control,2*dt);assert.equal(r.controlCredited.size,1);r.finish(false);assert.equal(r.controlCredited.size,0);r.start();assert.equal(r.controlCredited.size,0);
});
process.on('exit',()=>{if(process.env.CONTROL_CONTACT_OUTPUT)fs.writeFileSync(process.env.CONTROL_CONTACT_OUTPUT,JSON.stringify({runtime:process.version,results},null,2));});
