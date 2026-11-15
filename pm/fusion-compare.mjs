// Same harness runs baseline and candidate via APP. No victory-rate claim from immortal dummies.
process.env.NO_MAIN='1';
const {avg,DUOS}=await import('./duo-bench.mjs');
const rows=[];
for(const [id,d] of Object.entries(DUOS)){
 const [a,b]=d.parts,values={};
 for(const layout of ['target','crowd','boss']) {
  values[layout]={};
  for(const [level,part] of [[1,3],[3,5]]) {
   const free=['bolt','knives','aura'].find(w=>!d.parts.includes(w));
   const sets={singleA:[[a,part]],singleB:[[b,part]],two:[[a,part],[b,part]],fusion:[[id,level]],freeSlot:[[id,level],[free,part]]};
   values[layout][level]=Object.fromEntries(Object.entries(sets).map(([k,w])=>[k,Math.round(avg(w,layout))]));
   values[layout][level].freeWeapon=free;
  }
 }
 rows.push({id,parts:d.parts,values});
}
console.log(JSON.stringify({runtime:process.version,APP:process.env.APP??'app',seconds:+(process.argv[2]??40),rows},null,2));
