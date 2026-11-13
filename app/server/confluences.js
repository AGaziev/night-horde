// Signature attacks use the same damage/status pipeline as the inherited weapons.
export function castConfluence(room, h, L, src, effect) {
  const damage = L.dmg * h.mods.dmgMul;
  if (effect === 'sonicShield') return room.tuningWave(h, L, damage, src);
  const range = (L.range ?? L.radius) * h.mods.areaMul;
  const center = room.densestPoints(h, 1, range)[0];
  if (!center) return false;
  if (effect.endsWith('Beam')) {
    const angle = Math.atan2(center.y-h.y,center.x-h.x), seen = new Set();
    // Spend the focused damage once, leaving side beams and every chain at their own budget.
    const focus=L.focusMul ? room.nearestEnemies(center.x,center.y,1,range)[0] : null;
    const nearby = room.grid.query(h.x,h.y,range+80,[]);
    const spread = [-0.34,0,0.34];
    for (let i=0;i<Math.min(2,h.mods.amount);i++) spread.push(i ? 0.6 : -0.6);
    for (const turn of spread) {
      const dx=Math.cos(angle+turn),dy=Math.sin(angle+turn);
      room.fx.push(['buildbeam',Math.round(h.x),Math.round(h.y),Math.round(h.x+dx*range),Math.round(h.y+dy*range)]);
      for(const e of nearby) {
        if(e.dead||seen.has(e))continue;
        const x=e.x-h.x,y=e.y-h.y,along=x*dx+y*dy;
        if(along<0||along>range||Math.abs(x*dy-y*dx)>L.width*h.mods.areaMul+e.r)continue;
        seen.add(e);room.hurtEnemy(e,damage*(e===focus ? L.focusMul : 1),h,src);
        if(e.dead)continue;
        if(effect==='resonanceBeam'){e.resonanceT=room.time+L.dur*h.mods.durMul;e.resonancePower=1.3;}
        if(effect==='markBeam' && (!(e.markT>room.time)||e.markMul<=L.mark)){
          e.markMul=L.mark;e.markT=room.time+L.dur*h.mods.durMul;e.markOwner=h;
        }
        if(effect==='shockBeam')room.strikeAt(h,e,damage*0.35,L.chain,src);
      }
    }
    return true;
  }
  if(effect==='choirWave') {
    const a=Math.atan2(center.y-h.y,center.x-h.x);
    room.coldWaves.push({owner:h,x:h.x,y:h.y,dx:Math.cos(a),dy:Math.sin(a),distance:0,range,
      width:L.radius*h.mods.areaMul,speed:420,dmg:damage,src,hit:new Set(),slow:0.45,
      dur:L.dur*h.mods.durMul,freeze:L.freeze*h.mods.ctrlMul*h.mods.durMul,resonance:1.4});
    room.fx.push(['coldwave',Math.round(h.x),Math.round(h.y),a,Math.round(range),Math.round(L.radius*h.mods.areaMul),420]);
    return true;
  }
  const radius=L.radius*h.mods.areaMul;
  room.anchorPull(h,L,damage,src);
  if(effect==='lensWell') {
    for(const e of room.nearestEnemies(center.x,center.y,L.count+h.mods.amount,radius*1.7)) {
      room.fx.push(['buildbeam',Math.round(center.x),Math.round(center.y),Math.round(e.x),Math.round(e.y)]);
      room.hurtEnemy(e,damage*0.55,h,src);
    }
  } else if(effect==='resonanceWell') {
	room.addPatch(h,center.x,center.y,radius,L.dur*h.mods.durMul,damage*0.4,L.tick,{...src,tags:['aoe']},0,'resonance-well',4,{resonance:1.3,zk:3});
  } else if(effect==='trapWell') {
    room.layTrap(h,{x:center.x,y:center.y,r:radius,dmg:damage,root:L.root*h.mods.ctrlMul*h.mods.durMul,
      splash:radius,rootTargets:4+h.mods.amount,uses:3,rearm:1.2*h.mods.cdMul,max:6,src});
  } else if(effect==='fireWell') {
    room.addPatch(h,center.x,center.y,radius,L.dur*h.mods.durMul,damage,L.tick,src,L.burn,'inferno',5,{burnDur:4});
  }
  return true;
}
