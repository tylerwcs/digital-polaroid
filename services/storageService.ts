import { io } from 'socket.io-client';
import { PhotoEntry } from '../types';

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

const toAbsoluteImageUrl = (photo: PhotoEntry): PhotoEntry => {
  if (!photo?.imageUrl || /^https?:\/\//i.test(photo.imageUrl)) {
    return photo;
  }
  try {
    const absolute = new URL(photo.imageUrl, API_URL).toString();
    return { ...photo, imageUrl: absolute };
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