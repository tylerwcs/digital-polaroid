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

  // Websocket subscriptions
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
      // Remove any bubble with this photoId
      const target = physics.bubbles.find((b) => b.photoId === deletedId);
      if (target) physics.markExiting(target.id);
      if (spotlightPhotoRef.current?.id === deletedId) {
        setSpotlightState('exiting');
      }
    });
    return () => { unsub(); unsubDel(); };
  }, [physics]);

  return (
    <div
      className="h-screen w-screen overflow-hidden relative text-white"
      style={{
        backgroundImage: "url('/bubblesBG.jpeg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Bubble wall container */}
      <div
        ref={physics.containerRef}
        className="absolute inset-0"
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

      {/* QR + Logo (bottom-right, unchanged) */}
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
    </div>
  );
};

export default DisplayView;
