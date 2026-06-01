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
const CARD_HEIGHT_1X = Math.round(CARD_WIDTH_1X * 1.45); // 232

const W = CARD_WIDTH_1X * 2;
const H = CARD_HEIGHT_1X * 2;

const LABEL_H = Math.round(H * 0.25);
const ART_H = H - LABEL_H;

/** Tiny inset from card edges inside the art band */
const ART_MARGIN = 0.025;
const ART_FIT_W = Math.round(W * (1 - ART_MARGIN * 2));
const ART_FIT_H = Math.round(ART_H * (1 - ART_MARGIN * 2));
const ART_TOP = Math.round(ART_H * ART_MARGIN);

/** @param {string} label */
function labelSvg(label) {
  const fontSize = Math.round(LABEL_H * 0.58);
  const y = Math.round(LABEL_H * 0.7);

  return Buffer.from(`<svg width="${W}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
  <text x="${W / 2}" y="${y}" text-anchor="middle"
    font-family="Segoe UI, Arial Black, Helvetica, sans-serif"
    font-size="${fontSize}" font-weight="900" font-style="italic"
    fill="#ffffff"
    stroke="rgba(15, 23, 42, 0.7)" stroke-width="1.5"
    paint-order="stroke fill"
    textLength="${W - 16}" lengthAdjust="spacingAndGlyphs">${label}</text>
</svg>`);
}

/** Sample card fill from interior (sources often have black letterbox bars). */
async function backgroundRgb(pipeline) {
  const meta = await pipeline.metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const patch = Math.min(48, Math.floor(w / 5), Math.floor(h / 5));
  const cx = Math.max(0, Math.floor(w / 2) - Math.floor(patch / 2));
  const cy = Math.max(0, Math.floor(h * 0.12));

  const { dominant } = await pipeline
    .clone()
    .extract({ left: cx, top: cy, width: patch, height: patch })
    .stats();

  return {
    r: Math.round(dominant.r),
    g: Math.round(dominant.g),
    b: Math.round(dominant.b),
  };
}

/**
 * Keep only white silhouettes on a flat card color (removes black bars, corner chips, halos).
 * @param {import('sharp').Sharp} pipeline
 * @param {{ r: number, g: number, b: number }} bg
 * @param {boolean} stripEdge
 * @param {boolean} restoreHeads
 */
async function isolateWhiteSilhouettes(pipeline, bg, stripEdge = false, restoreHeads = false) {
  const { data, info } = await pipeline
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h, channels: ch } = info;
  const out = Buffer.alloc(w * h * 3);
  const { r: br, g: bgg, b: bb } = bg;

  const distBg = (r, g, b) => {
    const dr = r - br;
    const dg = g - bgg;
    const db = b - bb;
    return Math.hypot(dr, dg, db);
  };

  const mask = new Uint8Array(w * h);
  const isBlueCard = bb > br && bb > bgg;

  for (let i = 0; i < w * h; i++) {
    const o = i * 3;
    const r = data[i * ch];
    const g = data[i * ch + 1];
    const b = data[i * ch + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;

    const isWhite = lum > 198 && chroma < 32;
    const isBg =
      distBg(r, g, b) < 72 ||
      lum < 55 ||
      (isBlueCard
        ? b > 130 && r < 110 && g < 150
        : r > 130 && g < 110 && b < 110);

    if (isWhite && !isBg) {
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

  const prunePasses = restoreHeads ? 2 : 3;
  const pruneMinNeighbors = restoreHeads ? 3 : 4;

  for (let pass = 0; pass < prunePasses; pass++) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (mask[(y + dy) * w + (x + dx)]) n++;
          }
        }
        if (n < pruneMinNeighbors) {
          mask[i] = 0;
          const o = i * 3;
          out[o] = br;
          out[o + 1] = bgg;
          out[o + 2] = bb;
        }
      }
    }
  }

  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) count++;

  if (count < 32) {
    return sharp(out, { raw: { width: w, height: h, channels: 3 } });
  }

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

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  if (cropW < 1 || cropH < 1) {
    return sharp(out, { raw: { width: w, height: h, channels: 3 } });
  }

  if (restoreHeads) {
    fillHeadArcs(mask, out, w, minX, minY, maxX, maxY, [
      [0, 0.52],
      [0.48, 1],
    ]);
    minY = h;
    maxY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (stripEdge) {
    const cropW2 = maxX - minX + 1;
    const cropH2 = maxY - minY + 1;
    const edge = Math.max(3, Math.floor(Math.min(cropW2, cropH2) * 0.07));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const lx = x - minX;
        const ly = y - minY;
        const onEdge =
          lx < edge ||
          lx >= cropW2 - edge ||
          ly < edge ||
          ly >= cropH2 - edge;
        if (!onEdge) continue;
        const i = y * w + x;
        mask[i] = 0;
        const o = i * 3;
        out[o] = br;
        out[o + 1] = bgg;
        out[o + 2] = bb;
      }
    }
  }

  const finalW = maxX - minX + 1;
  const finalH = maxY - minY + 1;

  return sharp(out, { raw: { width: w, height: h, channels: 3 } }).extract({
    left: minX,
    top: minY,
    width: finalW,
    height: finalH,
  });
}

/**
 * Round off flat-topped heads clipped in source art.
 * @param {Uint8Array} mask
 * @param {Buffer} out
 */
