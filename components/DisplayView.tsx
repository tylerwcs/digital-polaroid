import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getPhotos, subscribeToUpdates, subscribeToDelete } from '../services/storageService';
import { PhotoEntry } from '../types';
import { Bubble } from './Bubble';
import { useBubblePhysics } from '../hooks/useBubblePhysics';
import { PHYSICS, computeSpawnRadius, randomInRange } from '../lib/bubblePhysics';

type SpotlightState = 'idle' | 'entering' | 'visible' | 'exiting';

const DisplayView: React.FC = () => {
  const physics = useBubblePhysics();
  const [photoMap, setPhotoMap] = useState<Map<string, PhotoEntry>>(new Map());
  const [queue, setQueue] = useState<PhotoEntry[]>([]);
  const [uploadUrl, setUploadUrl] = useState<string>('');

  // Spotlight state (used in next task)
  const [spotlightPhoto, setSpotlightPhoto] = useState<PhotoEntry | null>(null);
  const [spotlightState, setSpotlightState] = useState<SpotlightState>('idle');
  const spotlightPhotoRef = useRef<PhotoEntry | null>(null);
  useEffect(() => { spotlightPhotoRef.current = spotlightPhoto; }, [spotlightPhoto]);

  const physicsRef = useRef(physics);
  useEffect(() => { physicsRef.current = physics; });

  const handoffRef = useRef<{ x: number; y: number; radius: number } | null>(null);

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
    physics.spawn({ photoId: photo.id, x, y, radius, vx, vy });
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
      // Remove any bubble with this photoId (read live state via ref)
      const target = physicsRef.current.bubbles.find((b) => b.photoId === deletedId);
      if (target) physicsRef.current.markExiting(target.id);
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
      t = setTimeout(() => setSpotlightState('visible'), 1500);
    } else if (spotlightState === 'visible') {
      t = setTimeout(() => {
        // Plan the handoff before transitioning to exiting:
        const container = physics.containerRef.current;
        if (container) {
          const w = container.clientWidth;
          const h = container.clientHeight;
          const radius = computeSpawnRadius(w, h);

          if (physics.bubbles.length >= PHYSICS.MAX_BUBBLES) {
            // Evict oldest: pick the bubble with smallest spawnTime
            const oldest = [...physics.bubbles].sort((a, b) => a.spawnTime - b.spawnTime)[0];
            handoffRef.current = { x: oldest.x, y: oldest.y, radius: oldest.radius };
            physics.markExiting(oldest.id);
            // Schedule physical removal after pop animation
            setTimeout(() => physics.remove(oldest.id), 600);
          } else {
            handoffRef.current = { x: w / 2, y: h / 2, radius };
          }
        }
        setSpotlightState('exiting');
      }, 5000);
    } else if (spotlightState === 'exiting') {
      // After exit animation completes, spawn the new bubble at the target slot
      t = setTimeout(() => {
        const target = handoffRef.current;
        const photo = spotlightPhotoRef.current;
        if (target && photo) {
          physics.spawn({
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
        setSpotlightState('idle');
      }, 800);
    }
    return () => clearTimeout(t);
  }, [spotlightState, physics]);

  const isSpotlightActive = spotlightState !== 'idle';

  // Spotlight diameter: ~40% of the shorter viewport dimension
  const spotlightDiameter = typeof window !== 'undefined'
    ? Math.min(window.innerWidth, window.innerHeight) * 0.4
    : 400;

  return (
    <div
      className="h-screen w-screen overflow-hidden relative text-white"
      style={{
        backgroundImage: "url('/bubblesBG.jpeg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Bubble wall container (blurs when spotlight active) */}
      <div
        ref={physics.containerRef}
        className={`absolute inset-0 transition-all duration-1000 ease-in-out ${
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
      </div>

      {/* QR + Logo */}
      <div className="absolute bottom-12 right-8 z-30 flex flex-col items-center gap-4">
        {uploadUrl && (
          <div className="bg-black/90 p-3 rounded-xl shadow-2xl border border-white/30">
            <div className="bg-white p-2 rounded-md">
              <QRCodeSVG value={uploadUrl} size={100} level="H" bgColor="#ffffff" fgColor="#000000" />
            </div>
            <p className="text-center text-xs font-semibold mt-2 text-white">Scan to Upload</p>
          </div>
        )}
        <img
          src="/logo masthead 2.png"
          alt="Holiday Tours"
          className="w-32 h-auto drop-shadow-lg opacity-90"
        />
      </div>

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
            ? `translateY(${window.innerHeight}px) scale(1)`
            : spotlightState === 'visible'
            ? 'translateY(0px) scale(1)'
            : exitTransform;

        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none">
            <div
              className="transition-all ease-out"
              style={{
                transitionDuration: spotlightState === 'entering' ? '1500ms' : '800ms',
                transform,
                opacity: spotlightState === 'exiting' ? 1 : 1, // keep visible during shrink
              }}
            >
              <Bubble photo={spotlightPhoto} diameter={spotlightDiameter} />
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default DisplayView;
