// Finite native scene: ordinary pos messages, auto finale/shrink, real Spitter windup/flight.
import { FINALE, PLAYER_RADIUS, ENEMIES } from '../public/shared/content.js';
const dt=1/30;
export function ringShotScene(Room,{press=false,shortLife=false,aPid=1,reverse=false,inward=0,still=false}={}) {
 const bPid=3-aPid,r=new Room('RING-PROJECTION',()=>{});
 for(const pid of[aPid,bPid,3,4])r.addPlayer(pid,'P'+pid,'witch');r.start();
 r.spawn=()=>{};r.breakAround=()=>{};r.events.next=Infinity;r.peaks=[];r.bossIdx=r.bossAt.length;r.nextEliteT=r.nextInvasionT=Infinity;
 const [a,b,c,d]=[aPid,bPid,3,4].map(pid=>r.heroes.get(pid));
 for(const h of[a,b,c,d]){Object.assign(h,{hp:100,maxHp:100,iframes:0,ward:0});h.weapons.clear();h.perk.readyAt=Infinity;}
 if(reverse)r.heroes=new Map([[b.pid,b],[a.pid,a],[d.pid,d],[c.pid,c]]);
 const initial=[a,b,c,d].map(h=>[h.x,h.y]),target=[[700,0],[699.9,0],[0,0],[-700,0]];
 r.time=r.finPlan.pre-99*dt-dt/2;
 for(let i=1;i<=99;i++){
  for(let j=0;j<4;j++)r.handle([a,b,c,d][j].pid,{t:'pos',x:initial[j][0]+(target[j][0]-initial[j][0])*i/99,y:initial[j][1]+(target[j][1]-initial[j][1])*i/99,fx:j===3?-1:1,fy:0});
  r.step(dt);
 }
 // The native finale starts on the next step and catches the outer players after its padding shrinks.
 for(let i=0;i<7;i++)r.step(dt);
 const shrink=FINALE.ring.shrink*dt,nextBound=()=>r.fin.cx+r.fin.r-shrink-PLAYER_RADIUS;
 r.handle(b.pid,{t:'pos',x:nextBound()-.1,y:0,fx:1,fy:0});
 const spitter=r.spawnEnemy('spitter',[a,b,c,d],1);Object.assign(spitter,{x:nextBound()-40-shrink-ENEMIES.spitter.shotSpeed*dt,y:0,windT:dt/2});
 r.step(dt);const shot=r.hostile.find(s=>s.from==='spitter:shot');if(!shot)throw new Error('Native Spitter did not leave its newborn shot alive');
 for(let i=0;i<2;i++){
  r.handle(b.pid,{t:'pos',x:nextBound()-.1,y:0,fx:1,fy:0});
  if(inward&&i===1)r.handle(a.pid,{t:'pos',x:nextBound()-inward,y:0,fx:1,fy:0});
  r.step(dt);
 }
 if(a.hp!==100||b.hp!==100||!r.hostile.includes(shot))throw new Error('Preparation scene already contacted a hero '+JSON.stringify({time:r.time,hp:[a.hp,b.hp],taken:[r.runLog.p.get(a.pid).taken,r.runLog.p.get(b.pid).taken],shot,positions:[a.x,b.x],ring:r.fin,spitter:{x:spitter.x,y:spitter.y}}));
 if(still)r.fin.r1=r.fin.r;
 if(shortLife)shot.life=.002;
 const before={time:r.time,ring:r.fin.r,positions:[a,b].map(h=>({x:h.x,y:h.y,previous:{...h.hostilePos}})),shot:{...shot}};
 if(press)r.handle(a.pid,{t:'dash',x:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});
 r.step(dt);
 return {before,time:r.time,ring:r.fin.r,positions:[a,b].map(h=>({x:h.x,y:h.y})),hp:[a.hp,b.hp],taken:[a,b].map(h=>r.runLog.p.get(h.pid).taken['spitter:shot']??0),damage:shot.dmg,impact:r.fx.findLast(f=>f[0]==='epend'&&f[1]===shot.id),path:a.dashPath,shotRemaining:r.hostile.includes(shot),nativeWindup:true,ordinaryWarmupTicks:99,spitter:{x:spitter.x,y:spitter.y}};
}
