import fs from 'fs/promises';
import path from 'path';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

/**
 * Server-side render that mirrors components/Polaroid.tsx.
 * The component is authored in a 320x400 viewBox; we render at 2x for crisp PNGs.
 */
const S = 2; // export scale factor

// ─── Layout (kept in sync with components/Polaroid.tsx) ───
const CARD_W = 320 * S;
const CARD_H = 400 * S;
const CARD_RX = 10 * S;
const PAD = 16 * S;
const PHOTO_X = PAD;
const PHOTO_Y = (16 + 8) * S;                 // extra top space (room for tape)
const PHOTO_W = (320 - 16 * 2) * S;           // 288 * S
const PHOTO_H = 280 * S;
const PHOTO_RX = 4 * S;
const CAPTION_Y = PHOTO_Y + PHOTO_H + 8 * S;
const CAPTION_H = CARD_H - CAPTION_Y - 8 * S;
// Tape
const TAPE_W = 70 * S;
const TAPE_H = 22 * S;
const TAPE_Y = -6 * S;
const TAPE_ROT_DEG = -3;
const TAPE_COLOR = '#d8cfbf';
const TAPE_OPACITY = 0.55;
// Butterfly watermark
const WM_SIZE = 300 * S;
const WM_X = (320 - 300 + 105) * S;           // overflow off the right
const WM_Y = (400 - 300 + 115) * S;           // overflow off the bottom
const WM_COLOR = '#f6d860';
const WM_OPACITY = 0.55;
// Caption typography
const FONT_SIZE_HAS_IMAGE = 26 * S;
const FONT_SIZE_TEXT_ONLY = 32 * S;
const CAPTION_COLOR = '#1f2937';
const FONT_FAMILY = 'Caveat';
const EMOJI_FONT_FAMILY = 'Noto Color Emoji';
// Card shadow / output margin
const OUT_MARGIN = 40;

const captionFont = (sizePx) =>
  `700 ${sizePx}px ${FONT_FAMILY}, "${EMOJI_FONT_FAMILY}"`;

let captionFontsRegistered = false;
let butterflyImgPromise = null;

async function ensureCaptionFonts(serverDir) {
  if (captionFontsRegistered) return;
  const caveatPath = path.join(
    serverDir,
    'node_modules',
    '@fontsource',
    'caveat',
    'files',
    'caveat-latin-700-normal.woff2'
  );
  const emojiPath = path.join(
    serverDir,
    'node_modules',
    '@fontsource',
    'noto-color-emoji',
    'files',
    'noto-color-emoji-emoji-400-normal.woff2'
  );
  try {
    await fs.access(caveatPath);
  } catch {
    throw new Error(
      'Caveat font not found. Run npm install in the server directory (needs @fontsource/caveat).'
    );
  }
  try {
    await fs.access(emojiPath);
  } catch {
    throw new Error(
      'Emoji font not found. Run npm install in the server directory (needs @fontsource/noto-color-emoji).'
    );
  }
  if (!GlobalFonts.registerFromPath(caveatPath, FONT_FAMILY)) {
    throw new Error(`Failed to register Caveat from ${caveatPath}`);
  }
  if (!GlobalFonts.registerFromPath(emojiPath, EMOJI_FONT_FAMILY)) {
    throw new Error(`Failed to register Noto Color Emoji from ${emojiPath}`);
  }
  captionFontsRegistered = true;
}

/** Load /public/butterfly.png once (relative to the server dir). Returns null if missing. */
/**
 * Load the butterfly watermark once. Checks several locations so it works
 * regardless of how the server is deployed:
 *  - WATERMARK_PATH env override
 *  - server/assets/butterfly.png (bundled with the server; survives hosts that
 *    use the `server` dir as an isolated build context, e.g. Railway)
 *  - ../public/butterfly.png (full-repo checkouts, e.g. local + Render)
 * Returns null (and warns) if none are found, rather than failing silently.
 */
