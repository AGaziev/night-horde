// Reproducible local performance probe. No platform key, external traffic, or production state.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const app = path.resolve(process.env.APP || new URL('../app', import.meta.url).pathname);
const runtimeSha=process.env.PERF_SHA||execFileSync('git',['-C',app,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const { Room } = await import(pathToFileURL(path.join(app, 'server/game.js')));
const { TICK_HZ, ENEMY_TYPES } = await import(pathToFileURL(path.join(app, 'public/shared/content.js')));
const { WebSocketServer } = await import(pathToFileURL(path.join(app, 'node_modules/ws/wrapper.mjs')));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/Users/s.konev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const seed = 44010;
let rng = seed;
Math.random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
const quantile = (a, q) => [...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*q))] || 0;
const stats = (a) => ({ n:a.length, mean:a.reduce((x,y)=>x+y,0)/(a.length||1), p50:quantile(a,.5), p95:quantile(a,.95), max:Math.max(0,...a) });
let room, socket, tickCost=[], snapCost=[], delivery=[], tickIntervals=[], previousTick=0;
const http = createServer((req,res) => {
	if(req.url === '/') { res.setHeader('Content-Type','text/html');res.end('<html><head><link rel="stylesheet" href="/style.css"></head><body><canvas id="game"></canvas></body></html>');return; }
	try { const file=path.join(app,'public',decodeURIComponent(req.url.split('?')[0]));const ext=path.extname(file);res.setHeader('Content-Type',ext==='.js'?'text/javascript':ext==='.css'?'text/css':ext==='.png'?'image/png':'application/octet-stream');res.end(readFileSync(file)); } catch {res.writeHead(404);res.end();}
});
const wss=new WebSocketServer({server:http});wss.on('connection',ws=>{socket=ws;ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.t==='pos')room?.handle(1,msg);});});
http.listen(Number(process.env.PORT)||34381,'127.0.0.1'); await new Promise(r=>http.once('listening',r));
const port=http.address().port;
const browser=await chromium.launch({headless:true,args:['--mute-audio']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/`);
await page.evaluate(async(ablation)=>{
	const {Game}=await import('/js/game.js');const {Renderer}=await import('/js/render.js');const {SnapshotDecoder}=await import('/js/snapshot-codec.js');
	const decoder=new SnapshotDecoder();const g=new Game({send(msg){if(ws.readyState===1)ws.send(JSON.stringify(msg));}});g.me=1;const renderer=new Renderer(document.getElementById('game'));
	window.probe={g,renderer,frames:[],updates:[],methods:{},arrivals:[],tms:[],latency:[],backwards:[],localX:[],move:false,start:0};
	for(const name of Object.getOwnPropertyNames(Renderer.prototype))if(name.startsWith('draw')||name==='updateMinimap'){
		const fn=renderer[name].bind(renderer);renderer[name]=(...args)=>{const a=performance.now();const result=fn(...args);(window.probe.methods[name]??=[]).push(performance.now()-a);return result;};
	}
	if(ablation==='enemies')renderer.drawEnemies=()=>{};
	if(ablation==='shadows'){
		const original=renderer.drawEnemies.bind(renderer);
		renderer.drawEnemies=(...args)=>{const fill=renderer.ctx.fill;let n=0;renderer.ctx.fill=function(...params){if(n++>0)return fill.apply(this,params);};try{return original(...args);}finally{renderer.ctx.fill=fill;}};
	}
	const ws=new WebSocket(`ws://${location.host}`);ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.t==='s'||msg.t==='k'||msg.t==='d'){
		const snap=decoder.decode(msg);if(snap){probe.arrivals.push(performance.now());probe.tms.push(snap.tm);probe.latency.push(Date.now()-msg.__at);const before=g.local.x;g.onSnapshot(snap);if(g.local.x<before-20)probe.backwards.push({before,after:g.local.x,at:performance.now(),tm:snap.tm});}
	}};
	let last=performance.now();function draw(now){const dt=Math.min(.05,(now-last)/1000);if(g.running){probe.frames.push(now-last);let a=performance.now();g.update(dt,{vector:()=>({x:probe.move?1:0,y:0})});probe.updates.push(performance.now()-a);renderer.draw(g,dt);probe.localX.push({at:now,x:g.local.x});}last=now;requestAnimationFrame(draw);}requestAnimationFrame(draw);
},process.env.PERF_ABLATION||'');
for(let i=0;i<100&&!socket;i++)await delay(10);
const interval=setInterval(()=>{
	if(!room)return;
	const now=performance.now();if(previousTick)tickIntervals.push(now-previousTick);previousTick=now;
	for(const h of room.heroes.values()){h.hp=h.maxHp;h.iframes=10;while(h.offer)room.handle(h.pid,{t:'skip'});}
	const t=performance.now();room.tick(1/TICK_HZ);tickCost.push(performance.now()-t);
},1000/TICK_HZ);
const results=[];
try{
	const planned=JSON.parse(process.env.PERF_CELLS||'null')||[1,4,8].flatMap(n=>['packed','spread'].flatMap(group=>['ranged','support'].flatMap(build=>[300,588].map(time=>({n,group,build,time})))));
	const cells=process.env.PERF_TIME?planned.filter(c=>c.time===Number(process.env.PERF_TIME)):planned;
	for(const cell of cells){
		rng=seed;tickCost=[];snapCost=[];delivery=[];tickIntervals=[];previousTick=0;
		room=new Room('PERF',(pid,msg,json)=>{if(pid===1&&msg.t==='s'&&socket?.readyState===1){const data=json??JSON.stringify(msg);delivery.push({at:performance.now(),tm:msg.tm,bytes:Buffer.byteLength(data)});const envelope=JSON.parse(data);envelope.__at=Date.now();setTimeout(()=>{if(socket?.readyState===1)socket.send(JSON.stringify(envelope));},Number(process.env.NETWORK_DELAY_MS)||0);}});
		room.setMode('lunch');for(let i=0;i<cell.n;i++)room.addPlayer(i+1,'P'+(i+1),i%2?'herald':'knight');room.start();
		room.time=cell.time;room.events.next=Infinity;room.bossIdx=room.bossAt.length-1;room.nextEliteT=room.nextInvasionT=Infinity;
		const heroes=[...room.heroes.values()];
		for(let i=0;i<heroes.length;i++){const h=heroes[i];h.x=cell.group==='spread'?i*1800:i*30;h.y=0;h.weapons=new Map((cell.build==='ranged'?['bolt','lightning','flask','orbit']:['aura','lantern','ward','frost']).map(id=>[id,{lvl:5,t:0}]));h.passives=new Map([['area',3],['haste',3]]);room.recalcMods(h);}
		if(cell.time>=room.finPlan.lord){room.startFinale(heroes);room.finaleLord(heroes,room.bossAt.length-1);room.fin.lord.hp=room.fin.lord.maxHp=10000000;room.bossIdx=room.bossAt.length;room.fin.fightAt=room.finPlan.lord;room.fin.lord.immuneT=room.time-1;}
		const types=['ghoul','skel','brute','spitter','sniper'];for(let i=0;i<(cell.time>=540?90:450);i++){const e=room.spawnEnemy(types[i%types.length],heroes,1);const h=heroes[i%heroes.length];const a=i*2.399963;e.x=h.x+Math.cos(a)*(160+i%500);e.y=h.y+Math.sin(a)*(160+i%500);e.hp=e.maxHp=100000;}
		room.rebuildGrid();const original=room.snapshot.bind(room);room.snapshot=()=>{const t=performance.now();const s=original();snapCost.push(performance.now()-t);return s;};
		await page.evaluate(({heroes,cell,move})=>{probe.g.begin({players:heroes});probe.frames=[];probe.updates=[];probe.methods={};probe.arrivals=[];probe.tms=[];probe.latency=[];probe.backwards=[];probe.localX=[];probe.move=move;}, {heroes:heroes.map(h=>({pid:h.pid,name:h.name,hero:h.hero,x:h.x,y:h.y})),cell,move:process.env.MOVE==='1'});
		await delay(Number(process.env.PERF_DURATION_MS)||2500);
		const client=await page.evaluate(()=>{const p=probe;const out={frames:p.frames,updates:p.updates,methods:p.methods,arrivals:p.arrivals,tms:p.tms,entities:p.g.latest()?.e.length/6,dpr:p.renderer.dpr,latency:p.latency,backwards:p.backwards,localX:p.localX};p.g.stop();return out;});
		const gaps=client.arrivals.slice(1).map((x,i)=>x-client.arrivals[i]);
		const result={...cell,serverTick:stats(tickCost),serverInterval:stats(tickIntervals),snapshot:stats(snapCost),networkGap:stats(gaps),frame:stats(client.frames),update:stats(client.updates),draw:stats(client.methods.draw||[]),methods:Object.fromEntries(Object.entries(client.methods).map(([k,v])=>[k,stats(v)])),entities:client.entities,dpr:client.dpr,networkLatency:stats(client.latency),backwards:client.backwards,movement:client.localX,snapshots:delivery.length,bytes:stats(delivery.map(x=>x.bytes)),drops:client.tms.slice(1).filter((x,i)=>x-client.tms[i]>.15).length};
		results.push(result);room=null;console.log(JSON.stringify({...cell,tickP95:result.serverTick.p95,frameP95:result.frame.p95,drawP95:result.draw.p95,gapP95:result.networkGap.p95,entities:result.entities}));
	}
}finally{clearInterval(interval);await browser.close();wss.close();await new Promise(r=>http.close(r));}
const output={sha:runtimeSha,node:process.version,seed,ablation:process.env.PERF_ABLATION||null,at:new Date().toISOString(),viewport:'1440x900@2x Chromium headless --mute-audio',results,errors};
if(process.env.OUTPUT){mkdirSync(path.dirname(process.env.OUTPUT),{recursive:true});writeFileSync(process.env.OUTPUT,JSON.stringify(output,null,2)+'\n');}
console.log(JSON.stringify({sha:output.sha,cells:results.length,errors}));
