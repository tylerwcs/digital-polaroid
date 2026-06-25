# Bubble Download Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/download` page where guests swipe a carousel of all uploaded bubbles (newest first), pick theirs, and download a shareable **mp4** of the bubble floating over an animated background — rendered server-side with ffmpeg. Repoint the wall's bottom-right QR to this page.

**Architecture:** The client composites the chosen bubble (photo + signature + `bubble.png`) into a transparent PNG using the shared `BubbleFrame` geometry, then POSTs it to a new `POST /api/export-video` endpoint. The server runs ffmpeg to float that PNG over `public/exportBG.mp4` (1080×1920, ~8s, muted) and streams back an H.264 mp4. The download page reuses `getPhotos()` (already newest-first) and `BubbleFrame` so bubbles are pixel-identical to the wall.

**Tech Stack:** React 19, TypeScript, Tailwind, Vite (frontend); Express + Socket.IO + ffmpeg via `child_process` (backend). No new npm dependencies (ffmpeg is a system binary).

**Testing approach:** No test framework in the repo — each task verifies with `npx tsc --noEmit` and explicit manual checks. ffmpeg must be installed on the backend machine (present on this Windows box; `ffmpeg -version` confirms).

**Spec:** [docs/superpowers/specs/2026-06-26-bubble-download-design.md](../specs/2026-06-26-bubble-download-design.md)

---

## File Structure

**New files:**
- `lib/composeBubbleImage.ts` — compose a `PhotoEntry` into a transparent bubble PNG (taint-safe)
- `services/exportService.ts` — `requestBubbleVideo()` + `downloadBlob()`
- `components/BubbleCarousel.tsx` — swipe carousel of bubbles over the export background
- `components/DownloadView.tsx` — the `/download` page (fetch, carousel, per-slide download flow)

**Modified files:**
- `server/index.js` — add `POST /api/export-video` (ffmpeg overlay → mp4)
- `components/DisplayView.tsx` — repoint QR to `/#/download`, relabel "Scan to Download"
- `App.tsx` — add the `/download` route
- `.gitignore` — track `public/exportBG.mp4`

**Asset:** replace old `public/exportBG.mp4` (1336×1548) with the 9:16 file (`exportBG-new.mp4` → `exportBG.mp4`).

**Untouched:** wall physics, upload/camera flow, `BubbleFrame`, `lib/bubbleGeometry.ts`, `/wall-6`, admin.

---

## Task 1: Standardize the export background asset

**Files:**
- Delete: `public/exportBG.mp4` (old 1336×1548)
- Rename: `public/exportBG-new.mp4` → `public/exportBG.mp4`
- Modify: `.gitignore`

- [ ] **Step 1: Swap the asset files**

Run (Git Bash):
```bash
rm "public/exportBG.mp4"
mv "public/exportBG-new.mp4" "public/exportBG.mp4"
```

- [ ] **Step 2: Verify the canonical file is 9:16**

Run: `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 public/exportBG.mp4`
Expected: `1080,1920`

- [ ] **Step 3: Track the asset in git**

Edit `.gitignore` — find this existing block:

```
# Bubble-theme variant background video (see docs/BUBBLE_VARIANT.md)
!public/bubbleBG.mp4
```

Replace it with:

```
# Bubble-theme variant background video (see docs/BUBBLE_VARIANT.md)
!public/bubbleBG.mp4
# Download-page export background (see docs/superpowers/specs/2026-06-26-bubble-download-design.md)
!public/exportBG.mp4
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore public/exportBG.mp4
git commit -m "chore(download): standardize 9:16 exportBG.mp4 and track it"
```

---

## Task 2: Client bubble compositing (`lib/composeBubbleImage.ts`)

Produces a transparent PNG of the bubble identical to the wall, taint-safe for cross-origin photos.

**Files:**
- Create: `lib/composeBubbleImage.ts`

- [ ] **Step 1: Create the module**

