# Wall-6 Background Customization — Design

**Date:** 2026-07-09
**Status:** Approved pending review
**Builds on:** [wall-6 admin customization](2026-07-09-wall6-admin-customization-design.md) (columns + polaroid size). Reuses the same server-held `wallSettings` object, `PUT /api/settings`, and `settings_update` Socket.IO broadcast.

## Goal

Let an admin set the `/wall-6` background from the admin page. The background can be a
bundled **preset** (video/image), a **solid color**, or a **custom uploaded image**.
Changes propagate live to the wall and persist across restarts, exactly like the
existing column/size settings.

## Decisions

- **Scope:** Background only (no broader theming).
- **Sources:** presets + solid color + custom image upload (images only; preset videos
  remain available for video backdrops).
- **Custom upload:** images only, **≤ 8MB**; keep only the **single most-recent**
  uploaded background (delete prior `bg-*` on each new upload — bounded storage).
- **Default:** `{ type: 'preset', value: 'generali-boomerang' }` — reproduces today's
  hardcoded `generali-bg-boomerang.mp4` look; nothing changes until an admin edits it.

## Data model

Extend `WallSettings` with a `background` discriminated union:

```ts
type WallBackground =
  | { type: 'preset'; value: string }   // preset id
  | { type: 'color';  value: string }   // "#rrggbb"
  | { type: 'custom'; value: string };  // uploaded image URL, e.g. /uploads/bg-<ts>.jpg

interface WallSettings {
  maxColumns: number;    // existing
  polaroidWidth: number; // existing
  background: WallBackground;
}
```

`DEFAULT_BACKGROUND = { type: 'preset', value: 'generali-boomerang' }`.

### Preset registry

Client-side registry `constants/backgrounds.ts`:

```ts
interface BackgroundPreset { id: string; label: string; url: string; kind: 'video' | 'image'; }

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: 'generali-boomerang', label: 'Generali (boomerang)', url: '/generali-bg-boomerang.mp4', kind: 'video' },
  { id: 'generali',           label: 'Generali',             url: '/generali-bg.mp4',           kind: 'video' },
  { id: 'bg',                 label: 'Default BG',           url: '/BG.mp4',                    kind: 'video' },
];
```

Only already-committed assets are listed (deploy safety). Adding a preset later = commit
the asset + one registry line (+ the id to the server list below). `azpoa2BG.png` and
`bubbleBG.mp4` are intentionally excluded because they are currently untracked.

## Server (`server/settings.js` + `server/index.js`)

### Validation (`server/settings.js`)

- Add `WALL_BACKGROUND_PRESET_IDS = ['generali-boomerang', 'generali', 'bg']` and
  `DEFAULT_BACKGROUND` constants (server mirror of the client registry ids).
- Add `normalizeBackground(bg, base)`:
  - not an object → return `base`.
  - `type` not in `{preset, color, custom}` → return `base`.
  - `color`: accept iff `value` matches `/^#[0-9a-fA-F]{6}$/`, else `base`.
  - `preset`: accept iff `value ∈ WALL_BACKGROUND_PRESET_IDS`, else `base`.
  - `custom`: accept iff `value` is a non-empty string (≤ 2048 chars), else `base`.
  - Accepted → return `{ type, value }` (stripped to just those keys).
- Extend `normalizeWallSettings` so `safeBase.background = normalizeBackground(base.background, DEFAULT_BACKGROUND)` and
  `background = 'background' in source ? normalizeBackground(source.background, safeBase.background) : safeBase.background`.
  This matches the existing "invalid → keep base" semantics of the numeric fields.

### Upload endpoint (`server/index.js`)

`POST /api/background` with a **route-specific** body limit:

```js
app.post('/api/background', express.json({ limit: '12mb' }), async (req, res) => { ... });
```

- Body: `{ image: 'data:image/...;base64,...' }`.
- Validate: `image` starts with `data:image`; decoded size ≤ `MAX_BG_IMAGE_BYTES`
  (`MAX_BG_IMAGE_MB = 8`); decodable.
