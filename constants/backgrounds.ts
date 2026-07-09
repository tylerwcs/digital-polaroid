export interface BackgroundPreset {
  id: string;
  label: string;
  url: string;
  kind: 'video' | 'image';
}

// Only already-committed public/ assets are listed (deploy safety). The ids here
// MUST stay in sync with WALL_BACKGROUND_PRESET_IDS in server/settings.js.
export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: 'generali-boomerang', label: 'Generali (boomerang)', url: '/generali-bg-boomerang.mp4', kind: 'video' },
  { id: 'generali', label: 'Generali', url: '/generali-bg.mp4', kind: 'video' },
  { id: 'bg', label: 'Default BG', url: '/BG.mp4', kind: 'video' },
];

export const getPreset = (id: string): BackgroundPreset | undefined =>
  BACKGROUND_PRESETS.find((p) => p.id === id);
