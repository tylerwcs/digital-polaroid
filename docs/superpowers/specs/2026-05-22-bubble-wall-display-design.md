# Bubble Wall Display — Design Spec

**Date:** 2026-05-22
**Scope:** Redesign the `/wall` display page from a polaroid marquee into a bubble simulation. `/wall-6`, `/` (upload), and `/admin` are out of scope for this iteration (upload page will get a bubble theme in a later round).

## Goal

Replace the scrolling polaroid grid with a floating-bubble experience inspired by the user's reference image: photos rendered inside translucent bubbles drifting gently on a starry blue background, with a signature overlaid inside each bubble. The signature spotlight remains — new bubbles float up from the bottom of the screen before joining the wall.

## Constraints

- Maximum 8 bubbles on the wall at once.
- FIFO eviction: when a 9th bubble arrives, the oldest pops out.
- Bubbles must never leave the screen bounds.
- Movement must be subtle and realistic (gentle drift + soft collisions), not arcade-physics bouncy.
- Spotlight behavior is preserved — the new bubble is shown prominently before joining the wall.
- Existing QR code + Holiday Tours logo stay in the bottom-right corner.
- Captions are dropped from the bubble view (the `caption` field stays in `PhotoEntry` for `/wall-6`).

## Assets

Already in `public/`:
- `bubble.png` — translucent spherical bubble with glassy rim and highlights, used as overlay
- `bubblesBG.jpeg` — starry blue background image (note: `.jpeg`, not `.png`)

The existing `BG.mp4` is no longer used by `/wall`. It remains in the repo for other routes.

## Architecture

### File layout

**New:**
- `components/Bubble.tsx` — renders a single bubble (photo clipped to a circle, signature overlay, `bubble.png` rim overlay)
- `hooks/useBubblePhysics.ts` — owns the physics simulation: bubble positions, velocities, the `requestAnimationFrame` loop, collision resolution

**Modified:**
- `components/DisplayView.tsx` — body replaced with the bubble wall. Spotlight state machine, websocket subscription, QR code, and logo retained.

**Untouched:**
- `components/DisplayViewGrid.tsx`, `components/Polaroid.tsx`, `components/UploadView.tsx`, `components/AdminView.tsx`

### Why this shape

The physics loop mutates positions ~60×/sec. Pushing that through React state would cause re-render storms. The `useBubblePhysics` hook holds positions/velocities in mutable refs and writes them to DOM via `element.style.transform = translate3d(...)`. React only re-renders when the *set* of bubbles changes (a spawn or eviction), never when bubbles move.

## Bubble rendering

A bubble is a positioned `<div>` of `2 * radius` square. Inside, layered back to front:

1. **Photo** — `<img>` clipped to a circle (`border-radius: 50%`) sized to ~78% of the bubble diameter, `object-fit: cover`, centered. Sits behind everything else so the glassy rim of the overlay frames it.
2. **Signature** — `<img>` (base64 from `photo.signature`) positioned absolutely over the lower ~30% of the circular photo area, centered, with a subtle drop-shadow so it reads against any photo. Only rendered if `photo.signature` is present.
3. **`bubble.png` overlay** — `<img>` at full bubble size, `pointer-events: none`, providing the spherical glass effect on top.

Bubbles are positioned via `transform: translate3d(x, y, 0)` from the physics loop (GPU-accelerated, no layout thrash). The wrapper element handles the scale animation for enter/exit.

### Enter animation (joining the wall from spotlight)

The spotlight bubble shrinks from its large center size to the wall bubble size while translating to the target spawn position over ~800ms, ease-out. Once at the wall, the physics loop takes over.

### Exit animation (FIFO eviction)

Scale `1 → 1.15 → 0` with opacity fading to 0 over ~600ms. Mimics a soap bubble popping. The DOM node is removed after the animation completes.

### Empty state

