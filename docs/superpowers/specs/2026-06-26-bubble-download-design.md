# Bubble Download Page — Design Spec

**Date:** 2026-06-26
**Branch:** `claude/admiring-swirles-1b8625` (bubble-theme variant — see `docs/BUBBLE_VARIANT.md`)
**Scope:** Add a download page where guests browse a carousel of all uploaded bubbles (newest
first), pick their own, and download it as an **mp4 video** — the bubble floating gently over an
animated background (`exportBG.mp4`). The wall's bottom-right QR is repointed to this page.

## Goal

Let event guests scan the wall QR, find their bubble in a swipeable carousel, and download a
shareable (Instagram-friendly) mp4 of their bubble floating over a branded animated background.

## Requirements (from the user)

1. A download page, reachable from the wall's bottom-right QR code (the QR repoints from upload to download).
2. The page lists all uploaded bubble pictures as a swipeable carousel; the guest swipes left/right to find theirs.
3. The latest uploaded bubble is first in the carousel.
4. Downloading produces a **video file**: the bubble centered, doing a subtle floating up/down animation, over the `exportBG.mp4` animated background.
5. Output must be **mp4** (webm is not accepted by Instagram and similar) — chosen export approach guarantees mp4.

## Key decisions

- **Export mechanism: server-side ffmpeg (Approach B).** Guarantees a clean H.264 mp4 on every
  device, independent of the guest's phone/browser. The alternative (client-side
  canvas + MediaRecorder) was rejected because it yields webm on Android, which social platforms reject.
- **Background asset:** `public/exportBG.mp4`, **1080×1920 (9:16)**, ~8s, H.264, muted output.
  (The previous 1336×1548 file is replaced by the new 9:16 file.)
- **Client composites the bubble, server only does ffmpeg.** The client renders the bubble (photo +
  signature + `bubble.png` rim) to a transparent PNG using the shared `BubbleFrame` geometry, so the
  downloaded video's bubble is pixel-identical to the wall. The server needs only ffmpeg — no
  server-side image library.
- **Muted, full background length (~8s), bubble floats ±70px over a ~3.5s cycle.**

## Architecture

### Flow

Wall QR → `/#/download` → `getPhotos()` (newest-first) → swipe carousel → tap **Download** on a
slide → client composites that bubble to a PNG → `POST /api/export-video` → server ffmpeg overlays
the PNG (floating) on `exportBG.mp4` → returns mp4 → browser downloads `bubble-<id>.mp4`.

### New files

- `components/DownloadView.tsx` — the `/download` page: fetches photos, renders the carousel, owns
  the per-slide download flow + states.
- `components/BubbleCarousel.tsx` — horizontal swipe carousel (CSS scroll-snap), one bubble per slide,
  newest first, with a live floating preview over a shared `exportBG.mp4` background element, plus a
  position indicator.
- `lib/composeBubbleImage.ts` — `composeBubbleImage(photo, size)`: fetches the photo as a blob
  (`createImageBitmap`, avoids canvas taint), draws photo + signature + `bubble.png` using
  `lib/bubbleGeometry.ts` constants, returns a transparent PNG data URL.
- `services/exportService.ts` — `requestBubbleVideo(bubblePng): Promise<Blob>` (POSTs, returns mp4
  blob) and `downloadBlob(blob, filename)`.

### Modified files

- `server/index.js` — add `POST /api/export-video` (ffmpeg overlay + stream mp4), with a concurrency
  guard and temp-file cleanup.
- `components/DisplayView.tsx` — repoint the bottom-right QR to `${origin}/#/download`, relabel
  "Scan to Download".
- `App.tsx` — add the `/download` route.
- `.gitignore` — add `!public/exportBG.mp4` (the `public/*.mp4` rule otherwise ignores it).
- Asset: replace old `public/exportBG.mp4` with the new 9:16 file (rename `exportBG-new.mp4` →
  `exportBG.mp4`); delete the old one.

### Untouched

Wall physics, upload/camera flow, `BubbleFrame`, `lib/bubbleGeometry.ts`, `/wall-6`, admin.

## Server export endpoint

`POST /api/export-video`

- **Body:** `{ bubblePng: "data:image/png;base64,...", photoId?: string }` (within the existing 5MB
  JSON limit). `photoId` is used only for the download filename.
- **Steps:**
  1. Validate the PNG data URI; decode to a unique temp file in `os.tmpdir()`.
  2. Run ffmpeg via `child_process.spawn`:
     ```
     ffmpeg -y -i <exportBG.mp4> -loop 1 -i <bubble.png> \
       -filter_complex "[1:v]scale=760:-1[b];[0:v][b]overlay=(W-w)/2:(H-h)/2+70*sin(2*PI*t/3.5)[v]" \
       -map "[v]" -an -t 8 -c:v libx264 -pix_fmt yuv420p -preset veryfast -movflags +faststart <out.mp4>
     ```
     Bubble ~760px wide, centered, floating ±70px over a 3.5s cycle; muted; H.264; faststart.
  3. Stream the mp4 back: `Content-Type: video/mp4`,
     `Content-Disposition: attachment; filename="bubble-<id>.mp4"`.
  4. Always delete both temp files (finally).
