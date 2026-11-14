// Screen-space layers kept out of the canvas (vignette, hurt flash, off-screen arrows) and adaptive DPR.

function el(tag, cls, parent) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	parent.appendChild(e);
	return e;
}

function caravanSafe(r, avoid, width, height, angle, gap) {
 const dx = Math.cos(angle), dy = Math.sin(angle);
 return r.left >= gap && r.top >= gap && r.right <= width-gap && r.bottom <= height-gap
  && (Math.abs(dx) < .1 || ((r.left+r.right)/2-width/2)*dx > 0)
  && (Math.abs(dy) < .1 || ((r.top+r.bottom)/2-height/2)*dy > 0)
  && avoid.every(b => r.right <= b.left-gap || r.left >= b.right+gap || r.bottom <= b.top-gap || r.top >= b.bottom+gap);
}

// A finite obstacle-edge grid, nearest first; never scan the viewport pixel by pixel.
export function caravanPlacement(icon, label, boxes, width, height, angle) {
 const place = (rect, avoid, gap) => {
  const w = rect.width, h = rect.height;
  const xs = new Set([rect.left,gap,width-gap-w]), ys = new Set([rect.top,gap,height-gap-h]);
  for (const b of avoid) { xs.add(b.left-gap-w); xs.add(b.right+gap); ys.add(b.top-gap-h); ys.add(b.bottom+gap); }
  const candidates = [];
  for (const x of xs) for (const y of ys) {
   if (x < gap || y < gap || x+w > width-gap || y+h > height-gap) continue;
   candidates.push({left:x,top:y,right:x+w,bottom:y+h,width:w,height:h,d:(x-rect.left)**2+(y-rect.top)**2});
  }
  candidates.sort((a,b) => a.d-b.d);
  for (const r of candidates.slice(0,4096)) if (caravanSafe(r,avoid,width,height,angle,gap)) return r;
  return null;
 };
 for (const gap of [6,4]) {
  const ip = place(icon, boxes, gap); if (!ip) continue;
  const moved = {width:label.width,height:label.height,left:label.left+ip.left-icon.left,top:label.top+ip.top-icon.top};
  const lp = place(moved, boxes.concat(ip), gap);
  if (lp) return {icon:ip,label:lp,gap};
 }
 return null;
}

export class Overlay {
	constructor() {
		const body = document.body;
		el('div', 'fx-layer fx-vignette', body);
		this.eclipseEl = el('div', 'fx-layer fx-eclipse', body);
		this.dawnEl = el('div', 'fx-layer fx-dawn', body);
		this.hurtEl = el('div', 'fx-layer fx-hurt', body);
		this.eclipseV = -1;
		this.dawnV = -1;
		this.sight = null;
		this.arrowRoot = el('div', 'fx-layer fx-arrows', body);
		this.mm = el('canvas', 'fx-minimap', body);
		this.mm.style.display = 'none';
		this.hurtV = -1;
		this.pool = [];
	}

	hurt(v) {
		const q = Math.round(Math.max(0, Math.min(1, v)) * 50) / 50;
		if (q === this.hurtV) return;
		this.hurtV = q;
		this.hurtEl.style.opacity = q;
	}

	// Peak layers: the eclipse narrows the view around the screen centre, dawn warms the bottom and flashes at the burn.
	peak(game) {
		const pk = game ? game.peak() : null;
		let ecl = 0, dawn = 0;
		if (pk && pk.def.sight) {
			ecl = Math.max(0, Math.min(1, (pk.dur - pk.left) / 1.5, pk.left / 1.5));
			if (this.sight !== pk.def.sight) {
				this.sight = pk.def.sight;
				this.eclipseEl.style.setProperty('--sight', String(pk.def.sight));
			}
		}
		if (pk && pk.def.burn) dawn = 0.3 * (1 - pk.left / pk.dur);
		const d = game && game.dawn;
		if (d) dawn = d.t < 0.25 ? 1 : Math.max(0.6, 1 - (d.t - 0.25) * 0.5);
		const qe = Math.round(ecl * 50) / 50, qd = Math.round(dawn * 50) / 50;
		if (qe !== this.eclipseV) this.eclipseEl.style.opacity = this.eclipseV = qe;
		if (qd !== this.dawnV) this.dawnEl.style.opacity = this.dawnV = qd;
	}

