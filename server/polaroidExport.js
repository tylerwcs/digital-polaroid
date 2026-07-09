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

// —— Rounded card + washi tape (mirrors components/Polaroid.tsx, at 2x) ——
const CARD_MARGIN = 20;   // transparent breathing room for tape overhang, shadow & rotation
const CARD_RADIUS = 20;   // ~ rounded-[10px] * 2
const PHOTO_RADIUS = 8;   // ~ rounded-[4px] * 2
const TAPE_W = 160;       // ~ w-20 * 2
const TAPE_H = 48;        // ~ h-6 * 2
const TAPE_RADIUS = 4;
const TAPE_OVERHANG = 14; // how far the tape rises above the card's top edge
const TAPE_ROTATION_DEG = -3;
const TAPE_FILL = 'rgba(216, 207, 191, 0.6)';

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
  // Transparent background so the rounded corners / margins stay clear.
  octx.translate(outW / 2, outH / 2);
  octx.rotate(rad);
  octx.drawImage(sourceCanvas, -w / 2, -h / 2);
  return out;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// Decorative washi tape, rotated slightly and centered on (cx, topY).
function drawTape(ctx, cx, topY) {
  ctx.save();
  ctx.translate(cx, topY + TAPE_H / 2);
  ctx.rotate((TAPE_ROTATION_DEG * Math.PI) / 180);
  roundRectPath(ctx, -TAPE_W / 2, -TAPE_H / 2, TAPE_W, TAPE_H, TAPE_RADIUS);
  ctx.fillStyle = TAPE_FILL;
  ctx.fill();
  // Soft sheen so the flat strip reads as tape.
  const sheen = ctx.createLinearGradient(-TAPE_W / 2, 0, TAPE_W / 2, 0);
  sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = sheen;
  ctx.fill();
  ctx.restore();
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
  let cardH = 0;
  const cardW = POLAROID_OUTER_W;

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
    cardH = PAD_TOP + frameH + GAP_IMG_CAPTION + captionH + PAD_BOTTOM;
  } else {
    measureCtx.font = captionFont(FONT_SIZE_TEXT_ONLY);
    const lineHeight = Math.round(FONT_SIZE_TEXT_ONLY * 1.15);
    const { height: captionH } = measureCaptionBlock(
      measureCtx,
      caption,
      innerW - 16,
      lineHeight
    );
    cardH =
      PAD_TOP + CAPTION_ONLY_INNER_PY + captionH + CAPTION_ONLY_INNER_PY + PAD_BOTTOM;
  }

  const cardX = CARD_MARGIN;
  const cardY = CARD_MARGIN;
  const canvasW = cardW + CARD_MARGIN * 2;
  const canvasH = cardH + CARD_MARGIN * 2;

  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');

  // Rounded white card with a soft drop shadow (transparent outside the corners).
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 5;
  roundRectPath(ctx, cardX, cardY, cardW, cardH, CARD_RADIUS);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  if (photoImg) {
    const frameX = cardX + PAD_X;
    const frameY = cardY + PAD_TOP;
    // Rounded photo frame — clip so the image corners round too.
    ctx.save();
    roundRectPath(ctx, frameX, frameY, innerW, frameH, PHOTO_RADIUS);
    ctx.clip();
    ctx.fillStyle = FRAME_BG;
    ctx.fillRect(frameX, frameY, innerW, frameH);
    drawImageFitWidth(ctx, photoImg, frameX, frameY, innerW);
    if (sigImg) {
      drawSignatureContain(ctx, sigImg, frameX, frameY, innerW, frameH);
    }
    ctx.restore();
    // Border on top of the clipped image.
    roundRectPath(ctx, frameX, frameY, innerW, frameH, PHOTO_RADIUS);
    ctx.strokeStyle = FRAME_BORDER;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = captionFont(FONT_SIZE_HAS_IMAGE);
    ctx.fillStyle = CAPTION_COLOR;
    ctx.textBaseline = 'top';
    const lineHeight = Math.round(FONT_SIZE_HAS_IMAGE * 1.15);
    const { lines } = measureCaptionBlock(ctx, caption, innerW - 8, lineHeight);
    let cy = cardY + PAD_TOP + frameH + GAP_IMG_CAPTION;
    const centerX = cardX + cardW / 2;
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
    let cy = cardY + PAD_TOP + CAPTION_ONLY_INNER_PY;
    const centerX = cardX + cardW / 2;
    lines.forEach((line) => {
      const lw = ctx.measureText(line).width;
      ctx.fillText(line, centerX - lw / 2, cy);
      cy += lineHeight;
    });
  }

  // Decorative washi tape straddling the card's top edge.
  drawTape(ctx, cardX + cardW / 2, cardY - TAPE_OVERHANG);

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

// —— Download composite (polaroid centered on a branded background) ——
const DL_POLAROID_WIDTH_FRACTION = 0.62;      // polaroid width vs background width
const DL_POLAROID_MAX_HEIGHT_FRACTION = 0.70; // cap so tall (text-only) cards still fit
const DL_POLAROID_CENTER_Y_FRACTION = 0.54;   // vertical center within the open area

/**
 * Render the polaroid for `photo` and composite it centered onto `bgBuffer`.
 * Output matches the background's native dimensions.
 * @param {object} photo - server photo record
 * @param {Buffer} bgBuffer - the download background image bytes
 * @param {object} deps - same deps as renderPolaroidPng
 * @returns {Promise<Buffer>} PNG
 */
export async function renderPolaroidDownload(photo, bgBuffer, deps) {
  const polaroidBuf = await renderPolaroidPng(photo, deps);
  const [bg, polaroid] = await Promise.all([loadImage(bgBuffer), loadImage(polaroidBuf)]);

  const canvas = createCanvas(bg.width, bg.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bg, 0, 0, bg.width, bg.height);

  let targetW = Math.round(bg.width * DL_POLAROID_WIDTH_FRACTION);
  let scale = targetW / polaroid.width;
  let drawH = Math.round(polaroid.height * scale);
  const maxH = Math.round(bg.height * DL_POLAROID_MAX_HEIGHT_FRACTION);
  if (drawH > maxH) {
    drawH = maxH;
    scale = drawH / polaroid.height;
    targetW = Math.round(polaroid.width * scale);
  }
  const x = Math.round((bg.width - targetW) / 2);
  const y = Math.round(bg.height * DL_POLAROID_CENTER_Y_FRACTION - drawH / 2);
  ctx.drawImage(polaroid, x, y, targetW, drawH);

  return canvas.toBuffer('image/png');
}
