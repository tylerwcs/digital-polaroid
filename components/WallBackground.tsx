import React from 'react';
import { WallBackground as WallBackgroundSetting } from '../types';
import { getPreset } from '../constants/backgrounds';

const COVER = 'pointer-events-none absolute inset-0 z-0 h-full w-full object-cover';

// Renders the wall-6 backdrop for the current background setting, over the page's
// black fallback. Keyed by source so switching remounts the media element.
export const WallBackground: React.FC<{ background: WallBackgroundSetting }> = ({ background }) => {
  if (background.type === 'color') {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{ backgroundColor: background.value }}
        aria-hidden
      />
    );
  }

  if (background.type === 'custom') {
    return <img key={background.value} src={background.value} className={COVER} alt="" aria-hidden />;
  }

  // preset
  const preset = getPreset(background.value);
  if (!preset) return null; // unknown id — black fallback shows
  if (preset.kind === 'image') {
    return <img key={preset.url} src={preset.url} className={COVER} alt="" aria-hidden />;
  }
  return (
    <video key={preset.url} className={COVER} autoPlay muted loop playsInline aria-hidden>
      <source src={preset.url} type="video/mp4" />
    </video>
  );
};