When `bubbles.length === 0` and the spotlight is idle, render a single instructional bubble centered on the screen: "Scan the QR to add a photo." It uses the same `Bubble` visual treatment (with `bubble.png` overlay and no photo/signature) but contains text in the photo area. It is removed when the first real bubble spawns.

## Physics model

### Bubble state

```
{
  id: string,
  photo: PhotoEntry,
  x: number,         // center, px from container left
  y: number,         // center, px from container top
  vx: number,        // px/frame
  vy: number,        // px/frame
  radius: number,    // px
  spawnTime: number, // for FIFO ordering
  lifecycle: 'entering' | 'live' | 'exiting'
}
```

Only bubbles with `lifecycle === 'live'` participate in physics. `entering` and `exiting` bubbles are positioned by CSS transitions, not the physics loop.

### Per-frame update (rAF, 60fps)

For each live bubble:

1. **Wind drift** — `vx += rand(-0.02, 0.02)`, `vy += rand(-0.02, 0.02)`. The constant tiny noise is what makes them look alive.
2. **Damping** — `vx *= 0.985`, `vy *= 0.985`. Prevents wind from accumulating into chaos.
3. **Speed clamp** — if `sqrt(vx² + vy²) > MAX_SPEED` (≈ 0.6 px/frame), scale velocity down to `MAX_SPEED`. Keeps motion subtle.
4. **Integrate** — `x += vx`, `y += vy`.
5. **Wall collision** — if `x - radius < 0`, set `x = radius` and `vx = -vx * 0.5`. Mirror for right, top, bottom edges. The `0.5` damping prevents hard bounces.

After all positions update, **pairwise collision pass** — for each pair (i, j):

- `dx = bj.x - bi.x`, `dy = bj.y - bi.y`, `dist = sqrt(dx² + dy²)`
- If `dist < bi.radius + bj.radius` and `dist > 0`:
  - **Positional correction:** push each bubble out along the normal by half the overlap.
  - **Velocity exchange:** decompose each bubble's velocity into normal + tangential components. Swap the normal components (equal-mass elastic collision) and damp by `0.7`. Tangential components are preserved.

With n ≤ 8, the inner pair loop is 28 iterations — negligible cost.

### Sizing

On spawn, `radius = clamp(min(viewportW, viewportH) * rand(0.09, 0.13), 90, 200)` px. Same range adapts across screen sizes; bubbles look proportionate on phones, laptops, and big displays.

### Resize handling

On `window.resize`:
- Clamp each bubble's position so it stays inside the new bounds (`radius ≤ x ≤ w - radius`, same for y).
- Don't rescale existing bubble radii — would be visually jarring. New spawns use the new viewport size.

### Reduced motion

