// Actual contribution, never hypothetical damage inferred from control duration.
export const newSupport = () => ({ healing: 0, blocked: 0, control: 0, allyDamage: 0 });
export const supportStats = h => Object.fromEntries(Object.entries(h?.support ?? newSupport()).map(([k,v])=>[k,Math.round(v*10)/10]));
// A grant made by an earlier server phase cannot absorb a contact before its birth.
// Legacy in-memory tokens without a birth field keep their existing expiry contract.
export const canReceiveWardGift = (owner,h,range) => h!==owner && h.st===0 && !h.offline && h.ward<Math.max(h.wardMax,1) && (h.x-owner.x)**2+(h.y-owner.y)**2<=range*range;
const acceptPendingGift = (h,gift,pending) => (!gift || gift.until<=pending.grantedAt) && canReceiveWardGift(pending.owner,h,pending.range) ? pending : gift;
export function activeWardGift(h, at) {
 let gift=h.sharedWard;
 for(const pending of h.pendingWardGifts??[]){if(pending.grantedAt>at)break;gift=acceptPendingGift(h,gift,pending);}
 return gift && (gift.grantedAt??-Infinity)<=at && at<gift.until ? gift : null;
}
export function deferWardGift(h, gift) {
 (h.pendingWardGifts??=[]).push(gift);
 h.pendingWardGifts.sort((a,b)=>a.grantedAt-b.grantedAt);
}
export function expireWardGift(h, at) {
 // A later AI eligibility check may already have materialized this reservation.
 if(h.sharedWard?.grantedAt>at){deferWardGift(h,h.sharedWard);h.sharedWard=null;}
 const pending=h.pendingWardGifts;
 while(pending?.length && pending[0].grantedAt<=at)h.sharedWard=acceptPendingGift(h,h.sharedWard,pending.shift());
 if(pending?.length===0)h.pendingWardGifts=null;
 if(h.sharedWard?.until <= at)h.sharedWard=null;
 return activeWardGift(h,at);
}
export function healSupport(room, owner, target, amount, field = false) {
 if(!owner || target.st !== 0 || target.offline || amount <= 0) return 0;
 if(field) {
  const second=Math.floor(room.time);
  if(target.fieldHealSecond !== second){target.fieldHealSecond=second;target.fieldHealAmount=0;}
  amount=Math.min(amount,Math.max(0,6-target.fieldHealAmount));
 }
 const healed=Math.min(amount,Math.max(0,target.maxHp-target.hp));target.hp+=healed;
 if(field)target.fieldHealAmount+=healed;
 owner.support.healing+=healed;return healed;
}
export function controlTick(e, now, dt, applied = 'movement', credited = null) {
 // The caller selects an AI branch that actually uses this control; status alone earns nothing.
 if(credited?.has(e))return;
 const owner=applied==='lock'
  ? (e.frozenT>now?e.frozenOwner:e.rootT>now?e.rootOwner:null)
  : (e.slowT>now&&e.slow>0?e.slowOwner:e.dragT>now&&e.drag>0?e.dragOwner:null);
 if(owner){owner.support.control+=dt;credited?.add(e);}
}

// Keep each owner's active strength/lifetime instead of lending a stronger
// effect another caster's expiry. Equal strengths from one owner can coalesce.
export function timedControl(e, kind, strength, duration, owner, now) {
 const field=kind+'Sources';
 if(!e[field]) {
  e[field]=new Map();
  if(e[kind+'T']>now && e[kind]>0)e[field].set(`${e[kind+'Owner']?.pid??0}:${e[kind]}`,{strength:e[kind],until:e[kind+'T'],owner:e[kind+'Owner']});
 }
 const key=`${owner?.pid??0}:${strength}`,old=e[field].get(key);
 e[field].set(key,{strength,until:Math.max(old?.until??0,now+duration),owner});
 resolveControl(e,kind,now);
}
export function resolveControl(e, kind, now) {
 const sources=e[kind+'Sources'];if(!sources)return;
 let best=null;
 for(const [key,source] of sources) {
  if(source.until<=now){sources.delete(key);continue;}
  if(!best || source.strength>best.strength || (source.strength===best.strength && source.until>best.until))best=source;
 }
 e[kind]=best?.strength??0;e[kind+'T']=best?.until??0;e[kind+'Owner']=best?.owner??null;
}
