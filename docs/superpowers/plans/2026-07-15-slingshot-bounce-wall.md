# Slingshot → Bounce → Sparkle → Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emphasize "bounce" in the two-device flow — the iPad guest slingshots the signed bubble up off the screen, and the wall plays a rise-from-bottom → subtle bounce → radial sparkle → join-the-wall sequence for the newly committed photo.

**Architecture:** A pure presentation layer on top of the existing, verified pipeline (pending queue → `commitPending` → `new_photo` socket → wall spotlight → physics wall). The iPad and wall are two separate screens; this is two coordinated animations, not one object crossing devices. No server, queue, or data-flow changes.

**Tech Stack:** React 19 + react-router-dom (HashRouter), Vite, TypeScript, Tailwind classes (CDN), raw CSS transitions + `requestAnimationFrame` canvas. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-07-15-slingshot-bounce-wall-design.md`

**Branch:** `claude/two-device-capture-sign-d56f0f` (bubble variant)

---

## Testing note (read first)

This repo has **no client-side test framework** (only the server has `node --test`). Adding one is out of scope. Client work is therefore verified the way the rest of this branch was: **`npx tsc --noEmit` and `npm run build` must stay green**, and each visible change is verified by **driving the real app** in a browser. Every task below ends with those gates. Do not claim a visual behavior works without observing it.

Two quirks observed while verifying earlier work on this branch, so you don't misread them as bugs:
- Browser-pane **screenshots can time out** on the wall because its animation loop keeps the renderer busy. Prefer DOM/state assertions (read the page, inspect elements) over screenshots to confirm behavior.
- The MCP **`resize_window` does not dispatch a `resize` event** to the page. If you need to exercise resize-driven code, dispatch `window.dispatchEvent(new Event('resize'))` yourself.

Local run: `npm run dev` starts Vite + the server together. Seed the wall/queue with `curl` (examples in Task 5). Clean up any seeded photos and run `git restore server/photos.json` if your testing dirties it.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `components/SparkleBurst.tsx` | **Create.** Self-contained canvas radial-burst animation. Props: `size`. Plays once, stops when particles die. No app knowledge. |
| `components/DisplayView.tsx` | **Modify.** Swap the spotlight `entering` easing to a gentle overshoot (subtle bounce), shorten the featured hold to ~3s, mount `SparkleBurst` at the settle, honor reduced motion. |
| `hooks/useSlingshot.ts` | **Create.** Pointer/drag/threshold logic for the pull-down-to-launch gesture. Returns `offsetY`, `isDragging`, and pointer handlers; calls `onLaunch`/`onCancel`. Knows nothing about photos or commits. |
| `components/SignView.tsx` | **Modify.** Wrap `SignableBubble` in the sling-draggable container + tether + "pull down to send" hint; add the flick-up launch that calls the existing commit path; remove the "Upload to Wall" button; keep Clear/Skip/Discard. |

Ordering rationale: build the sparkle first (Task 1), integrate it into the wall (Task 2), build the gesture hook (Task 3), wire it into the iPad screen (Task 4), then verify the whole two-screen flow end to end (Task 5).

---

## Task 1: SparkleBurst component

A self-contained canvas animation: a radial ring of particles bursts outward from the bubble's rim, plus a smaller echo ring, lingering with a twinkle, then dissolving. No gravity, no drift. This is the approved v4 prototype, ported to a React component.

**Files:**
- Create: `components/SparkleBurst.tsx`

- [ ] **Step 1: Write the component**

Create `components/SparkleBurst.tsx`:

```tsx
import React, { useEffect, useRef } from 'react';

interface SparkleBurstProps {
  size: number; // spotlight diameter in px; particle speed/canvas scale from this
}

