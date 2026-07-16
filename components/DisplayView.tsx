import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getPhotos, subscribeToUpdates, subscribeToDelete } from '../services/storageService';
import { PhotoEntry } from '../types';
import { Bubble } from './Bubble';
import { DebugPanel } from './DebugPanel';
import { SparkleBurst } from './SparkleBurst';
import { useBubblePhysics } from '../hooks/useBubblePhysics';
import { PHYSICS, computeSpawnRadius, randomInRange } from '../lib/bubblePhysics';

type SpotlightState = 'idle' | 'entering' | 'visible' | 'exiting';

// Spotlight bounce-in tuning.
const ENTER_MS = 1300;          // rise-from-bottom → settle duration
// Featured dwell before handing off to the wall. Must stay >= the SparkleBurst
// lifetime (~2.2s): the sparkle is unmounted when the spotlight leaves `visible`
// after HOLD_MS, so a shorter value would cut the burst off mid-animation.
const HOLD_MS = 3000;
// Gentle single overshoot ("subtle" bounce). translateY eases from the bottom to
// center, overshoots slightly PAST center, and settles — the bubble is never scaled.
const ENTER_EASE_BOUNCE = 'cubic-bezier(0.34, 1.28, 0.64, 1)';

const DisplayView: React.FC = () => {
  const physics = useBubblePhysics();
  const [photoMap, setPhotoMap] = useState<Map<string, PhotoEntry>>(new Map());
  const [queue, setQueue] = useState<PhotoEntry[]>([]);
  const [uploadUrl, setUploadUrl] = useState<string>('');

  // Spotlight state (used in next task)
  const [spotlightPhoto, setSpotlightPhoto] = useState<PhotoEntry | null>(null);
  const [spotlightState, setSpotlightState] = useState<SpotlightState>('idle');
  const [spotlightReady, setSpotlightReady] = useState(false);
  const spotlightPhotoRef = useRef<PhotoEntry | null>(null);
  useEffect(() => { spotlightPhotoRef.current = spotlightPhoto; }, [spotlightPhoto]);

  const physicsRef = useRef(physics);
  useEffect(() => { physicsRef.current = physics; });

  const handoffRef = useRef<{ x: number; y: number; radius: number } | null>(null);
  // Bubble evicted to make room for the incoming one. Its physical removal is done
  // by the 'exiting' timer below rather than a timer of its own: setSpotlightState
  // re-runs this effect, and the cleanup would cancel any timer scheduled here,
  // leaving the bubble in the array forever (invisible) and letting the wall grow
  // past MAX_BUBBLES.
  const evictIdRef = useRef<string | null>(null);

  // Upload URL
  useEffect(() => {
    const explicit = import.meta.env.VITE_UPLOAD_URL as string | undefined;
    if (explicit) setUploadUrl(explicit);
    else if (typeof window !== 'undefined') setUploadUrl(window.location.origin);
  }, []);

  // Spawn an initial bubble for a photo at a random non-overlapping-ish position.
  // (We accept some overlap on initial load; physics resolves it within a second.)
  const spawnInitial = (photo: PhotoEntry, container: HTMLDivElement) => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const radius = computeSpawnRadius(w, h);
    const x = randomInRange(radius, w - radius);
    const y = randomInRange(radius, h - radius);
    const vx = randomInRange(-0.2, 0.2);
    const vy = randomInRange(-0.2, 0.2);
    physicsRef.current.spawn({ photoId: photo.id, x, y, radius, vx, vy });
  };

  // Debug: clear all bubbles and re-spawn them from photoMap using current sizing.
  const respawnAll = () => {
    const container = physicsRef.current.containerRef.current;
    if (!container) return;
    // Remove every current bubble immediately
    for (const b of [...physicsRef.current.bubbles]) {
      physicsRef.current.remove(b.id);
    }
    // Re-spawn from photoMap (most recent first), up to MAX_BUBBLES
    const photos: PhotoEntry[] = Array.from(photoMap.values());
    photos.sort((a, b) => b.timestamp - a.timestamp);
    const top = photos.slice(0, PHYSICS.MAX_BUBBLES);
    requestAnimationFrame(() => {
      for (const p of top) spawnInitial(p, container);
    });
  };

  // Initial load
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const loaded = await getPhotos();
      if (cancelled) return;
      const map = new Map<string, PhotoEntry>();
      loaded.forEach((p) => map.set(p.id, p));
      setPhotoMap(map);

      // "isNew within 15s" check: if the most recent photo was uploaded in the
      // last 15s, route it through the spotlight instead of spawning directly.
      // This preserves the UX where a user uploads and immediately opens /wall.
      const latest = loaded[0];
      const isNew = latest && (Date.now() - latest.timestamp < 15000);
      const toSpawn = isNew ? loaded.slice(1, PHYSICS.MAX_BUBBLES + 1) : loaded.slice(0, PHYSICS.MAX_BUBBLES);

      requestAnimationFrame(() => {
        const container = physics.containerRef.current;
        if (!container) return;
        for (const p of toSpawn) spawnInitial(p, container);
      });

      if (isNew) {
        // Queue the latest so the existing queue processor picks it up
        setQueue((prev) => [...prev, latest]);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Websocket subscriptions — subscribe ONCE on mount; read physics via ref to avoid re-subscribing
  useEffect(() => {
    const unsub = subscribeToUpdates((newPhoto) => {
      setPhotoMap((m) => {
        const next = new Map(m);
        next.set(newPhoto.id, newPhoto);
        return next;
      });
      setQueue((prev) => [...prev, newPhoto]);
    });
    const unsubDel = subscribeToDelete((deletedId) => {
      setPhotoMap((m) => {
        const next = new Map(m);
        next.delete(deletedId);
        return next;
      });
      setQueue((prev) => prev.filter((p) => p.id !== deletedId));
      // Remove any bubble with this photoId (read live state via ref). markExiting
      // only plays the pop — without the follow-up remove the bubble would sit in
      // the array forever, invisible. This effect's cleanup runs on unmount only,
      // so nothing cancels this timer.
      const target = physicsRef.current.bubbles.find((b) => b.photoId === deletedId);
      if (target) {
        physicsRef.current.markExiting(target.id);
        window.setTimeout(() => physicsRef.current.remove(target.id), 600);
      }
      if (spotlightPhotoRef.current?.id === deletedId) {
        setSpotlightState('exiting');
      }
    });
    return () => { unsub(); unsubDel(); };
  }, []);

  // Queue processor: pull next photo into spotlight when idle
  useEffect(() => {
    if (queue.length > 0 && spotlightState === 'idle') {
      setSpotlightPhoto(queue[0]);
      setQueue((prev) => prev.slice(1));
      setSpotlightState('entering');
    }
  }, [queue, spotlightState]);

  // Spotlight state machine + handoff
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;

    if (spotlightState === 'entering') {
      // Give the browser one frame to paint the start-position before kicking the transition.
      let raf1 = 0, raf2 = 0;
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setSpotlightReady(true));
      });
      t = setTimeout(() => setSpotlightState('visible'), ENTER_MS);
      return () => {
        clearTimeout(t);
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    } else if (spotlightState === 'visible') {
      t = setTimeout(() => {
        // Plan the handoff before transitioning to exiting:
        const container = physicsRef.current.containerRef.current;
        if (container) {
          const w = container.clientWidth;
          const h = container.clientHeight;
          const radius = computeSpawnRadius(w, h);

          // Only live bubbles count toward the cap — an exiting one is already on
          // its way out and must never be picked again as the eviction target.
          const liveBubbles = physicsRef.current.bubbles.filter((b) => b.lifecycle !== 'exiting');
          if (liveBubbles.length >= PHYSICS.MAX_BUBBLES) {
            // Evict oldest: pick the bubble with smallest spawnTime
            const oldest = [...liveBubbles].sort((a, b) => a.spawnTime - b.spawnTime)[0];
            handoffRef.current = { x: oldest.x, y: oldest.y, radius: oldest.radius };
            physicsRef.current.markExiting(oldest.id);
            // Removal happens in the 'exiting' timer below, after the pop animation.
            evictIdRef.current = oldest.id;
          } else {
            handoffRef.current = { x: w / 2, y: h / 2, radius };
          }
        }
        setSpotlightState('exiting');
      }, HOLD_MS);
    } else if (spotlightState === 'exiting') {
      // After exit animation completes, spawn the new bubble at the target slot
      t = setTimeout(() => {
        // Physically remove the evicted bubble now that its pop animation has run.
        // This runs before the setSpotlightState below, so nothing cancels it.
        if (evictIdRef.current) {
          physicsRef.current.remove(evictIdRef.current);
          evictIdRef.current = null;
        }
        const target = handoffRef.current;
        const photo = spotlightPhotoRef.current;
        if (target && photo) {
          physicsRef.current.spawn({
            photoId: photo.id,
            x: target.x,
            y: target.y,
            radius: target.radius,
            vx: (Math.random() * 2 - 1) * 0.3,
            vy: (Math.random() * 2 - 1) * 0.3,
          });
        }
        handoffRef.current = null;
        setSpotlightPhoto(null);
        setSpotlightReady(false);
        setSpotlightState('idle');
      }, 800);
    }
    return () => {
      clearTimeout(t);
    };
  }, [spotlightState]);

  const isSpotlightActive = spotlightState !== 'idle';

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Spotlight diameter: ~60% of the shorter viewport dimension (1.5× the previous size)
  const spotlightDiameter = typeof window !== 'undefined'
    ? Math.min(window.innerWidth, window.innerHeight) * 0.6
    : 600;

  // Background video: two elements that crossfade at each loop point for a seamless loop.
  const VIDEO_FADE_MS = 1500;
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const [activeVideo, setActiveVideo] = useState<'A' | 'B'>('A');
  const [crossfading, setCrossfading] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  // When the currently-active video gets close to the end, start the other one and crossfade.
  const handleVideoTimeUpdate = (which: 'A' | 'B') => () => {
    if (which !== activeVideo || crossfading) return;
    const el = which === 'A' ? videoARef.current : videoBRef.current;
    const other = which === 'A' ? videoBRef.current : videoARef.current;
    if (!el || !other || !isFinite(el.duration) || el.duration === 0) return;
    const remaining = el.duration - el.currentTime;
    if (remaining < VIDEO_FADE_MS / 1000) {
      try { other.currentTime = 0; } catch { /* ignore seek failures */ }
      other.play().catch(() => { /* autoplay block ignored — user is on /wall, will retry next loop */ });
      setCrossfading(true);
    }
  };

  // When the active video ends, swap which one is active. The other one has been fading in.
  const handleVideoEnded = (which: 'A' | 'B') => () => {
    if (which !== activeVideo) return;
    setActiveVideo(which === 'A' ? 'B' : 'A');
    setCrossfading(false);
  };

  // Crossfade visibility: only the INCOMING video fades. The outgoing (active)
  // video stays fully opaque underneath so the static poster never shows through
  // the 50%-opacity midpoint of a symmetric crossfade.
  const videoLayer = (which: 'A' | 'B'): { opacity: number; zIndex: number } => {
    const isActive = activeVideo === which;
    if (!videoReady) return { opacity: 0, zIndex: 0 };
    if (crossfading) {
      // Outgoing stays opaque underneath; incoming fades 0 -> 1 on top.
      return isActive ? { opacity: 1, zIndex: 0 } : { opacity: 1, zIndex: 1 };
    }
    // Steady state: the active video sits ON TOP so that the just-swapped
    // outgoing video (which fades 1 -> 0) always animates out underneath it,
    // never ghosting over it. (Without this, DOM order alone decides stacking,
    // which makes B->A transitions show a fading ghost of B's last frame.)
    return isActive ? { opacity: 1, zIndex: 1 } : { opacity: 0, zIndex: 0 };
  };
  const aLayer = videoLayer('A');
  const bLayer = videoLayer('B');

  return (
    <div className="h-screen w-screen overflow-hidden relative text-white bg-black">
      {/* Background video layer — its own isolated stacking context pinned behind
          everything (z-0). The two videos crossfade for a seamless loop; their
          internal z-index juggling is contained here and can't rise above the
          bubbles. No static background image. */}
      <div className="absolute inset-0 z-0" style={{ isolation: 'isolate' }} aria-hidden>
        <video
          ref={videoARef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity ease-in-out"
          style={{
            opacity: aLayer.opacity,
            zIndex: aLayer.zIndex,
            transitionDuration: `${VIDEO_FADE_MS}ms`,
          }}
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
          style={{
            opacity: bLayer.opacity,
            zIndex: bLayer.zIndex,
            transitionDuration: `${VIDEO_FADE_MS}ms`,
          }}
          src="/bubbleBG.mp4"
          muted
          playsInline
          preload="auto"
          onTimeUpdate={handleVideoTimeUpdate('B')}
          onEnded={handleVideoEnded('B')}
        />
      </div>

      {/* Bubble wall container (blurs when spotlight active) — sits above the
          background video (z-1), below the spotlight-darken overlay (z-5). */}
      <div
        ref={physics.containerRef}
        className={`absolute inset-0 z-[1] transition-all duration-1000 ease-in-out ${
          isSpotlightActive ? 'blur-md brightness-50 scale-[0.98]' : ''
        }`}
      >
        {physics.bubbles.map((b) => {
          const photo = photoMap.get(b.photoId) ?? null;
          return (
            <div
              key={b.id}
              ref={(el) => physics.registerBubbleEl(b.id, el)}
              className="absolute top-0 left-0 will-change-transform"
              style={{
                transform: `translate3d(${b.x - b.radius}px, ${b.y - b.radius}px, 0)`,
                transition: b.lifecycle === 'exiting'
                  ? 'transform 600ms ease-in, opacity 600ms ease-in, scale 600ms ease-in'
                  : undefined,
                opacity: b.lifecycle === 'exiting' ? 0 : 1,
                scale: b.lifecycle === 'exiting' ? '0' : '1',
              }}
            >
              <Bubble photo={photo} diameter={b.radius * 2} />
            </div>
          );
        })}

          {physics.bubbles.length === 0 && !isSpotlightActive && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Bubble
                photo={null}
                diameter={Math.min(window.innerWidth, window.innerHeight) * 0.3}
                placeholderText="Scan the QR to add a photo"
              />
            </div>
          )}
      </div>

      {/* Spotlight darken overlay — covers wall + background, sits below QR/logo and spotlight */}
      <div
        className={`absolute inset-0 z-[5] bg-black pointer-events-none transition-opacity duration-1000 ease-in-out ${
          isSpotlightActive ? 'opacity-60' : 'opacity-0'
        }`}
        aria-hidden
      />

      {/* QR */}
      <div className="absolute bottom-12 right-8 z-30 flex flex-col items-center gap-4">
        {uploadUrl && (
          <div className="bg-white p-3 rounded-xl shadow-2xl border border-black/10">
            <QRCodeSVG value={`${uploadUrl}/#/download`} size={100} level="H" bgColor="#ffffff" fgColor="#000000" />
            <p className="text-center text-xs font-semibold mt-2 text-black">Scan to Download</p>
          </div>
        )}
      </div>

      {/* Debug control panel (temporary) */}
      <DebugPanel onRespawn={respawnAll} />

      {/* Spotlight overlay */}
      {spotlightPhoto && (() => {
        const container = physics.containerRef.current;
        const containerRect = container?.getBoundingClientRect();
        const target = handoffRef.current;
        // Compute exit translate (from screen center to target wall position)
        let exitTransform = 'translate(0px, 0px) scale(0)';
        if (target && containerRect) {
          const dx = (containerRect.left + target.x) - window.innerWidth / 2;
          const dy = (containerRect.top + target.y) - window.innerHeight / 2;
          const shrinkScale = (target.radius * 2) / spotlightDiameter;
          exitTransform = `translate(${dx}px, ${dy}px) scale(${shrinkScale})`;
        }

        const transform =
          spotlightState === 'entering'
            ? (spotlightReady
                ? 'translateY(0px) scale(1)'
                : `translateY(${window.innerHeight}px) scale(1)`)
            : spotlightState === 'visible'
            ? 'translateY(0px) scale(1)'
            : exitTransform;

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
            <div
              style={{
                transition: spotlightReady
                  ? `transform ${spotlightState === 'entering' ? ENTER_MS : 800}ms ${
                      spotlightState === 'entering'
                        ? reducedMotion
                          ? 'ease-out'
                          : ENTER_EASE_BOUNCE
                        : 'ease-out'
                    }`
                  : 'none',
                transform,
              }}
            >
              <Bubble photo={spotlightPhoto} diameter={spotlightDiameter} />
            </div>
          </div>
        );
      })()}

      {/* Sparkle burst — fires when the bubble settles (entering → visible). Sits
          above the spotlight bubble (z-[61]) so the ring reads over it. Keyed by
          photo id so it replays for each new photo. Skipped under reduced motion. */}
      {spotlightPhoto && spotlightState === 'visible' && !reducedMotion && (
        <div className="fixed inset-0 z-[61] flex items-center justify-center pointer-events-none">
          <SparkleBurst key={spotlightPhoto.id} size={spotlightDiameter} />
        </div>
      )}
    </div>
  );
};

export default DisplayView;
