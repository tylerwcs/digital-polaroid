# Bubble Camera Upload Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the file-upload + polaroid form on `/` with a live camera capture experience framed inside the bubble: snap a photo from the device camera, sign on the bottom band, and send the same `PhotoEntry` to the wall so the preview bubble and wall bubble are pixel-identical.

**Architecture:** Extract the bubble's visual frame into a shared `BubbleFrame` primitive (circular photo clip + `bubble.png` rim + shadow). The wall's `Bubble` is refactored to render through it (no behavior change); the new camera page renders live `<video>`, the captured `<img>`, and the signing canvas through the same primitive. A single shared geometry module (`lib/bubbleGeometry.ts`) defines the photo-circle inset and the signature band so capture and display match by construction.

**Tech Stack:** React 19, TypeScript, Tailwind, Vite. `getUserMedia` for the live camera, existing `react-signature-canvas` for signing, existing `storageService.savePhoto` / `compressImage`. No new dependencies, no server changes.

**Testing approach:** No test framework in the repo — each task verifies with `npx tsc --noEmit` and explicit manual-check criteria. `lib/bubbleGeometry.ts` is pure for future unit testing.

**Spec:** [docs/superpowers/specs/2026-06-24-bubble-camera-upload-design.md](../specs/2026-06-24-bubble-camera-upload-design.md)

---

## File Structure

**New files:**
- `lib/bubbleGeometry.ts` — shared geometry constants/helpers (photo inset, signature band box)
- `components/BubbleFrame.tsx` — visual frame primitive (circle clip + rim overlay + shadow), renders `children`
- `components/CameraBubble.tsx` — live camera (`getUserMedia`), `<video>` in a `BubbleFrame`, flip toggle, frame capture
- `components/SignableBubble.tsx` — captured photo in a `BubbleFrame` with the signature canvas over the band

**Modified files:**
- `components/Bubble.tsx` — refactor to render through `BubbleFrame` (same public API + visuals)
- `components/UploadView.tsx` — full rewrite into the camera flow state machine

**Untouched:** `components/DisplayView.tsx`, `components/DebugPanel.tsx`, `hooks/useBubblePhysics.ts`, `lib/bubblePhysics.ts`, `services/*`, `server/*`, `App.tsx`.

---

## Task 1: Shared bubble geometry module

**Files:**
- Create: `lib/bubbleGeometry.ts`

- [ ] **Step 1: Create the geometry module**

Create `lib/bubbleGeometry.ts`:

```typescript
// Shared geometry for the bubble visual frame. Used by BubbleFrame (display),
// the wall Bubble (signature placement), and the upload signing canvas — so the
// preview and the wall render identically by construction.

// Photo circle diameter as a fraction of the full bubble diameter (leaves room for the glass rim).
export const PHOTO_INSET_RATIO = 0.78;

// Signature band, expressed as fractions of the PHOTO CIRCLE (not the full bubble):
// full width, occupying the bottom BAND_HEIGHT_RATIO of the circle, bottom-aligned.
export const SIGNATURE_BAND_HEIGHT_RATIO = 0.4;

export interface Box {
  width: number;
  height: number;
}

// Pixel size of the photo circle for a given bubble diameter.
export const photoCircleSize = (bubbleDiameter: number): number =>
  bubbleDiameter * PHOTO_INSET_RATIO;

// Pixel box of the signature band for a given photo-circle size.
// Width = full circle; height = bottom BAND_HEIGHT_RATIO of the circle.
export const signatureBandBox = (photoCircleSizePx: number): Box => ({
  width: photoCircleSizePx,
  height: photoCircleSizePx * SIGNATURE_BAND_HEIGHT_RATIO,
});
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/bubbleGeometry.ts
git commit -m "feat(upload): add shared bubble geometry module"
```

---

## Task 2: `BubbleFrame` primitive

**Files:**
- Create: `components/BubbleFrame.tsx`

