# Slingshot → Bounce → Sparkle → Wall Design

**Goal:** Emphasize the "bounce" concept in the two-device capture flow. After a guest signs a photo on the iPad, they **slingshot** the bubble by pulling it down and releasing; it flicks up and off the iPad. On the wall, the bubble **rises from the bottom**, settles into the spotlight with a **subtle bounce**, **bursts into a radial sparkle**, holds briefly, then joins the floating wall of bubbles.

**Nature of the feature:** This is a **presentation layer** on top of the existing, already-verified two-device pipeline (pending queue → commit → `new_photo` socket → wall spotlight → physics wall). It changes how things *look and feel*; it does not change the data flow, the server, or the queue semantics.

**Branch:** `claude/two-device-capture-sign-d56f0f` (bubble variant).

---

## The core architectural truth

The iPad (`/sign`) and the wall (`/wall`) are **two separate devices/screens**. A single bubble cannot physically travel between them. This feature is therefore **two coordinated animations that together tell one story**:

1. **iPad flourish** — the slingshot pull + upward flick. Triggers the existing `commitPending`. When it fires, the bubble leaves the top of the iPad screen.
2. **Wall reaction** — driven independently by the existing `new_photo` Socket.IO event. The wall plays the bounce-in + sparkle for the newly committed photo.

Physical continuity is created by direction, not by shared state: the iPad sits **physically below the TV**, so flicking the bubble **up** off the iPad and having it **rise from the bottom** of the wall reads as one continuous motion.

There is no new cross-device messaging, no new server state, and no coordination or timing dependency between the two screens beyond what `new_photo` already provides.

---

## What stays exactly as-is (out of scope)

