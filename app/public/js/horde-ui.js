import { HORDE_PACKS, HORDE_LIMITS, HORDE_BUILD, HORDE_UPGRADE, HORDE_SYNERGIES, hordeCardDef } from '/shared/horde-content.js';
import { P } from './game.js';
import { fmtTime } from './ui.js';

const $ = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const number = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const write = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const el = (tag, cls, text) => {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	return node;
};
const BUILD_GROUPS = {
	pack: { key: 'packs', label: 'Отряды', slots: HORDE_BUILD.packSlots, max: HORDE_BUILD.packMax },
	weapon: { key: 'weapons', label: 'Оружие', slots: HORDE_BUILD.weaponSlots, max: HORDE_BUILD.weaponMax },
	artifact: { key: 'artifacts', label: 'Артефакты', slots: HORDE_BUILD.artifactSlots, max: HORDE_BUILD.artifactMax },
};
// Keep a whole server troop ring (radius 64) and its edge clearance inside the arena.
const PACK_RADIUS = 64;
const PLACEMENT_INSET = PACK_RADIUS + 24;

// Director controls live outside the hero input/offer flow. All purchases wait for a private server frame.
export class HordeUI {
	constructor({ game, net, renderer, canvas, ui }) {
		Object.assign(this, { game, net, renderer, canvas, ui });
		this.panel = $('horde-controls');
		this.enabled = false;
		this.ready = false;
		this.state = null;
		this.inflight = null;
		this.selected = null;
		this.pointer = null;
		this.paintIn = 0;
		this.cards = new Map();
		this.draftOpen = true;
		this.buildOpen = false;
		this.buildTab = 'pack';
		this.offerKey = '';
		this.loadoutKey = '';
		this.draftButtons = [];
		$('horde-draft-toggle').addEventListener('click', () => { this.draftOpen = !this.draftOpen; this.paint(); });
		$('horde-draft-close').addEventListener('click', () => { this.draftOpen = false; this.paint(); });
		$('horde-build-toggle').addEventListener('click', () => { this.buildOpen = !this.buildOpen; this.paint(); });
		$('horde-draft-reroll').addEventListener('click', () => {
			const offer = this.state?.offer;
			if (offer && this.state.rerolls > 0) this.command('reroll', { offerId: offer.id });
		});
		for (const [kind, group] of Object.entries(BUILD_GROUPS)) {
			const tab = el('button', 'btn btn-small', group.label);
			tab.type = 'button'; tab.id = `horde-tab-${kind}`; tab.dataset.kind = kind;
			tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'horde-build-content');
			tab.addEventListener('click', () => { this.buildTab = kind; this.loadoutKey = ''; this.paint(); });
			$('horde-build-tabs').appendChild(tab);
		}
		$('horde-cancel').addEventListener('click', () => this.select(null));
		$('horde-center').addEventListener('click', () => this.center());
		$('horde-zoom-in').addEventListener('click', () => this.zoom(1.2));
		$('horde-zoom-out').addEventListener('click', () => this.zoom(1 / 1.2));
		// Listening only on the canvas prevents a troop button's touch from also placing that troop.
		canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
		canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
		canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
		canvas.addEventListener('pointercancel', () => this.cancelPointer());
		canvas.addEventListener('lostpointercapture', () => this.cancelPointer());
		canvas.addEventListener('pointerleave', () => { if (!this.pointer) this.game.hordeTarget = null; });
		canvas.addEventListener('wheel', (e) => {
			if (!this.active()) return;
			e.preventDefault(); this.zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12);
		}, { passive: false });
		addEventListener('blur', () => this.cancelPointer());
		addEventListener('keydown', (e) => {
			if (!this.active() || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
			if (e.target?.matches('input,textarea,select,[contenteditable="true"]')) return;
			const digit = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
			if (digit) this.select([...this.cards.keys()][+digit[1] - 1]);
			else if (e.code === 'Escape') this.select(null);
			else if (e.code === 'Space') this.center();
			else if (e.code === 'Equal' || e.code === 'NumpadAdd') this.zoom(1.2);
			else if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.zoom(1 / 1.2);
			else if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
			e.preventDefault();
		});
	}

	active() { return this.enabled && this.game.running && this.game.isDirector(); }
	canCommand() { return this.active() && this.net.connected && this.ready && !this.inflight; }

	begin() {
		const keepCamera = this.enabled;
		this.enabled = this.game.isDirector();
		this.ready = false; this.state = null; this.inflight = null; this.selected = null;
		this.offerKey = ''; this.loadoutKey = '';
		if (!keepCamera) { this.draftOpen = true; this.buildOpen = false; this.buildTab = 'pack'; }
		this.game.hordeState = null; this.game.hordeTarget = null;
		this.cancelPointer();
		this.panel.hidden = !this.enabled;
		if (this.enabled && !keepCamera) {
			this.game.directorCamera.zoom = 0.65;
			this.center();
		}
		this.paint();
	}

	stop() {
		this.enabled = false; this.ready = false; this.inflight = null; this.selected = null;
		this.cancelPointer(); this.panel.hidden = true;
		this.game.hordeState = null; this.game.hordeTarget = null;
		this.canvas.classList.remove('horde-aiming');
	}

	connection() {
		// An unacknowledged command is never retried: reconnect supplies the authoritative lastSeq and wallet.
		this.ready = false; this.inflight = null;
		this.cancelPointer(); this.paint();
	}

	receive(msg) {
		if (!this.active() || !Number.isSafeInteger(msg.lastSeq) || msg.lastSeq < 0) return;
		if (this.state && msg.lastSeq < this.state.lastSeq) return;
		this.state = msg; this.ready = true;
		this.game.hordeState = { ...msg, receivedAt: performance.now() / 1000 };
		if (this.inflight && msg.lastSeq >= this.inflight.seq) this.inflight = null;
		this.paint();
	}

	denied() {
		if (!this.inflight) return;
		this.inflight = null; this.ready = false;
		this.paint();
	}

	pack(id) { return this.state?.packs?.find((p) => p.id === id); }

	select(id) {
		if (!this.active()) return;
		if (id && !this.pack(id)?.available) return;
		this.selected = id && this.selected !== id ? id : null;
		this.game.hordeTarget = null;
		this.paint();
	}

	command(action, payload = {}) {
		if (!this.canCommand()) return;
		const seq = this.state.lastSeq + 1;
		if (!Number.isSafeInteger(seq)) return;
		this.inflight = { seq, action };
		this.net.send({ t: 'horde', action, ...payload, seq });
		this.paint();
	}

	center() {
		if (!this.active()) return;
		if (this.pointer) this.pointer.moved = true;
		const rows = this.game.latest()?.p.filter((r) => r[P.st] !== 1) || [];
		const heroes = rows.length ? rows.map((r) => ({ x: r[P.x], y: r[P.y] })) : [...this.game.players.values()];
		const arena = this.game.arena;
		const placed = heroes.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
		const cam = this.game.directorCamera;
		cam.x = placed.length ? placed.reduce((sum, p) => sum + p.x, 0) / placed.length : (arena.minX + arena.maxX) / 2;
		cam.y = placed.length ? placed.reduce((sum, p) => sum + p.y, 0) / placed.length : (arena.minY + arena.maxY) / 2;
		this.boundCamera();
	}

	zoom(factor) {
		if (!this.active()) return;
		if (this.pointer) this.pointer.moved = true;
		const cam = this.game.directorCamera;
		cam.zoom = clamp(cam.zoom * factor, 0.3, 1.5);
		this.game.hordeTarget = null;
	}

	boundCamera() {
		const cam = this.game.directorCamera, a = this.game.arena;
		if (!a) return;
		cam.x = clamp(cam.x, a.minX, a.maxX); cam.y = clamp(cam.y, a.minY, a.maxY);
	}

	point(e) {
		const bounds = this.canvas.getBoundingClientRect();
		return this.renderer.toWorld(e.clientX - bounds.left, e.clientY - bounds.top, {});
	}

	allowedPoint(point) {
		const a = this.game.arena, snap = this.game.latest();
		if (!a || !snap || point.x < a.minX + PLACEMENT_INSET || point.x > a.maxX - PLACEMENT_INSET
			|| point.y < a.minY + PLACEMENT_INSET || point.y > a.maxY - PLACEMENT_INSET) return false;
		// Conservative preview: every unit in the ring stays at least spawnDistance from every hero, including downed ones.
		return snap.p.length > 0 && snap.p.every((p) => Math.hypot(point.x - p[P.x], point.y - p[P.y]) >= HORDE_LIMITS.spawnDistance + PACK_RADIUS);
	}

	pointerDown(e) {
		if (!this.active() || e.button !== 0) return;
		if (this.pointer) { this.pointer.moved = true; return; }
		e.preventDefault();
		this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, moved: false, at: performance.now() };
		this.canvas.setPointerCapture(e.pointerId);
	}

	pointerMove(e) {
		if (!this.active()) return;
		const p = this.pointer;
		if (p && p.id === e.pointerId) {
			if (Math.hypot(e.clientX - p.ox, e.clientY - p.oy) > 8) p.moved = true;
			if (p.moved) {
				const cam = this.game.directorCamera;
				cam.x -= (e.clientX - p.x) / this.renderer.zoom;
				cam.y -= (e.clientY - p.y) / this.renderer.zoom;
				this.boundCamera(); this.game.hordeTarget = null;
			}
			p.x = e.clientX; p.y = e.clientY;
		}
		if (this.selected && !p?.moved) {
			const point = this.point(e);
			this.game.hordeTarget = { ...point, valid: this.allowedPoint(point) };
		}
	}

	pointerUp(e) {
		const p = this.pointer;
		if (!p || p.id !== e.pointerId) return;
		this.pointer = null;
		if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
		if (!this.active() || p.moved || performance.now() - p.at > 750 || !this.selected || !this.canCommand()) return;
		if (document.elementFromPoint(e.clientX, e.clientY) !== this.canvas) return;
		const point = this.point(e);
		if (!this.allowedPoint(point)) {
			this.ui.toast('Выберите точку внутри арены, дальше от её края и за красными окружностями героев.');
			return;
		}
		this.command('spawn', { pack: this.selected, x: Math.round(point.x), y: Math.round(point.y) });
	}

	cancelPointer() { this.pointer = null; this.game.hordeTarget = null; }

	update(dt, input) {
		if (!this.active()) return;
		const v = input.vector(), cam = this.game.directorCamera;
		if (v.x || v.y) {
			cam.x += v.x * 1000 * dt; cam.y += v.y * 1000 * dt;
			this.boundCamera(); this.game.hordeTarget = null;
			if (this.pointer) this.pointer.moved = true;
		}
		this.paintIn -= dt;
		if (this.paintIn <= 0) { this.paintIn = 0.2; this.paint(); }
	}

	syncPacks() {
		const owned = (this.state?.packs || []).filter((p) => HORDE_PACKS[p.id]).slice(0, HORDE_BUILD.packSlots);
		const ids = owned.map((p) => p.id);
		if (ids.join('|') === [...this.cards.keys()].join('|')) return;
		this.cards.clear(); $('horde-packs').textContent = '';
		for (const [i, p] of owned.entries()) {
			const def = HORDE_PACKS[p.id];
			const card = el('div', 'horde-pack');
			const choose = el('button', 'btn horde-pack-select');
			choose.type = 'button'; choose.setAttribute('aria-pressed', 'false');
			const name = el('b', '', `${i + 1}. ${def.icon} ${def.name}`);
			const price = el('span'), detail = el('small');
			choose.append(name, price, detail);
			choose.title = def.desc;
			choose.addEventListener('click', () => this.select(p.id));
			card.appendChild(choose); $('horde-packs').appendChild(card);
			this.cards.set(p.id, { card, choose, price, detail });
		}
		if (!this.cards.has(this.selected)) this.selected = null;
	}

	paintDraft() {
		const s = this.state, offer = s?.offer;
		const pending = Math.max(0, number(s?.choicesPending));
		const now = this.game.latest()?.tm || 0;
		write($('horde-rank'), s ? `Ранг ${number(s.rank)} / ${HORDE_BUILD.maxPicks}` : 'Развитие орды');
		write($('horde-next-rank'), !s ? '…' : s.nextRankAt === null ? 'Все ранги получены' : `Следующий выбор через ${fmtTime(Math.max(0, number(s.nextRankAt) - now))}`);
		write($('horde-draft-toggle'), pending ? `${this.draftOpen ? 'Свернуть' : 'Выбрать улучшение'} · ${pending}` : 'Нет новых выборов');
		$('horde-draft-toggle').disabled = !offer;
		$('horde-draft-toggle').setAttribute('aria-expanded', String(this.draftOpen && !!offer));
		$('horde-draft-toggle').classList.toggle('btn-primary', pending > 0);
		$('horde-draft').hidden = !offer || !this.draftOpen;
		write($('horde-draft-pending'), pending > 1 ? `Ещё выборов после этого: ${pending - 1}` : 'Один выбор из трёх');
		write($('horde-draft-reroll'), `⟳ Перебросить (${number(s?.rerolls)})`);
		$('horde-draft-reroll').disabled = !this.canCommand() || !offer || !(s?.rerolls > 0);
		const key = JSON.stringify(offer || null);
		if (key !== this.offerKey) {
			this.offerKey = key; this.draftButtons = [];
			const box = $('horde-draft-choices'); box.textContent = '';
			for (const [index, choice] of (offer?.choices || []).entries()) {
				const def = hordeCardDef(choice.kind, choice.id), group = BUILD_GROUPS[choice.kind];
				if (!def || !group) continue;
				const card = el('button', 'btn horde-draft-card'); card.type = 'button';
				const isNew = !(s?.build?.[group.key]?.[choice.id] > 0);
				card.append(el('span', 'horde-card-kind', `${group.label} · ${isNew ? 'Новый предмет' : 'Улучшение'}`),
					el('b', '', `${def.icon} ${def.name}`), el('span', 'horde-card-level', `Уровень ${choice.level} / ${group.max}`), el('span', 'horde-card-desc', def.desc));
				if (choice.kind === 'pack') card.appendChild(el('small', 'horde-card-note', `Каждый уровень после первого: +${Math.round(HORDE_UPGRADE.hpPerLevel * 100)}% здоровья и +${Math.round(HORDE_UPGRADE.damagePerLevel * 100)}% урона.`));
				card.addEventListener('click', () => {
					if (this.state?.offer?.id === offer.id) this.command('pick', { offerId: offer.id, choice: index });
				});
				box.appendChild(card); this.draftButtons.push(card);
			}
		}
		for (const card of this.draftButtons) card.disabled = !this.canCommand();
	}

	paintBuild() {
		const s = this.state, build = s?.build || {};
		const counts = Object.fromEntries(Object.entries(BUILD_GROUPS).map(([kind, group]) => [kind, Object.values(build[group.key] || {}).filter((v) => v > 0).length]));
		write($('horde-build-toggle'), `${this.buildOpen ? 'Свернуть сборку' : 'Сборка'} · отряды ${counts.pack}/${HORDE_BUILD.packSlots} · оружие ${counts.weapon}/${HORDE_BUILD.weaponSlots} · артефакты ${counts.artifact}/${HORDE_BUILD.artifactSlots}`);
		$('horde-build-toggle').setAttribute('aria-expanded', String(this.buildOpen));
		$('horde-build').hidden = !this.buildOpen;
		const key = JSON.stringify([build, s?.synergies, this.buildTab]);
		if (key === this.loadoutKey) return;
		this.loadoutKey = key;
		for (const tab of $('horde-build-tabs').children) {
			const kind = tab.dataset.kind, group = BUILD_GROUPS[kind];
			write(tab, `${group.label} ${counts[kind]}/${group.slots}`);
			tab.classList.toggle('btn-on', kind === this.buildTab);
			tab.setAttribute('aria-selected', String(kind === this.buildTab));
		}
		const box = $('horde-build-content'); box.textContent = '';
		box.setAttribute('aria-labelledby', `horde-tab-${this.buildTab}`);
		const group = BUILD_GROUPS[this.buildTab];
		for (const [id, level] of Object.entries(build[group.key] || {})) {
			const def = hordeCardDef(this.buildTab, id);
			if (!def || !(level > 0)) continue;
			const row = el('div', 'horde-build-item');
			row.append(el('b', '', `${def.icon} ${def.name} · ${level}/${group.max}`), el('span', '', def.desc));
			box.appendChild(row);
		}
		if (!box.childElementCount) box.appendChild(el('p', 'muted small', 'Пока нет. Новые предметы появляются в выборе улучшений.'));
		const synergies = HORDE_SYNERGIES.filter((synergy) => s?.synergies?.includes(synergy.id));
		write($('horde-synergy-summary'), synergies.length ? `Активные сочетания: ${synergies.map((a) => a.name).join(' · ')}` : 'Сочетания появятся из выбранного оружия и артефактов.');
		const list = $('horde-synergies'); list.textContent = '';
		for (const synergy of synergies) {
			const row = el('div', 'horde-build-item');
			row.append(el('b', '', `≈ ${synergy.name}`), el('span', '', synergy.desc)); list.appendChild(row);
		}
	}

	paint() {
		if (!this.active()) return;
		const s = this.state;
		write($('horde-resource'), s ? `${Math.floor(number(s.resource))} / ${number(s.resourceCap)}` : '…');
		write($('horde-income'), s ? `+${number(s.income)} в секунду` : 'Ждём состояние орды');
		write($('horde-population'), s ? `Бойцы ${number(s.population)} / ${number(s.populationCap)} · в очереди ${number(s.queued)} / ${HORDE_LIMITS.queued}` : 'Загрузка отрядов…');
		this.syncPacks();
		for (const [id, card] of this.cards) {
			const p = this.pack(id), def = HORDE_PACKS[id];
			const cost = number(p?.cost, def.cost), count = number(p?.count, def.units.length), level = number(p?.level, s?.build?.packs?.[id] || 1);
			write(card.price, p?.available ? `${cost} ресурса · ${count} бойцов` : `Доступен с ${fmtTime(def.at)}`);
			write(card.detail, `Уровень ${level}/${HORDE_BUILD.packMax}`);
			card.choose.disabled = !this.canCommand() || !p?.available || number(s?.resource) < cost || number(s?.queued) >= HORDE_LIMITS.queued || number(s?.population) + count > number(s?.populationCap);
			card.choose.setAttribute('aria-pressed', String(this.selected === id));
			card.card.classList.toggle('selected', this.selected === id);
		}
		this.paintDraft(); this.paintBuild();
		const selection = this.selected ? `${HORDE_PACKS[this.selected].name}: нажмите на поле, чтобы вызвать отряд.` : 'Выберите отряд, затем нажмите на поле.';
		write($('horde-status'), !this.net.connected ? 'Нет связи. Приказы недоступны.' : !this.ready ? 'Восстанавливаем ресурс и приказы…' : this.inflight ? 'Приказ отправлен. Ждём подтверждение…' : selection);
		$('horde-cancel').hidden = !this.selected;
		this.canvas.classList.toggle('horde-aiming', !!this.selected && this.canCommand());
		this.game.hordeSelected = this.selected;
	}
}