// A one-shot radial sparkle burst on a transparent canvas. Particles fire evenly
// outward from the bubble's rim (a full circle), plus a smaller echo ring, then
// linger and fade in place — no gravity, no directional drift. The component
// stops the rAF loop once every particle has died; the parent unmounts it.
export const SparkleBurst: React.FC<SparkleBurstProps> = ({ size }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Square canvas padded around the bubble so outward particles have room.
    const pad = size * 0.6;
    const dim = size + pad * 2;
    canvas.width = dim;
    canvas.height = dim;
    const cx = dim / 2;
    const cy = dim / 2;
    const r = size / 2; // bubble radius
    const speedScale = size / 600; // prototype tuned at ~600px

    interface P {
      x: number; y: number; vx: number; vy: number;
      life: number; decay: number; sz: number; tw: number; gold: boolean;
    }
    const particles: P[] = [];

    const spawnRing = (n: number, speedBase: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
        const sp = speedBase * (0.85 + Math.random() * 0.3) * speedScale;
        particles.push({
          x: cx + Math.cos(a) * r * 0.85,
          y: cy + Math.sin(a) * r * 0.85,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          decay: 0.006 + Math.random() * 0.004,
          sz: (1.6 + Math.random() * 2.6) * Math.max(1, speedScale),
          tw: Math.random() * Math.PI * 2,
          gold: Math.random() < 0.5,
        });
      }
    };

    const SPARKS = 28;
    spawnRing(SPARKS, 5.2);
    const echo = window.setTimeout(() => spawnRing(Math.round(SPARKS * 0.6), 3.0), 130);

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, dim, dim);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of particles) {
        p.vx *= 0.95;
        p.vy *= 0.95; // symmetric drag, no vertical bias
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        p.tw += 0.2;
        if (p.life > 0) {
          const tw = 0.65 + 0.35 * Math.sin(p.tw);
          ctx.globalAlpha = Math.max(0, p.life) * tw;
          ctx.fillStyle = p.gold ? 'rgba(255,225,150,1)' : 'rgba(180,205,255,1)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.sz * (0.5 + 0.5 * p.life), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (let i = particles.length - 1; i >= 0; i--) {
        if (particles[i].life <= 0) particles.splice(i, 1);
      }
      if (particles.length > 0) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(echo);
    };
  }, [size]);

  const dim = size + size * 0.6 * 2;
  return (
    <canvas
      ref={canvasRef}
      style={{ width: dim, height: dim, pointerEvents: 'none' }}
      aria-hidden
    />
  );
};

export default SparkleBurst;
```

- [ ] **Step 2: Verify it typechecks and builds**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds. (Visual verification happens in Task 2, where it is mounted on the wall.)

- [ ] **Step 3: Commit**

```bash
git add components/SparkleBurst.tsx
git commit -m "feat(wall): add radial sparkle burst component"
```

---

## Task 2: Wall bounce-in, shorter hold, sparkle at settle

The wall's spotlight already enters from the bottom via a CSS transition. Keep the direction; change the *feel*: a gentle single-overshoot settle, a shorter featured hold, and the sparkle firing the moment it settles. Rigid bubble — only position animates, never scale, so faces never distort.

**Files:**
- Modify: `components/DisplayView.tsx`

- [ ] **Step 1: Import SparkleBurst**

In `components/DisplayView.tsx`, add the import next to the other component imports (it currently imports `Bubble` on line 5):

```tsx
import { SparkleBurst } from './SparkleBurst';
```

- [ ] **Step 2: Add timing/easing constants**

Immediately after the `type SpotlightState = ...` line (line 10), add:

```tsx
// Spotlight bounce-in tuning.
const ENTER_MS = 1300;          // rise-from-bottom → settle duration
const HOLD_MS = 3000;           // featured dwell before handing off to the wall
// Gentle single overshoot ("subtle" bounce). translateY eases from the bottom to
// center, overshoots slightly PAST center, and settles — the bubble is never scaled.
const ENTER_EASE_BOUNCE = 'cubic-bezier(0.34, 1.28, 0.64, 1)';
```

- [ ] **Step 3: Detect reduced motion**

Inside the `DisplayView` component, next to the other top-level `const` declarations (e.g. just after `const isSpotlightActive = spotlightState !== 'idle';` on line 202), add:

```tsx
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

