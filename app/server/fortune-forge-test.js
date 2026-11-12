import assert from 'node:assert/strict';
import { Room } from './game.js';
import { passiveValue, passiveStep, weaponMaxLevel, MAX_LEVEL } from '../public/shared/content.js';

const rnd = (value, f) => { const old = Math.random; Math.random = () => value; try { return f(); } finally { Math.random = old; } };
function setup(weapons, passives = []) {
	const sent = [];
	const r = new Room('FORGE', (pid, msg) => sent.push([pid, msg]));
	r.addPlayer(1, 'Smith', 'knight'); r.start();
	const h = r.heroes.get(1);
	h.weapons = new Map(weapons.map(([id, lvl]) => [id, { lvl, t: 0.3 }]));
	h.passives = new Map(passives); r.recalcMods(h);
	return { r, h, sent };
}
const pick = (r, h) => { h.offer = [{ id: 'forge', kind: 'rare' }]; r.onPick(h.pid, { i: 0 }); };

{
	const { r, h, sent } = setup([['whip', 1], ['bolt', 2], ['aura', 5]]);
	const rerolls = h.rerolls;
	rnd(0, () => pick(r, h));
	assert.equal(h.weapons.get('whip').lvl + h.weapons.get('bolt').lvl, 4, 'one random item receives exactly one level');
	assert.equal(h.rerolls, rerolls + 1, 'a legendary weapon reforge grants one reroll');
	const msg = sent.findLast(([, m]) => m.t === 'reforge')?.[1];
	assert.ok(msg?.result?.name && msg.result.from === 1 && msg.result.to === 2, 'visible exact result');
	assert.equal(r.runLog.p.get(h.pid).reforges.length, 1, 'reforge outcome retained in the run log');
}
for (const [id, value] of [['might', 0.26], ['vigor', 53]]) {
	const { r, h } = setup([['whip', 5]], [[id, 2], ['echo', 1], ['coil', 1], ['ashseal', 1]]);
	assert.equal(passiveStep(id, 3), value);
	h.pval[id] = 0.123; r.recalcMods(h);
	if (id === 'vigor') { h.st = 1; h.hp = 0; }
	pick(r, h);
	assert.equal(h.passives.get(id), 3, 'artifact receives one level');
	assert.equal(h.pval[id], 0.123 + value, 'keeps accumulated rarity value and adds legendary step');
	assert.equal(h.passives.get('echo'), 1, 'noRarity is excluded');
	if (id === 'vigor') assert.equal(h.hp, 0, 'does not revive downed heroes');
}
{
	const { r, h } = setup([['whip', 5]], [['might', 1]]);
	pick(r, h);
	assert.equal(h.pval.might, passiveValue('might', 1) + passiveStep('might', 3), 'legacy pval baseline');
}
{
	const { r, h } = setup([['whip', 5]], [['echo', 1], ['might', MAX_LEVEL]]);
	for (let i = 0; i < 100; i++) assert.ok(!rnd(0, () => r.makeChoices(h)).some(c => c.id === 'forge'), 'empty pool is not offered');
}
{
	const { r, h } = setup([['whip', 4]], [['might', 4]]);
	h.offer = [{ id: 'might', kind: 'passive', name: 'Сила', level: 5, rar: 3, val: passiveStep('might', 3) }];
	rnd(0.99, () => r.legendaryReforge(h, 'outposts'));
	assert.equal(h.passives.get('might'), 5);
	assert.ok(!h.offer.some(c => c.kind === 'passive' && c.id === 'might'), 'external reforge replaces a capped pending card');
	const before = h.pval.might;
	h.offer = [{ id: 'might', kind: 'passive', level: 5, val: passiveStep('might', 3) }];
	r.onPick(h.pid, { i: 0 });
	assert.equal(h.pval.might, before, 'stale capped cards never add value twice');
	assert.ok([...h.weapons].every(([id, w]) => w.lvl <= weaponMaxLevel(id)));
}

{
 const {r,h,sent}=setup([['whip',1]],[['might',1]]);
 h.rerolls=0;
 h.offer=[{id:'might',kind:'passive',rar:0,val:passiveStep('might'),level:2}];
 rnd(0,()=>r.legendaryReforge(h,'outposts'));
 assert.equal(sent.findLast(([,m])=>m.t==='lvl')?.[1].rerolls,1,'reward reroll appears even when the open offer upgraded another item');
 assert.equal(h.offer[0].id,'might','unaffected cards stay available');
}

{
 const {r,h,sent}=setup([['whip',4]]);
 r.legendaryReforge(h,'forge');assert.ok(h.lastReforge.result);
 r.legendaryReforge(h,'outposts');assert.equal(h.lastReforge.result,null,'empty reward replaces an older successful receipt');
 r.resync(h.pid);
 const receipt=sent.findLast(([,m])=>m.t==='reforge')[1];
 assert.equal(receipt.source,'outposts');assert.equal(receipt.result,null,'reconnect repeats the latest empty outcome');
}
console.log('Fortune forge: one legendary item, rarity values, exclusions, stale offers and result: OK');
