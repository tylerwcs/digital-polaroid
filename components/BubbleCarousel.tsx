import React, { useEffect, useRef, useState } from 'react';
import { PhotoEntry } from '../types';
import { Bubble } from './Bubble';

interface BubbleCarouselProps {
  photos: PhotoEntry[];                       // newest first
  diameter: number;
  renderActions: (photo: PhotoEntry, index: number) => React.ReactNode;
}

export const BubbleCarousel: React.FC<BubbleCarouselProps> = ({
  photos,
  diameter,
  renderActions,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // Track which slide is centered (for the position indicator).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      setActive(Math.max(0, Math.min(photos.length - 1, idx)));
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => track.removeEventListener('scroll', onScroll);
  }, [photos.length]);

  return (
    <div className="relative w-full flex flex-col items-center gap-4">
      <div
        ref={trackRef}
        className="carousel-track w-full flex overflow-x-auto overflow-y-hidden"
        style={{ scrollbarWidth: 'none' }}
      >
        {photos.map((photo, i) => (
          <div
            key={photo.id}
            className="carousel-slide shrink-0 w-full flex flex-col items-center justify-center gap-6 px-4"
          >
            <div className="animate-bubble-float">
              <Bubble photo={photo} diameter={diameter} />
            </div>
            {renderActions(photo, i)}
          </div>
        ))}
      </div>

      {/* Position indicator */}
      <div className="text-white/80 text-sm font-medium">
        {active + 1} / {photos.length}
      </div>
    </div>
  );
};
