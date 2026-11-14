import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {Room} from './game.js';
import {Net} from '../public/js/net.js';
import {SnapshotDecoder} from '../public/js/snapshot-codec.js';
const source=fs.readFileSync(new URL('../public/js/game.js',import.meta.url),'utf8').replace("'/shared/content.js'",JSON.stringify(new URL('../public/shared/content.js',import.meta.url).href));
const {Game}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('CEO31.3 lost cancel is recovered by a requested wire key, unrelated shots survive',()=>{
 const wire=[];const r=new Room('KEY',(_pid,_msg,json)=>{if(json&&_pid===1)wire.push(JSON.parse(json));});r.addPlayer(1,'One','knight');r.addPlayer(2,'Ally','ranger');r.start();r.time=100;
 const h=r.heroes.get(1);h.weapons=new Map([['bolt',{lvl:3,t:0}],['lightning',{lvl:3,t:0}],['flask',{lvl:3,t:0}]]);
 const ally=r.heroes.get(2);
 r.projectiles=[{id:901,owner:h,src:{weapon:'bolt'},life:3},{id:902,owner:ally,src:{weapon:'flask'},life:3}];
 const net=Object.create(Net.prototype);Object.assign(net,{snapDec:new SnapshotDecoder(),keyAskedAt:-Infinity,handlers:new Map()});const requested=[];net.send=m=>requested.push(m);
 const game=new Game(net);game.onEvent=()=>{};net.on('s',s=>game.onSnapshot(s));
 r.fx.push(['shot',901,0,0,0,100,0,3,0,100],['shot',902,0,0,0,100,0,3,0,100]);r.snapshot();net.receive(JSON.stringify(wire.at(-1)));
 assert.ok(game.shots.has(901)&&game.shots.has(902));
 assert.ok(r.fuseDuo(h,{id:'orb',parts:['bolt','lightning'],level:1}));r.snapshot(); // intentionally lose the only cancel packet
 r.snapshot();net.receive(JSON.stringify(wire.at(-1)));assert.equal(requested.at(-1)?.t,'kf');assert.ok(game.shots.has(901));
 r.needKey.add(1);r.snapshot();net.receive(JSON.stringify(wire.at(-1)));
 assert.equal(game.shots.has(901),false,'accepted key removes the consumed projectile immediately');assert.ok(game.shots.has(902),'unrelated live attack remains');
 net.receive(JSON.stringify(wire.at(-1)));assert.ok(game.shots.has(902),'repeated key is idempotent');
 game.shotEvent(['shot',901,0,0,0,100,0,3,0,100]);assert.equal(game.shots.has(901),false,'late spawn from a consumed attack cannot resurrect');
 r.start();game.reset();assert.equal(r.consumedAttacks.size,0);assert.equal(game.consumedAttacks.size,0);
 game.shotEvent(['shot',901,0,0,0,100,0,3,0,0]);assert.ok(game.shots.has(901),'new-run ID reuse is not poisoned');
});
