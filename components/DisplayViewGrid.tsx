import React, { useEffect, useState, useMemo, useRef, useLayoutEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getPhotos, subscribeToUpdates, subscribeToDelete } from '../services/storageService';
import { PhotoEntry } from '../types';
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
  delay?: number 
}> = ({ photos, speed = 0.5, delay = 0 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const yPos = useRef(0);
  const reqId = useRef<number>();
  const lastHeight = useRef(0);
  // Pause state removed as per request
  
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
        // We use the cached height to determine loop point.
        // The content is rendered twice. So we loop when we pass half height.
        const halfHeight = lastHeight.current / 2; 
        
        if (halfHeight > 0 && yPos.current <= -halfHeight) {
           // Reset to top (well, strictly speaking, we add halfHeight to go back to the first set)
           yPos.current += halfHeight;
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
         
         const newHeight = containerRef.current.scrollHeight;
         const oldHeight = lastHeight.current;
         
         // Check if height changed significantly (avoid minor subpixel noise)
         if (oldHeight > 0 && Math.abs(newHeight - oldHeight) > 1) {
             const oldHalf = oldHeight / 2;
             const newHalf = newHeight / 2;
             
             // If we are visually in the "second half" (the duplicate set),
             // we need to adjust yPos so we stay visually consistent.
             // The logic: The first set grew, pushing the second set down.
             // We need to move our viewport DOWN (more negative yPos) by the growth amount
             // to keep seeing the same item in the second set.
             
             if (Math.abs(yPos.current) >= oldHalf) {
                 const delta = newHalf - oldHalf;
                 yPos.current -= delta;
             }
         }
         
         lastHeight.current = newHeight;
      });
      
      ro.observe(containerRef.current);
      return () => ro.disconnect();
  }, []); // Run once

  return (
    <div 
      className="w-full absolute top-0"
    >
      <div ref={containerRef} className="w-full flex flex-col">
        {/* First Set */}
        {photos.map((photo, index) => (
          <div 
            key={`1-${photo.id}-${index}`} 
            className="w-full flex justify-center mb-12"
          >
              <Polaroid 
                photo={photo} 
                size="small"
                className="w-full max-w-[180px] hover:z-10 transition-transform hover:scale-105 hover:rotate-0 shadow-lg"
              />
          </div>
        ))}
        {/* Duplicate Set for Infinite Loop */}
        {photos.map((photo, index) => (
          <div 
            key={`2-${photo.id}-${index}`} 
            className="w-full flex justify-center mb-12"
          >
              <Polaroid 
                photo={photo} 
                size="small"
                className="w-full max-w-[180px] hover:z-10 transition-transform hover:scale-105 hover:rotate-0 shadow-lg"
              />
          </div>
        ))}
      </div>
    </div>
  );
};

const DisplayViewGrid: React.FC = () => {
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [numCols, setNumCols] = useState(6);
  const [uploadUrl, setUploadUrl] = useState<string>('');
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle Responsive Column Count - optimized for 6 columns on larger screens
  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      if (w >= 1800) setNumCols(6);
      else if (w >= 1500) setNumCols(5);
      else if (w >= 1200) setNumCols(4);
      else if (w >= 900) setNumCols(3);
      else if (w >= 600) setNumCols(2);
      else setNumCols(1);
    };
    handleResize(); // Init
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
      setPhotos((prev) => [...prev, newPhoto]);
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

  // Distribute photos into columns
  const columns = useMemo(() => {
    const cols: PhotoEntry[][] = Array.from({ length: numCols }, () => []);
    photos.forEach((photo, index) => {
      cols[index % numCols].push(photo);
    });
    return cols;
  }, [photos, numCols]);

  return (
    <div className="h-screen bg-green-500 text-white overflow-hidden relative flex flex-col">
      
      {/* Background Wrapper */}
      <div className="flex-grow flex flex-col relative">
        
        {/* Background Video - Removed for Chroma Key */}
        
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
