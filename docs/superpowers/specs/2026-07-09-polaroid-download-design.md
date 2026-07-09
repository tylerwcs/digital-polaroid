# Downloadable Polaroid on a Branded Background — Design

**Date:** 2026-07-09
**Status:** Approved pending review
**Builds on:** the wall-6 settings features (`wallSettings` object, `PUT /api/settings`, the `POST /api/background` upload) and the existing server-side polaroid renderer `server/polaroidExport.js` (`renderPolaroidPng`, used by the admin download-all ZIP).

## Goal

After a user posts their polaroid to the wall, let them download it composited onto a
branded portrait background (the "download background"). The admin can replace the
download background with a custom uploaded image. Default reproduces the bundled
`public/downloadBG.png` (Generali "Live the Legacy" portrait art).

## Decisions

- **Trigger:** a "Download my polaroid" button in the upload success state (after a
  successful post), operating on the just-posted photo.
- **Rendering:** server-side, reusing `renderPolaroidPng` and compositing onto the
  download background. No new browser rendering stack.
- **Placement:** polaroid centered horizontally, scaled to ~62% of the background width
  (capped so height ≤ ~70% of background height), vertically centered at ~54% of the
  background height (in the open area, clear of the top branding). Numbers are constants,
  tuned visually in the preview during implementation.
- **Output:** PNG at the background's native dimensions.
- **Admin download-background upload:** 8MB cap, keep only the newest (`dl-*` files) —
  same limits as the wall-background upload.

## Data model

Extend `WallSettings`:

```ts
interface WallSettings {
  maxColumns: number;      // existing
  polaroidWidth: number;   // existing
  background: WallBackground; // existing
  downloadBackground: string; // NEW — URL; default '/downloadBG.png'
}
```

`DEFAULT_DOWNLOAD_BACKGROUND = '/downloadBG.png'` (a bundled, committed asset). Admin
uploads set it to `/uploads/dl-<timestamp>.png`. It lives in `wallSettings` only to reuse
the existing persistence + `PUT /api/settings`; the wall does not consume it (server reads
it when compositing; admin reads it to show the current value).

`public/downloadBG.png` is currently untracked — it will be committed as the default asset
(it is copied into `dist/` by the Vite build, so it ships on the single-service deploy).

## Server

### Validation (`server/settings.js`)

- Add `DEFAULT_DOWNLOAD_BACKGROUND = '/downloadBG.png'`; add it to `WALL_SETTINGS_DEFAULTS`.
- In `sanitize` / `normalizeWallSettings`, validate `downloadBackground`: accept a non-empty
  string of length ≤ 2048; otherwise keep base. (Same rule already used for a `custom`
  background value; extract a small `isNonEmptyUrl(value)` helper and reuse it.)

### Shared upload helper (`server/index.js`)

Both `bg-*` (existing `/api/background`) and the new `dl-*` upload do the same work:
validate a base64 image ≤8MB, decode, write `<prefix>-<ts>.<ext>`, delete other
`<prefix>-*` files (keep-newest, write-then-delete), return `{ url }`. Extract this into a
helper `saveUploadedImage(image, prefix)` returning `{ url }` or throwing a
`{ status, error }`-shaped failure, and have both route handlers call it. This refactors the
already-shipped `/api/background` handler to use the shared helper (DRY, behavior-preserving).

New route: `POST /api/download-background` (registered with the same route-scoped 12mb parser
approach as `/api/background`) → `saveUploadedImage(image, 'dl')` → `{ url }`.

### Composite renderer (`server/polaroidExport.js`)

Add `renderPolaroidDownload(photo, bgBuffer, deps)`:
1. `const polaroid = await renderPolaroidPng(photo, deps)` (transparent PNG buffer, existing).
2. `loadImage(bgBuffer)` → background; `loadImage(polaroid)` → polaroid image.
3. Create a canvas at the background's native `width`×`height`; draw the background.
4. Compute polaroid draw size: `targetW = round(bg.width * 0.62)`; `scale = targetW / polaroid.width`;
   `drawH = round(polaroid.height * scale)`; if `drawH > bg.height * 0.70`, rescale so
   `drawH = round(bg.height * 0.70)` and `targetW` follows. Center X = `(bg.width - targetW)/2`;
   center Y so the polaroid's vertical center sits at `bg.height * 0.54`.
