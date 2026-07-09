# Downloadable Polaroid on a Branded Background — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After posting to the wall, a user can download their polaroid composited onto a branded portrait background, which the admin can replace via upload.

**Architecture:** Reuse the server's `renderPolaroidPng` (@napi-rs/canvas) to render the polaroid, composite it centered onto a download background, and serve it from `GET /api/photos/:id/download`. The download background is a `downloadBackground` URL in `wallSettings` (default the bundled `/downloadBG.png`), replaceable via `POST /api/download-background`. Upload logic is shared with the existing `/api/background` endpoint.

**Tech Stack:** React 19 + TypeScript (Vite), Express 4 + Socket.IO 4 (ESM), @napi-rs/canvas, Node built-in test runner.

---

## File Structure

- `server/settings.js` (+test): add `downloadBackground` validation.
- `server/index.js`: shared `saveUploadedImage` helper, `POST /api/download-background`, `resolveDownloadBackgroundBuffer`, `GET /api/photos/:id/download`.
- `server/polaroidExport.js`: `renderPolaroidDownload` composite renderer.
- `public/downloadBG.png`: committed as the default download background.
- `types.ts`: `downloadBackground` on `WallSettings` + default.
- `services/storageService.ts`: `uploadDownloadBackground`, `downloadPolaroid`.
- `components/UploadView.tsx`: posted state + download button.
- `components/AdminView.tsx`: download-background upload field.

---

## Task 1: Server-side `downloadBackground` validation

**Files:**
- Modify: `server/settings.js`
- Modify (test): `server/settings.test.js`

- [ ] **Step 1: Update tests first**

In `server/settings.test.js`, update the import to add `DEFAULT_DOWNLOAD_BACKGROUND`:

```js
import {
  WALL_SETTINGS_DEFAULTS,
  WALL_SETTINGS_BOUNDS,
  DEFAULT_BACKGROUND,
  DEFAULT_DOWNLOAD_BACKGROUND,
  normalizeWallSettings,
} from './settings.js';
```

Update these FIVE existing full-object `deepEqual` assertions to also include `downloadBackground: DEFAULT_DOWNLOAD_BACKGROUND`:

- `'empty patch over defaults returns the defaults'`:
```js
  assert.deepEqual(normalizeWallSettings({}, WALL_SETTINGS_DEFAULTS), {
    maxColumns: 6,
    polaroidWidth: 180,
    background: DEFAULT_BACKGROUND,
    downloadBackground: DEFAULT_DOWNLOAD_BACKGROUND,
  });
```
- `'partial patch updates only the provided key'`:
```js
  assert.deepEqual(result, { maxColumns: 4, polaroidWidth: 260, background: DEFAULT_BACKGROUND, downloadBackground: DEFAULT_DOWNLOAD_BACKGROUND });
```
- `'ignores unknown keys'`:
```js
  assert.deepEqual(result, { maxColumns: 3, polaroidWidth: 180, background: DEFAULT_BACKGROUND, downloadBackground: DEFAULT_DOWNLOAD_BACKGROUND });
```
- `'sanitizes a corrupt base object'`:
```js
  assert.deepEqual(result, { maxColumns: 8, polaroidWidth: 180, background: DEFAULT_BACKGROUND, downloadBackground: DEFAULT_DOWNLOAD_BACKGROUND });
```
- `'non-object patch is treated as empty'`:
```js
  assert.deepEqual(normalizeWallSettings(null), { maxColumns: 6, polaroidWidth: 180, background: DEFAULT_BACKGROUND, downloadBackground: DEFAULT_DOWNLOAD_BACKGROUND });
```

Append these new tests to the end of the file:

```js
test('default settings include the default download background', () => {
  assert.equal(normalizeWallSettings({}).downloadBackground, DEFAULT_DOWNLOAD_BACKGROUND);
});

test('accepts a valid download background url', () => {
  assert.equal(normalizeWallSettings({ downloadBackground: '/uploads/dl-1.png' }).downloadBackground, '/uploads/dl-1.png');
});

test('empty download background keeps base', () => {
  const base = { maxColumns: 6, polaroidWidth: 180, background: DEFAULT_BACKGROUND, downloadBackground: '/uploads/dl-9.png' };
  assert.equal(normalizeWallSettings({ downloadBackground: '' }, base).downloadBackground, '/uploads/dl-9.png');
});

test('non-string download background falls back to default', () => {
  assert.equal(normalizeWallSettings({ downloadBackground: 123 }).downloadBackground, DEFAULT_DOWNLOAD_BACKGROUND);
});

test('over-long download background falls back to default', () => {
  const long = '/' + 'a'.repeat(3000);
  assert.equal(normalizeWallSettings({ downloadBackground: long }).downloadBackground, DEFAULT_DOWNLOAD_BACKGROUND);
});

test('partial patch without download background preserves base', () => {
  const base = { maxColumns: 6, polaroidWidth: 180, background: DEFAULT_BACKGROUND, downloadBackground: '/uploads/dl-5.png' };
  assert.equal(normalizeWallSettings({ maxColumns: 3 }, base).downloadBackground, '/uploads/dl-5.png');
});
```

- [ ] **Step 2: Run tests to confirm they FAIL**

Run: `npm test`
Expected: FAIL (DEFAULT_DOWNLOAD_BACKGROUND undefined / downloadBackground missing).

- [ ] **Step 3: Implement in `server/settings.js`**

Add after the `DEFAULT_BACKGROUND` line:

```js
export const DEFAULT_DOWNLOAD_BACKGROUND = '/downloadBG.png';
```

Change `WALL_SETTINGS_DEFAULTS` to include it:

```js
export const WALL_SETTINGS_DEFAULTS = {
  maxColumns: 6,
  polaroidWidth: 180,
  background: DEFAULT_BACKGROUND,
  downloadBackground: DEFAULT_DOWNLOAD_BACKGROUND,
};
```

Add a shared URL-string validator just after the `HEX_COLOR` line, and use it from `isValidBackground`'s custom branch:

```js
const isNonEmptyUrl = (value) => typeof value === 'string' && value.length > 0 && value.length <= 2048;
```

Replace the `custom` line inside `isValidBackground` with:

```js
  if (type === 'custom') return isNonEmptyUrl(value);
```

Add a download-background normalizer just after `normalizeBackground`:

```js
// Accept a non-empty URL string; otherwise keep base.
const normalizeDownloadBackground = (value, base) => (isNonEmptyUrl(value) ? value : base);
```

Add `downloadBackground` to the `sanitize` return object (after `background`):

```js
  downloadBackground: normalizeDownloadBackground(source.downloadBackground, base.downloadBackground),
```

Add `downloadBackground` to the `normalizeWallSettings` return object (after `background`):

```js
    downloadBackground: 'downloadBackground' in source
      ? normalizeDownloadBackground(source.downloadBackground, safeBase.downloadBackground)
      : safeBase.downloadBackground,
```

- [ ] **Step 4: Run tests to confirm they PASS**

