// Actual contribution, never hypothetical damage inferred from control duration.
export const newSupport = () => ({ healing: 0, blocked: 0, control: 0, allyDamage: 0 });
export const supportStats = h => Object.fromEntries(Object.entries(h?.support ?? newSupport()).map(([k,v])=>[k,Math.round(v*10)/10]));
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
export function controlTick(e, now, dt) {
 // Priority resolves overlap once per enemy per simulation tick, not once per caster.
 const owner=e.frozenT>now?e.frozenOwner:e.rootT>now?e.rootOwner:e.slowT>now&&e.slow>0?e.slowOwner:null;
 if(owner)owner.support.control+=dt;
}