- The Express server, the pending queue, and all five pending routes.
- `commitPending` / `discardPending` / `skipPending` / `savePending` and their socket events.
- The wall's `useBubblePhysics` engine and the floating-wall behavior.
- The spotlight **exit → handoff → physics spawn** sequence (a committed photo still shrinks into a wall slot and becomes a real physics bubble).
- The **serial queue**: one featured bubble at a time; simultaneous uploads wait their turn (`DisplayView`'s existing `queue` + `spotlightState` machine).
- `Bubble` / `BubbleFrame` signature-on-top layering (already fixed on this branch).

---

## Unit 1 — iPad slingshot (`components/SignView.tsx` + `hooks/useSlingshot.ts`)

### Behavior
After signing, the featured bubble becomes draggable:

1. **Press** on the bubble's **photo area** (above the signature band) and **drag down**. The bubble follows the finger downward with **rubber-band resistance** (it moves a fraction of the raw pull, so it feels elastic, not 1:1). A **slingshot tether** is drawn from two anchor points above the bubble down to the bubble, stretching as it is pulled.
2. **Release past the launch threshold** → **launch**: the bubble **flicks up and off the top of the screen** (fast ease-out upward translate + fade), and `commitPending(currentId, signature)` fires.
3. **Release short of the threshold** → **snap back**: the bubble springs to rest; nothing is committed.

### The signing-vs-slinging conflict (important)
`SignableBubble` renders a signature `<canvas>` pinned to the **lower band** of the photo circle (`signatureBandBox`), which captures pointer events for drawing. The slingshot must not hijack drawing strokes, and drawing must not trigger a launch.

**Resolution:** the sling gesture only begins when the initial `pointerdown` is **outside the signature band** (i.e. on the photo area in the upper portion of the bubble). A `pointerdown` inside the band is a drawing stroke and is ignored by the sling hook. Concretely: the sling hook checks the pointer's position against the band rectangle (or the event target), and bails if the press started on the canvas. This gives a clean mental model — **sign in the band, grab the photo above it and pull down to launch.**

### Launch → commit wiring
Launch reuses the **existing** commit path (today's `handleUpload`), unchanged except for its trigger and the added flick animation:

- On launch: set `busy`, start the flick animation, call `commitPending(current.id, signature)` concurrently.
- **Success:** existing behavior — `removeFromQueue(current.id)` and a success toast; the next pending photo (or the "All caught up" empty state) appears at rest.
- **Failure (network):** the bubble **springs back** into view and the existing error toast shows. Nothing is lost.
- **404 `gone`:** existing `handleGone` behavior — advance past the photo with the informational toast.

### Controls
- **Clear / Skip / Discard** remain as buttons (unchanged handlers).
- The **"Upload to Wall" button is removed**, replaced by the gesture.
- A **discoverability hint** — a gently bobbing "pull down to send ✨" affordance near/under the bubble — is shown while a photo is ready to launch (gesture-only launch was the explicit choice; the hint compensates for discoverability). The hint fades out once a drag begins.

### `useSlingshot` hook (new, `hooks/useSlingshot.ts`)
Encapsulates the pointer logic so `SignView` stays readable and the gesture is testable/observable in isolation.

- **Input:** a ref to the draggable element, the signature-band rectangle (to reject presses that start on the canvas), a launch threshold, and callbacks `onLaunch()` / `onCancel()`.
- **Output:** current drag offset (for the wrapper transform + tether), an `isDragging` flag, and the pointer event handlers to spread onto the wrapper.
- **Owns:** pointer capture, rubber-band mapping of raw pull → visual offset, threshold test on release, and the launch/cancel decision. It does **not** know about photos, commits, or signatures — `SignView` wires those.

### Tunable constants (with sensible defaults; exact values finalized during build)
- **Launch threshold:** ~22% of the bubble diameter (≈ a firm, deliberate pull).
- **Rubber-band factor:** raw pull scaled by ~0.6–0.7 for elastic feel.
- **Flick-away:** upward translate off-screen + fade, ~450 ms, ease-out.
- **Snap-back:** spring to rest, ~300 ms.
- **Drag axis:** vertical only (down to arm, up-flick on release); horizontal movement is ignored for the launch decision.

---

## Unit 2 — Wall bounce-in (`components/DisplayView.tsx`)

The wall's spotlight is a CSS-transition-driven `<Bubble>` overlay with an existing state machine: `idle → entering → visible → exiting → idle`. Today `entering` slides the bubble from `translateY(window.innerHeight)` (below the screen) to `translateY(0)` (center) over 1500 ms with `ease-out`. **This is already a bottom entry** — we keep the direction and change the *feel*.

### Changes
- **Bounce easing:** replace the `entering` transition's `ease-out` with a **gentle overshoot curve** (a "back-out" cubic-bézier) so the bubble rises, overshoots the center by a small amount (subtle — a single, modest overshoot of roughly 8–12%), and settles. The bubble is **rigid**: only its position is animated, never its scale/shape, so the faces inside never distort. Duration ~1200–1400 ms.
- **Featured hold:** shorten the `visible` dwell from **5000 ms → ~3000 ms** (the chosen "medium" hold).
- **Sparkle trigger:** when `entering → visible` fires (the settle moment), mount the sparkle burst (Unit 3) at spotlight center.
- **Everything else in the machine is unchanged:** `exiting` still shrinks + translates the bubble into its wall slot over 800 ms, then a real physics bubble is spawned there (the existing handoff), and the serial queue still feeds one photo at a time.

### Tunable constants
- **Overshoot curve** and **entering duration** live as named constants near the spotlight logic so the bounce can be retuned (e.g. toward "playful") without hunting through JSX.
- **Hold duration** (~3000 ms) as a named constant.

### Reduced motion
When `prefers-reduced-motion: reduce` is set, the `entering` transition uses a **plain non-overshoot ease** (no bounce). The rest of the timing is preserved.

---

## Unit 3 — Sparkle burst (`components/SparkleBurst.tsx`, new)

A self-contained, presentational canvas component. One responsibility: play a radial sparkle burst once and clean up.

### Behavior (matches the approved prototype)
- A `<canvas>` overlay sized to the spotlight area.
- On mount, emit a **main ring** of particles at evenly-spaced angles around a full circle, launched **outward from the bubble's rim** (start position ≈ 0.85× radius along each angle), flying radially outward. ~130 ms later, emit a smaller, slower **echo ring** for depth.
- Particles have **no gravity and no directional drift** — symmetric drag only, so the ring expands and fades in place. Each particle has a slow life decay (lingering), a size that shrinks with life, and a subtle **twinkle** (sinusoidal alpha).
- Colors: ~50/50 mix of **soft blue** (`rgba(180,205,255,1)`) and **warm gold** (`rgba(255,225,150,1)`), drawn with additive blending (`globalCompositeOperation = 'lighter'`).
- Total lifetime ~1.5–2 s; the component calls `onDone()` and removes itself when the last particle dies.

### Props / interface
- `size` (px) — the spotlight diameter, to scale particle speed and canvas.
- `onDone()` — called when the burst finishes so `DisplayView` can unmount it.
- Internally keyed by the featured photo's id in `DisplayView` so it re-mounts (replays) for each new photo.

### Reduced motion
When `prefers-reduced-motion: reduce`, render nothing (no particles). The bounce-less entrance + hold already communicates arrival.

---

## Data / control flow (end to end)

```
iPad (/sign)                         Server            Wall (/wall)
------------                         ------            ------------
sign in band
grab photo, pull down (rubber-band)
release past threshold
  ├─ flick bubble up & off screen
  └─ commitPending(id, signature) ──► POST commit ──► io.emit('new_photo') ──► subscribeToUpdates
       success → removeFromQueue                          └─ enqueue → spotlight:
       fail    → spring back + toast                          entering (rise from bottom,
                                                                 subtle overshoot settle)
                                                              → at settle: SparkleBurst ✨
                                                              → visible (~3s hold)
                                                              → exiting (shrink into wall slot)
                                                              → physics bubble spawns (joins wall)
```

---

## Files

| File | Change | Responsibility |
|------|--------|----------------|
| `hooks/useSlingshot.ts` | **Create** | Pointer/drag/threshold logic for the slingshot; returns offset, isDragging, handlers; calls `onLaunch`/`onCancel`. No knowledge of photos or commits. |
| `components/SignView.tsx` | **Modify** | Wrap the `SignableBubble` in a sling-draggable container; render the tether + "pull down to send" hint; remove the Upload button; wire `onLaunch` → existing commit path + flick animation. Keep Clear/Skip/Discard. |
| `components/DisplayView.tsx` | **Modify** | Swap `entering` easing to the overshoot curve; shorten `visible` hold to ~3s; mount `SparkleBurst` at the settle moment; reduced-motion easing fallback. |
| `components/SparkleBurst.tsx` | **Create** | Self-contained canvas radial sparkle burst; `onDone` cleanup; reduced-motion no-op. |
| `components/SignableBubble.tsx` | **Modify (minimal, if needed)** | Only if the sling needs the band rectangle exposed or the grab region clarified. Prefer computing the band rect in `SignView` from existing `bubbleGeometry` helpers to avoid touching this reviewed component. |

No new dependencies. No server changes. No `types.ts` / `storageService.ts` changes.

---

## Edge cases & resilience

- **Tiny/accidental pull:** below threshold → snap back, no commit. Prevents accidental launches from stray taps.
- **Drawing vs slinging:** a press that starts on the signature band draws; a press on the photo area slings. They never conflict.
- **Commit failure after flick:** the bubble springs back into view and shows the existing error toast; the photo remains in the queue for retry.
- **Rapid double-launch:** the existing `busy` guard prevents a second launch while one is in flight.
- **Reduced motion:** no flick, no bounce overshoot, no sparkle — the photo simply appears and holds. Honored on both screens (the physics engine already checks this).
- **Empty queue on the iPad:** no bubble, no sling target — the existing "All caught up" state shows.
- **Resize / rotation mid-interaction:** the diameter recompute and the signature-clear guard (already on this branch) continue to apply; the sling offset resets on release.

---

## Verification

No client test framework exists (server-only unit tests), so this is verified by driving the real flow, consistent with how the two-device feature was verified:

1. **iPad:** sign a photo, pull the bubble down and release past the threshold → it flicks up and off; confirm the photo reaches the wall. Confirm a short pull snaps back with no commit. Confirm drawing in the band still works and does not launch.
2. **Wall:** confirm the bubble rises from the bottom, settles with a single subtle overshoot (no shape distortion), the radial sparkle fires at the settle, it holds ~3s, then shrinks into a wall slot and becomes a floating bubble.
3. **Queue:** send several photos; confirm they feature one at a time in order, each with its own bounce + sparkle.
4. **Reduced motion:** with `prefers-reduced-motion` set, confirm the flick/bounce/sparkle are skipped and the photo still lands on the wall.
5. **Failure path:** simulate a failed commit; confirm the iPad bubble springs back with the error toast.

---

## Deliberately out of scope

- No cross-device "in-flight" synchronization (no shared animation state between iPad and wall).
- No per-pull strength affecting the wall animation (the wall reaction is identical regardless of how hard the iPad pull was; pull strength only affects the iPad-side flick feel).
- No changes to the queue model (still one featured bubble at a time).
- No new persistence, no new server endpoints.
