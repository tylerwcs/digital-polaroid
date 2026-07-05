# Polaroid Watercolour Watermark — Design

**Date:** 2026-07-06
**Branch:** `azpoa2`
**Status:** Approved (pending spec review)

## Goal

Give each polaroid a subtle watercolour "wash" watermark so the cards feel at home
with the new `azpoa2BG.png` rainbow-watercolour puzzle-piece background. Each
polaroid is randomly assigned one of six colours drawn from that background. The
effect must be subtle — present, never competing with the photo or caption.

## Decisions (locked)

| Aspect | Choice |
| --- | --- |
| Placement | **Full-card wash** — colour bleeds across the whole card, behind photo + caption |
| Palette | Six colours from the background: purple, magenta/pink, blue, orange, green/lime, teal |
| Intensity | **~12% opacity** ("subtle") |
| Colour assignment | **Deterministic hash of `photo.id`** → palette index (no data-model change) |
| Rendering | **Shared grayscale watercolour texture PNG, tinted per-colour** in both renderers |

### Palette (hex)

```
purple   #6b3fa0
magenta  #e0246e
blue     #1f6fc4
orange   #f39019
green    #7cb342
teal     #22b0a8
```

## Why deterministic hashing (not a stored field)

A polaroid must keep the same colour across every re-render of the wall and match
the colour used in its downloadable PNG. Hashing the immutable `photo.id` to a
palette index achieves this with:

- No change to `PhotoEntry` / server photo records.
- No migration for existing photos.
- Automatic agreement between the React wall and the server canvas export — both
  hash the same `id`, so both pick the same colour with no shared state.

The hash is a small, stable string hash (e.g. a simple FNV-1a / `for`-loop hash)
that returns `hash(id) % 6`. The exact hash function must be **identical** in the
client and server so the indices always agree. It lives in one shared helper.

## Why a tinted texture (not gradients)

Polaroids render in two independent code paths that must look identical:

- `components/Polaroid.tsx` — the live wall (React/CSS).
- `server/polaroidExport.js` — the downloadable PNG (`@napi-rs/canvas`).

A single grayscale watercolour texture (alpha-based blob/wash) tinted by the
assigned colour keeps both paths pixel-consistent **and** preserves a real
watercolour edge:

- **React:** an absolutely-positioned layer behind the photo/caption using the
  texture as a `mask-image` (or `-webkit-mask-image`) with
  `background-color: <assigned colour>` and `opacity: ~0.12`.
- **Server canvas:** load the texture once, tint it by drawing the colour with
  `globalCompositeOperation = 'source-in'` onto an offscreen canvas sized to the
  card, then composite it onto the card at `globalAlpha ≈ 0.12`, clipped to the
  card's rounded rectangle so it never spills past the corners.

## Components & Changes

1. **New asset — `public/watermark-watercolour.png`**
   A grayscale (white-on-transparent, or luminance-based) soft watercolour wash
   texture with organic edges, roughly card-aspect. Generated once and committed.
   Used identically by both renderers.

2. **New shared helper — colour selection**
   A tiny module exporting `WATERMARK_COLORS` (the six hex values) and
   `pickWatermarkColor(id): string` (stable hash → colour). Imported by both the
   React component and the server exporter so the logic cannot drift. If a single
   module cannot be cleanly shared across the client/server build boundary, the
   constant array + hash function is duplicated verbatim with a comment pointing
   at the canonical copy — the values and algorithm MUST stay identical.

3. **`components/Polaroid.tsx`**
   Add a watermark layer inside the card, below the photo/caption (`z-index`
   under the existing `relative z-10`/`z-2` content), clipped by the card's
   existing `rounded-[10px]` + `overflow` behaviour. Tint via the chosen colour;
   opacity ~0.12. Respect `size` (`small` vs `normal`) — the wash simply fills
   the card, so it scales automatically.

4. **`server/polaroidExport.js`**
   Load the texture (via the existing font/asset-resolution style — resolve a
   path that works for both root and `server/` installs), tint it to the same
   colour returned by the shared helper for `photo.id`, and draw it after the
   white card fill but before the photo/caption, clipped to the card
   `roundRectPath`. Opacity ~0.12.

## Data Flow

`photo.id` → `pickWatermarkColor(id)` → colour hex → tint the shared texture →
draw behind photo/caption at ~12% opacity. Same input, same function, same output
on wall and in PNG.

## Out of Scope (YAGNI)

- No new `PhotoEntry` field, no migration, no admin control for colour.
- No per-photo colour override UI.
- No change to upload, caption, signature, tape, or rotation behaviour.
- No change to the two mp4 files still sitting unused in `public/`.

## Testing / Verification

- **Determinism:** `pickWatermarkColor(id)` returns the same colour for the same
  id across many calls, and is stable for a fixed sample set of ids (unit-level
  check of the hash → index mapping).
- **Client/server agreement:** the same id maps to the same colour in both the
  client helper and the server helper (guard against the algorithms drifting).
- **Visual match:** spot-check a rendered wall card against its downloaded PNG for
  the same photo — the wash colour, placement, and subtlety should match.
- **Subtlety:** at 12% the wash must not reduce caption legibility; confirm on a
  light-photo and a dark-photo card.
- **Build:** `npx tsc --noEmit` passes; the server still renders PNGs for
  download-all without errors.

## Risks

- **Hash drift** between client and server would mis-match colours — mitigated by
  a single shared helper (or verbatim-duplicated, comment-linked copy) and the
  agreement test.
- **Texture path resolution on Railway** (root vs `server/node_modules` install)
  — the texture is a `public/` asset, not an npm package, so it is resolved from
  the app/public directory; confirm the server can read it in the deployed
  single-service layout.
