import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire('/Users/s.konev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const output=new URL('../outputs/eight-issues/weapons/',import.meta.url).pathname;
const browser=await chromium.launch({args:['--mute-audio']});const evidence=[];
try {
 for(const revision of ['baseline','candidate']) for(const mobile of [false,true]) {
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/combat-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Combat footprint comparison</title><body style="margin:0;background:#141a1d;color:white;font:15px system-ui"><main></main></body></html>'}));
  await page.goto(`http://127.0.0.1:${revision==='baseline'?4632:4631}/combat-fixture`);
  const metrics=await page.evaluate(async({revision,mobile})=>{
   const {Renderer}=await import('/js/render.js');const {Game}=await import('/js/game.js');
   const main=document.querySelector('main');const h=document.createElement('h2');h.textContent=`${revision} · ${mobile?'390×844 touch':'1280×800 desktop'}`;h.style.margin='18px';main.append(h);
   const note=document.createElement('p');note.textContent='Real renderer · fixed server impact boxes (yellow) · 120 ms after impact · hero moved +35 px';note.style.margin='18px';main.append(note);
   const canvas=document.createElement('canvas');canvas.width=mobile?390:1200;canvas.height=600;canvas.style.width='100%';main.append(canvas);const ctx=canvas.getContext('2d');ctx.fillStyle='#141a1d';ctx.fillRect(0,0,canvas.width,canvas.height);
   const r=Object.create(Renderer.prototype);Object.assign(r,{tmp:{},sprites:{ready:false},visible:()=>true});
   const game=new Game({send(){}});const origin={x:mobile?80:270,y:180};game.playerPos=()=>({x:origin.x+35,y:origin.y});
   game.effect(['slash',1,1,140,56,origin.x,origin.y,10]);game.slashes[0].t=.12;
   ctx.strokeStyle='#ffca28';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.strokeRect(origin.x,origin.y-28,140,56);ctx.setLineDash([]);
   r.drawEffects(ctx,game);
   ctx.fillStyle='#90caf9';ctx.beginPath();ctx.arc(origin.x+35,origin.y,14,0,Math.PI*2);ctx.fill();
   ctx.fillStyle='#fff';ctx.font='14px system-ui';ctx.fillText('Guard slash: server x=0…140, y=±28',20,100);
   for(const [x,y,label,color] of [[140,0,'edge: hit','#a5d6a7'],[157,0,'outside: miss','#ef9a9a']]){ctx.fillStyle=color;ctx.beginPath();ctx.arc(origin.x+x,origin.y+y,4,0,Math.PI*2);ctx.fill();ctx.fillText(label,origin.x+x-30,origin.y+65+(x===157?22:0));}
   game.hostile.set(1,{x:origin.x+50,y:360,vx:220,vy:0,st:10,show:true});game.hostile.set(2,{x:origin.x+140,y:360,vx:-170,vy:0,st:10,show:true,r:12});r.drawHostile(ctx,game,10.12);
   ctx.fillStyle='#fff';ctx.fillText('Enemy shots: physical core 7px / orb 12px',20,320);ctx.fillText('Glow and trail are cosmetic',20,410);
   return {slash:game.slashes[0],hostileCores:[7,12],viewport:[innerWidth,innerHeight],touch:navigator.maxTouchPoints};
  },{revision,mobile});
  await page.screenshot({path:output+`${revision}-${mobile?'mobile':'desktop'}-combat.png`,fullPage:true});evidence.push({revision,mobile,metrics,errors});await context.close();
 }
 fs.writeFileSync(output+'browser-combat.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence.map(({revision,mobile,errors})=>({revision,mobile,errors}))));
}finally{await browser.close();}