	// list: [{x, y, ang, pulse, color, name, icon?, kind?}] in CSS pixels, or null; kind: 'down' | 'ally'.
	arrows(list) {
		const n = list ? list.length : 0;
		while (this.pool.length < n) {
			const root = el('div', 'fx-arrow', this.arrowRoot);
			root.innerHTML = '<svg width="34" height="30" viewBox="-14 -15 34 30"><polygon points="14,0 -8,-10 -3,0 -8,10" stroke="#000" stroke-width="2" stroke-linejoin="round"/></svg><span></span>';
			this.pool.push({ root, svg: root.firstChild, poly: root.firstChild.firstChild, label: root.lastChild, key: '', shown: false });
		}
		for (let i = 0; i < this.pool.length; i++) {
			const p = this.pool[i];
			if (i >= n) {
				if (p.shown) {
					p.root.style.display = 'none';
					p.shown = false;
				}
				continue;
			}
			const a = list[i];
			if (!p.shown) {
				p.root.style.display = '';
				p.shown = true;
			}
			const key = a.color + '|' + a.name + '|' + (a.icon ?? '') + '|' + (a.kind ?? '');
			if (p.key !== key) {
				p.key = key;
				if (p.kind !== a.kind) { p.kind=a.kind; p.caravanPlacement=null; p.caravanFailure=null; p.labelSize=null; p.labelWidth=null; p.labelText=null; }
				p.root.className = a.kind ? `fx-arrow fx-arrow-${a.kind}` : 'fx-arrow';
				p.poly.setAttribute('fill', a.color);
				if (a.kind !== 'caravan') p.label.textContent = (a.icon ?? '✝') + ' ' + a.name;
			}
			if (a.kind === 'caravan') { this.avoidCaravanDisclosure(p, a); continue; }
			p.root.style.transform = `translate(${a.x.toFixed(1)}px,${a.y.toFixed(1)}px)`;
			p.svg.style.transform = `translate(-50%,-50%) rotate(${a.ang.toFixed(3)}rad) scale(${a.pulse.toFixed(3)})`;
			// The label sits on the inner side of the arrow and grows away from the nearest side edge, so it is never cut off.
			p.label.style.width = a.kind === 'caravan' ? '84px' : '';
			p.label.style.maxWidth = a.kind === 'caravan' ? '84px' : '';
			p.label.style.whiteSpace = a.kind === 'caravan' ? 'normal' : '';
			const cos = Math.cos(a.ang);
			const ax = cos > 0.35 ? '-100%' : cos < -0.35 ? '0%' : '-50%';
			p.label.style.transform = `translate(calc(${ax} + ${(-cos * 20).toFixed(1)}px), calc(-50% + ${(-Math.sin(a.ang) * 22).toFixed(1)}px))`;
		}
	}

