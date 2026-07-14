# Two-Device Capture → Sign → Wall

**Date:** 2026-07-14
**Branch:** `claude/admiring-swirles-1b8625` (bubble variant)
**Status:** Approved — ready for implementation plan

## Summary

Split the current single-device upload flow into two devices:

1. **Phone** takes the photo (camera + review).
2. **iPad** receives the photo, the guest signs it, and the operator uploads it to the wall.

Today `UploadView` does camera → review + sign → send, all on one device. This
change introduces a **pending photo** — a photo that exists after capture but
before it is committed to the live wall — plus a shared queue that hands photos
from any phone to a single iPad signing station.

## Goals

- Phone: capture and review only; no signing.
- iPad: a signing station that auto-shows the oldest waiting photo, lets the
  guest sign, and lets the operator upload / discard / skip.
- Keep the live wall (`/wall`, `/wall-6`), `/admin`, and `/download` behavior
  unchanged. A photo only enters the live-wall world at the commit step.

## Non-Goals

- No device pairing, pairing codes, or per-photo handoff links — a single shared
  pending queue is used (1 phone-side capture flow feeding 1 iPad station is the
  expected setup; multiple phones into the one queue also works).
- No caption entry (deferred; not requested).
- No persistence of the pending queue across server restarts.

## Architecture (Approach A: separate pending queue)

A parallel in-memory `pending[]` list lives alongside the existing `photos[]` on
the server, with its own endpoints and socket events. The existing live-wall path
(`photos[]`, `GET /api/photos`, `new_photo`, `download-all`, `trimPhotoHistory`)
is **untouched**. A photo crosses into that world only at the **commit** step,
which reuses the existing "put a photo on the wall" code.

### Routes & components

| Route | Device | Component | Change |
|-------|--------|-----------|--------|
| `/` | Phone | `UploadView` | Modified: `camera → review → sent`. Signing removed. |
| `/sign` | iPad | `SignView` | **New**: signing station. Plain route, no gate. Linked from `/admin`. |
| `/wall`, `/wall-6` | Big screen | `DisplayView*` | Unchanged. |
| `/admin` | Operator | `AdminView` | Add a link to `/sign`. |
| `/download` | — | `DownloadView` | Unchanged. |

`CameraBubble` and `SignableBubble` are reused as-is. `SignView` reuses
`SignableBubble` for the sign UI.

## Data model

A pending record mirrors a photo but is not yet on the wall and has no signature:

```
PendingPhoto = {
  id: string;
  imageUrl: string;   // resolved URL to the stored image file
  timestamp: number;
  rotation: number;
}
```

Server-side, the full pending record additionally holds `storageFile` (the file
on disk), consistent with how `photos[]` records work today.

- On arrival, the captured image (base64) is decoded and written to a file using
  the existing decode-and-store logic, so the iPad loads it by **URL** rather
  than shipping large base64 over the socket.
- `pending[]` is **in-memory only** — never written to `photos.json` / disk
  cache. A server restart drops unsigned pending photos (acceptable, event-scoped).

## Phone flow (`UploadView`, modified)

`camera → review → sent`

1. Capture with `CameraBubble` (unchanged).
2. **Review** stage shows the captured shot with **Retake** and **Send to iPad**.
   The `SignableBubble` and signature ref are removed from this view; the plain
   captured image is shown instead.
3. **Send to iPad** calls `POST /api/pending` with `{ id, image, rotation }`.
4. On success: brief **"Sent to iPad ✨"** confirmation, then auto-return to the
   camera for the next person.
5. On failure: existing error toast; stay on review to retry.

The native-capture fallback (insecure context / permission denied) path is
preserved — it feeds the same review stage.

## iPad flow (`SignView`, new)

1. On load: `GET /api/pending` for the current queue, then subscribe to socket
   events (`pending_added`, `pending_removed`, `pending_reordered`).
2. **Auto-show oldest** waiting photo. A small **"N waiting"** badge shows the
   remaining count. New arrivals while signing wait in line and do **not**
   interrupt the in-progress signature.