- [ ] **Step 4: Use ENTER_MS for the entering timer**

In the spotlight state-machine effect, the `entering` branch currently reads (line 146):

```tsx
      t = setTimeout(() => setSpotlightState('visible'), 1500);
```

Change the `1500` to `ENTER_MS`:

```tsx
      t = setTimeout(() => setSpotlightState('visible'), ENTER_MS);
```

- [ ] **Step 5: Use HOLD_MS for the featured dwell**

In the same effect, the `visible` branch currently opens (line 154):

```tsx
      t = setTimeout(() => {
```

and closes with `}, 5000);` (line 174). Change that closing delay from `5000` to `HOLD_MS`:

```tsx
      }, HOLD_MS);
```

- [ ] **Step 6: Apply the bounce easing to the entering transition**

In the spotlight overlay render, the moving bubble's wrapper currently reads (lines 384–392):

```tsx
            <div
              className="ease-out"
              style={{
                transition: spotlightReady
                  ? `transform ${spotlightState === 'entering' ? 1500 : 800}ms ease-out`
                  : 'none',
                transform,
              }}
            >
```

Replace it with (bounce easing for `entering`, plain ease-out for the exit, and a reduced-motion fallback):

```tsx
            <div
              style={{
                transition: spotlightReady
                  ? `transform ${spotlightState === 'entering' ? ENTER_MS : 800}ms ${
                      spotlightState === 'entering'
                        ? reducedMotion
                          ? 'ease-out'
                          : ENTER_EASE_BOUNCE
                        : 'ease-out'
                    }`
                  : 'none',
                transform,
              }}
            >
```

- [ ] **Step 7: Mount the sparkle at the settle moment**

The spotlight overlay is rendered by an IIFE that ends with `})()}` (line 397). Immediately **after** that closing `})()}` and before the closing `</div>` of the top-level container, add:

```tsx
      {/* Sparkle burst — fires when the bubble settles (entering → visible). Sits
          above the spotlight bubble (z-[61]) so the ring reads over it. Keyed by
          photo id so it replays for each new photo. Skipped under reduced motion. */}
      {spotlightPhoto && spotlightState === 'visible' && !reducedMotion && (
        <div className="fixed inset-0 z-[61] flex items-center justify-center pointer-events-none">
          <SparkleBurst key={spotlightPhoto.id} size={spotlightDiameter} />
        </div>
      )}
```

- [ ] **Step 8: Verify it typechecks and builds**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 9: Verify the bounce + sparkle by driving the wall**

Start the app: `npm run dev`. In a browser, open the wall at `http://localhost:5173/#/wall`.

Seed one photo through the real pending → commit path so it arrives via `new_photo` (from a second terminal):

```bash
IMG='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=='
curl -s -X POST http://localhost:3000/api/pending -H 'Content-Type: application/json' \
  -d "{\"id\":\"bounce-demo\",\"rotation\":0,\"timestamp\":9999999999999,\"image\":\"$IMG\"}"
curl -s -X POST http://localhost:3000/api/pending/bounce-demo/commit -H 'Content-Type: application/json' -d '{}'
```

