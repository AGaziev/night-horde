import assert from 'node:assert/strict';
import { Room } from './game.js';
import { MAX_ENEMIES, enemyHpScale, ENEMIES, xpForNext } from '../public/shared/content.js';
import { SnapshotDecoder } from '../public/js/snapshot-codec.js';
function setup(n = 1, mode = 'night') {
 const sent=[]; const r = new Room('POSTS', (pid,m,json)=>sent.push({pid,m,json}));
 if (mode !== 'night') r.setMode(mode);
 for(let i=1;i<=n;i++) r.addPlayer(i,'P'+i,'knight');
 r.start(); r.enemies.length=0;
 return {r,hs:[...r.heroes.values()],sent};
}
function spawnNetwork(r,hs) { r.time=r.runLength*2/3; r.updateOutposts(hs.filter(h=>h.st===0)); return r.outposts; }
function finishPost(r,hs,p) {
 hs[0].x=p.x;hs[0].y=p.y;
 for(let i=0;i<4 && p.killed<20;i++) {
  r.updateOutposts(hs.filter(h=>h.st===0));
  for(const e of r.enemies.filter(e=>e.outpost===p&&!e.dead)) r.killEnemy(e,hs[0]);
  r.compactEnemies();
 }
 assert.equal(p.killed,20);
}
for(const n of [1,2,4,8]) for(const mode of ['night','lunch']) {
 const {r,hs}=setup(n,mode);
 hs[n-1].st=1;hs[n-1].offline=true;hs[n-1].x=700;
 r.time=r.runLength*2/3-.01;r.updateOutposts(hs);assert.equal(r.outposts,null);
 const network=spawnNetwork(r,hs);assert.equal(network.target,n+1);assert.equal(network.posts.length,n+1);
 for(const p of network.posts) {
  assert.ok(hs.every(h=>Math.hypot(h.x-p.x,h.y-p.y)>=1800),'distant from every hero including downed');
  assert.ok(network.posts.every(q=>q===p||Math.hypot(p.x-q.x,p.y-q.y)>=900),'post spacing');
 }
 assert.equal(r.enemies.length,0,'no guards until approach');
}
{
 const {r,hs}=setup(2);const net=spawnNetwork(r,hs),p=net.posts[0];
 hs[0].x=p.x;hs[0].y=p.y;r.updateOutposts(hs);
 assert.equal(p.spawned,20);assert.equal(p.killed,0);
 const guard=r.enemies.find(e=>e.outpost===p);assert.ok(guard);
 assert.ok(Math.abs(guard.maxHp-ENEMIES.skel.hp*enemyHpScale(r.nt,hs.length)*r.modeHp*1.4)<1e-8);
 assert.ok(r.enemies.every(e=>Math.hypot(e.x-hs[0].x,e.y-hs[0].y)>=200),'safe pending spawn');
 const hp=guard.hp;hs[0].x=p.x+4000;r.time+=1;r.moveEnemies(.5,hs);
 assert.ok(Math.hypot(guard.x-p.x,guard.y-p.y)<=520+1e-6,'no horde teleport');assert.equal(guard.hp,hp,'return never heals');
 guard.x=p.x+510;guard.y=p.y;r.knock(guard,p.x,p.y,3000);
 assert.ok(Math.hypot(guard.x-p.x,guard.y-p.y)<=520+1e-6,'hard leash on knock');
 assert.equal(r.makeElite([hs[0]]),null,'guards excluded from random elite candidates');
 for(const e of r.enemies) e.dead=true;r.compactEnemies();assert.equal(p.killed,0,'service removal does not clear');
}
{
 const {r,hs}=setup(8);spawnNetwork(r,hs);
 // Isolate scheduling fairness from world placement; nine simultaneously active camps.
 r.outposts.posts.forEach((p,i)=>{p.x=(i%3)*300;p.y=Math.floor(i/3)*300;});hs.forEach(h=>{h.x=300;h.y=300;});
 r.updateOutposts(hs);assert.equal(r.enemies.filter(e=>!e.dead&&e.outpost).length,72);
 assert.ok(r.outposts.posts.every(p=>p.spawned===8),'first eight per active camp before filling any camp');
}
{
 const {r,hs}=setup(2);spawnNetwork(r,hs);const p=r.outposts.posts[0];hs[0].x=p.x;hs[0].y=p.y;
 r.bossIdx=r.bossAt.length;
 while(r.enemies.length<MAX_ENEMIES) r.spawnEnemy('bat',hs,1);
 r.updateOutposts(hs);assert.equal(p.spawned,0);r.enemies[0].dead=true;r.compactEnemies();
 r.spawn(1,hs);assert.equal(r.enemies.length,MAX_ENEMIES);assert.equal(p.spawned,1,'pending guards take freed capacity before horde');
}
{
 const {r,hs,sent}=setup(2);spawnNetwork(r,hs);const [first,...rest]=r.outposts.posts;
 hs[1].st=1;hs[1].hp=0;hs[1].offline=true;
 finishPost(r,hs,first);assert.equal(first.chest,1);assert.ok(hs.every(h=>!h.victoryBanner),'partial clear has no trophy');
 hs[0].hp=hs[0].maxHp/2;const xp=hs[0].xp,need=xpForNext(hs[0].level,hs.length);
 r.openOutpostChest(first);assert.equal(hs[0].xp,xp+need*.2);assert.equal(hs[0].hp,hs[0].maxHp*.7);assert.equal(hs[1].hp,0);
 const after=hs[0].xp;r.openOutpostChest(first);assert.equal(hs[0].xp,after,'single chest grant');
 for(const p of rest) finishPost(r,hs,p);
 assert.equal(r.outposts.status,'won');assert.ok(hs.every(h=>h.victoryBanner),'all heroes get trophy including offline/downed');
 for(const h of hs) { const dmg=h.mods.dmgMul,area=h.mods.areaMul;r.recalcMods(h);assert.equal(h.mods.dmgMul,dmg);assert.equal(h.mods.areaMul,area); }
 assert.equal(hs[0].mods.dmgMul,1.25);assert.equal(hs[0].mods.areaMul,1.15);
 const resultCount=sent.filter(({m})=>m.t==='reforge').length; r.guardKilled(r.enemies.find(e=>e.outpost));assert.equal(sent.filter(({m})=>m.t==='reforge').length,resultCount);
 const snapshot=r.snapshot();const decoder=new SnapshotDecoder();const wire=sent.findLast(x=>x.m===snapshot).json;
 assert.deepEqual(decoder.decode(JSON.parse(wire)).op,snapshot.op);assert.deepEqual(snapshot.trophy,[1,2]);
 r.resync(2);assert.ok(sent.findLast(({pid,m})=>pid===2&&m.t==='reforge'));
 r.start();assert.equal(r.outposts,null);assert.ok([...r.heroes.values()].every(h=>!h.victoryBanner));
}
{
 const {r,hs}=setup();spawnNetwork(r,hs);r.startFinale(hs);assert.equal(r.outposts.status,'closed');
 r.finaleLord(hs,2);assert.ok(!hs[0].victoryBanner);assert.equal(r.outposts.posts.reduce((n,p)=>n+p.killed,0),0);
}

