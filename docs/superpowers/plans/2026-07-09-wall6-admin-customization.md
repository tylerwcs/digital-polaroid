# Wall-6 Admin Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin set the wall-6 column cap and polaroid size from the admin page, propagated live to the wall and persisted across restarts.

**Architecture:** A single server-held `wallSettings` object is persisted to `settings.json` (same volume as photos, gated by `ENABLE_DISK_CACHE`) and broadcast over Socket.IO (`settings_update`). Pure clamp/normalize logic lives in an importable `server/settings.js` module (unit-tested with `node:test`). The wall (`DisplayViewGrid`) and admin (`AdminView`) fetch settings on load and subscribe to live updates. The polaroid scales uniformly off a 180px base so its aspect ratio is preserved.

**Tech Stack:** React 19 + TypeScript (Vite), Express 4 + Socket.IO 4 (ESM), Node built-in test runner.

---

## File Structure

- Create `server/settings.js` — pure defaults, bounds, and `normalizeWallSettings(patch, base)` clamp/merge. Importable, no side effects.
- Create `server/settings.test.js` — `node:test` unit tests for the clamp/merge logic.
- Modify `server/index.js` — in-memory `wallSettings`, load/save `settings.json`, `GET`/`PUT /api/settings`, broadcast.
- Modify `package.json` — add a `test` script.
- Modify `types.ts` — `WallSettings` interface + default/bounds constants (client copy).
- Modify `services/storageService.ts` — `getWallSettings`, `saveWallSettings`, `subscribeToSettings`.
- Modify `components/Polaroid.tsx` — optional numeric `width` prop that scales the whole card uniformly.
- Modify `components/DisplayViewGrid.tsx` — consume settings; cap columns; pass polaroid width.
- Modify `components/AdminView.tsx` — settings panel (columns stepper, size slider, reset).

---

## Task 1: Server settings module (pure clamp/merge logic)

**Files:**
- Create: `server/settings.js`
- Test: `server/settings.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `server/settings.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WALL_SETTINGS_DEFAULTS,
  WALL_SETTINGS_BOUNDS,
  normalizeWallSettings,
} from './settings.js';

test('empty patch over defaults returns the defaults', () => {
  assert.deepEqual(normalizeWallSettings({}, WALL_SETTINGS_DEFAULTS), {
    maxColumns: 6,
    polaroidWidth: 180,
  });
});

test('clamps maxColumns to its bounds', () => {
  assert.equal(normalizeWallSettings({ maxColumns: 99 }).maxColumns, WALL_SETTINGS_BOUNDS.maxColumns.max);
  assert.equal(normalizeWallSettings({ maxColumns: 0 }).maxColumns, WALL_SETTINGS_BOUNDS.maxColumns.min);
});

test('rounds fractional maxColumns', () => {
  assert.equal(normalizeWallSettings({ maxColumns: 3.7 }).maxColumns, 4);
});

test('clamps polaroidWidth to its bounds', () => {
  assert.equal(normalizeWallSettings({ polaroidWidth: 999 }).polaroidWidth, WALL_SETTINGS_BOUNDS.polaroidWidth.max);
  assert.equal(normalizeWallSettings({ polaroidWidth: 10 }).polaroidWidth, WALL_SETTINGS_BOUNDS.polaroidWidth.min);
});

test('non-numeric value keeps the base value', () => {
  const base = { maxColumns: 4, polaroidWidth: 200 };
  assert.equal(normalizeWallSettings({ maxColumns: 'abc' }, base).maxColumns, 4);
});

test('partial patch updates only the provided key', () => {
  const base = { maxColumns: 4, polaroidWidth: 200 };
  const result = normalizeWallSettings({ polaroidWidth: 260 }, base);
  assert.deepEqual(result, { maxColumns: 4, polaroidWidth: 260 });
});

test('ignores unknown keys', () => {
  const result = normalizeWallSettings({ speed: 5, maxColumns: 3 });
  assert.deepEqual(result, { maxColumns: 3, polaroidWidth: 180 });
});

test('sanitizes a corrupt base object', () => {
  const result = normalizeWallSettings({}, { maxColumns: 999, polaroidWidth: 'x' });
  assert.deepEqual(result, { maxColumns: 8, polaroidWidth: 180 });
});

