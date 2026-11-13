import { ENEMIES, PLAYER_RADIUS, enemyHpScale, spawnRateScale } from '../public/shared/content.js';
import { randomUUID } from 'node:crypto';
import {
	HORDE_ARENA, HORDE_BOSS_AT, HORDE_BOSS_TYPE, HORDE_ECONOMY, HORDE_LIMITS, HORDE_PACKS, HORDE_UPGRADE,
	HORDE_BUILD, HORDE_WEAPONS, HORDE_ARTIFACTS, hordeSynergies, hordeCardDef, clampHordePosition,
} from '../public/shared/horde-content.js';

const PACK_RADIUS = 64;
const PRIVATE_EVERY = 0.5;
const AMBIENT_PRESSURE = 0.45; // The director replaces most of the automatic pressure.

// Run-local state: retaining a Room over a reconnect also retains its wallet, queue and sequence.
export class HordeMode {
	constructor(room) {
		this.room = room;
		this.resource = HORDE_ECONOMY.start;
		this.lastSeq = 0;
		this.build = { packs: { swarm: 1 }, weapons: {}, artifacts: {} };
		this.rank = 1;
		this.picksTaken = 0;
		this.rerolls = HORDE_BUILD.rerolls;
		this.offerPrefix = randomUUID();
		this.offerNo = 0;
		this.offer = null;
		this.picks = [];
		this.rerollHistory = [];
		this.pending = [];
		this.nextPrivate = 0;
		this.bossSpawned = false;
		this.bossKilled = false;
		this.ensureOffer();
	}

	get levels() { return this.build.packs; }
	get resourceCap() { return HORDE_ECONOMY.cap + 20 * (this.build.artifacts.supply ?? 0); }
	get choicesPending() { return this.rank - this.picksTaken; }
	get nextRankAt() { return this.rank < HORDE_BUILD.maxPicks ? this.rank * HORDE_BUILD.rankEvery : null; }

	snapshotBuild() {
		return Object.freeze(Object.fromEntries(Object.entries(this.build).map(([kind, levels]) => [kind, Object.freeze({ ...levels })])));
	}

	packCost(pack) { return Math.ceil(pack.cost * (1 - 0.05 * (this.build.artifacts.supply ?? 0))); }
	packUnits(pack) { return [...pack.units, ...Array(this.build.artifacts.brood ?? 0).fill(pack.units[0])]; }

	candidates() {
		const out = [];
		for (const [kind, defs, key, slots, max] of [
			['pack', HORDE_PACKS, 'packs', HORDE_BUILD.packSlots, HORDE_BUILD.packMax],
			['weapon', HORDE_WEAPONS, 'weapons', HORDE_BUILD.weaponSlots, HORDE_BUILD.weaponMax],
			['artifact', HORDE_ARTIFACTS, 'artifacts', HORDE_BUILD.artifactSlots, HORDE_BUILD.artifactMax],
		]) {
			const owned = this.build[key], full = Object.keys(owned).length >= slots;
			for (const def of Object.values(defs)) {
				const level = owned[def.id] ?? 0;
				if (level >= max || (!level && (full || (def.at ?? 0) > this.room.time))) continue;
				out.push({ kind, id: def.id, level: level + 1 });
			}
		}
		return out;
	}

