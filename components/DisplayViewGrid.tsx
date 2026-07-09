import React, { useEffect, useState, useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getPhotos, subscribeToUpdates, subscribeToDelete, getWallSettings, subscribeToSettings } from '../services/storageService';
import { PhotoEntry, WallSettings, WALL_SETTINGS_DEFAULTS } from '../types';
import { Polaroid } from './Polaroid';

/**
 * MarqueeColumn Component
 * 
 * Handles seamless infinite scrolling using requestAnimationFrame and manual translation.
 * This approach avoids CSS animation glitches when content height changes dynamically (e.g. adding new photos).
 */
const MarqueeColumn: React.FC<{
  photos: PhotoEntry[],
  speed?: number,
  delay?: number,
  newIds?: Set<string>,
  onEntrancePlayed?: (id: string) => void,
  polaroidWidth: number
}> = ({ photos, speed = 0.5, delay = 0, newIds, onEntrancePlayed, polaroidWidth }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const yPos = useRef(0);
  const reqId = useRef<number>();
  const lastHeight = useRef(0);

  // Pop-in is triggered when a new photo scrolls INTO the visible area (not on
  // mount — the marquee inserts photos off-screen, so a mount animation would
  // finish before the photo is ever seen). An IntersectionObserver reports the
  // element's real on-screen position even though the marquee moves it via CSS
  // transform, letting us fire the "drop & settle" exactly as it enters the line.
  const [animatingKeys, setAnimatingKeys] = useState<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const observedEls = useRef<Map<string, Element>>(new Map());
  const animatedIds = useRef<Set<string>>(new Set()); // photos that already played, so copies don't repeat
  const onEntranceRef = useRef(onEntrancePlayed);
  useEffect(() => { onEntranceRef.current = onEntrancePlayed; }, [onEntrancePlayed]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target as HTMLElement;
        const id = el.dataset.popId;
        const key = el.dataset.popKey;
        io.unobserve(el);
        if (key) observedEls.current.delete(key);
        if (!id || animatedIds.current.has(id)) return; // a sibling copy already played
        animatedIds.current.add(id);
        if (key) {
          setAnimatingKeys((prev) => new Set(prev).add(key));
          // Drop the class once the animation is done (keeps the set bounded).
          window.setTimeout(() => {
            setAnimatingKeys((prev) => {
              const next = new Set(prev);
              next.delete(key);
              return next;
            });
          }, 1300);
        }
        onEntranceRef.current?.(id); // let the parent clear the "new" flag
      });
    }, { threshold: 0.15 });
    observerRef.current = io;
    return () => {
      io.disconnect();
      observerRef.current = null;
      observedEls.current.clear();
    };
  }, []);

  // Callback ref for a not-yet-seen new photo: (re)register it with the observer.
  const registerNewItem = (key: string, id: string) => (el: HTMLDivElement | null) => {
    const io = observerRef.current;
    const prev = observedEls.current.get(key);
    if (prev && prev !== el) {
      io?.unobserve(prev);
      observedEls.current.delete(key);
    }
    if (el && io) {
      el.dataset.popId = id;
      el.dataset.popKey = key;
      io.observe(el);
      observedEls.current.set(key, el);
    }
  };

  // Calculate repeat count to ensure vertical fill
  const repeatCount = useMemo(() => {
    if (photos.length === 0) return 2;
    const MIN_ITEMS = 12;
    return Math.max(2, Math.ceil(MIN_ITEMS / photos.length));
  }, [photos.length]);

  const repeatCountRef = useRef(repeatCount);
  useEffect(() => {
    repeatCountRef.current = repeatCount;
  }, [repeatCount]);
  
  // Initialize lastHeight on mount/update if available
  useLayoutEffect(() => {
    if (containerRef.current) {
      lastHeight.current = containerRef.current.scrollHeight;
    }
  }, []);

  // Animation Loop
  useEffect(() => {
    let startTimestamp: number | null = null;
    const initialDelay = delay * 1000;

    const move = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      
      // Respect initial delay
      if (timestamp - startTimestamp < initialDelay) {
        reqId.current = requestAnimationFrame(move);
        return;
      }

      if (!containerRef.current) return;

      yPos.current -= speed;
        
      // Loop logic
      const currentRepeat = repeatCountRef.current;
      const singleSetHeight = lastHeight.current / currentRepeat; 
      
      if (singleSetHeight > 0 && yPos.current <= -singleSetHeight) {
         yPos.current += singleSetHeight;
      }
      
      containerRef.current.style.transform = `translateY(${yPos.current}px)`;
      
      reqId.current = requestAnimationFrame(move);
    };

    reqId.current = requestAnimationFrame(move);
    
    return () => {
      if (reqId.current) cancelAnimationFrame(reqId.current);
    };
  }, [speed, delay]); // Re-bind if speed changes

  // Handle Content Updates & Resize (Seamlessly)
  useEffect(() => {
      if (!containerRef.current) return;
      
      const ro = new ResizeObserver(() => {
         if (!containerRef.current) return;

         // New photos are appended to the END of each repeated set, so content
         // already on screen (top-aligned) doesn't move. We only need to update
         // the measured height; the animation loop recomputes the wrap point
         // (singleSetHeight) from it. Previously we scaled yPos by the height
         // ratio here, which yanked the whole column at the instant a photo was
         // added and made the pop-in look janky. Keeping yPos stable = smooth.
         lastHeight.current = containerRef.current.scrollHeight;
      });
      
      ro.observe(containerRef.current);
      return () => ro.disconnect();
  }, []); // Run once

  return (
    <div 
      className="w-full absolute top-0"
    >
      <div ref={containerRef} className="w-full flex flex-col">
        {Array.from({ length: repeatCount }).map((_, setIndex) => (
           photos.map((photo, index) => {
            const key = `${setIndex}-${photo.id}-${index}`;
            // "Pending" = flagged new by the parent and not yet played in this column.
            const pending = !!newIds?.has(photo.id) && !animatedIds.current.has(photo.id);
            const animating = animatingKeys.has(key);
            return (
              <div
                key={key}
                ref={pending ? registerNewItem(key, photo.id) : undefined}
                className={`w-full flex justify-center mb-12${animating ? ' animate-pop-in' : ''}`}
              >
                <Polaroid
                  photo={photo}
                  width={polaroidWidth}
                  className="hover:z-10 transition-transform hover:scale-105 hover:rotate-0 shadow-lg"
                />
              </div>
            );
          })
        ))}
      </div>
    </div>
  );
};

