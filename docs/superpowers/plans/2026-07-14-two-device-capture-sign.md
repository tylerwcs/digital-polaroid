# Two-Device Capture → Sign → Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the upload flow across two devices — a phone captures the photo, a separate iPad signs it and uploads it to the wall.

**Architecture:** A new in-memory **pending queue** on the server holds photos that have been captured but not yet signed. The phone (`/`) POSTs captures into it; the iPad (`/sign`, new) reads the queue over Socket.IO, signs the oldest photo, and commits it. Commit reuses the *existing* live-photo code path (`photos.unshift` → `new_photo`), so the wall, `/admin`, and `/download` are untouched.

**Tech Stack:** React 19 + react-router-dom (HashRouter), Vite, TypeScript, Tailwind classes, Express 4 + Socket.IO, `react-signature-canvas`. Tests use **Node's built-in test runner** (`node --test`) — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-14-two-device-capture-sign-design.md`

**Branch:** `two-device-capture-sign` (based on `claude/admiring-swirles-1b8625`, the bubble variant)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `server/pendingQueue.js` | **Create.** Pure in-memory queue: add / remove / skip / list / size / isFull. No disk or socket I/O — the caller owns files and broadcasts. This is what makes the logic unit-testable. |
| `server/pendingQueue.test.js` | **Create.** `node:test` unit tests for the queue. |
| `server/package.json` | **Modify.** Add a `test` script. |
| `server/index.js` | **Modify.** Wire the 5 pending routes + socket broadcasts. Commit hands off into the existing live-photo path. |
| `types.ts` | **Modify.** Add `PendingPhoto`. |
| `services/storageService.ts` | **Modify.** Add pending API helpers + socket subscriptions; generalize the URL-absolutizer. |
| `components/SignView.tsx` | **Create.** The iPad signing station. |
| `components/UploadView.tsx` | **Modify.** Remove signing; "Send to iPad" instead of "Send to Wall". |
| `App.tsx` | **Modify.** Add the `/sign` route. |
| `components/AdminView.tsx` | **Modify.** Add a link to the signing station. |

Ordering rationale: server first (Tasks 1–2) so the client has a real API to talk to; then the client transport layer (Task 3); then the two screens (Tasks 4–5); then routing (Task 6); then end-to-end verification (Task 7).

---

## Task 1: Pending queue module (TDD)

The queue is deliberately **pure** — it manages an array and nothing else. File writes and socket emits stay in `index.js`. That keeps this module trivially testable with zero mocks.

Ordering is **oldest-first**: `add()` appends to the tail, and the signing station always works on `items[0]`. `skip()` moves an item to the tail.

**Files:**
- Create: `server/pendingQueue.js`
- Create: `server/pendingQueue.test.js`
- Modify: `server/package.json`

- [ ] **Step 1: Add the test script**

In `server/package.json`, add `"test"` to the `scripts` block so it reads:

```json
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js",
    "test": "node --test"
  },
```

- [ ] **Step 2: Write the failing tests**

