// Strict contact of a relative segment with a circle. Tangency alone is not overlap.
export function contactInterval(ax, ay, bx, by, radius) {
 const dx=bx-ax,dy=by-ay,a=dx*dx+dy*dy,c=ax*ax+ay*ay-radius*radius;
 if(a===0)return c<0?[0,1]:null;
 const b=2*(ax*dx+ay*dy),disc=b*b-4*a*c;
 if(disc<=0)return null;
 const root=Math.sqrt(disc),enter=Math.max(0,(-b-root)/(2*a)),exit=Math.min(1,(-b+root)/(2*a));
 return enter<exit?[enter,exit]:null;
}

// Capture remaining protection before this frame's countdown. State stays caller-owned.
export function contactFrame(h, end, dt) {
 return {start:end-dt,end,protectedUntil:end-dt+Math.max(0,h.iframes)};
}

// Apply shield/armor/perks exactly once at the accepted event's entry time.
export function applyContact(h, frame, at, hurt) {
 if(h.st!==0 || at<frame.protectedUntil-1e-9)return false;
 hurt();
 frame.protectedUntil=at+Math.max(0,h.iframes);
 return true;
}

export function finishContactFrame(h, frame) {
 h.iframes=Math.max(0,frame.protectedUntil-frame.end);
}