const DisplayViewGrid: React.FC = () => {
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [responsiveCols, setResponsiveCols] = useState(6);
  const [settings, setSettings] = useState<WallSettings>(WALL_SETTINGS_DEFAULTS);
  const [uploadUrl, setUploadUrl] = useState<string>('');
  // IDs of photos that just arrived, so they can play the pop-in animation once.
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Load wall settings and keep them live.
  useEffect(() => {
    getWallSettings().then(setSettings);
    const unsubscribe = subscribeToSettings(setSettings);
    return unsubscribe;
  }, []);

  // Determine URL to encode in QR code
  useEffect(() => {
    // Prefer explicit URL for hosted environments; fall back to current origin.
    const explicit = import.meta.env.VITE_UPLOAD_URL as string | undefined;
    if (explicit) {
      setUploadUrl(explicit);
    } else if (typeof window !== 'undefined') {
      setUploadUrl(window.location.origin);
    }
  }, []);

  // Initial load & Subscription
  useEffect(() => {
    const fetchPhotos = async () => {
      const loaded = await getPhotos();
      setPhotos(loaded);
    };
    
    fetchPhotos();

    // When new photos arrive via WebSocket, add them to the END of the list
    // to prevent existing items from shuffling columns.
    const unsubscribe = subscribeToUpdates((newPhoto) => {
      // Append the photo and trigger its pop-in. We do this only AFTER the image
      // has loaded so the polaroid pops in fully rendered — otherwise the white
      // card appears first and the photo fills in a beat later (and the card can
      // resize as the image sets its height), which looks janky.
      let revealed = false;
      const reveal = () => {
        if (revealed) return;
        revealed = true;

        setPhotos((prev) => [...prev, newPhoto]);

        // Flag this photo as new so it pops in once it scrolls into view. The
        // column clears the flag when it plays (via onEntrancePlayed); this
        // timeout is only a safety net in case it never becomes visible.
        setNewIds((prev) => new Set(prev).add(newPhoto.id));
        setTimeout(() => {
          setNewIds((prev) => {
            if (!prev.has(newPhoto.id)) return prev;
            const next = new Set(prev);
            next.delete(newPhoto.id);
            return next;
          });
        }, 20000);
      };

      const src = newPhoto.imageUrl || (newPhoto.images && newPhoto.images[0]);
      if (src) {
        const img = new Image();
        img.onload = reveal;
        img.onerror = reveal; // show it anyway if the image fails
        img.src = src;
        // Safety net: reveal even if load/error events never fire.
        setTimeout(reveal, 3000);
      } else {
        reveal();
      }
    });

    // Handle deletions
    const unsubscribeDelete = subscribeToDelete((deletedId) => {
      setPhotos(prev => prev.filter(p => p.id !== deletedId));
    });

    return () => {
      unsubscribe();
      unsubscribeDelete();
    };
  }, []);

  // A column calls this once it has played a new photo's entrance, so we stop
  // flagging it as new (prevents other columns/copies from re-triggering it).
  const handleEntrancePlayed = useCallback((id: string) => {
    setNewIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Distribute photos into columns
  const columns = useMemo(() => {
    const cols: PhotoEntry[][] = Array.from({ length: numCols }, () => []);
    photos.forEach((photo, index) => {
      cols[index % numCols].push(photo);
    });
    return cols;
  }, [photos, numCols]);

  return (
    <div className="h-screen bg-black text-white overflow-hidden relative flex flex-col">
      
      {/* Background Wrapper */}
      <div className="flex-grow flex flex-col relative">
        {/* Boomerang (forward+reverse) clip loops seamlessly with a single
            video element — no crossfade, so the marquee never drops frames. */}
        <video
          className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          aria-hidden
        >
          <source src="/generali-bg-boomerang.mp4" type="video/mp4" />
        </video>

        <main 
          ref={containerRef}
          className="flex-grow relative z-10 overflow-hidden pt-4"
        >
          {photos.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-600 opacity-50">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-24 h-24 mb-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              <p className="text-xl">Waiting for the first snap...</p>
            </div>
          ) : (
            <div className="flex flex-row justify-center gap-6 h-full w-full max-w-[1920px] mx-auto px-8">
              {columns.map((colPhotos, colIndex) => (
                <div key={colIndex} className="flex-1 relative overflow-hidden h-full">
                   <MarqueeColumn
                      photos={colPhotos}
                      speed={0.5}
                      delay={colIndex * 2}
                      newIds={newIds}
                      onEntrancePlayed={handleEntrancePlayed}
                      polaroidWidth={settings.polaroidWidth}
                   />
                  
                  {/* 
                    Gradient overlay removed for chroma keying
                  */}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default DisplayViewGrid;