- [ ] **Step 1: Create the component**

Create `components/BubbleFrame.tsx`:

```typescript
import React from 'react';
import { PHOTO_INSET_RATIO } from '../lib/bubbleGeometry';

interface BubbleFrameProps {
  diameter: number;                 // full bubble diameter in px (2 * radius)
  children?: React.ReactNode;       // content rendered inside the circular photo area
  className?: string;
  style?: React.CSSProperties;
}

// The shared bubble visual: a square wrapper holding a circular photo area
// (clipped) with the bubble.png glass rim overlaid on top, plus the lift/halo
// shadow. No data logic — callers slot a photo, a <video>, or a signing canvas
// in via children.
export const BubbleFrame: React.FC<BubbleFrameProps> = ({
  diameter,
  children,
  className = '',
  style = {},
}) => {
  const photoSize = diameter * PHOTO_INSET_RATIO;
  const photoOffset = (diameter - photoSize) / 2;

  return (
    <div
      className={`relative ${className}`}
      style={{
        width: diameter,
        height: diameter,
        // Bright outer halo — matches the wall bubble's current look.
        filter: 'drop-shadow(0 0 12px rgba(255, 255, 255, 0.25))',
        ...style,
      }}
    >
      {/* Circular photo area (children clipped to the circle) */}
      <div
        className="absolute overflow-hidden rounded-full bg-black/20"
        style={{
          width: photoSize,
          height: photoSize,
          top: photoOffset,
          left: photoOffset,
        }}
      >
        {children}
      </div>

      {/* Bubble PNG overlay (glass rim, highlights, branding) */}
      <img
        src="/bubble.png"
        alt=""
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        draggable={false}
      />
    </div>
  );
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/BubbleFrame.tsx
git commit -m "feat(upload): add BubbleFrame visual primitive"
```

---

## Task 3: Refactor `Bubble` to use `BubbleFrame` (no visual change)

The wall's `Bubble` currently builds its own circle + overlay. Refactor it to render through `BubbleFrame` so the framing geometry lives in one place. Public props and the rendered result must stay the same.

**Files:**
- Modify: `components/Bubble.tsx`

- [ ] **Step 1: Replace the component body**

Replace the entire contents of `components/Bubble.tsx` with:

```typescript
import React from 'react';
import { PhotoEntry } from '../types';
import { BubbleFrame } from './BubbleFrame';
import { SIGNATURE_BAND_HEIGHT_RATIO } from '../lib/bubbleGeometry';

interface BubbleProps {
  photo: PhotoEntry | null;       // null = empty/placeholder (instructional bubble)
  diameter: number;               // pixel size of the bubble (2 * radius)
  className?: string;
  style?: React.CSSProperties;
  placeholderText?: string;       // shown when photo is null
}

export const Bubble: React.FC<BubbleProps> = ({
  photo,
  diameter,
  className = '',
  style = {},
  placeholderText,
}) => {
  const imageUrl = photo
    ? (photo.imageUrl || (photo.images && photo.images[0]) || '')
    : '';

  // Signature band height as a % of the photo circle (the BubbleFrame children box).
  const bandHeightPct = `${SIGNATURE_BAND_HEIGHT_RATIO * 100}%`;

  return (
    <BubbleFrame diameter={diameter} className={className} style={style}>
      {/* Photo fills the circle */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
        />
      )}

      {/* Signature overlay on the lower band */}
      {imageUrl && photo?.signature && (
        <img
          src={photo.signature}
          alt=""
          className="absolute left-0 right-0 bottom-0 w-full pointer-events-none"
          style={{
            height: bandHeightPct,
            objectFit: 'contain',
            objectPosition: 'center bottom',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
          }}
          draggable={false}
        />
      )}

      {/* Placeholder text (empty-state instructional bubble) */}
      {!imageUrl && placeholderText && (
        <div
          className="absolute inset-0 flex items-center justify-center text-center text-white font-semibold px-8"
          style={{ fontSize: diameter * 0.07 }}
        >
          {placeholderText}
        </div>
      )}
    </BubbleFrame>
  );
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check — wall unchanged**

Run `npm run dev`, open `/#/wall` with some existing photos. Confirm:
- Bubbles look the same as before (photo clipped to circle, signature in the lower band, rim + halo).
- Empty state still shows the instructional bubble.

