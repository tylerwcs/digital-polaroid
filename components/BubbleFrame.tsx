import React from 'react';
import { PHOTO_INSET_RATIO } from '../lib/bubbleGeometry';

interface BubbleFrameProps {
  diameter: number;                 // full bubble diameter in px (2 * radius)
  children?: React.ReactNode;       // content rendered inside the circular photo area
  overlay?: React.ReactNode;        // content rendered ABOVE the glass rim (e.g. the signature)
  className?: string;
  style?: React.CSSProperties;
}

// The shared bubble visual: a square wrapper holding a circular photo area
// (clipped) with the bubble.png glass rim overlaid on top, plus the lift/halo
// shadow. No data logic — callers slot a photo, a <video>, or a signing canvas
// in via children. Anything that must sit on top of the glass rim (the
// signature) goes in `overlay`, which is clipped to the same photo circle.
export const BubbleFrame: React.FC<BubbleFrameProps> = ({
  diameter,
  children,
  overlay,
  className = '',
  style = {},
}) => {
  const photoSize = diameter * PHOTO_INSET_RATIO;
  const photoOffset = (diameter - photoSize) / 2;

  // The circular photo area's box, shared by the clipped children layer and the
  // clipped overlay layer so the signature stays aligned to the photo circle.
  const circleBox: React.CSSProperties = {
    width: photoSize,
    height: photoSize,
    top: photoOffset,
    left: photoOffset,
  };

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
      <div className="absolute overflow-hidden rounded-full bg-black/20" style={circleBox}>
        {children}
      </div>

      {/* Bubble PNG overlay (glass rim, highlights, branding) */}
      <img
        src="/bubble.png"
        alt=""
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        draggable={false}
      />

      {/* Top layer above the glass rim, clipped to the same circle (e.g. the signature) */}
      {overlay && (
        <div
          className="absolute overflow-hidden rounded-full pointer-events-none"
          style={circleBox}
        >
          {overlay}
        </div>
      )}
    </div>
  );
};
