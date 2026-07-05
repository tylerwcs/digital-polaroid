import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

const require = createRequire(import.meta.url);

/** ~max-w-[280px] on wall, 2x for export */
const POLAROID_OUTER_W = 560;
const PAD_X = 24; // p-3 * 2
const PAD_TOP = 24;
const PAD_BOTTOM = 96; // pb-12 * 2
const GAP_IMG_CAPTION = 32; // mb-4 * 2
const FRAME_BG = '#f3f4f6';
const FRAME_BORDER = '#e5e7eb';
const CAPTION_COLOR = '#1f2937';
const FONT_FAMILY = 'Caveat';
const EMOJI_FONT_FAMILY = 'Noto Color Emoji';
const FONT_SIZE_HAS_IMAGE = 60; // ~ text-3xl * 2
const FONT_SIZE_TEXT_ONLY = 72; // ~ text-4xl * 2
const CAPTION_ONLY_INNER_PY = 64; // py-8 * 2

/** Caveat for marker text + Noto Color Emoji so captions match the browser (emoji fallback). */
const captionFont = (sizePx) =>
  `700 ${sizePx}px ${FONT_FAMILY}, "${EMOJI_FONT_FAMILY}"`;

let captionFontsRegistered = false;

/**
 * Locate a @fontsource woff2 file. The fonts may be installed in the root
 * node_modules (Railway single-service install) OR in server/node_modules
 * (local `cd server && npm install`), so try node resolution first and fall
 * back to explicit locations. Returns the first path that exists, or null.
 */
async function findFontFile(serverDir, pkg, file) {
  const candidates = [];
  try {
    // Node resolution — finds it in root/server/hoisted node_modules alike.
    candidates.push(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'files', file));
  } catch { /* package.json not resolvable via exports; use explicit paths */ }
  candidates.push(path.join(serverDir, 'node_modules', pkg, 'files', file));       // server install
  candidates.push(path.join(serverDir, '..', 'node_modules', pkg, 'files', file));  // root install

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch { /* try next */ }
  }
  return null;
}

async function ensureCaptionFonts(serverDir) {
  if (captionFontsRegistered) return;

  const caveatPath = await findFontFile(serverDir, '@fontsource/caveat', 'caveat-latin-700-normal.woff2');
  if (!caveatPath) {
    throw new Error('Caveat font not found (needs @fontsource/caveat installed).');
  }
  const emojiPath = await findFontFile(serverDir, '@fontsource/noto-color-emoji', 'noto-color-emoji-emoji-400-normal.woff2');
  if (!emojiPath) {
    throw new Error('Emoji font not found (needs @fontsource/noto-color-emoji installed).');
  }

  if (!GlobalFonts.registerFromPath(caveatPath, FONT_FAMILY)) {
    throw new Error(`Failed to register Caveat from ${caveatPath}`);
  }
  if (!GlobalFonts.registerFromPath(emojiPath, EMOJI_FONT_FAMILY)) {
    throw new Error(`Failed to register Noto Color Emoji from ${emojiPath}`);
  }
  captionFontsRegistered = true;
}

function wrapLines(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function measureCaptionBlock(ctx, caption, maxWidth, lineHeight) {
  const lines = wrapLines(ctx, caption, maxWidth);
  const height = Math.max(1, lines.length) * lineHeight;
  return { lines, height };
}

/**
 * Draw image scaled to width (like w-full h-auto). Returns drawn height.
 */
function drawImageFitWidth(ctx, img, x, y, targetW) {
  const scale = targetW / img.width;
  const h = Math.round(img.height * scale);
  ctx.drawImage(img, x, y, targetW, h);
  return h;
}

/**
 * Signature overlay: object-contain in photo rect
 */
function drawSignatureContain(ctx, sigImg, x, y, w, h) {
  const scale = Math.min(w / sigImg.width, h / sigImg.height);
  const dw = Math.round(sigImg.width * scale);
  const dh = Math.round(sigImg.height * scale);
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.drawImage(sigImg, dx, dy, dw, dh);
  ctx.restore();
}

function drawRotatedCard(sourceCanvas, rotationDeg) {
  const rad = (rotationDeg * Math.PI) / 180;
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const outW = Math.ceil(w * cos + h * sin);
  const outH = Math.ceil(w * sin + h * cos);
  const out = createCanvas(outW, outH);
  const octx = out.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, outW, outH);
  octx.translate(outW / 2, outH / 2);
  octx.rotate(rad);
  octx.drawImage(sourceCanvas, -w / 2, -h / 2);
  return out;
}

/**
 * @param {object} photo - server photo record
 * @param {object} deps
 * @param {string} deps.__dirname - server dir for font cache
 * @param {(p:string)=>string} deps.fullImagePath
 * @param {(uri:string)=>{buffer:Buffer,mime:string}|null} deps.decodeBase64Image
 */