Create `server/pendingQueue.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingQueue, sanitizePending, DEFAULT_MAX_PENDING } from './pendingQueue.js';

const makeRecord = (id) => ({
  id,
  imageUrl: `/uploads/${id}.jpg`,
  storageFile: `${id}.jpg`,
  timestamp: Number(id),
  rotation: 0,
});

test('add appends so the queue is oldest-first', () => {
  const queue = createPendingQueue();
  assert.equal(queue.add(makeRecord('1')), true);
  assert.equal(queue.add(makeRecord('2')), true);
  assert.deepEqual(queue.list().map((r) => r.id), ['1', '2']);
  assert.equal(queue.size(), 2);
});

test('add refuses new records once the queue is full', () => {
  const queue = createPendingQueue({ maxPending: 2 });
  queue.add(makeRecord('1'));
  queue.add(makeRecord('2'));

  assert.equal(queue.isFull(), true);
  assert.equal(queue.add(makeRecord('3')), false);
  assert.deepEqual(queue.list().map((r) => r.id), ['1', '2']);
});

test('remove pulls the record out and returns it', () => {
  const queue = createPendingQueue();
  queue.add(makeRecord('1'));
  queue.add(makeRecord('2'));

  const removed = queue.remove('1');
  assert.equal(removed.id, '1');
  assert.equal(removed.storageFile, '1.jpg');
  assert.deepEqual(queue.list().map((r) => r.id), ['2']);
});

test('remove returns null for an unknown id and leaves the queue alone', () => {
  const queue = createPendingQueue();
  queue.add(makeRecord('1'));

  assert.equal(queue.remove('nope'), null);
  assert.equal(queue.size(), 1);
});

test('skip moves the record to the back of the queue', () => {
  const queue = createPendingQueue();
  queue.add(makeRecord('1'));
  queue.add(makeRecord('2'));
  queue.add(makeRecord('3'));

  const skipped = queue.skip('1');
  assert.equal(skipped.id, '1');
  assert.deepEqual(queue.list().map((r) => r.id), ['2', '3', '1']);
});

test('skip on the only record keeps it at the head', () => {
  const queue = createPendingQueue();
  queue.add(makeRecord('1'));

  assert.equal(queue.skip('1').id, '1');
  assert.deepEqual(queue.list().map((r) => r.id), ['1']);
});

test('skip returns null for an unknown id', () => {
  const queue = createPendingQueue();
  queue.add(makeRecord('1'));

  assert.equal(queue.skip('nope'), null);
  assert.deepEqual(queue.list().map((r) => r.id), ['1']);
});

test('list returns a copy so callers cannot mutate internal state', () => {
  const queue = createPendingQueue();
  queue.add(makeRecord('1'));

  const list = queue.list();
  list.push(makeRecord('2'));

  assert.equal(queue.size(), 1);
});

test('sanitizePending drops the server-only storageFile', () => {
  const publicRecord = sanitizePending(makeRecord('1'));

  assert.deepEqual(publicRecord, {
    id: '1',
    imageUrl: '/uploads/1.jpg',
    timestamp: 1,
    rotation: 0,
  });
  assert.equal('storageFile' in publicRecord, false);
});

test('the default cap is 50', () => {
  assert.equal(DEFAULT_MAX_PENDING, 50);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module ... pendingQueue.js`

- [ ] **Step 4: Write the implementation**

Create `server/pendingQueue.js`:

```js
// Photos captured on a phone but not yet signed and sent to the wall.
// Pure list management: no disk or socket I/O, so the caller owns image files
// and broadcasts. Oldest-first — the signing station always works on items[0].

export const DEFAULT_MAX_PENDING = 50;

export const sanitizePending = (record) => ({
  id: record.id,
  imageUrl: record.imageUrl,
  timestamp: record.timestamp,
  rotation: record.rotation,
});

export const createPendingQueue = ({ maxPending = DEFAULT_MAX_PENDING } = {}) => {
  let items = [];

  return {
    size: () => items.length,
    isFull: () => items.length >= maxPending,
    list: () => [...items],

    add: (record) => {
      if (items.length >= maxPending) return false;
      items.push(record);
      return true;
    },

    remove: (id) => {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const [removed] = items.splice(index, 1);
      return removed;
    },

    skip: (id) => {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const [moved] = items.splice(index, 1);
      items.push(moved);
      return moved;
    },
  };
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS — 10 tests passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add server/pendingQueue.js server/pendingQueue.test.js server/package.json
git commit -m "feat(server): add pending photo queue module with tests"
```

---

## Task 2: Wire the pending routes into the server

Adds the 5 endpoints and their socket broadcasts. **Commit reuses the existing live-photo path** — it does not re-decode or rewrite the image file; the pending record's `storageFile` simply becomes the wall photo's file.

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Import the queue and configure the cap**

In `server/index.js`, add the import next to the other local imports (near `import { renderPolaroidPng, canExportPolaroid } from './polaroidExport.js';`):

```js
import { createPendingQueue, sanitizePending, DEFAULT_MAX_PENDING } from './pendingQueue.js';
```

Then, next to the other `const MAX_*` config reads near the top (after `const ENABLE_DISK_CACHE = ...`), add:

```js
const MAX_PENDING = parseInt(process.env.MAX_PENDING || String(DEFAULT_MAX_PENDING), 10);
```

And next to the other in-memory state (after `let photos = [];`), add:

```js
const pendingQueue = createPendingQueue({ maxPending: MAX_PENDING });
```

- [ ] **Step 2: Add a validator for the capture payload**

Directly after the existing `validatePhotoPayload` function, add:

```js
const validatePendingPayload = (entry) => {
  if (!entry || typeof entry.id !== 'string' || !entry.id) {
    return 'Invalid photo payload';
  }
  if (typeof entry.image !== 'string' || !entry.image.startsWith('data:image')) {
    return 'Unsupported image format';
  }
  if (approxBytesFromDataUri(entry.image) > MAX_IMAGE_BYTES) {
    return `Image exceeds ${MAX_IMAGE_MB}MB limit`;
  }
  return null;
};
```

- [ ] **Step 3: Add the five pending routes**

Insert these routes immediately **before** the existing `app.post('/api/export-video', ...)` handler:

```js
// --- Pending queue: photos captured on a phone, awaiting signature on the iPad ---

app.get('/api/pending', (req, res) => {
  res.json(pendingQueue.list().map(sanitizePending));
});

app.post('/api/pending', async (req, res) => {
  const entry = req.body;

  const validationError = validatePendingPayload(entry);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  if (pendingQueue.isFull()) {
    return res.status(429).json({ error: 'Signing queue is full. Please retry shortly.' });
  }

  const decoded = decodeBase64Image(entry.image);
  if (!decoded) {
    return res.status(400).json({ error: 'Malformed image data' });
  }

  const extension = decoded.mime === 'image/png' ? 'png' : 'jpg';
  const storageFile = `${entry.id}.${extension}`;

  try {
    await fs.writeFile(fullImagePath(storageFile), decoded.buffer);

    const record = {
      id: entry.id,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
      rotation: typeof entry.rotation === 'number' ? entry.rotation : (Math.random() * 6 - 3),
      imageUrl: buildImageUrl(storageFile),
      storageFile,
    };

    // Re-check the cap: an await elapsed since isFull() above.
    if (!pendingQueue.add(record)) {
      await deleteFileIfExists(storageFile);
      return res.status(429).json({ error: 'Signing queue is full. Please retry shortly.' });
    }

    const publicRecord = sanitizePending(record);
    io.emit('pending_added', publicRecord);
    return res.status(201).json({ success: true, pending: publicRecord });
  } catch (error) {
    console.error('Pending upload error:', error);
    await deleteFileIfExists(storageFile);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/pending/:id/commit', async (req, res) => {
  try {
    const { signature } = req.body || {};

    if (signature !== undefined && typeof signature !== 'string') {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    if (typeof signature === 'string' && approxBytesFromDataUri(signature) > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: `Signature exceeds ${MAX_IMAGE_MB}MB limit` });
    }

    const record = pendingQueue.remove(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Photo is no longer in the queue' });
    }

    // Hand off into the existing live-photo path. The image file is reused as-is.
    const storedPhoto = {
      id: record.id,
      caption: '',
      timestamp: record.timestamp,
      rotation: record.rotation,
      author: undefined,
      signature: signature || undefined,
      imageUrl: record.imageUrl,
      storageFile: record.storageFile,
    };

    photos.unshift(storedPhoto);
    await trimPhotoHistory();
    scheduleSave();

    const publicPhoto = sanitizePhoto(storedPhoto);
    io.emit('new_photo', publicPhoto);
    io.emit('pending_removed', record.id);

    return res.status(201).json({ success: true, photo: publicPhoto });
  } catch (error) {
    console.error('Pending commit error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/pending/:id', async (req, res) => {
  try {
    const record = pendingQueue.remove(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Photo is no longer in the queue' });
    }

    await deleteFileIfExists(record.storageFile);
    io.emit('pending_removed', record.id);

    return res.json({ success: true });
  } catch (error) {
    console.error('Pending discard error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/pending/:id/skip', (req, res) => {
  const record = pendingQueue.skip(req.params.id);
  if (!record) {
    return res.status(404).json({ error: 'Photo is no longer in the queue' });
  }

  io.emit('pending_reordered', pendingQueue.list().map(sanitizePending));
  return res.json({ success: true });
});
```