test('non-object patch is treated as empty', () => {
  assert.deepEqual(normalizeWallSettings(null), { maxColumns: 6, polaroidWidth: 180 });
});
```

- [ ] **Step 2: Add the test script, then run the test to verify it fails**

Modify `package.json` scripts block — add the `test` line:

```json
  "scripts": {
    "dev": "concurrently \"npm run server\" \"vite\"",
    "server": "node server/index.js",
    "build": "vite build",
    "start": "node server/index.js",
    "preview": "vite preview",
    "test": "node --test server/settings.test.js"
  },
```

Run: `npm test`
Expected: FAIL — cannot find module `./settings.js` (or similar import error).

- [ ] **Step 3: Write minimal implementation**

Create `server/settings.js`:

```js
// Pure, dependency-free settings logic shared by the API and its tests.
// Kept importable (no side effects) so the clamp/merge rules can be unit-tested.

export const WALL_SETTINGS_BOUNDS = {
  maxColumns: { min: 1, max: 8 },
  polaroidWidth: { min: 100, max: 320 },
};

export const WALL_SETTINGS_DEFAULTS = {
  maxColumns: 6,
  polaroidWidth: 180,
};

const clamp = (value, min, max, fallback, round) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = round ? Math.round(n) : n;
  return Math.min(max, Math.max(min, v));
};

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
});

