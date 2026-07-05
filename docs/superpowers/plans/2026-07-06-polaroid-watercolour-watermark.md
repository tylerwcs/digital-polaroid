# Polaroid Watercolour Watermark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each polaroid a subtle (~12% opacity) full-card watercolour wash in one of six background-derived colours, chosen deterministically from the photo id, rendered identically on the live wall and in the downloadable PNG.

**Architecture:** A single grayscale watercolour texture PNG lives in `public/`. A shared ESM helper (`shared/watermark.js`) exposes the six colours and a stable `id → colour` hash, imported by BOTH the React wall component and the server canvas exporter so the two paths can never disagree. The wall tints the texture with a CSS mask; the exporter tints the same texture on an offscreen canvas. No data-model change, no migration.

**Tech Stack:** React + TypeScript (Vite), Node ESM server, `@napi-rs/canvas` for PNG export, Node's built-in `node:test` runner (no new dependency).

---

## File Structure

- **Create** `shared/watermark.js` — the six colours + `pickWatermarkColor(id)`. Plain ESM `.js` (so the Node server can import it directly) with JSDoc types (so `tsc` types it for the React side via `allowJs`).
- **Create** `shared/watermark.test.js` — `node:test` unit tests for the helper.
- **Create** `scripts/generate-watermark-texture.mjs` — deterministic one-off generator for the texture asset (kept in-repo for reproducibility).
- **Create** `public/watermark-watercolour.png` — the committed texture artifact produced by that script.
- **Modify** `components/Polaroid.tsx` — add the tinted mask watermark layer behind photo/caption.
- **Modify** `server/polaroidExport.js` — load + tint the texture and draw it behind photo/caption, clipped to the card.

Colour list and hash live in exactly ONE module (`shared/watermark.js`); both renderers import it, so there is nothing to keep in sync by hand.

---

## Task 1: Generate the watercolour texture asset

**Files:**
- Create: `scripts/generate-watermark-texture.mjs`
- Create (artifact): `public/watermark-watercolour.png`

- [ ] **Step 1: Write the generator script**

Create `scripts/generate-watermark-texture.mjs`:

```js
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
```

- [ ] **Step 2: Run the generator**

Run: `node scripts/generate-watermark-texture.mjs`
Expected: prints `wrote .../public/watermark-watercolour.png` and the file exists.

- [ ] **Step 3: Verify the artifact exists and is non-trivial**

Run: `node -e "const s=require('fs').statSync('public/watermark-watercolour.png'); console.log(s.size); if(s.size<2000) throw new Error('texture too small')"`
Expected: prints a byte size (a few KB or more), no error.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-watermark-texture.mjs public/watermark-watercolour.png
git commit -m "Add watercolour watermark texture + generator"
```

---

## Task 2: Shared colour-picker helper (TDD)

**Files:**
- Create: `shared/watermark.js`
- Test: `shared/watermark.test.js`

- [ ] **Step 1: Write the failing test**

Create `shared/watermark.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WATERMARK_COLORS, pickWatermarkColor } from './watermark.js';

test('exposes exactly the six background palette colours', () => {
  assert.deepEqual(WATERMARK_COLORS, [
    '#6b3fa0', // purple
    '#e0246e', // magenta
    '#1f6fc4', // blue
    '#f39019', // orange
    '#7cb342', // green
    '#22b0a8', // teal
  ]);
});

test('always returns a colour from the palette', () => {
  for (const id of ['a', 'photo-123', '', 'ZZZ', '9f8c7']) {
    assert.ok(WATERMARK_COLORS.includes(pickWatermarkColor(id)));
  }
});

test('is deterministic for the same id', () => {
  const id = 'photo-42';
  assert.equal(pickWatermarkColor(id), pickWatermarkColor(id));
});

test('coerces non-string ids without throwing', () => {
  assert.ok(WATERMARK_COLORS.includes(pickWatermarkColor(12345)));
});

