import assert from 'node:assert/strict';
import { caravanPlacement } from '../public/js/display.js';
const fixture = {
  "icon": {
    "x": 131.6355743408203,
    "y": 271.63507080078125,
    "width": 40.728851318359375,
    "height": 40.7298583984375,
    "top": 271.63507080078125,
    "right": 172.3644256591797,
    "bottom": 312.36492919921875,
    "left": 131.6355743408203
  },
  "label": {
    "x": 166.10000610351562,
    "y": 262.8999938964844,
    "width": 84,
    "height": 27,
    "top": 262.8999938964844,
    "right": 250.10000610351562,
    "bottom": 289.8999938964844,
    "left": 166.10000610351562
  },
  "boxes": [
    {
      "x": 52,
      "y": 96,
      "width": 290,
      "height": 186.984375,
      "top": 96,
      "right": 342,
      "bottom": 282.984375,
      "left": 52
    },
    {
      "x": 10,
      "y": 22,
      "width": 199.390625,
      "height": 16,
      "top": 22,
      "right": 209.390625,
      "bottom": 38,
      "left": 10
    },
    {
      "x": 44.234375,
      "y": 44,
      "width": 30,
      "height": 30,
      "top": 44,
      "right": 74.234375,
      "bottom": 74,
      "left": 44.234375
    },
    {
      "x": 219.390625,
      "y": 22,
      "width": 129.21875,
      "height": 30,
      "top": 22,
      "right": 348.609375,
      "bottom": 52,
      "left": 219.390625
    },
    {
      "x": 219.390625,
      "y": 50,
      "width": 129.21875,
      "height": 13,
      "top": 50,
      "right": 348.609375,
      "bottom": 63,
      "left": 219.390625
    },
    {
      "x": 219.390625,
      "y": 63,
      "width": 129.21875,
      "height": 16,
      "top": 63,
      "right": 348.609375,
      "bottom": 79,
      "left": 219.390625
    },
    {
      "x": 364,
      "y": 22,
      "width": 38,
      "height": 38,
      "top": 22,
      "right": 402,
      "bottom": 60,
      "left": 364
    },
    {
      "x": 456,
      "y": 184,
      "width": 104,
      "height": 104,
      "top": 184,
      "right": 560,
      "bottom": 288,
      "left": 456
    },
    {
      "x": 6,
      "y": 134.390625,
      "width": 34,
      "height": 60,
      "top": 134.390625,
      "right": 40,
      "bottom": 194.390625,
      "left": 6
    }
  ]
};
const liveLabel = Object.create(Object.fromEntries(Object.entries(fixture.label).map(([key,value]) => [key,value])));
const p = caravanPlacement(fixture.icon, liveLabel, fixture.boxes, 568,320,Math.PI*.75);
assert.ok(p,'SW expanded card must fit both parts');
assert.equal(p.gap,4,'the 6px gap cannot fit this real browser geometry');
for (const r of [p.icon,p.label]) {
 assert.ok((r.left+r.right)/2<284 && (r.top+r.bottom)/2>160,'keep the SW bearing');
 assert.ok(r.left>=4 && r.right<=564 && r.top>=4 && r.bottom<=316);
 for (const b of fixture.boxes) assert.ok(r.right<=b.left-4 || r.left>=b.right+4 || r.bottom<=b.top-4 || r.top>=b.bottom+4);
}
console.log('Caravan placement: actual568x320 SW expanded-card geometry,4px fallback, both parts safe: OK');

const wnwFixture = {
  "icon": {
    "x": 164.2238311767578,
    "y": 83.05870056152344,
    "width": 40.000335693359375,
    "height": 38.68260192871094,
    "top": 83.05870056152344,
    "right": 204.2241668701172,
    "bottom": 121.74130249023438,
    "left": 164.2238311767578
  },
  "label": {
    "x": 201.54493713378906,
    "y": 99.89918518066406,
    "width": 83.99998474121094,
    "height": 27,
    "top": 99.89918518066406,
    "right": 285.544921875,
    "bottom": 126.89918518066406,
    "left": 201.54493713378906
  },
  "boxes": [
    {
      "x": 52,
      "y": 96,
      "width": 290,
      "height": 186.984375,
      "top": 96,
      "right": 342,
      "bottom": 282.984375,
      "left": 52
    },
    {
      "x": 10,
      "y": 22,
      "width": 199.390625,
      "height": 16,
      "top": 22,
      "right": 209.390625,
      "bottom": 38,
      "left": 10
    },
    {
      "x": 44.234375,
      "y": 44,
      "width": 30,
      "height": 30,
      "top": 44,
      "right": 74.234375,
      "bottom": 74,
      "left": 44.234375
    },
    {
      "x": 219.390625,
      "y": 22,
      "width": 129.21875,
      "height": 30,
      "top": 22,
      "right": 348.609375,
      "bottom": 52,
      "left": 219.390625
    },
    {
      "x": 219.390625,
      "y": 50,
      "width": 129.21875,
      "height": 13,
      "top": 50,
      "right": 348.609375,
      "bottom": 63,
      "left": 219.390625
    },
    {
      "x": 219.390625,
      "y": 63,
      "width": 129.21875,
      "height": 16,
      "top": 63,
      "right": 348.609375,
      "bottom": 79,
      "left": 219.390625
    },
    {
      "x": 364,
      "y": 22,
      "width": 38,
      "height": 38,
      "top": 22,
      "right": 402,
      "bottom": 60,
      "left": 364
    },
    {
      "x": 456,
      "y": 184,
      "width": 104,
      "height": 104,
      "top": 184,
      "right": 560,
      "bottom": 288,
      "left": 456
    },
    {
      "x": 6,
      "y": 134.390625,
      "width": 34,
      "height": 60,
      "top": 134.390625,
      "right": 40,
      "bottom": 194.390625,
      "left": 6
    }
  ]
};
const wnw=caravanPlacement(wnwFixture.icon,Object.create(wnwFixture.label),wnwFixture.boxes,568,320,Math.atan2(-900,-1559));
assert.ok(wnw,'try another safe icon when the closest one leaves no label space');
for(const r of[wnw.icon,wnw.label]){assert.ok((r.left+r.right)/2<284&&(r.top+r.bottom)/2<160);for(const b of wnwFixture.boxes)assert.ok(r.right<=b.left-wnw.gap||r.left>=b.right+wnw.gap||r.bottom<=b.top-wnw.gap||r.top>=b.bottom+wnw.gap);}
const noIconRead=new Proxy({},{get(){throw Error('icon search must not run when no label can fit')}});
assert.equal(caravanPlacement(noIconRead,{left:0,top:0,width:84,height:27},[{left:0,top:0,right:568,bottom:320}],568,320,Math.PI),null);
console.log('Caravan placement: actual WNW pair and globally-impossible-label early abort: OK');
