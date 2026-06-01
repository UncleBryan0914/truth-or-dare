/**
 * Build card faces for the deck UI.
 *
 * Preferred: full-card masters from your screenshots
 *   - assets/truth-card-master.png  (真心話)
 *   - assets/dare-card-master.png   (大冒險)
 *
 * Masters are scaled to 320×464 / 160×232 with no relayout.
 * Allowed edits only:
 *   1. Align TRUTH / DARE label vertical position between the two cards.
 *   2. DARE: smooth jagged silhouette edges in the art band (top 75%).
 */
import sharp from 'sharp';
import { access, mkdir, constants, copyFile } from 'node:fs/promises';
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

const MASTER_TRUTH = join(SRC, 'truth-card-master.png');
const MASTER_DARE = join(SRC, 'dare-card-master.png');

/** @param {string} path */
async function exists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {Buffer} data
 * @param {number} w
 * @param {number} h
 * @param {number} ch
 */
function cornerColor(data, w, h, ch) {
  const pts = [
    [1, 1],
    [w - 2, 1],
    [1, h - 2],
    [w - 2, h - 2],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of pts) {
    const i = (y * w + x) * ch;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return { r: r / 4, g: g / 4, b: b / 4 };
}

/** @param {import('sharp').Sharp} pipeline */
async function trimScreenshotMargins(pipeline) {
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const border = cornerColor(data, w, h, ch);
  const tol = 28;

  const isBorder = (x, y) => {
    const i = (y * w + x) * ch;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return Math.abs(r - border.r) < tol && Math.abs(g - border.g) < tol && Math.abs(b - border.b) < tol;
  };

  let minX = 0;
  let minY = 0;
  let maxX = w - 1;
  let maxY = h - 1;

  while (minY < h && isBorder(minX, minY)) minY++;
  while (maxY > minY && isBorder(minX, maxY)) maxY--;
  while (minX < w && isBorder(minX, minY)) minX++;
  while (maxX > minX && isBorder(maxX, minY)) maxX--;

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width < 8 || height < 8) return pipeline;

  return sharp(data, { raw: { width: w, height: h, channels: ch } }).extract({
    left: minX,
    top: minY,
    width,
    height,
  });
}

/** @param {import('sharp').Sharp} pipeline */
async function maybeTrimScreenshot(pipeline) {
  const meta = await pipeline.metadata();
  const tw = meta.width ?? 0;
  const th = meta.height ?? 0;
  const cardAspect = W / H;
  const srcAspect = tw / th;

  // Already a card-sized asset — do not trim (avoids eating the artwork).
  if (tw >= W * 0.9 && th >= H * 0.9 && Math.abs(srcAspect - cardAspect) / cardAspect < 0.06) {
    return pipeline;
  }

  return trimScreenshotMargins(pipeline);
}

/** Scale master screenshot to output card size (uniform scale, centred crop). */
async function scaleMasterToCard(input) {
  const trimmed = await maybeTrimScreenshot(sharp(input));
  const meta = await trimmed.metadata();
  const tw = meta.width ?? 0;
  const th = meta.height ?? 0;
  const cardAspect = W / H;
  const srcAspect = tw / th;
  const aspectClose = Math.abs(srcAspect - cardAspect) / cardAspect < 0.04;

  if (tw === W && th === H) {
    return trimmed.png().toBuffer();
  }

  if (aspectClose && Math.abs(tw - W) < 8 && Math.abs(th - H) < 8) {
    return trimmed.resize(W, H, { kernel: 'lanczos3' }).png().toBuffer();
  }

  return trimmed.resize(W, H, { fit: 'cover', position: 'centre', kernel: 'lanczos3' }).png().toBuffer();
}

/**
 * @param {Buffer} data
 * @param {number} w
 * @param {number} h
 * @param {number} ch
 */
function labelCenterY(data, w, h, ch) {
  const y0 = Math.floor(h * (1 - LABEL_FRAC - 0.02));
  let sumY = 0;
  let count = 0;

  for (let y = y0; y < h; y++) {
    for (let x = Math.floor(w * 0.08); x < Math.floor(w * 0.92); x++) {
      const i = (y * w + x) * ch;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (lum > 200 && chroma < 36) {
        sumY += y;
        count++;
      }
    }
  }

  return count ? sumY / count : y0 + LABEL_H / 2;
}

/**
 * @param {Buffer} cardBuffer
 * @param {number} shiftY
 * @param {{ r: number, g: number, b: number }} bg
 */
