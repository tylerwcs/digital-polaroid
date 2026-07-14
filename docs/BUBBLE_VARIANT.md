# Bubble Theme Variant

This branch is a **design variant** of the SnapWall app. The `main` branch keeps the
original **polaroid** design; this branch reskins the experience into a **floating-bubble**
theme. The two are intended to stay separate — do **not** merge bubble work into `main`.

- **Branch:** `claude/admiring-swirles-1b8625`
- **Scope so far:** the `/wall` display, the `/` upload (camera) page, and the `/download`
  page. `admin` and `/wall-6` are unchanged from the polaroid design (next planned scope).

## Shared foundation

- `components/BubbleFrame.tsx` — the shared visual primitive: circular photo area + `bubble.png`
  rim + halo, renders `children`. Used by the wall bubble, the camera preview, and the compositor.
- `lib/bubbleGeometry.ts` — one source of truth for `PHOTO_INSET_RATIO` (0.78) and
  `SIGNATURE_BAND_HEIGHT_RATIO` (0.4). Guarantees the bubble looks pixel-identical across wall,
  upload preview, and downloaded video.
- `components/Bubble.tsx` — wall/carousel bubble (photo + signature) rendered through `BubbleFrame`.

## `/wall` — floating bubble display (`components/DisplayView.tsx`)

- Up to 8 photos float inside translucent bubbles; signature on the lower band; no captions.
- Jitter-free "wander" motion (ease toward a slowly re-randomized target velocity), soft
  bubble/wall collisions, bubbles never leave the screen.
- New uploads rise from the bottom as a spotlight bubble, hold ~5s over a darkened background,
  then shrink into a wall slot. Full wall → oldest pops (FIFO).
- Background is a seamless looping video (`public/bubbleBG.mp4`) via a crossfading dual-`<video>`
  setup in an isolated stacking context (no loop seam; never blocks the bubbles).
- Bottom-right QR is a white card (black QR) — now labeled **"Scan to Download"**, pointing at
  `${origin}/#/download`.
- Physics: `lib/bubblePhysics.ts` (mutable `PHYSICS`, `BubbleState`, pure helpers) +
  `hooks/useBubblePhysics.ts` (owns state + the rAF loop, writes `transform` directly for 60fps).
- `components/DebugPanel.tsx` — **temporary** dev tuner mounted on `/wall` (top-left). Remove
  before production. Tuned defaults: wander strength 0.45 · easing 0.068 · interval 3600ms ·
  damping 0.951 · max speed 1.0 · wall bounce 0.25 · collision damp 0.45 · radius ratio 0.16–0.22 ·
  radius clamp 195–425px · spotlight = 60% of the shorter viewport dimension.

## `/` — camera capture upload (`components/UploadView.tsx`)

- Live `getUserMedia` feed framed inside a `BubbleFrame` (`components/CameraBubble.tsx`), rear
  camera default + flip; capture → sign on the bottom band with a white pen
  (`components/SignableBubble.tsx`) → send the same `PhotoEntry` so the wall bubble is identical.
- No file upload, no caption. Native-capture `<input capture>` fallback when not in a secure
  context. State machine: `camera → review → sending → sent → (Take another)`.
- The dedicated capture device needs a one-time **secure context** for the live camera
  (`getUserMedia` is blocked on plain-HTTP LAN origins): trusted local cert or a Chrome
  `unsafely-treat-insecure-origin-as-secure` flag for `http://<lan-ip>:5173`.
- `services/geminiService.ts` is now dead code (the old caption validation).

## `/download` — carousel + video export

- Guests scan the wall QR → swipe a carousel of all bubbles (newest first) → tap the single
  shared **Download** button → get a shareable **mp4** of their bubble floating over
  `public/exportBG.mp4` (1080×1920 / 9:16, ~8s, muted) with the `public/masthead.png` header.
- `components/DownloadView.tsx` — page + compose→request→download flow. Background `exportBG.mp4`
  is played imperatively (`video.muted=true` + `.play()` + first-gesture fallback) for iOS Safari.
- `components/BubbleCarousel.tsx` — CSS scroll-snap swipe; only bubbles swipe; reports the centered
  index so the shared button acts on the visible bubble.
- `lib/composeBubbleImage.ts` — composites the bubble to a transparent PNG (taint-safe:
  `fetch → blob → createImageBitmap` for the cross-origin photo) at 1000px.
- `services/exportService.ts` — `requestBubbleVideo(bubblePng, photoId)` + `downloadBlob`.
- Server `POST /api/export-video` (`server/index.js`) — ffmpeg overlays the masthead + floating
  bubble on `exportBG.mp4` and streams back the mp4. Concurrency guard + temp-file cleanup.
  Env-tunable layout: `EXPORT_MASTHEAD_TOP` (150), `EXPORT_MASTHEAD_WIDTH` (700),
  `EXPORT_BUBBLE_WIDTH` (912), `EXPORT_BUBBLE_Y_OFFSET` (140), `EXPORT_FLOAT_AMP` (40),
  `EXPORT_FLOAT_PERIOD` (3.5), `EXPORT_DURATION` (8), `FFMPEG_PATH`, `MAX_CONCURRENT_EXPORTS` (2).
- **Deployment dependency:** the backend host needs **ffmpeg in PATH** (present on the Windows LAN
  box). If deployed to Render/containers, ffmpeg must be installed there. Note: a degenerate tiny
  (e.g. 1×1) bubble PNG makes ffmpeg hang — real 800–1000px PNGs render fine.

## Required assets (tracked on this branch)

- `public/bubble.png` — bubble rim/glass overlay
- `public/bubbleBG.mp4` — wall looping background
- `public/exportBG.mp4` — download export background (9:16)
- `public/masthead.png` — export header (HArmonyCa / Launch Symposium / Get the bounce)

`.gitignore` ignores `public/*.mp4`; explicit `!public/bubbleBG.mp4` and `!public/exportBG.mp4`
exceptions keep the theme videos tracked. Unused polaroid assets (`BG.mp4`, masthead logos) were
removed on this branch.

## Design docs

- Wall: `docs/superpowers/specs/2026-05-22-bubble-wall-display-design.md` + `plans/2026-05-22-bubble-wall-display.md`
- Upload: `docs/superpowers/specs/2026-06-24-bubble-camera-upload-design.md` + `plans/2026-06-24-bubble-camera-upload.md`
- Download: `docs/superpowers/specs/2026-06-26-bubble-download-design.md` + `plans/2026-06-26-bubble-download.md`

## Suggested next steps (future sessions)

- Apply the same imperative-play iOS Safari fix to `UploadView`'s background video (same
  attribute-only pattern that broke on the download page).
- Remove the temporary `DebugPanel` once the wall look is locked.
- Decide whether `/wall-6` and admin should also adopt the theme.
- On-device verification of the download page on iOS Safari + Android (mp4 saves/plays).
