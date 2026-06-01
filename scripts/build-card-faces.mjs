import sharp from 'sharp';
import { access, mkdir, constants } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const SRC = join(root, process.env.CARD_SRC_DIR || 'assets');
const OUT = join(root, 'public', 'images', 'cards');

/**
 * Matches public/index.html:
 *   --card-w: min(160px, 28vw)
 *   --card-h: calc(var(--card-w) * 1.45)
 * Portrait: height > width, H/W = 1.45 (≈ 5∶7.25, close to poker 5∶7 = 1.4).
 */
const CARD_WIDTH_1X = 160;
const CARD_HEIGHT_1X = Math.round(CARD_WIDTH_1X * 1.45); // 232
const CARD_RATIO = CARD_HEIGHT_1X / CARD_WIDTH_1X;

const W = CARD_WIDTH_1X * 2; // 320 @2x
const H = CARD_HEIGHT_1X * 2; // 464 @2x

/** Bottom quarter: TRUTH / DARE label band */
const LABEL_H = Math.round(H * 0.25);
/** Top three quarters: silhouette art */
const ART_H = H - LABEL_H;

const ART_PAD_X = Math.round(W * 0.05);
const ART_PAD_TOP = Math.round(ART_H * 0.04);
const ART_MAX_W = W - ART_PAD_X * 2;
const ART_MAX_H = Math.round(ART_H * 0.96);

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

/** Sample solid card background from corners (avoids picking white silhouettes). */
async function backgroundRgb(pipeline) {
  const meta = await pipeline.metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const patch = Math.min(24, Math.floor(w / 6), Math.floor(h / 6));

  const regions = [
    { left: 0, top: 0 },
    { left: Math.max(0, w - patch), top: 0 },
    { left: 0, top: Math.max(0, h - patch) },
    { left: Math.max(0, w - patch), top: Math.max(0, h - patch) },
  ];

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;

  for (const { left, top } of regions) {
    const { dominant } = await pipeline
      .clone()
      .extract({ left, top, width: patch, height: patch })
      .stats();
    r += dominant.r;
    g += dominant.g;
    b += dominant.b;
    n += 1;
  }

  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
  };
}

/**
 * @param {string} input
 * @param {string} output
 * @param {string} label
 * @param {{ squeeze?: number }} [opts]
 */
async function buildCard(input, output, label, opts = {}) {
  const squeeze = opts.squeeze ?? 1;
  const source = sharp(input).rotate();
  const bg = await backgroundRgb(source);
  const background = { r: bg.r, g: bg.g, b: bg.b, alpha: 1 };

  let art = source.clone().flatten({ background }).trim({ threshold: 12 });

  if (squeeze !== 1) {
    const meta = await art.metadata();
    const sw = Math.max(1, Math.round((meta.width ?? 1) * squeeze));
    art = art.resize(sw, meta.height, { fit: 'fill' });
  }

  const fitted = await art
    .resize(ART_MAX_W, ART_MAX_H, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();

  const { width: fw = 0, height: fh = 0 } = await sharp(fitted).metadata();
  const left = Math.round((W - fw) / 2);
  const top = ART_PAD_TOP;

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

/** @param {string} baseName e.g. truth-card-preview */
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
  ['dare-card-draft', 'dare-card-draft.png', 'DARE', { squeeze: 0.72 }],
];

await mkdir(OUT, { recursive: true });

for (const [srcBase, outName, label, opts] of jobs) {
  const input = await resolveSource(srcBase);
  const output = join(OUT, outName);
  await buildCard(input, output, label, opts);
  console.log(`Wrote ${output} (${W}×${H}) + @1x ${CARD_WIDTH_1X}×${CARD_HEIGHT_1X}`);
}