- **ffmpeg location:** `ffmpeg` from PATH, overridable via `FFMPEG_PATH` env. Spawn failure / not
  found → `500` with a clear message.
- **Concurrency guard:** cap simultaneous renders (`MAX_CONCURRENT_EXPORTS`, default 2); over the cap
  → `429 "Server is busy. Please retry shortly."` (mirrors the existing upload guard).
- **Tunables (constants/env):** bubble width (760), float amplitude (70), float period (3.5s),
  duration (8s).
- **Filename id:** from the request `photoId`, sanitized to `[a-zA-Z0-9_-]`. If absent, use a timestamp.

## Client bubble compositing & fidelity

`lib/composeBubbleImage.ts`:

- Input: `PhotoEntry` + render size (default 800px square).
- **Avoid canvas taint:** `fetch(photo.imageUrl)` → blob → `createImageBitmap` (the server sends
  permissive CORS). Signature (base64) and `/bubble.png` (same-origin) load directly.
- **Draw order (matches `BubbleFrame` exactly), using `lib/bubbleGeometry.ts`:**
  1. Circular clip of the photo area (inset `PHOTO_INSET_RATIO`), photo drawn center-cropped to fill.
  2. Signature in the bottom band (`SIGNATURE_BAND_HEIGHT_RATIO`, contain, bottom-centered).
  3. `bubble.png` rim over the full square.
- Output: `toDataURL('image/png')` (transparent background).

`services/exportService.ts`:
- `requestBubbleVideo(bubblePng, photoId?): Promise<Blob>` — POST to `/api/export-video`; throws a
  friendly error on non-OK (reads JSON `error` if present).
- `downloadBlob(blob, filename)` — `URL.createObjectURL` + `<a download>` + revoke (same pattern as
  the existing `downloadAllPhotos`).

## Download page & carousel UX

- **Route:** `/#/download` → `DownloadView`. On mount, `getPhotos()` (already newest-first).
- **Carousel (`BubbleCarousel.tsx`):**
  - Horizontal CSS scroll-snap (`scroll-snap-type: x mandatory`), one full-viewport slide per bubble;
    touch-native swipe, no library. Arrow affordances on larger screens.
  - Newest first (index 0 = latest).
  - **Live preview = the export:** each slide shows the bubble (`BubbleFrame`) floating up/down (CSS
    keyframe matching the export feel) over a shared muted+looped `exportBG.mp4` element behind the
    carousel (one background element, not one per slide).
  - Position indicator ("3 / 24" or dots).
- **Per-slide states:** `idle` (Download button) → `generating` (spinner "Creating your video…",
  controls disabled) → `done` ("Saved!", re-downloadable) → `error` (toast + retry).
- **Empty state:** centered message bubble "No bubbles yet — check back soon!".
- **Layout:** portrait-first, full-bleed background, centered carousel, generous touch targets,
  safe-area padding; themed consistently with the rest of the bubble experience.

## Wall QR repoint

`DisplayView.tsx`:
- QR value → `${uploadUrl}/#/download` (reuse the existing origin resolution: `VITE_UPLOAD_URL` or
  `window.location.origin`).
- Label "Scan to Upload" → "Scan to Download". Card styling unchanged.

## Error handling

- No photos → carousel empty state.
- Photo fetch / CORS failure during compositing → toast "Couldn't prepare this bubble — try again,"
  stay on the slide.
- ffmpeg failure / not installed → `500` + clear message → toast + retry.
- Server busy (concurrency cap) → `429` → toast + retry.

## Deployment note

The backend host needs **ffmpeg in PATH** (present on the Windows LAN box). If the backend is ever
deployed to Render/containers, ffmpeg must be installed there (apt/buildpack). Documented, not built.

## Testing approach

Primarily manual (no test framework):
- Carousel lists bubbles newest-first; swipe works on touch; position indicator correct.
- Live preview shows the bubble floating over `exportBG.mp4`.
- Download produces a playable **mp4**; the bubble in the video is pixel-identical to the wall
  (photo crop + signature placement), centered, floating, muted, ~8s, 1080×1920.
- ffmpeg-missing / busy / no-photos paths show the right messages.
- Wall QR opens `/#/download` and is labeled "Scan to Download".
- Portrait layout on a phone: no overflow, controls reachable.

`lib/composeBubbleImage.ts` is structured for future unit testing (pure draw logic given loaded bitmaps).

## Out of scope

- Changes to wall physics, upload/camera flow, admin, `/wall-6`.
- Audio in the export (muted by decision).
- Per-guest auth/identification (guests find their bubble by swiping).
- Client-side video encoding; WebCodecs/ffmpeg.wasm.
- Installing ffmpeg on remote hosts (deployment step, documented only).
