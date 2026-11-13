import assert from 'node:assert/strict';
import {Room} from './game.js';
import {DUOS} from '../public/shared/content.js';
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
