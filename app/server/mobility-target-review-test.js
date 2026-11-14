import assert from'node:assert/strict';import{test}from'node:test';import{Room}from'./game.js';
const dt=1/30;
function setup({moving=true,targetX=0,dasherX=50,hero='witch',protect=0,ward=0}={}){
 const r=new Room('TARGET',()=>{});r.addPlayer(1,'Ordinary',hero);r.addPlayer(2,'Dasher','witch');r.start();r.time=1;r.spawn=()=>{};r.breakAround=()=>{};r.events.next=Infinity;
 const h=r.heroes.get(1),d=r.heroes.get(2);for(const p of[h,d]){Object.assign(p,{y:0,hp:100,maxHp:100,iframes:0,ward:0});p.weapons.clear();p.perk.readyAt=Infinity;}h.x=targetX;h.iframes=protect;h.ward=ward;d.x=dasherX;
 const e=r.spawnEnemy('spitter',[h,d],1);Object.assign(e,{x:-10,y:0});r.fireHostile(e,{x:50,y:0});const damage=r.hostile[0].dmg;r.enemies=[];
 if(moving)r.handle(2,{t:'dash',x:-1,y:0,run:r.runLog.id,request:1,expiresAt:Date.now()+1500});return{r,h,d,damage};
}
for(const moving of[false,true])test(`r16 real fireHostile preserves earlier ordinary start/end overlap, dash${moving}`,()=>{
 const{r,h,d,damage}=setup({moving});r.step(dt);assert.equal(h.hp,100-damage);assert.equal(d.hp,100);assert.equal(r.hostile.length,0);
});
test('r16 ordinary endpoint eligibility does not always take priority over an earlier dasher',()=>{
 const{r,h,d,damage}=setup({targetX:18,dasherX:20});r.step(dt);assert.equal(h.hp,100);assert.equal(d.hp,100-damage);
});
for(const reverse of[false,true])test(`r16 simultaneous entry has deterministic hero tie, reversedMap${reverse}`,()=>{
 const{r,h,d,damage}=setup({dasherX:10});if(reverse)r.heroes=new Map([[2,d],[1,h]]);r.step(dt);assert.equal(h.hp,100-damage);assert.equal(d.hp,100);
});
for(const protect of[.01,1])test(`r16 ordinary protection is still evaluated at legacy endpoint phase ${protect}`,()=>{
 const{r,h,d,damage}=setup({protect});r.step(dt);assert.equal(h.hp,protect>dt?100:100-damage);assert.equal(d.hp,100);assert.equal(r.hostile.length,0);
});
for(const type of['ward','shield'])test(`r16 selected ordinary ${type} absorbs once and protects the later dasher`,()=>{
 const{r,h,d}=setup({hero:type==='shield'?'knight':'witch',ward:type==='ward'?1:0});if(type==='shield')h.perk.readyAt=0;r.step(dt);assert.equal(h.hp,100);assert.equal(d.hp,100);assert.equal(r.hostile.length,0);if(type==='ward')assert.equal(h.ward,0);else assert.ok(h.perk.readyAt>r.time);
});
test('r16 ordinary Ward callbacks remain after weapon/body phase rather than geometric selection time',()=>{
 const{r,h,d}=setup({ward:1});let observed=false;r.updateWeapon=()=>{};d.weapons.set('bolt',{lvl:1});r.updateWeapon=owner=>{if(owner===d){observed=true;assert.equal(h.ward,1,'selection reserves the shot but cannot trigger the ordinary callback early');}};r.step(dt);assert.ok(observed);assert.equal(h.ward,0);
});
