# Bubble Wall Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/wall` marquee polaroid grid with a floating-bubble simulation: up to 8 photos rendered inside translucent bubbles that drift gently with soft collisions, with new uploads floating up from the bottom of the screen as a giant bubble before shrinking into the wall.

**Architecture:** A `useBubblePhysics` hook owns mutable position/velocity refs and drives a `requestAnimationFrame` loop, writing positions directly to DOM via `transform: translate3d(...)`. The `Bubble` component is the visual unit (photo + signature + `bubble.png` overlay). `DisplayView` orchestrates the spotlight state machine, the websocket queue, and FIFO eviction when 8 bubbles are exceeded.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vite. No physics library (hand-rolled, ~30 lines). No new dependencies.

**Testing approach:** Codebase has no test framework — manual verification with clear pass criteria per task. Physics functions are written pure for easy future unit testing.

**Spec:** [docs/superpowers/specs/2026-05-22-bubble-wall-display-design.md](../specs/2026-05-22-bubble-wall-display-design.md)

---

## File Structure

**New files:**
- `hooks/useBubblePhysics.ts` — physics state, rAF loop, collision resolution
- `components/Bubble.tsx` — single-bubble renderer (photo + signature + `bubble.png` overlay)
- `lib/bubblePhysics.ts` — pure helper functions (collision math, clamps) for testability

**Modified files:**
- `components/DisplayView.tsx` — body replaced; spotlight state, websocket subs, QR + logo retained

**Untouched:**
- `components/Polaroid.tsx`, `components/DisplayViewGrid.tsx`, `components/UploadView.tsx`, `components/AdminView.tsx`, `App.tsx`, server code

---

## Task 1: Add physics constants & pure helper functions

**Files:**
- Create: `lib/bubblePhysics.ts`

- [ ] **Step 1: Create the file with constants and pure functions**

Create `lib/bubblePhysics.ts`:

