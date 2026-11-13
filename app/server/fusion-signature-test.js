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
