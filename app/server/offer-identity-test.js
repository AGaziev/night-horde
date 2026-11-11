import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Room } from './game.js';
import { passiveValue } from '../public/shared/content.js';

const source=fs.readFileSync(new URL('../public/js/game.js',import.meta.url),'utf8')
 .replace("'/shared/content.js'",JSON.stringify(new URL('../public/shared/content.js',import.meta.url).href));
const {Game}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const random=Math.random;
Math.random=()=>0;
try {
 function encounter(defer=3) {
  const sent=[];
  const r=new Room('EPOCH',(pid,msg)=>sent.push({pid,msg:structuredClone(msg)}));
  r.addPlayer(1,'One','knight');r.addPlayer(2,'Two','witch');r.start();
  const hs=[...r.heroes.values()],h=hs[0];r.time=600;r.updateOutposts(hs);
  let last;
  for(const post of r.outposts.posts) {
   h.x=post.x;h.y=post.y;r.updateOutposts(hs);
   const guards=r.enemies.filter(e=>e.outpost===post&&!e.dead);
   for(const e of guards) {
    if(post===r.outposts.posts.at(-1)&&e===guards.at(-1))last=e;
    else r.killEnemy(e,h);
   }
   r.compactEnemies();
  }
  assert.equal(r.outposts.status,'active');assert.ok(last&&!last.dead);
  h.weapons=new Map([['whip',{lvl:5,t:0}]]);h.passives=new Map([['might',4]]);h.pval={};r.recalcMods(h);
  h.duoDefer.crescent=defer;
  r.grantOffer(h);r.handle(h.pid,{t:'skip'});r.grantOffer(h);
  assert.equal(h.offer[0].id,'might');assert.equal(h.offer[0].level,5);
  const oldOffer=sent.findLast(x=>x.pid===1&&x.msg.t==='lvl').msg;
  const outbox=[],g=new Game({send:msg=>outbox.push(msg)});g.me=1;
  g.begin(r.startMsg());g.passives={might:4};g.pvals={might:passiveValue('might',4)};g.offer=oldOffer;
  return {r,h,last,sent,oldOffer,g,outbox};
 }
 for(const action of ['pick','ban','skip','reroll']) {
  const {r,h,last,sent,oldOffer,g,outbox}=encounter(action==='pick'?3:100);
  if(action==='pick'||action==='ban')assert.ok(g[action](0));else assert.ok(g[action]());
  const stale=outbox.at(-1);
  assert.ok(Number.isSafeInteger(stale.offerEpoch),`${action}: real browser sends the displayed epoch`);
  r.killEnemy(last,h); // Real last guard death replaces the still-open array before the queued click arrives.
  const replacement=h.offer;
  const epoch=h.offerEpoch;r.resync(1);assert.equal(h.offerEpoch,epoch,'reconnect keeps the current offer identity');
  assert.notEqual(replacement,oldOffer.choices);
  assert.notEqual(replacement[0].id,'might');
  if(action==='pick')assert.equal(replacement[0].id,'crescent');
  const before={rerolls:h.rerolls,bans:h.bans,xp:h.xp,queue:h.queue,banned:[...h.banned],pval:h.pval.might};
  const offset=sent.length;
  r.handle(1,{...stale,offerEpoch:undefined});
  assert.equal(h.offer,replacement,'tokenless delayed actions are rejected after an automatic replacement too');
  r.handle(1,stale);
  assert.ok(h.weapons.has('whip')&&!h.weapons.has('crescent'),`${action}: stale action must not silently accept the new card`);
  assert.equal(h.offer,replacement,`${action}: replacement remains open for an intentional action`);
  assert.deepEqual({rerolls:h.rerolls,bans:h.bans,xp:h.xp,queue:h.queue,banned:[...h.banned],pval:h.pval.might},before,`${action}: rejection precedes every effect and charge`);
  const replies=sent.slice(offset).filter(x=>x.pid===1).map(x=>x.msg);
  const ps=replies.find(m=>m.t==='ps'),lvl=replies.find(m=>m.t==='lvl');
  assert.ok(ps&&lvl,`${action}: reject sends inventory and current offer`);
  g.passives=ps.levels;g.pvals=ps.values;g.offer=lvl;
  assert.equal(g.pvals.might,h.pval.might,'authoritative correction replaces the optimistic passive increment');
  assert.notEqual(lvl.offerEpoch,oldOffer.offerEpoch);
  if(action==='pick') {
   g.pick(0);r.handle(1,outbox.at(-1));
   assert.ok(h.weapons.has('crescent')&&!h.weapons.has('whip'),'fresh intentional choice is accepted');
  }
 }
 // A generic forge card can become empty without mentioning the item upgraded by the team reward.
 {
  const sent=[];const r=new Room('EMPTY',(pid,msg)=>sent.push(structuredClone(msg)));
  r.addPlayer(1,'One','knight');r.start();const h=r.heroes.get(1);
  h.weapons=new Map([['whip',{lvl:4,t:0}]]);h.passives.clear();
  r.grantOffer(h);const i=h.offer.findIndex(c=>c.kind==='rare'&&c.id==='forge');assert.ok(i>=0);
  const old=sent.findLast(m=>m.t==='lvl');
  r.legendaryReforge(h,'outposts');
  assert.ok(!h.offer.some(c=>c.id==='forge'),'empty generic forge card is refreshed before it can waste a pick');
  const current=h.offer;r.handle(1,{t:'pick',i,offerEpoch:old.offerEpoch});
  assert.equal(h.offer,current,'old forge click cannot consume another replacement reward');
 }
 console.log('Offer identity: real queued pick/ban/skip/reroll, authoritative correction, fresh acceptance and empty forge: OK');
} finally {Math.random=random;}

