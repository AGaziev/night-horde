import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {Room} from './game.js';
import {runStore} from './runlog.js';
import {EVOS,HOSTILE_R,PLAYER_RADIUS} from '../public/shared/content.js';
const dt=1/30,results=[];
export function giftScene({mode='night',entry=107.990,own=0,duplicate=false}={}) {
 const random=Math.random;let state=831,draws=0;Math.random=()=>{draws++;state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
 try {
  const r=new Room('GIFT-TOI',()=>{});r.setMode(mode);r.addPlayer(1,'Bastion','ranger');r.addPlayer(2,'Recipient','ranger');r.start();r.time=100;r.enemies=[];r.events.next=Infinity;
  const [a,b]=r.heroes.values();for(const h of [a,b]){h.y=0;h.hp=h.maxHp=100;h.weapons.clear();h.perk.readyAt=Infinity;}a.x=100;b.x=0;
  a.weapons.set('ward',{lvl:5,t:0});a.passives.set(EVOS.bastion.requires,1);a.offer=[r.evoCard(a,'bastion')];r.sendOffer(a);r.handle(a.pid,{t:'pick',i:0,offerEpoch:a.offerEpoch});assert.ok(a.weapons.has('bastion'));r.updateWeapon(a,'bastion',a.weapons.get('bastion'),dt);
  if(own){b.weapons.set('ward',{lvl:3,t:0});r.updateWeapon(b,'ward',b.weapons.get('ward'),dt);while(b.ward>own)r.hurtPlayer(b,1);}
  const donorOwn=a.ward;r.hurtPlayer(a,20,'gift-source');assert.equal(a.ward,donorOwn-1);assert.equal(b.sharedWard?.owner,a);assert.equal(b.sharedWard.until,108);const blocked=a.support.blocked,recipientBlocked=b.support.blocked;
  r.time=108.018-dt;a.iframes=b.iframes=0;const before=r.snapshot();assert.deepEqual(before.wardGift,[[b.pid,108]]);
  const radius=HOSTILE_R+PLAYER_RADIUS;const shot=(id,at,dmg=10)=>({id,x:b.x-radius-512*(at-r.time),y:0,vx:512,vy:0,life:1,dmg,from:'gift-boundary'});r.hostile=[shot(800,entry)];if(duplicate)r.hostile.unshift(shot(801,entry+.002,20));
  r.tick(dt);const frameFX=r.fx.map(f=>[...f]),snapshot=r.snapshot(),ownAfter=b.ward,delta=a.support.blocked-blocked,token=b.sharedWard,hp=b.hp,afterDonorOwn=a.ward;
  const wardEvents=frameFX.filter(f=>f[0]==='ward'&&f[1]===b.pid).length;r.finish(false);const stored=runStore.get(r.lastLog.id),donor=stored.team.find(h=>h.pid===a.pid),recipient=stored.team.find(h=>h.pid===b.pid);
  return {mode,entry,own,duplicate,hp,delta,token:token?{until:token.until}:null,ownAfter,donorOwn:donorOwn-1,afterDonorOwn,wardEvents,snapshot:{gift:snapshot.wardGift,recipient:snapshot.p.find(p=>p[0]===b.pid),donorSupport:snapshot.support.find(p=>p[0]===a.pid)},stored:{donor:donor.support,recipient:recipient.support},blocked,recipientBlocked,draws,shotEnds:frameFX.filter(f=>f[0]==='epend')};
 }finally{Math.random=random;}
}
for(const mode of ['night','lunch'])for(const own of [0,1])for(const [label,entry]of [['early',107.990],['expiry',108],['late',108.005]])test(`CEO6880837720 gift actual entry ${mode} ${label} own${own}`,()=>{
 const result=giftScene({mode,entry,own});results.push(result);const valid=label==='early';
 assert.equal(result.hp,valid||own?100:90);assert.equal(result.delta,valid?10:0,'actual donor receives only an unexpired gift block');assert.equal(result.ownAfter,own-(valid||!own?0:1),'temporary gift never spends an own charge');assert.equal(result.token,null);assert.equal(result.afterDonorOwn,result.donorOwn,'gift cannot gift back');
 assert.deepEqual(result.snapshot.gift,[]);assert.equal(result.snapshot.recipient[13],result.ownAfter);assert.equal(result.snapshot.donorSupport[3],result.blocked+result.delta);assert.equal(result.stored.donor.blocked,result.blocked+result.delta);assert.equal(result.stored.recipient.blocked-result.recipientBlocked,own&&!valid?10:0);
});
for(const mode of ['night','lunch'])test('CEO6880837720 gift sorted duplicate contacts spend once '+mode,()=>{
 const result=giftScene({mode,duplicate:true});results.push(result);assert.equal(result.hp,100);assert.equal(result.delta,10);assert.equal(result.wardEvents,1);assert.equal(result.token,null);assert.equal(result.stored.donor.blocked,result.blocked+10);
});
process.on('exit',()=>{if(process.env.SUPPORT_CONTACT_OUTPUT)fs.writeFileSync(process.env.SUPPORT_CONTACT_OUTPUT,JSON.stringify({runtime:process.version,results},null,2));});
