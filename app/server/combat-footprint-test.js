import assert from 'node:assert/strict';
import {Room} from './game.js';
const r=new Room('HIT',()=>{});r.addPlayer(1,'P','knight');r.start();r.time=10;
const h=r.heroes.get(1);h.x=h.y=0;h.perk.readyAt=Infinity;h.ward=0;h.hp=100;
r.hostile=[{id:1,x:-60,y:0,vx:3600,vy:0,life:2,dmg:10}];
r.updateHostile(1/30);assert.equal(h.hp,90,'shot crosses player within one tick');
h.hp=100;h.iframes=0;h.x=60;h.dashPath={x:-60,y:0};
r.hostile=[{id:2,x:0,y:-60,vx:0,vy:3600,life:2,dmg:10}];
r.updateHostile(1/30);assert.equal(h.hp,90,'relative paths cross for moving player');
r.enemies=[];h.x=25;h.y=-8;r.slash(h,1,100,40,10);
const ev=r.fx.findLast(ev=>ev[0]==='slash');assert.deepEqual(ev.slice(5,7),[25,-8],'impact carries fixed world origin');
console.log('combat footprint: hostile relative sweep and fixed slash impact');
const {movingCircleImpact,slashBounds}=await import('../public/shared/combat-geometry.js');
assert.equal(movingCircleImpact(-60,21,60,21,0,0,0,0,21),null,'tangent preserves strict old boundary');
assert.equal(movingCircleImpact(-60,22,60,22,0,0,0,0,21),null,'near miss is not widened');
assert.ok(movingCircleImpact(-60,20,60,20,0,0,0,0,21)>0,'inside-edge crossing hits');
assert.equal(movingCircleImpact(0,0,0,0,0,0,0,0,21),0,'stationary overlap');
for(const dir of [-1,1]) {
 assert.deepEqual(slashBounds(25,-8,dir,100,40),{x:dir>0?25:-75,y:-28,width:100,height:40});
 for(const [x,y,hit] of [[dir*100,0,true],[dir*101,0,false],[dir*50,21,false],[dir*50,20,true],[-dir,0,false]]) {
  r.enemies=[];h.x=h.y=0;const e=r.spawnEnemy('ghoul',[h],1);Object.assign(e,{x,y,r:0,hp:100});r.rebuildGrid();r.slash(h,dir,100,40,10);assert.equal(e.hp<100,hit,`${dir} edge ${x},${y}`);
 }
}
// Execute the actual browser state event handler with only its browser-root import adapted for Node.
const fs=await import('node:fs');
const client=fs.readFileSync(new URL('../public/js/game.js',import.meta.url),'utf8').replace("'/shared/content.js'",JSON.stringify(new URL('../public/shared/content.js',import.meta.url).href));
const {Game}=await import('data:text/javascript;base64,'+Buffer.from(client).toString('base64'));
const g=new Game({send(){}});g.effect(['slash',1,-1,100,40,25,-8,10]);
assert.deepEqual([g.slashes[0].x,g.slashes[0].y,g.slashes[0].impactAt],[25,-8,10]);
g.shotEvent(['eshot',9,0,0,600,0,1,10]);g.shotEvent(['epend',9,10.02]);assert.equal(g.hostile.get(9).end,10.02,'client never prolongs a collided hostile');