 // Layout reads/search happen only when obstacles or label dimensions change, or a rotation no longer fits.
 avoidCaravanDisclosure(p, a) {
  const card = document.getElementById('hud-caravan');
  if (!card || card.hidden) return;
  const joy = document.getElementById('joystick'), panel = document.getElementById('snd-panel');
  if (!this.objectiveResize) {
   this.objectiveDirty = true; this.objectiveGeneration = 0;
   this.objectiveResize = new ResizeObserver(() => { this.objectiveDirty = true; });
   this.objectiveMutation = new MutationObserver(records => {
    // Ignore changing text counters and HP-fill styles; ResizeObserver tracks their actual geometry.
    if (records.some(r => r.type === 'attributes' || [...r.addedNodes,...r.removedNodes].some(n => n.nodeType === 1))) this.objectiveDirty = true;
   });
   this.objectiveMutation.observe(document.getElementById('hud'), {subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open','class']});
   for (const node of [joy,panel,document.getElementById('snd'),this.mm]) if (node) this.objectiveMutation.observe(node,{attributes:true,attributeFilter:['hidden','style','class']});
   window.addEventListener('resize', () => { this.objectiveDirty = true; });
  }
  const key = `${innerWidth}:${innerHeight}:${card.open}:${joy?.hidden}:${panel?.hidden}`, now = performance.now();
  if (this.objectiveDirty || !this.objectiveObstacles || this.objectiveObstacles.key !== key || now-this.objectiveObstacles.at > 500) {
   const nodes = [card,...document.querySelectorAll('.hud-hp,.hud-icon,#hud-time,#hud-mode,#hud-peak,#hud-event,#hud-outposts,.hud-kills,#hud-allies,#hud-pause,#hud-boss'),document.getElementById('snd'),panel,joy,this.mm];
   const boxes = nodes.filter(e => e && !e.hidden).map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
   // The periodic fallback detects position-only shifts; unchanged boxes keep the placement generation.
   const signature = boxes.map(r => `${r.left},${r.top},${r.width},${r.height}`).join('|');
   if (this.objectiveObstacles?.signature !== signature) this.objectiveGeneration++;
   this.objectiveObstacles = {key,at:now,boxes,signature}; this.objectiveDirty = false;
   const watched = new Set([...nodes,...document.querySelectorAll('.hud-top,.hud-left,.hud-center,.hud-right')].filter(Boolean));
   for (const node of this.objectiveNodes ?? []) if (!watched.has(node)) this.objectiveResize.unobserve(node);
   for (const node of watched) if (!this.objectiveNodes?.has(node)) this.objectiveResize.observe(node);
   this.objectiveNodes = watched;
  }
  if (!p.labelObserver) {
   p.labelObserver = new ResizeObserver(([entry]) => {
    const {width,height} = entry.contentRect;
    if (width && height && (p.labelSize?.width !== width || p.labelSize?.height !== height)) { p.labelSize={width,height}; p.caravanPlacement=null; p.caravanFailure=null; }
   });
   p.labelObserver.observe(p.label);
  }
  const boxes = this.objectiveObstacles.boxes, angle = +a.ang.toFixed(3), pulse = +a.pulse.toFixed(3);
  const iw = (Math.abs(Math.cos(angle))*34+Math.abs(Math.sin(angle))*30)*pulse+.2;
  const ih = (Math.abs(Math.sin(angle))*34+Math.abs(Math.cos(angle))*30)*pulse+.2;
  const rect = (x,y,w,h) => ({left:x,top:y,right:x+w,bottom:y+h,width:w,height:h});
  const apply = cached => {
   p.root.style.transform = `translate(${cached.x.toFixed(3)}px,${cached.y.toFixed(3)}px)`;
   p.svg.style.transform = `translate(-50%,-50%) rotate(${angle}rad) scale(${pulse})`;
   p.label.style.transform = `translate(${(cached.label.left-cached.x).toFixed(3)}px,${(cached.label.top-cached.y).toFixed(3)}px)`;
   const text = (a.icon ?? '◆')+' '+a.name;
   if (p.labelText !== text) { p.label.textContent=text; p.labelText=text; }
  };
  const cached = p.caravanPlacement, iconAt = cached && rect(cached.x-iw/2,cached.y-ih/2,iw,ih);
  if (cached && cached.generation === this.objectiveGeneration && caravanSafe(iconAt,boxes,innerWidth,innerHeight,a.ang,cached.gap)
   && caravanSafe(cached.label,boxes.concat(iconAt),innerWidth,innerHeight,a.ang,cached.gap)) { apply(cached); return; }
  const fallback = () => {
   // Keep the bearing when the quadrant cannot fit; cache this result too.
   p.root.style.transform=`translate(${a.x}px,${a.y}px)`;
   p.svg.style.transform=`translate(-50%,-50%) rotate(${angle}rad) scale(${pulse})`;
   p.label.style.transform=`translate(${-Math.cos(a.ang)*20}px,${-p.labelSize.height/2-Math.sin(a.ang)*22}px)`;
   const text=(a.icon ?? '◆')+' '+a.name;
   if(p.labelText!==text){p.label.textContent=text;p.labelText=text;}
  };
  const failureKey = `${this.objectiveGeneration}:${angle}:${pulse}:${p.labelSize?.width}:${p.labelSize?.height}`;
  if (p.caravanFailure === failureKey) { fallback(); return; }
  const width=84, text=(a.icon ?? '◆')+' '+a.name;
  if (p.labelWidth !== width) { p.label.style.width=p.label.style.maxWidth=`${width}px`; p.label.style.whiteSpace='normal'; p.labelWidth=width; p.labelSize=null; }
  if (p.labelText !== text) { p.label.textContent=text; p.labelText=text; }
  if (!p.labelSize) p.labelSize={width:p.label.offsetWidth,height:p.label.offsetHeight};
  const w=p.labelSize.width,h=p.labelSize.height,cos=Math.cos(a.ang),sin=Math.sin(a.ang);
  const label=rect(a.x-cos*20-(cos>.35?w:cos<-.35?0:w/2),a.y-h/2-sin*22,w,h);
  const result=caravanPlacement(rect(a.x-iw/2,a.y-ih/2,iw,ih),label,boxes,innerWidth,innerHeight,a.ang);
  if (result) {
   p.caravanPlacement={generation:this.objectiveGeneration,x:result.icon.left+iw/2,y:result.icon.top+ih/2,label:result.label,gap:result.gap};
   p.caravanFailure=null; apply(p.caravanPlacement); return;
  }
  p.caravanPlacement=null;
  p.caravanFailure=`${this.objectiveGeneration}:${angle}:${pulse}:${w}:${h}`;
  fallback();
 }

}

const LEVELS = [2, 1.5, 1.25, 1];
const WINDOW_MS = 1000;
const SLOW_MS = 20;
const MISSED_FRAME_MS = 25; // separates missed 60Hz frames from ordinary vsync jitter
const SLOW_FRAME_RATIO = 0.05;
const FAST_FRAME_RATIO = 0.02;
const SLOW_WINDOWS = 3; // ~3 s of slow frames before stepping down
const FAST_MS = 17.5; // keeps vsync at 60 Hz
const FAST_WINDOWS = 8;
const RETRY_BASE_MS = 20000;

// Steps the canvas resolution down when frames are slow for a few seconds and back up when they have headroom.
// A level that failed right after a step up waits twice as long before the next try.
export class DprController {
	constructor(onChange) {
		this.onChange = onChange;
		const native = Math.min(2, window.devicePixelRatio || 1);
		this.levels = LEVELS.filter((l) => l <= native);
		if (!this.levels.length) this.levels = [native];
		if (this.levels[0] < native) this.levels.unshift(native);
		const touch = window.matchMedia?.('(pointer: coarse)').matches;
		this.idx = touch ? Math.max(0, this.levels.findIndex((l) => l <= 1.5)) : 0;
		this.fixed = 0;
		this.resetWindow(0);
		this.retryAt = 0;
		this.retryMs = RETRY_BASE_MS;
		this.upAt = 0;
	}

	get value() {
		return this.fixed || this.levels[this.idx];
	}

	// Pins a DPR (0 = adaptive again); used by benchmarks and could back a quality setting.
	lock(v) {
		this.fixed = +v || 0;
		this.resetWindow();
		this.onChange();
	}

	resetWindow(now = performance.now()) {
		this.last = now;
		this.winStart = 0;
		this.sum = this.count = this.missed = 0;
		this.slowRun = this.fastRun = 0;
	}

	frame() {
		const now = performance.now();
		const dt = now - this.last;
		this.last = now;
		if (this.fixed) return;
		if (dt <= 0 || dt > 250) {
			// Background tabs and suspension break cadence; require fresh consecutive windows.
			this.resetWindow(now);
			return;
		}
		if (!this.winStart) this.winStart = now;
		this.sum += dt;
		this.count++;
		if (dt > MISSED_FRAME_MS) this.missed++;
		if (now - this.winStart < WINDOW_MS) return;
		const mean = this.sum / this.count;
		const missed = this.missed / this.count;
		this.winStart = now;
		this.sum = 0;
		this.count = 0;
		this.missed = 0;
		// A mean around 18ms can still hide recurring 33ms frames. React to a sustained
		// missed-frame tail too, while retaining the three-window hysteresis.
		if (mean > SLOW_MS || missed >= SLOW_FRAME_RATIO) {
			this.fastRun = 0;
			if (++this.slowRun >= SLOW_WINDOWS && this.idx < this.levels.length - 1) {
				// Failing soon after a step up: back off before trying that level again.
				this.retryMs = now - this.upAt < 15000 ? this.retryMs * 2 : RETRY_BASE_MS;
				this.retryAt = now + this.retryMs;
				this.set(this.idx + 1);
			}
		} else {
			this.slowRun = 0;
			if (mean < FAST_MS && missed < FAST_FRAME_RATIO && this.idx > 0 && now >= this.retryAt) {
				if (++this.fastRun >= FAST_WINDOWS) {
					this.upAt = now;
					this.set(this.idx - 1);
				}
			} else this.fastRun = 0;
		}
	}

	set(i) {
		this.idx = i;
		this.slowRun = 0;
		this.fastRun = 0;
		this.onChange();
	}
}