- [ ] **Step 4: Commit**

```bash
git add components/Bubble.tsx
git commit -m "refactor(wall): render Bubble through shared BubbleFrame (no visual change)"
```

---

## Task 4: `CameraBubble` — live camera inside the frame

Owns `getUserMedia`, the `<video>` element inside a `BubbleFrame`, the flip toggle, and frame capture. Reports the captured photo (base64 JPEG) and any camera error to the parent.

**Files:**
- Create: `components/CameraBubble.tsx`

- [ ] **Step 1: Create the component**

Create `components/CameraBubble.tsx`:

```typescript
import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { BubbleFrame } from './BubbleFrame';

export interface CameraBubbleHandle {
  capture: () => string | null;     // returns base64 JPEG data URL, or null if not ready
  flip: () => void;
}

interface CameraBubbleProps {
  diameter: number;
  onError: (message: string) => void;
}

const CAPTURE_SIZE = 600;           // output square size in px (matches wall image sizing)
const JPEG_QUALITY = 0.65;

export const CameraBubble = forwardRef<CameraBubbleHandle, CameraBubbleProps>(
  ({ diameter, onError }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
    const [restartKey, setRestartKey] = useState(0);   // bump to force a stream restart

    const stopStream = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    // (Re)start the stream whenever facingMode changes or a restart is requested.
    useEffect(() => {
      let cancelled = false;

      const start = async () => {
        stopStream();
        if (!navigator.mediaDevices?.getUserMedia) {
          onError('Camera not available on this device/browser.');
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode },
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => { /* autoplay quirks; user gesture will resume */ });
          }
        } catch (e) {
          const err = e as DOMException;
          if (err?.name === 'NotAllowedError') onError('Camera permission denied.');
          else if (err?.name === 'NotFoundError') onError('No camera found on this device.');
          else onError('Could not start the camera. A secure (HTTPS/localhost) context is required.');
        }
      };

      start();
      return () => { cancelled = true; stopStream(); };
    }, [facingMode, restartKey, onError]);

    // Stop the camera when the tab is hidden; restart when visible again.
    useEffect(() => {
      const onVis = () => {
        if (document.hidden) stopStream();
        else setRestartKey((k) => k + 1); // bump key → camera effect re-runs and restarts the stream
      };
      document.addEventListener('visibilitychange', onVis);
      return () => document.removeEventListener('visibilitychange', onVis);
    }, []);

    useImperativeHandle(ref, () => ({
      capture: () => {
        const video = videoRef.current;
        if (!video || !video.videoWidth) return null;

        const canvas = document.createElement('canvas');
        canvas.width = CAPTURE_SIZE;
        canvas.height = CAPTURE_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // Center-crop the video to a square.
        const side = Math.min(video.videoWidth, video.videoHeight);
        const sx = (video.videoWidth - side) / 2;
        const sy = (video.videoHeight - side) / 2;

        // Mirror horizontally for the front camera so the saved photo matches the preview.
        if (facingMode === 'user') {
          ctx.translate(CAPTURE_SIZE, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, sx, sy, side, side, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);

        return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      },
      flip: () => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment')),
    }), [facingMode]);

    return (
      <BubbleFrame diameter={diameter}>
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
          autoPlay
          playsInline
          style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : undefined }}
        />
      </BubbleFrame>
    );
  }
);

CameraBubble.displayName = 'CameraBubble';
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/CameraBubble.tsx
git commit -m "feat(upload): add CameraBubble live-camera-in-frame component"
```

