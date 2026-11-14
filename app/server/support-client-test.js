import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Room} from './game.js';
import {DUOS,EVOS} from '../public/shared/content.js';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'support-client-'));
let Game,Renderer,Net,wardCharges;
try {
 fs.writeFileSync(path.join(tmp,'package.json'),'{"type":"module"}');
 const dir=new URL('../public/js/',import.meta.url);
 for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.js')))fs.writeFileSync(path.join(tmp,name),fs.readFileSync(new URL(name,dir),'utf8').replaceAll("'/shared/content.js'",JSON.stringify(new URL('../public/shared/content.js',import.meta.url).href)));
 ({Game,wardCharges}=await import(pathToFileURL(path.join(tmp,'game.js'))));({Renderer}=await import(pathToFileURL(path.join(tmp,'render.js'))));({Net}=await import(pathToFileURL(path.join(tmp,'net.js'))));
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
function pick(r,h,card){h.offer=[card];r.sendOffer(h);r.handle(h.pid,{t:'pick',i:0,offerEpoch:h.offerEpoch});}
function scene(own,gift){const wire=[];const r=new Room('VIS-WARD',(pid,_m,json)=>{if(pid===1&&json)wire.push(JSON.parse(json));});r.addPlayer(1,'Dome','ranger');r.addPlayer(2,'Bastion','ranger');r.start();r.time=100;r.enemies=[];const [h,donor]=r.heroes.values();for(const p of [h,donor]){p.x=p.y=0;p.perk.readyAt=Infinity;p.weapons.clear();}
 h.weapons=new Map(DUOS.dome.parts.map(id=>[id,{lvl:3,t:0}]));pick(r,h,r.duoCard(h,{id:'dome',a:'ward',b:'aura'}));r.updateWeapon(h,'dome',h.weapons.get('dome'),1/30);while(h.ward>own)r.hurtPlayer(h,1);
 donor.weapons.set('ward',{lvl:5,t:0});donor.passives.set(EVOS.bastion.requires,1);pick(r,donor,r.evoCard(donor,'bastion'));r.updateWeapon(donor,'bastion',donor.weapons.get('bastion'),1/30);
 if(gift)r.hurtPlayer(donor,1);assert.equal(Boolean(h.sharedWard),gift);
 const e=r.spawnEnemy('ghoul',[h],1);Object.assign(e,{x:112,y:0,hp:100,maxHp:100,speed:0,dmg:0});r.rebuildGrid();r.domeTick(h,DUOS.dome.levels[0]);
 return {r,h,e,wire};
}
for(const own of [0,1])for(const gift of [false,true])test('r13-41 actual Dome/Bastion picks distinguish own '+own+' gift '+gift+' in codec/render',()=>{
 const {r,h,e,wire}=scene(own,gift),net=Object.create(Net.prototype);net.handlers=new Map();net.snapDec={};
 // Use the production Net constructor's decoder without opening a transport or timer.
 const codec=import('../public/js/snapshot-codec.js');
 return codec.then(({SnapshotDecoder})=>{
  net.snapDec=new SnapshotDecoder();net.keyAskedAt=-Infinity;const requests=[];net.send=m=>requests.push(m);
  const g=new Game(net);g.me=1;g.begin(r.startMsg());net.on('s',m=>g.onSnapshot(m));r.snapshot();net.receive(JSON.stringify(wire.at(-1)));
  const show=()=>{g.view.b=g.view.a=g.latest();g.view.tm=g.latest().tm;const radius=[];const renderer=Object.create(Renderer.prototype);renderer.tmp={};renderer.drawDome=(_c,_x,_y,radiusValue,charged)=>radius.push([radiusValue,charged]);const ctx=new Proxy({},{get:()=>()=>{}});renderer.drawAuras(ctx,g,r.time);return radius[0];};
  const [radius,charged]=show();assert.ok(Math.abs(radius-(own?115:100))<1e-9,'rendered own-charge-dependent radius matches the actual attack');assert.equal(charged,own>0);assert.equal(e.hp<100,own>0,'target112 is damaged exactly when the larger attack exists');
  const row=g.latest().pMap.get(1);assert.equal(row.length,15);assert.equal(row[13],own,'row13 remains actual own charges');assert.equal(wardCharges(row,g.latest(),g.view.tm),own+(gift?1:0),'shield glyphs retain the separate gift');
  if(gift){assert.deepEqual([...g.latest().wardGift],[[1,h.sharedWard.until]]);h.sharedWard=null;r.time+=.1;r.snapshot();r.time+=.1;r.snapshot();net.receive(JSON.stringify(wire.at(-1)));assert.equal(requests.at(-1)?.t,'kf');r.needKey.add(1);r.snapshot();net.receive(JSON.stringify(wire.at(-1)));assert.equal(g.latest().wardGift.size,0,'accepted recovery key clears a missing gift without changing own charges');assert.equal(g.latest().pMap.get(1)[13],own);}
 });
});
