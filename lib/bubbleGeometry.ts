// Shared geometry for the bubble visual frame. Used by BubbleFrame (display),
// the wall Bubble (signature placement), and the upload signing canvas — so the
// preview and the wall render identically by construction.

// Photo circle diameter as a fraction of the full bubble diameter (leaves room for the glass rim).
export const PHOTO_INSET_RATIO = 0.78;

// Signature band, expressed as fractions of the PHOTO CIRCLE (not the full bubble):
// full width, occupying the bottom BAND_HEIGHT_RATIO of the circle, bottom-aligned.
export const SIGNATURE_BAND_HEIGHT_RATIO = 0.4;

export interface Box {
  width: number;
  height: number;
}

// Pixel size of the photo circle for a given bubble diameter.
export const photoCircleSize = (bubbleDiameter: number): number =>
  bubbleDiameter * PHOTO_INSET_RATIO;

// Pixel box of the signature band for a given photo-circle size.
// Width = full circle; height = bottom BAND_HEIGHT_RATIO of the circle.
export const signatureBandBox = (photoCircleSizePx: number): Box => ({
  width: photoCircleSizePx,
  height: photoCircleSizePx * SIGNATURE_BAND_HEIGHT_RATIO,
});