- Delete any existing `bg-*` files in `UPLOAD_DIR` (keep only the most recent).
- Write `bg-<timestamp>.<ext>` (ext from mime: png/jpg) to `UPLOAD_DIR`.
- Respond `{ url: buildImageUrl(fileName) }` (reuses the existing helper → relative
  `/uploads/..` locally, absolute with `PUBLIC_BASE_URL` when configured).
- No server-side auth (matches existing posture; admin gated client-side).

The background image is written to `UPLOAD_DIR` (same persistent volume as photos).
`sanitizePhoto`/photo listing is unaffected (the `bg-*` file is not a photo record).

## Client

- `types.ts`: add `WallBackground`, extend `WallSettings`, export `DEFAULT_BACKGROUND`.
- `constants/backgrounds.ts`: the preset registry above + a `getPreset(id)` helper.
- `services/storageService.ts`:
  - `uploadBackground(dataUrl): Promise<{ success; url?; error? }>` → `POST /api/background`.
  - `getWallSettings`: after merging defaults, if `background.type === 'custom'`, run its
    `value` through the existing absolute-URL normalization (same helper used for photo
    `imageUrl`) so split-host deploys resolve it correctly.

## wall-6 rendering (`components/DisplayViewGrid.tsx` + new `components/WallBackground.tsx`)

Extract a small `WallBackground` component (keeps `DisplayViewGrid` focused):

```tsx
const WallBackground: React.FC<{ background: WallBackground }> = ({ background }) => { ... }
```

Renders over the existing `bg-black`:
- `preset` with `kind === 'video'` → `<video autoPlay muted loop playsInline>` (current markup).
- `preset` with `kind === 'image'` or `custom` → `<img class="...object-cover">`.
- `color` → a `div` with `style={{ backgroundColor: value }}`.
- Unknown/missing → nothing (black fallback shows).

`DisplayViewGrid` replaces its hardcoded `<video>` with `<WallBackground background={settings.background} />`.
Because `settings` already loads on mount and updates via `subscribeToSettings`, the
background changes live with no extra wiring.

## Admin panel (`components/AdminView.tsx`)

Add a "Background" group to the existing Wall-6 settings panel:
- **Source** selector (radio/segmented): Preset · Solid color · Custom image — derived
  from `settings.background.type`.
- **Preset** → `<select>` of `BACKGROUND_PRESETS` (label/value=id); onChange
  `updateSettings({ background: { type:'preset', value: id } })`.
- **Solid color** → `<input type="color">`; onChange
  `updateSettings({ background: { type:'color', value: hex } })`.
- **Custom image** → `<input type="file" accept="image/*">`: read file → data URL →
  `uploadBackground` → on success `updateSettings({ background: { type:'custom', value: url } })`;
  show a small uploading/error state via the existing `showToast`. Enforce the 8MB cap
  client-side before upload (fail fast with a toast).

Reuses the existing debounced `updateSettings`/`persistSettings` and live subscription.
The source selector changing to `preset`/`color` applies immediately; `custom` applies
after a successful upload.

## Testing

- **Server unit tests** (`server/settings.test.js`): extend for `normalizeBackground` via
  `normalizeWallSettings` — valid preset/color/custom accepted; invalid type, bad hex,
  unknown preset id, empty custom, and non-object background each keep the base; partial
  patch without `background` preserves base; default settings include `DEFAULT_BACKGROUND`.
- **Manual / preview verification:** switch preset (video updates), set a solid color,
  upload a custom image (wall shows it, prior `bg-*` deleted), confirm all propagate live
  to `/wall-6` without reload, and confirm the default is visually unchanged.

## Out of scope (YAGNI)

- Custom **video** upload (presets cover video backdrops).
- Broader theming (polaroid tape/caption colors, fonts, per-page themes).
- Multiple retained custom backgrounds / a background library (keep only the newest).
- Server-side admin auth (unchanged from current app-wide posture).