```typescript
export const PHYSICS = {
  WIND_FORCE: 0.02,        // Max random force per axis per frame
  DAMPING: 0.985,          // Velocity damping per frame
  MAX_SPEED: 0.6,          // Max velocity magnitude (px/frame)
  WALL_BOUNCE_DAMP: 0.5,   // Velocity scale on wall collision
  COLLISION_DAMP: 0.7,     // Velocity scale on bubble-bubble collision
  RADIUS_MIN: 90,
  RADIUS_MAX: 200,
  RADIUS_RATIO_MIN: 0.09,  // Min radius as fraction of min(viewportW, viewportH)
  RADIUS_RATIO_MAX: 0.13,
  MAX_BUBBLES: 8,
} as const;

export interface BubbleState {
  id: string;
  photoId: string;        // PhotoEntry.id, used to look up image/signature
  x: number;              // center x in container coordinates
  y: number;              // center y
  vx: number;             // velocity x (px/frame)
  vy: number;             // velocity y
  radius: number;
  spawnTime: number;
  lifecycle: 'entering' | 'live' | 'exiting';
}

export const randomInRange = (min: number, max: number) => min + Math.random() * (max - min);

export const computeSpawnRadius = (viewportW: number, viewportH: number): number => {
  const dim = Math.min(viewportW, viewportH);
  const r = dim * randomInRange(PHYSICS.RADIUS_RATIO_MIN, PHYSICS.RADIUS_RATIO_MAX);
  return Math.max(PHYSICS.RADIUS_MIN, Math.min(PHYSICS.RADIUS_MAX, r));
};

// Clamp a bubble's position so its edge stays inside [0, w] x [0, h].
// Returns new (x, y, vx, vy) — velocity is reflected and damped if a wall was hit.
export const resolveWallCollision = (
  x: number, y: number, vx: number, vy: number, radius: number, w: number, h: number
) => {
  let nx = x, ny = y, nvx = vx, nvy = vy;
  if (nx - radius < 0) { nx = radius; nvx = -nvx * PHYSICS.WALL_BOUNCE_DAMP; }
  if (nx + radius > w) { nx = w - radius; nvx = -nvx * PHYSICS.WALL_BOUNCE_DAMP; }
  if (ny - radius < 0) { ny = radius; nvy = -nvy * PHYSICS.WALL_BOUNCE_DAMP; }
  if (ny + radius > h) { ny = h - radius; nvy = -nvy * PHYSICS.WALL_BOUNCE_DAMP; }
  return { x: nx, y: ny, vx: nvx, vy: nvy };
};

// Resolve elastic collision between two bubbles of equal mass.
// Mutates positions to remove overlap and exchanges normal velocity components.
export const resolveBubbleCollision = (a: BubbleState, b: BubbleState): void => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const minDist = a.radius + b.radius;
  if (dist === 0 || dist >= minDist) return;

  const nx = dx / dist;  // collision normal
  const ny = dy / dist;
  const overlap = minDist - dist;

  // Positional correction (each moves half the overlap)
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;

  // Normal velocity components
  const an = a.vx * nx + a.vy * ny;
  const bn = b.vx * nx + b.vy * ny;

  // Only resolve if moving toward each other
  if (an - bn <= 0) return;

  const damp = PHYSICS.COLLISION_DAMP;
  // Swap normal components, damped
  a.vx += (bn - an) * nx * damp;
  a.vy += (bn - an) * ny * damp;
  b.vx += (an - bn) * nx * damp;
  b.vy += (an - bn) * ny * damp;
};

export const clampSpeed = (vx: number, vy: number) => {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed <= PHYSICS.MAX_SPEED) return { vx, vy };
  const scale = PHYSICS.MAX_SPEED / speed;
  return { vx: vx * scale, vy: vy * scale };
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors related to `lib/bubblePhysics.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/bubblePhysics.ts
git commit -m "feat(wall): add physics constants and pure helpers for bubble simulation"
```

---

## Task 2: Build the `Bubble` component (visual only, no physics yet)

**Files:**
- Create: `components/Bubble.tsx`

- [ ] **Step 1: Create the component**

Create `components/Bubble.tsx`:

```typescript
import React from 'react';
import { PhotoEntry } from '../types';

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
  const photoSize = diameter * 0.78;  // inner photo area (leaves room for glass rim)
  const photoOffset = (diameter - photoSize) / 2;

  const imageUrl = photo
    ? (photo.imageUrl || (photo.images && photo.images[0]) || '')
    : '';

  return (
    <div
      className={`relative ${className}`}
      style={{
        width: diameter,
        height: diameter,
        ...style,
      }}
    >
      {/* Photo (clipped to circle), only if a photo is provided */}
      {imageUrl && (
        <div
          className="absolute overflow-hidden rounded-full bg-black/20"
          style={{
            width: photoSize,
            height: photoSize,
            top: photoOffset,
            left: photoOffset,
          }}
        >
          <img
            src={imageUrl}
            alt=""
            className="w-full h-full object-cover"
            draggable={false}
          />
          {/* Signature overlay on lower portion */}
          {photo?.signature && (
            <img
              src={photo.signature}
              alt=""
              className="absolute left-0 right-0 bottom-0 w-full pointer-events-none"
              style={{
                height: '40%',
                objectFit: 'contain',
                objectPosition: 'center bottom',
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
              }}
              draggable={false}
            />
          )}
        </div>
      )}

      {/* Placeholder text (for empty-state instructional bubble) */}
      {!imageUrl && placeholderText && (
        <div
          className="absolute inset-0 flex items-center justify-center text-center text-white font-semibold px-8"
          style={{ fontSize: diameter * 0.07 }}
        >
          {placeholderText}
        </div>
      )}

      {/* Bubble PNG overlay (glass rim & highlights) */}
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

- [ ] **Step 2: Manual visual check**

Temporarily import the Bubble into `App.tsx` or a scratch route and render `<Bubble photo={null} diameter={240} placeholderText="Hello" />`. Confirm:
- The bubble PNG renders crisply with no distortion.
- Placeholder text is centered and visible.

Pass a real PhotoEntry (you can hard-code one) and confirm:
- Photo appears inside the bubble, clipped to a circle.
- Photo fills its area (object-cover).
- If a signature is set, it overlays the lower portion.

Revert any scratch wiring after checking.

- [ ] **Step 3: Commit**

```bash
git add components/Bubble.tsx
git commit -m "feat(wall): add Bubble component renderer"
```

---

## Task 3: Build the `useBubblePhysics` hook (state + add/remove API, no loop yet)

**Files:**
- Create: `hooks/useBubblePhysics.ts`

- [ ] **Step 1: Create the hook**

Create `hooks/useBubblePhysics.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { BubbleState, PHYSICS } from '../lib/bubblePhysics';

export interface UseBubblePhysicsResult {
  bubbles: BubbleState[];
  containerRef: React.RefObject<HTMLDivElement>;
  registerBubbleEl: (id: string, el: HTMLDivElement | null) => void;
  spawn: (params: { photoId: string; x: number; y: number; radius: number; vx?: number; vy?: number }) => string;
  remove: (id: string) => void;
  markExiting: (id: string) => void;
  getBubble: (id: string) => BubbleState | undefined;
}

export const useBubblePhysics = (): UseBubblePhysicsResult => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bubblesRef = useRef<BubbleState[]>([]);
  const elementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [renderTrigger, setRenderTrigger] = useState(0);

  // Force a re-render so React renders/unrenders bubble nodes when the set changes.
  const bump = useCallback(() => setRenderTrigger((n) => n + 1), []);

  const registerBubbleEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) elementsRef.current.set(id, el);
    else elementsRef.current.delete(id);
  }, []);

  const spawn = useCallback((params: {
    photoId: string; x: number; y: number; radius: number; vx?: number; vy?: number;
  }): string => {
    const id = `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bubble: BubbleState = {
      id,
      photoId: params.photoId,
      x: params.x,
      y: params.y,
      vx: params.vx ?? 0,
      vy: params.vy ?? 0,
      radius: params.radius,
      spawnTime: Date.now(),
      lifecycle: 'live',
    };
    bubblesRef.current = [...bubblesRef.current, bubble];
    bump();
    return id;
  }, [bump]);

  const remove = useCallback((id: string) => {
    bubblesRef.current = bubblesRef.current.filter((b) => b.id !== id);
    bump();
  }, [bump]);

  const markExiting = useCallback((id: string) => {
    bubblesRef.current = bubblesRef.current.map((b) =>
      b.id === id ? { ...b, lifecycle: 'exiting' as const } : b
    );
    bump();
  }, [bump]);

  const getBubble = useCallback(
    (id: string) => bubblesRef.current.find((b) => b.id === id),
    []
  );

  // Keep elementsRef cleaned up
  useEffect(() => {
    const validIds = new Set(bubblesRef.current.map((b) => b.id));
    for (const id of Array.from(elementsRef.current.keys())) {
      if (!validIds.has(id)) elementsRef.current.delete(id);
    }
  }, [renderTrigger]);

  return {
    bubbles: bubblesRef.current,
    containerRef,
    registerBubbleEl,
    spawn,
    remove,
    markExiting,
    getBubble,
  };
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/useBubblePhysics.ts
git commit -m "feat(wall): add useBubblePhysics hook scaffold (state + add/remove API)"
```

---

## Task 4: Add the rAF physics loop (wind, damping, integration, wall collision)

**Files:**
- Modify: `hooks/useBubblePhysics.ts`

- [ ] **Step 1: Import helpers and add the loop**

Add to the top of `hooks/useBubblePhysics.ts`:

```typescript
import { BubbleState, PHYSICS, clampSpeed, resolveWallCollision, resolveBubbleCollision } from '../lib/bubblePhysics';
```

Inside the `useBubblePhysics` hook, before the return statement, add:

```typescript
  // Physics loop
  useEffect(() => {
    let rafId: number;
    const reducedMotion = typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const tick = () => {
      const container = containerRef.current;
      if (!container) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      const w = container.clientWidth;
      const h = container.clientHeight;

      const live = bubblesRef.current.filter((b) => b.lifecycle === 'live');

      // Per-bubble update (skip motion entirely if reduced motion)
      for (const b of live) {
        if (!reducedMotion) {
          // Wind drift
          b.vx += (Math.random() * 2 - 1) * PHYSICS.WIND_FORCE;
          b.vy += (Math.random() * 2 - 1) * PHYSICS.WIND_FORCE;
          // Damping
          b.vx *= PHYSICS.DAMPING;
          b.vy *= PHYSICS.DAMPING;
          // Speed clamp
          const c = clampSpeed(b.vx, b.vy);
          b.vx = c.vx; b.vy = c.vy;
          // Integrate
          b.x += b.vx;
          b.y += b.vy;
        }
        // Wall collision (always run, in case of resize)
        const wc = resolveWallCollision(b.x, b.y, b.vx, b.vy, b.radius, w, h);
        b.x = wc.x; b.y = wc.y; b.vx = wc.vx; b.vy = wc.vy;
      }

      // Apply positions to DOM (bypass React)
      for (const b of live) {
        const el = elementsRef.current.get(b.id);
        if (el) {
          el.style.transform = `translate3d(${b.x - b.radius}px, ${b.y - b.radius}px, 0)`;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/useBubblePhysics.ts
git commit -m "feat(wall): add rAF physics loop with wind drift and wall collision"
```

---

## Task 5: Add bubble-bubble collision to the loop

**Files:**
- Modify: `hooks/useBubblePhysics.ts`

- [ ] **Step 1: Add the pairwise collision pass**

In the `tick` function inside `useBubblePhysics`, right **after** the per-bubble update loop and **before** the DOM apply loop, add:

```typescript
      // Pairwise bubble-bubble collision (only between live bubbles)
      if (!reducedMotion) {
        for (let i = 0; i < live.length; i++) {
          for (let j = i + 1; j < live.length; j++) {
            resolveBubbleCollision(live[i], live[j]);
          }
        }
      }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/useBubblePhysics.ts
git commit -m "feat(wall): add bubble-bubble collision resolution"
```

---

## Task 6: Window resize handling (clamp positions back into bounds)

**Files:**
- Modify: `hooks/useBubblePhysics.ts`

- [ ] **Step 1: Add the resize effect**

In `useBubblePhysics`, after the physics-loop `useEffect`, add:

```typescript
  // Window resize: clamp bubbles back into new bounds
  useEffect(() => {
    const onResize = () => {
      const container = containerRef.current;
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      for (const b of bubblesRef.current) {
        if (b.lifecycle !== 'live') continue;
        const wc = resolveWallCollision(b.x, b.y, b.vx, b.vy, b.radius, w, h);
        b.x = wc.x; b.y = wc.y; b.vx = wc.vx; b.vy = wc.vy;
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/useBubblePhysics.ts
git commit -m "feat(wall): clamp bubble positions on window resize"
```

---

## Task 7: Rewrite `DisplayView` — replace marquee with bubble wall (basic, no spotlight handoff yet)

This task replaces the body of `DisplayView.tsx`. We keep the websocket subscriptions, QR code, logo, and spotlight scaffolding, but swap the polaroid marquee for the bubble wall driven by `useBubblePhysics`. Spotlight handoff is wired in the next task; for now spotlight stays as the existing polaroid behavior so the page works at every step.

**Files:**
- Modify: `components/DisplayView.tsx`

- [ ] **Step 1: Replace the marquee section and background**

Replace the entire contents of `components/DisplayView.tsx` with:

```typescript
import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getPhotos, subscribeToUpdates, subscribeToDelete } from '../services/storageService';
import { PhotoEntry } from '../types';
import { Bubble } from './Bubble';
import { useBubblePhysics } from '../hooks/useBubblePhysics';
import { PHYSICS, computeSpawnRadius, randomInRange } from '../lib/bubblePhysics';

type SpotlightState = 'idle' | 'entering' | 'visible' | 'exiting';

const DisplayView: React.FC = () => {
  const physics = useBubblePhysics();
  const [photoMap, setPhotoMap] = useState<Map<string, PhotoEntry>>(new Map());
  const [queue, setQueue] = useState<PhotoEntry[]>([]);
  const [uploadUrl, setUploadUrl] = useState<string>('');

  // Spotlight state (used in next task)
  const [spotlightPhoto, setSpotlightPhoto] = useState<PhotoEntry | null>(null);
  const [spotlightState, setSpotlightState] = useState<SpotlightState>('idle');
  const spotlightPhotoRef = useRef<PhotoEntry | null>(null);
  useEffect(() => { spotlightPhotoRef.current = spotlightPhoto; }, [spotlightPhoto]);

  // Upload URL
  useEffect(() => {
    const explicit = import.meta.env.VITE_UPLOAD_URL as string | undefined;
    if (explicit) setUploadUrl(explicit);
    else if (typeof window !== 'undefined') setUploadUrl(window.location.origin);
  }, []);

  // Spawn an initial bubble for a photo at a random non-overlapping-ish position.
  // (We accept some overlap on initial load; physics resolves it within a second.)
  const spawnInitial = (photo: PhotoEntry, container: HTMLDivElement) => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const radius = computeSpawnRadius(w, h);
    const x = randomInRange(radius, w - radius);
    const y = randomInRange(radius, h - radius);
    const vx = randomInRange(-0.2, 0.2);
    const vy = randomInRange(-0.2, 0.2);
    physics.spawn({ photoId: photo.id, x, y, radius, vx, vy });
  };

  // Initial load
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const loaded = await getPhotos();
      if (cancelled) return;
      const map = new Map<string, PhotoEntry>();
      loaded.forEach((p) => map.set(p.id, p));
      setPhotoMap(map);

      // "isNew within 15s" check: if the most recent photo was uploaded in the
      // last 15s, route it through the spotlight instead of spawning directly.
      // This preserves the UX where a user uploads and immediately opens /wall.
      const latest = loaded[0];
      const isNew = latest && (Date.now() - latest.timestamp < 15000);
      const toSpawn = isNew ? loaded.slice(1, PHYSICS.MAX_BUBBLES + 1) : loaded.slice(0, PHYSICS.MAX_BUBBLES);

      requestAnimationFrame(() => {
        const container = physics.containerRef.current;
        if (!container) return;
        for (const p of toSpawn) spawnInitial(p, container);
      });

      if (isNew) {
        // Queue the latest so the existing queue processor picks it up
        setQueue((prev) => [...prev, latest]);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Websocket subscriptions
  useEffect(() => {
    const unsub = subscribeToUpdates((newPhoto) => {
      setPhotoMap((m) => {
        const next = new Map(m);
        next.set(newPhoto.id, newPhoto);
        return next;
      });
      setQueue((prev) => [...prev, newPhoto]);
    });
    const unsubDel = subscribeToDelete((deletedId) => {
      setPhotoMap((m) => {
        const next = new Map(m);
        next.delete(deletedId);
        return next;
      });
      setQueue((prev) => prev.filter((p) => p.id !== deletedId));
      // Remove any bubble with this photoId
      const target = physics.bubbles.find((b) => b.photoId === deletedId);
      if (target) physics.markExiting(target.id);
      if (spotlightPhotoRef.current?.id === deletedId) {
        setSpotlightState('exiting');
      }
    });
    return () => { unsub(); unsubDel(); };
  }, [physics]);

  return (
    <div
      className="h-screen w-screen overflow-hidden relative text-white"
      style={{
        backgroundImage: "url('/bubblesBG.jpeg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Bubble wall container */}
      <div
        ref={physics.containerRef}
        className="absolute inset-0"
      >
        {physics.bubbles.map((b) => {
          const photo = photoMap.get(b.photoId) ?? null;
          return (
            <div
              key={b.id}
              ref={(el) => physics.registerBubbleEl(b.id, el)}
              className="absolute top-0 left-0 will-change-transform"
              style={{
                transform: `translate3d(${b.x - b.radius}px, ${b.y - b.radius}px, 0)`,
                transition: b.lifecycle === 'exiting'
                  ? 'transform 600ms ease-in, opacity 600ms ease-in, scale 600ms ease-in'
                  : undefined,
                opacity: b.lifecycle === 'exiting' ? 0 : 1,
                scale: b.lifecycle === 'exiting' ? '0' : '1',
              }}
            >
              <Bubble photo={photo} diameter={b.radius * 2} />
            </div>
          );
        })}
      </div>

      {/* QR + Logo (bottom-right, unchanged) */}
      <div className="absolute bottom-12 right-8 z-30 flex flex-col items-center gap-4">
        {uploadUrl && (
          <div className="bg-black/90 p-3 rounded-xl shadow-2xl border border-white/30">
            <div className="bg-white p-2 rounded-md">
              <QRCodeSVG value={uploadUrl} size={100} level="H" bgColor="#ffffff" fgColor="#000000" />
            </div>
            <p className="text-center text-xs font-semibold mt-2 text-white">Scan to Upload</p>
          </div>
        )}
        <img
          src="/logo masthead 2.png"
          alt="Holiday Tours"
          className="w-32 h-auto drop-shadow-lg opacity-90"
        />
      </div>
    </div>
  );
};

export default DisplayView;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification — basic wall**

Run: `npm run dev`

Open `http://localhost:5173/#/wall` in a browser.

Confirm:
- Background is the `bubblesBG.jpeg` starry blue image.
- If there are existing photos in the system, up to 8 bubbles appear drifting around.
- Bubbles never leave the screen — they softly bounce off edges.
- When two bubbles meet, they push apart instead of overlapping.
- QR code + logo are in the bottom-right.
- No console errors.

If no photos exist, the screen is empty (instructional bubble comes in Task 9). Use the upload page (`http://localhost:5173/`) to add a few photos for testing.

- [ ] **Step 4: Commit**

```bash
git add components/DisplayView.tsx
git commit -m "feat(wall): replace polaroid marquee with bubble wall"
```

---

## Task 8: Implement spotlight — same Bubble rising from bottom, 5s hold

The spotlight is the same `Bubble` component rendered larger over a blurred background. It enters by translating up from below the viewport. Handoff to the wall (the shrink-and-fly animation) comes in Task 9.

**Files:**
- Modify: `components/DisplayView.tsx`

- [ ] **Step 1: Add spotlight rendering and state machine**

In `components/DisplayView.tsx`, add the following inside the `DisplayView` component, **after** the websocket-subscriptions `useEffect`:

```typescript
  // Queue processor: pull next photo into spotlight when idle
  useEffect(() => {
    if (queue.length > 0 && spotlightState === 'idle') {
      setSpotlightPhoto(queue[0]);
      setQueue((prev) => prev.slice(1));
      setSpotlightState('entering');
    }
  }, [queue, spotlightState]);

  // Spotlight timing
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (spotlightState === 'entering') {
      t = setTimeout(() => setSpotlightState('visible'), 1500);
    } else if (spotlightState === 'visible') {
      t = setTimeout(() => setSpotlightState('exiting'), 5000);
    } else if (spotlightState === 'exiting') {
      // Handoff happens in Task 9. For now: just clear after exit anim.
      t = setTimeout(() => {
        setSpotlightPhoto(null);
        setSpotlightState('idle');
      }, 800);
    }
    return () => clearTimeout(t);
  }, [spotlightState]);

  const isSpotlightActive = spotlightState !== 'idle';

  // Spotlight diameter: ~40% of the shorter viewport dimension
  const spotlightDiameter = typeof window !== 'undefined'
    ? Math.min(window.innerWidth, window.innerHeight) * 0.4
    : 400;
```

Then update the **JSX return** to:
1. Apply a blur class to the bubble wall when spotlight is active.
2. Render the spotlight overlay.

Replace the existing `return (...)` JSX with:

```typescript
  return (
    <div
      className="h-screen w-screen overflow-hidden relative text-white"
      style={{
        backgroundImage: "url('/bubblesBG.jpeg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Bubble wall container (blurs when spotlight active) */}
      <div
        ref={physics.containerRef}
        className={`absolute inset-0 transition-all duration-1000 ease-in-out ${
          isSpotlightActive ? 'blur-md brightness-50 scale-[0.98]' : ''
        }`}
      >
        {physics.bubbles.map((b) => {
          const photo = photoMap.get(b.photoId) ?? null;
          return (
            <div
              key={b.id}
              ref={(el) => physics.registerBubbleEl(b.id, el)}
              className="absolute top-0 left-0 will-change-transform"
              style={{
                transform: `translate3d(${b.x - b.radius}px, ${b.y - b.radius}px, 0)`,
                transition: b.lifecycle === 'exiting'
                  ? 'transform 600ms ease-in, opacity 600ms ease-in, scale 600ms ease-in'
                  : undefined,
                opacity: b.lifecycle === 'exiting' ? 0 : 1,
                scale: b.lifecycle === 'exiting' ? '0' : '1',
              }}
            >
              <Bubble photo={photo} diameter={b.radius * 2} />
            </div>
          );
        })}
      </div>

      {/* QR + Logo */}
      <div className="absolute bottom-12 right-8 z-30 flex flex-col items-center gap-4">
        {uploadUrl && (
          <div className="bg-black/90 p-3 rounded-xl shadow-2xl border border-white/30">
            <div className="bg-white p-2 rounded-md">
              <QRCodeSVG value={uploadUrl} size={100} level="H" bgColor="#ffffff" fgColor="#000000" />
            </div>
            <p className="text-center text-xs font-semibold mt-2 text-white">Scan to Upload</p>
          </div>
        )}
        <img
          src="/logo masthead 2.png"
          alt="Holiday Tours"
          className="w-32 h-auto drop-shadow-lg opacity-90"
        />
      </div>

      {/* Spotlight overlay */}
      {spotlightPhoto && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none"
        >
          <div
            className="transition-all ease-out"
            style={{
              transitionDuration: spotlightState === 'entering' ? '1500ms' : '800ms',
              transform:
                spotlightState === 'entering'
                  ? `translateY(${window.innerHeight}px) scale(1)`
                  : spotlightState === 'visible'
                  ? 'translateY(0px) scale(1)'
                  : 'translateY(0px) scale(0)',
              opacity: spotlightState === 'exiting' ? 0 : 1,
            }}
          >
            <Bubble photo={spotlightPhoto} diameter={spotlightDiameter} />
          </div>
        </div>
      )}
    </div>
  );
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification — spotlight**

Run `npm run dev`, open `/#/wall`, then on a separate device or tab open `/` and upload a photo.

Confirm:
- The wall background blurs.
- A large bubble (same Bubble visual, ~40% of screen) floats up from below the screen.
- It holds in the center for ~5 seconds.
- After hold, it disappears (handoff to wall comes in Task 9).
- The wall un-blurs after the spotlight clears.

- [ ] **Step 4: Commit**

```bash
git add components/DisplayView.tsx
git commit -m "feat(wall): spotlight rises as giant bubble from bottom of screen"
```

---

## Task 9: Spotlight → wall handoff with FIFO eviction

When the spotlight begins exiting, the giant bubble must shrink and translate to the target wall position (the oldest bubble's slot if the wall is full, or center otherwise). If the wall is full, the oldest bubble simultaneously starts its pop animation.

**Files:**
- Modify: `components/DisplayView.tsx`

- [ ] **Step 1: Compute handoff target on `entering → visible` transition**

We need to know the target position *before* the exit animation, so we can compute the spotlight's exit transform. Track it in a ref.

Add this ref near the spotlight refs in `DisplayView`:

```typescript
  const handoffRef = useRef<{ x: number; y: number; radius: number } | null>(null);
```

- [ ] **Step 2: Update the spotlight timing effect to plan the handoff**

Replace the spotlight timing `useEffect` from Task 8 with:

```typescript
  // Spotlight state machine + handoff
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;

    if (spotlightState === 'entering') {
      t = setTimeout(() => setSpotlightState('visible'), 1500);
    } else if (spotlightState === 'visible') {
      t = setTimeout(() => {
        // Plan the handoff before transitioning to exiting:
        const container = physics.containerRef.current;
        if (container) {
          const w = container.clientWidth;
          const h = container.clientHeight;
          const radius = computeSpawnRadius(w, h);

          if (physics.bubbles.length >= PHYSICS.MAX_BUBBLES) {
            // Evict oldest: pick the bubble with smallest spawnTime
            const oldest = [...physics.bubbles].sort((a, b) => a.spawnTime - b.spawnTime)[0];
            handoffRef.current = { x: oldest.x, y: oldest.y, radius: oldest.radius };
            physics.markExiting(oldest.id);
            // Schedule physical removal after pop animation
            setTimeout(() => physics.remove(oldest.id), 600);
          } else {
            handoffRef.current = { x: w / 2, y: h / 2, radius };
          }
        }
        setSpotlightState('exiting');
      }, 5000);
    } else if (spotlightState === 'exiting') {
      // After exit animation completes, spawn the new bubble at the target slot
      t = setTimeout(() => {
        const target = handoffRef.current;
        const photo = spotlightPhotoRef.current;
        if (target && photo) {
          physics.spawn({
            photoId: photo.id,
            x: target.x,
            y: target.y,
            radius: target.radius,
            vx: (Math.random() * 2 - 1) * 0.3,
            vy: (Math.random() * 2 - 1) * 0.3,
          });
        }
        handoffRef.current = null;
        setSpotlightPhoto(null);
        setSpotlightState('idle');
      }, 800);
    }
    return () => clearTimeout(t);
  }, [spotlightState, physics]);
```

- [ ] **Step 3: Update spotlight overlay to animate toward the handoff target on exit**

The exit transform needs to translate the spotlight from screen center to the target wall position, and shrink from `spotlightDiameter` down to the target diameter.

Compute the exit transform inline. Replace the spotlight overlay JSX with:

```typescript
      {/* Spotlight overlay */}
      {spotlightPhoto && (() => {
        const container = physics.containerRef.current;
        const containerRect = container?.getBoundingClientRect();
        const target = handoffRef.current;
        // Compute exit translate (from screen center to target wall position)
        let exitTransform = 'translate(0px, 0px) scale(0)';
        if (target && containerRect) {
          const dx = (containerRect.left + target.x) - window.innerWidth / 2;
          const dy = (containerRect.top + target.y) - window.innerHeight / 2;
          const shrinkScale = (target.radius * 2) / spotlightDiameter;
          exitTransform = `translate(${dx}px, ${dy}px) scale(${shrinkScale})`;
        }

        const transform =
          spotlightState === 'entering'
            ? `translateY(${window.innerHeight}px) scale(1)`
            : spotlightState === 'visible'
            ? 'translateY(0px) scale(1)'
            : exitTransform;

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
            <div
              className="transition-all ease-out"
              style={{
                transitionDuration: spotlightState === 'entering' ? '1500ms' : '800ms',
                transform,
                opacity: spotlightState === 'exiting' ? 1 : 1, // keep visible during shrink
              }}
            >
              <Bubble photo={spotlightPhoto} diameter={spotlightDiameter} />
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification — handoff**

Run `npm run dev`. Open `/#/wall` and the upload page.

**With <8 bubbles already on the wall:**
- Upload a new photo.
- Spotlight rises, holds, then shrinks toward the center of the wall.
- A new bubble appears at the center after the handoff, drifts away with physics.

**With 8 bubbles already on the wall:**
- Upload a 9th photo.
- Spotlight rises, holds.
- During exit: the oldest bubble pops (scale-down + fade) while the spotlight shrinks to that exact slot.
- The new bubble takes over the slot smoothly.

Confirm wall always has ≤ 8 bubbles after handoff.

- [ ] **Step 6: Commit**

```bash
git add components/DisplayView.tsx
git commit -m "feat(wall): spotlight handoff with FIFO eviction at 8 bubbles"
```

---

## Task 10: Empty-state instructional bubble

When the wall has zero bubbles and no spotlight is active, render a single static instructional bubble in the center.

**Files:**
- Modify: `components/DisplayView.tsx`

- [ ] **Step 1: Add empty-state rendering**

In the JSX of `DisplayView`, inside the bubble-wall container `<div>` (the one with `ref={physics.containerRef}`), **after** the `{physics.bubbles.map(...)}` block, add:

```typescript
          {physics.bubbles.length === 0 && !isSpotlightActive && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Bubble
                photo={null}
                diameter={Math.min(window.innerWidth, window.innerHeight) * 0.3}
                placeholderText="Scan the QR to add a photo"
              />
            </div>
          )}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification — empty state**

Delete all photos via admin (`/#/admin`) and view `/#/wall`.

Confirm:
- A single bubble appears centered with the text "Scan the QR to add a photo".
- The bubble disappears the moment a new photo is uploaded (during spotlight handoff).
- The bubble does not animate (it's a static visual cue).

- [ ] **Step 4: Commit**

```bash
git add components/DisplayView.tsx
git commit -m "feat(wall): add empty-state instructional bubble"
```

---

## Task 11: End-to-end manual verification

This task has no code. It exercises the full feature against the spec.

- [ ] **Step 1: Start the app**

Run: `npm run dev`

Open `/#/wall` on a large screen or browser window (1280×720+).

- [ ] **Step 2: Initial-load check**

If you have ≥ 8 photos in storage, confirm exactly 8 bubbles appear, drifting around the wall, never escaping. Older photos beyond 8 are not shown.

If you have < 8 photos, confirm that many bubbles appear.

If you have 0 photos, confirm the instructional bubble appears.

- [ ] **Step 3: Upload flow**

From a phone, scan the QR and upload a photo with a signature.

Confirm in order:
- Wall blurs.
- A large bubble floats up from below the screen with the new photo and signature visible inside.
- It holds in center for ~5 seconds.
- It shrinks and translates to either the center (if wall has room) or to the slot of the oldest bubble.
- If evicting: oldest bubble pops with a fade as the spotlight shrinks into its slot.
- New bubble is now drifting on the wall.
- Wall is back at ≤ 8 bubbles.

- [ ] **Step 4: Rapid-upload flow**

Upload 3 photos in quick succession.

Confirm:
- Each photo gets its own spotlight, one at a time.
- Queue processes correctly with no overlap or skipped photos.

- [ ] **Step 5: Delete flow**

From `/#/admin`, delete a photo currently on the wall.

Confirm:
- That bubble pops out with the same fade animation.
- Wall count drops by 1.

Delete the photo currently in the spotlight.

Confirm:
- Spotlight exits early (no full 5s hold).
- No bubble is spawned on the wall for that photo.

- [ ] **Step 6: Resize flow**

While bubbles are on the wall, resize the browser window (drag corner, smaller and larger).

Confirm:
- Bubbles stay inside the visible area at all sizes.
- No bubbles get stuck off-screen.
- Physics keeps running smoothly.

- [ ] **Step 7: Reduced-motion flow**

In OS settings, enable "Reduce motion" (Windows: Settings → Accessibility → Visual effects → Animation effects OFF; macOS: System Settings → Accessibility → Display → Reduce motion).

Reload `/#/wall`.

Confirm:
- Bubbles spawn but do not drift.
- Wall collisions don't happen because bubbles don't move.
- Spotlight entrance/exit still play (those are meaningful state transitions).

Disable reduced motion when done.

- [ ] **Step 8: Performance check**

Open DevTools → Performance, record ~5 seconds with 8 bubbles drifting.

Confirm:
- Frame rate stays ≥ 55 fps on a typical laptop.
- No long tasks > 50ms.

- [ ] **Step 9: Console check**

Confirm browser console is free of errors and warnings during normal operation, uploads, deletes, and resizes.

- [ ] **Step 10: Final commit (only if any tweaks were made during verification)**

```bash
git status
# If any fixes were made during verification, stage and commit them:
# git add <files>
# git commit -m "fix(wall): <description>"
```

---

## Out of Scope (for this plan)

These are spec items intentionally deferred:
- Upload page redesign (will be its own plan)
- Spotlight loading-pulse ring (nice-to-have polish; the photo URL is typically already cached from upload, so flicker is rare)
- Unit tests for `lib/bubblePhysics.ts` (no test framework in repo; deferring until one exists)