// A pre-epoch browser must reload on the actual server welcome instead of getting stuck rejecting every action.
{
 const netFile=new URL('../public/js/net.js',import.meta.url);
 const codecUrl=new URL('../public/js/snapshot-codec.js',import.meta.url).href;
 const netSource=fs.readFileSync(netFile,'utf8').replace("'./snapshot-codec.js'",JSON.stringify(codecUrl));
 const oldSource="const PROTO = 23;\n"+netSource.replace('import { PROTO, SnapshotDecoder }','import { SnapshotDecoder }');
 const {Net:OldNet}=await import('data:text/javascript;base64,'+Buffer.from(oldSource).toString('base64'));
 const {Net}=await import('data:text/javascript;base64,'+Buffer.from(netSource).toString('base64'));
 const {Hub}=await import('./game.js');
 let welcome;const hub=new Hub((pid,msg)=>{if(msg.t==='welcome')welcome=msg;});hub.addPlayer(1,'One');hub.welcome(1);
 const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
 const previousLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 let reloads=0,emitted=0;const storage=new Map();
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
 Object.defineProperty(globalThis,'location',{configurable:true,value:{reload(){reloads++;}}});
 try {
  const old=Object.create(OldNet.prototype);old.emit=()=>emitted++;old.dispatch(welcome);
  assert.equal(reloads,1,'PROTO23 page reloads for epoch-capable server instead of entering a permanent offer rejection loop');
  assert.equal(emitted,0,'outdated welcome is not used to resume the old UI');
  assert.equal(welcome.v,24,'server and current browser announce the new offer-action protocol');
  const current=Object.create(Net.prototype);current.emit=()=>emitted++;current.dispatch(welcome);
  assert.equal(reloads,1,'matching current browser is not reloaded');assert.equal(emitted,1);
 } finally {
  if(previousStorage)Object.defineProperty(globalThis,'sessionStorage',previousStorage);else delete globalThis.sessionStorage;
  if(previousLocation)Object.defineProperty(globalThis,'location',previousLocation);else delete globalThis.location;
 }
 console.log('Offer protocol: actual welcome reloads PROTO23 browser and resumes current browser: OK');
}
