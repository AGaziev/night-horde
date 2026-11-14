import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room } from './game.js';
// The former a25 late/Map expectations are superseded by merged main45. See pm/DASH-MAIN45-INTEGRATION.md.
const dt = 1 / 30;
function setup({ dash = true, shots = 1, ax = 0, bx = 17.50166666666667, reverse = false, competing = false } = {}) {
 const r = new Room('BOUNDARY', () => {});
 for (let pid = 1; pid <= 3; pid++) r.addPlayer(pid, 'P' + pid, 'witch');
 r.start(); r.time = 1; r.spawn = () => {}; r.breakAround = () => {}; r.events.next = Infinity;
 const [a,b,c] = [1,2,3].map(pid => r.heroes.get(pid));
 for (const h of [a,b,c]) { Object.assign(h, {x:0,y:0,hp:100,maxHp:100,iframes:0,ward:0}); h.weapons.clear(); h.perk.readyAt = Infinity; }
 a.x = ax; b.x = bx; c.x = competing ? 50 : 1000;
 if (reverse) r.heroes = new Map([[2,b],[1,a],[3,c]]);
 const source = r.spawnEnemy('spitter', [a,b,c], 1); Object.assign(source, {x:-10,y:0});
 for (let i=0;i<shots;i++) r.fireHostile(source, {x:50,y:0});
 const damage = r.hostile[0].dmg, shotLife = r.hostile[0].life; r.enemies = [];
 if (dash) r.handle(3, {t:'dash',x:competing?-1:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});
 return {r,a,b,c,damage,shotLife};
}
function downFromBody(r,a) { const e=r.spawnEnemy('ghoul',[a],1); Object.assign(e,{x:-27,y:0,speed:0,hp:10000,maxHp:10000}); a.hp=1; }
for (const dash of [false,true]) test(`new P2 shot1 downs A, fresh legacy shot2 hits B; far dash=${dash}`,()=>{
 const {r,a,b,damage}=setup({dash,shots:2}); a.hp=1; r.step(dt);
 assert.equal(a.st,1); assert.equal(b.hp,100-damage); assert.equal(r.hostile.length,0);
});
for (const dash of [false,true]) test(`main45 projectile intercepts A before its endpoint body; far dash=${dash}`,()=>{
 const {r,a,b,damage}=setup({dash}); downFromBody(r,a); r.step(dt);
 assert.equal(a.st,1); assert.equal(b.hp,100); assert.equal(r.hostile.length,0);
});
for (const reverse of [false,true]) for(const dash of [false,true]) test(`main45 earliest ordinary TOI is independent of Map, reverse=${reverse}, far dash=${dash}`,()=>{
 const {r,a,b,damage}=setup({dash,ax:18,bx:0,reverse}); r.step(dt);
 assert.equal(a.hp,100); assert.equal(b.hp,100-damage);
});
for (const dash of [false,true]) test(`main45 early interception consumes before endpoint body; far dash=${dash}`,()=>{
 const {r,a,b,shotLife}=setup({dash,bx:500}); downFromBody(r,a); r.step(dt);
 assert.equal(a.st,1); assert.equal(b.hp,100); assert.equal(r.hostile.length,0);
});
for(const cause of ['shot','body']) test(`main45 real competition commits before later ${cause}`,()=>{
 const {r,a,b,c,damage}=setup({competing:true,shots:cause==='shot'?2:1}); if(cause==='shot')a.hp=1;else downFromBody(r,a);r.step(dt);
 assert.equal(a.st,1);assert.equal(b.hp,100);assert.equal(c.hp,cause==='shot'?100-damage:100);assert.equal(r.hostile.length,0);
});
test('main45 later endpoint body cannot reopen an already intercepted shot',()=>{
 const {r,a,b,c,damage}=setup({competing:true,bx:500});downFromBody(r,a);r.step(dt);
 assert.equal(a.st,1);assert.equal(b.hp,100);assert.equal(c.hp,100);assert.equal(r.hostile.length,0);
});
for(const dash of [false,true])test(`main45 ordinary projectile commits before weapons, far dash=${dash}`,()=>{
 const {r,a,b,damage}=setup({dash});let observed=false;b.weapons.set('bolt',{lvl:1});r.updateWeapon=()=>{observed=true;assert.equal(r.hostile.length,0);assert.equal(a.hp,100-damage);};r.step(dt);assert.ok(observed);
});
for(const dash of[false,true])test(`revive after hostile phase cannot intercept early but is eligible next tick, far dash=${dash}`,()=>{
 const {r,a,b}=setup({dash,bx:50});Object.assign(a,{st:1,hp:0,rev:99.99});r.step(dt);assert.equal(a.st,0);const revivedHp=a.hp;assert.ok(a.iframes>1);assert.equal(r.hostile.length,1);r.step(dt);assert.equal(a.hp,revivedHp);assert.equal(r.hostile.length,0);assert.equal(b.hp,100);
});
test('a real competing lower-pid dasher wins an exact entry tie over the ordinary channel',()=>{
 const {r,a,b,c,damage}=setup({dash:false,ax:10,bx:0});c.x=1000;r.handle(1,{t:'dash',x:-1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});r.step(dt);assert.equal(a.hp,100-damage);assert.equal(b.hp,100);
});
test('legacy fallback cannot hit a dasher from a newborn future endpoint without a real dash contact',()=>{
 const {r,a,b,c}=setup({dash:false});r.hostile=[];r.heroes=new Map([[1,a]]);r.members=new Map([[1,r.members.get(1)]]);a.x=0;a.y=0;
 const e=r.spawnEnemy('spitter',[a],1);Object.assign(e,{x:15,y:0,speed:0,dmg:0,windT:dt/2});r.handle(1,{t:'dash',x:1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});r.step(dt);assert.equal(a.x,40);assert.equal(a.hp,100);assert.equal(r.hostile.length,1);assert.equal(r.hostile[0].x,15,'main45 does not advance a shot before its birth');assert.ok(Math.abs(r.hostile[0].x-a.x)>21);
});

for (const protection of ['iframes', 'ward', 'shield']) test(`fresh fallback preserves ${protection} interception and consumes once`, () => {
 const {r,a,b,c}=setup({shots:2});
 a.hp=1;
 if(protection==='iframes') b.iframes=1;
 if(protection==='ward') b.ward=1;
 if(protection==='shield') { b.hero='knight'; b.perk.readyAt=0; }
 const ids=r.hostile.map(s=>s.id);
 r.step(dt);
 assert.equal(a.st,1); assert.equal(b.hp,100); assert.equal(c.hp,100);
 assert.equal(r.hostile.length,0);
 for(const id of ids) assert.equal(r.fx.filter(f=>f[0]==='epend'&&f[1]===id).length,1);
 if(protection==='ward') assert.equal(b.ward,0);
 if(protection==='shield') assert.ok(b.perk.readyAt>r.time);
});
