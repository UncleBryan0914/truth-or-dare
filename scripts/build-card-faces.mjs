/**
 * Build card faces from user-provided art (assets/*.png).
 *
 * Keeps silhouette size, spacing, and placement from each source image.
 * Allowed edits only:
 *   1. Shared TRUTH / DARE label metrics (vertical alignment between decks).
 *   2. DARE: remove gray frame + smooth jagged silhouette edges.
 *   3. TRUTH: trim empty white padding below figures (does not move figures).
 */
import sharp from 'sharp';
import { access, mkdir, constants } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const SRC = join(root, process.env.CARD_SRC_DIR || 'assets');
const OUT = join(root, 'public', 'images', 'cards');

const CARD_WIDTH_1X = 160;
const CARD_HEIGHT_1X = Math.round(CARD_WIDTH_1X * 1.45);

const W = CARD_WIDTH_1X * 2;
const H = CARD_HEIGHT_1X * 2;

const LABEL_FRAC = 0.25;
const LABEL_H = Math.round(H * LABEL_FRAC);
const ART_H = H - LABEL_H;

const LABEL_FONT_SIZE = Math.round(LABEL_H * 0.62);
const LABEL_BASELINE_Y = Math.round(LABEL_H * 0.72);
const LABEL_TEXT_WIDTH = W - 10;

/** @param {string} label */
function labelSvg(label) {
  return Buffer.from(`<svg width="${W}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
  <text x="${W / 2}" y="${LABEL_BASELINE_Y}" text-anchor="middle"
    font-family="Segoe UI, Arial Black, Helvetica, sans-serif"
    font-size="${LABEL_FONT_SIZE}" font-weight="900" font-style="italic"
    fill="#ffffff"
    textLength="${LABEL_TEXT_WIDTH}" lengthAdjust="spacingAndGlyphs">${label}</text>
</svg>`);
}

/**
 * @param {Buffer} data
 * @param {number} w
 * @param {number} h
 * @param {'truth'|'dare'} kind
 */
function dominantBackground(data, w, h, kind) {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (kind === 'truth') {
        if (b > r + 30 && b > g + 10) {
          sr += r;
          sg += g;
          sb += b;
          n++;
        }
      } else if (r > 160 && g < 120 && b < 120) {
        sr += r;
        sg += g;
        sb += b;
        n++;
      }
    }
  }

  if (!n) {
    return kind === 'truth' ? { r: 37, g: 99, b: 235 } : { r: 220, g: 38, b: 38 };
  }

  return {
    r: Math.round(sr / n),
    g: Math.round(sg / n),
    b: Math.round(sb / n),
  };
}

/**
 * @param {import('sharp').Sharp} pipeline
 * @param {{ r: number, g: number, b: number }} bg
 */
async function rasterToRgb(pipeline, bg) {
  const { data, info } = await pipeline.rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const { r: br, g: bgg, b: bb } = bg;

  const out = Buffer.alloc(w * h * 3);
  const mask = new Uint8Array(w * h);
  const distBg = (r, g, b) => Math.hypot(r - br, g - bgg, b - bb);

  for (let i = 0; i < w * h; i++) {
    const o = i * 3;
    const r = data[i * ch];
    const g = data[i * ch + 1];
    const b = data[i * ch + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const isWhite = lum > 198 && chroma < 32;

    if (isWhite) {
      mask[i] = 1;
      out[o] = 255;
      out[o + 1] = 255;
      out[o + 2] = 255;
    } else {
      out[o] = br;
      out[o + 1] = bgg;
      out[o + 2] = bb;
    }
  }

  return { out, mask, w, h };
}

/**
 * @param {Uint8Array} mask
 * @param {number} w
 * @param {number} h
 */
function maskBounds(mask, w, h) {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return { minX, minY, maxX, maxY };
}

/** Trim only bottom rows that are almost entirely background (empty padding). */
function trimBottomPadding(mask, w, h, maxY) {
  let trimmed = maxY;
  for (let y = maxY; y > 0; y--) {
    let white = 0;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) white++;
    }
    if (white > w * 0.85) trimmed = y - 1;
    else break;
  }
  return trimmed;
}

/**
 * @param {import('sharp').Sharp} pipeline
 * @param {'truth'|'dare'} kind
 * @param {boolean} trimTruthPadding
 */
async function prepareArtPanel(pipeline, kind, trimTruthPadding) {
  const { data, info } = await pipeline.rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;

  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = data[i * ch];
    rgb[i * 3 + 1] = data[i * ch + 1];
    rgb[i * 3 + 2] = data[i * ch + 2];
  }

  const bg = dominantBackground(rgb, w, h, kind);
  const { out, mask, w: rw, h: rh } = await rasterToRgb(pipeline, bg);

  let { minX, minY, maxX, maxY } = maskBounds(mask, rw, rh);
  if (maxX < minX) {
    return sharp(out, { raw: { width: rw, height: rh, channels: 3 } });
  }

  if (trimTruthPadding && kind === 'truth') {
    maxY = trimBottomPadding(mask, rw, rh, maxY);
  }

  return sharp(out, { raw: { width: rw, height: rh, channels: 3 } }).extract({
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });
}

