import { io } from 'socket.io-client';
import { PendingPhoto, PhotoEntry } from '../types';

const parseNumberEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getApiUrl = () => {
  // If window is not defined (SSR), assume local backend
  if (typeof window === 'undefined') return `http://localhost:3000`;
  const hostname = window.location.hostname;
  return `http://${hostname}:3000`;
};

// Prefer explicit API URL for deployed environments (e.g. Render),
// fall back to local dev assumption.
const API_URL = (import.meta.env.VITE_API_URL || getApiUrl()).replace(/\/+$/, '');
const socket = io(API_URL);

const MAX_CLIENT_FILE_BYTES = parseNumberEnv(import.meta.env.VITE_MAX_UPLOAD_BYTES, 4 * 1024 * 1024);
const MAX_CLIENT_FILE_MB = Math.round((MAX_CLIENT_FILE_BYTES / (1024 * 1024)) * 10) / 10;

const isLoopbackHost = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '[::1]' ||
  hostname.endsWith('.localhost');

const toAbsoluteImageUrl = <T extends { imageUrl?: string }>(photo: T): T => {
  if (!photo?.imageUrl || photo.imageUrl.startsWith('data:')) {
    return photo;
  }

  const apiBase = API_URL.replace(/\/+$/, '');

  const upgradeToHttpsIfNeeded = (url: string) => {
    if (typeof window === 'undefined') return url;
    if (window.location.protocol !== 'https:') return url;
    if (url.startsWith('http://')) {
      return `https://${url.slice('http://'.length)}`;
    }
    return url;
  };

  try {
    let imageUrl = photo.imageUrl.trim();

    if (/^https?:\/\//i.test(imageUrl)) {
      const parsed = new URL(imageUrl);
      // Only rewrite loopback URLs (e.g. bad data from dev). Do not force every absolute
      // URL onto VITE_API_URL — that breaks production when the API host differs from the
      // static site (Render) and would replace a correct API URL with the wrong origin.
      if (isLoopbackHost(parsed.hostname)) {
        const apiOrigin = new URL(apiBase).origin;
        imageUrl = `${apiOrigin}${parsed.pathname}${parsed.search}`;
      }
      return { ...photo, imageUrl: upgradeToHttpsIfNeeded(imageUrl) } as T;
    }

    const absolute = new URL(imageUrl, apiBase).toString();
    return { ...photo, imageUrl: upgradeToHttpsIfNeeded(absolute) } as T;
  } catch {
    return photo;
  }
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

export interface SavePendingInput {
  id: string;
  image: string;      // base64 data URL
  rotation: number;
  timestamp: number;
}

export interface PendingResult {
  success: boolean;
  error?: string;
  // The server reported 404: this photo is no longer in the queue (already
  // committed, discarded, or otherwise gone). Distinct from a retryable
  // failure — the caller can safely drop it instead of leaving it stuck.
  gone?: boolean;
}

const readError = async (res: Response, fallback: string): Promise<string> => {
  try {
    const payload = await res.json();
    if (payload?.error) return payload.error as string;
  } catch {
    // Non-JSON error body; use the fallback
  }
  return fallback;
};

// Phone: hand a freshly captured photo to the signing queue.
export const savePending = async (entry: SavePendingInput): Promise<PendingResult> => {
  try {
    const res = await fetch(`${API_URL}/api/pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });

    if (!res.ok) {
      return { success: false, error: await readError(res, 'Failed to send the photo. Please try again.') };
    }
    return { success: true };
  } catch (e) {
    console.error('Error sending photo to the signing queue', e);
    return { success: false, error: e instanceof Error ? e.message : 'Unable to reach server' };
  }
};

// iPad: current signing queue, oldest first.
export const getPending = async (): Promise<PendingPhoto[]> => {
  try {
    const res = await fetch(`${API_URL}/api/pending`);
    if (!res.ok) throw new Error('Failed to fetch the signing queue');
    const data: PendingPhoto[] = await res.json();
    return data.map(toAbsoluteImageUrl);
  } catch (e) {
    console.error('Failed to load the signing queue', e);
    return [];
  }
};

// iPad: sign off and send to the wall. `signature` is optional.
export const commitPending = async (id: string, signature?: string): Promise<PendingResult> => {
  try {
    const res = await fetch(`${API_URL}/api/pending/${id}/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature }),
    });

    if (!res.ok) {
      const error = await readError(res, 'Failed to upload to the wall. Please try again.');
      return { success: false, gone: res.status === 404, error };
    }
    return { success: true };
  } catch (e) {
    console.error('Error committing pending photo', e);
    return { success: false, error: e instanceof Error ? e.message : 'Unable to reach server' };
  }
};

// iPad: throw the photo away without sending it to the wall.
export const discardPending = async (id: string): Promise<PendingResult> => {
  try {
    const res = await fetch(`${API_URL}/api/pending/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const error = await readError(res, 'Failed to discard the photo.');
      return { success: false, gone: res.status === 404, error };
    }
    return { success: true };
  } catch (e) {
    console.error('Error discarding pending photo', e);
    return { success: false, error: e instanceof Error ? e.message : 'Unable to reach server' };
  }
};

// iPad: push the photo to the back of the queue.
export const skipPending = async (id: string): Promise<PendingResult> => {
  try {
    const res = await fetch(`${API_URL}/api/pending/${id}/skip`, { method: 'POST' });
    if (!res.ok) {
      const error = await readError(res, 'Failed to skip the photo.');
      return { success: false, gone: res.status === 404, error };
    }
    return { success: true };
  } catch (e) {
    console.error('Error skipping pending photo', e);
    return { success: false, error: e instanceof Error ? e.message : 'Unable to reach server' };
  }
};

export interface PendingSubscribers {
  onAdded: (photo: PendingPhoto) => void;
  onRemoved: (id: string) => void;
  onReordered: (queue: PendingPhoto[]) => void;
}

export const subscribeToPending = (handlers: PendingSubscribers) => {
  const added = (photo: PendingPhoto) => handlers.onAdded(toAbsoluteImageUrl(photo));
  const removed = (id: string) => handlers.onRemoved(id);
  const reordered = (queue: PendingPhoto[]) => handlers.onReordered(queue.map(toAbsoluteImageUrl));

  socket.on('pending_added', added);
  socket.on('pending_removed', removed);
  socket.on('pending_reordered', reordered);

  return () => {
    socket.off('pending_added', added);
    socket.off('pending_removed', removed);
    socket.off('pending_reordered', reordered);
  };
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