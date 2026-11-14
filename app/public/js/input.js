// Keyboard (layout-independent via e.code) and a floating touch joystick.

const KEYS = {
	KeyW: 'up', ArrowUp: 'up',
	KeyS: 'down', ArrowDown: 'down',
	KeyA: 'left', ArrowLeft: 'left',
	KeyD: 'right', ArrowRight: 'right',
};
const JOY_RADIUS = 50;

export class Input {
	constructor(surface, joyEl) {
		this.held = { up: false, down: false, left: false, right: false };
		this.joy = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 };
		this.joyEl = joyEl;
		this.knob = joyEl.firstElementChild;
		this.enabled = false;
		this.onDigit = null;
		this.onReroll = null;
		this.onSkip = null;
		this.onBan = null;
		this.onDash = null;
		this.out = { x: 0, y: 0 };

		addEventListener('keydown', (e) => {
			if (isTyping(e)) return;
			if (e.code === 'Space' && this.enabled && e.target?.tagName !== 'BUTTON') {
				e.preventDefault();
				if (!e.repeat) this.onDash?.();
				return;
			}
			const k = KEYS[e.code];
			if (k) {
				this.held[k] = true;
				if (this.enabled) e.preventDefault();
				return;
			}
			const m = /^(?:Digit|Numpad)([1-3])$/.exec(e.code);
			if (m && this.onDigit) this.onDigit(Number(m[1]) - 1);
			else if (e.code === 'KeyR' && this.onReroll) this.onReroll();
			else if (e.code === 'KeyX' && this.onSkip) this.onSkip();
			else if (e.code === 'KeyB' && this.onBan) this.onBan();
		});
		addEventListener('keyup', (e) => {
			const k = KEYS[e.code];
			if (k) this.held[k] = false;
		});
		addEventListener('blur', () => this.reset());

		surface.addEventListener('pointerdown', (e) => {
			if (!this.enabled || e.pointerType === 'mouse' || this.joy.active) return;
			e.preventDefault();
			Object.assign(this.joy, { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 });
			try { surface.setPointerCapture(e.pointerId); } catch { /* ignore */ }
			this.joyEl.style.left = e.clientX + 'px';
			this.joyEl.style.top = e.clientY + 'px';
			this.knob.style.transform = '';
			this.joyEl.hidden = false;
		});
		surface.addEventListener('pointermove', (e) => {
			if (!this.joy.active || e.pointerId !== this.joy.id) return;
			let dx = e.clientX - this.joy.ox;
			let dy = e.clientY - this.joy.oy;
			const len = Math.hypot(dx, dy);
			if (len > JOY_RADIUS) {
				dx *= JOY_RADIUS / len;
				dy *= JOY_RADIUS / len;
			}
			this.joy.dx = dx / JOY_RADIUS;
			this.joy.dy = dy / JOY_RADIUS;
			this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
		});
		const end = (e) => {
			if (e.pointerId !== this.joy.id) return;
			this.joy.active = false;
			this.joy.dx = this.joy.dy = 0;
			this.joyEl.hidden = true;
		};
		surface.addEventListener('pointerup', end);
		surface.addEventListener('pointercancel', end);
	}

	setEnabled(on) {
		this.enabled = on;
		if (!on) this.reset();
	}

	reset() {
		for (const k in this.held) this.held[k] = false;
		this.joy.active = false;
		this.joy.dx = this.joy.dy = 0;
		this.joyEl.hidden = true;
	}

	// Returns a reused {x, y} with length ≤ 1.
	vector() {
		let x = (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
		let y = (this.held.down ? 1 : 0) - (this.held.up ? 1 : 0);
		if (this.joy.active) {
			x += this.joy.dx;
			y += this.joy.dy;
		}
		const len = Math.hypot(x, y);
		if (len > 1) {
			x /= len;
			y /= len;
		} else if (len < 0.15) {
			x = y = 0;
		}
		this.out.x = x;
		this.out.y = y;
		return this.out;
	}
}

// Keys that belong to the focused field, not to the game. A focused visual-settings radio group keeps the arrows
// to switch its option; WASD and the other game keys still reach the hero.
export function isTyping(e) {
	const t = e.target;
	if (!t) return false;
	if (isVisualRadio(t)) return e.code.startsWith('Arrow');
	return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || !!t.isContentEditable;
}

// Radios of the in-game sound and visuals panel; other radio groups (feedback rating) keep every key.
export function isVisualRadio(t) {
	return t.tagName === 'INPUT' && t.type === 'radio' && !!t.closest?.('.vfx-group');
}