	makeOffer() {
		const pool = this.candidates(), choices = [];
		const tags = new Set();
		for (const [kind, key] of [['pack', 'packs'], ['weapon', 'weapons'], ['artifact', 'artifacts']]) {
			for (const id of Object.keys(this.build[key])) for (const tag of hordeCardDef(kind, id).tags ?? []) tags.add(tag);
		}
		const choose = (list) => {
			const weights = list.map((c) => 1 + (hordeCardDef(c.kind, c.id).tags ?? []).filter((tag) => tags.has(tag)).length * 0.8);
			let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
			return list.find((_, i) => (roll -= weights[i]) <= 0) ?? list[list.length - 1];
		};
		const upgrades = pool.filter((c) => c.level > 1);
		if (upgrades.length) choices.push(choose(upgrades));
		while (choices.length < 3) {
			const remaining = pool.filter((c) => !choices.includes(c));
			if (!remaining.length) break;
			choices.push(choose(remaining));
		}
		for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [choices[i], choices[j]] = [choices[j], choices[i]]; }
		return choices.length ? Object.freeze({ id: `${this.offerPrefix}:${++this.offerNo}`, choices: Object.freeze(choices.map((c) => Object.freeze(c))) }) : null;
	}

	ensureOffer() { if (!this.offer && this.choicesPending > 0) this.offer = this.makeOffer(); }

	pick(msg) {
		if (!this.offer || msg.offerId !== this.offer.id) return 'Этот выбор уже устарел';
		if (!Number.isInteger(msg.choice) || !this.offer.choices[msg.choice]) return 'Выберите одну из предложенных карт';
		const choice = this.offer.choices[msg.choice];
		if (!this.candidates().some((c) => c.kind === choice.kind && c.id === choice.id && c.level === choice.level)) return 'Эта карта больше не доступна';
		const key = { pack: 'packs', weapon: 'weapons', artifact: 'artifacts' }[choice.kind];
		this.build[key][choice.id] = choice.level;
		this.picks.push({ time: this.room.time, offerId: this.offer.id, ...choice });
		this.picksTaken++;
		this.offer = null;
		this.ensureOffer();
		return null;
	}

	reroll(msg) {
		if (!this.offer || msg.offerId !== this.offer.id) return 'Этот выбор уже устарел';
		if (this.rerolls <= 0) return 'Перебросы закончились';
		this.rerollHistory.push({ time: this.room.time, offerId: this.offer.id });
		this.rerolls--;
		this.offer = this.makeOffer();
		return null;
	}

	counts() {
		let manual = 0, ambient = 0, total = 0;
		for (const e of this.room.enemies) {
			if (e.dead) continue;
			total++;
			if (e.hordeSource === 'manual') manual++;
			else if (!e.boss) ambient++;
		}
		const reserved = this.pending.reduce((n, p) => n + p.units.length, 0);
		return { manual, ambient, total, reserved };
	}

	privateState() {
		const { manual, reserved } = this.counts();
		const room = this.room;
		return {
			t: 'horde', resource: Math.floor(this.resource), resourceCap: this.resourceCap,
			income: HORDE_ECONOMY.perSecond, lastSeq: this.lastSeq,
			population: manual + reserved, populationCap: HORDE_LIMITS.manual, queued: this.pending.length,
			levels: { ...this.levels }, arena: HORDE_ARENA, build: this.snapshotBuild(), rank: this.rank,
			nextRankAt: this.nextRankAt, choicesPending: this.choicesPending, offer: this.offer, rerolls: this.rerolls,
			synergies: hordeSynergies(this.build).map((s) => s.id),
			packs: Object.keys(this.build.packs).map((id) => ({
				id, cost: this.packCost(HORDE_PACKS[id]), available: room.time >= HORDE_PACKS[id].at,
				count: this.packUnits(HORDE_PACKS[id]).length, level: this.build.packs[id],
			})),
			pending: this.pending.map((p) => ({ x: p.x, y: p.y, remaining: Math.max(0, p.at - room.time), pack: p.pack })),
		};
	}

	sendState() {
		if (this.room.directorPid !== null) this.room.send(this.room.directorPid, this.privateState());
		this.nextPrivate = this.room.time + PRIVATE_EVERY;
	}

	handle(msg) {
		let error = null;
		if (!Number.isSafeInteger(msg.seq) || msg.seq <= 0) error = 'Неверный номер команды орды';
		else if (msg.seq <= this.lastSeq) { this.sendState(); return; }
		else if (msg.seq !== this.lastSeq + 1) error = 'Нарушен порядок команд орды';
		else {
			// Failed commands are acknowledged too: a retried command cannot buy later at a different price.
			this.lastSeq = msg.seq;
			if (msg.action === 'pick') error = this.pick(msg);
			else if (msg.action === 'reroll') error = this.reroll(msg);
			else if (msg.action === 'spawn') {
				const pack = typeof msg.pack === 'string' && Object.hasOwn(HORDE_PACKS, msg.pack) ? HORDE_PACKS[msg.pack] : null;
				error = pack ? this.buy(pack, msg.x, msg.y) : 'Неизвестный отряд';
			}
			else error = 'Неизвестная команда орды';
		}
		if (error) this.room.send(this.room.directorPid, { t: 'err', msg: error });
		this.sendState();
	}

	alive() { return [...this.room.heroes.values()].filter((h) => h.st === 0); }

	inside(x, y, padding = 0) {
		return x >= HORDE_ARENA.minX + padding && x <= HORDE_ARENA.maxX - padding
			&& y >= HORDE_ARENA.minY + padding && y <= HORDE_ARENA.maxY - padding;
	}

	buy(pack, x, y) {
		if (!this.build.packs[pack.id]) return 'Сначала откройте этот отряд в прокачке';
		if (this.room.time < pack.at) return 'Этот отряд ещё не доступен';
		const cost = this.packCost(pack);
		if (this.resource < cost) return 'Недостаточно ресурса орды';
		if (this.pending.length >= HORDE_LIMITS.queued) return 'Очередь призыва заполнена';
		if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
			|| !this.inside(x, y, PACK_RADIUS + 24)) return 'Выберите точку внутри арены';
		const alive = this.alive();
		if (!alive.length) return 'На арене нет живых героев';
		const heroes = [...this.room.heroes.values()];
		const types = this.packUnits(pack);
		const units = types.map((type, i) => {
			const a = i / types.length * Math.PI * 2;
			return { type, x: x + Math.cos(a) * PACK_RADIUS, y: y + Math.sin(a) * PACK_RADIUS };
		});
		if (units.some((u) => !this.inside(u.x, u.y, ENEMIES[u.type].r) || heroes.some((h) => Math.hypot(h.x - u.x, h.y - u.y) < HORDE_LIMITS.spawnDistance))) {
			return 'Точка призыва слишком близко к герою';
		}
		const c = this.counts();
		if (c.manual + c.reserved + units.length > HORDE_LIMITS.manual
			|| c.total + c.reserved + units.length > HORDE_LIMITS.total) return 'Достигнут предел отрядов';
		this.resource -= cost;
		const delay = HORDE_LIMITS.warning + HORDE_LIMITS.preparation;
		this.pending.push({ pack: pack.id, level: this.levels[pack.id], build: this.snapshotBuild(), cost, x, y, units, at: this.room.time + delay });
		this.room.fx.push(['warn', Math.round(x), Math.round(y), PACK_RADIUS + 24, delay]);
		return null;
	}

	// Keeps the pressure reserve independent of manual purchases, so the director cannot starve hero XP.
	tick(dt, alive) {
		const room = this.room;
		while (this.nextRankAt !== null && room.time >= this.nextRankAt) this.rank++;
		this.ensureOffer();
		this.resource = Math.min(this.resourceCap, this.resource + dt * HORDE_ECONOMY.perSecond);
		const due = this.pending.filter((p) => p.at <= room.time);
		this.pending = this.pending.filter((p) => p.at > room.time);
		const heroes = [...room.heroes.values()];
		for (const p of due) {
			const c = this.counts();
			const unsafe = p.units.some((u) => !this.inside(u.x, u.y, ENEMIES[u.type].r)
				|| heroes.some((h) => Math.hypot(h.x - u.x, h.y - u.y) < HORDE_LIMITS.birthDistance));
			if (!alive.length || unsafe || c.manual + c.reserved + p.units.length > HORDE_LIMITS.manual
				|| c.total + c.reserved + p.units.length > HORDE_LIMITS.total) {
				this.resource = Math.min(this.resourceCap, this.resource + p.cost);
				room.send(room.directorPid, { t: 'err', msg: 'Призыв отменён: точка занята. Ресурс возвращён' });
				continue;
			}
			for (const u of p.units) {
				const e = room.spawnEnemy(u.type, alive, enemyHpScale(room.nt, room.heroes.size), [u.x, u.y]);
				e.hordeSource = 'manual'; e.hordePack = p.pack; e.hordeLevel = p.level;
				e.hordeBuild = p.build;
				e.hp *= 1 + HORDE_UPGRADE.hpPerLevel * (p.level - 1); e.maxHp = e.hp;
				e.dmg *= 1 + HORDE_UPGRADE.damagePerLevel * (p.level - 1); e.dmgMul *= 1 + HORDE_UPGRADE.damagePerLevel * (p.level - 1);
				e.hordeBarrier = e.maxHp * 0.12 * (p.build.artifacts.carapace ?? 0);
			}
		}
		if (alive.length) {
			if (!this.bossSpawned && room.time >= HORDE_BOSS_AT) {
				this.bossSpawned = true;
				const b = room.spawnBoss(HORDE_BOSS_TYPE, alive);
				b.hordeBoss = true;
			}
			this.ambient(dt, alive);
		}
		if (room.time >= this.nextPrivate || due.length) this.sendState();
	}

	ambient(dt, alive) {
		const room = this.room, wave = room.currentWave();
		const spawnN = Math.max(alive.length, room.heroes.size - 1);
		room.spawnAcc += wave.rate * spawnRateScale(spawnN) * AMBIENT_PRESSURE * dt;
		const c = this.counts();
		while (room.spawnAcc >= 1) {
			room.spawnAcc--;
			if (c.ambient >= HORDE_LIMITS.ambient || c.total + c.reserved >= HORDE_LIMITS.total) { room.spawnAcc = 0; break; }
			// Only ordinary families: specials, outposts, elites, peaks and invasions do not stack on manual pressure.
			const type = room.waveType(wave);
			const e = room.spawnEnemy(type, alive, enemyHpScale(room.nt, room.heroes.size));
			e.hordeSource = 'ambient';
			c.ambient++; c.total++;
		}
	}

	confine(entity, padding = entity.r ?? PLAYER_RADIUS) {
		const p = clampHordePosition(entity.x, entity.y, padding);
		entity.x = p.x; entity.y = p.y;
	}

	retireFar(alive) {
		for (const e of this.room.enemies) {
			if (e.dead || e.boss || !alive.length) continue;
			if (alive.every((h) => Math.hypot(e.x - h.x, e.y - h.y) > HORDE_LIMITS.retireDistance)) e.dead = true;
		}
	}
}