export async function renderPolaroidPng(photo, deps) {
  const { __dirname: serverDir, fullImagePath, decodeBase64Image } = deps;
  await ensureCaptionFonts(serverDir);

  const innerW = POLAROID_OUTER_W - PAD_X * 2;
  const hasFile = Boolean(photo.storageFile);
  let photoImg = null;
  if (hasFile) {
    try {
      const buf = await fs.readFile(fullImagePath(photo.storageFile));
      photoImg = await loadImage(buf);
    } catch {
      photoImg = null;
    }
  }

  let sigImg = null;
  if (photo.signature && typeof photo.signature === 'string') {
    const decoded = decodeBase64Image(photo.signature);
    if (decoded?.buffer) {
      try {
        sigImg = await loadImage(decoded.buffer);
      } catch {
        sigImg = null;
      }
    }
  }

  const caption = typeof photo.caption === 'string' ? photo.caption : '';
  const rotation =
    typeof photo.rotation === 'number' && Number.isFinite(photo.rotation)
      ? photo.rotation
      : 0;

  // —— Layout ——
  let frameH = 0;
  let canvasH = 0;
  const canvasW = POLAROID_OUTER_W;

  const measureCtx = createCanvas(8, 8).getContext('2d');

  if (photoImg) {
    frameH = Math.max(1, Math.round(innerW * (photoImg.height / photoImg.width)));
    measureCtx.font = captionFont(FONT_SIZE_HAS_IMAGE);
    const lineHeight = Math.round(FONT_SIZE_HAS_IMAGE * 1.15);
    const { height: captionH } = measureCaptionBlock(
      measureCtx,
      caption,
      innerW - 8,
      lineHeight
    );
    canvasH = PAD_TOP + frameH + GAP_IMG_CAPTION + captionH + PAD_BOTTOM;
  } else {
    measureCtx.font = captionFont(FONT_SIZE_TEXT_ONLY);
    const lineHeight = Math.round(FONT_SIZE_TEXT_ONLY * 1.15);
    const { height: captionH } = measureCaptionBlock(
      measureCtx,
      caption,
      innerW - 16,
      lineHeight
    );
    canvasH =
      PAD_TOP + CAPTION_ONLY_INNER_PY + captionH + CAPTION_ONLY_INNER_PY + PAD_BOTTOM;
  }

  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  if (photoImg) {
    const frameX = PAD_X;
    const frameY = PAD_TOP;
    ctx.fillStyle = FRAME_BG;
    ctx.strokeStyle = FRAME_BORDER;
    ctx.lineWidth = 2;
    ctx.fillRect(frameX, frameY, innerW, frameH);
    ctx.strokeRect(frameX, frameY, innerW, frameH);
    drawImageFitWidth(ctx, photoImg, frameX, frameY, innerW);
    if (sigImg) {
      drawSignatureContain(ctx, sigImg, frameX, frameY, innerW, frameH);
    }
    ctx.font = captionFont(FONT_SIZE_HAS_IMAGE);
    ctx.fillStyle = CAPTION_COLOR;
    ctx.textBaseline = 'top';
    const lineHeight = Math.round(FONT_SIZE_HAS_IMAGE * 1.15);
    const { lines } = measureCaptionBlock(ctx, caption, innerW - 8, lineHeight);
    let cy = PAD_TOP + frameH + GAP_IMG_CAPTION;
    const centerX = canvasW / 2;
    lines.forEach((line) => {
      const lw = ctx.measureText(line).width;
      ctx.fillText(line, centerX - lw / 2, cy);
      cy += lineHeight;
    });
  } else {
    ctx.font = captionFont(FONT_SIZE_TEXT_ONLY);
    ctx.fillStyle = CAPTION_COLOR;
    ctx.textBaseline = 'top';
    const lineHeight = Math.round(FONT_SIZE_TEXT_ONLY * 1.15);
    const { lines } = measureCaptionBlock(ctx, caption, innerW - 16, lineHeight);
    let cy = PAD_TOP + CAPTION_ONLY_INNER_PY;
    const centerX = canvasW / 2;
    lines.forEach((line) => {
      const lw = ctx.measureText(line).width;
      ctx.fillText(line, centerX - lw / 2, cy);
      cy += lineHeight;
    });
  }

  const rotated =
    Math.abs(rotation) > 0.05 ? drawRotatedCard(canvas, rotation) : canvas;
  return rotated.toBuffer('image/png');
}

export function canExportPolaroid(photo) {
  if (!photo || typeof photo.id !== 'string') return false;
  if (photo.storageFile) return true;
  const cap = typeof photo.caption === 'string' ? photo.caption.trim() : '';
  return cap.length > 0;
}
