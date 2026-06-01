import sharp from 'sharp';
import { access, mkdir, constants } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const SRC = join(root, process.env.CARD_SRC_DIR || 'assets');
const OUT = join(root, 'public', 'images', 'cards');

/** @1x — matches public/index.html --card-w / --card-h */
const CARD_WIDTH_1X = 160;
const CARD_HEIGHT_1X = Math.round(CARD_WIDTH_1X * 1.45);

const W = CARD_WIDTH_1X * 2;
const H = CARD_HEIGHT_1X * 2;

/** Bottom band for label detection / alignment */
const LABEL_SCAN_Y0 = 0.68;

const CARD_COLORS = {
  truth: { r: 37, g: 99, b: 235 },
  dare: { r: 220, g: 38, b: 38 },
};

const JOBS = [
  {
    kind: 'truth',
    srcBases: ['truth ref', 'truth-card-preview'],
    outName: 'truth-card-preview.png',
    trimSides: { left: true, right: false },
    fringeSides: { left: true, right: false },
  },
  {
    kind: 'dare',
    srcBases: ['dare ref', 'dare-card-draft'],
    outName: 'dare-card-draft.png',
    trimSides: { left: false, right: true },
    fringeSides: { left: false, right: true },
  },
];

/** Max fraction of card width to crop as screenshot gutter */
const MAX_GUTTER_FRAC = 0.03;

/** Pixels along output edge where near-white is treated as gutter in the mask */
const EDGE_FRINGE_PX = 10;

/** @param {{ r: number, g: number, b: number }} bg */
function distBg(r, g, b, bg) {
  return Math.hypot(r - bg.r, g - bg.g, b - bg.b);
}

/** @param {Uint8Array} data @param {number} w @param {number} h @param {{ r: number, g: number, b: number }} bg */
function sampleBackground(data, w, h, bg) {
  const corners = [
    [2, 2],
    [w - 3, 2],
    [2, h - 3],
    [w - 3, h - 3],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of corners) {
    const i = (y * w + x) * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return {
    r: Math.round(r / 4) || bg.r,
    g: Math.round(g / 4) || bg.g,
    b: Math.round(b / 4) || bg.b,
  };
}

/**
 * Detect screenshot gutter columns (stray near-white from unclean crop).
 * @param {Uint8Array} data
 * @param {number} w
 * @param {number} h
 * @param {{ r: number, g: number, b: number }} bg
 */
function isScreenshotGutterColumn(data, w, h, x, bg) {
  let pureWhite = 0;
  let nearBg = 0;

  for (let y = 0; y < h; y++) {
    const o = (y * w + x) * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (r > 250 && g > 250 && b > 250) pureWhite++;
    if (distBg(r, g, b, bg) < 45) nearBg++;
  }

  const whiteRatio = pureWhite / h;
  const bgRatio = nearBg / h;
  return whiteRatio > 0.34 || (whiteRatio > 0.1 && bgRatio < 0.4);
}

/**
 * @param {Uint8Array} data
 * @param {number} w
 * @param {number} h
 * @param {'truth'|'dare'} kind
 * @param {{ left: boolean, right: boolean }} sides
 */
function detectGutterCrop(data, w, h, kind, sides) {
  const bg = CARD_COLORS[kind];
  const max = Math.max(1, Math.floor(w * MAX_GUTTER_FRAC));
  let trimLeft = 0;
  let trimRight = 0;

  if (sides.left) {
    for (let x = 0; x < max; x++) {
      if (!isScreenshotGutterColumn(data, w, h, x, bg)) break;
      trimLeft++;
    }
  }

  if (sides.right) {
    for (let k = 0; k < max; k++) {
      const x = w - 1 - k;
      if (!isScreenshotGutterColumn(data, w, h, x, bg)) break;
      trimRight++;
    }
  }

  return { trimLeft, trimRight };
}

/**
 * Foreground mask with soft edge alpha (anti-aliased edges, fringe removal).
 * @param {{ left: boolean, right: boolean }} [fringeSides]
 * @returns {{ mask: Float32Array, labelBandTop: number }}
 */
function buildForegroundMask(data, w, h, bg, fringeSides = { left: true, right: true }) {
  const mask = new Float32Array(w * h);
  const labelBandTop = Math.floor(h * LABEL_SCAN_Y0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const dBg = distBg(r, g, b, bg);

      let fg = 0;
      if (dBg < 48) {
        fg = 0;
      } else if (lum > 205 && chroma < 28) {
        fg = 1;
      } else if (lum > 168 && chroma < 42 && dBg > 58) {
        const t = Math.min(1, (lum - 168) / 42);
        fg = t * Math.min(1, (dBg - 58) / 55);
      }

      const inLeftFringe = fringeSides.left && x < EDGE_FRINGE_PX;
      const inRightFringe = fringeSides.right && x >= w - EDGE_FRINGE_PX;
      if ((inLeftFringe || inRightFringe) && lum > 235 && chroma < 20) {
        fg = 0;
      }

      mask[i] = fg;
    }
  }

  for (let pass = 0; pass < 1; pass++) {
    const next = new Float32Array(mask);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (mask[i] < 0.35) continue;
        let n = 0;
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = mask[(y + dy) * w + (x + dx)];
            sum += v;
            if (v > 0.55) n++;
          }
        }
        if (n < 4) next[i] = sum / 9;
        else next[i] = Math.max(mask[i], sum / 9);
      }
    }
    mask.set(next);
  }

  const smoothed = new Float32Array(mask);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = mask[i];
      if (v <= 0.04 || v >= 0.96) {
        smoothed[i] = v;
        continue;
      }
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += mask[(y + dy) * w + (x + dx)];
        }
      }
      smoothed[i] = sum / 9;
    }
  }

  return { mask: smoothed, labelBandTop };
}

