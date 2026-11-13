// Visual settings of this browser: damage numbers and effect intensity (Issue #11).
// Attack warnings and anything else needed to dodge are drawn at every setting.

export const VISUAL_KEY = 'nh.vfx';
export const NUMBERS = ['all', 'crits', 'off'];
export const EFFECTS = ['full', 'lite'];
export const DEFAULT_VISUAL = Object.freeze({ numbers: 'all', effects: 'full' });

export function parseVisual(raw) {
	let v = null;
	try { v = JSON.parse(raw || 'null'); } catch { v = null; }
	return {
		numbers: NUMBERS.includes(v?.numbers) ? v.numbers : DEFAULT_VISUAL.numbers,
		effects: EFFECTS.includes(v?.effects) ? v.effects : DEFAULT_VISUAL.effects,
	};
}

// The localStorage getter itself throws when site data is blocked, so it is read inside try.
export function loadVisual(storage) {
	try { return parseVisual((storage ?? globalThis.localStorage)?.getItem(VISUAL_KEY)); } catch { return { ...DEFAULT_VISUAL }; }
}

export function saveVisual(v, storage) {
	try {
		(storage ?? globalThis.localStorage)?.setItem(VISUAL_KEY, JSON.stringify({ numbers: v.numbers, effects: v.effects }));
	} catch { /* storage blocked */ }
}

