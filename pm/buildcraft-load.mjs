// Worst supported equipment load: eight players, two duos + four plain weapons each, 350 enemies.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Room } from '../app/server/game.js';
import { DUOS, WEAPON_IDS, TICK_HZ, MAX_ENEMIES } from '../app/public/shared/content.js';
const pairs=[['spectral','inferno'],['arclaser','crystalchoir'],['sunprism','resonantshield'],['singularity','crystalchoir'],
  ['gravitybell','sunprism'],['blacksnare','spectral'],['minefield','aurora'],['stormlight','firewheel']];
let bytes=0,snapshots=0;
const r=new Room('LOAD',(pid,msg,json)=>{if(pid===1&&msg.t==='s'){bytes+=(json??JSON.stringify(msg)).length;snapshots++;}});
for(let pid=1;pid<=8;pid++)r.addPlayer(pid,'P'+pid,'knight');r.start();
r.time=400;r.bossIdx=2;r.bossAt=[];r.peaks=[];r.nextEliteT=r.nextInvasionT=Infinity;r.events.next=Infinity;r.spawn=()=>{};r.addXp=()=>{};
const heroes=[...r.heroes.values()];
for(const [i,h] of heroes.entries()){
  const consumed=new Set(pairs[i].flatMap(id=>DUOS[id].parts));
  const rest=WEAPON_IDS.filter(id=>!consumed.has(id)).slice(i%4,i%4+4);
  h.weapons=new Map([...pairs[i].map(id=>[id,{lvl:3,t:0.2}]),...rest.map(id=>[id,{lvl:5,t:0.2}])]);
  assert.equal(h.weapons.size,6);h.perk.readyAt=Infinity;
  h.passives=new Map(['haste','echo','area','crit','coil','ashseal'].map(id=>[id,5]));r.recalcMods(h);r.updateCombos(h);
}
const times=[],wall=[],maxima={projectiles:0,puddles:0,traps:0,waves:0};
for(let frame=0;frame<TICK_HZ*30;frame++){
  while(r.enemies.length<MAX_ENEMIES)r.spawnEnemy(['skel','ghoul','brute','spitter'][r.enemies.length%4],heroes,50);
  for(const h of heroes){h.hp=h.maxHp;const a=frame/TICK_HZ*0.7+h.pid;r.handle(h.pid,{t:'pos',x:Math.cos(a)*(100+h.pid*30),y:Math.sin(a)*(100+h.pid*30),fx:-Math.sin(a),fy:Math.cos(a)});}
  const at=performance.now(),cpu=process.cpuUsage();r.tick(1/TICK_HZ);const usage=process.cpuUsage(cpu);
  if(frame>60){times.push((usage.user+usage.system)/1000);wall.push(performance.now()-at);}
  maxima.projectiles=Math.max(maxima.projectiles,r.projectiles.length);maxima.puddles=Math.max(maxima.puddles,r.puddles.length);
  maxima.traps=Math.max(maxima.traps,r.traps.length);maxima.waves=Math.max(maxima.waves,r.coldWaves.length);
}
times.sort((a,b)=>a-b);wall.sort((a,b)=>a-b);
const kept=times.slice(0,Math.ceil(times.length*0.99));
const report={players:8,duosPerPlayer:2,weaponsPerPlayer:6,enemies:MAX_ENEMIES,seconds:30,node:process.version,
  cpuTrimmedMs:kept.reduce((a,b)=>a+b,0)/kept.length,p99WallMs:wall[Math.floor(wall.length*0.99)],
  tickBudgetMs:1000/TICK_HZ,averageWireBytes:Math.round(bytes/snapshots),maxima};
assert.ok(report.p99WallMs<report.tickBudgetMs,'the supported maximum load keeps the 30 Hz deadline');
assert.ok(maxima.projectiles<5000&&maxima.puddles<1500&&maxima.traps<300&&maxima.waves<300,'fields and projectiles remain bounded');
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
