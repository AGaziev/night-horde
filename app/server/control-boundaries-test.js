import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {Room} from './game.js';
const dt=1/30;
export function scene({kind='root',near=true,guard=false,type='ghoul',attack=false}={}) {
 const original=Math.random;let draws=0,state=927;
 Math.random=()=>{draws++;state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 try {
 const r=new Room('R16',()=>{});r.addPlayer(1,'Owner','ranger');r.addPlayer(2,'Ally','ranger');r.start();r.time=100;r.enemies=[];
 const [h,b]=r.heroes.values();for(const p of [h,b]){p.y=0;p.weapons.clear();p.perk.readyAt=Infinity;p.hp=p.maxHp=100;p.iframes=0;}
 h.x=guard?630:near?26:300;b.x=guard?640:1000;
 const e=r.spawnEnemy(type,[h],1);Object.assign(e,{x:guard?(near?520:300):0,y:0,hp:1e6,maxHp:1e6,dmg:8});if(guard)e.outpost={x:0,y:0};
 if(attack){e.windT=2;e.shotT=3;}
 if(kind==='root')r.root(e,2,h);
 if(kind==='freeze')r.freeze(e,2,h);
 if(kind==='sand'){const item=r.dropItem('slowtime',h.x,0);r.updateItems(dt,[h,b]);assert.ok(!r.items.includes(item));assert.equal(e.slowOwner,h);assert.ok(e.slowT>r.time);}
 const path=[];for(let i=0;i<30;i++){r.tick(dt);path.push([e.x,e.y,h.hp,b.hp,e.windT,e.shotT]);}
 return {path,control:h.support.control,hp:h.hp,draws};
 } finally {Math.random=original;}
}
const cases=[['contact-root',{kind:'root',near:true}],['leash-ghoul',{kind:'sand',guard:true,near:true}],['leash-skel',{kind:'sand',guard:true,near:true}],['far-root',{kind:'root',near:false}],['inset-sand',{kind:'sand',guard:true,near:false}],['contact-freeze',{kind:'freeze',near:true}],['attack-root',{kind:'root',near:true,type:'spitter',attack:true}]];
const results=[];
for(const [id,options] of cases)test('r16 '+id+' contribution follows an actual path or attack difference',()=>{
 const plain=scene({...options,kind:null}),controlled=scene(options),equal=JSON.stringify(plain.path)===JSON.stringify(controlled.path),negative=id==='contact-root'||id.startsWith('leash-');
 results.push({id,plain,controlled,equal});
 assert.equal(equal,negative,'A/B paths, HP and attack progress are the evidence of effect');
 assert.ok(Math.abs(controlled.control-(negative?0:1))<1e-9,'only delivered control counts unique enemy seconds');
});
process.on('exit',()=>{if(process.env.CONTROL_BOUNDARY_OUTPUT)fs.writeFileSync(process.env.CONTROL_BOUNDARY_OUTPUT,JSON.stringify({runtime:process.version,results},null,2));});