Observe on `#/wall`: the bubble **rises from the bottom**, overshoots the center slightly and settles (a **subtle** single bounce, the circle never distorting), a **radial sparkle** fires at the settle, it **holds ~3s**, then shrinks into a wall slot and becomes a floating bubble. (Prefer inspecting the DOM — a `<canvas>` appears at settle, and the spotlight `<div>`'s transition uses the bounce cubic-bezier — over screenshots, which can time out on the animated wall.)

Clean up the seeded photo:

```bash
curl -s -X DELETE http://localhost:3000/api/photos/bounce-demo
```

Then `git restore server/photos.json` if it was dirtied.

- [ ] **Step 10: Commit**

```bash
git add components/DisplayView.tsx
git commit -m "feat(wall): subtle bounce-in, shorter hold, sparkle at settle"
```

---

## Task 3: useSlingshot hook

The pointer/drag logic for the pull-down-to-launch gesture, isolated so `SignView` stays readable. It maps a downward pull to a rubber-banded visual offset, rejects presses that start on the signature band, and on release decides launch vs. cancel by a distance threshold. It knows nothing about photos, signatures, or commits.

**Files:**
- Create: `hooks/useSlingshot.ts`

- [ ] **Step 1: Write the hook**

Create `hooks/useSlingshot.ts`:

```ts
import { useCallback, useRef, useState } from 'react';

export interface SlingshotOptions {
  /** Raw downward pull (px) required to launch on release. */
  thresholdPx: number;
  /** Visual damping of the raw pull (0–1). Lower = more elastic. Default 0.65. */
  rubberBand?: number;
  /**
   * Only start a sling when the pointerdown lands in the top fraction of the
   * element. Presses below this (the signature band) are left alone so drawing
   * still works. Default 0.58 (matches the bubble's photo-vs-band geometry).
   */
  graceTopFraction?: number;
  /** Fired on release when the pull crossed the threshold. */
  onLaunch: () => void;
  /** Fired on release when the pull did NOT cross the threshold. */
  onCancel?: () => void;
  /** When true, the gesture is inert. */
  disabled?: boolean;
}

export interface SlingshotState {
  /** Current downward visual offset (px, >= 0) to translate the bubble by. */
  offsetY: number;
  isDragging: boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

export const useSlingshot = (opts: SlingshotOptions): SlingshotState => {
  const {
    thresholdPx,
    rubberBand = 0.65,
    graceTopFraction = 0.58,
    onLaunch,
    onCancel,
    disabled,
  } = opts;

  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const rawRef = useRef(0);       // largest raw downward pull this drag
  const activeRef = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = (e.clientY - rect.top) / rect.height;
      if (frac > graceTopFraction) return; // started on the signature band → drawing
      activeRef.current = true;
      startYRef.current = e.clientY;
      rawRef.current = 0;
      setIsDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw if the pointer is already gone; ignore.
      }
    },
    [disabled, graceTopFraction]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!activeRef.current) return;
      const raw = Math.max(0, e.clientY - startYRef.current); // downward only
      rawRef.current = raw;
      setOffsetY(raw * rubberBand);
    },
    [rubberBand]
  );

  const end = useCallback(
    (launch: boolean) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      const pulled = rawRef.current;
      setIsDragging(false);
      setOffsetY(0);
      if (launch && pulled >= thresholdPx) onLaunch();
      else onCancel?.();
    },
    [thresholdPx, onLaunch, onCancel]
  );

  const onPointerUp = useCallback(() => end(true), [end]);
  const onPointerCancel = useCallback(() => end(false), [end]);

  return {
    offsetY,
    isDragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
};
```

- [ ] **Step 2: Verify it typechecks and builds**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds. (The hook is exercised in Task 4.)

- [ ] **Step 3: Commit**

```bash
git add hooks/useSlingshot.ts
git commit -m "feat(sign): add useSlingshot pull-to-launch gesture hook"
```

---

## Task 4: Wire the slingshot into SignView

Replace the "Upload to Wall" button with the pull-down gesture. The bubble follows the finger with elastic resistance and a stretchy tether; releasing past the threshold flicks it up off-screen and fires the existing commit path. A bobbing "pull down to send" hint makes the gesture discoverable. Clear/Skip/Discard are unchanged.

**Files:**
- Modify: `components/SignView.tsx`

- [ ] **Step 1: Replace the file**

Replace the entire contents of `components/SignView.tsx` with:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { PendingPhoto } from '../types';
import { useToast } from '../context/ToastContext';
import { BubbleFrame } from './BubbleFrame';
import { SignableBubble, SignableBubbleHandle } from './SignableBubble';
import { useSlingshot } from '../hooks/useSlingshot';
import {
  commitPending,
  discardPending,
  getPending,
  skipPending,
  subscribeToPending,
} from '../services/storageService';

// How long the bubble takes to flick up and off the screen on launch.
const FLICK_MS = 450;

const SignView: React.FC = () => {
  const { showToast } = useToast();
  const signRef = useRef<SignableBubbleHandle>(null);

  const [queue, setQueue] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sized for a tablet in either orientation.
  const [diameter, setDiameter] = useState(420);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setDiameter(Math.round(Math.max(280, Math.min(w * 0.7, h * 0.6))));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  useEffect(() => {
    let active = true;

    getPending().then((fetched) => {
      if (!active) return;
      // Merge rather than overwrite: a pending_added event can land while this
      // fetch is still in flight, and the response reflects server state from
      // before that photo existed. Keep the fetched (oldest-first) order, then
      // append anything the socket added that the fetch didn't know about.
      setQueue((prev) => {
        const fetchedIds = new Set(fetched.map((p) => p.id));
        return [...fetched, ...prev.filter((p) => !fetchedIds.has(p.id))];
      });
    });

    const unsubscribe = subscribeToPending({
      onAdded: (photo) =>
        setQueue((prev) => (prev.some((p) => p.id === photo.id) ? prev : [...prev, photo])),
      onRemoved: (id) => setQueue((prev) => prev.filter((p) => p.id !== id)),
      onReordered: (items) => setQueue(items),
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const current = queue[0];
  const waiting = Math.max(queue.length - 1, 0);

  const removeFromQueue = (id: string) => setQueue((prev) => prev.filter((p) => p.id !== id));

  // The server says this photo is no longer in the queue (404). It may never send
  // a socket event for it — if the removal was broadcast before we loaded, there's
  // nothing left to broadcast. Drop it locally so a phantom head can't wedge the
  // station forever. Only for `gone`; a network failure stays retryable.
  const handleGone = (id: string) => {
    removeFromQueue(id);
    showToast('That photo was already handled.', 'info');
  };

  // Launch = the slingshot release past threshold. Fire the flick animation and
  // the commit concurrently; advance the queue only after the flick finishes so
  // the current bubble isn't swapped out mid-flight. A network failure snaps the
  // bubble back and stays retryable; `gone` advances past a phantom.
  const handleLaunch = async () => {
    if (!current || busy) return;
    const id = current.id;
    const signature = signRef.current?.getSignature(); // undefined is allowed
    setBusy(true);
    setLaunching(true);

    const result = await commitPending(id, signature);
    const settleMs = reducedMotion ? 0 : FLICK_MS;

    if (result.success) {
      window.setTimeout(() => {
        removeFromQueue(id);
        showToast('Sent to the wall ✨', 'success');
        setLaunching(false);
        setBusy(false);
      }, settleMs);
    } else if (result.gone) {
      window.setTimeout(() => {
        handleGone(id);
        setLaunching(false);
        setBusy(false);
      }, settleMs);
    } else {
      setLaunching(false);
      setBusy(false);
      showToast(result.error || 'Could not upload. Check the connection.', 'error');
    }
  };

  const handleDiscard = async () => {
    if (!current || busy) return;
    setBusy(true);

    const result = await discardPending(current.id);
    if (result.success) {
      removeFromQueue(current.id);
      showToast('Photo discarded.', 'info');
    } else if (result.gone) {
      handleGone(current.id);
    } else {
      showToast(result.error || 'Could not discard. Check the connection.', 'error');
    }
    setBusy(false);
  };

  const handleSkip = async () => {
    if (!current || busy || waiting === 0) return;
    setBusy(true);

    const result = await skipPending(current.id);
    if (result.gone) {
      handleGone(current.id);
    } else if (!result.success) {
      showToast(result.error || 'Could not skip. Check the connection.', 'error');
    }
    // On success the server broadcasts pending_reordered, which updates the queue.
    setBusy(false);
  };

  const sling = useSlingshot({
    thresholdPx: diameter * 0.22,
    graceTopFraction: 0.58, // top ~58% of the bubble is the photo; below is the signing band
    disabled: busy || launching,
    onLaunch: handleLaunch,
  });

  const bubbleTransform =
    launching && !reducedMotion
      ? 'translateY(-120vh)'
      : `translateY(${sling.offsetY}px)`;
  const bubbleTransition = launching
    ? `transform ${FLICK_MS}ms ease-out, opacity ${FLICK_MS}ms ease-out`
    : sling.isDragging
    ? 'none'
    : 'transform 300ms cubic-bezier(0.34, 1.4, 0.5, 1)'; // snap-back spring

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
        {waiting > 0 && (
          <div className="px-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-sm text-white/80">
            {waiting} waiting
          </div>
        )}

        {current ? (
          <>
            {/* Sling-draggable bubble with a stretchy tether behind it. */}
            <div className="relative" style={{ width: diameter, height: diameter }}>
              {sling.isDragging && sling.offsetY > 4 && !reducedMotion && (
                <svg
                  className="absolute inset-0 pointer-events-none overflow-visible"
                  width={diameter}
                  height={diameter}
                  aria-hidden
                >
                  <line
                    x1={diameter * 0.2}
                    y1={0}
                    x2={diameter * 0.5}
                    y2={sling.offsetY}
                    stroke="rgba(255,255,255,0.45)"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                  <line
                    x1={diameter * 0.8}
                    y1={0}
                    x2={diameter * 0.5}
                    y2={sling.offsetY}
                    stroke="rgba(255,255,255,0.45)"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                </svg>
              )}
              <div
                {...sling.handlers}
                style={{
                  touchAction: 'none',
                  transform: bubbleTransform,
                  opacity: launching && !reducedMotion ? 0 : 1,
                  transition: bubbleTransition,
                  cursor: 'grab',
                }}
              >
                <SignableBubble
                  key={current.id}
                  ref={signRef}
                  diameter={diameter}
                  imageDataUrl={current.imageUrl}
                />
              </div>
            </div>

            {/* Discoverability hint for the gesture (hidden while dragging/launching). */}
            {!sling.isDragging && !launching && (
              <div className="flex flex-col items-center gap-1 text-white/80">
                <span className="text-2xl animate-bounce" aria-hidden>
                  ⤓
                </span>
                <span className="text-sm">Pull down to send ✨</span>
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap justify-center">
              <button
                onClick={() => signRef.current?.clear()}
                disabled={busy}
                className="px-6 py-3 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
              >
                Clear
              </button>
              <button
                onClick={handleSkip}
                disabled={busy || waiting === 0}
                className="px-6 py-3 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
              >
                Skip
              </button>
              <button
                onClick={handleDiscard}
                disabled={busy}
                className="px-6 py-3 rounded-full text-rose-300/90 hover:text-rose-200 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
              >
                Discard
              </button>
            </div>
          </>
        ) : (
          <BubbleFrame diameter={diameter}>
            <div className="w-full h-full flex flex-col items-center justify-center text-center gap-2 px-6 text-white">
              <span className="text-2xl font-semibold">All caught up</span>
              <span className="text-white/70 text-sm">Waiting for the next photo…</span>
            </div>
          </BubbleFrame>
        )}
      </div>
    </div>
  );
};

export default SignView;
```

- [ ] **Step 2: Verify it typechecks and builds**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds. (The `Upload to Wall` button is gone; launching is now the gesture.)

- [ ] **Step 3: Verify the gesture by driving the signing station**

Start the app (`npm run dev`). Seed a pending photo so the station has something to launch:

```bash
IMG='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=='
curl -s -X POST http://localhost:3000/api/pending -H 'Content-Type: application/json' \
  -d "{\"id\":\"sling-demo\",\"rotation\":0,\"timestamp\":1,\"image\":\"$IMG\"}"
```

Open `http://localhost:5173/#/sign` and confirm:
1. The bubble shows with a bobbing **"Pull down to send ✨"** hint, and Clear/Skip/Discard buttons. There is **no** "Upload to Wall" button.
2. **Drawing still works:** sign in the lower band — strokes appear and do **not** move the bubble.
3. **Short pull cancels:** grab the photo (upper) area, drag down a little, release → the bubble **snaps back**, and `GET http://localhost:3000/api/pending` still shows `sling-demo` (nothing committed).
4. **Full pull launches:** grab and drag down past ~22% of the bubble height, release → the bubble **flicks up and off**, a success toast shows, and the photo is gone from `GET /api/pending` and now present in `GET /api/photos`.

(For a synthetic drag in a headless pane, dispatch `pointerdown` on the bubble's photo area, several `pointermove`s increasing `clientY`, then `pointerup`, and assert the queue via the API.)

Clean up:

```bash
curl -s -X DELETE http://localhost:3000/api/photos/sling-demo   # if it was launched
curl -s -X DELETE http://localhost:3000/api/pending/sling-demo   # if it was left pending
```

Then `git restore server/photos.json` if dirtied.

- [ ] **Step 4: Commit**

```bash
git add components/SignView.tsx
git commit -m "feat(sign): slingshot the signed bubble to launch it to the wall"
```

---

## Task 5: End-to-end verification

Drive the full two-screen story and the fallbacks. Verification only — code changes only if something is wrong.

**Files:** none (unless fixing a defect found here).

- [ ] **Step 1: Start the app**

Run: `npm run dev`
Expected: Vite serves the client; the server logs `Server running on http://0.0.0.0:3000`.

- [ ] **Step 2: Walk the happy path across both screens**

Open a phone-sized window at `#/sign` and another at `#/wall` (seed a pending photo via the Task 4 curl if needed, or capture one from `#/` if a camera is available).

1. On `#/sign`: sign the bubble, then pull it down and release past the threshold. Confirm it **flicks up and off** the screen and a success toast appears.
2. On `#/wall`: confirm the committed photo **rises from the bottom**, settles with a **subtle single overshoot** (the circle never distorts), a **radial sparkle** fires at the settle, it **holds ~3s**, then shrinks into a wall slot and joins the floating bubbles — **with its signature visible**.

- [ ] **Step 3: Queue behavior**

Send **three** photos (commit three via the pending API, staggered). On `#/wall`, confirm they are featured **one at a time in order**, each with its own bounce + sparkle, and the others wait their turn (no overlapping spotlights).

- [ ] **Step 4: Fallbacks**

1. **Short pull:** on `#/sign`, a small drag that doesn't cross the threshold snaps back and commits nothing.
2. **Failure path:** stop the server, then launch on `#/sign`. Confirm the bubble **springs back** into view and an error toast shows (nothing lost). Restart the server.
3. **Reduced motion:** enable `prefers-reduced-motion: reduce` (browser devtools rendering emulation). Confirm the iPad launch **skips the flick** (photo still commits) and the wall shows **no bounce overshoot and no sparkle** — the photo simply appears, holds, and joins.

- [ ] **Step 5: Commit any fixes**

If any behavior above is wrong, fix it and commit. If everything passes, there is nothing to commit for this task.

---

## Notes / deliberately out of scope

- No cross-device in-flight sync: the iPad flick and the wall bounce are independent animations coordinated only by the existing `new_photo` event.
- Pull strength does not affect the wall animation (identical regardless); it only shapes the iPad-side feel.
- The serial one-featured-bubble-at-a-time queue is unchanged.
- No server, `storageService`, `types.ts`, or physics-engine changes. `SignableBubble`, `BubbleFrame`, and `Bubble` are not modified — the sling reads the signing band by geometry fraction from `SignView`, and the signature already renders above the glass from earlier work on this branch.
```
