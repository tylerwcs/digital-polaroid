import React, { useEffect, useRef } from 'react';
import { PhotoEntry } from '../types';
import { Bubble } from './Bubble';

interface BubbleCarouselProps {
  photos: PhotoEntry[];                       // newest first
  diameter: number;
  onActiveIndexChange?: (index: number) => void;
}

export const BubbleCarousel: React.FC<BubbleCarouselProps> = ({
  photos,
  diameter,
  onActiveIndexChange,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);

  // Report which slide is centered so the parent can act on the visible bubble.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      const clamped = Math.max(0, Math.min(photos.length - 1, idx));
      onActiveIndexChange?.(clamped);
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => track.removeEventListener('scroll', onScroll);
  }, [photos.length, onActiveIndexChange]);

  return (
    <div
      ref={trackRef}
      className="carousel-track w-full flex overflow-x-auto overflow-y-hidden"
      style={{ scrollbarWidth: 'none' }}
    >
      {photos.map((photo) => (
        <div
          key={photo.id}
          className="carousel-slide shrink-0 w-full flex items-center justify-center px-4"
        >
          <div className="animate-bubble-float">
            <Bubble photo={photo} diameter={diameter} />
          </div>
        </div>
      ))}
    </div>
  );
};
