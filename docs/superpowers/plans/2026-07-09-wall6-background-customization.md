# Wall-6 Background Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin set the wall-6 background (bundled preset video/image, a solid color, or a custom-uploaded image ≤8MB), applied live and persisted, reusing the existing `wallSettings` + broadcast infrastructure.

**Architecture:** Extend the `background` field on the server-held `wallSettings` object (validated in the pure `server/settings.js`), add a `POST /api/background` upload endpoint that keeps only the newest `bg-*` file, and render the chosen background on wall-6 via a small `WallBackground` component. Admin gets a Background control group in the existing settings panel.

**Tech Stack:** React 19 + TypeScript (Vite), Express 4 + Socket.IO 4 (ESM), Node built-in test runner.

---

## File Structure

- Modify `server/settings.js` — add `WALL_BACKGROUND_PRESET_IDS`, `DEFAULT_BACKGROUND`, `normalizeBackground`; extend defaults + `normalizeWallSettings`.
- Modify `server/settings.test.js` — update existing default-shaped assertions; add background cases.
- Modify `server/index.js` — route-scoped 12mb parser + `POST /api/background` (8MB cap, keep-newest).
- Modify `types.ts` — `WallBackground`, `DEFAULT_BACKGROUND`, extend `WallSettings`/defaults.
- Create `constants/backgrounds.ts` — preset registry + `getPreset`.
- Modify `services/storageService.ts` — extract `toAbsoluteUrl`; add `uploadBackground`; normalize custom bg in `getWallSettings`.
- Create `components/WallBackground.tsx` — renders preset/color/custom.
- Modify `components/DisplayViewGrid.tsx` — use `WallBackground`.
- Modify `components/AdminView.tsx` — Background control group.

---

## Task 1: Server-side background validation

**Files:**
- Modify: `server/settings.js`
- Modify (test): `server/settings.test.js`

- [ ] **Step 1: Update existing test assertions to expect the new `background` field, and add background cases**

In `server/settings.test.js`, update the import to add `DEFAULT_BACKGROUND`:

```js
import {
  WALL_SETTINGS_DEFAULTS,
  WALL_SETTINGS_BOUNDS,
  DEFAULT_BACKGROUND,
  normalizeWallSettings,
} from './settings.js';
```

Then update these five existing assertions (each gains `background: DEFAULT_BACKGROUND`):

- In `'empty patch over defaults returns the defaults'`:
```js
  assert.deepEqual(normalizeWallSettings({}, WALL_SETTINGS_DEFAULTS), {
    maxColumns: 6,
    polaroidWidth: 180,
    background: DEFAULT_BACKGROUND,
  });
```
- In `'partial patch updates only the provided key'`:
```js
  assert.deepEqual(result, { maxColumns: 4, polaroidWidth: 260, background: DEFAULT_BACKGROUND });
```
- In `'ignores unknown keys'`:
```js
  assert.deepEqual(result, { maxColumns: 3, polaroidWidth: 180, background: DEFAULT_BACKGROUND });
```
- In `'sanitizes a corrupt base object'`:
```js
  assert.deepEqual(result, { maxColumns: 8, polaroidWidth: 180, background: DEFAULT_BACKGROUND });
```
- In `'non-object patch is treated as empty'`:
```js
  assert.deepEqual(normalizeWallSettings(null), { maxColumns: 6, polaroidWidth: 180, background: DEFAULT_BACKGROUND });
```

Then append these new tests to the end of the file:

```js
test('default settings include the default background', () => {
  assert.deepEqual(normalizeWallSettings({}).background, DEFAULT_BACKGROUND);
});

test('accepts a valid preset background', () => {
  assert.deepEqual(
    normalizeWallSettings({ background: { type: 'preset', value: 'bg' } }).background,
    { type: 'preset', value: 'bg' },
  );
});

test('accepts a valid solid color background', () => {
  assert.deepEqual(
    normalizeWallSettings({ background: { type: 'color', value: '#ff0000' } }).background,
    { type: 'color', value: '#ff0000' },
  );
});

test('accepts a custom background url', () => {
  assert.deepEqual(
    normalizeWallSettings({ background: { type: 'custom', value: '/uploads/bg-1.jpg' } }).background,
    { type: 'custom', value: '/uploads/bg-1.jpg' },
  );
});

test('unknown preset id keeps the base background', () => {
  const base = { maxColumns: 6, polaroidWidth: 180, background: { type: 'color', value: '#123456' } };
  assert.deepEqual(
    normalizeWallSettings({ background: { type: 'preset', value: 'nope' } }, base).background,
    { type: 'color', value: '#123456' },
  );
});

test('bad hex color falls back to default background', () => {
  assert.deepEqual(normalizeWallSettings({ background: { type: 'color', value: 'red' } }).background, DEFAULT_BACKGROUND);
});

test('invalid background type falls back to default background', () => {
  assert.deepEqual(normalizeWallSettings({ background: { type: 'weird', value: 'x' } }).background, DEFAULT_BACKGROUND);
});

test('empty custom value falls back to default background', () => {
  assert.deepEqual(normalizeWallSettings({ background: { type: 'custom', value: '' } }).background, DEFAULT_BACKGROUND);
});

test('non-object background keeps the base background', () => {
  const base = { maxColumns: 6, polaroidWidth: 180, background: { type: 'preset', value: 'bg' } };
  assert.deepEqual(normalizeWallSettings({ background: null }, base).background, { type: 'preset', value: 'bg' });
});

test('partial patch without background preserves base background', () => {
  const base = { maxColumns: 6, polaroidWidth: 180, background: { type: 'color', value: '#abcdef' } };
  assert.deepEqual(normalizeWallSettings({ maxColumns: 3 }, base).background, { type: 'color', value: '#abcdef' });
});

test('strips extra keys from a background object', () => {
  const r = normalizeWallSettings({ background: { type: 'color', value: '#000000', evil: true } }).background;
  assert.deepEqual(r, { type: 'color', value: '#000000' });
});
```

- [ ] **Step 2: Run tests to verify the new/updated cases fail**

Run: `npm test`
Expected: FAIL — the `background` field is missing from `normalizeWallSettings` output (deepEqual mismatches / `undefined`).

- [ ] **Step 3: Implement background validation in `server/settings.js`**

Add these constants immediately after the `WALL_SETTINGS_BOUNDS` block (before `WALL_SETTINGS_DEFAULTS`):

```js
export const WALL_BACKGROUND_PRESET_IDS = ['generali-boomerang', 'generali', 'bg'];

export const DEFAULT_BACKGROUND = { type: 'preset', value: 'generali-boomerang' };
```

Change `WALL_SETTINGS_DEFAULTS` to include the background:

```js
export const WALL_SETTINGS_DEFAULTS = {
  maxColumns: 6,
  polaroidWidth: 180,
  background: DEFAULT_BACKGROUND,
};
```

Add the background validators just before the `sanitize` definition:

```js
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const isValidBackground = (type, value) => {
  if (type === 'color') return typeof value === 'string' && HEX_COLOR.test(value);
  if (type === 'preset') return WALL_BACKGROUND_PRESET_IDS.includes(value);
  if (type === 'custom') return typeof value === 'string' && value.length > 0 && value.length <= 2048;
  return false;
};

// Accept a valid {type,value} pair (stripped to just those keys); otherwise keep base.
const normalizeBackground = (bg, base) => {
  if (!bg || typeof bg !== 'object') return base;
  if (isValidBackground(bg.type, bg.value)) return { type: bg.type, value: bg.value };
  return base;
};
```

Add `background` to the `sanitize` return object:

```js
const sanitize = (source, base) => ({
  maxColumns: clamp(
    source.maxColumns,
    WALL_SETTINGS_BOUNDS.maxColumns.min,
    WALL_SETTINGS_BOUNDS.maxColumns.max,
    base.maxColumns,
    true,
  ),
  polaroidWidth: clamp(
    source.polaroidWidth,
    WALL_SETTINGS_BOUNDS.polaroidWidth.min,
    WALL_SETTINGS_BOUNDS.polaroidWidth.max,
    base.polaroidWidth,
    false,
  ),
  background: normalizeBackground(source.background, base.background),
});
```

