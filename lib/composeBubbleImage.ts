import { PhotoEntry } from '../types';
import { PHOTO_INSET_RATIO, SIGNATURE_BAND_HEIGHT_RATIO } from './bubbleGeometry';

// Load an image source as an untainted bitmap. Cross-origin photo URLs (served from
// the API origin, a different port than the page) would taint a canvas if drawn via
// a plain <img>, blocking toDataURL. Fetching as a blob first avoids the taint.
const loadBitmap = async (src: string): Promise<ImageBitmap> => {
  const res = await fetch(src);
  if (!res.ok) throw new Error('Failed to load image');
  const blob = await res.blob();
  return createImageBitmap(blob);
};

// Draw `bitmap` into a circle of diameter `size` at (cx, cy top-left = offset),
// cover-style (center-crop to fill the circle).
const drawCover = (
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  x: number,
  y: number,
  size: number,
) => {
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  const dx = x + (size - dw) / 2;
  const dy = y + (size - dh) / 2;
  ctx.drawImage(bitmap, dx, dy, dw, dh);
};

/**
 * Compose a PhotoEntry into a transparent square PNG (data URL) of the bubble:
 * circular photo + signature band + bubble.png rim — matching BubbleFrame exactly.
 */
export const composeBubbleImage = async (
  photo: PhotoEntry,
  size = 800,
): Promise<string> => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  const photoSize = size * PHOTO_INSET_RATIO;
  const photoOffset = (size - photoSize) / 2;

  const imageUrl = photo.imageUrl || (photo.images && photo.images[0]) || '';

  // 1. Photo, clipped to the circle
  if (imageUrl) {
    const photoBitmap = await loadBitmap(imageUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, photoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    drawCover(ctx, photoBitmap, photoOffset, photoOffset, photoSize);

    // 2. Signature in the bottom band (still inside the circular clip)
    if (photo.signature) {
      const sigBitmap = await loadBitmap(photo.signature);
      const bandH = photoSize * SIGNATURE_BAND_HEIGHT_RATIO;
      const bandTop = photoOffset + photoSize - bandH;
      // contain, bottom-centered
      const scale = Math.min(photoSize / sigBitmap.width, bandH / sigBitmap.height);
      const dw = sigBitmap.width * scale;
      const dh = sigBitmap.height * scale;
      const dx = photoOffset + (photoSize - dw) / 2;
      const dy = bandTop + (bandH - dh);
      ctx.drawImage(sigBitmap, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  // 3. Bubble rim overlay (full square, on top)
  const rim = await loadBitmap('/bubble.png');
  ctx.drawImage(rim, 0, 0, size, size);

  return canvas.toDataURL('image/png');
};
