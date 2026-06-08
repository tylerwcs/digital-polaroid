import React from 'react';
import { PhotoEntry } from '../types';

interface PolaroidProps {
  photo: PhotoEntry;
  className?: string;
  style?: React.CSSProperties;
  size?: 'normal' | 'small';
}

// ─── SVG layout constants (edit these to tweak the Polaroid design) ───
const CARD_W = 320;
const CARD_H = 400;
const CARD_RX = 10;                         // corner radius
const PAD = 16;                             // padding inside card
const PHOTO_X = PAD;
const PHOTO_Y = PAD + 8;                    // extra top space (room for tape)
const PHOTO_W = CARD_W - PAD * 2;           // 288
const PHOTO_H = 280;                        // photo area height
const PHOTO_RX = 4;                         // photo corner radius
const CAPTION_Y = PHOTO_Y + PHOTO_H + 8;    // just below photo
const CAPTION_H = CARD_H - CAPTION_Y - 8;   // remaining space
// Tape (decorative strip at top center)
const TAPE_W = 70;
const TAPE_H = 22;
const TAPE_X = (CARD_W - TAPE_W) / 2;
const TAPE_Y = -6;
// Butterfly watermark (large, subtle, bottom-right corner)
const WM_SIZE = 300;
const WM_X = CARD_W - WM_SIZE + 105;         // overflow slightly off the right
const WM_Y = CARD_H - WM_SIZE + 115;         // overflow slightly off the bottom
const WM_COLOR = '#f6d860';                 // soft yellow tint
const WM_OPACITY = 0.55;
// ─────────────────────────────────────────────────────────────────────

export const Polaroid: React.FC<PolaroidProps> = ({
  photo,
  className = '',
  style = {},
  size = 'normal'
}) => {
  const currentImage = photo.imageUrl
    ? photo.imageUrl
    : (photo.images && photo.images.length > 0 ? photo.images[0] : '');

  const isSmall = size === 'small';
  const fontSize = isSmall ? 18 : 26;
  const textOnlyFontSize = isSmall ? 22 : 32;

  const cardClip = `card-clip-${photo.id}`;
  const photoClip = `photo-clip-${photo.id}`;
  const wmTint = `wm-tint-${photo.id}`;

  return (
    <div
      className={`transform transition-transform hover:scale-105 duration-300 ${className}`}
      style={{
        ...style,
        transform: `rotate(${photo.rotation}deg)`,
      }}
    >
      <svg
        viewBox={`0 0 ${CARD_W} ${CARD_H}`}
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-auto"
        style={{ overflow: 'visible' }}
      >
        <defs>
          <filter id="polaroid-shadow" x="-5%" y="-5%" width="115%" height="115%">
            <feDropShadow dx="0" dy="2" stdDeviation="6" floodColor="#000" floodOpacity="0.25" />
          </filter>
          {/* Recolor the white butterfly PNG into a soft beige watermark */}
          <filter id={wmTint}>
            <feFlood floodColor={WM_COLOR} result="flood" />
            <feComposite in="flood" in2="SourceGraphic" operator="in" />
          </filter>
          <clipPath id={cardClip}>
            <rect x={0} y={0} width={CARD_W} height={CARD_H} rx={CARD_RX} />
          </clipPath>
          <clipPath id={photoClip}>
            <rect x={PHOTO_X} y={PHOTO_Y} width={PHOTO_W} height={PHOTO_H} rx={PHOTO_RX} />
          </clipPath>
        </defs>

        {/* ── Card Background ── */}
        <rect
          x={0} y={0}
          width={CARD_W} height={CARD_H}
          rx={CARD_RX}
          fill="white"
          filter="url(#polaroid-shadow)"
        />

        {/* ── Everything clipped to the card (watermark, etc.) ── */}
        <g clipPath={`url(#${cardClip})`}>
          {/* Butterfly watermark in the bottom-right corner */}
          <image
            href="/butterfly.png"
            x={WM_X}
            y={WM_Y}
            width={WM_SIZE}
            height={WM_SIZE}
            opacity={WM_OPACITY}
            filter={`url(#${wmTint})`}
            preserveAspectRatio="xMidYMid meet"
          />
        </g>

        {/* ── Photo Area ── */}
        {currentImage && (
          <g clipPath={`url(#${photoClip})`}>
            <rect x={PHOTO_X} y={PHOTO_Y} width={PHOTO_W} height={PHOTO_H} fill="#f3f4f6" />
            <image
              href={currentImage}
              x={PHOTO_X} y={PHOTO_Y}
              width={PHOTO_W} height={PHOTO_H}
              preserveAspectRatio="xMidYMid slice"
            />
            {photo.signature && (
              <image
                href={photo.signature}
                x={PHOTO_X} y={PHOTO_Y}
                width={PHOTO_W} height={PHOTO_H}
                preserveAspectRatio="xMidYMid meet"
                opacity={0.9}
              />
            )}
          </g>
        )}

        {/* ── Caption ── */}
        <foreignObject
          x={0}
          y={currentImage ? CAPTION_Y : PAD}
          width={CARD_W}
          height={currentImage ? CAPTION_H : CARD_H - PAD * 2}
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{
              fontFamily: "'Caveat', cursive",
              fontSize: currentImage ? fontSize : textOnlyFontSize,
              color: '#1f2937',
              lineHeight: 1.2,
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              padding: '4px',
              wordBreak: 'break-word',
              overflow: 'hidden',
            }}
          >
            {photo.caption}
          </div>
        </foreignObject>

        {/* ── Tape (decorative, top center) ── */}
        <rect
          x={TAPE_X}
          y={TAPE_Y}
          width={TAPE_W}
          height={TAPE_H}
          fill="#d8cfbf"
          opacity={0.55}
          transform={`rotate(-3 ${CARD_W / 2} ${TAPE_Y + TAPE_H / 2})`}
        />
      </svg>
    </div>
  );
};
