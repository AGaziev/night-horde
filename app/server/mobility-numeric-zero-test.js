import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {Room} from './game.js';
import {stepMobility,hasActualDash} from './mobility.js';
import {clipDash} from '../public/shared/mobility.js';
import {Input} from '../public/js/input.js';
const source=fs.readFileSync(new URL('../public/js/game.js',import.meta.url),'utf8')
 .replace("'/shared/content.js'",JSON.stringify(new URL('../public/shared/content.js',import.meta.url).href));
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
for(const gap of[Number.EPSILON*256,1e-12,1e-10,2])test(`real interior partial movement is preserved, gap${gap}`,()=>{
 const start=435-gap,p=clipDash(start,0,1,0,dt,{cx:0,cy:0,r:435});
 assert.ok(p.duration>0&&p.x>p.startX,'do not threshold real short displacement');
 assert.ok(Math.abs(p.x-435)<=Number.EPSILON*435);assert.ok(p.duration<dt);
});
test('a tiny representable world-boundary movement is preserved',()=>{
 const p=clipDash(100000-1e-10,0,1,0,dt);assert.ok(p.duration>0&&p.x>p.startX);assert.equal(p.x,100000);
});
test('an inward ray from the radial boundary keeps its full movement',()=>{
 const p=clipDash(435,0,-1,0,dt,{cx:0,cy:0,r:435});assert.equal(p.duration,dt);assert.equal(p.x,395);
});
test('fresh projection of an oblique outside start cannot create outward movement',()=>{
 const d=Math.hypot(35,20),p=clipDash(35/d*436,20/d*436,35/d,20/d,dt,{cx:0,cy:0,r:435});
 assert.equal(p.duration,0);assert.equal(p.x,p.startX);assert.equal(p.y,p.startY);
});
