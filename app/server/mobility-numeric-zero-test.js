import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {Room} from './game.js';
import {stepMobility,hasActualDash} from './mobility.js';
import {clipDash} from '../public/shared/mobility.js';
import {Input} from '../public/js/input.js';
const source=fs.readFileSync(new URL('../public/js/game.js',import.meta.url),'utf8')
 .replaceAll("'/shared/", "'"+new URL('../public/shared/',import.meta.url).href);
const {Game}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const dt=1/30;
function stick(x,y){const i=Object.create(Input.prototype);i.held={};i.joy={active:true,dx:x/50,dy:y/50};i.out={x:0,y:0};return i;}
for(const[sx,sy]of[[26,15],[35,20]])test(`actual Input/Game direction at a rounded radial boundary is stationary, stick${sx}/${sy}`,()=>{
 const sent=[],r=new Room('NUMERIC-ZERO',()=>{});r.addPlayer(1,'P','witch');r.start();r.spawn=()=>{};r.breakAround=()=>{};r.events.next=Infinity;r.peaks=[];
 const h=r.heroes.get(1);h.weapons.clear();h.perk.readyAt=Infinity;
 const input=stick(sx,sy),v=input.vector(),len=Math.hypot(v.x,v.y),dx=v.x/len,dy=v.y/len;
 // Ordinary 30Hz position preparation, using the same tenth-unit wire rounding as Game.update.
 for(let n=1;n<=99;n++){r.handle(1,{t:'pos',x:Math.round(dx*700*n/99*10)/10,y:Math.round(dy*700*n/99*10)/10,fx:dx,fy:dy});r.step(dt);}
 // Controlled ring boundary, not a claim to reproduce the owner's complete natural damage scene.
 r.startFinale([h]);Object.assign(r.fin,{cx:0,cy:0,r:449});
 r.handle(1,{t:'pos',x:Math.round(dx*700*10)/10,y:Math.round(dy*700*10)/10,fx:dx,fy:dy});
 if(sx===35)assert.equal(Math.hypot(h.x,h.y),435,'boundary without a fresh clipDash projection');
 else assert.ok(Math.hypot(h.x,h.y)>=435,'the other input exercises a fresh clipDash projection');
 const g=new Game({send:m=>{sent.push(m);r.handle(1,m)}});g.me=1;g.begin(r.startMsg());assert.equal(g.requestDash(input),true);
 assert.equal(sent[0].t,'dash');assert.equal(sent[0].x,dx);assert.equal(sent[0].y,dy);assert.ok(h.dash);
 stepMobility(r,dt);assert.equal(hasActualDash(h),false,JSON.stringify(h.dashPath));
 assert.equal(h.dashPath.moveX,0);assert.equal(h.dashPath.moveY,0);assert.equal(h.dashPath.duration,0);
});
for(const gap of[1e-10,1e-6,2])test(`real interior partial movement is preserved, gap${gap}`,()=>{
 const start=435-gap,p=clipDash(start,0,1,0,dt,{cx:0,cy:0,r:435});
 assert.ok(p.duration>0&&p.x>p.startX,'do not threshold real short displacement');
 assert.ok(Math.abs(p.x-435)<=Number.EPSILON*435);assert.ok(p.duration<dt);
});
for(const gap of[Number.EPSILON*256,1e-12])test(`coordinate roundoff at the ring is stationary, gap${gap}`,()=>{
 const p=clipDash(435-gap,0,1,0,dt,{cx:0,cy:0,r:435});
 assert.equal(p.duration,0);assert.equal(p.x,p.startX);
});
test('world-boundary roundoff is stationary but a subpixel partial dash is preserved',()=>{
 const zero=clipDash(100000-1e-10,0,1,0,dt);assert.equal(zero.duration,0);assert.equal(zero.x,zero.startX);
 const p=clipDash(100000-1e-6,0,1,0,dt);assert.ok(p.duration>0&&p.x>p.startX);assert.equal(p.x,100000);
});
test('an inward ray from the radial boundary keeps its full movement',()=>{
 const p=clipDash(435,0,-1,0,dt,{cx:0,cy:0,r:435});assert.equal(p.duration,dt);assert.equal(p.x,395);
});
test('fresh projection of an oblique outside start cannot create outward movement',()=>{
 const d=Math.hypot(35,20),p=clipDash(35/d*436,20/d*436,35/d,20/d,dt,{cx:0,cy:0,r:435});
 assert.equal(p.duration,0);assert.equal(p.x,p.startX);assert.equal(p.y,p.startY);
});

