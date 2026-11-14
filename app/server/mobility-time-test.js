import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
const dt=1/30;
function setup(hero='witch',dash=true){
 const r=new Room('TOI',()=>{});r.addPlayer(1,'P',hero);r.start();const h=r.heroes.get(1);
 Object.assign(h,{x:0,y:0,hp:100,maxHp:100,iframes:0,ward:0});h.weapons.clear();h.perk.readyAt=Infinity;r.spawn=()=>{};r.breakAround=()=>{};
 if(dash)r.handle(1,{t:'dash',x:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});return{r,h};
}
function shot(r,x,dmg,extra={}){const s={id:r.nextId++,x,y:0,vx:0,vy:0,r:7,life:5,dmg,from:'test:shot',...extra};r.hostile.push(s);return s;}
function body(r,h,x,dmg=11){const e=r.spawnEnemy('ram',[h],1);Object.assign(e,{x,y:0,speed:0,dmg,bs:'rest',bt:10});return e;}
for(const reversed of [false,true])test(`CEO55-4 shot chronology independent of array order ${reversed}`,()=>{
 const{r,h}=setup();shot(r,25,7);shot(r,55,19);if(reversed)r.hostile.reverse();r.step(dt);
 assert.equal(h.hp,93);assert.equal(r.hostile.length,0);assert.ok(Math.abs(h.iframes-(.4-dt+(25-21)/1200))<1e-8);
});
for(const earlyBody of [false,true])test(`CEO55-4 unified body/shot ordering, body first ${earlyBody}`,()=>{
 const{r,h}=setup();body(r,h,earlyBody?55:70);shot(r,earlyBody?55:25,7);r.step(dt);assert.equal(h.hp,earlyBody?89:93);
});
test('CEO55-4 partial revive protection covers early contact despite expiring at tick end',()=>{
 const{r,h}=setup();h.iframes=dt;shot(r,12,9,{y:20.99});r.step(dt);assert.equal(h.hp,100);assert.equal(h.iframes,0);assert.equal(r.hostile.length,0);
});
test('CEO55-4 expired protection allows later contact and grants only remaining new duration',()=>{
 const{r,h}=setup();h.iframes=.005;shot(r,40,9);r.step(dt);assert.equal(h.hp,91);assert.ok(h.iframes<.4&&h.iframes>.38);
});
for(const kind of ['shield','ward','armor'])test(`CEO55-4 accepted chronology preserves ${kind}`,()=>{
 const{r,h}=setup(kind==='shield'?'knight':'witch');if(kind==='shield')h.perk.readyAt=0;if(kind==='ward')h.ward=1;if(kind==='armor'){h.mods.armor=2;h.guard=3;}
 shot(r,25,10);shot(r,55,99);r.step(dt);assert.equal(h.hp,kind==='armor'?95:100);assert.equal(r.hostile.length,0);
 if(kind==='shield')assert.ok(h.perk.readyAt>r.time);if(kind==='ward')assert.equal(h.ward,0);if(kind==='armor')assert.equal(h.guard,0);
});
for(const near of [false,true])test(`CEO55-3 newborn spitter tests only birth position, near ${near}`,()=>{
 const{r,h}=setup();const e=r.spawnEnemy('spitter',[h],1);Object.assign(e,{x:near?40:0,y:20,speed:0,dmg:0,windT:dt/2});r.step(dt);assert.equal(h.x,40);assert.equal(h.hp<100,near);
 if(!near){assert.equal(r.hostile.length,1);assert.ok(r.hostile[0].x>0,'legacy global flight still advances; the dasher only tests birth geometry');assert.equal(r.hostile[0].bornAt,r.time);}
});
test('partial last dash tick separates travel and stationary remainder',()=>{
 const{r,h}=setup();h.dash.left=dt/2;shot(r,20,9,{y:30,vy:-1200});r.step(dt);assert.equal(h.x,20);assert.equal(h.dash,null);assert.equal(h.hp,91);
});
test('positive partial shot life can hit before expiry; cannot collide after expiry',()=>{
 for(const hit of [true,false]){const{r,h}=setup();shot(r,hit?20:35,9,{life:hit?dt/2:dt/4,y:hit?30:0,vy:hit?-1200:0});r.step(dt);assert.equal(h.hp,hit?91:100);assert.equal(r.hostile.length,0);}
});
test('zero lifetime shot cannot deal damage at birth or on swept path',()=>{
 const{r,h}=setup();shot(r,20,99,{life:0});shot(r,40,99,{life:0,bornAt:dt});r.step(dt);assert.equal(h.hp,100);assert.equal(r.hostile.length,0);
});
test('ordinary frame retains endpoint-only hostile semantics',()=>{
 const{r,h}=setup('witch',false);shot(r,-50,9,{vx:3000});r.step(dt);assert.equal(h.hp,100);assert.equal(r.hostile.length,1);
});
test('early AI hazard retains legacy priority and fresh protection',()=>{
 const{r,h}=setup();r.moveEnemies=()=>r.hurtPlayer(h,5,'test:AI');shot(r,25,99);r.step(dt);assert.equal(h.hp,95);assert.equal(h.iframes,.4);
});
test('new run resets contact phase marker even at same tick number',()=>{
 const{r,h}=setup();shot(r,25,9);r.step(dt);r.start();const next=r.heroes.get(1);next.perk.readyAt=Infinity;next.weapons.clear();r.handle(1,{t:'dash',x:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});const hp=next.hp;shot(r,25,9);r.step(dt);assert.equal(next.hp,hp-9);
});
test('CEO55-4 actual revive then44 native ticks preserves protection at the early dash contact',()=>{
 const r=new Room('REVIVE',()=>{});r.addPlayer(1,'Revived','witch');r.addPlayer(2,'Helper','witch');r.start();r.spawn=()=>{};r.breakAround=()=>{};
 const h=r.heroes.get(1),helper=r.heroes.get(2);
 for(const hero of r.heroes.values()){hero.weapons.clear();hero.perk.readyAt=Infinity;hero.x=hero.y=0;}
 Object.assign(h,{st:1,hp:0,rev:100});r.updateRevive(dt);assert.equal(h.st,0);assert.equal(h.iframes,1.5);const hp=h.hp;helper.x=1000;
 for(let i=0;i<44;i++)r.step(dt);assert.ok(Math.abs(h.iframes-dt)<1e-8);
 r.handle(1,{t:'dash',x:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});shot(r,12,8,{y:20.99});r.step(dt);
 assert.equal(h.hp,hp,'contact near10ms stays inside remaining33.33ms revive protection');assert.ok(h.iframes<1e-8);assert.equal(r.hostile.length,0);
});
test('a ward burst removing a queued exploder prevents a later phantom fuse event',()=>{
 const{r,h}=setup();h.ward=1;const e=r.spawnEnemy('bloater',[h],1);Object.assign(e,{x:50,y:0,speed:0,hp:.01,fuseT:0});shot(r,25,10);r.step(dt);
 assert.equal(h.hp,100);assert.equal(e.dead,true);assert.equal(e.fuseT,0);
});
