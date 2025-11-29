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
  // Check if we have an image
  const currentImage = photo.images && photo.images.length > 0 
    ? photo.images[0] 
    : '';

  // Size-based classes
  const containerPadding = size === 'small' ? 'p-2 pb-6' : 'p-3 pb-12';
  const textSize = size === 'small' 
    ? (currentImage ? 'text-xl' : 'text-2xl py-4') 
    : (currentImage ? 'text-3xl' : 'text-4xl py-8');

  return (
    <div 
      className={`bg-white ${containerPadding} shadow-xl text-black transform transition-transform hover:scale-105 duration-300 ${className}`}
      style={{
        ...style,
        transform: `rotate(${photo.rotation}deg)`,
      }}
    >
      {/* 
        Image Area
        Only render if an image exists.
      */}
      {currentImage && (
        <div className="w-full mb-4 bg-gray-100 border border-gray-200">
          <img 
            src={currentImage} 
            alt={photo.caption} 
            className="w-full h-auto block"
          />
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