function paintHeadArc(mask, out, w, minX, minY, cx, flatY, runW) {
  const rx = runW * 0.58;
  const ry = Math.max(runW * 0.65, 12);
  const y0 = Math.max(0, Math.floor(flatY - ry));
  const y1 = flatY;
  const x0 = Math.max(0, Math.ceil(cx - rx));
  const x1 = Math.min(w - 1, Math.floor(cx + rx));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dy = flatY - y;
      const dx = x - cx;
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue;
      const i = y * w + x;
      mask[i] = 1;
      const o = i * 3;
      out[o] = 255;
      out[o + 1] = 255;
      out[o + 2] = 255;
    }
  }
}

/** @param {[number, number][]} zones [startFrac, endFrac] pairs across crop width */
function fillHeadArcs(mask, out, w, minX, minY, maxX, maxY, zones) {
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  for (const [f0, f1] of zones) {
    const lx0 = Math.floor(cropW * f0);
    const lx1 = Math.min(cropW, Math.ceil(cropW * f1));
    const zoneW = lx1 - lx0;
    let topLy = cropH;
    const minSpan = Math.max(10, Math.floor(zoneW * 0.18));

    for (let ly = 0; ly < cropH; ly++) {
      let count = 0;
      for (let lx = lx0; lx < lx1; lx++) {
        if (mask[(minY + ly) * w + (minX + lx)]) count++;
      }
      if (count >= minSpan) {
        topLy = ly;
        break;
      }
    }
    if (topLy >= cropH) continue;

    let spanStart = lx1;
    let spanEnd = lx0;
    for (let lx = lx0; lx < lx1; lx++) {
      if (!mask[(minY + topLy) * w + (minX + lx)]) continue;
      spanStart = Math.min(spanStart, lx);
      spanEnd = Math.max(spanEnd, lx);
    }

    const runW = spanEnd - spanStart + 1;
    if (runW < 12) continue;

    const cx = minX + spanStart + runW / 2;
    paintHeadArc(mask, out, w, minX, minY, cx, minY + topLy, runW);
  }
}

/**
 * @param {import('sharp').Sharp} art
 * @param {number} squeeze horizontal scale (<1 = tighter grouping)
 * @param {boolean} fillWidth prefer spanning card width (for wide DARE art)
 */
async function fitArt(art, squeeze, fillWidth = false) {
  let pipe = art;
  const before = await pipe.metadata();
  if (!before.width || !before.height) {
    throw new Error('fitArt: empty input');
  }

  if (squeeze !== 1) {
    const sw = Math.max(1, Math.round(before.width * squeeze));
    const sh = Math.max(1, before.height);
    pipe = pipe.resize(sw, sh, { fit: 'fill' });
  }

  if (fillWidth) {
    let buf = await pipe
      .resize(ART_FIT_W, null, { withoutEnlargement: false })
      .png()
      .toBuffer();
    const sized = await sharp(buf).metadata();
    if ((sized.height ?? 0) > ART_FIT_H) {
      buf = await sharp(buf).resize(null, ART_FIT_H).png().toBuffer();
    }
    return buf;
  }

  return pipe
    .resize(ART_FIT_W, ART_FIT_H, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
}

/** Align silhouette bottoms; center horizontally with minimal side margin. */
function artPlacement(fw, fh) {
  const bottom = ART_TOP + ART_FIT_H;
  return {
    left: Math.round((W - fw) / 2),
    top: bottom - fh,
  };
}

/**
 * @param {string} input
 * @param {string} output
 * @param {string} label
 * @param {{ squeeze?: number, stripEdge?: boolean }} [opts]
 */
async function buildCard(input, output, label, opts = {}) {
  const squeeze = opts.squeeze ?? 1;
  const stripEdge = opts.stripEdge ?? false;
  const restoreHeads = opts.restoreHeads ?? false;
  const source = sharp(input);
  const bg = await backgroundRgb(source);
  const background = { r: bg.r, g: bg.g, b: bg.b, alpha: 1 };

  const isolated = await isolateWhiteSilhouettes(source, bg, stripEdge, restoreHeads);
  const isoMeta = await isolated.metadata();
  if (!isoMeta.width || !isoMeta.height) {
    throw new Error(`Empty silhouette for ${input}`);
  }
  const fitted = await fitArt(isolated, squeeze, opts.fillWidth ?? false);
  const { width: fw = 0, height: fh = 0 } = await sharp(fitted).metadata();
  const { left, top } = artPlacement(fw, fh);
  const labelBand = labelSvg(label);

  await sharp({
    create: { width: W, height: H, channels: 4, background },
  })
    .composite([
      { input: fitted, top, left },
      { input: labelBand, top: ART_H, left: 0 },
    ])
    .png()
    .toFile(output);

  const out1x = output.replace(/\.png$/i, '@1x.png');
  await sharp(output).resize(CARD_WIDTH_1X, CARD_HEIGHT_1X).png().toFile(out1x);
}

/** @param {string} baseName */
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
  throw new Error(
    `Missing source for ${baseName} in ${SRC} (expected ${baseName}.png or .svg).`,
  );
}

const jobs = [
  [
    'truth-card-preview',
    'truth-card-preview.png',
    'TRUTH',
    { squeeze: 1, stripEdge: false, restoreHeads: true },
  ],
  [
    'dare-card-draft',
    'dare-card-draft.png',
    'DARE',
    { squeeze: 0.26, stripEdge: true, restoreHeads: false, fillWidth: true },
  ],
];

await mkdir(OUT, { recursive: true });

for (const [srcBase, outName, label, opts] of jobs) {
  const input = await resolveSource(srcBase);
  const output = join(OUT, outName);
  await buildCard(input, output, label, opts);
  console.log(`Wrote ${output} (${W}×${H}) + @1x ${CARD_WIDTH_1X}×${CARD_HEIGHT_1X}`);
}