Create `lib/composeBubbleImage.ts`:

```typescript
import { PhotoEntry } from '../types';
import { PHOTO_INSET_RATIO, SIGNATURE_BAND_HEIGHT_RATIO } from './bubbleGeometry';

// Load an image source as an untainted bitmap. Cross-origin photo URLs (served from
// the API origin, a different port than the page) would taint a canvas if drawn via
// a plain <img>, blocking toDataURL. Fetching as a blob first avoids the taint.
const loadBitmap = async (src: string): Promise<ImageBitmap> => {
  const res = await fetch(src);
  if (!res.ok) throw new Error('Failed to load image');
  const blob = await res.blob();
  return createImageBitmap(blob);
};

// Draw `bitmap` into a circle of diameter `size` at (cx, cy top-left = offset),
// cover-style (center-crop to fill the circle).
const drawCover = (
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  x: number,
  y: number,
  size: number,
) => {
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  const dx = x + (size - dw) / 2;
  const dy = y + (size - dh) / 2;
  ctx.drawImage(bitmap, dx, dy, dw, dh);
};

/**
 * Compose a PhotoEntry into a transparent square PNG (data URL) of the bubble:
 * circular photo + signature band + bubble.png rim — matching BubbleFrame exactly.
 */
export const composeBubbleImage = async (
  photo: PhotoEntry,
  size = 800,
): Promise<string> => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  const photoSize = size * PHOTO_INSET_RATIO;
  const photoOffset = (size - photoSize) / 2;

  const imageUrl = photo.imageUrl || (photo.images && photo.images[0]) || '';

  // 1. Photo, clipped to the circle
  if (imageUrl) {
    const photoBitmap = await loadBitmap(imageUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, photoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    drawCover(ctx, photoBitmap, photoOffset, photoOffset, photoSize);

    // 2. Signature in the bottom band (still inside the circular clip)
    if (photo.signature) {
      const sigBitmap = await loadBitmap(photo.signature);
      const bandH = photoSize * SIGNATURE_BAND_HEIGHT_RATIO;
      const bandTop = photoOffset + photoSize - bandH;
      // contain, bottom-centered
      const scale = Math.min(photoSize / sigBitmap.width, bandH / sigBitmap.height);
      const dw = sigBitmap.width * scale;
      const dh = sigBitmap.height * scale;
      const dx = photoOffset + (photoSize - dw) / 2;
      const dy = bandTop + (bandH - dh);
      ctx.drawImage(sigBitmap, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  // 3. Bubble rim overlay (full square, on top)
  const rim = await loadBitmap('/bubble.png');
  ctx.drawImage(rim, 0, 0, size, size);

  return canvas.toDataURL('image/png');
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/composeBubbleImage.ts
git commit -m "feat(download): add taint-safe bubble PNG compositor"
```

---

## Task 3: Export service client (`services/exportService.ts`)

**Files:**
- Create: `services/exportService.ts`

- [ ] **Step 1: Create the service**

Create `services/exportService.ts`:

```typescript
const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  return `http://${window.location.hostname}:3000`;
};

const API_URL = (import.meta.env.VITE_API_URL || getApiUrl()).replace(/\/+$/, '');

/**
 * Send a composited bubble PNG to the server and get back the rendered mp4 blob.
 * `photoId` is used only for the download filename.
 */
