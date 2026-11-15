// Actual browser/server regressions for CEO55. The response exposes existing instances only for observation.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {setTimeout as wait} from 'node:timers/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../',import.meta.url).pathname,out=process.env.REVIEW_OUTPUT||path.join(os.tmpdir(),'dash-review');fs.mkdirSync(out,{recursive:true});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dash-browser-')),port=34617,url=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['app/server/server.js'],{cwd:root,env:{...process.env,PORT:String(port),HORDE_RUNS_DIR:dir,VIBE_APP_KEY:''},stdio:'ignore'}),exited=once(child,'exit');let browser;
const results=[];
try{
 let ready=false;for(let i=0;i<80&&!ready;i++){ready=await fetch(url+'/health').then(r=>r.ok,()=>false);if(!ready)await wait(50);}assert.ok(ready);
 browser=await chromium.launch({headless:true,args:['--mute-audio','--disable-features=LocalNetworkAccessChecks']});
 async function open({sse=false,width=1000,height=800,touch=false}={}){
  const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,deviceScaleFactor:touch?2:1});const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/js/main.js',async route=>{const res=await route.fetch();return route.fulfill({response:res,body:(await res.text())+'\nwindow.__review={game,net,input,ui,state,renderer};'});});
  await page.addInitScript(()=>{
   window.__wire=[];window.__delayMs=0;const WS=window.WebSocket;
   window.WebSocket=class extends WS{
    set onmessage(fn){super.onmessage=fn?ev=>{try{window.__wire.push(...[].concat(JSON.parse(ev.data)));}catch{}const delay=window.__delayMs;if(delay)setTimeout(()=>fn(ev),delay);else fn(ev);}:null;}
   };
  });
  await page.goto(url+(sse?'/?transport=sse':''));await page.waitForFunction(()=>window.__review?.net.connected);
  await page.locator('#menu-create').click();await page.waitForSelector('#screen-lobby:not([hidden])');await page.locator('#lobby-start').click();
  await page.waitForFunction(()=>window.__review?.game.running&&window.__review.game.latest());return{context,page,errors};
 }
 // The real client accepts a dash while every incoming packet is delayed320ms.
 {
  const{context,page,errors}=await open();const start=await page.evaluate(()=>window.__review.game.local.x);
  await page.evaluate(()=>window.__delayMs=320);await page.keyboard.press('Space');await wait(1200);
  const state=await page.evaluate(()=>{const{game}=window.__review;return{x:game.local.x,server:game.myRow()[1],travel:game.dashTravel,acks:window.__wire.filter(m=>m.t==='dash')};});
  assert.ok(Math.abs(state.x-start-180)<3,JSON.stringify(state));assert.ok(Math.abs(state.server-start-180)<3);assert.equal(state.travel,null);assert.equal(state.acks.filter(m=>m.ok).length,1);assert.deepEqual(errors,[]);
  results.push({case:'320ms delayed incoming packets',start,...state});await page.screenshot({path:path.join(out,'delayed320.png')});await context.close();
 }
 // A dash queued behind a real unfinished SSE position POST must disappear at timeout.
 {
  const{context,page,errors}=await open({sse:true});let hold=true,held=false,release;const gate=new Promise(r=>release=r);
  await page.route('**/api/send?*',async route=>{const body=JSON.parse(route.request().postData()||'{}');if(hold&&[].concat(body).some(m=>m.t==='pos')){held=true;await gate;}await route.continue();});
  await page.keyboard.down('ArrowRight');await page.waitForFunction(()=>window.__review.net.posting);for(let i=0;i<80&&!held;i++)await wait(20);assert.ok(held);await page.keyboard.up('ArrowRight');
  await page.keyboard.press('Space');await page.waitForFunction(()=>window.__review.net.outbox.some(m=>m.t==='dash'));await wait(1650);
  const timed=await page.evaluate(()=>({waiting:window.__review.game.dashWaiting,queued:window.__review.net.outbox.filter(m=>m.t==='dash').length,epoch:window.__review.game.moveEpoch}));assert.equal(timed.waiting,0);assert.equal(timed.queued,0);
  hold=false;release();await wait(400);const epoch=await page.evaluate(()=>window.__review.game.moveEpoch);assert.equal(epoch,0);assert.deepEqual(errors,[]);results.push({case:'SSE unsent action timeout',...timed});await context.close();
 }
 // An already transmitted but held POST cannot act after a same-sid WS new run.
 {
  const{context,page,errors}=await open({sse:true});let held=false,release;const gate=new Promise(r=>release=r);let oldAction;
  await page.route('**/api/send?*',async route=>{const body=JSON.parse(route.request().postData()||'{}');const dash=[].concat(body).find(m=>m.t==='dash');if(dash&&!held){held=true;oldAction=dash;await gate;}await route.continue();});
  await page.keyboard.press('Space');for(let i=0;i<100&&!held;i++)await wait(20);assert.ok(held);await wait(1650);
  await page.evaluate(()=>{const{net}=window.__review;net.es?.close();net.es=null;net.forceSse=false;net.connect();});await page.waitForFunction(()=>window.__review.net.connected&&window.__review.net.transport==='WS');
  await page.evaluate(()=>window.__review.net.send({t:'quit'}));await page.waitForSelector('#screen-lobby:not([hidden])');await page.locator('#lobby-start').click();await page.waitForFunction(old=>window.__review.game.running&&window.__review.game.mobilityRun!==old,oldAction.run);
  const before=await page.evaluate(()=>window.__review.game.local.x);release();await wait(400);
  const rejected=await page.evaluate(old=>({x:window.__review.game.myRow()[1],epoch:window.__review.game.moveEpoch,acks:window.__wire.filter(m=>m.t==='dash'&&m.run===old)}),oldAction.run);
  assert.equal(rejected.x,before);assert.equal(rejected.epoch,0);assert.ok(rejected.acks.some(m=>m.ok===false));
  await page.keyboard.press('Space');await page.waitForFunction(()=>window.__review.game.moveEpoch===1);await wait(300);assert.ok(Math.abs((await page.evaluate(()=>window.__review.game.myRow()[1]))-before-180)<3);assert.deepEqual(errors,[]);
  results.push({case:'old SSE POST after new WS run',before,...rejected,newDashAccepted:true});await context.close();
 }
 for(const[width,height]of[[320,568],[390,844]]){
  const{context,page,errors}=await open({width,height,touch:true});
  const rects=await page.evaluate(()=>{const{renderer}=window.__review;const a=document.querySelector('#hud-dash').getBoundingClientRect(),b=renderer.overlay.mm.getBoundingClientRect();return{button:a.toJSON(),radar:b.toJSON()};});
  assert.ok(rects.button.bottom+4<=rects.radar.top,JSON.stringify(rects));
  await page.locator('#hud-dash').click({button:'right'});await wait(100);assert.equal(await page.evaluate(()=>window.__review.game.moveEpoch),0,'secondary mouse must not trigger dash');
  await page.mouse.click(15,Math.round(height/2));
  const cdp=await context.newCDPSession(page),joy={id:1,x:50,y:height-70},moved={...joy,x:85},button={id:2,x:rects.button.x+rects.button.width/2,y:rects.button.y+rects.button.height/2};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[joy]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[moved]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[moved,button]});await page.waitForFunction(()=>window.__review.game.moveEpoch===1);
  assert.equal(await page.evaluate(()=>window.__review.input.joy.active),true);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(150);
  assert.equal(await page.locator('#hud-dash').isDisabled(),true);await page.screenshot({path:path.join(out,`mobile-${width}-cooldown.png`)});assert.deepEqual(errors,[]);
  results.push({case:'mobile radar/primary mouse/secondary touch',width,height,...rects,secondaryMouseIgnored:true,secondTouchAccepted:true,joystickRemainedActive:true,cooldownVisible:true});await context.close();
 }
 // Facing survives an actual WS resync with no fresh directional input.
 {
  const{context,page,errors}=await open();await page.keyboard.down('ArrowLeft');await wait(150);await page.keyboard.up('ArrowLeft');await wait(150);
  const attempt=await page.evaluate(()=>{const{net}=window.__review;const attempt=net.attempt;net.ws.close();return attempt;});await page.waitForFunction(old=>window.__review.net.attempt>old&&window.__review.net.connected&&window.__review.game.local.fx<0,attempt);await wait(250);
  const before=await page.evaluate(()=>window.__review.game.local.x);await page.keyboard.press('Space');await wait(400);const after=await page.evaluate(()=>window.__review.game.myRow()[1]);assert.ok(Math.abs(before-after-180)<3,JSON.stringify({before,after}));assert.deepEqual(errors,[]);
  results.push({case:'left-facing reconnect without fresh input',before,after});await context.close();
 }
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({runtime:process.version,results,scope:'Actual production browser, local native server, real WS/SSE/input; main.js response exposes instances only for observation and transport scheduling'},null,2));console.log(JSON.stringify(results));
}catch(error){fs.writeFileSync(path.join(out,'browser-partial-failure.json'),JSON.stringify({runtime:process.version,results,error:String(error)},null,2));throw error;}finally{await browser?.close();child.kill();await exited;fs.rmSync(dir,{recursive:true,force:true});}