- [ ] **Step 4: Verify the server boots and the routes respond**

Start the server:

Run: `cd server && npm start`
Expected: `Server running on http://0.0.0.0:3000`

In a second terminal, confirm the queue starts empty, accepts a capture, and commits it onto the wall:

```bash
# Empty queue
curl -s http://localhost:3000/api/pending
# Expected: []

# A 1x1 pixel JPEG capture
curl -s -X POST http://localhost:3000/api/pending \
  -H 'Content-Type: application/json' \
  -d '{"id":"test1","rotation":0,"timestamp":1,"image":"data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=="}'
# Expected: {"success":true,"pending":{"id":"test1",...}}

# It is now in the queue
curl -s http://localhost:3000/api/pending
# Expected: a 1-element array containing id "test1"

# Commit it (no signature — signature is optional)
curl -s -X POST http://localhost:3000/api/pending/test1/commit \
  -H 'Content-Type: application/json' -d '{}'
# Expected: {"success":true,"photo":{"id":"test1",...}}

# Queue is empty again, and the photo is on the wall
curl -s http://localhost:3000/api/pending
# Expected: []
curl -s http://localhost:3000/api/photos
# Expected: an array containing id "test1"

# Unknown id is a 404
curl -s -X POST http://localhost:3000/api/pending/nope/skip -d '{}' -H 'Content-Type: application/json'
# Expected: {"error":"Photo is no longer in the queue"}
```

Then clean up the test photo so it does not linger on the wall:

```bash
curl -s -X DELETE http://localhost:3000/api/photos/test1
# Expected: {"success":true}
```

Stop the server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(server): add pending queue routes and socket events"
```

---

## Task 3: Client transport layer (types + storageService)

**Files:**
- Modify: `types.ts`
- Modify: `services/storageService.ts`

- [ ] **Step 1: Add the PendingPhoto type**

In `types.ts`, add after the `PhotoEntry` interface:

```ts
export interface PendingPhoto {
  id: string;
  imageUrl: string;   // Resolved URL served by backend
  timestamp: number;
  rotation: number;
}
```

- [ ] **Step 2: Generalize the URL absolutizer**

`toAbsoluteImageUrl` currently only accepts a `PhotoEntry`, but pending records need the same treatment. Make it generic over anything carrying an `imageUrl`.

Note the `as T` casts on the two spread returns: TypeScript cannot prove that `{ ...photo, imageUrl }` is still a `T` when `T` is generic, so without them `tsc` fails with *"Type '{ imageUrl: string; }' is not assignable to type 'T'"*. The casts are safe — spreading `T` and overwriting one known property preserves the shape.

In `services/storageService.ts`, replace the whole existing `toAbsoluteImageUrl` function with:

```ts
const toAbsoluteImageUrl = <T extends { imageUrl?: string }>(photo: T): T => {
  if (!photo?.imageUrl || photo.imageUrl.startsWith('data:')) {
    return photo;
  }

  const apiBase = API_URL.replace(/\/+$/, '');

  const upgradeToHttpsIfNeeded = (url: string) => {
    if (typeof window === 'undefined') return url;
    if (window.location.protocol !== 'https:') return url;
    if (url.startsWith('http://')) {
      return `https://${url.slice('http://'.length)}`;
    }
    return url;
  };

  try {
    let imageUrl = photo.imageUrl.trim();

    if (/^https?:\/\//i.test(imageUrl)) {
      const parsed = new URL(imageUrl);
      // Only rewrite loopback URLs (e.g. bad data from dev). Do not force every absolute
      // URL onto VITE_API_URL — that breaks production when the API host differs from the
      // static site (Render) and would replace a correct API URL with the wrong origin.
      if (isLoopbackHost(parsed.hostname)) {
        const apiOrigin = new URL(apiBase).origin;
        imageUrl = `${apiOrigin}${parsed.pathname}${parsed.search}`;
      }
      return { ...photo, imageUrl: upgradeToHttpsIfNeeded(imageUrl) } as T;
    }

    const absolute = new URL(imageUrl, apiBase).toString();
    return { ...photo, imageUrl: upgradeToHttpsIfNeeded(absolute) } as T;
  } catch {
    return photo;
  }
};
```

- [ ] **Step 3: Import the new type**

In `services/storageService.ts`, change the types import:

```ts
import { PendingPhoto, PhotoEntry } from '../types';
```

- [ ] **Step 4: Add the pending API helpers**

Append to `services/storageService.ts` (before the `compressImage` helper at the bottom):

```ts
export interface SavePendingInput {
  id: string;
  image: string;      // base64 data URL
  rotation: number;
  timestamp: number;
}