export const requestBubbleVideo = async (
  bubblePng: string,
  photoId?: string,
): Promise<Blob> => {
  const res = await fetch(`${API_URL}/api/export-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bubblePng, photoId }),
  });

  if (!res.ok) {
    let message = 'Could not create the video. Please try again.';
    try {
      const payload = await res.json();
      if (payload?.error) message = payload.error;
    } catch {
      // non-JSON error body; keep default message
    }
    throw new Error(message);
  }

  return res.blob();
};

/** Trigger a browser download of a blob. */
export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add services/exportService.ts
git commit -m "feat(download): add export service (requestBubbleVideo + downloadBlob)"
```

---

## Task 4: Server export endpoint (`POST /api/export-video`)

Runs ffmpeg to float the bubble PNG over `public/exportBG.mp4` and streams back an mp4.

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add imports and config constants**

In `server/index.js`, the existing imports start with `import 'dotenv/config';`. Add these imports after the existing import block (after the `import { renderPolaroidPng, canExportPolaroid } from './polaroidExport.js';` line):

```javascript
import os from 'os';
import { spawn } from 'child_process';
import crypto from 'crypto';
```

Then, after the existing config constants (after the line `const ENABLE_DISK_CACHE = (process.env.ENABLE_DISK_CACHE || 'false').toLowerCase() === 'true';`), add:

```javascript
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const MAX_CONCURRENT_EXPORTS = parseInt(process.env.MAX_CONCURRENT_EXPORTS || '2', 10);
const EXPORT_BG_PATH = path.resolve(__dirname, '..', 'public', 'exportBG.mp4');
const BUBBLE_WIDTH = parseInt(process.env.EXPORT_BUBBLE_WIDTH || '760', 10);   // overlay bubble width (px)
const FLOAT_AMPLITUDE = parseInt(process.env.EXPORT_FLOAT_AMP || '70', 10);    // vertical float (px)
const FLOAT_PERIOD = parseFloat(process.env.EXPORT_FLOAT_PERIOD || '3.5');     // float cycle (s)
const EXPORT_DURATION = parseFloat(process.env.EXPORT_DURATION || '8');        // output length (s)

let activeExports = 0;
```

- [ ] **Step 2: Add a helper to run ffmpeg, before the `// API Routes` comment**

In `server/index.js`, just above the `// API Routes` comment, add:

```javascript
// Render the floating-bubble export video. Resolves with the output mp4 path.
const renderExportVideo = (bubblePngPath, outPath) =>
  new Promise((resolve, reject) => {
    const overlayY = `(H-h)/2+${FLOAT_AMPLITUDE}*sin(2*PI*t/${FLOAT_PERIOD})`;
    const filter =
      `[1:v]scale=${BUBBLE_WIDTH}:-1[b];` +
      `[0:v][b]overlay=(W-w)/2:${overlayY}[v]`;

    const args = [
      '-y',
      '-i', EXPORT_BG_PATH,
      '-loop', '1', '-i', bubblePngPath,
      '-filter_complex', filter,
      '-map', '[v]',
      '-an',
      '-t', String(EXPORT_DURATION),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'veryfast',
      '-movflags', '+faststart',
      outPath,
    ];

    const proc = spawn(FFMPEG_PATH, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      reject(new Error(`ffmpeg failed to start (${err.message}). Is ffmpeg installed?`));
    });
    proc.on('close', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
```

- [ ] **Step 3: Add the route, after the existing `download-all` route**

In `server/index.js`, after the `app.get('/api/photos/download-all', ...)` handler closes (the line with `await archive.finalize();` followed by `});`), add:

```javascript
app.post('/api/export-video', async (req, res) => {
  if (activeExports >= MAX_CONCURRENT_EXPORTS) {
    return res.status(429).json({ error: 'Server is busy. Please retry shortly.' });
  }

  const { bubblePng, photoId } = req.body || {};
  const decoded = decodeBase64Image(typeof bubblePng === 'string' ? bubblePng : '');
  if (!decoded || decoded.mime !== 'image/png') {
    return res.status(400).json({ error: 'Invalid bubble image' });
  }

  activeExports += 1;
  const token = crypto.randomBytes(8).toString('hex');
  const tmpPng = path.join(os.tmpdir(), `bubble-${token}.png`);
  const tmpMp4 = path.join(os.tmpdir(), `bubble-${token}.mp4`);
  const safeId = String(photoId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    await fs.writeFile(tmpPng, decoded.buffer);
    await renderExportVideo(tmpPng, tmpMp4);

    const videoBuffer = await fs.readFile(tmpMp4);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="bubble-${safeId}.mp4"`);
    res.send(videoBuffer);
  } catch (error) {
    console.error('Export video error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to render the video. Please try again.' });
    }
  } finally {
    await deleteTmp(tmpPng);
    await deleteTmp(tmpMp4);
    activeExports = Math.max(activeExports - 1, 0);
  }
});
```

- [ ] **Step 4: Add the `deleteTmp` helper next to `deleteFileIfExists`**

In `server/index.js`, right after the `deleteFileIfExists` function definition (after its closing `};`), add:

```javascript
const deleteTmp = async (filePath) => {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Failed to remove temp file ${filePath}:`, error);
    }
  }
};
```

- [ ] **Step 5: Verify the server starts**

Run: `node server/index.js`
Expected: prints `Server running on http://0.0.0.0:3000` with no errors. Stop it with Ctrl+C.

- [ ] **Step 6: Smoke-test the endpoint with a tiny PNG**

With the server running in another terminal, run (Git Bash):
```bash
# 1x1 transparent PNG, base64
PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
curl -s -X POST http://localhost:3000/api/export-video \
  -H "Content-Type: application/json" \
  -d "{\"bubblePng\":\"$PNG\",\"photoId\":\"smoke\"}" \
  -o /tmp/smoke.mp4 -D -
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name -of default=noprint_wrappers=1 /tmp/smoke.mp4
```
Expected: response headers include `Content-Type: video/mp4` and `Content-Disposition: attachment; filename="bubble-smoke.mp4"`; ffprobe reports `codec_name=h264`, `width=1080`, `height=1920`.

- [ ] **Step 7: Commit**

```bash
git add server/index.js
git commit -m "feat(download): add POST /api/export-video ffmpeg render endpoint"
```

---

## Task 5: Bubble carousel (`components/BubbleCarousel.tsx`)

Swipeable, newest-first, with a live floating preview over the export background.

**Files:**
- Create: `components/BubbleCarousel.tsx`

- [ ] **Step 1: Add the float + carousel CSS to index.html**

`index.html` already has a `<style>` block in `<head>`. Find the existing `.animate-pulse-subtle` rule near the end of that block:

```css
      .animate-pulse-subtle {
        animation: pulseSubtle 3s ease-in-out infinite;
      }
```

Immediately after it (still inside `<style>`, before `</style>`), add:

```css
      /* Download carousel: gentle bubble float */
      @keyframes bubbleFloat {
        0%, 100% { transform: translateY(-12px); }
        50%      { transform: translateY(12px); }
      }
      .animate-bubble-float {
        animation: bubbleFloat 3.5s ease-in-out infinite;
      }
      .carousel-track {
        scroll-snap-type: x mandatory;
        -webkit-overflow-scrolling: touch;
      }
      .carousel-track::-webkit-scrollbar { display: none; }
      .carousel-slide { scroll-snap-align: center; }
```

- [ ] **Step 2: Create the component**

Create `components/BubbleCarousel.tsx` (reuses the existing `Bubble` component so the
carousel bubble is identical to the wall — no duplicated photo/signature markup):

```typescript
import React, { useEffect, useRef, useState } from 'react';
import { PhotoEntry } from '../types';
import { Bubble } from './Bubble';

interface BubbleCarouselProps {
  photos: PhotoEntry[];                       // newest first
  diameter: number;
  renderActions: (photo: PhotoEntry, index: number) => React.ReactNode;
}

export const BubbleCarousel: React.FC<BubbleCarouselProps> = ({
  photos,
  diameter,
  renderActions,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // Track which slide is centered (for the position indicator).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      setActive(Math.max(0, Math.min(photos.length - 1, idx)));
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => track.removeEventListener('scroll', onScroll);
  }, [photos.length]);

  return (
    <div className="relative w-full flex flex-col items-center gap-4">
      <div
        ref={trackRef}
        className="carousel-track w-full flex overflow-x-auto overflow-y-hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        {photos.map((photo, i) => (
          <div
            key={photo.id}
            className="carousel-slide shrink-0 w-full flex flex-col items-center justify-center gap-6 px-4"
          >
            <div className="animate-bubble-float">
              <Bubble photo={photo} diameter={diameter} />
            </div>
            {renderActions(photo, i)}
          </div>
        ))}
      </div>

      {/* Position indicator */}
      <div className="text-white/80 text-sm font-medium">
        {active + 1} / {photos.length}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/BubbleCarousel.tsx index.html
git commit -m "feat(download): add swipeable bubble carousel with float preview"
```

---

## Task 6: Download page (`components/DownloadView.tsx`) + route

Wires the carousel to the compose → request → download flow over the export background.

**Files:**
- Create: `components/DownloadView.tsx`
- Modify: `App.tsx`

- [ ] **Step 1: Create the page**

Create `components/DownloadView.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import { getPhotos } from '../services/storageService';
import { PhotoEntry } from '../types';
import { useToast } from '../context/ToastContext';
import { BubbleCarousel } from './BubbleCarousel';
import { composeBubbleImage } from '../lib/composeBubbleImage';
import { requestBubbleVideo, downloadBlob } from '../services/exportService';

const DownloadView: React.FC = () => {
  const { showToast } = useToast();
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Responsive bubble size (portrait-first).
  const [diameter, setDiameter] = useState(300);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setDiameter(Math.round(Math.max(200, Math.min(w * 0.8, h * 0.5))));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPhotos().then((loaded) => {
      if (!cancelled) {
        setPhotos(loaded);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const handleDownload = async (photo: PhotoEntry) => {
    setBusyId(photo.id);
    try {
      const bubblePng = await composeBubbleImage(photo, 800);
      const blob = await requestBubbleVideo(bubblePng, photo.id);
      downloadBlob(blob, `bubble-${photo.id}.mp4`);
      showToast('Saved! Check your downloads.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not create the video.';
      showToast(msg, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-[100dvh] w-screen bg-black text-white relative overflow-hidden flex flex-col items-center justify-center py-[max(1rem,env(safe-area-inset-top))]">
      {/* Export background, shared behind the carousel */}
      <video
        className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
        src="/exportBG.mp4"
        autoPlay
        muted
        loop
        playsInline
        aria-hidden
      />

      <div className="relative z-10 w-full flex flex-col items-center gap-6">
        <h1 className="text-xl font-semibold drop-shadow">Find your bubble</h1>

        {loading ? (
          <p className="text-white/70">Loading bubbles…</p>
        ) : photos.length === 0 ? (
          <p className="text-white/70 text-center px-8">No bubbles yet — check back soon!</p>
        ) : (
          <BubbleCarousel
            photos={photos}
            diameter={diameter}
            renderActions={(photo) => (
              <button
                onClick={() => handleDownload(photo)}
                disabled={busyId !== null}
                className="px-8 py-3 rounded-full bg-white text-black font-semibold active:scale-95 transition-transform disabled:opacity-60"
              >
                {busyId === photo.id ? 'Creating your video…' : 'Download'}
              </button>
            )}
          />
        )}
      </div>
    </div>
  );
};

export default DownloadView;
```

- [ ] **Step 2: Add the route in `App.tsx`**

In `App.tsx`, add the import after the other component imports:

```typescript
import DownloadView from './components/DownloadView';
```

Then add the route inside `<Routes>`, after the `/wall-6` route:

```typescript
          {/* Download page (carousel + video export) */}
          <Route path="/download" element={<DownloadView />} />
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual check — download flow**

Run `npm run dev`. With at least one uploaded bubble, open `/#/download`. Confirm:
- The carousel shows bubbles, newest first, floating over the export background.
- Swiping left/right changes slides; the "N / total" indicator updates.
- Tapping Download shows "Creating your video…", then downloads an mp4 that plays (bubble floating over the background, ~8s, muted).

- [ ] **Step 5: Commit**

```bash
git add components/DownloadView.tsx App.tsx
git commit -m "feat(download): add DownloadView page and /download route"
```

---

## Task 7: Repoint the wall QR to the download page

**Files:**
- Modify: `components/DisplayView.tsx`

- [ ] **Step 1: Point the QR value at the download route**

In `components/DisplayView.tsx`, find the QR code element. It currently renders:

```tsx
            <QRCodeSVG value={uploadUrl} size={100} level="H" bgColor="#ffffff" fgColor="#000000" />
```

Replace the `value` so it targets the download page (the hash route), keeping all other props:

```tsx
            <QRCodeSVG value={`${uploadUrl}/#/download`} size={100} level="H" bgColor="#ffffff" fgColor="#000000" />
```

- [ ] **Step 2: Relabel the caption**

In the same QR card, find:

```tsx
            <p className="text-center text-xs font-semibold mt-2 text-black">Scan to Upload</p>
```

Replace with:

```tsx
            <p className="text-center text-xs font-semibold mt-2 text-black">Scan to Download</p>
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual check**

Run `npm run dev`, open `/#/wall`. Confirm the bottom-right QR card reads "Scan to Download". Scan it with a phone on the same LAN (or decode it) and confirm it resolves to `<origin>/#/download`.

- [ ] **Step 5: Commit**

```bash
git add components/DisplayView.tsx
git commit -m "feat(wall): repoint bottom-right QR to the download page"
```

---

## Task 8: End-to-end manual verification

No code. Exercises the full feature against the spec.

- [ ] **Step 1: Start both servers**

Run: `npm run dev` (starts the Vite frontend and the Node backend via the `dev` script). Confirm the backend logs `Server running on http://0.0.0.0:3000`.

- [ ] **Step 2: Seed a bubble**

If there are no photos, capture one on the upload page (`/`) so the carousel has content (with a signature, to verify signature fidelity).

- [ ] **Step 3: Wall QR → download page**

Open `/#/wall`; confirm the QR reads "Scan to Download" and resolves to `/#/download`. Open `/#/download`.

- [ ] **Step 4: Carousel**

Confirm: bubbles newest-first; horizontal swipe with snap; "N / total" indicator; each bubble floats over the export background; bubbles look identical to the wall (photo crop + signature placement).

- [ ] **Step 5: Download an mp4 (fidelity)**

Tap Download. Confirm: "Creating your video…" state, then an mp4 downloads. Play it: the bubble is centered, floating up/down, over the 9:16 animated background, muted, ~8s. The bubble matches the wall bubble exactly.

- [ ] **Step 6: Filename + format**

Confirm the downloaded file is named `bubble-<id>.mp4` and is H.264 mp4 (`ffprobe` it: `codec_name=h264`, `1080x1920`).

- [ ] **Step 7: Error paths**

- Stop the backend, tap Download → confirm an error toast and the UI recovers (button re-enabled).
- Empty library (delete all via `/#/admin`) → `/#/download` shows "No bubbles yet — check back soon!".

- [ ] **Step 8: Concurrency guard (optional)**

Tap Download on several bubbles in rapid succession across tabs; confirm requests beyond `MAX_CONCURRENT_EXPORTS` get a "Server is busy" toast rather than failing hard.

- [ ] **Step 9: Portrait layout**

On a phone-sized portrait viewport, confirm the carousel, bubble, indicator, and Download button all fit without scrolling and are touch-reachable.

---

## Out of Scope (this plan)

- Wall physics, upload/camera flow, admin, `/wall-6` changes.
- Audio in the export (muted by decision).
- Per-guest auth/identification.
- Client-side video encoding (WebCodecs/ffmpeg.wasm).
- Installing ffmpeg on remote hosts (deployment step; documented in the spec only).
