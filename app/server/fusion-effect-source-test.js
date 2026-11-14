import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from './game.js';
import {DUOS} from '../public/shared/content.js';
const dt=1/30;
function arena(id){const r=new Room('CEO31',()=>{});r.addPlayer(1,'One','knight');r.addPlayer(2,'Ally','ranger');r.start();r.time=100;r.enemies=[];const h=r.heroes.get(1);h.x=h.y=0;h.perk.readyAt=Infinity;h.weapons=new Map(DUOS[id].parts.map(p=>[p,{lvl:3,t:0}]));return {r,h};}
function fuse(r,h,id){const [a,b]=DUOS[id].parts;h.offer=[r.duoCard(h,{id,a,b})];r.sendOffer(h);r.handle(h.pid,{t:'pick',i:0,offerEpoch:h.offerEpoch});assert.ok(h.weapons.has(id),'actual pick fuses');}
function foe(r,h,x){const e=r.spawnEnemy('ghoul',[h],1);Object.assign(e,{x,y:0,hp:1e6,maxHp:1e6,speed:0,dmg:0});r.rebuildGrid();return e;}
test('CEO31.2 consumed wet pool cannot conduct but existing wet duration survives',()=>{
 const {r,h}=arena('censer');const a=foe(r,h,50),b=foe(r,h,65);r.updateWeapon(h,'flask',h.weapons.get('flask'),dt);let z=r.puddles[0];assert.ok(z);a.x=z.x;b.x=z.x+10;a.y=b.y=z.y;r.rebuildGrid();r.updatePuddles(dt);z=a.wetZ;assert.ok(r.puddles.includes(z));const wetUntil=a.wetT;
 fuse(r,h,'censer');assert.equal(a.wetT,wetUntil);const before=b.hp;r.hurtEnemy(a,10,r.heroes.get(2),{weapon:'lightning',tags:['shock']});
 assert.equal(b.hp,before,'removed invisible field causes no secondary conduction');assert.equal(a.wetZ,null,'cancel clears only the live-field reference');
 r.hurtEnemy(a,1,r.heroes.get(2),{weapon:'frost',tags:['cold']});assert.ok(a.frozenT>r.time,'existing wet expiry still permits the ordinary cold reaction');
});
test('CEO31.4 spectral resonance stays under the signature damage source',()=>{
 const {r,h}=arena('spectral');fuse(r,h,'spectral');foe(r,h,80);foe(r,h,95);
 const w=h.weapons.get('spectral');r.updateWeapon(h,'spectral',w,dt);w.castT=0;r.updateWeapon(h,'spectral',w,dt);
 assert.ok(h.dmgBy.spectral>0);assert.equal(h.dmgBy.tuning??0,0,'a consumed Tuning Fork never gains a detached damage row');
});
