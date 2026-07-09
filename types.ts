
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

export interface WallSettings {
  maxColumns: number;
  polaroidWidth: number;
}

// Client copy of the server defaults/bounds (crosses the ts/js boundary, so kept
// in sync with server/settings.js by hand — only four numbers).
export const WALL_SETTINGS_DEFAULTS: WallSettings = {
  maxColumns: 6,
  polaroidWidth: 180,
};

export const WALL_SETTINGS_BOUNDS = {
  maxColumns: { min: 1, max: 8 },
  polaroidWidth: { min: 100, max: 320 },
} as const;