// CEO55: translated ring + rounded 30-degree input. The owner's radius was not
// supplied; radius500 reproduces the same residual and early-body-hit cause.
for(const hp of[10,100])test(`rounded 30-degree blocked dash preserves ordinary body damage, HP${hp}`,()=>{
 function scene(press){
  const r=new Room('ROUND-OFF-BODY',()=>{});r.addPlayer(1,'P','witch');r.addPlayer(2,'Ally','witch');r.start();
  r.time=100;r.spawn=()=>{};r.breakAround=()=>{};r.events.next=Infinity;r.peaks=[];r.bossIdx=r.bossAt.length;r.nextEliteT=r.nextInvasionT=Infinity;
  const h=r.heroes.get(1),input=stick(50*Math.cos(Math.PI/6),25),v=input.vector();
  for(const p of r.heroes.values()){p.weapons.clear();p.perk.readyAt=Infinity;p.ward=0;p.iframes=0;}
  const initial={x:h.x,y:h.y};
  for(let n=1;n<49;n++){
   r.handle(1,{t:'pos',seq:n,x:Math.round((initial.x+(493.4-initial.x)*n/49)*10)/10,y:Math.round((initial.y+(256-initial.y)*n/49)*10)/10,fx:v.x,fy:v.y});r.step(dt);
  }
  r.time=815.3;r.startFinale([...r.heroes.values()]);Object.assign(r.fin,{cx:40,cy:-10,r:500,r1:465});
  r.handle(1,{t:'pos',seq:49,x:493.4,y:256,fx:v.x,fy:v.y});assert.equal(h.posAck,49);
  h.hp=hp;h.maxHp=100;
  const distance=Math.hypot(h.x-40,h.y+10),dx=(h.x-40)/distance,dy=(h.y+10)/distance;
  const e=r.spawnEnemy('ghoul',[...r.heroes.values()],1);e.x=h.x+dx*27;e.y=h.y+dy*27;
  if(press){const g=new Game({send:m=>r.handle(1,m)});g.me=1;g.begin(r.startMsg());assert.equal(g.requestDash(input),true);}
  r.step(dt);return{hp:h.hp,st:h.st,taken:r.runLog.p.get(1).taken,path:h.dashPath,distance:Math.hypot(h.x-e.x,h.y-e.y)};
 }
 const ordinary=scene(false),blocked=scene(true);
 assert.equal(ordinary.hp,hp);assert.ok(ordinary.distance>28,'native shrink leaves body outside contact');
 assert.equal(blocked.hp,ordinary.hp,JSON.stringify(blocked));assert.equal(blocked.st,0);
 assert.equal(blocked.path.duration,0);assert.equal(blocked.path.moveX,0);assert.equal(blocked.path.moveY,0);
});

for(const distance of[24,40])test(`real ${distance}-unit dash retains its early body contact`,()=>{
 const r=new Room('REAL-SHORT-DASH',()=>{});r.addPlayer(1,'P','witch');r.start();r.time=100;
 r.spawn=()=>{};r.breakAround=()=>{};r.events.next=Infinity;r.peaks=[];
 const h=r.heroes.get(1);Object.assign(h,{x:435-distance,y:0,hp:100,maxHp:100,iframes:0,ward:0});h.weapons.clear();h.perk.readyAt=Infinity;
 r.fin={cx:0,cy:0,r:449,r1:449,nextAdd:Infinity};
 const e=r.spawnEnemy('ghoul',[h],1);Object.assign(e,{x:h.x+1,y:27,speed:0});
 const calls=[],hurt=r.hurtPlayer;r.hurtPlayer=function(...args){calls.push(args[3]);return hurt.apply(this,args);};
 r.handle(1,{t:'dash',x:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});r.step(dt);
 assert.equal(h.dashPath.moveX,distance);assert.equal(hasActualDash(h),true);
 assert.ok(Math.hypot(h.x-e.x,h.y-e.y)>28,'endpoint alone is clear');
 assert.ok(h.hp<100,'real travel still admits the early body hit');
 assert.equal(calls.length,1);assert.ok(calls[0]<r.time,'actual early contact clock is retained');
});
