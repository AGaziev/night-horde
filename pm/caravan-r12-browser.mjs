import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';import {setTimeout as wait} from 'node:timers/promises';
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');const root=new URL('../',import.meta.url),out=process.env.REVIEW_OUTPUT||path.join(os.tmpdir(),'caravan-r12');fs.mkdirSync(out,{recursive:true});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'caravan-r12-')),url='http://127.0.0.1:34621';
// Test-only IPC drives the owned Room's active time and finish; production handlers/DOM/WS remain unchanged.
const source=`const {Room}=await import(${JSON.stringify(new URL('../app/server/game.js',import.meta.url).href)});const rooms=new Map(),start=Room.prototype.start;Room.prototype.start=function(){const v=start.call(this);rooms.set(this.code,this);this.spawn=()=>{};this.events.next=Infinity;return v;};process.on('message',m=>{const r=rooms.get(m.code);if(!r)return;if(m.cmd==='caravan')r.time=r.runLength*.35;if(m.cmd==='finish')r.finish(false);});await import(${JSON.stringify(new URL('../app/server/server.js',import.meta.url).href)});`;
const child=spawn(process.execPath,['--input-type=module','-e',source],{cwd:root,env:{...process.env,PORT:'34621',HORDE_RUNS_DIR:dir,VIBE_APP_KEY:''},stdio:['ignore','ignore','ignore','ipc']}),exited=once(child,'exit');let browser;const results=[];
try{
 let ready=false;for(let i=0;i<80&&!ready;i++){ready=await fetch(url+'/health').then(r=>r.ok,()=>false);if(!ready)await wait(50);}assert.ok(ready);
 browser=await chromium.launch({headless:true,args:['--mute-audio','--disable-features=LocalNetworkAccessChecks']});
 for(const[width,height]of[[320,568],[390,844],[568,320]]){
  const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true}),page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>window.__nh?.net.connected);
  await page.locator('#menu-create').click();await page.waitForSelector('#screen-lobby:not([hidden])');await page.locator('#lobby-start').click();await page.waitForFunction(()=>window.__nh.game.latest());
  const hpBefore=await page.locator('.hud-hp').evaluate(e=>e.getBoundingClientRect().width),code=await page.evaluate(()=>window.__nh.state.lobby.code);child.send({cmd:'caravan',code});await page.waitForSelector('#hud-caravan:not([hidden])');
  const geometry=await page.evaluate(()=>{const card=document.querySelector('#hud-caravan').getBoundingClientRect(),summary=document.querySelector('#hud-caravan-status').getBoundingClientRect();const overlap=[...document.querySelectorAll('#snd .snd-btn')].some(e=>{const b=e.getBoundingClientRect();return b.x<card.right&&b.right>card.x&&b.y<card.bottom&&b.bottom>card.y;});return{overlap,summary:summary.toJSON(),hp:document.querySelector('.hud-hp').getBoundingClientRect().width};});
  await page.touchscreen.tap(geometry.summary.x+8,geometry.summary.y+14);const touchOpened=await page.locator('#hud-caravan').evaluate(e=>e.open);
  if(!touchOpened){await page.locator('#hud-caravan-status').focus();await page.keyboard.press('Space');}
  const expanded=await page.evaluate(()=>{const c=document.querySelector('#hud-caravan'),r=c.getBoundingClientRect();return{withinViewport:r.right<=innerWidth&&r.bottom<=innerHeight,scrollable:c.scrollHeight>c.clientHeight,text:c.innerText,overlap:[...document.querySelectorAll('#snd .snd-btn')].some(e=>{const b=e.getBoundingClientRect();return b.x<r.right&&b.right>r.x&&b.y<r.bottom&&b.bottom>r.y;})};});
  await page.screenshot({path:path.join(out,`caravan-${width}x${height}.png`)});await page.locator('#hud-caravan-status').focus();child.send({cmd:'finish',code});await page.waitForSelector('#screen-over:not([hidden])');
  const over=await page.evaluate(()=>({hidden:document.querySelector('#hud-caravan').hidden,open:document.querySelector('#hud-caravan').open,text:document.querySelector('#hud-caravan-status').textContent,focus:document.activeElement.id}));
  // Native keyboard should activate the result's Again action, never the now-hidden HUD summary.
  if(over.focus!=='over-again')await page.locator('#over-again').focus();await page.keyboard.press('Enter');await page.waitForSelector('#screen-lobby:not([hidden])');
  await page.evaluate(()=>window.__nh.net.on('start',()=>{const c=document.querySelector('#hud-caravan');window.__restart={hidden:c.hidden,open:c.open,text:document.querySelector('#hud-caravan-status').textContent};}));
  await page.locator('#lobby-start').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__restart);const restart=await page.evaluate(()=>window.__restart);
  await page.keyboard.press('Enter');const hiddenUnchanged=await page.locator('#hud-caravan').evaluate(e=>!e.open);
  results.push({width,height,hpBefore,geometry,touchOpened,expanded,over,restart,hiddenUnchanged});await context.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({node:process.version,results,scope:'Actual browser/WS/Room.finish. Test-only IPC jumps active time to caravan; not natural-run balance evidence.'},null,2));console.log(JSON.stringify(results));
 for(const r of results){assert.equal(r.geometry.hp,r.hpBefore);assert.equal(r.geometry.overlap,false);assert.equal(r.expanded.overlap,false);assert.ok(r.touchOpened);assert.ok(r.expanded.withinViewport);assert.match(r.expanded.text,/15%/);assert.match(r.expanded.text,/10%/);assert.ok(r.over.hidden&&!r.over.open&&r.over.text==='');assert.equal(r.over.focus,'over-again');assert.ok(r.restart.hidden&&!r.restart.open&&r.restart.text==='');assert.ok(r.hiddenUnchanged);}
}finally{await browser?.close();child.kill();await exited;fs.rmSync(dir,{recursive:true,force:true});}
