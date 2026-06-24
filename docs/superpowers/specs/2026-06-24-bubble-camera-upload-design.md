# Bubble Camera Upload Page — Design Spec

**Date:** 2026-06-24
**Branch:** `claude/admiring-swirles-1b8625` (bubble-theme variant — see `docs/BUBBLE_VARIANT.md`)
**Scope:** Redesign the upload page (`/`, `UploadView`) from a file-upload + polaroid form into a
live **camera capture** experience framed inside the bubble. The wall (`/wall`) is unchanged except
for a small, backward-compatible refactor of `Bubble.tsx`.

## Goal

Turn the upload page into a self-serve photo-taking station on a dedicated device: the guest sees a
live camera feed already framed as the final bubble, snaps a photo, signs on the bottom of the
bubble, and sends it to the wall. The preview bubble and the bubble that appears on the wall must be
**pixel-identical**.

## Requirements (from the user)

1. Replace the upload page with a camera-based photo-taking page. Remove the file-upload feature.
2. The live camera is integrated into the bubble frame so the guest previews the final bubble while framing.
3. No caption.
4. After taking the photo, the guest signs on the bubble itself.
5. An upload button sends the bubble to the wall. The preview bubble and the uploaded bubble are exactly the same.

## Key constraints & decisions

- **Dedicated capture device** (not arbitrary guest phones). This makes a live `getUserMedia` camera
  feasible despite the LAN/HTTP environment.
- **Secure context:** `getUserMedia` is blocked on non-HTTPS origins except `localhost`. The dedicated
  device needs a one-time secure-context setup (trusted local cert via `mkcert`, or launching its
  browser with an insecure-origin-treated-as-secure flag). This is a **deployment step**, not app code.
  The app still ships a fallback (see Error Handling) so it degrades gracefully.
- **Camera:** rear camera (`facingMode: 'environment'`) by default, with a flip-to-front toggle.
  Front camera is mirrored (preview and capture) for a natural selfie.
- **Signature:** white pen, constrained to the bottom signature band (full width, bottom 40% of the
  photo circle, bottom-centered) — matching the wall's existing geometry and the user's reference image.
- **Caption:** removed from the page. Sent as `caption: ''`. Field stays in the type for `/wall-6`.
- **Portrait-first, responsive:** the device is a phone/tablet in portrait. Layout is optimized for
  portrait and must not overflow; landscape still works.

## Architecture

### Fidelity strategy (requirement #5)

Extract the bubble's visual frame into a shared primitive used by BOTH the wall and the upload page.
Identical framing + identical signature-band geometry + the same `PhotoEntry` data = identical result
by construction.

### Files

**New:**
- `lib/bubbleGeometry.ts` — shared geometry constants:
  - `PHOTO_INSET_RATIO = 0.78` (photo circle diameter as fraction of bubble diameter)
  - Signature band: full width, height = 40% of the photo circle, bottom-aligned, `object-contain`,
    bottom-centered. Expose helpers to compute the band's pixel box from a given photo-circle size.
- `components/BubbleFrame.tsx` — visual primitive. Square wrapper of `diameter`, a circular
  (`rounded-full overflow-hidden`) photo area inset to `PHOTO_INSET_RATIO`, the layered drop-shadow +
  white halo (current `Bubble` filter), and the `/bubble.png` rim overlay on top (`pointer-events-none`).
  Renders `children` inside the photo circle. No data logic, no `PhotoEntry` knowledge.
- `components/CameraBubble.tsx` — owns the live camera: `getUserMedia`, the `<video>` element inside a
  `BubbleFrame`, the flip toggle, and frame capture to a base64 JPEG. Exposes callbacks
  (`onCapture(dataUrl)`, `onCameraError`). Front-camera mirroring handled here.

**Modified (backward-compatible):**
- `components/Bubble.tsx` — keep the exact current props (`photo`, `diameter`, `className`, `style`,
  `placeholderText`) and behavior, but render through `BubbleFrame`: pass the photo `<img>` and the
  signature `<img>` (bottom-band geometry from `lib/bubbleGeometry.ts`) as children. The wall is visually
  unchanged.
- `components/UploadView.tsx` — full rewrite into the camera flow state machine (below). Removes the
  polaroid camera body, file `<input>` upload path, caption `<textarea>`, "Write a Note" text-only path,
  and the gemini caption-validation call.

**Untouched:** `DisplayView`, `DebugPanel`, `useBubblePhysics`, `lib/bubblePhysics.ts`, the server,
and the `storageService` API (same `PhotoEntry` POST shape). Route `/` still renders `UploadView`, so the
QR code keeps working.

## Camera & capture mechanics