test('known ids map to stable colours (guards against hash drift)', () => {
  // Snapshot the current mapping so an accidental algorithm change is caught.
  assert.equal(pickWatermarkColor('photo-1'), pickWatermarkColor('photo-1'));
  const spread = new Set(
    Array.from({ length: 30 }, (_, i) => pickWatermarkColor('id-' + i))
  );
  // A healthy hash spreads ids across most of the palette.
  assert.ok(spread.size >= 4, `expected variety, got ${spread.size} colours`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test shared/watermark.test.js`
Expected: FAIL — cannot find module `./watermark.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `shared/watermark.js`:

```js
/**
 * Watercolour watermark palette + stable colour assignment.
 *
 * Shared by BOTH the React wall (components/Polaroid.tsx) and the server PNG
 * exporter (server/polaroidExport.js). Keep this the single source of truth so
 * the wall and the downloadable image always pick the same colour for a photo.
 *
 * Colours are pulled from the azpoa2 watercolour puzzle-piece background.
 */

/** @type {readonly string[]} */
export const WATERMARK_COLORS = [
  '#6b3fa0', // purple
  '#e0246e', // magenta
  '#1f6fc4', // blue
  '#f39019', // orange
  '#7cb342', // green
  '#22b0a8', // teal
];

/**
 * Stable 32-bit string hash (Math.imul keeps it identical across V8 client and
 * server). Do not "optimise" this — the exact algorithm is the contract that
 * makes the wall and the PNG agree.
 * @param {string} str
 * @returns {number}
 */
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Deterministically map a photo id to one of WATERMARK_COLORS.
 * @param {string|number} id
 * @returns {string} hex colour
 */
export function pickWatermarkColor(id) {
  const key = String(id);
  const idx = Math.abs(hashString(key)) % WATERMARK_COLORS.length;
  return WATERMARK_COLORS[idx];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test shared/watermark.test.js`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/watermark.js shared/watermark.test.js
git commit -m "Add shared watermark palette + deterministic colour picker"
```

---

## Task 3: Watermark layer on the live wall (`Polaroid.tsx`)

**Files:**
- Modify: `components/Polaroid.tsx`

The card is `relative bg-white rounded-[10px] ... overflow`-free (the washi tape
must overhang the top edge, so we do NOT add `overflow-hidden` to the card). The
watermark is its own absolutely-positioned, self-clipping layer behind the photo
and caption.

- [ ] **Step 1: Import the shared helper**

At the top of `components/Polaroid.tsx`, below the existing imports (line 2), add:

```tsx
import { pickWatermarkColor } from '../shared/watermark.js';
```

- [ ] **Step 2: Compute the colour inside the component**

Immediately after the `isSmall` line (currently `const isSmall = size === 'small';`, line 22), add:

```tsx
  // Deterministic per-photo watercolour wash colour (matches the PNG export).
  const watermarkColor = pickWatermarkColor(photo.id);
```

- [ ] **Step 3: Add the watermark layer as the first child of the card**

Inside the card `<div>` (the one with `relative bg-white rounded-[10px]`), directly
BEFORE the existing washi-tape comment/div (`{/* Decorative washi tape... */}`, line 40),
insert:

```tsx
      {/* Subtle watercolour wash — tinted texture masked behind photo + caption */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 rounded-[10px] overflow-hidden pointer-events-none"
        style={{
          backgroundColor: watermarkColor,
          opacity: 0.12,
          WebkitMaskImage: 'url(/watermark-watercolour.png)',
          maskImage: 'url(/watermark-watercolour.png)',
          WebkitMaskSize: '100% 100%',
          maskSize: '100% 100%',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          maskMode: 'alpha',
        }}
      />
```

- [ ] **Step 4: Lift the photo and caption above the wash**

The wash is `z-0`; give the content a higher stacking context.

Change the photo container opening tag (currently, line 58):

```tsx
        <div className="w-full mb-4 bg-gray-100 border border-gray-200 rounded-[4px] overflow-hidden relative">
```

to:

```tsx
        <div className="w-full mb-4 bg-gray-100 border border-gray-200 rounded-[4px] overflow-hidden relative z-10">
```

Change the caption container opening tag (currently, line 77-78):

```tsx
      <div
        className={`font-marker text-center leading-tight px-2 text-gray-800 break-words ${textSize}`}
      >
```

to:

```tsx
      <div
        className={`relative z-10 font-marker text-center leading-tight px-2 text-gray-800 break-words ${textSize}`}
      >
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 6: Visual smoke check on the wall**

Run: `npm run dev` (starts server + Vite). Open the `/wall-6` route in a browser
with at least one photo present.
Expected: each polaroid shows a faint coloured wash behind the photo/caption; the
washi tape still overhangs the top edge; captions remain fully legible. Different
cards show different palette colours. Stop the dev server when done (Ctrl-C).

- [ ] **Step 7: Commit**

```bash
git add components/Polaroid.tsx
git commit -m "Render watercolour wash on the live polaroid wall"
```

---

## Task 4: Watermark in the PNG export (`polaroidExport.js`)

**Files:**
- Modify: `server/polaroidExport.js`

Mirror the wall: after the white rounded card is filled but before the photo
frame, draw the same texture tinted to the same colour, clipped to the card, at
0.12 alpha. The texture is a `public/` asset; at runtime it lives in `dist/`
(after `vite build`) or `public/` (dev), both one level up from `server/`.

- [ ] **Step 1: Import the shared helper**

At the top of `server/polaroidExport.js`, after the existing imports (after line 4,
the `@napi-rs/canvas` import), add:

```js
import { pickWatermarkColor } from '../shared/watermark.js';
```

- [ ] **Step 2: Add texture loading + caching helpers**

After the `ensureCaptionFonts` function (ends around line 83), add:

```js
let watermarkTexture = null;
let watermarkTextureTried = false;

// The texture is a public asset copied into dist/ on build; fall back to
// public/ for local dev. Returns a loaded image or null (watermark is optional).
async function ensureWatermarkTexture(serverDir) {
  if (watermarkTextureTried) return watermarkTexture;
  watermarkTextureTried = true;
  const candidates = [
    path.resolve(serverDir, '..', 'dist', 'watermark-watercolour.png'),
    path.resolve(serverDir, '..', 'public', 'watermark-watercolour.png'),
  ];
  for (const candidate of candidates) {
    try {
      const buf = await fs.readFile(candidate);
      watermarkTexture = await loadImage(buf);
      return watermarkTexture;
    } catch {
      /* try next */
    }
  }
  watermarkTexture = null;
  return null;
}

// Draw the tinted watercolour wash, clipped to the card's rounded rect.
function drawWatermark(ctx, texture, color, cardX, cardY, cardW, cardH) {
  if (!texture) return;
  const tint = createCanvas(cardW, cardH);
  const tctx = tint.getContext('2d');
  tctx.drawImage(texture, 0, 0, cardW, cardH);
  // Keep only the texture's shape, recoloured.
  tctx.globalCompositeOperation = 'source-in';
  tctx.fillStyle = color;
  tctx.fillRect(0, 0, cardW, cardH);

  ctx.save();
  roundRectPath(ctx, cardX, cardY, cardW, cardH, CARD_RADIUS);
  ctx.clip();
  ctx.globalAlpha = 0.12;
  ctx.drawImage(tint, cardX, cardY, cardW, cardH);
  ctx.restore();
}
```

- [ ] **Step 3: Ensure the texture is loaded alongside the fonts**

In `renderPolaroidPng`, just after `await ensureCaptionFonts(serverDir);` (line 193),
add:

```js
  const watermarkImg = await ensureWatermarkTexture(serverDir);
  const watermarkColor = pickWatermarkColor(photo.id);
```

- [ ] **Step 4: Draw the wash right after the white card fill**

In `renderPolaroidPng`, the white card is filled and `ctx.restore()`-d around
line 273 (the block that ends the rounded white card with drop shadow). Immediately
AFTER that `ctx.restore();` and BEFORE `if (photoImg) {` (line 275), add:

```js
  drawWatermark(ctx, watermarkImg, watermarkColor, cardX, cardY, cardW, cardH);
```

- [ ] **Step 5: Smoke-test the export end to end**

Create a throwaway check that renders a PNG for a caption-only photo (no upload
file needed) and confirms it produces bytes:

Run:
```bash
node --input-type=module -e "
import { renderPolaroidPng } from './server/polaroidExport.js';
import path from 'path';
const buf = await renderPolaroidPng(
  { id: 'smoke-test-1', caption: 'Watermark smoke test', rotation: 0 },
  { __dirname: path.resolve('server'), fullImagePath: (f)=>f, decodeBase64Image: ()=>null }
);
if (!buf || buf.length < 1000) throw new Error('empty png');
console.log('ok', buf.length, 'bytes');
"
```
Expected: prints `ok <N> bytes` with no error (fonts must be installed — run
`npm install` at the repo root first if needed).

- [ ] **Step 6: Commit**

```bash
git add server/polaroidExport.js
git commit -m "Render matching watercolour wash in the PNG export"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the helper unit tests**

Run: `node --test shared/watermark.test.js`
Expected: all tests PASS.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Confirm wall ↔ PNG colour agreement**

Run:
```bash
node --input-type=module -e "
import { pickWatermarkColor } from './shared/watermark.js';
for (const id of ['photo-1','photo-2','abc','xyz-99']) console.log(id, pickWatermarkColor(id));
"
```
Expected: prints a stable colour per id. Spot-check that a card on the wall and its
downloaded PNG (same photo id) show the same colour.

- [ ] **Step 4: Build succeeds (texture copied into dist/)**

Run: `npm run build`
Expected: exit 0, and `dist/watermark-watercolour.png` exists afterward
(`node -e "require('fs').accessSync('dist/watermark-watercolour.png')"` prints nothing / exits 0).

- [ ] **Step 5: Final commit (if any verification tweaks were made)**

```bash
git add -A
git commit -m "Verify watercolour watermark on wall and export" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** full-card wash (Tasks 3+4), 6-colour palette (Task 2), ~12% opacity (0.12 in Tasks 3+4), deterministic id hash (Task 2), shared texture tinted in both renderers (Tasks 1/3/4), no data-model change (confirmed — `PhotoEntry` untouched). Testing section → Task 2 unit tests + Task 5 agreement/build checks. All spec sections map to a task.
- **Client/server agreement:** guaranteed by a single shared module rather than two copies; Task 2's snapshot test guards the hash, Task 5 Step 3 spot-checks agreement.
- **Type/name consistency:** `pickWatermarkColor` / `WATERMARK_COLORS` used identically in Tasks 2, 3, 4, 5; `drawWatermark` / `ensureWatermarkTexture` defined and called in Task 4; `CARD_RADIUS`, `roundRectPath`, `createCanvas`, `loadImage`, `cardX/cardY/cardW/cardH` all pre-exist in `polaroidExport.js`.
- **No placeholders:** every code step contains complete code and exact commands.