async function shiftCardVertically(cardBuffer, shiftY, bg) {
  if (Math.abs(shiftY) < 1) return cardBuffer;

  return sharp({
    create: { width: W, height: H, channels: 4, background: { ...bg, alpha: 1 } },
  })
    .composite([{ input: cardBuffer, top: shiftY, left: 0 }])
    .png()
    .toBuffer();
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

  return { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) };
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

  const { mask, w, h } = await rasterToRgb(
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

  const radius = 2;
  let smooth = erode(dilate(mask, radius), radius);
  smooth = dilate(erode(smooth, radius), radius);

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

/** @param {Buffer} dareCard */
async function refineDareArtBand(dareCard) {
  const artBand = await sharp(dareCard)
    .extract({ left: 0, top: 0, width: W, height: ART_H })
    .png()
    .toBuffer();

  const { data, info } = await sharp(artBand).raw().toBuffer({ resolveWithObject: true });
  const bg = dominantBackground(data, info.width, info.height, 'dare');
  const smoothed = await smoothSilhouetteEdges(artBand, bg);

  return sharp(dareCard)
    .composite([{ input: smoothed, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/**
 * @param {string} truthInput
 * @param {string} dareInput
 */
async function buildFromMasters(truthInput, dareInput) {
  let truthCard = await scaleMasterToCard(truthInput);
  let dareCard = await scaleMasterToCard(dareInput);

  const truthRaw = await sharp(truthCard).raw().toBuffer({ resolveWithObject: true });
  const dareRaw = await sharp(dareCard).raw().toBuffer({ resolveWithObject: true });

  const truthLabelY = labelCenterY(truthRaw.data, truthRaw.info.width, truthRaw.info.height, truthRaw.info.channels);
  const dareLabelY = labelCenterY(dareRaw.data, dareRaw.info.width, dareRaw.info.height, dareRaw.info.channels);
  const shiftY = Math.round(truthLabelY - dareLabelY);

  const dareBg = dominantBackground(dareRaw.data, dareRaw.info.width, dareRaw.info.height, 'dare');
  dareCard = await shiftCardVertically(dareCard, shiftY, dareBg);
  dareCard = await refineDareArtBand(dareCard);

  const outputs = [
    ['truth-card-preview.png', truthCard],
    ['dare-card-draft.png', dareCard],
  ];

  for (const [name, buffer] of outputs) {
    const output = join(OUT, name);
    await sharp(buffer).png().toFile(output);
    const out1x = output.replace(/\.png$/i, '@1x.png');
    await sharp(output).resize(CARD_WIDTH_1X, CARD_HEIGHT_1X, { kernel: 'lanczos3' }).png().toFile(out1x);
    console.log(`Wrote ${output}`);
  }
}

/** Import paths from env (for local Mac paths when synced). */
async function tryImportMastersFromEnv() {
  const truthSrc = process.env.CARD_TRUTH_MASTER;
  const dareSrc = process.env.CARD_DARE_MASTER;
  if (!truthSrc || !dareSrc) return false;
  if (!(await exists(truthSrc)) || !(await exists(dareSrc))) return false;
  await copyFile(truthSrc, MASTER_TRUTH);
  await copyFile(dareSrc, MASTER_DARE);
  console.log(`Imported masters:\n  ${MASTER_TRUTH}\n  ${MASTER_DARE}`);
  return true;
}

await mkdir(OUT, { recursive: true });
await tryImportMastersFromEnv();

const truthInput = process.argv[2] || MASTER_TRUTH;
const dareInput = process.argv[3] || MASTER_DARE;

if ((await exists(truthInput)) && (await exists(dareInput))) {
  console.log('Using screenshot masters (pixel-faithful mode)');
  console.log(`  truth: ${truthInput}`);
  console.log(`  dare:  ${dareInput}`);
  await buildFromMasters(truthInput, dareInput);
} else {
  console.error(
    [
      'Missing card masters. Add your screenshots as:',
      `  ${MASTER_TRUTH}  ← 截圖 2026-06-02 凌晨12.17.19.png (真心話)`,
      `  ${MASTER_DARE}   ← 截圖 2026-06-02 凌晨12.17.29.png (大冒險)`,
      '',
      'On your Mac:',
      '  cp "/Users/bryanchou/Documents/截圖 2026-06-02 凌晨12.17.19.png" assets/truth-card-master.png',
      '  cp "/Users/bryanchou/Documents/截圖 2026-06-02 凌晨12.17.29.png" assets/dare-card-master.png',
      '  npm run build:cards',
      '',
      'Or set CARD_TRUTH_MASTER / CARD_DARE_MASTER to those paths and run build:cards again.',
    ].join('\n'),
  );
  process.exit(1);
}
