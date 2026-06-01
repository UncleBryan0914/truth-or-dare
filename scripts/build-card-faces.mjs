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

const ART_PAD_X = Math.round(W * 0.05);
const ART_FIT_W = W - ART_PAD_X * 2;
const ART_FIT_H = Math.round(ART_H * 0.82);
/** Same top inset for TRUTH & DARE silhouettes */
const ART_TOP = Math.round(ART_H * 0.08);

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
 */
async function isolateWhiteSilhouettes(pipeline, bg, stripEdge = false) {
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

  for (let pass = 0; pass < 3; pass++) {
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
        if (n < 4) {
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

  if (stripEdge) {
    const edge = Math.max(3, Math.floor(Math.min(cropW, cropH) * 0.07));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const lx = x - minX;
        const ly = y - minY;
        const onEdge =
          lx < edge ||
          lx >= cropW - edge ||
          ly < edge ||
          ly >= cropH - edge;
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

  return sharp(out, { raw: { width: w, height: h, channels: 3 } }).extract({
    left: minX,
    top: minY,
    width: cropW,
    height: cropH,
  });
}

/**
 * @param {import('sharp').Sharp} art
 * @param {number} squeeze horizontal scale (<1 = tighter grouping)
 */
async function fitArt(art, squeeze) {
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

  return pipe
    .resize(ART_FIT_W, ART_FIT_H, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
}

/** Align silhouette bottoms so DARE sits at the same band as TRUTH. */
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
  const source = sharp(input);
  const bg = await backgroundRgb(source);
  const background = { r: bg.r, g: bg.g, b: bg.b, alpha: 1 };

  const isolated = await isolateWhiteSilhouettes(source, bg, stripEdge);
  const isoMeta = await isolated.metadata();
  if (!isoMeta.width || !isoMeta.height) {
    throw new Error(`Empty silhouette for ${input}`);
  }
  const fitted = await fitArt(isolated, squeeze);
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
  ['truth-card-preview', 'truth-card-preview.png', 'TRUTH', { squeeze: 1 }],
  ['dare-card-draft', 'dare-card-draft.png', 'DARE', { squeeze: 0.44 }],
];

await mkdir(OUT, { recursive: true });

for (const [srcBase, outName, label, opts] of jobs) {
  const input = await resolveSource(srcBase);
  const output = join(OUT, outName);
  await buildCard(input, output, label, opts);
  console.log(`Wrote ${output} (${W}×${H}) + @1x ${CARD_WIDTH_1X}×${CARD_HEIGHT_1X}`);
}
