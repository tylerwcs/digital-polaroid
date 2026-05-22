import React from 'react';
import { PhotoEntry } from '../types';

interface BubbleProps {
  photo: PhotoEntry | null;       // null = empty/placeholder (instructional bubble)
  diameter: number;               // pixel size of the bubble (2 * radius)
  className?: string;
  style?: React.CSSProperties;
  placeholderText?: string;       // shown when photo is null
}

export const Bubble: React.FC<BubbleProps> = ({
  photo,
  diameter,
  className = '',
  style = {},
  placeholderText,
}) => {
  const photoSize = diameter * 0.78;  // inner photo area (leaves room for glass rim)
  const photoOffset = (diameter - photoSize) / 2;

  const imageUrl = photo
    ? (photo.imageUrl || (photo.images && photo.images[0]) || '')
    : '';

  return (
    <div
      className={`relative ${className}`}
      style={{
        width: diameter,
        height: diameter,
        ...style,
      }}
    >
      {/* Photo (clipped to circle), only if a photo is provided */}
      {imageUrl && (
        <div
          className="absolute overflow-hidden rounded-full bg-black/20"
          style={{
            width: photoSize,
            height: photoSize,
            top: photoOffset,
            left: photoOffset,
          }}
        >
          <img
            src={imageUrl}
            alt=""
            className="w-full h-full object-cover"
            draggable={false}
          />
          {/* Signature overlay on lower portion */}
          {photo?.signature && (
            <img
              src={photo.signature}
              alt=""
              className="absolute left-0 right-0 bottom-0 w-full pointer-events-none"
              style={{
                height: '40%',
                objectFit: 'contain',
                objectPosition: 'center bottom',
                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
              }}
              draggable={false}
            />
          )}
        </div>
      )}

      {/* Placeholder text (for empty-state instructional bubble) */}
      {!imageUrl && placeholderText && (
        <div
          className="absolute inset-0 flex items-center justify-center text-center text-white font-semibold px-8"
          style={{ fontSize: diameter * 0.07 }}
        >
          {placeholderText}
        </div>
      )}

      {/* Bubble PNG overlay (glass rim & highlights) */}
      <img
        src="/bubble.png"
        alt=""
        className="absolute inset-0 w-full h-full pointer-events-none select-none"
        draggable={false}
      />
    </div>
  );
};
