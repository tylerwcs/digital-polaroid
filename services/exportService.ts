const isLoopbackHost = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '[::1]' ||
  hostname.endsWith('.localhost');

const getApiUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  const { hostname, origin } = window.location;
  // Local dev: Vite (5173) talks to the API on :3000.
  if (isLoopbackHost(hostname)) return `http://${hostname}:3000`;
  // Production single-service (e.g. Railway): API shares the page's origin.
  return origin;
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
