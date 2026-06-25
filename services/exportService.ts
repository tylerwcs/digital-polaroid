const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  return `http://${window.location.hostname}:3000`;
};

const API_URL = (import.meta.env.VITE_API_URL || getApiUrl()).replace(/\/+$/, '');

/**
 * Send a composited bubble PNG to the server and get back the rendered mp4 blob.
 * `photoId` is used only for the download filename.
 */
export const requestBubbleVideo = async (
  bubblePng: string,
  photoId?: string,
): Promise<Blob> => {
  const res = await fetch(`${API_URL}/api/export-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bubblePng, photoId }),
  });

  if (!res.ok) {
    let message = 'Could not create the video. Please try again.';
    try {
      const payload = await res.json();
      if (payload?.error) message = payload.error;
    } catch {
      // non-JSON error body; keep default message
    }
    throw new Error(message);
  }

  return res.blob();
};

/** Trigger a browser download of a blob. */
export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
