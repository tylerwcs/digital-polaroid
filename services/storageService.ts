import { io } from 'socket.io-client';
import { PhotoEntry } from '../types';

const getApiUrl = () => {
  // If window is not defined (SSR), assume local backend
  if (typeof window === 'undefined') return `http://localhost:3000`;
  const hostname = window.location.hostname;
  return `http://${hostname}:3000`;
};

// Prefer explicit API URL for deployed environments (e.g. Render),
// fall back to local dev assumption.
const API_URL = import.meta.env.VITE_API_URL || getApiUrl();
const socket = io(API_URL);

export const getPhotos = async (): Promise<PhotoEntry[]> => {
  try {
    const res = await fetch(`${API_URL}/api/photos`);
    if (!res.ok) throw new Error('Failed to fetch photos');
    return await res.json();
  } catch (e) {
    console.error("Failed to load photos from server", e);
    return [];
  }
};

export const savePhoto = async (photo: PhotoEntry): Promise<boolean> => {
  try {
    const res = await fetch(`${API_URL}/api/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(photo),
    });
    return res.ok;
  } catch (e) {
    console.error("Error saving photo to server", e);
    return false;
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
  socket.on('new_photo', callback);
  return () => {
    socket.off('new_photo', callback);
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
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 600; // Resize to max width 600px
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Compress to JPEG 0.7 quality
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};