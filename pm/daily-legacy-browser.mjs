import { PROTO } from '../app/server/snapshot-codec.js';
// Real legacy browser progress + transport proof. Optional Playwright installation is external.
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';import {once} from 'node:events';import {setTimeout as wait} from 'node:timers/promises';
import {createRequire} from 'node:module';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../',import.meta.url).pathname,require=createRequire(new URL('../app/package.json',import.meta.url));const WebSocket=require('ws');
const base='f4a40dc3cd743a114b5df7417acd65e0c08bceae',port=34612,url=`http://127.0.0.1:${port}`;
const out=process.env.REVIEW_OUTPUT||path.join(os.tmpdir(),'daily-legacy-browser');fs.mkdirSync(out,{recursive:true});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-browser-'));const child=spawn(process.execPath,['app/server/server.js'],{cwd:root,env:{...process.env,PORT:String(port),HORDE_RUNS_DIR:dir,VIBE_APP_KEY:''},stdio:'ignore'});const exited=once(child,'exit');let browser,control;
try{
 let ready=false;for(let i=0;i<80&&!ready;i++){ready=await fetch(url+'/health').then(r=>r.ok,()=>false);if(!ready)await wait(50);}assert.ok(ready);
 browser=await chromium.launch({headless:true,args:['--mute-audio','--disable-features=LocalNetworkAccessChecks']});const context=await browser.newContext();
 const cache=new Map();await context.route('**/*',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/'||pathname.startsWith('/js/')){
   const file=pathname==='/'?'index.html':pathname.slice(1);let body=cache.get(file);
   if(!body){body=execFileSync('git',['show',`${base}:app/public/${file}`],{cwd:root,encoding:'utf8'});if(file==='js/snapshot-codec.js')body=body.replace(/export const PROTO = \d+;/,'export const PROTO = 24;');cache.set(file,body);}
   return route.fulfill({contentType:file.endsWith('.html')?'text/html':'text/javascript',body});
  }return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>console.error('BROWSER',e.message));page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text());});await page.addInitScript(()=>{
  if(location.protocol!=='http:')return;
  sessionStorage.setItem('nh.protoReload',String(Date.now()));if(!localStorage.getItem('nh.ach'))localStorage.setItem('nh.ach',JSON.stringify({kills:17}));window.__wire=[];
  const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(...args){super(...args);this.addEventListener('message',e=>{try{window.__wire.push(...[].concat(JSON.parse(e.data)));}catch{}});}};
 });
 await page.goto(url);await page.waitForFunction(()=>window.__wire.some(m=>m.t==='welcome'));
 const legacyCode=await page.evaluate(async()=>({proto:(await import('/js/snapshot-codec.js')).PROTO}));assert.equal(legacyCode.proto,24);
 await page.locator('#menu-create').click();await page.waitForSelector('#screen-lobby:not([hidden])');await page.locator('#lobby-start').click();await page.waitForFunction(()=>window.__wire.some(m=>m.t==='start'));
 const sid=await page.evaluate(()=>sessionStorage.getItem('nh.sid'));assert.ok(sid);
 const before=await page.evaluate(()=>({ach:localStorage.getItem('nh.ach'),duos:localStorage.getItem('nh.duos'),run:localStorage.getItem('nh.achRun')}));
 // Keep this exact browsing context/storage, but stop its old reconnect loop while current host opts into daily.
 await page.goto('about:blank');
 const messages=[];control=new WebSocket(`ws://127.0.0.1:${port}/ws?sid=${sid}&v=${PROTO}`);control.on('message',s=>messages.push(...[].concat(JSON.parse(s.toString()))));await once(control,'open');
 const until=async predicate=>{for(let i=0;i<150;i++){const m=messages.find(predicate);if(m)return m;await wait(10);}throw Error('control message timeout');};
 await until(m=>m.t==='start');control.send(JSON.stringify({t:'quit'}));await until(m=>m.t==='lobby');
 control.send(JSON.stringify({t:'daily',enabled:true}));await until(m=>m.t==='lobby'&&m.dailySelected);control.send(JSON.stringify({t:'start'}));await until(m=>m.t==='start'&&m.daily);
 await page.goto(url);await page.waitForFunction(()=>window.__wire.some(m=>m.t==='err'&&/испытании/.test(m.msg)));
 await wait(650);const result=await page.evaluate(()=>({messages:window.__wire,after:{ach:localStorage.getItem('nh.ach'),duos:localStorage.getItem('nh.duos'),run:localStorage.getItem('nh.achRun')}}));
 assert.deepEqual(result.after,before);assert.ok(result.messages.some(m=>m.t==='welcome'));assert.ok(result.messages.every(m=>m.t==='welcome'||m.t==='err'),'no snapshot/FX/start/choices/pickack/over may reach legacy daily browser');
 await page.screenshot({path:path.join(out,'legacy24-daily-denied.png')});
 fs.writeFileSync(path.join(out,'legacy-browser.json'),JSON.stringify({runtime:process.version,legacySource:base,wireProtocol:24,normalStart:true,dailyReconnectDenied:true,progressUnchanged:true,...result,scope:'Actual unchanged base main/game/UI/progress handlers; snapshot-codec protocol constant set to 24 to reproduce fallback. Local owned server only.'},null,2));
 console.log('PASS: actual legacy24 browser ordinary start; same sid active daily denied; no progress-bearing messages/storage changes');
}finally{control?.terminate();await browser?.close();child.kill();await exited;fs.rmSync(dir,{recursive:true,force:true});}
