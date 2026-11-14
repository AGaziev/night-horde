import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
const source = fs.readFileSync(new URL('../public/js/game.js', import.meta.url), 'utf8')
 .replace("'/shared/content.js'", JSON.stringify(new URL('../public/shared/content.js', import.meta.url).href));
const { Game } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const still = { vector: () => ({ x: 0, y: 0 }) }, right = { vector: () => ({ x: 1, y: 0 }) };
function setup() {
 const sent = [], cancelled = [], g = new Game({ send: m => sent.push(m), cancelDash: (...a) => cancelled.push(a) });
 g.me = 1; g.begin({ mobilityRun: 'run-a', serverNow: Date.now(), players: [{ pid: 1, hero: 'witch', x: 0, y: 0, fx: -1, fy: 0 }] });
 return { g, sent, cancelled };
}
function accept(g, sent, extra = {}) { g.acceptDash({ ...sent.at(-1), ok: true, epoch: 1, x: 0, y: 0, dx: 1, dy: 0, readyAt: 12, ...extra }); }
const snapshot = (tm, x, epoch = 1) => ({ tm, p: [[1, x, 0, 100, 100, 1, 0, 10, 0, 0, 1, 0]], mob: [[1, epoch, epoch ? 12 : 0]] });
test('action has bounded run/request identity and reconnect direction; cooldown and reset', () => {
 const { g, sent } = setup(); assert.equal(g.requestDash(still), true);
 assert.equal(sent[0].x, -1); assert.equal(sent[0].run, 'run-a'); assert.equal(sent[0].request, 1);
 assert.ok(sent[0].expiresAt > Date.now()); assert.equal(g.requestDash(right), false);
 accept(g, sent); for (let i = 0; i < 5; i++) g.update(1/30, still);
 assert.equal(g.local.x, 180); assert.equal(sent.filter(m=>m.t==='pos').length,0,'no position tail before server completion');
 g.onSnapshot({...snapshot(.2,180),mob:[[1,1,12,0]]});g.update(0,still);assert.equal(sent.at(-1).epoch,1);
 assert.equal(g.requestDash(right), false); g.onSnapshot(snapshot(12, 180)); assert.equal(g.requestDash(right), true);
 g.acceptDash({ run: 'run-a', request: g.pendingDash, ok: false, epoch: 1 }); assert.equal(g.dashWaiting, 0);
 g.frozen = true; assert.equal(g.requestDash(right), false); g.reset(); assert.equal(g.moveEpoch, 0); assert.equal(g.dashTravel, null);
});
test('CEO55-1 delayed authoritative endpoint cancels travel instead of replaying 180px', () => {
 const { g, sent } = setup(); g.requestDash(right); accept(g, sent);
 g.onSnapshot(snapshot(.32, 180));
 for (let i = 0; i < 10; i++) g.update(1/30, still);
 assert.equal(g.local.x, 180); assert.equal(g.dashTravel, null);
});
test('CEO55-1 snapshot before delayed ack supersedes it; partial snapshot follows remaining phase', () => {
 const { g, sent } = setup(); g.requestDash(right); const request = { ...sent.at(-1) };
 g.onSnapshot(snapshot(.1, 120)); assert.equal(g.local.x, 120);
 g.acceptDash({ ...request, ok: true, epoch: 1, x: 0, y: 0, dx: 1, dy: 0, readyAt: 12 });
 for (let i = 0; i < 3; i++) g.update(1/30, still);
 assert.equal(g.local.x, 180); assert.equal(g.pendingDash, 0);
});
test('CEO55-2 timeout removes queued SSE dash; late response and prior-run response cannot move hero', () => {
 const { g, sent, cancelled } = setup(); g.requestDash(right); const request = { ...sent.at(-1) };
 g.dashWaiting = performance.now() - 1; g.update(0, still);
 assert.deepEqual(cancelled.at(-1), ['run-a', 1]); accept(g, [request]); assert.equal(g.local.x, 0);
 g.begin({ mobilityRun: 'run-b', players: [{ pid: 1, x: 0, y: 0 }] }); g.requestDash(right);
 g.acceptDash({ ...request, ok: true, epoch: 1, x: 0, y: 0, dx: 1, dy: 0, readyAt: 12 });
 assert.equal(g.pendingDash, 1, 'old rejection/ack cannot clear a new request'); assert.equal(g.local.x, 0);
});
test('stale snapshot cannot rewind accepted dash; ordinary down state still corrects', () => {
 const { g, sent } = setup(); g.requestDash(right); accept(g, sent);
 for (let i = 0; i < 5; i++) g.update(1/30, still);
 g.onSnapshot(snapshot(.05, 0, 0)); assert.equal(g.local.x, 180); assert.equal(g.dashReadyAt, 12);
 g.onSnapshot(snapshot(.1, 120)); assert.equal(g.local.x, 180);
 const down = snapshot(.2, 0); down.p[0][8] = 1; down.p[0][3] = 0;
 g.onSnapshot(down); assert.equal(g.local.x, 0); assert.equal(g.dashTravel, null);
});
test('CEO55-r11 client predicts the same first ring boundary on a diagonal dash',()=>{
 const{g,sent}=setup();g.local.x=420;g.local.y=0;const s=snapshot(.01,420,0);s.fin=[2,75,0,0,440,440];g.onSnapshot(s);
 g.requestDash({vector:()=>({x:1,y:1})});accept(g,sent,{x:420,dx:Math.SQRT1_2,dy:Math.SQRT1_2});g.update(1/30,still);
 assert.ok(Math.abs(Math.hypot(g.local.x,g.local.y)-426)<1e-8);assert.ok(Math.abs(g.local.x-420-g.local.y)<1e-8);
});
for(const delay of [0,100,200,220,320])for(const edge of ['ring','world'])test(`CEO55-r13 completed ${edge} dash accepts endpoint after${delay}ms without a position tail`,()=>{
 const{g,sent}=setup();const start=edge==='ring'?{x:420,y:0}:{x:99990,y:20};g.local.x=start.x;g.local.y=start.y;const s=snapshot(.01,start.x,0);s.p[0][2]=start.y;s.pa=[];if(edge==='ring')s.fin=[2,75,0,0,440,440];g.onSnapshot(s);
 g.requestDash({vector:()=>({x:1,y:1})});accept(g,sent,{x:start.x,y:start.y,dx:Math.SQRT1_2,dy:Math.SQRT1_2,serverNow:Date.now()-delay});
 const x=edge==='ring'?425.95832931438315:100000,y=edge==='ring'?5.95832931438315:30;
 const end=snapshot(.3,x);end.p[0][2]=y;end.mob=[[1,1,12,0]];end.pa=[];if(edge==='ring')end.fin=s.fin;g.onSnapshot(end);g.update(1/60,still);
 assert.ok(Math.abs(g.local.x-x)<1e-6&&Math.abs(g.local.y-y)<1e-6,JSON.stringify(g.local));
 const pos=sent.filter(m=>m.t==='pos');assert.ok(pos.every(m=>Math.hypot(m.x-x,m.y-y)<.1),'no stale endpoint is submitted');
});