3. Render the current photo in `SignableBubble`. Controls:
   - **Clear** — wipe signature strokes (existing `SignableBubble.clear()`).
   - **Discard** — `DELETE /api/pending/:id`; removes from queue, deletes the
     file, advances to next.
   - **Skip** — `POST /api/pending/:id/skip`; moves it to the back of the queue,
     advances to next.
   - **Upload to Wall** — reads `getSignature()` (**optional** — empty allowed)
     and calls commit.
4. Empty state when the queue is drained: **"All caught up — waiting for the next
   photo."**

Signature is **optional**: "Upload to Wall" is always enabled.

## Commit (handoff into the existing wall)

`POST /api/pending/:id/commit` with `{ signature }`:

1. Look up the pending record (already has its stored image `storageFile`).
2. Build a live photo record from it + `signature`, then reuse the **existing**
   live-photo path: `photos.unshift(record)`, `trimPhotoHistory()`,
   `scheduleSave()`, `io.emit('new_photo', sanitized)`.
3. Remove it from `pending[]` and `io.emit('pending_removed', id)`.
4. The image file is **reused** — not re-decoded or rewritten — it simply becomes
   the wall photo's file.

The wall already listens for `new_photo`, so it updates with no changes.

## Endpoints & socket events (new)

| Endpoint | Method | Action | Emits |
|----------|--------|--------|-------|
| `/api/pending` | POST | Phone adds a capture. Validated with the existing image-size limits; rejected with `429` when the queue is at `MAX_PENDING`. | `pending_added` |
| `/api/pending` | GET | iPad fetches the current queue (sanitized, oldest-first order). | — |
| `/api/pending/:id/commit` | POST | Attach signature, move to the live wall. `404` if the id is gone. | `new_photo`, `pending_removed` |
| `/api/pending/:id` | DELETE | Discard. Deletes the file. `404` if gone. | `pending_removed` |
| `/api/pending/:id/skip` | POST | Move to the back of the queue. `404` if gone. | `pending_reordered` |

Queue ordering is oldest-first. `GET /api/pending` and `pending_reordered`
convey the authoritative order; the iPad renders the head of the list.

### storageService helpers (new)

- `savePending(entry)` → `POST /api/pending`
- `getPending()` → `GET /api/pending`
- `commitPending(id, signature)` → `POST /api/pending/:id/commit`
- `discardPending(id)` → `DELETE /api/pending/:id`
- `skipPending(id)` → `POST /api/pending/:id/skip`
- `subscribeToPending({ onAdded, onRemoved, onReordered })` — socket subscriptions

## Configuration

- `MAX_PENDING` (env, default e.g. 50): cap on the pending queue; `POST /api/pending`
  returns `429` when full so a runaway phone cannot exhaust disk.
- Reuses existing `MAX_IMAGE_MB` / `JSON_BODY_LIMIT_MB` validation for the capture
  payload.

## Edge cases

- **Double action / two iPads:** commit/discard/skip on an already-gone id returns
  `404`; the iPad refetches `GET /api/pending` and re-renders. Works even though a
  single station is expected.
- **Queue cap reached:** `POST /api/pending` → `429`; phone shows the existing
  busy/error toast and stays on review to retry.
- **Phone offline after capture:** existing error toast; stays on review to retry.
- **Orphan image files** (crash after write, before discard/commit): minor disk
  residue. Optional startup sweep of pending files — noted, out of scope unless
  requested.

## Testing

- **Server (pending queue):** add → appears in `GET /api/pending`; commit → moves
  to `photos[]` + `new_photo` emitted + removed from pending; discard → removed +
  file deleted; skip → reordered to back; `404` on unknown id; `429` at cap.
- **storageService:** helpers hit the right endpoints and shape payloads correctly.
- **Manual end-to-end:** phone capture → appears on iPad → sign → Upload to Wall →
  bubble appears on `/wall`; discard and skip behave; "N waiting" badge counts
  correctly under concurrent captures.

## Out of scope / future

- Caption entry on the phone.
- Pairing / multi-station isolation.
- Persisting the pending queue across restarts.