function loadButterfly(serverDir) {
  if (!butterflyImgPromise) {
    const candidates = [
      process.env.WATERMARK_PATH,
      path.join(serverDir, 'assets', 'butterfly.png'),
      path.join(serverDir, '..', 'public', 'butterfly.png'),
    ].filter(Boolean);
    butterflyImgPromise = (async () => {
      for (const candidate of candidates) {
        try {
          const buf = await fs.readFile(candidate);
          return await loadImage(buf);
        } catch {
          /* try next candidate */
        }
      }
      console.warn(
        '[polaroidExport] Butterfly watermark not found; exporting without it. Looked in:',
        candidates
      );
      return null;
    })();
  }
  return butterflyImgPromise;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
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

/** object-fit: cover into a box */
function drawImageCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

/** object-contain into a box, with optional alpha */
function drawImageContain(ctx, img, x, y, w, h, alpha = 1) {
  const scale = Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

/** Recolor a (white/transparent) image into a solid tint using its alpha as a mask. */
function tintImage(img, color) {
  const c = createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  cx.globalCompositeOperation = 'source-in';
  cx.fillStyle = color;
  cx.fillRect(0, 0, img.width, img.height);
  return c;
}

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
  ctx.shadowOffsetY = 1;
  ctx.drawImage(sigImg, dx, dy, dw, dh);
  ctx.restore();
}

function drawCaptionCentered(ctx, caption, x, y, w, h, fontSize) {
  ctx.font = captionFont(fontSize);
  ctx.fillStyle = CAPTION_COLOR;
  ctx.textBaseline = 'top';
  const lineHeight = Math.round(fontSize * 1.2);
  const lines = wrapLines(ctx, caption, w - 8 * S);
  const blockH = lines.length * lineHeight;
  let cy = y + Math.max(0, (h - blockH) / 2); // vertical center
  const centerX = x + w / 2;
  lines.forEach((line) => {
    const lw = ctx.measureText(line).width;
    ctx.fillText(line, centerX - lw / 2, cy);
    cy += lineHeight;
  });
}

/** Draw the finished card canvas onto a larger transparent canvas, rotated, with a soft shadow. */
function rotateWithShadow(card, rotationDeg) {
  const rad = (rotationDeg * Math.PI) / 180;
  const w = card.width;
  const h = card.height;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const rotW = Math.ceil(w * cos + h * sin);
  const rotH = Math.ceil(w * sin + h * cos);
  const outW = rotW + OUT_MARGIN * 2;
  const outH = rotH + OUT_MARGIN * 2;
  const out = createCanvas(outW, outH);
  const octx = out.getContext('2d');
  octx.translate(outW / 2, outH / 2);
  octx.rotate(rad);
  octx.shadowColor = 'rgba(0,0,0,0.25)';
  octx.shadowBlur = 24;
  octx.shadowOffsetY = 8;
  octx.drawImage(card, -w / 2, -h / 2);
  return out;
}

/**
 * @param {object} photo - server photo record
 * @param {object} deps
 * @param {string} deps.__dirname - server dir for fonts + asset lookup
 * @param {(p:string)=>string} deps.fullImagePath
 * @param {(uri:string)=>{buffer:Buffer,mime:string}|null} deps.decodeBase64Image
 */
export async function renderPolaroidPng(photo, deps) {
  const { __dirname: serverDir, fullImagePath, decodeBase64Image } = deps;
  await ensureCaptionFonts(serverDir);
  const butterflyImg = await loadButterfly(serverDir);

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

  // ── Build the card (transparent background, fixed dimensions) ──
  const card = createCanvas(CARD_W, CARD_H);
  const ctx = card.getContext('2d');

  // White rounded card
  roundRectPath(ctx, 0, 0, CARD_W, CARD_H, CARD_RX);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Butterfly watermark, clipped to the card
  if (butterflyImg) {
    ctx.save();
    roundRectPath(ctx, 0, 0, CARD_W, CARD_H, CARD_RX);
    ctx.clip();
    const tinted = tintImage(butterflyImg, WM_COLOR);
    drawImageContain(ctx, tinted, WM_X, WM_Y, WM_SIZE, WM_SIZE, WM_OPACITY);
    ctx.restore();
  }

  // Photo + signature, or text-only caption
  if (photoImg) {
    ctx.save();
    roundRectPath(ctx, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, PHOTO_RX);
    ctx.clip();
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H);
    drawImageCover(ctx, photoImg, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H);
    if (sigImg) {
      drawSignatureContain(ctx, sigImg, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H);
    }
    ctx.restore();

    drawCaptionCentered(ctx, caption, 0, CAPTION_Y, CARD_W, CAPTION_H, FONT_SIZE_HAS_IMAGE);
  } else {
    drawCaptionCentered(
      ctx,
      caption,
      PAD,
      PAD,
      CARD_W - PAD * 2,
      CARD_H - PAD * 2,
      FONT_SIZE_TEXT_ONLY
    );
  }

  // Tape (decorative, top center)
  ctx.save();
  ctx.translate(CARD_W / 2, TAPE_Y + TAPE_H / 2);
  ctx.rotate((TAPE_ROT_DEG * Math.PI) / 180);
  ctx.globalAlpha = TAPE_OPACITY;
  ctx.fillStyle = TAPE_COLOR;
  ctx.fillRect(-TAPE_W / 2, -TAPE_H / 2, TAPE_W, TAPE_H);
  ctx.restore();

  const out = rotateWithShadow(card, rotation);
  return out.toBuffer('image/png');
}

export function canExportPolaroid(photo) {
  if (!photo || typeof photo.id !== 'string') return false;
  if (photo.storageFile) return true;
  const cap = typeof photo.caption === 'string' ? photo.caption.trim() : '';
  return cap.length > 0;
}
