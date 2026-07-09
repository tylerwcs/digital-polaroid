import { io } from 'socket.io-client';
import { PhotoEntry, WallSettings, WALL_SETTINGS_DEFAULTS } from '../types';

const parseNumberEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isLoopbackHost = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '[::1]' ||
  hostname.endsWith('.localhost');

const getApiUrl = () => {
  // If window is not defined (SSR), assume local backend
  if (typeof window === 'undefined') return `http://localhost:3000`;
  const { hostname, origin } = window.location;
  // Local dev: Vite (5173) talks to the API on :3000.
  if (isLoopbackHost(hostname)) return `http://${hostname}:3000`;
  // Production single-service (e.g. Railway): API is served from the same origin.
  return origin;
};

// Prefer explicit API URL for deployed environments (e.g. Render),
// fall back to local dev assumption.
const API_URL = (import.meta.env.VITE_API_URL || getApiUrl()).replace(/\/+$/, '');
const socket = io(API_URL);

const MAX_CLIENT_FILE_BYTES = parseNumberEnv(import.meta.env.VITE_MAX_UPLOAD_BYTES, 4 * 1024 * 1024);
const MAX_CLIENT_FILE_MB = Math.round((MAX_CLIENT_FILE_BYTES / (1024 * 1024)) * 10) / 10;

// Resolve a possibly-relative/loopback URL to an absolute URL against the API base.
const toAbsoluteUrl = (url: string): string => {
  if (!url || url.startsWith('data:')) return url;

  const apiBase = API_URL.replace(/\/+$/, '');

  const upgradeToHttpsIfNeeded = (u: string) => {
    if (typeof window === 'undefined') return u;
    if (window.location.protocol !== 'https:') return u;
    if (u.startsWith('http://')) {
      return `https://${u.slice('http://'.length)}`;
    }
    return u;
  };

  try {
    let out = url.trim();
    if (/^https?:\/\//i.test(out)) {
      const parsed = new URL(out);
      // Only rewrite loopback URLs (e.g. bad data from dev). Do not force every absolute
      // URL onto the API base — that breaks production when the API host differs from the
      // static site and would replace a correct API URL with the wrong origin.
      if (isLoopbackHost(parsed.hostname)) {
        const apiOrigin = new URL(apiBase).origin;
        out = `${apiOrigin}${parsed.pathname}${parsed.search}`;
      }
      return upgradeToHttpsIfNeeded(out);
    }
    return upgradeToHttpsIfNeeded(new URL(out, apiBase).toString());
  } catch {
    return url;
  }
};

const toAbsoluteImageUrl = (photo: PhotoEntry): PhotoEntry => {
  if (!photo?.imageUrl) return photo;
  const imageUrl = toAbsoluteUrl(photo.imageUrl);
  return imageUrl === photo.imageUrl ? photo : { ...photo, imageUrl };
};

const normalizePhotoCollection = (items: PhotoEntry[]): PhotoEntry[] =>
  items.map((item) => toAbsoluteImageUrl(item));

export interface SavePhotoResult {
  success: boolean;
  error?: string;
  photo?: PhotoEntry;
}

export const getPhotos = async (): Promise<PhotoEntry[]> => {
  try {
    const res = await fetch(`${API_URL}/api/photos`);
    if (!res.ok) throw new Error('Failed to fetch photos');
    const data = await res.json();
    return normalizePhotoCollection(data);
  } catch (e) {
    console.error("Failed to load photos from server", e);
    return [];
  }
};