---

## Task 5: `SignableBubble` — captured photo + signing canvas

Shows the captured photo in a `BubbleFrame` with a white-pen signature canvas over the bottom band. Exposes a handle to export the signature PNG and to clear it.

**Files:**
- Create: `components/SignableBubble.tsx`

- [ ] **Step 1: Create the component**

Create `components/SignableBubble.tsx`:

```typescript
import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { BubbleFrame } from './BubbleFrame';
import { photoCircleSize, signatureBandBox } from '../lib/bubbleGeometry';

export interface SignableBubbleHandle {
  getSignature: () => string | undefined;  // base64 PNG, or undefined if empty
  clear: () => void;
}

interface SignableBubbleProps {
  diameter: number;
  imageDataUrl: string;
}

export const SignableBubble = forwardRef<SignableBubbleHandle, SignableBubbleProps>(
  ({ diameter, imageDataUrl }, ref) => {
    const sigRef = useRef<SignatureCanvas>(null);
    const [hasDrawn, setHasDrawn] = useState(false);

    const circle = photoCircleSize(diameter);
    const band = signatureBandBox(circle);

    // Clear strokes if the underlying photo changes (e.g., retake then re-enter).
    useEffect(() => {
      sigRef.current?.clear();
      setHasDrawn(false);
    }, [imageDataUrl]);

    useImperativeHandle(ref, () => ({
      getSignature: () => {
        const c = sigRef.current;
        if (!c || c.isEmpty()) return undefined;
        try {
          return c.getCanvas().toDataURL('image/png');
        } catch {
          return undefined;
        }
      },
      clear: () => {
        sigRef.current?.clear();
        setHasDrawn(false);
      },
    }), []);

    return (
      <BubbleFrame diameter={diameter}>
        {/* Captured photo */}
        <img src={imageDataUrl} alt="" className="w-full h-full object-cover" draggable={false} />

        {/* Signature canvas pinned to the bottom band of the photo circle */}
        <div
          className="absolute left-0 right-0 bottom-0 cursor-crosshair"
          style={{ width: band.width, height: band.height }}
        >
          <SignatureCanvas
            ref={sigRef}
            penColor="#ffffff"
            onEnd={() => setHasDrawn(true)}
            canvasProps={{
              width: band.width,
              height: band.height,
              className: 'absolute inset-0',
            }}
            clearOnResize={false}
          />
          {/* "Sign here" hint, fades once drawing starts */}
          {!hasDrawn && (
            <div className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
              <span className="text-white/70 text-sm font-medium drop-shadow">Sign here</span>
            </div>
          )}
        </div>
      </BubbleFrame>
    );
  }
);

SignableBubble.displayName = 'SignableBubble';
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/SignableBubble.tsx
git commit -m "feat(upload): add SignableBubble (captured photo + bottom-band signing)"
```

---

## Task 6: Rewrite `UploadView` — camera flow state machine

Replaces the polaroid form entirely. Drives the `camera → review → sending → sent` flow, wires `CameraBubble` and `SignableBubble`, computes a responsive portrait bubble size, and includes the native-capture fallback.

**Files:**
- Modify: `components/UploadView.tsx`

- [ ] **Step 1: Replace the whole file**

Replace the entire contents of `components/UploadView.tsx` with:

