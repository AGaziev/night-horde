import {createRequire} from 'node:module';import fs from 'node:fs';
import {Room} from '../app/server/game.js';
const require=createRequire('/Users/s.konev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');const {chromium}=require('playwright');
const output=new URL('../outputs/eight-issues/weapons/',import.meta.url).pathname;
const scenarios=JSON.parse(fs.readFileSync(output+'support-scenarios.json'));const r=new Room('SCREEN',()=>{});r.addPlayer(1,'Поддержка','herald');r.addPlayer(2,'Союзник','ranger');r.start();r.time=110;r.enemies=[];
const h=r.heroes.get(1);h.support=scenarios.find(s=>s.players===2).support;h.dmg=scenarios[1].ownDamage;h.supportDamage=h.support.allyDamage;h.weapons=new Map([['tocsin',{lvl:1,t:0}],['stormlight',{lvl:1,t:0}],['frost',{lvl:3,t:0}]]);
const log=r.runLog.build(r,false),card=r.runLog.card(r,log),snapshot=r.snapshot();fs.writeFileSync(output+'support-run-card.json',JSON.stringify({log,card},null,2));
const html=fs.readFileSync(new URL('../app/public/index.html',import.meta.url),'utf8').replace('<script type="module" src="/js/main.js"></script>','');
const browser=await chromium.launch({args:['--mute-audio']});const evidence=[];
try{for(const mobile of [false,true]){
 const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/support-fixture',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('http://127.0.0.1:4631/support-fixture');
 const hud=await page.evaluate(async({snapshot})=>{
  const {Game}=await import('/js/game.js'),{UI}=await import('/js/ui.js');const g=new Game({send(){}});g.me=1;g.begin({players:[{pid:1,hero:'herald',name:'Поддержка',x:0,y:0},{pid:2,hero:'ranger',name:'Союзник',x:10,y:0}]});g.onSnapshot(snapshot);g.view.tm=110;g.view.b=g.latest();g.view.a=g.latest();
  for(const e of document.querySelectorAll('.screen'))e.hidden=true;document.getElementById('connecting').hidden=true;document.getElementById('hud').hidden=false;
  const ui=new UI();ui.modeText='Изолированный сценарий поддержки';ui.updateHud(g);const el=document.getElementById('hud-support');return {text:el.textContent,bounds:el.getBoundingClientRect().toJSON(),viewport:innerWidth};
 },{snapshot});
 await page.screenshot({path:output+`support-${mobile?'mobile':'desktop'}-hud.png`});
 await page.evaluate(async({card})=>{const {renderResults}=await import('/js/results.js');document.getElementById('hud').hidden=true;document.getElementById('screen-over').hidden=false;document.getElementById('over-title').textContent='Вклад поддержки';renderResults(document.getElementById('over-card'),card,1,new Map());},{card});
 await page.getByText('Поддержка: лечение', {exact:false}).scrollIntoViewIfNeeded();
 await page.screenshot({path:output+`support-${mobile?'mobile':'desktop'}-results.png`,fullPage:true});evidence.push({mobile,hud,errors});await ctx.close();
}fs.writeFileSync(output+'browser-support.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}finally{await browser.close();}
