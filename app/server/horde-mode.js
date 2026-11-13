import { ENEMIES, PLAYER_RADIUS, enemyHpScale, spawnRateScale } from '../public/shared/content.js';
import {
	HORDE_ARENA, HORDE_BOSS_AT, HORDE_BOSS_TYPE, HORDE_ECONOMY, HORDE_LIMITS, HORDE_PACKS, HORDE_UPGRADE,
	clampHordePosition, hordeUpgradePrice,
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
		this.levels = Object.fromEntries(Object.keys(HORDE_PACKS).map((id) => [id, 0]));
		this.pending = [];
		this.nextPrivate = 0;
		this.bossSpawned = false;
		this.bossKilled = false;
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
			t: 'horde', resource: Math.floor(this.resource), resourceCap: HORDE_ECONOMY.cap,
			income: HORDE_ECONOMY.perSecond, lastSeq: this.lastSeq,
			population: manual + reserved, populationCap: HORDE_LIMITS.manual, queued: this.pending.length,
			levels: { ...this.levels }, arena: HORDE_ARENA,
			packs: Object.values(HORDE_PACKS).map((p) => ({
				id: p.id, cost: p.cost, available: room.time >= p.at,
				upgradeCost: hordeUpgradePrice(this.levels[p.id]),
				upgradeAt: HORDE_ECONOMY.upgradeAt[this.levels[p.id]] ?? null,
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
		else {
			// Failed commands are acknowledged too: a retried command cannot buy later at a different price.
			this.lastSeq = msg.seq;
			const pack = typeof msg.pack === 'string' && Object.hasOwn(HORDE_PACKS, msg.pack) ? HORDE_PACKS[msg.pack] : null;
			if (!pack) error = 'Неизвестный отряд';
			else if (msg.action === 'spawn') error = this.buy(pack, msg.x, msg.y);
			else if (msg.action === 'upgrade') error = this.upgrade(pack);
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
		if (this.room.time < pack.at) return 'Этот отряд ещё не доступен';
		if (this.resource < pack.cost) return 'Недостаточно ресурса орды';
		if (this.pending.length >= HORDE_LIMITS.queued) return 'Очередь призыва заполнена';
		if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
			|| !this.inside(x, y, PACK_RADIUS + 24)) return 'Выберите точку внутри арены';
		const alive = this.alive();
		if (!alive.length) return 'На арене нет живых героев';
		const units = pack.units.map((type, i) => {
			const a = i / pack.units.length * Math.PI * 2;
			return { type, x: x + Math.cos(a) * PACK_RADIUS, y: y + Math.sin(a) * PACK_RADIUS };
		});
		if (units.some((u) => alive.some((h) => Math.hypot(h.x - u.x, h.y - u.y) < HORDE_LIMITS.spawnDistance))) {
			return 'Точка призыва слишком близко к герою';
		}
		const c = this.counts();
		if (c.manual + c.reserved + units.length > HORDE_LIMITS.manual
			|| c.total + c.reserved + units.length > HORDE_LIMITS.total) return 'Достигнут предел отрядов';
		this.resource -= pack.cost;
		this.pending.push({ pack: pack.id, level: this.levels[pack.id], cost: pack.cost, x, y, units, at: this.room.time + HORDE_LIMITS.warning });
		this.room.fx.push(['warn', Math.round(x), Math.round(y), PACK_RADIUS + 24, HORDE_LIMITS.warning]);
		return null;
	}

	upgrade(pack) {
		const level = this.levels[pack.id], cost = hordeUpgradePrice(level);
		if (cost === null) return 'Отряд уже полностью улучшен';
		if (this.room.time < HORDE_ECONOMY.upgradeAt[level]) return 'Улучшение ещё не доступно';
		if (this.resource < cost) return 'Недостаточно ресурса орды';
		this.resource -= cost;
		this.levels[pack.id]++;
		return null;
	}

	// Keeps the pressure reserve independent of manual purchases, so the director cannot starve hero XP.
	tick(dt, alive) {
		const room = this.room;
		this.resource = Math.min(HORDE_ECONOMY.cap, this.resource + dt * HORDE_ECONOMY.perSecond);
		const due = this.pending.filter((p) => p.at <= room.time);
		this.pending = this.pending.filter((p) => p.at > room.time);
		for (const p of due) {
			const c = this.counts();
			const unsafe = p.units.some((u) => alive.some((h) => Math.hypot(h.x - u.x, h.y - u.y) < ENEMIES[u.type].r + PLAYER_RADIUS + 64));
			if (!alive.length || unsafe || c.manual + c.reserved + p.units.length > HORDE_LIMITS.manual
				|| c.total + c.reserved + p.units.length > HORDE_LIMITS.total) {
				this.resource = Math.min(HORDE_ECONOMY.cap, this.resource + p.cost);
				room.send(room.directorPid, { t: 'err', msg: 'Призыв отменён: точка занята. Ресурс возвращён' });
				continue;
			}
			for (const u of p.units) {
				const e = room.spawnEnemy(u.type, alive, enemyHpScale(room.nt, room.heroes.size));
				e.x = u.x; e.y = u.y;
				e.hordeSource = 'manual'; e.hordePack = p.pack; e.hordeLevel = p.level;
				e.hp *= 1 + HORDE_UPGRADE.hpPerLevel * p.level; e.maxHp = e.hp;
				e.dmg *= 1 + HORDE_UPGRADE.damagePerLevel * p.level; e.dmgMul *= 1 + HORDE_UPGRADE.damagePerLevel * p.level;
				e.hordeReadyAt = room.time + HORDE_LIMITS.preparation;
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
