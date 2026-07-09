
export interface PhotoEntry {
  id: string;
  images?: string[]; // Optional: only present on client before upload
  imageUrl?: string; // Resolved URL served by backend
  caption: string;
  timestamp: number;
  author?: string;
  signature?: string; // Optional base64 signature
  rotation: number; // Random rotation for visual interest
}

export type WallBackground =
  | { type: 'preset'; value: string }
  | { type: 'color'; value: string }
  | { type: 'custom'; value: string };

export const DEFAULT_BACKGROUND: WallBackground = { type: 'preset', value: 'generali-boomerang' };

export interface WallSettings {
  maxColumns: number;
  polaroidWidth: number;
  background: WallBackground;
}

// Client copy of the server defaults/bounds (crosses the ts/js boundary, so kept
// in sync with server/settings.js by hand — only four numbers).
export const WALL_SETTINGS_DEFAULTS: WallSettings = {
  maxColumns: 6,
  polaroidWidth: 180,
  background: DEFAULT_BACKGROUND,
};

export const WALL_SETTINGS_BOUNDS = {
  maxColumns: { min: 1, max: 8 },
  polaroidWidth: { min: 100, max: 320 },
} as const;
