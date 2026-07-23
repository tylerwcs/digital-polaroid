import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getPhotos, subscribeToUpdates, subscribeToDelete } from '../services/storageService';
import { PhotoEntry } from '../types';
import { Bubble } from './Bubble';
import { useBubblePhysics } from '../hooks/useBubblePhysics';
import { GRID, computeGridRadius, pickSpawnPosition, randomInRange } from '../lib/bubblePhysics';

/**
 * DisplayViewGrid — the "/wall-6" display.
 *
 * A denser sibling of the /wall bubble wall (DisplayView). Key differences:
 *  - Holds many more bubbles (GRID.MAX_BUBBLES, default 20) instead of 8.
 *  - No spotlight: a new photo simply "pops" into the roomiest empty spot.
 *  - Bubbles resize dynamically as the count changes so the wall stays "filled".
 *  - Same drifting + bouncing physics as /wall (shared useBubblePhysics loop).
 */
const POP_MS = 500;

const DisplayViewGrid: React.FC = () => {
  const physics = useBubblePhysics();
  const [photoMap, setPhotoMap] = useState<Map<string, PhotoEntry>>(new Map());
  const [uploadUrl, setUploadUrl] = useState<string>('');
  // Ids currently animating their scale from 0 -> 1 (the "pop" on arrival).
  const [growingIds, setGrowingIds] = useState<Set<string>>(new Set());

  const physicsRef = useRef(physics);
  useEffect(() => { physicsRef.current = physics; });

  // Upload URL for the QR (points at the download page, matching /wall).
  useEffect(() => {
    const explicit = import.meta.env.VITE_UPLOAD_URL as string | undefined;
    if (explicit) setUploadUrl(explicit);
    else if (typeof window !== 'undefined') setUploadUrl(window.location.origin);
  }, []);

  // Live (non-exiting) bubbles — the ones that count toward sizing & capacity.
  const liveBubbles = () => physicsRef.current.bubbles.filter((b) => b.lifecycle !== 'exiting');

  // Spawn a bubble with a "pop" (scale 0 -> 1). Shared radius keeps the wall filled.
  const popIn = (photo: PhotoEntry, x: number, y: number, radius: number) => {
    const id = physicsRef.current.spawn({
      photoId: photo.id,
      x,
      y,
      radius,
      vx: randomInRange(-0.3, 0.3),
      vy: randomInRange(-0.3, 0.3),
    });
    // Start scaled to 0, then release on the next frame so the transition runs.
    setGrowingIds((prev) => new Set(prev).add(id));
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        setGrowingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        })
      )
    );
    return id;
  };

  // Add one new photo to the wall: resize the field for the new count, evict the
  // oldest if we're at capacity, then pop the newcomer into the roomiest spot.
  const addPhoto = (photo: PhotoEntry) => {
    const container = physicsRef.current.containerRef.current;
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;

    const live = liveBubbles();
    const atCapacity = live.length >= GRID.MAX_BUBBLES;

    // Resulting live count after this insertion (eviction keeps it at the cap).
    const targetCount = atCapacity ? GRID.MAX_BUBBLES : live.length + 1;
    const radius = computeGridRadius(w, h, targetCount);

    if (atCapacity) {
      // Evict the oldest bubble (smallest spawnTime) with a pop-out. Do this
      // before resizeAll so the departing bubble keeps its size as it shrinks away.
      const oldest = [...live].sort((a, b) => a.spawnTime - b.spawnTime)[0];
      if (oldest) {
        physicsRef.current.markExiting(oldest.id);
        setTimeout(() => physicsRef.current.remove(oldest.id), 600);
      }
    }

    // Resize the remaining (non-exiting) bubbles to the new shared size.
    physicsRef.current.resizeAll(radius);

    const pos = pickSpawnPosition(w, h, radius, live.map((b) => ({ x: b.x, y: b.y })));
    popIn(photo, pos.x, pos.y, radius);
  };

  // Re-fit remaining bubbles after a removal so the wall grows back to "filled".
  const refitAfterRemoval = () => {
    const container = physicsRef.current.containerRef.current;
    if (!container) return;
    const count = liveBubbles().length;
    if (count === 0) return;
    const radius = computeGridRadius(container.clientWidth, container.clientHeight, count);
    physicsRef.current.resizeAll(radius);
  };

  // Initial load — spawn the most recent photos (up to the cap) at a shared size.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const loaded = await getPhotos();
      if (cancelled) return;

      const map = new Map<string, PhotoEntry>();
      loaded.forEach((p) => map.set(p.id, p));
      setPhotoMap(map);

      // Most recent first, capped.
      const sorted = [...loaded].sort((a, b) => b.timestamp - a.timestamp);
      const top = sorted.slice(0, GRID.MAX_BUBBLES);

      requestAnimationFrame(() => {
        const container = physicsRef.current.containerRef.current;
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        const radius = computeGridRadius(w, h, top.length);
        const placed: { x: number; y: number }[] = [];
        for (const p of top) {
          const pos = pickSpawnPosition(w, h, radius, placed);
          placed.push(pos);
          popIn(p, pos.x, pos.y, radius);
        }
      });
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Live subscriptions — subscribe once; read physics via ref.
  useEffect(() => {
    const unsub = subscribeToUpdates((newPhoto) => {
      setPhotoMap((m) => {
        const next = new Map(m);
        next.set(newPhoto.id, newPhoto);
        return next;
      });
      addPhoto(newPhoto);
    });
    const unsubDel = subscribeToDelete((deletedId) => {
      setPhotoMap((m) => {
        const next = new Map(m);
        next.delete(deletedId);
        return next;
      });
      const target = physicsRef.current.bubbles.find((b) => b.photoId === deletedId);
      if (target) {
        physicsRef.current.markExiting(target.id);
        setTimeout(() => {
          physicsRef.current.remove(target.id);
          refitAfterRemoval();
        }, 600);
      }
    });
    return () => { unsub(); unsubDel(); };
  }, []);

  // On viewport resize, re-fit bubbles to the new container size.
  useEffect(() => {
    const onResize = () => refitAfterRemoval();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Background video: two elements crossfading at each loop point for a seamless
  // loop (mirrors DisplayView so /wall-6 matches /wall visually).
  const VIDEO_FADE_MS = 1500;
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const [activeVideo, setActiveVideo] = useState<'A' | 'B'>('A');
  const [crossfading, setCrossfading] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  const handleVideoTimeUpdate = (which: 'A' | 'B') => () => {
    if (which !== activeVideo || crossfading) return;
    const el = which === 'A' ? videoARef.current : videoBRef.current;
    const other = which === 'A' ? videoBRef.current : videoARef.current;
    if (!el || !other || !isFinite(el.duration) || el.duration === 0) return;
    const remaining = el.duration - el.currentTime;
    if (remaining < VIDEO_FADE_MS / 1000) {
      try { other.currentTime = 0; } catch { /* ignore seek failures */ }
      other.play().catch(() => { /* autoplay retry next loop */ });
      setCrossfading(true);
    }
  };

  const handleVideoEnded = (which: 'A' | 'B') => () => {
    if (which !== activeVideo) return;
    setActiveVideo(which === 'A' ? 'B' : 'A');
    setCrossfading(false);
  };

  const videoLayer = (which: 'A' | 'B'): { opacity: number; zIndex: number } => {
    const isActive = activeVideo === which;
    if (!videoReady) return { opacity: 0, zIndex: 0 };
    if (crossfading) {
      return isActive ? { opacity: 1, zIndex: 0 } : { opacity: 1, zIndex: 1 };
    }
    return isActive ? { opacity: 1, zIndex: 1 } : { opacity: 0, zIndex: 0 };
  };
  const aLayer = videoLayer('A');
  const bLayer = videoLayer('B');

  return (
    <div className="h-screen w-screen overflow-hidden relative text-white bg-black">
      {/* Background video layer (z-0), isolated so its internal z-index juggling
          can't rise above the bubbles. */}
      <div className="absolute inset-0 z-0" style={{ isolation: 'isolate' }} aria-hidden>
        <video
          ref={videoARef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity ease-in-out"
          style={{ opacity: aLayer.opacity, zIndex: aLayer.zIndex, transitionDuration: `${VIDEO_FADE_MS}ms` }}
          src="/bubbleBG.mp4"
          autoPlay
          muted
          playsInline
          preload="auto"
          onPlaying={() => setVideoReady(true)}
          onTimeUpdate={handleVideoTimeUpdate('A')}
          onEnded={handleVideoEnded('A')}
        />
        <video
          ref={videoBRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity ease-in-out"
          style={{ opacity: bLayer.opacity, zIndex: bLayer.zIndex, transitionDuration: `${VIDEO_FADE_MS}ms` }}
          src="/bubbleBG.mp4"
          muted
          playsInline
          preload="auto"
          onTimeUpdate={handleVideoTimeUpdate('B')}
          onEnded={handleVideoEnded('B')}
        />
      </div>

      {/* Bubble wall container (z-1). */}
      <div ref={physics.containerRef} className="absolute inset-0 z-[1]">
        {physics.bubbles.map((b) => {
          const photo = photoMap.get(b.photoId) ?? null;
          const exiting = b.lifecycle === 'exiting';
          const growing = growingIds.has(b.id);
          return (
            <div
              key={b.id}
              ref={(el) => physics.registerBubbleEl(b.id, el)}
              className="absolute top-0 left-0 will-change-transform"
              style={{
                transform: `translate3d(${b.x - b.radius}px, ${b.y - b.radius}px, 0)`,
                // Scale/opacity transition only — position (transform) stays instant
                // so the physics loop drives motion without lag. `scale` is a
                // separate CSS property, so the per-frame transform never wipes it.
                transition: exiting
                  ? `opacity 600ms ease-in, scale 600ms ease-in`
                  : `scale ${POP_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
                opacity: exiting ? 0 : 1,
                scale: exiting ? '0' : growing ? '0' : '1',
              }}
            >
              <Bubble photo={photo} diameter={b.radius * 2} />
            </div>
          );
        })}

        {physics.bubbles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Bubble
              photo={null}
              diameter={Math.min(window.innerWidth, window.innerHeight) * 0.3}
              placeholderText="Scan the QR to add a photo"
            />
          </div>
        )}
      </div>

      {/* QR (scan to download) — matches /wall. */}
      <div className="absolute bottom-12 right-8 z-30 flex flex-col items-center gap-4">
        {uploadUrl && (
          <div className="bg-white p-3 rounded-xl shadow-2xl border border-black/10">
            <QRCodeSVG value={`${uploadUrl}/#/download`} size={100} level="H" bgColor="#ffffff" fgColor="#000000" />
            <p className="text-center text-xs font-semibold mt-2 text-black">Scan to Download</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DisplayViewGrid;
