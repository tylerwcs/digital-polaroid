import React, { useEffect, useState, useRef, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getPhotos, subscribeToUpdates, subscribeToDelete } from '../services/storageService';
import { PhotoEntry } from '../types';
import { Polaroid } from './Polaroid';

type SpotlightState = 'idle' | 'entering' | 'visible' | 'exiting';

const DisplayView: React.FC = () => {
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [queue, setQueue] = useState<PhotoEntry[]>([]);
  const [numCols, setNumCols] = useState(3);
  
  // Spotlight Animation State
  const [spotlightPhoto, setSpotlightPhoto] = useState<PhotoEntry | null>(null);
  const [spotlightState, setSpotlightState] = useState<SpotlightState>('idle');
  
  // Ref to track spotlight photo for event handlers to avoid stale closures
  const spotlightPhotoRef = useRef<PhotoEntry | null>(null);

  // Update ref when state changes
  useEffect(() => {
    spotlightPhotoRef.current = spotlightPhoto;
  }, [spotlightPhoto]);

  const containerRef = useRef<HTMLDivElement>(null);

  // Handle Responsive Column Count
  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      if (w >= 1280) setNumCols(4);
      else if (w >= 1024) setNumCols(3);
      else if (w >= 768) setNumCols(2);
      else setNumCols(1);
    };
    handleResize(); // Init
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initial load & Subscription
  useEffect(() => {
    const fetchPhotos = async () => {
      const loaded = await getPhotos();
      
      // Check if the latest photo is new (within 15 seconds) to trigger spotlight
      // This handles the case where the user uploads and immediately navigates to the wall
      const latest = loaded[0];
      const isNew = latest && (Date.now() - latest.timestamp < 15000);

      if (isNew) {
        setSpotlightPhoto(latest);
        setSpotlightState('entering');
        // Show rest of photos in grid, omitting the new one until animation is done
        setPhotos(loaded.slice(1));
      } else {
        setPhotos(loaded);
      }
    };
    
    fetchPhotos();

    // When new photos arrive via WebSocket, add them to the queue 
    const unsubscribe = subscribeToUpdates((newPhoto) => {
      setQueue((prev) => [...prev, newPhoto]);
    });

    // Handle deletions
    const unsubscribeDelete = subscribeToDelete((deletedId) => {
      setPhotos(prev => prev.filter(p => p.id !== deletedId));
      // Also remove from queue if it hasn't been shown yet
      setQueue(prev => prev.filter(p => p.id !== deletedId));
      
      // Check against ref to see if we need to remove current spotlight
      if (spotlightPhotoRef.current && spotlightPhotoRef.current.id === deletedId) {
         setSpotlightState('exiting');
      }
    });

    return () => {
      unsubscribe();
      unsubscribeDelete();
    };
  }, []);

  // Distribute photos into columns for JS Masonry
  const columns = useMemo(() => {
    const cols: PhotoEntry[][] = Array.from({ length: numCols }, () => []);
    photos.forEach((photo, index) => {
      cols[index % numCols].push(photo);
    });
    return cols;
  }, [photos, numCols]);

  // Queue Processor
  useEffect(() => {
    // If we have items in queue and no active spotlight, start the show
    if (queue.length > 0 && spotlightState === 'idle') {
      const nextPhoto = queue[0];
      setQueue(prev => prev.slice(1));
      setSpotlightPhoto(nextPhoto);
      setSpotlightState('entering');
    }
  }, [queue, spotlightState]);

  // Spotlight Animation Sequence
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    if (spotlightState === 'entering') {
      // Trigger transition to visible shortly after mount
      timer = setTimeout(() => {
        setSpotlightState('visible');
      }, 100);
    } else if (spotlightState === 'visible') {
      // Fixed duration for single photo
      const SPOTLIGHT_DURATION = 5000; 

      timer = setTimeout(() => {
        setSpotlightState('exiting');
      }, SPOTLIGHT_DURATION); 
    } else if (spotlightState === 'exiting') {
      // After exit animation finishes, move photo to main grid
      timer = setTimeout(() => {
        if (spotlightPhoto) {
          // Add new photo to the top of the list
          setPhotos(prev => [spotlightPhoto, ...prev]);
        }
        setSpotlightPhoto(null);
        setSpotlightState('idle');
      }, 1000); // Wait for 1s CSS transition
    }

    return () => clearTimeout(timer);
  }, [spotlightState, spotlightPhoto]);

  const isSpotlightActive = spotlightState !== 'idle';

  return (
    <div className="h-screen bg-zinc-950 text-white overflow-hidden relative flex flex-col">
      
      {/* Background Wrapper - Blurs when spotlight is active */}
      <div className={`flex-grow flex flex-col relative transition-all duration-1000 ease-in-out ${isSpotlightActive ? 'blur-md brightness-50 scale-[0.98]' : ''}`}>
        
        {/* Background Video */}
        <div className="absolute inset-0 z-0 overflow-hidden">
          <video 
            autoPlay 
            loop 
            muted 
            playsInline
            className="w-full h-full object-cover"
          >
            <source src="/bg.mp4" />
          </video>
          {/* Dark overlay for contrast */}
          <div className="absolute inset-0 bg-black/40"></div>
        </div>

        {/* Logo & QR Code Container */}
        <div className="absolute bottom-12 right-8 z-30 flex flex-col items-center gap-4">
          {/* QR Code */}
          <div className="bg-white/10 backdrop-blur-sm p-3 rounded-xl shadow-lg border border-white/20 transition-transform hover:scale-105">
             <QRCodeSVG 
                value="http://192.168.0.70:5173/" 
                size={100}
                level="M"
                bgColor="transparent"
                fgColor="#ffffff"
             />
             <p className="text-center text-xs font-medium mt-2 text-white/90 drop-shadow-md">Scan to Upload</p>
          </div>

          {/* Logo */}
          <img 
            src="/logo masthead 2.png" 
            alt="Holiday Tours" 
            className="w-32 md:w-32 h-auto drop-shadow-lg opacity-90"
          />
        </div>
        

        <main 
          ref={containerRef}
          className="flex-grow relative z-10 overflow-hidden pt-4"
        >
          {photos.length === 0 && !spotlightPhoto ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-600 opacity-50">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-24 h-24 mb-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              <p className="text-xl">Waiting for the first snap...</p>
            </div>
          ) : (
            <div className="flex flex-row justify-center gap-6 h-full w-full max-w-[1600px] mx-auto px-8">
              {columns.map((colPhotos, colIndex) => (
                <div key={colIndex} className="flex-1 relative overflow-hidden pause-on-hover h-full">
                  {/* 
                    Marquee Container
                    - Duplicates content to create seamless loop 
                    - Translates -50% vertically
                  */}
                  <div 
                    className="flex flex-col absolute w-full top-0 animate-scroll-vertical"
                    style={{ 
                      // Adjust speed based on content length. 
                      // Base speed + varying speed per item.
                      animationDuration: `${Math.max(60, colPhotos.length * 20)}s`,
                      // Offset animations so columns don't move in perfect sync
                      animationDelay: `-${colIndex * 7}s` 
                    }}
                  >
                    {/* 
                      Render items twice for infinite loop.
                    */}
                    {[...colPhotos, ...colPhotos].map((photo, index) => (
                      <div 
                        key={`${photo.id}-${index}`} 
                        className="w-full flex justify-center mb-6"
                      >
                         <Polaroid 
                            photo={photo} 
                            className="w-full max-w-[280px] hover:z-10 transition-transform hover:scale-105 hover:rotate-0 shadow-lg"
                          />
                      </div>
                    ))}
                  </div>
                  
                  {/* 
                    Gradient overlay at bottom to smooth out exit
                  */}
                  <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-zinc-950 to-transparent pointer-events-none z-10"></div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Spotlight Overlay */}
      {spotlightPhoto && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none perspective-[1000px]">
          <div 
            className={`
              transform transition-all duration-1000 ease-out
              ${spotlightState === 'entering' ? 'opacity-0 translate-y-[50vh] scale-50 rotate-[-10deg]' : ''}
              ${spotlightState === 'visible' ? 'opacity-100 translate-y-0 scale-125 rotate-2' : ''}
              ${spotlightState === 'exiting' ? 'opacity-0 -translate-y-[20vh] scale-[0.4] rotate-[10deg]' : ''}
            `}
          >
             {/* Larger Polaroid for Spotlight */}
             <Polaroid 
                photo={spotlightPhoto} 
                className="shadow-[0_35px_60px_-15px_rgba(0,0,0,0.7)] w-[320px] md:w-[400px]" 
             />
          </div>
        </div>
      )}

    </div>
  );
};

export default DisplayView;