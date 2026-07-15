import React from 'react';
import { PhotoEntry } from '../types';
import { BubbleFrame } from './BubbleFrame';
import { SIGNATURE_BAND_HEIGHT_RATIO } from '../lib/bubbleGeometry';

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
  const imageUrl = photo
    ? (photo.imageUrl || (photo.images && photo.images[0]) || '')
    : '';

  // Signature band height as a % of the photo circle (the BubbleFrame children box).
  const bandHeightPct = `${SIGNATURE_BAND_HEIGHT_RATIO * 100}%`;

  // Signature sits on the top layer (above the glass rim) so it stays fully
  // visible rather than being dimmed under the bubble.png overlay.
  const signatureOverlay =
    imageUrl && photo?.signature ? (
      <img
        src={photo.signature}
        alt=""
        className="absolute left-0 right-0 bottom-0 w-full"
        style={{
          height: bandHeightPct,
          objectFit: 'contain',
          objectPosition: 'center bottom',
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
        }}
        draggable={false}
      />
    ) : undefined;

  return (
    <BubbleFrame diameter={diameter} className={className} style={style} overlay={signatureOverlay}>
      {/* Photo fills the circle */}
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
        />
      )}

      {/* Placeholder text (empty-state instructional bubble) */}
      {!imageUrl && placeholderText && (
        <div
          className="absolute inset-0 flex items-center justify-center text-center text-white font-semibold px-8"
          style={{ fontSize: diameter * 0.07 }}
        >
          {placeholderText}
        </div>
      )}
    </BubbleFrame>
  );
};