export interface PendingResult {
  success: boolean;
  error?: string;
}

const readError = async (res: Response, fallback: string): Promise<string> => {
  try {
    const payload = await res.json();
    if (payload?.error) return payload.error as string;
  } catch {
    // Non-JSON error body; use the fallback
  }
  return fallback;
};

// Phone: hand a freshly captured photo to the signing queue.
export const savePending = async (entry: SavePendingInput): Promise<PendingResult> => {
  try {
    const res = await fetch(`${API_URL}/api/pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });

    if (!res.ok) {
      return { success: false, error: await readError(res, 'Failed to send the photo. Please try again.') };
    }
    return { success: true };
  } catch (e) {
    console.error('Error sending photo to the signing queue', e);
    return { success: false, error: e instanceof Error ? e.message : 'Unable to reach server' };
  }
};

// iPad: current signing queue, oldest first.
export const getPending = async (): Promise<PendingPhoto[]> => {
  try {
    const res = await fetch(`${API_URL}/api/pending`);
    if (!res.ok) throw new Error('Failed to fetch the signing queue');
    const data: PendingPhoto[] = await res.json();
    return data.map(toAbsoluteImageUrl);
  } catch (e) {
    console.error('Failed to load the signing queue', e);
    return [];
  }
};

// iPad: sign off and send to the wall. `signature` is optional.
export const commitPending = async (id: string, signature?: string): Promise<PendingResult> => {
  try {
    const res = await fetch(`${API_URL}/api/pending/${id}/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature }),
    });

    if (!res.ok) {
      return { success: false, error: await readError(res, 'Failed to upload to the wall. Please try again.') };
    }
    return { success: true };
  } catch (e) {
    console.error('Error committing pending photo', e);
    return { success: false, error: e instanceof Error ? e.message : 'Unable to reach server' };
  }
};

