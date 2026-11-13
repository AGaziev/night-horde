// Real block/heal events for defensive signatures and their separate components.
const APP=process.env.APP??new URL('../app',import.meta.url).pathname;
const {Room}=await import(APP+'/server/game.js');const {DUOS}=await import(APP+'/public/shared/content.js');
const ids=Object.keys(DUOS).filter(id=>DUOS[id].parts.includes('ward')||id==='censer');const rows=[];
for(const id of ids)for(const setup of ['parts','fusion']) {
 const r=new Room('DEF',()=>{});r.addPlayer(1,'Support','knight');r.addPlayer(2,'Ally','ranger');r.start();r.time=100;r.enemies=[];
 const h=r.heroes.get(1),ally=r.heroes.get(2);Object.assign(h,{x:0,y:0,hp:1000,maxHp:1000});Object.assign(ally,{x:0,y:0,hp:500,maxHp:1000});h.perk.readyAt=ally.perk.readyAt=Infinity;
 h.weapons=new Map((setup==='fusion'?[[id,1]]:DUOS[id].parts.map(p=>[p,3])).map(([w,lvl])=>[w,{lvl,t:0}]));
 const e=r.spawnEnemy('brute',[h],1);Object.assign(e,{x:50,y:0,hp:1e9,maxHp:1e9,speed:0,dmg:0});let incoming=0;
 for(let frame=0;frame<900;frame++){
  r.time+=1/30;r.rebuildGrid();h.x=Math.sin(frame/30)*12;h.movedT=r.time;
  for(const [w,state] of h.weapons)r.updateWeapon(h,w,state,1/30);
  r.updateProjectiles(1/30);r.updatePuddles(1/30);r.updateTimers();
  if(frame%30===29){h.iframes=0;r.hurtPlayer(h,10,'bench');incoming+=10;}
  r.fx=[];
 }
 rows.push({id,setup,incoming,lostHP:1000-h.hp,blocked:incoming-(1000-h.hp),healed:ally.hp-500,damage:Math.round(h.dmg)});
}
console.log(JSON.stringify({runtime:process.version,seconds:30,rows},null,2));