/** @param {Float32Array} mask @param {number} w @param {number} h @param {number} y0 */
function measureLabel(mask, w, h, y0) {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  for (let y = y0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] < 0.55) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      minX: 0,
      minY: Math.floor(h * 0.78),
      maxX: w - 1,
      maxY: h - 8,
      height: 0,
      centerX: Math.round(w / 2),
      centerY: Math.floor(h * 0.88),
    };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    height: maxY - minY + 1,
    centerX: Math.round((minX + maxX) / 2),
    centerY: Math.round((minY + maxY) / 2),
  };
}

/**
 * Polish only selected scanlines; other rows stay identical to source.
 * @param {Uint8Array} data
 * @param {Float32Array} mask
 * @param {{ r: number, g: number, b: number }} bg
 * @param {number} yStart inclusive
 * @param {number} yEnd exclusive
 */
function applyPolishBand(data, mask, bg, yStart, yEnd) {
  const out = Buffer.from(data);

  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = i * 4;
      const a = mask[i];
      if (a > 0.92) {
        out[o] = 255;
        out[o + 1] = 255;
        out[o + 2] = 255;
        out[o + 3] = 255;
      } else if (a < 0.06) {
        out[o] = bg.r;
        out[o + 1] = bg.g;
        out[o + 2] = bg.b;
        out[o + 3] = 255;
      } else {
        out[o] = Math.round(bg.r + (255 - bg.r) * a);
        out[o + 1] = Math.round(bg.g + (255 - bg.g) * a);
        out[o + 2] = Math.round(bg.b + (255 - bg.b) * a);
        out[o + 3] = 255;
      }
    }
  }

  return out;
}

/** Replace screenshot gutter / polish speckles along card sides. */
function paintEdgeGutter(data, bg, sides, widthPx = 5) {
  for (let y = 0; y < H; y++) {
    const cols = [];
    if (sides.left) {
      for (let x = 0; x < widthPx; x++) cols.push(x);
    }
    if (sides.right) {
      for (let x = W - widthPx; x < W; x++) cols.push(x);
    }

    for (const x of cols) {
      const o = (y * W + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const dBg = distBg(r, g, b, bg);

      const pureGutter = r > 250 && g > 250 && b > 250;
      const nearWhiteSpeck = lum > 242 && chroma < 22 && dBg > 38;
      if (pureGutter || nearWhiteSpeck) {
        data[o] = bg.r;
        data[o + 1] = bg.g;
        data[o + 2] = bg.b;
        data[o + 3] = 255;
      }
    }
  }
}

/** @param {Buffer} data @param {{ minX: number, minY: number, maxX: number, maxY: number }} box @param {{ r: number, g: number, b: number }} bg */
function clearLabelBox(data, box, bg) {
  const padX = 8;
  const padY = 8;
  const x0 = Math.max(0, box.minX - padX);
  const x1 = Math.min(W - 1, box.maxX + padX);
  const y0 = Math.max(0, box.minY - padY);
  const y1 = Math.min(H - 1, box.maxY + padY);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * W + x) * 4;
      data[o] = bg.r;
      data[o + 1] = bg.g;
      data[o + 2] = bg.b;
      data[o + 3] = 255;
    }
  }
}

/**
 * Uniformly scale the raster label to unified cap height; keep ref center anchor.
 * @param {Buffer} canvas
 * @param {{ minX: number, minY: number, maxX: number, maxY: number, height: number, centerX: number, centerY: number }} box
 * @param {number} unifiedCapHeight
 * @param {{ r: number, g: number, b: number }} bg
 */