If `window.matchMedia('(prefers-reduced-motion: reduce)').matches`, skip the wind drift and collision velocity exchange. Bubbles remain at their spawn positions. Enter/exit animations still play (they're meaningful state transitions), but are shortened.

## State & data flow

State lives in `DisplayView`:

- `bubbles: BubbleState[]` — wall contents, ordered oldest first (for FIFO eviction)
- `queue: PhotoEntry[]` — incoming photos from websocket, awaiting their turn in the spotlight
- `spotlightPhoto: PhotoEntry | null` — current spotlight
- `spotlightState: 'idle' | 'entering' | 'visible' | 'exiting'` — same machine as today

### Initial load

1. Call `getPhotos()` and take the most recent up to 8.
2. Spawn them as bubbles at random non-overlapping positions with small random velocities.
3. Keep the existing "isNew within 15s" check on the latest photo — if it qualifies, route it through the spotlight instead of spawning directly. This preserves the current UX where uploading and immediately opening `/wall` shows your spotlight.

### New photo arrives (websocket `subscribeToUpdates`)

1. Push onto `queue`.
2. Queue processor effect: if `spotlightState === 'idle'` and `queue.length > 0`, dequeue → `setSpotlightPhoto(photo)` → `setSpotlightState('entering')`.
3. Spotlight state machine (same shape as today):
   - `entering` → `visible` after entrance animation (~1500ms)
   - `visible` → `exiting` after 5000ms hold
   - `exiting` → on animation completion, hand off to the wall (see below) and `setSpotlightState('idle')`

### Spotlight → wall handoff

When the spotlight begins exiting:

1. Determine **target position**:
   - If `bubbles.length === 8`: capture the oldest bubble's `(x, y)`. That's the target.
   - If `bubbles.length < 8`: target is screen center.
2. Animate the spotlight bubble shrinking from its large size to the wall bubble size while translating to the target position (~800ms).
3. **If evicting**: simultaneously start the oldest bubble's `exiting` animation (~600ms pop). Remove it from the array when its animation completes.
4. When the spotlight's shrink-to-wall animation completes, append the new bubble to `bubbles` with `lifecycle: 'live'`, a small random outward velocity, and the inherited (or center) position. The physics loop picks it up on the next frame.

This sequencing means the new bubble visually "becomes" the wall bubble — no flash, no jump.

### Photo deleted (admin, `subscribeToDelete`)

- Remove from `queue` if present.
- If currently spotlighted: trigger spotlight `exiting` early.
- If on wall: mark that bubble's lifecycle as `exiting`, remove from array after the pop animation completes.

## Spotlight visual

The spotlight is the **same `Bubble` component** as the wall bubbles, just larger and centered.

- **Size:** ~40% of the viewport's shorter dimension (so ~2× the wall bubble size on a typical screen).
- **Entrance:** translate from `(centerX, viewportHeight + 200)` up to `(centerX, centerY)` over ~1500ms, ease-out, with a small horizontal sway (sine, ±30px) to feel like it's rising through air.
- **Hold (visible):** gently floats in place — same wind drift as wall bubbles but slightly amplified for visual interest.
- **Exit:** shrink + translate to target wall position as described above.
- **Background blur:** the wall (everything behind the spotlight) gets the existing `blur-md brightness-50 scale-[0.98]` treatment for ~1000ms transitions, preserving the current focal effect.
- **Photo loading state:** if the photo `<img>` hasn't loaded yet when the spotlight enters, show a soft pulsing ring inside the bubble until it loads.

## Background

The wall container has `bubblesBG.jpeg` as a CSS `background-image` with `background-size: cover` and `background-position: center`. The existing `<video src="/BG.mp4">` element is removed from `DisplayView`.

## Static UI

Unchanged: QR code + "Scan to Upload" caption + Holiday Tours logo stack in the bottom-right corner, same styling as today. These render above the bubble wall (`z-index` higher than bubbles) and below the spotlight (`z-index` lower than spotlight overlay).

## Testing approach

This is primarily a visual feature, so manual verification is the main path:

- **Spawning:** Upload from a phone, confirm spotlight floats up from bottom, holds, shrinks into the wall.
- **FIFO eviction:** Upload 9 photos, confirm the 9th evicts the 1st with a pop, and the new bubble appears at the popped bubble's position.
- **Physics:** Bubbles should drift slowly, never escape the screen, and gently nudge each other when they meet.
- **Resize:** Resize the window — bubbles clamp back into bounds, no jumps.
- **Deletion:** Delete a photo via admin, confirm the bubble pops out cleanly.
- **Reduced motion:** Toggle OS reduced-motion, confirm bubbles stop drifting but enter/exit still works.
- **Empty state:** Clear all photos, confirm the instructional bubble appears.

Unit tests for `useBubblePhysics` collision math are optional — the function is pure and easy to test, but the feel-it-works manual check is the load-bearing one.

## Out of scope

- Upload page redesign (deferred to a later round)
- `/wall-6` grid view changes
- Admin page changes
- Any change to the `PhotoEntry` schema or backend
- Caption display (dropped from bubble view; field stays in the type)