Run: `npm test`
Expected: PASS — all 28 tests (22 existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add server/settings.js server/settings.test.js
git commit -m "feat(server): validate downloadBackground setting"
```

---

## Task 2: Default asset + shared upload helper + download-background upload

**Files:**
- Add: `public/downloadBG.png` (commit the existing untracked file)
- Modify: `server/index.js`

- [ ] **Step 1: Commit the default download background asset**

```bash
git add public/downloadBG.png
git commit -m "chore(assets): add default download background image"
```

- [ ] **Step 2: Add a route-scoped parser for the new upload route**

In `server/index.js`, find:

```js
app.use('/api/background', express.json({ limit: '12mb' }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
```

Insert the download-background parser before the global one:

```js
app.use('/api/background', express.json({ limit: '12mb' }));
app.use('/api/download-background', express.json({ limit: '12mb' }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
```

- [ ] **Step 3: Add the shared `saveUploadedImage` helper**

In `server/index.js`, add this helper immediately BEFORE the `// API Routes` comment (it uses `approxBytesFromDataUri`, `decodeBase64Image`, `fullImagePath`, `buildImageUrl`, `deleteFileIfExists`, `UPLOAD_DIR`, `MAX_BG_IMAGE_BYTES`, `MAX_BG_IMAGE_MB`, all already defined above):

```js
// Validate + persist a base64 image upload under `<prefix>-<ts>.<ext>`, keeping only
// the newest file for that prefix (write-then-delete). Shared by the wall-background
// (`bg`) and download-background (`dl`) upload routes. Returns { url } or { error }.
async function saveUploadedImage(image, prefix) {
  if (typeof image !== 'string' || !image.startsWith('data:image')) {
    return { error: { status: 400, message: 'Unsupported image format' } };
  }
  if (approxBytesFromDataUri(image) > MAX_BG_IMAGE_BYTES) {
    return { error: { status: 400, message: `Image exceeds ${MAX_BG_IMAGE_MB}MB limit` } };
  }
  const decoded = decodeBase64Image(image);
  if (!decoded) {
    return { error: { status: 400, message: 'Malformed image data' } };
  }

  const extension = decoded.mime === 'image/png' ? 'png' : 'jpg';
  const fileName = `${prefix}-${Date.now()}.${extension}`;
  await fs.writeFile(fullImagePath(fileName), decoded.buffer);

  // Keep only the newest file for this prefix. Done AFTER the write so a failed
  // write never leaves nothing behind.
  try {
    const files = await fs.readdir(UPLOAD_DIR);
    await Promise.all(
      files.filter((f) => f.startsWith(`${prefix}-`) && f !== fileName).map((f) => deleteFileIfExists(f)),
    );
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Failed to clear old ${prefix} uploads:`, err);
  }

  return { url: buildImageUrl(fileName) };
}
```

- [ ] **Step 4: Refactor `/api/background` to use the helper, and add `/api/download-background`**

Replace the entire existing `app.post('/api/background', ...)` handler with these two handlers:

```js
app.post('/api/background', async (req, res) => {
  try {
    const result = await saveUploadedImage(req.body?.image, 'bg');
    if (result.error) return res.status(result.error.status).json({ error: result.error.message });
    return res.status(201).json({ url: result.url });
  } catch (error) {
    console.error('Background upload error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/download-background', async (req, res) => {
  try {
    const result = await saveUploadedImage(req.body?.image, 'dl');
    if (result.error) return res.status(result.error.status).json({ error: result.error.message });
    return res.status(201).json({ url: result.url });
  } catch (error) {
    console.error('Download background upload error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 5: Verify**

Start the server: `npm run server` (background/separate shell; check port 3000 isn't already held by a stale process first — kill it if so). Then:

```bash
PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
# download-bg upload works and keeps-newest
curl -s -X POST http://localhost:3000/api/download-background -H "Content-Type: application/json" -d "{\"image\":\"data:image/png;base64,$PNG\"}"   # -> {"url":"/uploads/dl-<ts>.png"}
curl -s -X POST http://localhost:3000/api/download-background -H "Content-Type: application/json" -d "{\"image\":\"data:image/png;base64,$PNG\"}" -o /dev/null
ls server/uploads/dl-*.png | wc -l   # -> 1
# existing bg upload still works (refactor didn't break it)
curl -s -X POST http://localhost:3000/api/background -H "Content-Type: application/json" -d "{\"image\":\"data:image/png;base64,$PNG\"}"   # -> {"url":"/uploads/bg-<ts>.png"}
# bad payload rejected
curl -s -X POST http://localhost:3000/api/download-background -H "Content-Type: application/json" -d '{"image":"nope"}'   # -> {"error":"Unsupported image format"}
```

Stop the server and clean up: `rm -f server/uploads/dl-*.png server/uploads/bg-*.png`.

- [ ] **Step 6: Commit**

```bash
git add server/index.js
git commit -m "feat(server): add POST /api/download-background via shared upload helper"
```

---

## Task 3: Composite renderer `renderPolaroidDownload`

**Files:**
- Modify: `server/polaroidExport.js`

- [ ] **Step 1: Implement the composite renderer**

In `server/polaroidExport.js`, add at the END of the file (after `renderPolaroidPng`; it reuses that function and the already-imported `createCanvas`/`loadImage`):

```js
// —— Download composite (polaroid centered on a branded background) ——
const DL_POLAROID_WIDTH_FRACTION = 0.62;      // polaroid width vs background width
const DL_POLAROID_MAX_HEIGHT_FRACTION = 0.70; // cap so tall (text-only) cards still fit
const DL_POLAROID_CENTER_Y_FRACTION = 0.54;   // vertical center within the open area

/**
 * Render the polaroid for `photo` and composite it centered onto `bgBuffer`.
 * Output matches the background's native dimensions.
 * @param {object} photo - server photo record
 * @param {Buffer} bgBuffer - the download background image bytes
 * @param {object} deps - same deps as renderPolaroidPng
 * @returns {Promise<Buffer>} PNG
 */
export async function renderPolaroidDownload(photo, bgBuffer, deps) {
  const polaroidBuf = await renderPolaroidPng(photo, deps);
  const [bg, polaroid] = await Promise.all([loadImage(bgBuffer), loadImage(polaroidBuf)]);

  const canvas = createCanvas(bg.width, bg.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bg, 0, 0, bg.width, bg.height);

  let targetW = Math.round(bg.width * DL_POLAROID_WIDTH_FRACTION);
  let scale = targetW / polaroid.width;
  let drawH = Math.round(polaroid.height * scale);
  const maxH = Math.round(bg.height * DL_POLAROID_MAX_HEIGHT_FRACTION);
  if (drawH > maxH) {
    drawH = maxH;
    scale = drawH / polaroid.height;
    targetW = Math.round(polaroid.width * scale);
  }
  const x = Math.round((bg.width - targetW) / 2);
  const y = Math.round(bg.height * DL_POLAROID_CENTER_Y_FRACTION - drawH / 2);
  ctx.drawImage(polaroid, x, y, targetW, drawH);

  return canvas.toBuffer('image/png');
}
```

- [ ] **Step 2: Smoke-test the compositing math with a throwaway script**

Write a temporary script INSIDE `server/` (so its bare `@napi-rs/canvas` and relative `./polaroidExport.js` imports resolve against the server's own `node_modules`). It composites a text-only polaroid onto a solid-color 400x800 background and asserts the output PNG has the background's dimensions.

Write this to `server/_dl-smoke.mjs`:

```js
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { renderPolaroidDownload } from './polaroidExport.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const bg = createCanvas(400, 800);
const bctx = bg.getContext('2d');
bctx.fillStyle = '#200000';
bctx.fillRect(0, 0, 400, 800);
const bgBuf = bg.toBuffer('image/png');

const photo = { id: 't', caption: 'Hello wall!', rotation: -2 };
const deps = { __dirname: serverDir, fullImagePath: () => '', decodeBase64Image: () => null };

const out = await renderPolaroidDownload(photo, bgBuf, deps);
const img = await loadImage(out);
if (img.width !== 400 || img.height !== 800) {
  console.error(`FAIL: expected 400x800, got ${img.width}x${img.height}`);
  process.exit(1);
}
console.log(`OK: composite is ${img.width}x${img.height}, ${out.length} bytes`);
```

Run it, then delete it (it must NOT be committed):
```bash
cd "C:/Users/QK_Nitro2/Desktop/Dev Projects/digital-polaroid" && node server/_dl-smoke.mjs; rm -f server/_dl-smoke.mjs
```
Expected: `OK: composite is 400x800, <N> bytes`. If the fonts fail to register in this environment, proceed anyway — Task 4 verifies the full path via the HTTP endpoint. Confirm the temp file is gone (`ls server/_dl-smoke.mjs` → not found) before committing.

- [ ] **Step 3: Commit**

```bash
git add server/polaroidExport.js
git commit -m "feat(server): composite polaroid onto download background"
```

---

## Task 4: Download endpoint `GET /api/photos/:id/download`

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Import the composite renderer**

In `server/index.js`, change the polaroidExport import:

```js
import { renderPolaroidPng, renderPolaroidDownload, canExportPolaroid } from './polaroidExport.js';
```

- [ ] **Step 2: Add the download-background resolver**

Add this helper next to `saveUploadedImage` (before `// API Routes`). It reads the current `wallSettings.downloadBackground` from disk — an uploaded `/uploads/dl-*.png` from `UPLOAD_DIR`, or a bundled asset (default `/downloadBG.png`) from `DIST_DIR`/`public`, always falling back to the bundled default:

```js
async function resolveDownloadBackgroundBuffer(urlValue) {
  const uploadsPrefix = `${UPLOAD_URL_BASE}/`;
  if (typeof urlValue === 'string' && urlValue.startsWith(uploadsPrefix)) {
    const safe = path.basename(urlValue.slice(uploadsPrefix.length));
    try {
      return await fs.readFile(path.join(UPLOAD_DIR, safe));
    } catch {
      // fall through to the bundled default
    }
  }
  const name = typeof urlValue === 'string' && urlValue ? path.basename(urlValue) : 'downloadBG.png';
  const candidates = [
    path.join(DIST_DIR, name),
    path.resolve(__dirname, '..', 'public', name),
    path.join(DIST_DIR, 'downloadBG.png'),
    path.resolve(__dirname, '..', 'public', 'downloadBG.png'),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // try next
    }
  }
  throw new Error('Download background asset not found');
}
```

- [ ] **Step 3: Add the endpoint**

Add immediately AFTER the existing `app.get('/api/photos/download-all', ...)` handler (so it sits with the other photo routes, before the SPA fallback):

```js
app.get('/api/photos/:id/download', async (req, res) => {
  try {
    const photo = photos.find((p) => p.id === req.params.id);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    let bgBuffer;
    try {
      bgBuffer = await resolveDownloadBackgroundBuffer(wallSettings.downloadBackground);
    } catch (err) {
      console.error('Download background unavailable:', err);
      return res.status(500).json({ error: 'Download background unavailable' });
    }

    const polaroidDeps = { __dirname, fullImagePath, decodeBase64Image };
    const png = await renderPolaroidDownload(photo, bgBuffer, polaroidDeps);

    const safeId = String(photo.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="polaroid-${safeId}.png"`);
    return res.end(png);
  } catch (error) {
    console.error('Polaroid download error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 4: Verify**

Start the server (`npm run server`; ensure port 3000 free). Then:

```bash
PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
# seed a photo
curl -s -X POST http://localhost:3000/api/photos -H "Content-Type: application/json" -d "{\"id\":\"dltest\",\"caption\":\"Hello\",\"timestamp\":1,\"images\":[\"data:image/png;base64,$PNG\"]}" -o /dev/null -w "post %{http_code}\n"
# download the composite — must be a PNG, non-trivial size
curl -s http://localhost:3000/api/photos/dltest/download -o /tmp/dl.png -w "download %{http_code} type=%{content_type}\n"
node -e "const b=require('fs').readFileSync('/tmp/dl.png'); const ok=b[0]===0x89&&b[1]===0x50; console.log('PNG magic:', ok, 'bytes:', b.length); process.exit(ok&&b.length>1000?0:1)"
# missing id -> 404
curl -s http://localhost:3000/api/photos/nope/download -o /dev/null -w "missing %{http_code}\n"   # -> 404
```
Expected: post 201; download 200 with `content_type=image/png`; PNG magic true, size > 1000; missing → 404. Stop the server; `rm -f /tmp/dl.png` and remove the seeded file: `rm -f server/uploads/dltest.png`.

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(server): add GET /api/photos/:id/download composite endpoint"
```

---

## Task 5: Client types + service functions

**Files:**
- Modify: `types.ts`
- Modify: `services/storageService.ts`

- [ ] **Step 1: Extend `types.ts`**

Add after the `DEFAULT_BACKGROUND` line:

```ts
export const DEFAULT_DOWNLOAD_BACKGROUND = '/downloadBG.png';
```

Add `downloadBackground` to the `WallSettings` interface:

```ts
export interface WallSettings {
  maxColumns: number;
  polaroidWidth: number;
  background: WallBackground;
  downloadBackground: string;
}
```

Add it to `WALL_SETTINGS_DEFAULTS`:

```ts
export const WALL_SETTINGS_DEFAULTS: WallSettings = {
  maxColumns: 6,
  polaroidWidth: 180,
  background: DEFAULT_BACKGROUND,
  downloadBackground: DEFAULT_DOWNLOAD_BACKGROUND,
};
```

- [ ] **Step 2: Add service functions in `services/storageService.ts`**

Add `uploadDownloadBackground` immediately after the existing `uploadBackground` function:

```ts
export const uploadDownloadBackground = async (
  dataUrl: string
): Promise<{ success: boolean; url?: string; error?: string }> => {
  try {
    const res = await fetch(`${API_URL}/api/download-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    if (!res.ok) {
      let message = 'Failed to upload download background';
      try {
        const payload = await res.json();
        if (payload?.error) message = payload.error;
      } catch {
        // ignore non-JSON error bodies
      }
      return { success: false, error: message };
    }
    const data = await res.json();
    return { success: true, url: toAbsoluteUrl(data.url) };
  } catch (e) {
    console.error('Error uploading download background', e);
    return { success: false, error: 'Unable to reach server' };
  }
};
```

Add `downloadPolaroid` immediately after `downloadAllPhotos`:

```ts
export const downloadPolaroid = async (photoId: string): Promise<{ success: boolean; error?: string }> => {
  try {
    const response = await fetch(`${API_URL}/api/photos/${photoId}/download`);
    if (!response.ok) {
      let message = 'Failed to generate your polaroid';
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch {
        // ignore non-JSON error bodies
      }
      return { success: false, error: message };
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `polaroid-${photoId}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);

    return { success: true };
  } catch (error) {
    console.error('Error downloading polaroid', error);
    return { success: false, error: 'Unable to reach server' };
  }
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add types.ts services/storageService.ts
git commit -m "feat(client): add downloadBackground type + polaroid download service"
```

---

## Task 6: UploadView posted state + download button

**Files:**
- Modify: `components/UploadView.tsx`

- [ ] **Step 1: Imports + state**

Update the storageService import (line 4) to add `downloadPolaroid`:

```tsx
import { compressImage, savePhoto, downloadPolaroid } from '../services/storageService';
```

After the existing `const [stage, setStage] = ...` state line, add:

```tsx
  const [postedPhotoId, setPostedPhotoId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
```

- [ ] **Step 2: Enter the posted state on success (don't auto-reset)**

In `handleSubmit`, replace the success branch (`if (result.success) { setTimeout(... full reset ...) } else { ... }`) with:

```tsx
      if (result.success) {
        setIsUploading(false);
        setPostedPhotoId(result.photo?.id ?? newPhoto.id);
        showToast("Posted to the wall!", "success");
      } else {
        setIsUploading(false);
        showToast(result.error || "Could not save photo. Check connection.", "error");
      }
```

- [ ] **Step 3: Add download + done handlers**

Add these after `handleSubmit`:

```tsx
  const handleDownload = async () => {
    if (!postedPhotoId) return;
    setIsDownloading(true);
    const res = await downloadPolaroid(postedPhotoId);
    setIsDownloading(false);
    if (!res.success) {
      showToast(res.error || "Could not generate your polaroid", "error");
    }
  };

  const handleDone = () => {
    setPostedPhotoId(null);
    setIsDownloading(false);
    removeImage();
  };
```

- [ ] **Step 4: Swap the button row when posted**

Replace the submit button row block (the `<div>` containing the `Cancel` and `Post to Wall` buttons) with a conditional on `postedPhotoId`:

```tsx
            <div className={`
                mt-4 sm:mt-6 flex gap-3 transition-all duration-500 delay-300
                ${stage === 'spotlight' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}
            `}>
              {postedPhotoId ? (
                <>
                  <button
                    onClick={handleDone}
                    className="px-4 py-2 rounded-full font-bold text-base text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
                  >
                    Done
                  </button>
                  <button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500 text-white px-6 py-2 rounded-full font-bold text-base shadow-lg hover:shadow-xl hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isDownloading ? 'Preparing...' : 'Download my polaroid'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={removeImage}
                    disabled={isUploading}
                    className="px-4 py-2 rounded-full font-bold text-base text-zinc-400 hover:text-white hover:bg-white/10 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500 text-white px-6 py-2 rounded-full font-bold text-base shadow-lg hover:shadow-xl hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isUploading ? 'Posting...' : 'Post to Wall'}
                  </button>
                </>
              )}
            </div>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/UploadView.tsx
git commit -m "feat(upload): download your polaroid after posting"
```

---

## Task 7: Admin download-background upload field

**Files:**
- Modify: `components/AdminView.tsx`

- [ ] **Step 1: Imports**

Add `uploadDownloadBackground` to the storageService import, and add `DEFAULT_DOWNLOAD_BACKGROUND` to the types import:

```tsx
import { PhotoEntry, WallSettings, WALL_SETTINGS_DEFAULTS, WALL_SETTINGS_BOUNDS, DEFAULT_DOWNLOAD_BACKGROUND } from '../types';
```
(Keep the existing storageService import line and add `uploadDownloadBackground` to its list.)

- [ ] **Step 2: State + handler**

After the existing `const [isUploadingBg, setIsUploadingBg] = useState(false);` line, add:

```tsx
  const [isUploadingDlBg, setIsUploadingDlBg] = useState(false);
```

After `handleBackgroundFile`, add:

```tsx
  const handleDownloadBgFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast('Image exceeds 8MB limit', 'error');
      return;
    }
    setIsUploadingDlBg(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const result = await uploadDownloadBackground(dataUrl);
      if (result.success && result.url) {
        updateSettings({ downloadBackground: result.url });
        showToast('Download background updated', 'success');
      } else {
        showToast(result.error || 'Failed to upload download background', 'error');
      }
    } catch {
      showToast('Failed to read image', 'error');
    } finally {
      setIsUploadingDlBg(false);
    }
  };
```

- [ ] **Step 3: Render the field**

Insert this block immediately BEFORE the `<button type="button" onClick={handleResetSettings}` element (i.e. after the wall Background `mt-6` group, before the Reset button):

```tsx
        <div className="mt-6">
          <span className="text-sm text-zinc-400">Download background</span>
          <div className="mt-2">
            <input
              type="file"
              accept="image/*"
              onChange={handleDownloadBgFile}
              disabled={isUploadingDlBg}
              className="text-sm text-zinc-300"
            />
            {isUploadingDlBg && <span className="ml-2 text-xs text-zinc-400">Uploading…</span>}
            <p className="mt-2 text-xs text-zinc-500 break-all">Current: {settings.downloadBackground}</p>
            <button
              type="button"
              onClick={() => updateSettings({ downloadBackground: DEFAULT_DOWNLOAD_BACKGROUND })}
              className="mt-2 bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              Use default
            </button>
          </div>
        </div>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/AdminView.tsx
git commit -m "feat(admin): add download background upload field"
```

---

## Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Build + start the single-service app**

```bash
npm run build
```
Start the `app` launch config (server on 3000, serving fresh `dist` + API; ensure nothing stale is on 3000 first).

- [ ] **Step 2: Post a photo and download the composite (UI flow)**

Open the preview at `#/` (upload view). Because the camera flow needs a file, drive it programmatically instead: use `preview_eval` to POST a photo and then verify the download endpoint returns a valid PNG from the browser context:
```js
(async () => {
  const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await fetch('/api/photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'e2e1',caption:'Legacy!',timestamp:1,images:[PNG]})});
  const r = await fetch('/api/photos/e2e1/download');
  const b = await r.blob();
  return JSON.stringify({ status: r.status, type: r.headers.get('content-type'), bytes: b.size });
})()
```
Expected: `status 200`, `type "image/png"`, `bytes` > 1000.

- [ ] **Step 3: Verify the UploadView posted-state button wiring**

Reload `#/`. Drive the DOM: set an image + caption via the app is complex, so instead verify the download service path is wired by confirming the button appears after a simulated post is not required — rely on Step 2 for the endpoint and confirm `downloadPolaroid` exists on the client bundle:
```js
(async () => { const r = await fetch('/api/photos/e2e1/download'); return 'download endpoint reachable: ' + r.ok; })()
```
Expected: `download endpoint reachable: true`. (The posted-state UI wiring was typechecked in Task 6; this confirms the endpoint it calls works end-to-end.)

- [ ] **Step 4: Verify admin custom download background is used**

Open `#/admin`, log in (`admin`). In "Download background", the Current line should read `/downloadBG.png`. Then from the page context upload a custom one and confirm the endpoint composites over it and only one `dl-*` remains:
```js
(async () => {
  const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const up = await (await fetch('/api/download-background',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:PNG})})).json();
  await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({downloadBackground: up.url})});
  const r = await fetch('/api/photos/e2e1/download');
  return JSON.stringify({ uploaded: up.url, downloadStatus: r.status });
})()
```
Expected: `uploaded` like `/uploads/dl-<ts>.png` (or absolute), `downloadStatus 200`. Then in a shell: `ls server/uploads/dl-*.* | wc -l` → 1. Click "Use default" in the admin UI and confirm `curl -s http://localhost:3000/api/settings` shows `downloadBackground` back to `/downloadBG.png`.

- [ ] **Step 5: View the composite for visual confirmation + tune placement**

The endpoint sends `Content-Disposition: attachment`, so navigating to it downloads rather than displays. Instead, fetch it as a blob and inject it as an `<img>` filling the viewport, then screenshot:
```js
(async () => {
  const r = await fetch('/api/photos/e2e1/download');
  const url = URL.createObjectURL(await r.blob());
  document.body.innerHTML = '';
  const img = document.createElement('img');
  img.src = url;
  img.style.cssText = 'position:fixed;inset:0;margin:auto;max-width:100vw;max-height:100vh;';
  document.body.appendChild(img);
  await new Promise((res) => { img.onload = res; });
  return `${img.naturalWidth}x${img.naturalHeight}`;
})()
```
Take a `preview_screenshot`. Confirm the polaroid sits in the open middle area — centered, clear of the top "Live the Legacy" branding and the bottom skyline glow. If it's poorly placed (overlapping branding/skyline, or too big/small), adjust `DL_POLAROID_WIDTH_FRACTION` / `DL_POLAROID_CENTER_Y_FRACTION` / `DL_POLAROID_MAX_HEIGHT_FRACTION` in `server/polaroidExport.js`, `npm run build`, restart the server, and re-check. Commit any tuning as `fix(server): tune download composite placement`.

- [ ] **Step 6: Final gate + cleanup**

```bash
npm test            # 28 pass
npx tsc --noEmit    # clean
```
Stop the server; remove test artifacts: `rm -f server/uploads/e2e1.png server/uploads/dl-*.*`.

- [ ] **Step 7: Commit (only if verification required tweaks)**

```bash
git add -A
git commit -m "chore: verify polaroid download end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** settings field + default + validation (Task 1, 5); default asset committed (Task 2); shared upload helper + `/api/download-background` keep-newest (Task 2); composite renderer with placement constants (Task 3); `GET /api/photos/:id/download` + background resolution (Task 4); client `uploadDownloadBackground` + `downloadPolaroid` (Task 5); UploadView posted state + button (Task 6); admin upload field + Use default (Task 7); server tests + manual/preview incl. text-only and placement tuning (Task 1, 8). No gaps.
- **Type/name consistency:** `downloadBackground`, `DEFAULT_DOWNLOAD_BACKGROUND`, `isNonEmptyUrl`, `normalizeDownloadBackground`, `saveUploadedImage`, `resolveDownloadBackgroundBuffer`, `renderPolaroidDownload`, `uploadDownloadBackground`, `downloadPolaroid`, route `/api/download-background`, `GET /api/photos/:id/download`, `dl-*` prefix — used identically across tasks.
- **Existing-code impact:** Task 2 refactors the shipped `/api/background` handler to the shared helper (behavior-preserving; verified by curl in Step 5). Task 1 updates the five default-shape settings assertions so the suite stays green (28 total).
- **Known non-issue:** the client 8MB check duplicates the server's env-overridable `MAX_BG_IMAGE_MB` (documented in the background feature); both default to 8MB.
