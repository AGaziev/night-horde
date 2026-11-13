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

export function loadVisual(storage = globalThis.localStorage) {
	try { return parseVisual(storage?.getItem(VISUAL_KEY)); } catch { return { ...DEFAULT_VISUAL }; }
}

export function saveVisual(v, storage = globalThis.localStorage) {
	try { storage?.setItem(VISUAL_KEY, JSON.stringify({ numbers: v.numbers, effects: v.effects })); } catch { /* private mode */ }
}

