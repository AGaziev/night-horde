import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {Room} from './game.js';
import {runStore} from './runlog.js';
import {EVOS,HOSTILE_R,PLAYER_RADIUS} from '../public/shared/content.js';
const dt=1/30,results=[];
function equip(r,h,id){h.weapons.set('ward',{lvl:5,t:0});h.passives.set(EVOS.bastion.requires,1);h.offer=[r.evoCard(h,id)];r.sendOffer(h);r.handle(h.pid,{t:'pick',i:0,offerEpoch:h.offerEpoch});assert.ok(h.weapons.has(id));r.updateWeapon(h,id,h.weapons.get(id),dt);}
function arena(mode){const r=new Room('GIFT-CHAIN',()=>{});r.setMode(mode);for(let i=1;i<=3;i++)r.addPlayer(i,'P'+i,'ranger');r.start();r.time=100;r.enemies=[];r.spawn=()=>{};r.events.next=Infinity;const[a,b,c]=r.heroes.values();for(const h of[a,b,c]){h.hp=h.maxHp=100;h.weapons.clear();h.perk.readyAt=Infinity;h.x=0;h.y=0;}a.x=b.x=60;a.y=b.y=80;equip(r,a,'bastion');equip(r,b,'bastion');return{r,a,b,c};}
function shot(r,id,h,at,dmg){return{id,x:h.x-HOSTILE_R-PLAYER_RADIUS-600*(at-r.time),y:h.y,vx:600,vy:0,life:1,dmg,from:'gift-chain'};}
const token=g=>g?{owner:g.owner.pid,grantedAt:g.grantedAt??null,until:g.until}:null;
export function chainScene({mode='night',same=false,outside=false,donorAt=107.988,receiverAt=107.995,reverse=false,duplicate=false}={}){
 const{r,a,b,c}=arena(mode);r.hurtPlayer(a,25,'first-native-block');assert.equal(c.sharedWard?.owner,a);assert.equal(c.sharedWard.until,108);const before=[a.support.blocked,b.support.blocked,c.support.blocked];
 if(same)b.x=1000;else a.x=-1000;if(outside)b.x=1000;const donor=same?a:b;
 r.time=108.018-dt;for(const h of[a,b,c])h.iframes=0;const events=[shot(r,800,donor,donorAt,same?10:8),shot(r,801,c,receiverAt,same?10:8)];if(duplicate)events.push(shot(r,802,c,receiverAt+.001,same?10:8));r.hostile=reverse?events.reverse():events;
 const ownBefore=[a.ward,b.ward];r.tick(dt);const state={time:r.time,hp:c.hp,delta:[a,b,c].map((h,i)=>h.support.blocked-before[i]),gift:token(c.sharedWard),own:[a.ward,b.ward],ownBefore,cooldowns:[a,b].map(h=>h.weapons.get('bastion').t)};const snapshot=r.snapshot();r.finish(false);const saved=runStore.get(r.lastLog.id);
 return{mode,same,outside,donorAt,receiverAt,reverse,duplicate,before,...state,snapshot:{gift:snapshot.wardGift,support:snapshot.support,ownRows:snapshot.p.map(p=>[p[0],p[13]])},stored:saved.team.map(h=>({pid:h.pid,support:h.support})),storedCopies:runStore.runs.filter(x=>x.log.id===saved.id).length};
}
const cases=[
 ['same-early',{same:true,donorAt:107.990,receiverAt:108.010},90,[10,0],null],
 ['same-exact-renew',{same:true,donorAt:108,receiverAt:108.010},100,[20,0],null],
 ['same-late-renew',{same:true,donorAt:108.005,receiverAt:108.010},100,[20,0],null],
 ['same-after-receiver',{same:true,donorAt:108.012,receiverAt:108.010},90,[10,0],1],
 ['two-inside',{donorAt:107.988,receiverAt:107.995},100,[8,8],null],
 ['two-outside',{outside:true,donorAt:107.988,receiverAt:107.995},100,[8,8],null],
 ['two-exact-renew',{donorAt:108,receiverAt:108.010},100,[0,16],null],
 ['two-late-renew',{donorAt:108.005,receiverAt:108.010},100,[0,16],null],
 ['two-after-receiver',{donorAt:108.012,receiverAt:108.010},92,[0,8],2],
 ['receiver-exact-expiry',{donorAt:107.988,receiverAt:108},92,[0,8],null],
 ['duplicate-consumed-once',{donorAt:107.988,receiverAt:107.995,duplicate:true},100,[8,8],null],
 ['new-gift-after-spent',{donorAt:107.998,receiverAt:107.995},100,[8,8],2],
];
for(const mode of['night','lunch'])for(const reverse of[false,true])for(const[name,options,hp,delta,owner]of cases)test(`CEO6881354360 ${mode} reverse${reverse} ${name}`,()=>{
 const result=chainScene({mode,reverse,...options});results.push({name,result});assert.equal(result.hp,hp);assert.deepEqual(result.delta.slice(0,2),delta,'actual donor ownership and one-charge attribution');assert.equal(result.delta[2],0);assert.equal(result.own[options.same?0:1],result.ownBefore[options.same?0:1]-1);assert.equal(result.time,108.018,'independent room/effect clock is not rewound');assert.equal(result.gift?.owner??null,owner);if(owner){assert.ok(Math.abs(result.gift.until-(options.donorAt+8))<1e-9);assert.equal(result.gift.grantedAt,options.donorAt);}
 for(let i=0;i<3;i++){assert.equal(result.stored[i].support.blocked,result.before[i]+result.delta[i]);const row=result.snapshot.support.find(x=>x[0]===i+1);if(row)assert.equal(row[3],result.before[i]+result.delta[i]);}assert.equal(result.storedCopies,1);
});
export function prebirthScene(mode,own=0){
 const{r,a,b,c}=arena(mode);b.x=1000;if(own){c.weapons.set('ward',{lvl:3,t:0});r.updateWeapon(c,'ward',c.weapons.get('ward'),dt);while(c.ward>1)r.hurtPlayer(c,1);}
 r.time=108.018-dt;for(const h of[a,b,c])h.iframes=0;assert.equal(c.sharedWard,undefined);const before=a.support.blocked;r.events.cur={id:'star',phase:0,end:r.time-.01,x:a.x,y:a.y,r:1,log:{}};r.hostile=[shot(r,850,c,108.008,8)];r.tick(dt);const early={hp:c.hp,taken:r.runLog.p.get(c.pid).taken['gift-chain']??0,own:c.ward,gift:token(c.sharedWard),blocked:a.support.blocked-before,time:r.time};
 for(let i=0;i<14;i++)r.tick(dt);assert.equal(c.iframes,0);const credit=a.support.blocked;r.hostile=[shot(r,851,c,r.time+.005,8)];r.tick(dt);return{mode,own,early,later:{hp:c.hp,own:c.ward,gift:token(c.sharedWard),blocked:a.support.blocked-credit}};
}
for(const mode of['night','lunch'])for(const own of[0,1])test(`CEO6881354360 native early-AI gift cannot protect a prebirth receiver ${mode} own${own}`,()=>{
 const result=prebirthScene(mode,own);results.push({name:'native-prebirth',result});assert.equal(result.early.hp,100,'native Star shard heals20 later in the same tick');assert.equal(result.early.taken,own?0:8,'the run log exposes damage hidden by the later heal');assert.equal(result.early.own,0);assert.ok(result.early.gift,'a later grant remains available after the earlier receiver event');assert.equal(result.early.gift.owner,1);assert.equal(result.early.gift.grantedAt,result.early.time);assert.equal(result.early.gift.until,result.early.time+8);assert.equal(result.later.hp,result.early.hp);assert.equal(result.later.blocked,8);assert.equal(result.later.gift,null);
});
export function pendingScene(mode,receive){
 const{r,a,b,c}=arena(mode);b.x=-60;b.y=-80;r.time=108.018-dt;for(const h of[a,b,c])h.iframes=0;
 const donorAt=r.time+.005,receiverAt=r.time+.008;r.events.cur={id:'star',phase:0,end:r.time-.01,x:a.x,y:a.y,r:1,log:{}};r.hostile=[shot(r,860,b,donorAt,8)];if(receive)r.hostile.push(shot(r,861,c,receiverAt,8));r.tick(dt);
 const early={hp:c.hp,credits:[a.support.blocked,b.support.blocked],gift:token(c.sharedWard),pending:c.pendingWardGifts?.length??0};const before=[a.support.blocked,b.support.blocked];for(let i=0;i<14;i++)r.tick(dt);r.hostile=[shot(r,862,c,r.time+.005,8)];r.tick(dt);
 return{mode,receive,donorAt,receiverAt,early,later:{hp:c.hp,credits:[a.support.blocked-before[0],b.support.blocked-before[1]],gift:token(c.sharedWard)}};
}
for(const mode of['night','lunch'])for(const receive of[false,true])test(`CEO6881354360 future AI grant yields to earlier donor until its own birth ${mode} receive${receive}`,()=>{
 const result=pendingScene(mode,receive);results.push({name:'native-pending',result});assert.equal(result.early.hp,100);assert.equal(result.early.credits[1],receive?16:8);assert.equal(result.early.gift.owner,receive?1:2);assert.equal(result.early.pending,0);assert.ok(Math.abs(result.early.gift.grantedAt-(receive?108.018:result.donorAt))<1e-9);assert.equal(result.later.hp,100);assert.deepEqual(result.later.credits,receive?[8,0]:[0,8]);assert.equal(result.later.gift,null);
});
export function pendingExistingScene(mode,receive){
 const{r,a,b,c}=arena(mode);b.x=-60;b.y=-80;r.hurtPlayer(a,25,'first-native-block');assert.equal(c.sharedWard.owner,a);assert.equal(c.sharedWard.until,108);
 r.time=108.018-dt;for(const h of[a,b,c])h.iframes=0;r.events.cur={id:'star',phase:0,end:r.time-.01,x:a.x,y:a.y,r:1,log:{}};
 r.hostile=[shot(r,870,b,107.990,8)];if(receive)r.hostile.push(shot(r,871,c,107.995,8));r.tick(dt);
 return{mode,receive,hp:c.hp,taken:r.runLog.p.get(c.pid).taken['gift-chain']??0,credits:[a.support.blocked,b.support.blocked],gift:token(c.sharedWard),pending:c.pendingWardGifts?.length??0};
}
for(const mode of['night','lunch'])test(`CEO6881354360 future AI eligibility preserves an earlier live token ${mode}`,()=>{
 const noReceiver=pendingExistingScene(mode,false),receiver=pendingExistingScene(mode,true);results.push({name:'native-pending-existing',noReceiver,receiver});
 assert.equal(receiver.taken,0);assert.equal(receiver.hp,100);assert.equal(receiver.credits[0]-noReceiver.credits[0],8);assert.equal(receiver.credits[1],8);assert.equal(noReceiver.credits[1],8);
 for(const state of[noReceiver,receiver]){assert.equal(state.gift.owner,1);assert.equal(state.gift.grantedAt,108.018);assert.equal(state.pending,0);}
});
process.on('exit',()=>{if(process.env.GIFT_CHAIN_OUTPUT)fs.writeFileSync(process.env.GIFT_CHAIN_OUTPUT,JSON.stringify({runtime:process.version,results},null,2));});
