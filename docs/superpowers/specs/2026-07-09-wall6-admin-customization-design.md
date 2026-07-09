# Wall-6 Admin Customization — Design

**Date:** 2026-07-09
**Status:** Approved pending final review

## Goal

Let an admin customize the `/wall-6` display from the admin page. First two
controls: **number of columns** and **polaroid size**. Changes propagate to the
live wall in real time and persist across server restarts.

## Decisions

- **Sync model:** Live + persistent. Settings are stored server-side and
  broadcast over Socket.IO (same architecture as photos). The wall updates
  without a refresh; admin and wall are separate devices.
- **Columns:** Admin sets a *cap*. The wall keeps its responsive width→columns
  ladder and applies `numCols = min(maxColumns, responsiveCols)`, so narrow
  screens still step down. Cap range **1–8**. Default **6** (= today's
  wide-screen max, so default behavior is unchanged).
- **Polaroid size:** A px-width slider, range **100–320**, default **180**
  (= today's hardcoded `max-w-[180px]`). The **entire polaroid scales
  uniformly** — border, tape strip, and caption type scale with width off a
  base size, preserving the card's aspect ratio and visual weight at any size.
- **Reset:** A "Reset to defaults" button in the admin panel.

## Data model

Single settings object, held server-side:

```ts
interface WallSettings {
  maxColumns: number;    // default 6, clamped to [1, 8]
  polaroidWidth: number; // default 180, clamped to [100, 320]
}
```

Defaults reproduce today's look exactly; nothing changes until an admin edits a
control.

## Server (`server/index.js`)

- Keep `wallSettings` in memory, seeded with defaults.
- Persist to `settings.json` next to `photos.json` (same persistent-volume
  directory, gated by `ENABLE_DISK_CACHE` like photos). On boot, load and
  clamp; on missing/invalid file, fall back to defaults.
- `GET /api/settings` → current settings.
- `PUT /api/settings` → validate + **clamp** each field to its range, merge over
  current settings, persist (debounced/immediate — reuse existing save helper
  pattern), then `io.emit('settings_update', settings)`.
- **Auth:** No server-side auth on this route, matching the existing posture
  (`DELETE /api/photos/:id` is likewise unauthenticated; admin is gated only
  client-side). Called out explicitly rather than silently changing the model.

### Validation / clamping rules

- `maxColumns`: coerce to integer; clamp to `[1, 8]`; non-numeric → keep current.
- `polaroidWidth`: coerce to number; clamp to `[100, 320]`; non-numeric → keep
  current.
- Unknown keys ignored. A PUT with a subset of keys updates only those keys.

## Client plumbing

- `types.ts`: add `WallSettings` and the default constants (single source of
  truth shared by client; server keeps its own copy of the same values).
- `services/storageService.ts`:
  - `getWallSettings(): Promise<WallSettings>` — `GET /api/settings`, falls back
    to defaults on error.
  - `saveWallSettings(settings): Promise<{ success; error? }>` — `PUT`.
  - `subscribeToSettings(cb): () => void` — socket `settings_update`.

## wall-6 (`components/DisplayViewGrid.tsx`)

- On mount: `getWallSettings()`; subscribe to `settings_update`; store in state.
- **Columns:** keep the responsive ladder but (a) extend its top end so caps
  above 6 are reachable on ultra-wide screens, and (b) apply
  `numCols = min(settings.maxColumns, responsiveCols)`.
- **Size:** pass `settings.polaroidWidth` down to the polaroid instead of the
  hardcoded `max-w-[180px]`.

## Polaroid (`components/Polaroid.tsx`)

- Accept an optional numeric width (e.g. `width?: number`). When provided,
  derive a `scale = width / BASE_WIDTH` (BASE = 180) and compute the card's
  padding, caption font-size, and tape dimensions as `base * scale` inline
  styles, replacing the fixed Tailwind size classes for the scaled path.
- The image stays `w-full h-auto` (intrinsic ratio). Because every other
  dimension is proportional to width, the whole card keeps its ratio at any
  size.
- The existing `size='small' | 'normal'` discrete path is preserved for other
  callers (e.g. spotlight wall); only wall-6 uses the numeric-width path.
- Care with transforms: the card already uses inline `transform: rotate(...)`
  and `hover:scale-105`. Scaling is done via dimension math (not an extra CSS
  `transform: scale`), so it composes cleanly with the existing rotate/hover.

## Admin (`components/AdminView.tsx`)

- After auth, load current settings.
- New "Wall-6 Display Settings" panel above the photo grid:
  - **Columns** — number input / stepper, 1–8.
  - **Polaroid size** — range slider, 100–320px, with the live px value shown.
  - **Reset to defaults** button.
- On change: debounced `saveWallSettings` PUT. Live broadcast means the wall
  reflects changes immediately; the admin panel also reflects inbound
  `settings_update` events (so two admins stay in sync).

## Testing

- **Server unit tests:** validation/clamping (out-of-range, non-numeric, partial
  updates, unknown keys) and the `GET`→`PUT`→`GET` round-trip.
- **Manual / preview verification:** change columns and size in admin, confirm
  `/wall-6` updates live without refresh; confirm polaroids scale uniformly
  (ratio preserved) and columns cap correctly; confirm reset restores defaults;
  confirm persistence across a server restart.

## Out of scope (YAGNI)

- Per-column or per-photo customization.
- Background/theme/speed controls (possible future additions; not now).
- Server-side admin authentication (unchanged from current app-wide posture).