```typescript
import React, { useEffect, useRef, useState } from 'react';
import { compressImage, savePhoto } from '../services/storageService';
import { PhotoEntry } from '../types';
import { useToast } from '../context/ToastContext';
import { CameraBubble, CameraBubbleHandle } from './CameraBubble';
import { SignableBubble, SignableBubbleHandle } from './SignableBubble';

type Stage = 'camera' | 'review' | 'sending' | 'sent';

const UploadView: React.FC = () => {
  const { showToast } = useToast();
  const cameraRef = useRef<CameraBubbleHandle>(null);
  const signRef = useRef<SignableBubbleHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('camera');
  const [captured, setCaptured] = useState<string | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);

  // Responsive bubble size: fits a portrait phone/tablet without overflowing,
  // leaving room for the controls below.
  const [diameter, setDiameter] = useState(320);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setDiameter(Math.round(Math.max(220, Math.min(w * 0.85, h * 0.55))));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  const handleCameraError = (message: string) => {
    setCameraFailed(true);
    showToast(message + ' Tap to use your camera instead.', 'error');
  };

  const handleShutter = () => {
    const dataUrl = cameraRef.current?.capture();
    if (!dataUrl) {
      showToast('Camera not ready yet — try again.', 'error');
      return;
    }
    setCaptured(dataUrl);
    setStage('review');
  };

  // Native-capture fallback (insecure context / permission denied / no getUserMedia).
  const handleFallbackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const dataUrl = await compressImage(file);
        setCaptured(dataUrl);
        setStage('review');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not process the photo.';
        showToast(msg, 'error');
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRetake = () => {
    setCaptured(null);
    setStage('camera');
  };

  const handleSend = async () => {
    if (!captured) return;
    setStage('sending');

    const signature = signRef.current?.getSignature();
    const newPhoto: PhotoEntry = {
      id: Date.now().toString(),
      images: [captured],
      caption: '',
      signature,
      timestamp: Date.now(),
      rotation: Math.random() * 6 - 3,
    };

    const result = await savePhoto(newPhoto);
    if (result.success) {
      setStage('sent');
    } else {
      showToast(result.error || 'Could not send. Check the connection.', 'error');
      setStage('review');
    }
  };

  const handleTakeAnother = () => {
    setCaptured(null);
    setCameraFailed(false);
    setStage('camera');
  };

  return (
    <div className="min-h-[100dvh] w-screen bg-black text-white flex flex-col items-center justify-center gap-8 px-4 py-[max(1rem,env(safe-area-inset-top))] overflow-hidden relative">
      {/* Themed background video (same asset as the wall) */}
      <video
        className="absolute inset-0 w-full h-full object-cover opacity-60 pointer-events-none"
        src="/bubbleBG.mp4"
        autoPlay
        muted
        loop
        playsInline
        aria-hidden
      />

      <div className="relative z-10 flex flex-col items-center gap-8 w-full">
        {/* Bubble area */}
        {stage === 'camera' && !cameraFailed && (
          <CameraBubble ref={cameraRef} diameter={diameter} onError={handleCameraError} />
        )}

        {stage === 'camera' && cameraFailed && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-center px-6"
            style={{ width: diameter, height: diameter }}
          >
            Tap to open your camera
          </button>
        )}

        {(stage === 'review' || stage === 'sending') && captured && (
          <SignableBubble ref={signRef} diameter={diameter} imageDataUrl={captured} />
        )}

        {stage === 'sent' && (
          <div
            className="rounded-full bg-white/10 border border-white/20 flex flex-col items-center justify-center text-center gap-2 px-6"
            style={{ width: diameter, height: diameter }}
          >
            <span className="text-2xl font-semibold">Sent to the wall!</span>
            <span className="text-white/70 text-sm">Your bubble is floating now ✨</span>
          </div>
        )}

        {/* Controls */}
        {stage === 'camera' && !cameraFailed && (
          <div className="flex items-center gap-6">
            <button
              onClick={() => cameraRef.current?.flip()}
              className="w-14 h-14 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-2xl active:scale-95 transition-transform"
              aria-label="Flip camera"
            >
              ⟲
            </button>
            <button
              onClick={handleShutter}
              className="w-20 h-20 rounded-full bg-white border-4 border-white/50 active:scale-95 transition-transform"
              aria-label="Take photo"
            />
            <div className="w-14 h-14" /> {/* spacer to keep shutter centered */}
          </div>
        )}

        {stage === 'review' && (
          <div className="flex items-center gap-4">
            <button
              onClick={handleRetake}
              className="px-6 py-3 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              Retake
            </button>
            <button
              onClick={() => signRef.current?.clear()}
              className="px-6 py-3 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={handleSend}
              className="px-8 py-3 rounded-full bg-white text-black font-semibold active:scale-95 transition-transform"
            >
              Send to Wall
            </button>
          </div>
        )}

        {stage === 'sending' && (
          <div className="px-8 py-3 text-white/80">Sending…</div>
        )}

        {stage === 'sent' && (
          <button
            onClick={handleTakeAnother}
            className="px-8 py-3 rounded-full bg-white text-black font-semibold active:scale-95 transition-transform"
          >
            Take another
          </button>
        )}
      </div>

      {/* Hidden native-capture fallback input */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileInputRef}
        onChange={handleFallbackFile}
        className="hidden"
      />
    </div>
  );
};

export default UploadView;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/UploadView.tsx
git commit -m "feat(upload): rewrite UploadView as camera capture + sign flow"
```

