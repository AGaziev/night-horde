import { xpForNext } from '../public/shared/content.js';

export function initSwarm(room) {
	if (room.daily?.id !== 'swarm' || room.daily.version !== 2) return null;
	return { wins: 0, cohorts: room.peaks.filter(p => ['ring', 'tide'].includes(p.id)
		&& p.at + p.dur <= (room.finPlan?.pre ?? room.runLength)).slice(0, 2)
		.map(p => ({ id: p.id, at: p.at, end: p.at + p.dur, spawned: 0, killed: 0, resolved: false, success: false })) };
}

// Called only at ordinary-wave and peak-ring creation points, never by spawnEnemy itself.
export function tagSwarmEnemy(room, enemy) {
	if (!room.swarm || enemy.boss || enemy.def.special || enemy.outpost || enemy.caravan || enemy.add) return;
	const cohort = room.swarm.cohorts.find(c => !c.resolved && room.time >= c.at && room.time < c.end);
	if (!cohort) return;
	enemy.swarmCohort = cohort;
	cohort.spawned++;
}

export function killedSwarmEnemy(room, enemy) {
	const c = enemy.swarmCohort;
	if (!room.swarm?.cohorts.includes(c) || c.resolved || room.time < c.at || room.time >= c.end) return;
	c.killed++;
}

// Run after advancing active time and before peak spawning, AI and combat at the boundary.
export function resolveSwarm(room) {
	for (const c of room.swarm?.cohorts ?? []) {
		if (c.resolved || room.time < c.end) continue;
		c.resolved = true;
		c.success = c.spawned >= 1 && c.killed * 10 >= c.spawned * 7 && room.swarm.wins < 2;
		if (!c.success) continue;
		room.swarm.wins++;
		for (const h of room.heroes.values()) room.addXp(h, xpForNext(h.level, room.heroes.size) * .15);
	}
}

export function swarmSnapshot(room) {
	const c = room.swarm?.cohorts.find(c => !c.resolved && room.time >= c.at && room.time < c.end);
	return c ? { killed: c.killed, spawned: c.spawned, end: c.end } : null;
}
