/**
 * Watercolour watermark palette + stable colour assignment.
 *
 * Shared by BOTH the React wall (components/Polaroid.tsx) and the server PNG
 * exporter (server/polaroidExport.js). Keep this the single source of truth so
 * the wall and the downloadable image always pick the same colour for a photo.
 *
 * Colours are pulled from the azpoa2 watercolour puzzle-piece background.
 */

/** @type {readonly string[]} */
export const WATERMARK_COLORS = [
  '#6b3fa0', // purple
  '#e0246e', // magenta
  '#1f6fc4', // blue
  '#f39019', // orange
  '#7cb342', // green
  '#22b0a8', // teal
];

/**
 * Stable 32-bit string hash (Math.imul keeps it identical across V8 client and
 * server). Do not "optimise" this — the exact algorithm is the contract that
 * makes the wall and the PNG agree.
 * @param {string} str
 * @returns {number}
 */
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Deterministically map a photo id to one of WATERMARK_COLORS.
 * @param {string|number} id
 * @returns {string} hex colour
 */
export function pickWatermarkColor(id) {
  const key = String(id);
  const idx = Math.abs(hashString(key)) % WATERMARK_COLORS.length;
  return WATERMARK_COLORS[idx];
}