---

## Task 7: End-to-end manual verification

No code. Exercises the feature against the spec. The dedicated device needs a secure context for the live camera (HTTPS or a browser flag); on a regular dev machine, test via `https://localhost` or accept the fallback path.

- [ ] **Step 1: Start the app**

Run: `npm run dev`. Open `/` (the upload route).

- [ ] **Step 2: Live camera (secure context)**

On a secure context (e.g. `localhost`), confirm:
- The live camera shows inside the bubble frame, filling the circle, with the `bubble.png` rim on top.
- The flip button switches rear/front; the front camera preview is mirrored.

- [ ] **Step 3: Capture + sign**

- Tap the shutter. The frozen photo appears in the same bubble; controls switch to Retake / Clear / Send.
- Sign in the bottom band with the white pen; the "Sign here" hint disappears once you draw.
- Tap Clear; the signature is wiped.
- Tap Retake; the live camera restarts and the photo/signature are discarded.

- [ ] **Step 4: Send + fidelity check (the key requirement)**

- Re-capture, sign, tap Send to Wall.
- Open `/#/wall` on another tab/device. Confirm the new bubble spotlights and lands on the wall.
- Compare the wall bubble to the upload preview: the photo crop and the signature position/size must be **identical** (allowing for bubble-size scaling).

- [ ] **Step 5: "Take another" gate**

After sending, confirm the device shows the "Sent to the wall!" confirmation and waits — it returns to the live camera only after tapping **Take another**.

- [ ] **Step 6: No caption anywhere**

Confirm there is no caption input on the upload page, and the wall bubble shows no caption.

- [ ] **Step 7: Fallback path**

Simulate camera failure (deny camera permission, or load over plain HTTP / insecure origin). Confirm:
- A clear message appears and the bubble area becomes a "Tap to open your camera" button.
- Tapping it opens the native camera; the captured photo flows into the same review → sign → send path.

- [ ] **Step 8: Portrait responsiveness**

In portrait on a phone-sized and tablet-sized viewport, confirm the bubble and all controls fit without scrolling. Rotate to landscape and confirm it remains usable (height-constrained sizing).

- [ ] **Step 9: Upload failure handling**

Stop the backend and tap Send. Confirm an error toast appears and the screen stays on `review` so the guest can retry.

- [ ] **Step 10: Camera cleanup**

After sending or navigating away, confirm the camera indicator turns off (tracks stopped). Switching browser tabs should stop the feed and resume it on return.

---

## Out of Scope (for this plan)

- Server / API changes; `PhotoEntry` schema changes.
- Wall behavior changes beyond the backward-compatible `Bubble` refactor.
- `/wall-6`, admin.
- The dedicated device's secure-context setup (deployment step; see spec).
- Multi-photo, filters, captions, signature colors beyond white.
