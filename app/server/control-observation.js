// Read-only contribution observers. They never advance AI, mutate an actor or draw RNG.
import {PLAYER_RADIUS} from '../public/shared/content.js';
import {OUTPOST} from './outposts.js';
export function projectControlPoint(e,x,y) {
 if(e.outpost){const p=e.outpost,dx=x-p.x,dy=y-p.y,d=Math.hypot(dx,dy);if(d>OUTPOST.leash){x=p.x+dx/d*OUTPOST.leash;y=p.y+dy/d*OUTPOST.leash;}}
 return [x,y];
}
export const controlPointDiffers=(x,y,p)=>Math.abs(x-p[0])>1e-9||Math.abs(y-p[1])>1e-9;
export const controlScale=(e,now)=>(e.slowT>now?1-e.slow:1)*(e.dragT>now?1-e.drag:1);
const moved=(e,x,y,grid,radius,limit)=>{const a=projectControlPoint(e,e.x,e.y),b=grid?projectControlSeparation(grid,e,x,y,radius,limit):projectControlPoint(e,x,y);return b!==null&&controlPointDiffers(a[0],a[1],b);};

// A lock can prevent locomotion or an available action. Contact root does not stop
// ordinary body damage; freeze does. Pending actions are inspected, never replayed.
export function lockDelivered(e,target,alive,now,dt,speedMul,grid,radius,limit) {
 if(e.frozenT>now&&e.dmg>0&&!(e.immuneT>now)&&e.ai!=='exploder'&&alive.some(h=>h.st===0&&h.iframes<=dt&&(h.x-e.x)**2+(h.y-e.y)**2<(e.r+PLAYER_RADIUS)**2))return true;
 let dx=target.x-e.x,dy=target.y-e.y;const d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;
 const E=e.def,keep=e.outpost&&e.ai==='sniper'?OUTPOST.sniperKeep:E.keep;
 if(e.ai==='shield'){
  if((['aim','dash','rest'].includes(e.bs)&&e.bt>0)||(e.dcd<=dt&&d<=E.trigger&&d>=e.r))return true;
  let angle=Math.atan2(dy,dx)-e.fa;while(angle>Math.PI)angle-=Math.PI*2;while(angle<-Math.PI)angle+=Math.PI*2;
  if(Math.min(Math.abs(angle),E.turn*dt)>1e-9)return true; // Suppressed turn changes frontal defense even at contact.
 }
 if(e.ai==='exploder'&&e.fuseT>0)return true;
 if(e.ai==='ranged'&&(e.windT>0||(e.shotT<=dt&&d<E.keep[1]+80)))return true;
 if(e.ai==='sniper') {
  if(e.windT>0)return e.windT<=dt; // Its locked telegraph still ages; only release is suppressed.
  if(e.shotT<=dt&&d<keep[1]+150&&!(e.aimAfter>now))return true;
 }
 let speed=(e.slowT>now?e.speed*(1-e.slow):e.speed)*speedMul;
 if(e.dragT>now)speed*=1-e.drag;
 let maxStep=Math.max(0,d-e.r-PLAYER_RADIUS+2);
 if(e.ai==='ranged'||e.ai==='sniper') {
  if(d<keep[0]){dx=-dx;dy=-dy;maxStep=Infinity;}
  else if(d<=keep[1]){const s=Math.sin(e.phase+(e.ai==='sniper'?now*.4:0))>=0?1:-1;[dx,dy]=[-dy*s,dx*s];speed*=e.ai==='sniper'?.4:.5;}
 } else if(e.ai==='flee') {
  const side=Math.floor((now-e.born)/E.turn+e.phase)%2?1:-1,showing=now-e.born<E.show,out=showing?0:d<E.near?1.2:d>E.far?-.8:.2;
  if(showing)speed*=E.showSpeed;
  [dx,dy]=[-dy*side-dx*out,dx*side-dy*out];const l=Math.hypot(dx,dy)||1;dx/=l;dy/=l;maxStep=Infinity;
 }
 if(e.zig){const s=Math.sin(now*5+e.phase)*.9,zx=dx-dy*s,zy=dy+dx*s,l=Math.hypot(zx,zy)||1;dx=zx/l;dy=zy/l;}
 const step=Math.min(speed*dt,maxStep);return moved(e,e.x+dx*step,e.y+dy*step,grid,radius,limit);
}

// Read the same bucket order and candidate limit as Grid.query/separation, but
// project local numbers only. Never touch shared query arrays, actors or caches.
// A coincident overlap requires an unobserved RNG draw: null means unresolved,
// not proof of no effect, and is conservatively not credited.
export function projectControlSeparation(grid,e,x,y,radius,limit) {
 const x0=Math.floor((x-radius)*grid.inv),x1=Math.floor((x+radius)*grid.inv),y0=Math.floor((y-radius)*grid.inv),y1=Math.floor((y+radius)*grid.inv);
 let checked=0;
 for(let cx=x0;cx<=x1;cx++)for(let cy=y0;cy<=y1;cy++){
  const key=(Math.max(-32000,Math.min(32000,cx))+32768)*65536+(Math.max(-32000,Math.min(32000,cy))+32768);
  const bucket=grid.cells.get(key);if(!bucket)continue;
  for(const o of bucket){
   if(checked>=limit)return projectControlPoint(e,x,y);
   if(o===e)continue;
   const ox=x-o.x,oy=y-o.y,min=e.r+o.r,dd=ox*ox+oy*oy;
   if(dd>=min*min)continue;
   checked++;if(dd<.0001)return null;
   const length=Math.sqrt(dd),push=(min-length)*.5*(o.r/(e.r+o.r))*2;
   x+=(ox/length)*push*.5;y+=(oy/length)*push*.5;
  }
 }
 return projectControlPoint(e,x,y);
}
