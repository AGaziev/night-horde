// Repeatable acceptance bench: compare each complete duo with its two actual parts at the same levels/build/seed.
// node pm/buildcraft-bench.mjs [seconds=24] [report.json] [comma-separated duo ids]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Room } from '../app/server/game.js';
import { DUOS, TICK_HZ } from '../app/public/shared/content.js';

const seconds=Number(process.argv[2]??24), reportPath=process.argv[3];
const ids=process.argv[4]?.split(',')??Object.keys(DUOS), seeds=[11,29];
const builds={plain:[],rapid:['might','haste','echo','crit','area','hourglass'],elemental:['ember','frostcore','coil','ashseal','lens','counterweight']};
function random(seed){let x=seed>>>0;return()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};}
let fights=0;
function measure(weapons,layout,build,players,seed){
  const original=Math.random;Math.random=random(seed);
  try {
    const r=new Room('BENCH',()=>{});
    for(let i=1;i<=players;i++)r.addPlayer(i,'P'+i,'knight');r.start();
    r.spawn=()=>{};r.nextEliteT=r.nextInvasionT=Infinity;r.peaks=[];r.bossAt=[];r.events.next=Infinity;r.addXp=()=>{};
    r.enemies.length=0;
    for(const h of r.heroes.values()){h.weapons=new Map();h.perk.readyAt=Infinity;h.baseHp=1e7;h.hp=h.maxHp=1e7;h.x=h.y=0;}
    const h=r.heroes.get(1);h.weapons=new Map(weapons.map(([id,lvl])=>[id,{lvl,t:0.2}]));h.passives=new Map(build.map(id=>[id,3]));r.recalcMods(h);
    const enemies=[];
    for(let i=0;i<(layout==='boss'?1:36);i++){
      const e=r.spawnEnemy('brute',[h],1), a=Math.random()*Math.PI*2,d=layout==='boss'?100:45+Math.random()*250;
      Object.assign(e,{x:Math.cos(a)*d,y:Math.sin(a)*d,hp:1e9,maxHp:1e9,boss:layout==='boss',speed:75,dmg:0,shotT:Infinity});enemies.push(e);
    }
    // Harmless moving targets; the boss uses real boss immunities. No boss AI, pickups or offers alter the measurements.
    r.moveEnemies=(dt)=>{for(const e of enemies){
      if(e.frozenT>r.time||e.rootT>r.time)continue;
      const dx=h.x-e.x,dy=h.y-e.y,d=Math.hypot(dx,dy)||1;
      const speed=e.speed*(e.slowT>r.time?1-e.slow:1)*(e.dragT>r.time?1-e.drag:1);
      if(d>45){e.x+=dx/d*speed*dt;e.y+=dy/d*speed*dt;}
    }};
    for(let frame=0;frame<seconds*TICK_HZ;frame++){
      const a=frame/TICK_HZ*1.4,nx=Math.cos(a)*55,ny=Math.sin(a)*55;
      const dx=nx-h.x,dy=ny-h.y,d=Math.hypot(dx,dy)||1;
      h.fx=h.mvx=dx/d;h.fy=h.mvy=dy/d;h.x=nx;h.y=ny;h.movedT=r.time;
      if(frame%60===0&&h.iframes<=0)r.hurtPlayer(h,1,'bench');
      r.tick(1/TICK_HZ);
      for(const e of enemies)if(!e.boss&&Math.hypot(e.x-h.x,e.y-h.y)<30){const a=Math.random()*Math.PI*2;e.x=h.x+Math.cos(a)*240;e.y=h.y+Math.sin(a)*240;}
      r.fx.length=0;
    }
    assert.ok(Number.isFinite(h.dmg));fights++;return h.dmg/seconds;
  } finally {Math.random=original;}
}
const rows=[];let failed=0;
for(const id of ids){
  const D=DUOS[id], cases=[];
  for(const players of [1,4,8])for(const [build,passives]of Object.entries(builds)){
    if(players>1&&build!=='rapid')continue;
    for(const layout of ['crowd','boss'])for(const level of [1,2,3]){
      const samples=seeds.map(seed=>{
        const fused=measure([[id,level]],layout,passives,players,seed);
        const parts=measure(D.parts.map(part=>[part,level+2]),layout,passives,players,seed);
        return {fused,parts,ratio:parts?fused/parts:Infinity};
      });
      const fused=samples.reduce((n,s)=>n+s.fused,0)/samples.length, parts=samples.reduce((n,s)=>n+s.parts,0)/samples.length;
      const ratio=fused/parts,minSeed=Math.min(...samples.map(s=>s.ratio));
      const pass=Number.isFinite(ratio)&&ratio>=1.1&&minSeed>1;
      if(!pass)failed++;
      cases.push({players,build,layout,level,fused:Math.round(fused*10)/10,parts:Math.round(parts*10)/10,ratio:Math.round(ratio*1000)/1000,minSeed:Math.round(minSeed*1000)/1000,pass});
    }
  }
  const worst=cases.reduce((a,b)=>a.ratio<b.ratio?a:b);
  rows.push({id,name:D.name,minRatio:worst.ratio,worst,cases});
  console.log(`${id}: min ×${worst.ratio}, ${cases.filter(c=>!c.pass).length} failures`);
}
const sourceFiles=['app/server/game.js','app/server/confluences.js','app/server/hero-perks.js','app/public/shared/content.js','app/public/shared/confluences.js'];
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
const report={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,sourceHashes,
  seconds,seeds,groups:[1,4,8],builds,minimumMeanRatio:1.1,minimumSingleSeedRatio:1,fights,cases:rows.reduce((n,r)=>n+r.cases.length,0),failed,rows};
if(reportPath)fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({fights,cases:report.cases,failed,minRatio:Math.min(...rows.map(r=>r.minRatio))}));
if(failed)process.exitCode=1;
