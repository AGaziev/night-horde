// Relative circle sweep: two moving circles are one segment against the origin.
// Returns first strict impact fraction [0,1), or null. Tangent contact follows the existing strict boundary.
export function movingCircleImpact(ax, ay, bx, by, cx, cy, dx, dy, radius) {
 const x=ax-cx,y=ay-cy,vx=(bx-ax)-(dx-cx),vy=(by-ay)-(dy-cy);
 const c=x*x+y*y-radius*radius;
 if(c<0)return 0;
 const a=vx*vx+vy*vy;if(a===0)return null;
 const b=2*(x*vx+y*vy),disc=b*b-4*a*c;
 if(disc<=0)return null;
 const t=(-b-Math.sqrt(disc))/(2*a);
 return t>=0&&t<1?t:null;
}
export const slashBounds=(x,y,dir,range,width)=>({ x:dir>0?x:x-range,y:y-width/2,width:range,height:width });

// Circle against the visible rectangle: the Minkowski corners are rounded.
export function circleOverlapsRect(x, y, radius, rect) {
 const dx=Math.max(rect.x-x,0,x-(rect.x+rect.width));
 const dy=Math.max(rect.y-y,0,y-(rect.y+rect.height));
 return dx*dx+dy*dy<=radius*radius;
}