async function alignLabelRaster(canvas, box, unifiedCapHeight, bg) {
  const pad = 8;
  const left = Math.max(0, box.minX - pad);
  const top = Math.max(0, box.minY - pad);
  const width = Math.min(W - left, box.maxX - box.minX + 1 + pad * 2);
  const height = Math.min(H - top, box.maxY - box.minY + 1 + pad * 2);

  const scale = box.height > 0 ? unifiedCapHeight / box.height : 1;
  const newW = Math.max(1, Math.round(width * scale));
  const newH = Math.max(1, Math.round(height * scale));

  const patch = await sharp(canvas, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left, top, width, height })
    .resize(newW, newH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();

  clearLabelBox(canvas, box, bg);

  const pasteLeft = Math.max(0, Math.min(W - newW, box.centerX - Math.round(newW / 2)));
  const pasteTop = Math.max(0, Math.min(H - newH, box.centerY - Math.round(newH / 2)));

  const composited = await sharp(canvas, { raw: { width: W, height: H, channels: 4 } })
    .composite([{ input: patch, left: pasteLeft, top: pasteTop }])
    .raw()
    .toBuffer();

  canvas.set(composited);
}

async function resolveSource(bases) {
  for (const baseName of bases) {
    for (const ext of ['.png', '.svg', '.jpg', '.jpeg', '.webp']) {
      const path = join(SRC, `${baseName}${ext}`);
      try {
        await access(path, constants.R_OK);
        return path;
      } catch {
        /* try next */
      }
    }
  }
  throw new Error(`Missing source (${bases.join(' or ')}) in ${SRC}`);
}

async function loadResizedRgba(input, kind, trimSides) {
  const rotated = sharp(input).rotate();
  const meta = await rotated.metadata();
  const srcW = meta.width ?? W;
  const srcH = meta.height ?? H;

  const { data: srcRaw } = await rotated
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const srcData = Uint8Array.from(srcRaw);
  const { trimLeft, trimRight } = detectGutterCrop(srcData, srcW, srcH, kind, trimSides);

  let pipeline = rotated;
  const cropW = srcW - trimLeft - trimRight;
  if (cropW > 0 && (trimLeft > 0 || trimRight > 0)) {
    pipeline = rotated.extract({
      left: trimLeft,
      top: 0,
      width: cropW,
      height: srcH,
    });
    if (trimLeft || trimRight) {
      console.log(`  crop gutter: left ${trimLeft}px, right ${trimRight}px`);
    }
  }

  const { data, info } = await pipeline
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: Uint8Array.from(data), width: info.width, height: info.height };
}

await mkdir(OUT, { recursive: true });

/** @type {{ outName: string, data: Uint8Array, bg: { r: number, g: number, b: number }, labelBox: ReturnType<typeof measureLabel>, labelBandTop: number, polished: Buffer }[]} */
const prepared = [];

for (const job of JOBS) {
  const input = await resolveSource(job.srcBases);
  console.log(`Processing ${job.outName}…`);
  const { data } = await loadResizedRgba(input, job.kind, job.trimSides);
  const fallbackBg = CARD_COLORS[job.kind];
  const bg = sampleBackground(data, W, H, fallbackBg);
  const { mask, labelBandTop } = buildForegroundMask(data, W, H, bg, job.fringeSides);
  const labelBox = measureLabel(mask, W, H, labelBandTop);

  const polished = applyPolishBand(data, mask, bg, 0, labelBandTop);
  const labelPolished = applyPolishBand(polished, mask, bg, labelBandTop, H);
  paintEdgeGutter(labelPolished, bg, job.fringeSides);

  prepared.push({
    outName: job.outName,
    bg,
    labelBox,
    labelBandTop,
    polished: labelPolished,
  });
}

const unifiedCapHeight = Math.max(
  prepared[0].labelBox.height,
  prepared[1].labelBox.height,
);

for (const card of prepared) {
  const needsLabelScale =
    card.labelBox.height > 0 &&
    Math.abs(unifiedCapHeight / card.labelBox.height - 1) > 0.015;
  if (needsLabelScale) {
    await alignLabelRaster(card.polished, card.labelBox, unifiedCapHeight, card.bg);
  }

  const output = join(OUT, card.outName);
  await sharp(card.polished, { raw: { width: W, height: H, channels: 4 } }).png().toFile(output);

  const out1x = output.replace(/\.png$/i, '@1x.png');
  await sharp(output).resize(CARD_WIDTH_1X, CARD_HEIGHT_1X).png().toFile(out1x);
  console.log(`Wrote ${output} (label cap ${card.labelBox.height} → ${unifiedCapHeight}px)`);
}