Add `background` to the `normalizeWallSettings` return object (after `polaroidWidth`):

```js
    background: 'background' in source
      ? normalizeBackground(source.background, safeBase.background)
      : safeBase.background,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests (22 total) pass.

- [ ] **Step 5: Commit**

```bash
git add server/settings.js server/settings.test.js
git commit -m "feat(server): validate wall background setting (preset/color/custom)"
```

---

## Task 2: Background image upload endpoint

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add the max-size constants**

In `server/index.js`, after the existing `const JSON_BODY_LIMIT_MB = ...` / size constants near the top (right after `const JSON_BODY_LIMIT_MB = parseFloat(...)`), add:

```js
const MAX_BG_IMAGE_MB = parseFloat(process.env.MAX_BG_IMAGE_MB || '8');
```

And where `MAX_IMAGE_BYTES` / `JSON_BODY_LIMIT` are derived (near `const MAX_IMAGE_BYTES = Math.floor(...)`), add:

```js
const MAX_BG_IMAGE_BYTES = Math.floor(MAX_BG_IMAGE_MB * 1024 * 1024);
```

- [ ] **Step 2: Add a route-scoped body parser BEFORE the global one**

Find the middleware setup:

```js
app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));
```

Insert a path-scoped parser between them so background uploads get a larger limit without changing the global limit:

```js
app.use(cors());
// Larger body limit for base64 background-image uploads, scoped to that route only.
// Registered before the global parser so it consumes the body first; the global
// express.json then no-ops (body-parser skips when req._body is already set).
app.use('/api/background', express.json({ limit: '12mb' }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
```

- [ ] **Step 3: Add the upload handler**

In `server/index.js`, immediately after the `PUT /api/settings` handler, add:

```js
app.post('/api/background', async (req, res) => {
  try {
    const { image } = req.body || {};
    if (typeof image !== 'string' || !image.startsWith('data:image')) {
      return res.status(400).json({ error: 'Unsupported image format' });
    }
    if (approxBytesFromDataUri(image) > MAX_BG_IMAGE_BYTES) {
      return res.status(400).json({ error: `Image exceeds ${MAX_BG_IMAGE_MB}MB limit` });
    }
    const decoded = decodeBase64Image(image);
    if (!decoded) {
      return res.status(400).json({ error: 'Malformed image data' });
    }

    // Keep only the most-recent custom background: remove any prior bg-* files.
    try {
      const files = await fs.readdir(UPLOAD_DIR);
      await Promise.all(files.filter((f) => f.startsWith('bg-')).map((f) => deleteFileIfExists(f)));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Failed to clear old backgrounds:', err);
    }

    const extension = decoded.mime === 'image/png' ? 'png' : 'jpg';
    const fileName = `bg-${Date.now()}.${extension}`;
    await fs.writeFile(fullImagePath(fileName), decoded.buffer);

    return res.status(201).json({ url: buildImageUrl(fileName) });
  } catch (error) {
    console.error('Background upload error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 4: Verify manually**

Start the server: `npm run server` (background or separate shell). Then:

```bash
# tiny 1x1 png
PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
curl -s -X POST http://localhost:3000/api/background -H "Content-Type: application/json" -d "{\"image\":\"data:image/png;base64,$PNG\"}"
# Expected: {"url":"/uploads/bg-<timestamp>.png"}

# now set it as the background and read settings back
URL=$(curl -s -X POST http://localhost:3000/api/background -H "Content-Type: application/json" -d "{\"image\":\"data:image/png;base64,$PNG\"}" | sed -E 's/.*"url":"([^"]+)".*/\1/')
curl -s -X PUT http://localhost:3000/api/settings -H "Content-Type: application/json" -d "{\"background\":{\"type\":\"custom\",\"value\":\"$URL\"}}"
# Expected: {"maxColumns":6,"polaroidWidth":180,"background":{"type":"custom","value":"/uploads/bg-<timestamp>.png"}}

# confirm only ONE bg-* file remains (keep-newest)
ls server/uploads/bg-*.png | wc -l   # Expected: 1

# reject oversized / bad payloads
curl -s -X POST http://localhost:3000/api/background -H "Content-Type: application/json" -d '{"image":"not-an-image"}'
# Expected: {"error":"Unsupported image format"}
```

Stop the server and clean up the test file afterward: `rm -f server/uploads/bg-*.png`.

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(server): add POST /api/background upload (8MB, keep-newest)"
```

---

## Task 3: Client types and preset registry

**Files:**
- Modify: `types.ts`
- Create: `constants/backgrounds.ts`

- [ ] **Step 1: Extend `types.ts`**

In `types.ts`, insert the background type + default BEFORE the existing `WallSettings` interface:

```ts
export type WallBackground =
  | { type: 'preset'; value: string }
  | { type: 'color'; value: string }
  | { type: 'custom'; value: string };

export const DEFAULT_BACKGROUND: WallBackground = { type: 'preset', value: 'generali-boomerang' };
```

Add `background` to the `WallSettings` interface:

```ts
export interface WallSettings {
  maxColumns: number;
  polaroidWidth: number;
  background: WallBackground;
}
```

Add `background` to `WALL_SETTINGS_DEFAULTS`:

```ts
export const WALL_SETTINGS_DEFAULTS: WallSettings = {
  maxColumns: 6,
  polaroidWidth: 180,
  background: DEFAULT_BACKGROUND,
};
```

- [ ] **Step 2: Create the preset registry**

Create `constants/backgrounds.ts`:

```ts
export interface BackgroundPreset {
  id: string;
  label: string;
  url: string;
  kind: 'video' | 'image';
}

// Only already-committed public/ assets are listed (deploy safety). The ids here
// MUST stay in sync with WALL_BACKGROUND_PRESET_IDS in server/settings.js.
export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: 'generali-boomerang', label: 'Generali (boomerang)', url: '/generali-bg-boomerang.mp4', kind: 'video' },
  { id: 'generali', label: 'Generali', url: '/generali-bg.mp4', kind: 'video' },
  { id: 'bg', label: 'Default BG', url: '/BG.mp4', kind: 'video' },
];

export const getPreset = (id: string): BackgroundPreset | undefined =>
  BACKGROUND_PRESETS.find((p) => p.id === id);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add types.ts constants/backgrounds.ts
git commit -m "feat(types): add WallBackground type and preset registry"
```

---

## Task 4: Client service — upload + URL normalization

**Files:**
- Modify: `services/storageService.ts`

- [ ] **Step 1: Extract a string URL helper and refactor `toAbsoluteImageUrl` to use it**

In `services/storageService.ts`, replace the entire existing `toAbsoluteImageUrl` function with this pair (behavior-preserving extraction so background URLs can reuse it):

```ts
// Resolve a possibly-relative/loopback URL to an absolute URL against the API base.
const toAbsoluteUrl = (url: string): string => {
  if (!url || url.startsWith('data:')) return url;

  const apiBase = API_URL.replace(/\/+$/, '');

  const upgradeToHttpsIfNeeded = (u: string) => {
    if (typeof window === 'undefined') return u;
    if (window.location.protocol !== 'https:') return u;
    if (u.startsWith('http://')) {
      return `https://${u.slice('http://'.length)}`;
    }
    return u;
  };

  try {
    let out = url.trim();
    if (/^https?:\/\//i.test(out)) {
      const parsed = new URL(out);
      // Only rewrite loopback URLs (e.g. bad data from dev). Do not force every absolute
      // URL onto the API base — that breaks production when the API host differs from the
      // static site and would replace a correct API URL with the wrong origin.
      if (isLoopbackHost(parsed.hostname)) {
        const apiOrigin = new URL(apiBase).origin;
        out = `${apiOrigin}${parsed.pathname}${parsed.search}`;
      }
      return upgradeToHttpsIfNeeded(out);
    }
    return upgradeToHttpsIfNeeded(new URL(out, apiBase).toString());
  } catch {
    return url;
  }
};

const toAbsoluteImageUrl = (photo: PhotoEntry): PhotoEntry => {
  if (!photo?.imageUrl) return photo;
  const imageUrl = toAbsoluteUrl(photo.imageUrl);
  return imageUrl === photo.imageUrl ? photo : { ...photo, imageUrl };
};
```

- [ ] **Step 2: Normalize a custom background URL in `getWallSettings`**

Replace the body of `getWallSettings` with:

```ts
export const getWallSettings = async (): Promise<WallSettings> => {
  try {
    const res = await fetch(`${API_URL}/api/settings`);
    if (!res.ok) throw new Error('Failed to fetch settings');
    const data = await res.json();
    const merged = { ...WALL_SETTINGS_DEFAULTS, ...data } as WallSettings;
    if (merged.background?.type === 'custom' && merged.background.value) {
      merged.background = { type: 'custom', value: toAbsoluteUrl(merged.background.value) };
    }
    return merged;
  } catch (e) {
    console.error('Failed to load wall settings', e);
    return { ...WALL_SETTINGS_DEFAULTS };
  }
};
```

- [ ] **Step 3: Add `uploadBackground`**

Add this export next to the other settings functions (after `subscribeToSettings`):

```ts
export const uploadBackground = async (
  dataUrl: string
): Promise<{ success: boolean; url?: string; error?: string }> => {
  try {
    const res = await fetch(`${API_URL}/api/background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    if (!res.ok) {
      let message = 'Failed to upload background';
      try {
        const payload = await res.json();
        if (payload?.error) message = payload.error;
      } catch {
        // ignore non-JSON error bodies
      }
      return { success: false, error: message };
    }
    const data = await res.json();
    return { success: true, url: toAbsoluteUrl(data.url) };
  } catch (e) {
    console.error('Error uploading background', e);
    return { success: false, error: 'Unable to reach server' };
  }
};
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add services/storageService.ts
git commit -m "feat(client): add background upload + shared URL normalization"
```

---

## Task 5: WallBackground component + wall-6 wiring

**Files:**
- Create: `components/WallBackground.tsx`
- Modify: `components/DisplayViewGrid.tsx`

- [ ] **Step 1: Create the component**

Create `components/WallBackground.tsx`:

```tsx
import React from 'react';
import { WallBackground as WallBackgroundSetting } from '../types';
import { getPreset } from '../constants/backgrounds';

const COVER = 'pointer-events-none absolute inset-0 z-0 h-full w-full object-cover';

// Renders the wall-6 backdrop for the current background setting, over the page's
// black fallback. Keyed by source so switching remounts the media element.
export const WallBackground: React.FC<{ background: WallBackgroundSetting }> = ({ background }) => {
  if (background.type === 'color') {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{ backgroundColor: background.value }}
        aria-hidden
      />
    );
  }

  if (background.type === 'custom') {
    return <img key={background.value} src={background.value} className={COVER} alt="" aria-hidden />;
  }

  // preset
  const preset = getPreset(background.value);
  if (!preset) return null; // unknown id — black fallback shows
  if (preset.kind === 'image') {
    return <img key={preset.url} src={preset.url} className={COVER} alt="" aria-hidden />;
  }
  return (
    <video key={preset.url} className={COVER} autoPlay muted loop playsInline aria-hidden>
      <source src={preset.url} type="video/mp4" />
    </video>
  );
};
```

- [ ] **Step 2: Use it in `DisplayViewGrid`**

In `components/DisplayViewGrid.tsx`, add the import near the other component imports (after the `Polaroid` import):

```tsx
import { WallBackground } from './WallBackground';
```

Replace the hardcoded background `<video>...</video>` block (the element with `<source src="/generali-bg-boomerang.mp4" ... />` and its surrounding comment) with:

```tsx
        <WallBackground background={settings.background} />
```

Leave the surrounding `{/* Background Wrapper */}` wrapper div and everything else unchanged.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/WallBackground.tsx components/DisplayViewGrid.tsx
git commit -m "feat(wall-6): render background from settings via WallBackground"
```

---

## Task 6: Admin background controls

**Files:**
- Modify: `components/AdminView.tsx`

- [ ] **Step 1: Update imports**

In `components/AdminView.tsx`:
- Add `uploadBackground` to the storageService import.
- Change the types import to add `WallBackground` and `DEFAULT_BACKGROUND`:
```tsx
import { PhotoEntry, WallSettings, WallBackground, WALL_SETTINGS_DEFAULTS, WALL_SETTINGS_BOUNDS } from '../types';
```
- Add the preset registry import (new line after the types import):
```tsx
import { BACKGROUND_PRESETS } from '../constants/backgrounds';
```

- [ ] **Step 2: Add background UI state + sync + upload handler**

After the existing `const saveTimer = useRef<number>();` line, add:

```tsx
  const [bgSource, setBgSource] = useState<'preset' | 'color' | 'custom'>(WALL_SETTINGS_DEFAULTS.background.type);
  const [isUploadingBg, setIsUploadingBg] = useState(false);
```

After the `handleResetSettings` function, add the sync effect and file handler:

```tsx
  // Keep the source selector in sync when settings load or change elsewhere.
  useEffect(() => {
    setBgSource(settings.background.type);
  }, [settings.background.type]);

  const handleBackgroundFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast('Image exceeds 8MB limit', 'error');
      return;
    }
    setIsUploadingBg(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const result = await uploadBackground(dataUrl);
      if (result.success && result.url) {
        updateSettings({ background: { type: 'custom' as const, value: result.url } });
        showToast('Background updated', 'success');
      } else {
        showToast(result.error || 'Failed to upload background', 'error');
      }
    } catch {
      showToast('Failed to read image', 'error');
    } finally {
      setIsUploadingBg(false);
    }
  };
```

- [ ] **Step 3: Render the Background control group**

In the settings `<section>`, insert this block AFTER the `</div>` that closes the `grid gap-6 sm:grid-cols-2` wrapper and BEFORE the "Reset to defaults" `<button>`:

```tsx
        <div className="mt-6">
          <span className="text-sm text-zinc-400">Background</span>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {(['preset', 'color', 'custom'] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="bgSource"
                  checked={bgSource === opt}
                  onChange={() => {
                    setBgSource(opt);
                    if (opt === 'preset') {
                      updateSettings({
                        background: {
                          type: 'preset' as const,
                          value: settings.background.type === 'preset' ? settings.background.value : BACKGROUND_PRESETS[0].id,
                        },
                      });
                    } else if (opt === 'color') {
                      updateSettings({
                        background: {
                          type: 'color' as const,
                          value: settings.background.type === 'color' ? settings.background.value : '#000000',
                        },
                      });
                    }
                  }}
                />
                <span>{opt === 'custom' ? 'Custom image' : opt === 'color' ? 'Solid color' : 'Preset'}</span>
              </label>
            ))}
          </div>

          {bgSource === 'preset' && (
            <select
              value={settings.background.type === 'preset' ? settings.background.value : BACKGROUND_PRESETS[0].id}
              onChange={(e) => updateSettings({ background: { type: 'preset' as const, value: e.target.value } })}
              className="mt-3 w-full bg-zinc-950 text-white border border-zinc-700 rounded-lg p-2 focus:border-blue-500 outline-none"
            >
              {BACKGROUND_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          )}

          {bgSource === 'color' && (
            <input
              type="color"
              value={settings.background.type === 'color' ? settings.background.value : '#000000'}
              onChange={(e) => updateSettings({ background: { type: 'color' as const, value: e.target.value } })}
              className="mt-3 h-10 w-20 bg-zinc-950 border border-zinc-700 rounded-lg cursor-pointer"
            />
          )}

          {bgSource === 'custom' && (
            <div className="mt-3">
              <input
                type="file"
                accept="image/*"
                onChange={handleBackgroundFile}
                disabled={isUploadingBg}
                className="text-sm text-zinc-300"
              />
              {isUploadingBg && <span className="ml-2 text-xs text-zinc-400">Uploading…</span>}
              {settings.background.type === 'custom' && (
                <p className="mt-2 text-xs text-zinc-500 break-all">Current: {settings.background.value}</p>
              )}
            </div>
          )}
        </div>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/AdminView.tsx
git commit -m "feat(admin): add background source controls (preset/color/upload)"
```

---

## Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Build and start the single-service app**

```bash
npm run build
```
Then start the `app` launch config (server on port 3000, serving the fresh `dist` + API). Seed one photo so the wall renders (reuse the 1x1 png):

```bash
PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
curl -s -X POST http://localhost:3000/api/photos -H "Content-Type: application/json" -d "{\"id\":\"bgseed-1\",\"caption\":\"Hi\",\"timestamp\":1,\"images\":[\"data:image/png;base64,$PNG\"]}" -o /dev/null -w "%{http_code}\n"
```

- [ ] **Step 2: Verify default background renders on wall-6**

Navigate the preview to `#/wall-6`. Confirm a `<video>` with `src="/generali-bg-boomerang.mp4"` is present (default unchanged):
```js
(() => { const v = document.querySelector('main, body') && document.querySelector('video source'); return v ? v.getAttribute('src') : document.querySelector('video') ? 'video-no-source' : 'no-video'; })()
```
Expected: `/generali-bg-boomerang.mp4`.

- [ ] **Step 3: Verify preset switch, color, and custom upload via admin**

Open `#/admin`, log in (`admin`). In the Background group:
- Select preset "Default BG" → confirm `PUT /api/settings` fires and wall-6 (reload) shows a `<video source src="/BG.mp4">`.
- Choose "Solid color", pick a color → confirm wall-6 shows a `div` with that `backgroundColor` and no video.
- Choose "Custom image", upload a small PNG → confirm `POST /api/background` returns a url, `PUT /api/settings` sets `type:custom`, wall-6 shows an `<img>` with that src, and only one `bg-*` file exists:
```bash
curl -s http://localhost:3000/api/settings
ls server/uploads/bg-*.* | wc -l   # Expected: 1
```
- Verify live (no reload): with wall-6 open, run in its page context:
```js
(async () => { await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({background:{type:'color',value:'#3355ff'}})}); await new Promise(r=>setTimeout(r,600)); const d=[...document.querySelectorAll('.absolute.inset-0.z-0')].find(e=>e.style.backgroundColor); return d ? d.style.backgroundColor : 'no-color-bg'; })()
```
Expected: `rgb(51, 85, 255)`.
- Click "Reset to defaults" in admin → `curl -s http://localhost:3000/api/settings` shows `background` back to `{type:'preset',value:'generali-boomerang'}`.

- [ ] **Step 4: Final gate + cleanup**

```bash
npm test          # Expected: all pass (21)
npx tsc --noEmit  # Expected: clean
```
Stop the server; remove seed/background test files:
```bash
rm -f server/uploads/bgseed-*.png server/uploads/bg-*.*
```

- [ ] **Step 5: Commit (only if verification required tweaks)**

```bash
git add -A
git commit -m "chore: verify wall-6 background customization end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** data model + default (Tasks 1,3); server validation (Task 1); upload endpoint 8MB + keep-newest (Task 2); preset registry (Task 3); client service + custom-URL normalization (Task 4); WallBackground render preset/color/custom (Task 5); admin source selector + upload (Task 6); tests + manual verification (Tasks 1,7). No gaps.
- **Type/name consistency:** `WallBackground`, `DEFAULT_BACKGROUND`, `WallSettings.background`, `WALL_BACKGROUND_PRESET_IDS`, `normalizeBackground`, `BACKGROUND_PRESETS`/`getPreset`, `uploadBackground`, `toAbsoluteUrl`, `POST /api/background`, `bg-*` naming, and preset ids (`generali-boomerang`, `generali`, `bg`) are used identically across server and client tasks.
- **Existing-test impact:** Task 1 Step 1 explicitly updates the five default-shaped `deepEqual` assertions in `server/settings.test.js` for the new `background` field, so the suite stays green.
- **Known non-issue:** the admin source radios use a local `bgSource` synced from `settings.background.type`; selecting "custom" is transient until an upload succeeds (no settings write until then), consistent with the debounced-save model.