5. `drawImage(polaroid, x, y, targetW, drawH)`; return `canvas.toBuffer('image/png')`.

(The 0.62 / 0.70 / 0.54 constants are named at the top of the function and tuned in preview.)

### Download endpoint (`server/index.js`)

`GET /api/photos/:id/download`:
- Find the photo by id in the in-memory `photos`; 404 if absent.
- Resolve `wallSettings.downloadBackground` to a file buffer via a helper
  `resolveDownloadBackgroundBuffer(urlValue)`:
  - if it starts with `${UPLOAD_URL_BASE}/` (e.g. `/uploads/…`) → read `basename` from `UPLOAD_DIR`.
  - otherwise treat it as a bundled asset filename (default `/downloadBG.png`) → read from
    `DIST_DIR` if present, else the project `public/` dir (`path.resolve(__dirname, '..', 'public', basename)`).
  - on any failure, fall back to the bundled default; if even that is missing, 500.
- `renderPolaroidDownload(photo, bgBuffer, polaroidDeps)` (reuse the existing `polaroidDeps`
  object already built for download-all: `{ __dirname, fullImagePath, decodeBase64Image }`).
- Respond `image/png` with `Content-Disposition: attachment; filename="polaroid-<id>.png"`.
- No server-side auth (matches existing posture).

## Client

- `types.ts`: add `downloadBackground: string` to `WallSettings`; export
  `DEFAULT_DOWNLOAD_BACKGROUND = '/downloadBG.png'`; add it to `WALL_SETTINGS_DEFAULTS`.
- `services/storageService.ts`:
  - `uploadDownloadBackground(dataUrl)` → `POST /api/download-background` (mirrors
    `uploadBackground`, returns `{ success, url?, error? }`, url run through `toAbsoluteUrl`).
  - `downloadPolaroid(photoId)` → GET `${API_URL}/api/photos/${photoId}/download`, read blob,
    trigger a browser download (mirroring `downloadAllPhotos`), returns `{ success, error? }`.

## UploadView (`components/UploadView.tsx`)

- `savePhoto` already returns the saved photo (with `id`). On success, instead of the current
  immediate full reset, store `postedPhotoId` and enter a **posted** state that shows: a
  "Posted to the wall!" confirmation, a **"Download my polaroid"** button (calls
  `downloadPolaroid(postedPhotoId)`, with a downloading spinner + error toast), and a
  **"Done"** button that clears state back to idle. Posting again also clears it.
- Keep the existing spotlight/eject animation untouched; the posted state replaces only the
  post-success reset path.

## Admin (`components/AdminView.tsx`)

Add a **"Download background"** control to the settings panel (below the wall Background
group): a file input (`accept="image/*"`, ≤8MB client check) that calls
`uploadDownloadBackground` → on success `updateSettings({ downloadBackground: url })` with a
toast; a small current-value line; and a **"Use default"** button that sets
`updateSettings({ downloadBackground: DEFAULT_DOWNLOAD_BACKGROUND })`. Reuses the existing
debounced save + live subscription.

## Testing

- **Server unit tests** (`server/settings.test.js`): `downloadBackground` accepted for a valid
  non-empty URL; invalid/empty/too-long/non-string keeps base; default present; partial patch
  without it preserves base. Update the existing default-shape `deepEqual` assertions to include
  `downloadBackground: DEFAULT_DOWNLOAD_BACKGROUND`.
- **Manual / preview verification:** post a photo → click "Download my polaroid" → a composited
  PNG downloads (polaroid centered on the branded BG); a text-only post also composites; admin
  uploads a custom download background → the endpoint uses it and only one `dl-*` file remains;
  "Use default" restores `/downloadBG.png`.

## Out of scope (YAGNI)

- Admin-configurable placement/scale (constants only, tuned once).
- Preview-before-download UI.
- Custom-video download backgrounds / multiple retained download backgrounds.
- Downloading arbitrary wall photos (only the user's just-posted polaroid).
