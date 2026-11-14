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
   h.x=post.x;h.y=post.y;
   while(post.spawned<post.total||r.enemies.some(e=>e.outpost===post&&!e.dead&&e!==last)) {
    r.updateOutposts(hs);
    const guards=r.enemies.filter(e=>e.outpost===post&&!e.dead&&e!==last);
    for(const e of guards) {
     if(post===r.outposts.posts.at(-1)&&post.spawned===post.total&&e===guards.at(-1))last=e;
     else r.killEnemy(e,h);
    }
    r.compactEnemies();
   }
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
  assert.equal(welcome.v,28,'server and current browser announce the current offer-action protocol');
  const current=Object.create(Net.prototype);current.emit=()=>emitted++;current.dispatch(welcome);
  assert.equal(reloads,1,'matching current browser is not reloaded');assert.equal(emitted,1);
 } finally {
  if(previousStorage)Object.defineProperty(globalThis,'sessionStorage',previousStorage);else delete globalThis.sessionStorage;
  if(previousLocation)Object.defineProperty(globalThis,'location',previousLocation);else delete globalThis.location;
 }
 console.log('Offer protocol: actual welcome reloads PROTO23 browser and resumes current browser: OK');
}

// Real chronological Room -> actual main handlers -> Game -> UI.showOffer path.
// Only DOM nodes and unused canvas imports are adapted; offer decisions/rendering remain production code.
{
 const gameUrl='data:text/javascript;base64,'+Buffer.from(source).toString('base64');
 const uiSource=fs.readFileSync(new URL('../public/js/ui.js',import.meta.url),'utf8')
  .replace("'/shared/content.js'",JSON.stringify(new URL('../public/shared/content.js',import.meta.url).href))
  .replace("import { drawHeroPreview } from './render.js';",'')
  .replace("import { sprites } from './sprites.js';",'')
  .replace("import { renderResults } from './results.js';",'')
  .replace("'./game.js'",JSON.stringify(gameUrl));
 const {UI}=await import('data:text/javascript;base64,'+Buffer.from(uiSource).toString('base64'));
 class Node {
  constructor(){this.children=[];this.style={};this.hidden=true;this.classList={toggle(){},add(){},remove(){},contains(){return false;}};}
  set textContent(v){this.text=v;this.children=[];} get textContent(){return this.text??'';}
  appendChild(child){this.children.push(child);return child;}
  addEventListener(){} querySelectorAll(){return [];}
 }
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
 const previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:node,createElement:()=>new Node(),querySelectorAll:()=>[]}});
 const previousRandom=Math.random;Math.random=()=>0;
 try {
  const messages=[],r=new Room('CLOSED',(pid,msg)=>messages.push({pid,msg:structuredClone(msg)}));
  r.addPlayer(1,'One','knight');r.addPlayer(2,'Two','witch');r.start();
  const h=r.heroes.get(1);h.passives.set('might',1);r.recalcMods(h);
  const outbox=[],g=new Game({send:msg=>outbox.push(msg)});g.me=1;g.begin(r.startMsg());
  g.passives={might:1};g.pvals={might:passiveValue('might',1)};
  const ui=Object.create(UI.prototype);ui.levelup=node('levelup');ui.offerKey='';ui.revealTimers=[];
  const handlers=new Map(),net={on:(name,handler)=>handlers.set(name,handler)};
  const main=fs.readFileSync(new URL('../public/js/main.js',import.meta.url),'utf8');
  for(const name of ['lvl','ps']) {
   const handler=main.match(new RegExp("net.on\\('"+name+"', \\(msg\\) => \\{[\\s\\S]*?\\n\\}\\);"))?.[0];
   assert.ok(handler,`actual ${name} handler found`);
   new Function('net','game','ui','sound',handler)(net,g,ui,{legendary(){}});
  }
  const deliver=msg=>handlers.get(msg.t)?.(msg);
  r.grantOffer(h);deliver(messages.findLast(x=>x.pid===1&&x.msg.t==='lvl').msg);
  const i=h.offer.findIndex(c=>c.kind==='passive'&&c.id==='might');assert.ok(i>=0);
  assert.ok(g.pick(i));ui.hideOffer();const first=outbox.at(-1);
  r.resync(1);const delayed=messages.findLast(x=>x.pid===1&&x.msg.t==='lvl').msg;
  assert.equal(delayed.offerEpoch,first.offerEpoch,'unchanged resync reuses the queued pick epoch');
  r.handle(1,first);assert.equal(h.offer,null,'first real pick consumes the last offer');
  deliver(delayed);assert.equal(ui.levelup.hidden,false,'late real resync packet makes the old card visible again');
  assert.ok(g.pick(i));ui.hideOffer();const offset=messages.length;
  const before={rerolls:h.rerolls,bans:h.bans,xp:h.xp,passives:[...h.passives],pval:{...h.pval}};
  r.handle(1,outbox.at(-1));
  const replies=messages.slice(offset).filter(x=>x.pid===1).map(x=>x.msg);
  assert.ok(replies.some(m=>m.t==='ps'),'cancelled offer still corrects optimistic passives');
  assert.ok(replies.some(m=>m.t==='lvl'&&m.closed===true&&m.choices===null),'server explicitly closes an already-consumed offer');
  for(const msg of replies)deliver(msg);
  assert.equal(g.offer,null,'closed authoritative offer clears client state');
  assert.equal(ui.levelup.hidden,true,'closed authoritative offer cannot open an empty level-up panel');
  assert.deepEqual(g.pvals,h.pval,'optimistic duplicate passive increment is corrected');
  assert.deepEqual({rerolls:h.rerolls,bans:h.bans,xp:h.xp,passives:[...h.passives],pval:{...h.pval}},before,'rejection has no reward or charge effects');
  assert.equal(g.skip(),false);assert.equal(g.reroll(),false);
  for(const choices of [null,[],undefined]) {
   ui.levelup.hidden=false;assert.equal(ui.showOffer({choices}),false,'UI defensively handles absent choices');
   assert.equal(ui.levelup.hidden,true);
  }
  assert.equal(ui.showOffer(null),false);
  r.grantOffer(h);const next=h.offer;const newOffset=messages.length;
  r.handle(1,first); // Old epoch with a genuinely active new offer must reopen that choice.
  for(const {pid,msg} of messages.slice(newOffset))if(pid===1)deliver(msg);
  assert.equal(h.offer,next);assert.ok(g.offer?.choices.length>0);
  assert.equal(ui.levelup.hidden,false,'stale action with an active replacement still displays its current cards');
  assert.ok(node('levelup-cards').children.length>0);
 } finally {
  Math.random=previousRandom;
  if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);else delete globalThis.document;
 }
 console.log('Closed offer: delayed real resync/click, actual handlers/UI, passive correction and no empty panel: OK');
}
