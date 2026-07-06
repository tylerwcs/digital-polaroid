// Deterministic grayscale watercolour BLOOM texture.
// White (organic, feathered) on transparent background — the ALPHA channel
// carries the shape, so it works both as a CSS alpha-mask and as a canvas
// source-in tint. Re-running produces a byte-identical PNG (seeded PRNG).
//
// Look: a granulated watercolour bloom — many small overlapping "cells" (soft
// centre, brighter rim, like pigment pooling at bubble edges) clustered densely
// in one corner and fading diagonally out into a scatter of splatter droplets.
import { createCanvas } from '@napi-rs/canvas';
import { writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 560;
const H = 720;

// mulberry32 — tiny seeded PRNG so the asset is reproducible.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260706);

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
ctx.clearRect(0, 0, W, H);

// One feathered dab of pigment (used for splatter + soft under-wash).
function dab(x, y, r, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.8, r));
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.55, `rgba(255,255,255,${a * 0.6})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.8, r), 0, Math.PI * 2);
  ctx.fill();
}

// One watercolour "cell": soft centre with a brighter rim, mimicking the way
// pigment granulates and pools at the edges of a bloom. Overlapping many of
// these builds the reticulated, bubbly texture.
function cell(x, y, r, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${a * 0.32})`);
  g.addColorStop(0.72, `rgba(255,255,255,${a * 0.5})`);
  g.addColorStop(0.9, `rgba(255,255,255,${a})`); // pooled rim
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Bloom anchored in the bottom-left, fading toward the top-right.
const ax = W * 0.14;
const ay = H * 0.84;
const maxD = Math.hypot(W, H) * 0.92;

// 0) A soft under-wash so the dense corner reads as a bloom, not just cells.
for (let i = 0; i < 22; i++) {
  const d = Math.pow(rnd(), 2) * maxD * 0.55;
  const ang = rnd() * Math.PI * 2;
  dab(ax + Math.cos(ang) * d, ay + Math.sin(ang) * d * 0.9, 30 + rnd() * 70, 0.05 + rnd() * 0.05);
}

// 1) The cells — dense near the anchor, thinning with distance.
for (let i = 0; i < 260; i++) {
  const d = Math.pow(rnd(), 1.7) * maxD;         // concentrate near the anchor
  const ang = rnd() * Math.PI * 2;
  const x = ax + Math.cos(ang) * d;
  const y = ay + Math.sin(ang) * d * 0.9;
  const r = 5 + Math.pow(rnd(), 1.4) * 18;
  const distFade = 1 - Math.min(1, d / maxD);    // brighter near the anchor
  const a = (0.16 + rnd() * 0.2) * (0.3 + distFade * 0.7);
  cell(x, y, r, a);
}

// 2) Splatter droplets flung out along the fade, thinning the bloom's edge.
for (let i = 0; i < 150; i++) {
  const d = (0.25 + rnd() * 0.75) * maxD;
  const ang = rnd() * Math.PI * 2;
  const x = ax + Math.cos(ang) * d;
  const y = ay + Math.sin(ang) * d * 0.9;
  const distFade = 1 - Math.min(1, d / maxD);
  dab(x, y, 0.8 + rnd() * 3, (0.2 + rnd() * 0.3) * (0.4 + distFade * 0.6));
}

const out = path.resolve(__dirname, '..', 'public', 'watermark-watercolour.png');
await writeFile(out, canvas.toBuffer('image/png'));
console.log('wrote', out);
