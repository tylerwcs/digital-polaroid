import React from 'react';
import { PhotoEntry } from '../types';

interface PolaroidProps {
  photo: PhotoEntry;
  className?: string;
  style?: React.CSSProperties;
  size?: 'normal' | 'small';
}

export const Polaroid: React.FC<PolaroidProps> = ({
  photo,
  className = '',
  style = {},
  size = 'normal'
}) => {
  // Prefer server-served image URL; fall back to any inline base64
  const currentImage = photo.imageUrl
    ? photo.imageUrl
    : (photo.images && photo.images.length > 0 ? photo.images[0] : '');

  const isSmall = size === 'small';

  // Size-based classes
  const containerPadding = isSmall ? 'p-2 pb-6' : 'p-3 pb-12';
  const textSize = isSmall
    ? (currentImage ? 'text-xl' : 'text-2xl py-4')
    : (currentImage ? 'text-3xl' : 'text-4xl py-8');
  // Tape strip scales a little with the card size
  const tapeSize = isSmall ? 'w-12 h-3.5' : 'w-20 h-6';

  return (
    <div
      className={`relative bg-white rounded-[10px] ${containerPadding} shadow-xl text-black transform transition-transform hover:scale-105 duration-300 ${className}`}
      style={{
        ...style,
        transform: `rotate(${photo.rotation}deg)`,
      }}
    >
      {/* Decorative washi tape, straddling the top edge */}
      <div
        aria-hidden="true"
        className={`absolute left-1/2 -top-2 -translate-x-1/2 -rotate-3 ${tapeSize} rounded-[2px] pointer-events-none`}
        style={{
          backgroundColor: 'rgba(216, 207, 191, 0.6)',
          // Soft sheen + faint edges so the flat strip reads as tape
          backgroundImage:
            'linear-gradient(105deg, rgba(255,255,255,0.25), rgba(255,255,255,0) 45%, rgba(0,0,0,0.06))',
          boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
        }}
      />

      {/*
        Image Area
        Only render if an image exists.
      */}
      {currentImage && (
        <div className="w-full mb-4 bg-gray-100 border border-gray-200 rounded-[4px] overflow-hidden relative">
          <img
            src={currentImage}
            alt={photo.caption}
            className="w-full h-auto block"
          />
          {/* Signature Area Over Photo */}
          {photo.signature && (
            <img
              src={photo.signature}
              alt="Signature"
              className="absolute inset-0 w-full h-full object-contain opacity-90 pointer-events-none"
              style={{ filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.4))' }}
            />
          )}
        </div>
      )}

      {/* Caption Area */}
      <div
        className={`font-marker text-center leading-tight px-2 text-gray-800 break-words ${textSize}`}
      >
        {photo.caption}
      </div>
    </div>
  );
};