export const savePhoto = async (photo: PhotoEntry): Promise<SavePhotoResult> => {
  try {
    const res = await fetch(`${API_URL}/api/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(photo),
    });

    if (!res.ok) {
      let message = 'Failed to save photo. Please try again.';
      try {
        const payload = await res.json();
        if (payload?.error) message = payload.error;
      } catch {
        // Ignore JSON parse errors
      }
      return { success: false, error: message };
    }

    let payload: { photo?: PhotoEntry } | null = null;
    try {
      payload = await res.json();
    } catch {
      // Some deployments may not return a body; that's fine
    }

    const normalizedPhoto = payload?.photo ? toAbsoluteImageUrl(payload.photo) : undefined;
    return { success: true, photo: normalizedPhoto };
  } catch (e) {
    console.error("Error saving photo to server", e);
    const message = e instanceof Error ? e.message : 'Unable to reach server';
    return { success: false, error: message };
  }
};

export const deletePhoto = async (id: string): Promise<boolean> => {
  try {
    const res = await fetch(`${API_URL}/api/photos/${id}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (e) {
    console.error("Error deleting photo", e);
    return false;
  }
};

export const downloadAllPhotos = async (): Promise<{ success: boolean; error?: string }> => {
  try {
    const response = await fetch(`${API_URL}/api/photos/download-all`);
    if (!response.ok) {
      let message = 'Failed to download photos';
      try {
        const payload = await response.json();
        if (payload?.error) {
          message = payload.error;
        }
      } catch {
        // Ignore JSON parse failures for non-JSON error bodies
      }
      return { success: false, error: message };
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const contentDisposition = response.headers.get('content-disposition') || '';
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
    const filename = filenameMatch?.[1] || `digital-polaroid-photos-${Date.now()}.zip`;

    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);

    return { success: true };
  } catch (error) {
    console.error('Error downloading all photos', error);
    return { success: false, error: 'Unable to reach server' };
  }
};

export const subscribeToUpdates = (callback: (photo: PhotoEntry) => void) => {
  const handler = (photo: PhotoEntry) => {
    callback(toAbsoluteImageUrl(photo));
  };
  socket.on('new_photo', handler);
  return () => {
    socket.off('new_photo', handler);
  };
};

export const subscribeToDelete = (callback: (id: string) => void) => {
  socket.on('delete_photo', callback);
  return () => {
    socket.off('delete_photo', callback);
  };
};

// Fill in defaults and resolve a custom background's image URL to absolute.
// Applied to BOTH the initial fetch and the live socket push so a broadcast can't
// clobber a resolved URL with the server's raw relative path (split-host safety).
const hydrateWallSettings = (data: Partial<WallSettings>): WallSettings => {
  const merged = { ...WALL_SETTINGS_DEFAULTS, ...data } as WallSettings;
  if (merged.background?.type === 'custom' && merged.background.value) {
    merged.background = { type: 'custom', value: toAbsoluteUrl(merged.background.value) };
  }
  return merged;
};

export const getWallSettings = async (): Promise<WallSettings> => {
  try {
    const res = await fetch(`${API_URL}/api/settings`);
    if (!res.ok) throw new Error('Failed to fetch settings');
    const data = await res.json();
    return hydrateWallSettings(data);
  } catch (e) {
    console.error('Failed to load wall settings', e);
    return { ...WALL_SETTINGS_DEFAULTS };
  }
};

export const saveWallSettings = async (
  settings: Partial<WallSettings>
): Promise<{ success: boolean; error?: string; settings?: WallSettings }> => {
  try {
    const res = await fetch(`${API_URL}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) return { success: false, error: 'Failed to save settings' };
    const data = await res.json();
    return { success: true, settings: data };
  } catch (e) {
    console.error('Error saving wall settings', e);
    return { success: false, error: 'Unable to reach server' };
  }
};

export const subscribeToSettings = (callback: (settings: WallSettings) => void) => {
  const handler = (settings: Partial<WallSettings>) => {
    callback(hydrateWallSettings(settings));
  };
  socket.on('settings_update', handler);
  return () => {
    socket.off('settings_update', handler);
  };
};

export const uploadBackground = async (
  dataUrl: string
): Promise<{ success: boolean; url?: string; error?: string }> => {
  try {
    const res = await fetch(`${API_URL}/api/background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    if (!res.ok) {
      let message = 'Failed to upload background';
      try {
        const payload = await res.json();
        if (payload?.error) message = payload.error;
      } catch {
        // ignore non-JSON error bodies
      }
      return { success: false, error: message };
    }
    const data = await res.json();
    return { success: true, url: toAbsoluteUrl(data.url) };
  } catch (e) {
    console.error('Error uploading background', e);
    return { success: false, error: 'Unable to reach server' };
  }
};

// Helper to compress images before storage
export const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_CLIENT_FILE_BYTES) {
      return reject(
        new Error(`Image exceeds ${MAX_CLIENT_FILE_MB}MB limit. Please choose a smaller photo.`)
      );
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 600; // Resize to max width 600px
        const scaleSize = img.width ? Math.min(1, MAX_WIDTH / img.width) : 1;
        canvas.width = Math.min(MAX_WIDTH, img.width || MAX_WIDTH);
        canvas.height = img.height * scaleSize;
        
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Compress to JPEG 0.65 quality
        const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
        const approxBytes = Math.ceil(((dataUrl.split(',')[1]?.length || 0) * 3) / 4);

        if (approxBytes > MAX_CLIENT_FILE_BYTES) {
          return reject(
            new Error(`Photo is still larger than ${MAX_CLIENT_FILE_MB}MB after compression.`)
          );
        }

        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};