// iPad: throw the photo away without sending it to the wall.
export const discardPending = async (id: string): Promise<PendingResult> => {
  try {
    const res = await fetch(`${API_URL}/api/pending/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      return { success: false, error: await readError(res, 'Failed to discard the photo.') };
    }
    return { success: true };
  } catch (e) {
    console.error('Error discarding pending photo', e);
    return { success: false, error: e instanceof Error ? e.message : 'Unable to reach server' };
  }
};

// iPad: push the photo to the back of the queue.
export const skipPending = async (id: string): Promise<PendingResult> => {
  try {
    const res = await fetch(`${API_URL}/api/pending/${id}/skip`, { method: 'POST' });
    if (!res.ok) {
      return { success: false, error: await readError(res, 'Failed to skip the photo.') };
    }
    return { success: true };
  } catch (e) {
    console.error('Error skipping pending photo', e);
    return { success: false, error: e instanceof Error ? e.message : 'Unable to reach server' };
  }
};

export interface PendingSubscribers {
  onAdded: (photo: PendingPhoto) => void;
  onRemoved: (id: string) => void;
  onReordered: (queue: PendingPhoto[]) => void;
}

export const subscribeToPending = (handlers: PendingSubscribers) => {
  const added = (photo: PendingPhoto) => handlers.onAdded(toAbsoluteImageUrl(photo));
  const removed = (id: string) => handlers.onRemoved(id);
  const reordered = (queue: PendingPhoto[]) => handlers.onReordered(queue.map(toAbsoluteImageUrl));

  socket.on('pending_added', added);
  socket.on('pending_removed', removed);
  socket.on('pending_reordered', reordered);

  return () => {
    socket.off('pending_added', added);
    socket.off('pending_removed', removed);
    socket.off('pending_reordered', reordered);
  };
};
```

- [ ] **Step 5: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add types.ts services/storageService.ts
git commit -m "feat(client): add pending queue API helpers and subscriptions"
```

---

## Task 4: SignView — the iPad signing station

Auto-shows the oldest waiting photo (`queue[0]`). The "N waiting" badge counts everything **behind** the current one, and is hidden when N is 0. Skip is disabled when nothing is behind it (skipping the only photo would be a no-op).

The queue is kept in sync entirely through socket events — including for actions this iPad itself takes — with a local filter after a successful commit/discard so the UI advances immediately rather than waiting for the round trip.

Note: `SignableBubble`'s `imageDataUrl` prop is rendered straight into an `<img src>`, so a plain URL works — no change to that component is needed.

**Files:**
- Create: `components/SignView.tsx`

- [ ] **Step 1: Write the component**

Create `components/SignView.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { PendingPhoto } from '../types';
import { useToast } from '../context/ToastContext';
import { BubbleFrame } from './BubbleFrame';
import { SignableBubble, SignableBubbleHandle } from './SignableBubble';
import {
  commitPending,
  discardPending,
  getPending,
  skipPending,
  subscribeToPending,
} from '../services/storageService';

const SignView: React.FC = () => {
  const { showToast } = useToast();
  const signRef = useRef<SignableBubbleHandle>(null);

  const [queue, setQueue] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState(false);

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

    getPending().then((items) => {
      if (active) setQueue(items);
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

  const dropCurrent = (id: string) => setQueue((prev) => prev.filter((p) => p.id !== id));

  const handleUpload = async () => {
    if (!current || busy) return;
    setBusy(true);

    const signature = signRef.current?.getSignature();   // undefined is allowed
    const result = await commitPending(current.id, signature);

    if (result.success) {
      dropCurrent(current.id);
      showToast('Sent to the wall ✨', 'success');
    } else {
      showToast(result.error || 'Could not upload. Check the connection.', 'error');
    }
    setBusy(false);
  };

  const handleDiscard = async () => {
    if (!current || busy) return;
    setBusy(true);

    const result = await discardPending(current.id);
    if (result.success) {
      dropCurrent(current.id);
      showToast('Photo discarded.', 'info');
    } else {
      showToast(result.error || 'Could not discard. Check the connection.', 'error');
    }
    setBusy(false);
  };

  const handleSkip = async () => {
    if (!current || busy || waiting === 0) return;
    setBusy(true);

    const result = await skipPending(current.id);
    if (!result.success) {
      showToast(result.error || 'Could not skip. Check the connection.', 'error');
    }
    // On success the server broadcasts pending_reordered, which updates the queue.
    setBusy(false);
  };

  return (
    <div className="min-h-[100dvh] w-screen bg-black text-white flex flex-col items-center justify-center gap-8 px-4 py-[max(1rem,env(safe-area-inset-top))] overflow-hidden relative">
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
            <SignableBubble
              key={current.id}
              ref={signRef}
              diameter={diameter}
              imageDataUrl={current.imageUrl}
            />

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
              <button
                onClick={handleUpload}
                disabled={busy}
                className="px-8 py-3 rounded-full bg-white text-black font-semibold active:scale-95 transition-transform disabled:opacity-60"
              >
                {busy ? 'Working…' : 'Upload to Wall'}
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

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/SignView.tsx
git commit -m "feat(sign): add iPad signing station view"
```

---

## Task 5: UploadView — phone captures only

Signing moves off the phone. The review stage now shows the plain captured image in a `BubbleFrame` (instead of `SignableBubble`), and the primary button sends to the signing queue. After a successful send the view auto-returns to the camera so the next guest can step up.

**Files:**
- Modify: `components/UploadView.tsx`

- [ ] **Step 1: Replace the file**

Replace the entire contents of `components/UploadView.tsx` with:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { compressImage, savePending } from '../services/storageService';
import { useToast } from '../context/ToastContext';
import { BubbleFrame } from './BubbleFrame';
import { CameraBubble, CameraBubbleHandle } from './CameraBubble';

type Stage = 'camera' | 'review' | 'sending' | 'sent';

const SENT_RESET_MS = 1800;

const UploadView: React.FC = () => {
  const { showToast } = useToast();
  const cameraRef = useRef<CameraBubbleHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('camera');
  const [captured, setCaptured] = useState<string | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);

  // Responsive bubble size: fits a portrait phone without overflowing,
  // leaving room for the controls below.
  const [diameter, setDiameter] = useState(320);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setDiameter(Math.round(Math.max(220, Math.min(w * 0.85, h * 0.55))));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  // After a successful send, drop back to the camera for the next guest.
  useEffect(() => {
    if (stage !== 'sent') return;
    const timer = setTimeout(() => {
      setCaptured(null);
      setCameraFailed(false);
      setStage('camera');
    }, SENT_RESET_MS);
    return () => clearTimeout(timer);
  }, [stage]);

  const handleCameraError = (message: string) => {
    setCameraFailed(true);
    showToast(message + ' Tap to use your camera instead.', 'error');
  };

  const handleShutter = () => {
    const dataUrl = cameraRef.current?.capture();
    if (!dataUrl) {
      showToast('Camera not ready yet — try again.', 'error');
      return;
    }
    setCaptured(dataUrl);
    setStage('review');
  };

  // Native-capture fallback (insecure context / permission denied / no getUserMedia).
  const handleFallbackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const dataUrl = await compressImage(file);
        setCaptured(dataUrl);
        setStage('review');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not process the photo.';
        showToast(msg, 'error');
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRetake = () => {
    setCaptured(null);
    setStage('camera');
  };

  const handleSend = async () => {
    if (!captured) return;
    setStage('sending');

    const result = await savePending({
      id: Date.now().toString(),
      image: captured,
      rotation: Math.random() * 6 - 3,
      timestamp: Date.now(),
    });

    if (result.success) {
      setStage('sent');
    } else {
      showToast(result.error || 'Could not send. Check the connection.', 'error');
      setStage('review');
    }
  };

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
        {/* Bubble area */}
        {stage === 'camera' && !cameraFailed && (
          <CameraBubble ref={cameraRef} diameter={diameter} onError={handleCameraError} />
        )}

        {stage === 'camera' && cameraFailed && (
          <BubbleFrame diameter={diameter}>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-full flex items-center justify-center text-center px-6 text-white"
            >
              Tap to open your camera
            </button>
          </BubbleFrame>
        )}

        {(stage === 'review' || stage === 'sending') && captured && (
          <BubbleFrame diameter={diameter}>
            <img src={captured} alt="" className="w-full h-full object-cover" draggable={false} />
          </BubbleFrame>
        )}

        {stage === 'sent' && (
          <BubbleFrame diameter={diameter}>
            <div className="w-full h-full flex flex-col items-center justify-center text-center gap-2 px-6 text-white">
              <span className="text-2xl font-semibold">Sent to iPad!</span>
              <span className="text-white/70 text-sm">Head over to sign it ✨</span>
            </div>
          </BubbleFrame>
        )}

        {/* Controls */}
        {stage === 'camera' && !cameraFailed && (
          <div className="flex items-center gap-6">
            <button
              onClick={() => cameraRef.current?.flip()}
              className="w-14 h-14 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-2xl active:scale-95 transition-transform"
              aria-label="Flip camera"
            >
              ⟲
            </button>
            <button
              onClick={handleShutter}
              className="w-20 h-20 rounded-full bg-white border-4 border-white/50 active:scale-95 transition-transform"
              aria-label="Take photo"
            />
            <div className="w-14 h-14" /> {/* spacer to keep shutter centered */}
          </div>
        )}

        {stage === 'review' && (
          <div className="flex items-center gap-4">
            <button
              onClick={handleRetake}
              className="px-6 py-3 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              Retake
            </button>
            <button
              onClick={handleSend}
              className="px-8 py-3 rounded-full bg-white text-black font-semibold active:scale-95 transition-transform"
            >
              Send to iPad
            </button>
          </div>
        )}

        {stage === 'sending' && (
          <div className="px-8 py-3 text-white/80">Sending…</div>
        )}
      </div>

      {/* Hidden native-capture fallback input */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileInputRef}
        onChange={handleFallbackFile}
        className="hidden"
      />
    </div>
  );
};

export default UploadView;
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors. (`SignableBubble` is no longer imported here — it is now used only by `SignView`.)

- [ ] **Step 3: Commit**

```bash
git add components/UploadView.tsx
git commit -m "feat(upload): phone captures and hands off to the signing station"
```

---

## Task 6: Route the signing station

**Files:**
- Modify: `App.tsx`
- Modify: `components/AdminView.tsx`

- [ ] **Step 1: Add the /sign route**

In `App.tsx`, add the import alongside the others:

```tsx
import SignView from './components/SignView';
```

And add the route inside `<Routes>`, after the `/` route:

```tsx
          {/* Signing station for the iPad */}
          <Route path="/sign" element={<SignView />} />
```

- [ ] **Step 2: Link to it from the admin header**

In `components/AdminView.tsx`, inside the authenticated `<header>` block, add an anchor before the `Download All Photos` button. The `<div className="flex items-center gap-4">` block becomes:

```tsx
        <div className="flex items-center gap-4">
          <div className="text-zinc-400 text-sm">{photos.length} submissions</div>
          <a
            href="#/sign"
            className="bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Signing Station
          </a>
          <button
            type="button"
            onClick={handleDownloadAll}
            disabled={photos.length === 0 || isDownloading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-400 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {isDownloading ? 'Preparing ZIP...' : 'Download All Photos'}
          </button>
        </div>
```

(The app uses `HashRouter`, so the link target is `#/sign`.)

- [ ] **Step 3: Verify it typechecks and builds**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors; the build succeeds.

- [ ] **Step 4: Commit**

```bash
git add App.tsx components/AdminView.tsx
git commit -m "feat(app): add /sign route and admin link"
```

---

## Task 7: End-to-end verification

The UI has no automated tests (this repo has no client test framework), so drive the real flow across two browser windows.

**Files:** none — verification only.

- [ ] **Step 1: Start the app**

Run: `npm run dev`
Expected: Vite serves the client and the server logs `Server running on http://0.0.0.0:3000`.

- [ ] **Step 2: Run the server unit tests once more**

Run: `cd server && npm test`
Expected: PASS — 10 tests passing.

- [ ] **Step 3: Walk the happy path**

Open three tabs (a phone-sized window for `/`, one for `#/sign`, one for `#/wall`):

1. On `#/` — take a photo, confirm the review stage shows it with **Retake** and **Send to iPad**, then tap **Send to iPad**. Confirm "Sent to iPad!" appears and the view returns to the camera on its own.
2. On `#/sign` — confirm the photo appeared **without a reload**. Sign it, then tap **Upload to Wall**.
3. On `#/wall` — confirm the bubble appears with the signature on it.

- [ ] **Step 4: Check the queue behaviors**

1. Send **three** photos from `#/`. On `#/sign`, confirm the badge reads **"2 waiting"** and the *oldest* photo is showing.
2. Tap **Skip** — confirm it advances to the next photo and the skipped one returns at the back of the line.
3. Tap **Discard** on one — confirm it disappears and does **not** appear on `#/wall`.
4. Upload the rest — confirm the badge disappears and the empty state reads **"All caught up"**.
5. Confirm **Upload to Wall** works with **no signature drawn** (signature is optional).
6. While a signature is half-drawn on `#/sign`, send another photo from `#/` — confirm the in-progress signature is **not** interrupted.

- [ ] **Step 5: Commit any fixes**

If any behavior above is wrong, fix it and commit. If everything passes, there is nothing to commit for this task.

---

## Notes / deliberately out of scope

- The pending queue is **in-memory only**. A server restart drops unsigned pending photos (accepted in the spec; the event is short-lived).
- Orphaned image files can linger if the server crashes between a capture write and its commit/discard. A startup sweep was considered and deliberately left out.
- No caption entry on the phone, and no device pairing — one shared queue, per the spec.
