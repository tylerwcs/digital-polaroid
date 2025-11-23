import { PhotoEntry } from '../types';

const STORAGE_KEY = 'snapwall_photos';
const CHANNEL_NAME = 'snapwall_updates';

// Broadcast channel for communicating between tabs (Upload tab -> Display tab)
const broadcastChannel = new BroadcastChannel(CHANNEL_NAME);

export const getPhotos = (): PhotoEntry[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const parsed = JSON.parse(stored);
    
    // Data migration: Convert old single-image entries to array format
    return parsed.map((item: any) => {
      if (item.imageData && !item.images) {
        return {
          ...item,
          images: [item.imageData],
          // Remove old field if desired, or keep for safety. 
          // We construct a clean PhotoEntry here.
        } as PhotoEntry;
      }
      return item as PhotoEntry;
    });
  } catch (e) {
    console.error("Failed to load photos", e);
    return [];
  }
};

export const savePhoto = (photo: PhotoEntry): void => {
  const currentPhotos = getPhotos();
  // Keep only last 50 to prevent LocalStorage overflow
  const updatedPhotos = [photo, ...currentPhotos].slice(0, 50);
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedPhotos));
    // Notify other tabs
    broadcastChannel.postMessage({ type: 'NEW_PHOTO', payload: photo });
  } catch (e) {
    console.error("Storage full or error saving", e);
    // Emergency cleanup
    localStorage.setItem(STORAGE_KEY, JSON.stringify([photo]));
  }
};

export const subscribeToUpdates = (callback: (photo: PhotoEntry) => void) => {
  broadcastChannel.onmessage = (event) => {
    if (event.data && event.data.type === 'NEW_PHOTO') {
      callback(event.data.payload);
    }
  };
  return () => {
    broadcastChannel.onmessage = null;
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