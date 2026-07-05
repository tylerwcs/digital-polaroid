// Deterministic grayscale watercolour wash texture.
// White (organic, feathered) on transparent background — the ALPHA channel
// carries the shape, so it works both as a CSS alpha-mask and as a canvas
// source-in tint. Re-running produces a byte-identical PNG (seeded PRNG).
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

const cx = W * 0.5;
const cy = H * 0.5;

// Stack many soft white radial blobs to build organic, lumpy edges.
for (let i = 0; i < 140; i++) {
  const ang = rnd() * Math.PI * 2;
  const spread = Math.pow(rnd(), 0.6);
  const px = cx + Math.cos(ang) * spread * W * 0.34;
  const py = cy + Math.sin(ang) * spread * H * 0.36;
  const r = (0.1 + rnd() * 0.22) * Math.min(W, H);
  const a = 0.05 + rnd() * 0.09;
  const g = ctx.createRadialGradient(px, py, 0, px, py, r);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.7, `rgba(255,255,255,${a * 0.5})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
}

// A few large central washes to unify the blob.
for (let i = 0; i < 3; i++) {
  const r = (0.5 + rnd() * 0.2) * Math.min(W, H);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

const out = path.resolve(__dirname, '..', 'public', 'watermark-watercolour.png');
await writeFile(out, canvas.toBuffer('image/png'));
console.log('wrote', out);
