import React from 'react';
import { PHOTO_INSET_RATIO } from '../lib/bubbleGeometry';

interface BubbleFrameProps {
  diameter: number;                 // full bubble diameter in px (2 * radius)
  children?: React.ReactNode;       // content rendered inside the circular photo area
  className?: string;
  style?: React.CSSProperties;
}

// The shared bubble visual: a square wrapper holding a circular photo area
// (clipped) with the bubble.png glass rim overlaid on top, plus the lift/halo
// shadow. No data logic — callers slot a photo, a <video>, or a signing canvas
// in via children.
export const BubbleFrame: React.FC<BubbleFrameProps> = ({
  diameter,
  children,
  className = '',
  style = {},
}) => {
  const photoSize = diameter * PHOTO_INSET_RATIO;
  const photoOffset = (diameter - photoSize) / 2;

  return (
    <div
      className={`relative ${className}`}
      style={{
        width: diameter,
        height: diameter,
        // Bright outer halo — matches the wall bubble's current look.
        filter: 'drop-shadow(0 0 12px rgba(255, 255, 255, 0.25))',
        ...style,
      }}
    >
      {/* Circular photo area (children clipped to the circle) */}
      <div
        className="absolute overflow-hidden rounded-full bg-black/20"
        style={{
          width: photoSize,
          height: photoSize,
          top: photoOffset,
          left: photoOffset,
        }}
      >
        {children}
      </div>

      {/* Bubble PNG overlay (glass rim, highlights, branding) */}
      <img
        src="/bubble.png"
        alt=""
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        draggable={false}
      />
    </div>
  );
};
