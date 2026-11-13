// Visual settings of this browser: damage numbers and effect intensity (Issue #11).
// Attack warnings and anything else needed to dodge are drawn at every setting.

export const VISUAL_KEY = 'nh.vfx';
export const NUMBERS = ['all', 'crits', 'off'];
export const EFFECTS = ['full', 'lite'];
export const DEFAULT_VISUAL = Object.freeze({ numbers: 'all', effects: 'full' });

// Known values of `v`; anything missing or unknown is taken from `base`.
function normalize(v, base = DEFAULT_VISUAL) {
	return {
		numbers: NUMBERS.includes(v?.numbers) ? v.numbers : base.numbers,
		effects: EFFECTS.includes(v?.effects) ? v.effects : base.effects,
	};
}

function readJson(raw) {
	try { return JSON.parse(raw || 'null'); } catch { return null; }
}

export function parseVisual(raw) {
	return normalize(readJson(raw));
}

// The localStorage getter itself throws when site data is blocked, so it is read inside try.
export function loadVisual(storage) {
	try { return parseVisual((storage ?? globalThis.localStorage)?.getItem(VISUAL_KEY)); } catch { return { ...DEFAULT_VISUAL }; }
}

// Writes only the changed fields over what is stored now, so another tab's choice of the other field survives.
// Returns the merged settings; fields that are blocked, missing or broken in storage come from `current`.
export function saveVisual(change, current = DEFAULT_VISUAL, storage) {
	const own = normalize(current);
	let merged = normalize(change, own);
	try {
		const store = storage ?? globalThis.localStorage;
		merged = normalize(change, normalize(readJson(store?.getItem(VISUAL_KEY)), own));
		store?.setItem(VISUAL_KEY, JSON.stringify(merged));
	} catch { /* storage blocked */ }
	return merged;
}