- Request `getUserMedia({ video: { facingMode } })`, `facingMode` starting at `'environment'`.
- Stream into a muted, `autoPlay`, `playsInline` `<video>` inside the `BubbleFrame` photo circle,
  `object-cover` to fill the circle. The `bubble.png` rim sits on top so the guest sees the framed bubble.
- **Flip toggle:** stop current tracks, toggle `facingMode` between `'environment'` and `'user'`,
  re-request the stream. `'user'` is mirrored via CSS `scaleX(-1)`.
- **Capture:** draw the current video frame to an offscreen canvas cropped to a centered **square**
  (matching the bubble's square photo area), scale to **600px**, export **JPEG quality 0.65** (reuses the
  wall's existing image sizing). If the front camera is active, flip the capture canvas horizontally so the
  saved photo matches the mirrored preview.
- **Cleanup:** stop camera tracks on capture, on unmount, and on `visibilitychange` (tab hidden).

## Signing & fidelity

- After capture, the frozen photo shows in the same `BubbleFrame`. A `SignatureCanvas`
  (`react-signature-canvas`, existing dep) overlays exactly the signature band (geometry from
  `lib/bubbleGeometry.ts`), white pen.
- The canvas is sized to the band's rendered pixel dimensions at the preview's bubble size. Export with
  `toDataURL('image/png')` → transparent signature PNG.
- The wall's `Bubble` renders that PNG into the same band (same aspect ratio, `object-contain`,
  bottom-centered), scaled uniformly to the wall bubble size → pixel-identical placement.
- **Controls:** "Clear" to re-sign. Signing is optional — empty canvas means no signature layer is sent.
- **Guidance:** a faint baseline + "Sign here" hint inside the band, fading once drawing starts.

## Flow & state machine

`UploadView` is driven by one state: `camera → review → sending → sent → (Take another) → camera`.

| State | Screen / behavior |
|-------|-------------------|
| `camera` | Live feed in the bubble frame. Controls: **shutter** (capture), **flip** camera. On permission/secure-context failure → fallback (below). |
| `review` | Frozen photo in the bubble; signing canvas active over the band. Controls: **Retake** (→ `camera`, restart stream, discard photo + signature), **Clear** signature, **Send to Wall**. |
| `sending` | Send shows a spinner; optional subtle "float up" cue on the bubble. POST in flight. |
| `sent` | Success confirmation ("Sent to the wall!"). Single **Take another** button. Tapping resets all state → `camera`. No auto-advance. |

## Data flow & server

- On Send, build: `{ id, images: [capturedBase64Jpeg], caption: '', signature: pngOrUndefined,
  timestamp, rotation: Math.random()*6 - 3 }` and POST via existing `savePhoto()`.
- **No server changes.** Server decodes `images[0]` to a file, stores `signature`, broadcasts
  `new_photo`; the wall spotlights it.
- Caption sent as `''`; gemini validation removed from this page.

## Error handling & fallback

- **Camera unavailable** (permission denied / no device / insecure context): show a clear message in the
  bubble frame and fall back to **native capture** (`<input accept="image/*" capture="environment">`).
  The returned file runs through the existing `compressImage` → `review` (sign) → send flow. The page
  always works, live preview or not.
- **Upload failure:** toast the error and remain on `review` so the guest can retry without re-taking.

## Responsive portrait layout

- Vertical stack centered in the viewport: bubble frame on top, controls below.
- Bubble diameter computed responsively, roughly `min(85vw, ~55vh)`, so the frame and its controls fit
  without scrolling on a phone/tablet in portrait. Landscape falls back to height-constrained sizing.
- Touch-friendly hit targets (large shutter, comfortable buttons), safe-area padding for notches/home
  indicators.
- Background reuses the bubble theme styling so the device feels part of the same experience.

## Testing approach

Primarily manual (no test framework in repo):
- Live camera shows inside the bubble frame; flip toggles rear/front; front is mirrored.
- Capture freezes a square photo; retake restarts the stream.
- Signing in the band with white pen; clear works; empty signature sends no layer.
- Sent bubble on the wall is pixel-identical to the preview (photo crop + signature placement).
- Caption is absent everywhere; POST body has `caption: ''`.
- Permission-denied / insecure-context path falls back to native capture and still completes.
- Portrait layout on a phone and a tablet: no overflow, controls reachable; landscape still usable.
- Upload failure keeps the guest on `review` to retry.

`lib/bubbleGeometry.ts` is pure and unit-testable later if a test runner is added.

## Out of scope

- Server/API changes; `PhotoEntry` schema changes.
- Wall (`/wall`) behavior changes beyond the backward-compatible `Bubble` refactor.
- `/wall-6`, admin.
- The secure-context device setup itself (documented as a deployment step).
- Multi-photo, filters, retakes history, captions.
