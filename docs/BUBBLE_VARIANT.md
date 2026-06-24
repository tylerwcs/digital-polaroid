# Bubble Theme Variant

This branch is a **design variant** of the SnapWall app. The `main` branch keeps the
original **polaroid** design; this branch reskins the experience into a **floating-bubble**
theme. The two are intended to stay separate — do **not** merge bubble work into `main`.

- **Branch:** `claude/admiring-swirles-1b8625`
- **Scope so far:** the `/wall` display page only. The upload, admin, and `/wall-6`
  pages are unchanged from the polaroid design and are slated for a later round.

## What changed vs. the polaroid design

The `/wall` page (`components/DisplayView.tsx`) was rewritten from a scrolling polaroid
marquee into a physics-driven bubble wall:

- Up to 8 photos float inside translucent bubbles (`bubble.png` overlay), with the
  signature overlaid on the lower portion. No captions.
- Gentle, jitter-free motion via a "wander" model (each bubble eases toward a slowly
  re-randomized target velocity), soft bubble-to-bubble and wall collisions, and bubbles
  never leave the screen.
- New uploads rise from the bottom as a large spotlight bubble, hold ~5s over a darkened
  background, then shrink into a wall slot. When the wall is full, the oldest bubble pops
  (FIFO eviction) and the newcomer takes its position.
- Background is a seamless looping video (`public/bubbleBG.mp4`) via a crossfading
  dual-`<video>` setup in their own isolated stacking context (so the loop seam never
  shows and the videos never block the bubbles).
- QR code is a white card (black QR) in the bottom-right; the polaroid-era logo was removed.

## Key files

| File | Responsibility |
|------|----------------|
| `lib/bubblePhysics.ts` | Physics constants (`PHYSICS`), `BubbleState`, pure helpers (wander, collisions, clamps). `PHYSICS` is intentionally **mutable** so the DebugPanel can tune values live. |
| `hooks/useBubblePhysics.ts` | Owns bubble state + the `requestAnimationFrame` loop; writes positions straight to the DOM via `transform` (bypasses React for 60fps motion). |
| `components/Bubble.tsx` | Renders one bubble: circular photo + signature + `bubble.png` rim + bright halo. |
| `components/DisplayView.tsx` | `/wall` orchestration: background video crossfade, bubble wall, spotlight state machine, FIFO handoff, websocket queue, empty state. |
| `components/DebugPanel.tsx` | **Temporary** dev tuner mounted on `/wall` (top-left). Live sliders for motion + sizing params, plus a Respawn button. Remove before any production/demo build. |

## Required assets (tracked on this branch)

- `public/bubble.png` — bubble rim/glass overlay (used by `Bubble.tsx`)
- `public/bubbleBG.mp4` — looping background video (used by `DisplayView.tsx`)

`.gitignore` normally ignores `public/*.mp4`; an explicit `!public/bubbleBG.mp4` exception
keeps the theme video tracked. Unused polaroid assets (`BG.mp4`, the masthead logos) were
removed on this branch.

## Current tuned defaults (in `lib/bubblePhysics.ts`)

Wander strength 0.45 · easing 0.068 · interval 3600ms · damping 0.951 · max speed 1.0 ·
wall bounce 0.25 · collision damp 0.45 · radius ratio 0.16–0.22 · radius clamp 195–425px.
Spotlight bubble = 60% of the shorter viewport dimension.

## Design docs

- Spec: `docs/superpowers/specs/2026-05-22-bubble-wall-display-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-22-bubble-wall-display.md`

## Suggested next steps (future sessions)

- Reskin the **upload page** into the bubble theme (next planned scope).
- Remove the temporary `DebugPanel` once the look is locked.
- Decide whether `/wall-6` and admin should also adopt the theme.
