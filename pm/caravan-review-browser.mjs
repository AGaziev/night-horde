// Optional local visual regression. PLAYWRIGHT_MODULE points to an installed Playwright package.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as wait} from 'node:timers/promises';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = new URL('../',import.meta.url).pathname;
const out = process.env.REVIEW_OUTPUT || path.join(os.tmpdir(),'caravan-review'); fs.mkdirSync(out,{recursive:true});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'caravan-browser-'));
const port=34621,url=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['app/server/server.js'],{cwd:root,env:{...process.env,PORT:String(port),HORDE_RUNS_DIR:dir,VIBE_APP_KEY:''},stdio:'ignore'});
const exited=once(child,'exit');let browser;
try{
 let ready=false;for(let i=0;i<80&&!ready;i++){ready=await fetch(url+'/health').then(r=>r.ok,()=>false);if(!ready)await wait(50);}assert.ok(ready);
 browser=await chromium.launch({headless:true,args:['--mute-audio']});const results=[];
 for(const [width,height] of [[320,568],[390,844]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true});const page=await context.newPage();
  await page.addInitScript(()=>{window.requestAnimationFrame=()=>0;});await page.goto(url);await page.waitForSelector('#menu-create');
  const data=await page.evaluate(async()=>{
   const {Game}=await import('/js/game.js'),{UI}=await import('/js/ui.js');
   const game=new Game({send(){}});game.me=1;game.begin({players:[{pid:1,hero:'witch',x:0,y:0}]});
   const ui=new UI();ui.show('game');
   const snap={tm:210,p:[[1,0,0,123,456,1,0,10,0,0,1,0,[],0,0]],e:[],fx:[],cv:null};
   game.onSnapshot(snap);ui.updateHud(game);const hp=document.querySelector('.hud-hp');const before=hp.getBoundingClientRect().width;
   game.onSnapshot({...snap,tm:211,cv:{status:'guarded',killed:0,total:14,expires:330,x:1200,y:0}});ui.updateHud(game);
   window.review={ui,game,snap};return{before,after:hp.getBoundingClientRect().width,text:document.querySelector('#hud-hp-text').textContent,optional:document.querySelector('#hud-caravan summary').textContent};
  });
  assert.equal(data.after,data.before,'caravan must not shrink HP row');assert.ok(data.after>=90);assert.equal(data.text,'123 / 456');assert.match(data.optional,/необязательно/);
  await page.locator('#hud-caravan summary').tap();assert.equal(await page.locator('#hud-caravan').evaluate(e=>e.open),true);
  const info=await page.locator('#hud-caravan').innerText();assert.match(info,/15%/);assert.match(info,/10%/);assert.match(info,/Можно пройти мимо/);
  await page.screenshot({path:path.join(out,`caravan-${width}.png`)});
  await page.locator('#hud-caravan summary').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#hud-caravan').evaluate(e=>e.open),false);
  await page.keyboard.press('Space');assert.equal(await page.locator('#hud-caravan').evaluate(e=>e.open),true);
  results.push({width,height,...data,touch:true,keyboard:true});await context.close();
 }
 fs.writeFileSync(path.join(out,'caravan-browser.json'),JSON.stringify({runtime:process.version,results,scope:'Production DOM/CSS/UI module with injected snapshot; no natural caravan combat claim'},null,2));console.log(JSON.stringify(results));
}finally{await browser?.close();child.kill();await exited;fs.rmSync(dir,{recursive:true,force:true});}