// Merge an untrusted patch over a base, clamping every field. Missing/invalid
// keys keep the (sanitized) base value; unknown keys are ignored.
export const normalizeWallSettings = (patch = {}, base = WALL_SETTINGS_DEFAULTS) => {
  const safeBase = sanitize(base && typeof base === 'object' ? base : {}, WALL_SETTINGS_DEFAULTS);
  const source = patch && typeof patch === 'object' ? patch : {};
  return {
    maxColumns: 'maxColumns' in source
      ? clamp(source.maxColumns, WALL_SETTINGS_BOUNDS.maxColumns.min, WALL_SETTINGS_BOUNDS.maxColumns.max, safeBase.maxColumns, true)
      : safeBase.maxColumns,
    polaroidWidth: 'polaroidWidth' in source
      ? clamp(source.polaroidWidth, WALL_SETTINGS_BOUNDS.polaroidWidth.min, WALL_SETTINGS_BOUNDS.polaroidWidth.max, safeBase.polaroidWidth, false)
      : safeBase.polaroidWidth,
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests in `server/settings.test.js` pass.

- [ ] **Step 5: Commit**

```bash
git add server/settings.js server/settings.test.js package.json
git commit -m "feat(server): add wall settings clamp/merge module with tests"
```

---

## Task 2: Wire settings into the server (store, persist, endpoints, broadcast)

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Import the settings module**

In `server/index.js`, add to the imports near line 12 (after the `captionModerationError` import):

```js
import { WALL_SETTINGS_DEFAULTS, normalizeWallSettings } from './settings.js';
```

- [ ] **Step 2: Add the settings file path and in-memory store**

In `server/index.js`, just after the `DATA_FILE` definition (around line 62), add:

```js
// Wall display settings, stored beside photos.json on the same persistent volume.
const SETTINGS_FILE = process.env.WALL_SETTINGS_FILE
  || path.join(path.dirname(UPLOAD_DIR), 'settings.json');
```

Then, next to the other in-memory cache declarations (after `let photos = [];` around line 95), add:

```js
let wallSettings = { ...WALL_SETTINGS_DEFAULTS };
```

- [ ] **Step 3: Add load/save helpers**

In `server/index.js`, immediately after the `loadPhotos` function (around line 222), add:

```js
// Load wall settings from disk (optional; mirrors loadPhotos).
async function loadSettings() {
  if (!ENABLE_DISK_CACHE) {
    wallSettings = { ...WALL_SETTINGS_DEFAULTS };
    return;
  }
  try {
    const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
    wallSettings = normalizeWallSettings(JSON.parse(data), WALL_SETTINGS_DEFAULTS);
    console.log('Loaded wall settings', wallSettings);
  } catch (error) {
    wallSettings = { ...WALL_SETTINGS_DEFAULTS };
    console.log('No wall settings found, using defaults');
  }
}

async function saveSettings() {
  if (!ENABLE_DISK_CACHE) return;
  try {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(wallSettings, null, 2));
  } catch (error) {
    console.error('Failed to save wall settings:', error);
  }
}
```

- [ ] **Step 4: Add the API endpoints**

In `server/index.js`, add after the `GET /api/photos` handler (around line 295):

```js
app.get('/api/settings', (req, res) => {
  res.json(wallSettings);
});

app.put('/api/settings', async (req, res) => {
  // No server-side auth here, matching the existing posture (DELETE /api/photos
  // is likewise unauthenticated; admin is gated only client-side).
  wallSettings = normalizeWallSettings(req.body, wallSettings);
  await saveSettings();
  io.emit('settings_update', wallSettings);
  res.json(wallSettings);
});
```

- [ ] **Step 5: Load settings at startup**

In `server/index.js`, in the startup sequence near the end (after `await loadPhotos();`, around line 458), add:

```js
await loadSettings();
```

- [ ] **Step 6: Verify the endpoints manually**

Run the server: `npm run server`
In a second terminal:

```bash
curl -s http://localhost:3000/api/settings
# Expected: {"maxColumns":6,"polaroidWidth":180}

curl -s -X PUT http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"maxColumns":99,"polaroidWidth":250}'
# Expected: {"maxColumns":8,"polaroidWidth":250}   (maxColumns clamped)

curl -s http://localhost:3000/api/settings
# Expected: {"maxColumns":8,"polaroidWidth":250}
```

Stop the server (Ctrl-C) after verifying.

- [ ] **Step 7: Commit**

```bash
git add server/index.js
git commit -m "feat(server): persist and broadcast wall settings via /api/settings"
```

---

## Task 3: Client types and shared constants

**Files:**
- Modify: `types.ts`

- [ ] **Step 1: Add the WallSettings type and constants**

Append to `types.ts`:

```ts
export interface WallSettings {
  maxColumns: number;
  polaroidWidth: number;
}

// Client copy of the server defaults/bounds (crosses the ts/js boundary, so kept
// in sync with server/settings.js by hand — only four numbers).
export const WALL_SETTINGS_DEFAULTS: WallSettings = {
  maxColumns: 6,
  polaroidWidth: 180,
};

export const WALL_SETTINGS_BOUNDS = {
  maxColumns: { min: 1, max: 8 },
  polaroidWidth: { min: 100, max: 320 },
} as const;
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `types.ts`.

- [ ] **Step 3: Commit**

```bash
git add types.ts
git commit -m "feat(types): add WallSettings type and default/bounds constants"
```

---

## Task 4: Client settings service functions

**Files:**
- Modify: `services/storageService.ts`

- [ ] **Step 1: Update the types import**

In `services/storageService.ts`, change the import on line 2 from:

```ts
import { PhotoEntry } from '../types';
```

to:

```ts
import { PhotoEntry, WallSettings, WALL_SETTINGS_DEFAULTS } from '../types';
```

- [ ] **Step 2: Add the settings functions**

Append to `services/storageService.ts` (after `subscribeToDelete`, before `compressImage`):

```ts
export const getWallSettings = async (): Promise<WallSettings> => {
  try {
    const res = await fetch(`${API_URL}/api/settings`);
    if (!res.ok) throw new Error('Failed to fetch settings');
    const data = await res.json();
    return { ...WALL_SETTINGS_DEFAULTS, ...data };
  } catch (e) {
    console.error('Failed to load wall settings', e);
    return { ...WALL_SETTINGS_DEFAULTS };
  }
};

export const saveWallSettings = async (
  settings: Partial<WallSettings>
): Promise<{ success: boolean; error?: string; settings?: WallSettings }> => {
  try {
    const res = await fetch(`${API_URL}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) return { success: false, error: 'Failed to save settings' };
    const data = await res.json();
    return { success: true, settings: data };
  } catch (e) {
    console.error('Error saving wall settings', e);
    return { success: false, error: 'Unable to reach server' };
  }
};

export const subscribeToSettings = (callback: (settings: WallSettings) => void) => {
  socket.on('settings_update', callback);
  return () => {
    socket.off('settings_update', callback);
  };
};
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `services/storageService.ts`.

- [ ] **Step 4: Commit**

```bash
git add services/storageService.ts
git commit -m "feat(client): add wall settings fetch/save/subscribe service functions"
```

---

## Task 5: Polaroid uniform-scale width prop

**Files:**
- Modify: `components/Polaroid.tsx`

- [ ] **Step 1: Add the `width` prop to the interface**

In `components/Polaroid.tsx`, replace the `PolaroidProps` interface (lines 4-9) with:

```tsx
interface PolaroidProps {
  photo: PhotoEntry;
  className?: string;
  style?: React.CSSProperties;
  size?: 'normal' | 'small';
  width?: number; // when set, the whole card scales uniformly to this px width
}
```

- [ ] **Step 2: Add the uniform-scale render path**

In `components/Polaroid.tsx`, update the component signature to destructure `width`:

```tsx
export const Polaroid: React.FC<PolaroidProps> = ({
  photo,
  className = '',
  style = {},
  size = 'normal',
  width
}) => {
```

Then, immediately after the `currentImage` computation (after line 20, before `const isSmall = ...`), insert the scaled path. Every dimension is proportional to width off a 180px base, so the card keeps its exact aspect ratio at any size:

```tsx
  // Uniform-scale path (used by wall-6): all dimensions are proportional to
  // width off a 180px base, so the card's ratio is preserved at any size.
  if (typeof width === 'number') {
    const s = width / 180;
    const px = (n: number) => `${n * s}px`;
    return (
      <div
        className={`relative bg-white shadow-xl text-black transform transition-transform hover:scale-105 duration-300 ${className}`}
        style={{
          ...style,
          width: `${width}px`,
          padding: px(8),
          paddingBottom: px(24),
          borderRadius: px(10),
          transform: `rotate(${photo.rotation}deg)`,
        }}
      >
        <div
          aria-hidden="true"
          className="absolute left-1/2 -translate-x-1/2 -rotate-3 pointer-events-none"
          style={{
            top: px(-8),
            width: px(48),
            height: px(14),
            borderRadius: px(2),
            backgroundColor: 'rgba(216, 207, 191, 0.6)',
            backgroundImage:
              'linear-gradient(105deg, rgba(255,255,255,0.25), rgba(255,255,255,0) 45%, rgba(0,0,0,0.06))',
            boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
          }}
        />
        {currentImage && (
          <div
            className="w-full bg-gray-100 border border-gray-200 overflow-hidden relative"
            style={{ marginBottom: px(16), borderRadius: px(4) }}
          >
            <img
              src={currentImage}
              alt={photo.caption}
              className="w-full h-auto block"
            />
            {photo.signature && (
              <img
                src={photo.signature}
                alt="Signature"
                className="absolute inset-0 w-full h-full object-contain opacity-90 pointer-events-none"
                style={{ filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.4))' }}
              />
            )}
          </div>
        )}
        <div
          className="font-marker text-center leading-tight text-gray-800 break-words"
          style={{
            fontSize: px(currentImage ? 20 : 24),
            paddingLeft: px(8),
            paddingRight: px(8),
            paddingTop: currentImage ? 0 : px(16),
            paddingBottom: currentImage ? 0 : px(16),
          }}
        >
          {photo.caption}
        </div>
      </div>
    );
  }
```

The existing `isSmall`/`normal` class-based path below stays unchanged (still used by the spotlight wall).

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `components/Polaroid.tsx`.

- [ ] **Step 4: Commit**

```bash
git add components/Polaroid.tsx
git commit -m "feat(polaroid): add uniform-scale width prop that preserves ratio"
```

---

## Task 6: wall-6 consumes settings

**Files:**
- Modify: `components/DisplayViewGrid.tsx`

- [ ] **Step 1: Import settings service + type**

In `components/DisplayViewGrid.tsx`, update the imports (lines 3-4):

```tsx
import { getPhotos, subscribeToUpdates, subscribeToDelete, getWallSettings, subscribeToSettings } from '../services/storageService';
import { PhotoEntry, WallSettings, WALL_SETTINGS_DEFAULTS } from '../types';
```

- [ ] **Step 2: Add `polaroidWidth` prop to MarqueeColumn**

In `components/DisplayViewGrid.tsx`, extend the `MarqueeColumn` props type (lines 13-19) to add `polaroidWidth`:

```tsx
const MarqueeColumn: React.FC<{
  photos: PhotoEntry[],
  speed?: number,
  delay?: number,
  newIds?: Set<string>,
  onEntrancePlayed?: (id: string) => void,
  polaroidWidth: number
}> = ({ photos, speed = 0.5, delay = 0, newIds, onEntrancePlayed, polaroidWidth }) => {
```

Then in `MarqueeColumn`'s JSX, replace the `<Polaroid>` element (lines 181-185) with:

```tsx
                <Polaroid
                  photo={photo}
                  width={polaroidWidth}
                  className="hover:z-10 transition-transform hover:scale-105 hover:rotate-0 shadow-lg"
                />
```

- [ ] **Step 3: Replace the responsive column state with a settings-aware version**

In `DisplayViewGrid`, replace the `numCols` state declaration (line 197):

```tsx
  const [responsiveCols, setResponsiveCols] = useState(6);
  const [settings, setSettings] = useState<WallSettings>(WALL_SETTINGS_DEFAULTS);
```

Then replace the resize effect (lines 205-218) with the extended ladder (top end raised so caps above 6 are reachable on ultra-wide screens):

```tsx
  // Handle Responsive Column Count. Ladder is capped later by settings.maxColumns.
  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      if (w >= 2400) setResponsiveCols(8);
      else if (w >= 2100) setResponsiveCols(7);
      else if (w >= 1800) setResponsiveCols(6);
      else if (w >= 1500) setResponsiveCols(5);
      else if (w >= 1200) setResponsiveCols(4);
      else if (w >= 900) setResponsiveCols(3);
      else if (w >= 600) setResponsiveCols(2);
      else setResponsiveCols(1);
    };
    handleResize(); // Init
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const numCols = Math.min(settings.maxColumns, responsiveCols);
```

- [ ] **Step 4: Load settings + subscribe to live updates**

In `DisplayViewGrid`, add a new effect right after the resize effect from Step 3:

```tsx
  // Load wall settings and keep them live.
  useEffect(() => {
    getWallSettings().then(setSettings);
    const unsubscribe = subscribeToSettings(setSettings);
    return unsubscribe;
  }, []);
```

- [ ] **Step 5: Pass polaroidWidth to each column**

In `DisplayViewGrid`'s JSX, update the `<MarqueeColumn>` usage (lines 345-351) to pass the width:

```tsx
                   <MarqueeColumn
                      photos={colPhotos}
                      speed={0.5}
                      delay={colIndex * 2}
                      newIds={newIds}
                      onEntrancePlayed={handleEntrancePlayed}
                      polaroidWidth={settings.polaroidWidth}
                   />
```

- [ ] **Step 6: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `components/DisplayViewGrid.tsx`.

- [ ] **Step 7: Commit**

```bash
git add components/DisplayViewGrid.tsx
git commit -m "feat(wall-6): apply admin column cap and polaroid size settings"
```

---

## Task 7: Admin settings panel

**Files:**
- Modify: `components/AdminView.tsx`

- [ ] **Step 1: Update imports**

In `components/AdminView.tsx`, update the service import (line 2) and add `useRef` + types:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { getPhotos, deletePhoto, subscribeToUpdates, subscribeToDelete, downloadAllPhotos, getWallSettings, saveWallSettings, subscribeToSettings } from '../services/storageService';
import { PhotoEntry, WallSettings, WALL_SETTINGS_DEFAULTS, WALL_SETTINGS_BOUNDS } from '../types';
```

- [ ] **Step 2: Add settings state and handlers**

In `AdminView`, after the existing `useState` declarations (after line 11, `const { showToast } = useToast();`), add:

```tsx
  const [settings, setSettings] = useState<WallSettings>(WALL_SETTINGS_DEFAULTS);
  const saveTimer = useRef<number>();
```

Then, after the existing auth `useEffect` (after line 33), add a settings effect and handlers:

```tsx
  useEffect(() => {
    if (!isAuthenticated) return;
    getWallSettings().then(setSettings);
    const unsubscribe = subscribeToSettings(setSettings);
    return unsubscribe;
  }, [isAuthenticated]);

  const persistSettings = (next: WallSettings) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveWallSettings(next);
    }, 300);
  };

  const updateSettings = (patch: Partial<WallSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      persistSettings(next);
      return next;
    });
  };

  const handleResetSettings = () => {
    window.clearTimeout(saveTimer.current);
    setSettings(WALL_SETTINGS_DEFAULTS);
    saveWallSettings(WALL_SETTINGS_DEFAULTS);
  };
```

- [ ] **Step 3: Render the settings panel**

In `AdminView`, in the authenticated return block, insert the panel between the `</header>` (line 110) and the photo grid `<div>` (line 112):

```tsx
      <section className="max-w-6xl mx-auto mb-8 bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Wall-6 Display Settings</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm text-zinc-400">Columns (max): {settings.maxColumns}</span>
            <input
              type="number"
              min={WALL_SETTINGS_BOUNDS.maxColumns.min}
              max={WALL_SETTINGS_BOUNDS.maxColumns.max}
              value={settings.maxColumns}
              onChange={(e) => updateSettings({ maxColumns: Number(e.target.value) })}
              className="mt-2 w-full bg-zinc-950 text-white border border-zinc-700 rounded-lg p-2 focus:border-blue-500 outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm text-zinc-400">Polaroid size: {settings.polaroidWidth}px</span>
            <input
              type="range"
              min={WALL_SETTINGS_BOUNDS.polaroidWidth.min}
              max={WALL_SETTINGS_BOUNDS.polaroidWidth.max}
              value={settings.polaroidWidth}
              onChange={(e) => updateSettings({ polaroidWidth: Number(e.target.value) })}
              className="mt-4 w-full accent-blue-600"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={handleResetSettings}
          className="mt-4 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          Reset to defaults
        </button>
      </section>
```

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `components/AdminView.tsx`.

- [ ] **Step 5: Commit**

```bash
git add components/AdminView.tsx
git commit -m "feat(admin): add wall-6 column and polaroid size controls"
```

---

## Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the app**

Run: `npm run dev`
This starts the API (`:3000`) and Vite. Note the Vite URL (typically `http://localhost:5173`).

- [ ] **Step 2: Verify live column + size changes**

Open two tabs: `#/wall-6` and `#/admin` (log in with password `admin`). Upload at least one photo if the wall is empty (via `#/` on a phone or the same origin).

In the admin tab:
- Drag the **Polaroid size** slider up → the wall-6 polaroids grow **uniformly** (border, tape, and caption scale with the photo; the card keeps its shape — it does not just widen the photo). No refresh needed.
- Change **Columns (max)** to `2` → wall-6 shows at most 2 columns. Set back to `6`.
- Click **Reset to defaults** → columns return to 6, size to 180px on both admin and wall.

Use the preview tools to confirm: `preview_screenshot` of `/wall-6` after a size change, and `preview_inspect` on a polaroid card to confirm its computed `width` matches the slider value.

- [ ] **Step 3: Verify persistence (only meaningful with disk cache on)**

If running with `ENABLE_DISK_CACHE=true` and a writable `UPLOAD_DIR`, set a non-default size/columns, restart the server, and reload `/wall-6` — the chosen settings persist. (Without disk cache, settings reset to defaults on restart by design.)

- [ ] **Step 4: Run the full test + typecheck gate**

Run: `npm test`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Final commit (if any verification tweaks were needed)**

```bash
git add -A
git commit -m "chore: verify wall-6 admin customization end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** Sync model (Tasks 2, 4, 6); columns cap + responsive (Task 6); polaroid uniform scale (Task 5); slider/stepper/reset (Task 7); server persistence + broadcast (Task 2); validation/clamping tests (Task 1); manual/preview verification (Task 8). No gaps.
- **Type consistency:** `WallSettings { maxColumns, polaroidWidth }`, `WALL_SETTINGS_DEFAULTS`, `WALL_SETTINGS_BOUNDS`, `normalizeWallSettings`, `getWallSettings`, `saveWallSettings`, `subscribeToSettings`, and the `settings_update` socket event are named identically across all tasks.
- **Known non-issue:** the admin number input can briefly hold an out-of-range value while typing; the server clamps on PUT and the `settings_update` broadcast (received by the admin's own subscription) corrects the field.
```
