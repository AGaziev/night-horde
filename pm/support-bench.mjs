// Isolated contribution scenarios using real server casts/HP/marks, not DPS-only projections.
import {Room} from '../app/server/game.js';
const rows=[];
for(const players of [1,2,3,4,5,6,7,8]) {
 const r=new Room('SUPPORT',()=>{});for(let p=1;p<=players;p++)r.addPlayer(p,'P'+p,p===1?'herald':'ranger');r.start();
 r.time=100;r.enemies=[];const hs=[...r.heroes.values()],h=hs[0];for(const a of hs){a.x=a.y=0;a.hp=70;a.maxHp=100;a.weapons.clear();a.perk.readyAt=0;}
 h.weapons=new Map([['tocsin',{lvl:1,t:0}],['lantern',{lvl:3,t:0}],['frost',{lvl:3,t:0}],['bastion',{lvl:1,t:0}]]);
 const enemies=[];for(let j=0;j<12;j++){const e=r.spawnEnemy('ghoul',hs,1);Object.assign(e,{x:80+j*3,y:(j%3-1)*15,speed:20,dmg:0,hp:1e9});enemies.push(e);}
 for(let frame=0;frame<300;frame++){
  const dt=1/30;r.time+=dt;r.rebuildGrid();r.hitFx=0;
  for(const [id,w] of h.weapons)r.updateWeapon(h,id,w,dt);r.updateColdWaves(dt);r.moveEnemies(dt,hs);
  if(frame%30===0){h.iframes=0;r.hurtPlayer(h,10);for(const a of hs.slice(1)){r.hurtEnemy(enemies[0],10,a,{weapon:'knives',tags:['phys']});if(a.ward>0)r.hurtPlayer(a,10);}}
  r.fx=[];
 }
 const summary={players,ownDamage:Math.round(h.dmg),support:h.support,teamHP:Math.round(hs.reduce((n,a)=>n+a.hp,0))};rows.push(summary);
}
console.log(JSON.stringify(rows,null,2));
