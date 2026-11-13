import assert from 'node:assert/strict';
import {Room} from './game.js';
import {DUOS} from '../public/shared/content.js';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8')
 .replace("'/shared/content.js'", JSON.stringify(new URL('../public/shared/content.js', import.meta.url).href));
const {Game} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
for(const [id,d] of Object.entries(DUOS)) {
 const r=new Room('SIG',()=>{});r.addPlayer(1,'A','knight');r.start(); const h=r.heroes.get(1);
 h.weapons=new Map([[id,{lvl:1,t:0}]]); const calls=[];
 r.castWeapon=(h,k)=>calls.push(k);r.wardBash=()=>calls.push('ward');
 r.updateWeapon(h,id,h.weapons.get(id),1/30);
 assert.deepEqual(calls,[id],`${id}: only signature may dispatch`);
 assert.deepEqual(h.weapons.get(id).parts.map(p=>p.id),d.parts);
 assert.equal(h.weapons.size,1);
}
console.log('signature dispatch: all duos, one slot, no component casts');
{
 const r=new Room('LIVE',()=>{});r.addPlayer(1,'A','knight');r.start();const h=r.heroes.get(1);
 h.weapons=new Map([['bolt',{lvl:3,t:0}],['lightning',{lvl:3,t:0}],['knives',{lvl:3,t:0}]]);
 r.addProjectile(h,'bolt',0,400,10,1,2,null);
 r.addProjectile(h,'knife',0,400,10,1,2,null);
 r.puddles=[{owner:h,src:{weapon:'bolt'}},{owner:h,src:{weapon:'knives'}}];
 assert.equal(r.fuseDuo(h,{id:'orb',parts:['bolt','lightning'],level:1}),true);
 assert.equal(r.projectiles.length,1,'consumed missile ends, independent knife remains');
 assert.equal(r.projectiles[0].src.weapon,'knives');assert.equal(r.puddles[0].src.weapon,'knives');
 assert.equal(h.weapons.size,2,'one slot freed beside the independent weapon');
 assert.equal(r.fuseDuo(h,{id:'orb',parts:['bolt','lightning'],level:1}),false,'cannot fuse twice');
}
{
 const r=new Room('CANCEL',()=>{});r.addPlayer(1,'P','knight');r.start();r.time=100;
 const h=r.heroes.get(1);h.x=h.y=0;
 h.weapons=new Map([['bomb',{lvl:3,t:0}],['frost',{lvl:3,t:0}],['knives',{lvl:3,t:0}]]);
 const enemy=r.spawnEnemy('brute',[h],1);Object.assign(enemy,{x:100,y:0,hp:100000,maxHp:100000});r.rebuildGrid();
 for(const [id,w] of h.weapons)r.updateWeapon(h,id,w,1/30);
 const g=new Game({send(){}});g.me=1;g.begin(r.startMsg());
 const before=[...r.fx];for(const ev of before)g.shotEvent(ev);
 for(const ev of before)if(ev[0]==='coldwave')g.effect(ev);
 assert.ok(g.lobs.size>0);assert.ok(g.coldWaves.length>0);assert.ok(g.shots.size>0);
 const knives=g.shots.size,offset=r.fx.length;
 assert.equal(r.fuseDuo(h,{id:'icebomb',parts:['bomb','frost'],level:1}),true);
 for(const ev of r.fx.slice(offset))g.shotEvent(ev);
 assert.equal(g.lobs.size,0,'consumed bombs are cancelled before landing');
 assert.equal(g.coldWaves.length,0,'consumed waves stop immediately');
 assert.equal(g.shots.size,knives,'independent knife visuals remain');
 for(const ev of before)if(ev[0]==='coldwave')g.effect(ev);
 assert.equal(g.coldWaves.length,0,'a delayed render event cannot recreate a cancelled wave');
}