// Corners and split/downed parties must retain the minimum distance after world validation.
for(const [x,y] of [[99990,99990],[-99990,99990],[99990,-99990],[-99990,-99990]]) {
 const {r,hs}=setup(8);hs.forEach((h,i)=>{h.x=x-i*100;h.y=y;h.st=i%2;});
 spawnNetwork(r,hs);
 for(const p of r.outposts.posts) {
  assert.ok(Math.abs(p.x)<=99480&&Math.abs(p.y)<=99480,'room for full guard radius inside the world');
  assert.ok(hs.every(h=>Math.hypot(h.x-p.x,h.y-p.y)>=1800));
 }
}
{
 const {r,hs}=setup();hs[0].x=99990;hs[0].y=99990;
 const random=Math.random;Math.random=()=>0;
 try {spawnNetwork(r,hs);}finally{Math.random=random;}
 assert.equal(r.outposts.posts.length,0,'failed bounded search does not fall back underfoot');
 assert.equal(r.outposts.target,2);
 hs[0].x=hs[0].y=0;r.time+=3;r.updateOutposts(hs);
 assert.equal(r.outposts.posts.length,2,'later bounded retry completes the fixed target');
}
{
 const {r,hs}=setup();spawnNetwork(r,hs);const p=r.outposts.posts[0];
 hs[0].x=p.x;hs[0].y=p.y;r.updateOutposts(hs);r.time+=1;
 const shield=r.enemies.find(e=>e.outpost===p&&e.ai==='shield');
 shield.x=p.x+519;shield.y=p.y;shield.bs='dash';shield.bt=1;shield.bvx=1;shield.bvy=0;
 hs[0].x=p.x+600;r.moveEnemies(.5,hs);
 assert.ok(Math.hypot(shield.x-p.x,shield.y-p.y)<=520+1e-6,'shield early-continue dash obeys leash');
 const normal=r.enemies.find(e=>e.outpost===p&&e.ai===null);
 normal.x=p.x+519;normal.y=p.y;normal.elite='blink';normal.auxT=0;
 r.eliteTick(normal,hs[0],1);assert.ok(Math.hypot(normal.x-p.x,normal.y-p.y)<=520+1e-6,'forced blink obeys leash');
 normal.frozenT=r.time+10;normal.x=p.x+900;r.moveEnemies(.1,hs);
 assert.ok(Math.hypot(normal.x-p.x,normal.y-p.y)<=520+1e-6,'frozen early continue still confines');
 const sniper=r.enemies.find(e=>e.outpost===p&&e.ai==='sniper');
 sniper.x=p.x+510;sniper.y=p.y;sniper.windT=.01;sniper.bvx=1;sniper.bvy=0;
 r.sniperTick(sniper,hs[0],100,.1);
 assert.ok(r.hostile.length>0);
 for(const shot of r.hostile) {
  assert.equal(shot.from,'outpost:shot');assert.ok(shot.life<=2.4);
  assert.ok(Math.hypot(shot.x+shot.vx*shot.life-p.x,shot.y+shot.vy*shot.life-p.y)<=650+1e-6,'wire trajectory is bounded too');
 }
 hs[0].x=p.x+1500;const hp=hs[0].hp;r.updateHostile(3);assert.equal(r.hostile.length,0);assert.equal(hs[0].hp,hp);
 // A telegraphed guard cannot inflict contact damage while a player crosses its spawn point.
 normal.elite=null;normal.frozenT=0;normal.guardReadyAt=r.time+1;normal.x=hs[0].x;normal.y=hs[0].y;
 r.rebuildGrid();hs[0].weapons.clear();r.updatePlayers(.1,hs);assert.equal(hs[0].hp,hp);
}
{
 const {r,hs,sent}=setup();const decoder=new SnapshotDecoder();
 const decode=()=>{const snap=r.snapshot();const packet=JSON.parse(sent.findLast(x=>x.m===snap).json);const got=decoder.decode(packet);assert.deepEqual(got.op,snap.op);assert.deepEqual(got.trophy,snap.trophy);return packet;};
 decode();spawnNetwork(r,hs);decode();r.closeOutposts();decode();
 r.resync(1);const packet=decode();assert.equal(packet.K,1,'reconnect forces key with closed objective');
 const fresh=new SnapshotDecoder();assert.equal(fresh.decode(packet).op.status,'closed');
}
console.log('Outposts: timing, placement, finite guards, safe/fair cap, leash, chests, trophy, finale/reset and wire: OK');