/** @param {import('sharp').Sharp} pipeline */
async function cropDareRedPanel(pipeline) {
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 180 && g < 120 && b < 120) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX) return pipeline;

  return pipeline.extract({
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });
}

/**
 * @param {Buffer} pngBuffer
 * @param {{ r: number, g: number, b: number }} bg
 */
async function smoothSilhouetteEdges(pngBuffer, bg) {
  const meta = await sharp(pngBuffer).metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (!srcW || !srcH) return pngBuffer;

  const scale = 4;
  const tw = Math.min(4096, srcW * scale);
  const th = Math.round(srcH * (tw / srcW));

  const { out, mask, w, h } = await rasterToRgb(
    sharp(pngBuffer).resize(tw, th, { fit: 'fill', kernel: 'lanczos3' }),
    bg,
  );

  const dilate = (src, radius) => {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let on = 0;
        for (let dy = -radius; dy <= radius && !on; dy++) {
          for (let dx = -radius; dx <= radius && !on; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (src[ny * w + nx]) on = 1;
          }
        }
        next[y * w + x] = on;
      }
    }
    return next;
  };

  const erode = (src, radius) => {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let on = 1;
        for (let dy = -radius; dy <= radius && on; dy++) {
          for (let dx = -radius; dx <= radius && on; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
              on = 0;
              continue;
            }
            if (!src[ny * w + nx]) on = 0;
          }
        }
        next[y * w + x] = on;
      }
    }
    return next;
  };

  let smooth = erode(dilate(mask, 1), 1);
  smooth = dilate(erode(smooth, 1), 1);

  const { r: br, g: bgg, b: bb } = bg;
  const cleaned = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const o = i * 3;
    if (smooth[i]) {
      cleaned[o] = 255;
      cleaned[o + 1] = 255;
      cleaned[o + 2] = 255;
    } else {
      cleaned[o] = br;
      cleaned[o + 1] = bgg;
      cleaned[o + 2] = bb;
    }
  }

  return sharp(cleaned, { raw: { width: w, height: h, channels: 3 } })
    .resize(srcW, srcH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

/** @param {Buffer} artBuffer */
async function fitArtBand(artBuffer) {
  return sharp(artBuffer)
    .resize(W, ART_H, { fit: 'inside', position: 'north', kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

/**
 * @param {Buffer} artBuffer
 * @param {string} output
 * @param {'truth'|'dare'} kind
 * @param {string} label
 */
async function buildCard(artBuffer, output, kind, label) {
  const { data, info } = await sharp(artBuffer).raw().toBuffer({ resolveWithObject: true });
  const bgColor = dominantBackground(data, info.width, info.height, kind);
  const background = { ...bgColor, alpha: 1 };

  const fitted = await fitArtBand(artBuffer);
  const { width: fw = 0 } = await sharp(fitted).metadata();
  const left = Math.round((W - fw) / 2);

  await sharp({
    create: { width: W, height: H, channels: 4, background },
  })
    .composite([
      { input: fitted, top: 0, left },
      { input: labelSvg(label), top: ART_H, left: 0 },
    ])
    .png()
    .toFile(output);

  const out1x = output.replace(/\.png$/i, '@1x.png');
  await sharp(output).resize(CARD_WIDTH_1X, CARD_HEIGHT_1X, { kernel: 'lanczos3' }).png().toFile(out1x);
}

async function resolveSource(baseName) {
  for (const ext of ['.png', '.svg', '.jpg', '.jpeg', '.webp']) {
    const path = join(SRC, `${baseName}${ext}`);
    try {
      await access(path, constants.R_OK);
      return path;
    } catch {
      /* try next */
    }
  }
  throw new Error(`Missing source for ${baseName} in ${SRC}`);
}

async function prepareTruthArt(input) {
  return prepareArtPanel(sharp(input), 'truth', true).then((p) => p.png().toBuffer());
}

async function prepareDareArt(input) {
  const cropped = await cropDareRedPanel(sharp(input));
  const panel = await cropped.png().toBuffer();
  const { data, info } = await sharp(panel).raw().toBuffer({ resolveWithObject: true });
  const bg = dominantBackground(data, info.width, info.height, 'dare');
  return smoothSilhouetteEdges(panel, bg);
}

// Restore full-bleed truth source (not the black-matte rounded draft)
const truthMaster = join(SRC, 'truth-card-preview-source.png');
try {
  await access(truthMaster, constants.R_OK);
} catch {
  /* use truth-card-preview.png */
}

const jobs = [
  ['truth-card-preview', 'truth-card-preview.png', 'truth', 'TRUTH', prepareTruthArt],
  ['dare-card-draft', 'dare-card-draft.png', 'dare', 'DARE', prepareDareArt],
];

await mkdir(OUT, { recursive: true });

for (const [srcBase, outName, kind, label, prepare] of jobs) {
  let input = await resolveSource(srcBase);
  if (kind === 'truth') {
    try {
      await access(truthMaster, constants.R_OK);
      input = truthMaster;
    } catch {
      /* default */
    }
  }
  const art = await prepare(input);
  const output = join(OUT, outName);
  await buildCard(art, output, kind, label);
  console.log(`Wrote ${output} <- ${input}`);
}
