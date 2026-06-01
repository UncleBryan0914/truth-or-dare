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

const LABEL_H = Math.round(H * 0.25);
const ART_H = H - LABEL_H;

/** Reference layout: small side margin, silhouettes in upper band */
const ART_PAD_X = Math.round(W * 0.03);
const ART_PAD_TOP = Math.round(ART_H * 0.06);
const ART_MAX_W = W - ART_PAD_X * 2;
const ART_MAX_H = Math.round(ART_H * 0.94);
/** Shared vertical anchor so TRUTH & DARE align like the reference */
const ART_Y_BIAS = 0.1;

const CARD_COLORS = {
  truth: { r: 37, g: 99, b: 235 },
  dare: { r: 220, g: 38, b: 38 },
};

/** @param {'truth'|'dare'} kind */
function cardBackground(kind) {
  return { ...CARD_COLORS[kind], alpha: 1 };
}

/** @param {string} label */
function labelSvg(label) {
  const fontSize = Math.round(LABEL_H * 0.62);
  const y = Math.round(LABEL_H * 0.72);

  return Buffer.from(`<svg width="${W}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
  <text x="${W / 2}" y="${y}" text-anchor="middle"
    font-family="Segoe UI, Arial Black, Helvetica, sans-serif"
    font-size="${fontSize}" font-weight="900" font-style="italic"
    fill="#ffffff"
    textLength="${W - 10}" lengthAdjust="spacingAndGlyphs">${label}</text>
</svg>`);
}

/**
 * @param {import('sharp').Sharp} pipeline
 * @param {{ r: number, g: number, b: number }} bg
 * @param {boolean} stripEdge
 * @param {boolean} gentlePrune
 */
async function isolateWhiteSilhouettes(pipeline, bg, stripEdge, gentlePrune) {
  const { data, info } = await pipeline
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h, channels: ch } = info;
  const out = Buffer.alloc(w * h * 3);
  const { r: br, g: bgg, b: bb } = bg;
  const mask = new Uint8Array(w * h);
  const isBlue = bb > br && bb > bgg;

  const distBg = (r, g, b) => Math.hypot(r - br, g - bgg, b - bb);

  for (let i = 0; i < w * h; i++) {
    const o = i * 3;
    const r = data[i * ch];
    const g = data[i * ch + 1];
    const b = data[i * ch + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const isWhite = lum > 198 && chroma < 32;
    const isBg =
      distBg(r, g, b) < 72 ||
      lum < 55 ||
      (isBlue ? b > 130 && r < 110 && g < 150 : r > 130 && g < 110 && b < 110);

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

  const prunePasses = gentlePrune ? 0 : 2;
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
        if (n < 3) {
          mask[i] = 0;
          const o = i * 3;
          out[o] = br;
          out[o + 1] = bgg;
          out[o + 2] = bb;
        }
      }
    }
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

  if (maxX < minX || maxY < minY) {
    return sharp(out, { raw: { width: w, height: h, channels: 3 } });
  }

  if (stripEdge) {
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const edge = Math.max(3, Math.floor(Math.min(cropW, cropH) * 0.06));
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
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });
}

async function fitArt(art) {
  return art
    .resize(ART_MAX_W, ART_MAX_H, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
}

function artPlacement(fw, fh) {
  return {
    left: Math.round((W - fw) / 2),
    top: ART_PAD_TOP + Math.round((ART_MAX_H - fh) * ART_Y_BIAS),
  };
}

/**
 * @param {string} input
 * @param {string} output
 * @param {'truth'|'dare'} kind
 * @param {string} label
 * @param {{ stripEdge?: boolean, gentlePrune?: boolean }} [opts]
 */
async function buildCard(input, output, kind, label, opts = {}) {
  const background = cardBackground(kind);

  const isolated = await isolateWhiteSilhouettes(
    sharp(input),
    background,
    opts.stripEdge ?? false,
    opts.gentlePrune ?? false,
  );

  const isoMeta = await isolated.metadata();
  if (!isoMeta.width || !isoMeta.height) {
    throw new Error(`Empty silhouette for ${input}`);
  }

  const fitted = await fitArt(isolated);
  const { width: fw = 0, height: fh = 0 } = await sharp(fitted).metadata();
  const { left, top } = artPlacement(fw, fh);

  await sharp({
    create: { width: W, height: H, channels: 4, background },
  })
    .composite([
      { input: fitted, top, left },
      { input: labelSvg(label), top: ART_H, left: 0 },
    ])
    .png()
    .toFile(output);

  const out1x = output.replace(/\.png$/i, '@1x.png');
  await sharp(output).resize(CARD_WIDTH_1X, CARD_HEIGHT_1X).png().toFile(out1x);
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

const jobs = [
  ['truth-card-preview', 'truth-card-preview.png', 'truth', 'TRUTH', { gentlePrune: true }],
  ['dare-card-draft', 'dare-card-draft.png', 'dare', 'DARE', { stripEdge: true }],
];

await mkdir(OUT, { recursive: true });

for (const [srcBase, outName, kind, label, opts] of jobs) {
  const input = await resolveSource(srcBase);
  const output = join(OUT, outName);
  await buildCard(input, output, kind, label, opts);
  console.log(`Wrote ${output}`);
}
