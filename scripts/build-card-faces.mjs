import sharp from 'sharp';
import { access, mkdir, constants } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const SRC = join(root, process.env.CARD_SRC_DIR || 'assets');
const OUT = join(root, 'public', 'images', 'cards');

/** @2x — matches UI --card-w 160px × --card-h 232px (ratio 1.45) */
const W = 320;
const H = 464;
const TOP_H = Math.round(H * 0.75);
const BOTTOM_H = H - TOP_H;

/** @param {string} label */
function labelSvg(label) {
  const fontSize = 28;
  const y = Math.round(BOTTOM_H / 2 + fontSize * 0.34);

  return Buffer.from(`<svg width="${W}" height="${BOTTOM_H}" xmlns="http://www.w3.org/2000/svg">
  <text x="${W / 2}" y="${y}" text-anchor="middle"
    font-family="Segoe UI, Arial, Helvetica, sans-serif"
    font-size="${fontSize}" font-weight="700"
    letter-spacing="0.2em"
    fill="#ffffff"
    stroke="rgba(15, 23, 42, 0.72)"
    stroke-width="1.25"
    paint-order="stroke fill">${label}</text>
</svg>`);
}

/** @param {import('sharp').Sharp} pipeline */
async function backgroundRgb(pipeline) {
  const { dominant } = await pipeline.clone().stats();
  return {
    r: Math.round(dominant.r),
    g: Math.round(dominant.g),
    b: Math.round(dominant.b),
  };
}

/**
 * @param {string} input
 * @param {string} output
 * @param {string} label
 */
async function buildCard(input, output, label) {
  const source = sharp(input).rotate();
  const bg = await backgroundRgb(source);
  const background = { r: bg.r, g: bg.g, b: bg.b, alpha: 1 };

  const silhouette = await source
    .clone()
    .resize(W, TOP_H, { fit: 'contain', background })
    .png()
    .toBuffer();

  const labelBand = labelSvg(label);

  await sharp({
    create: { width: W, height: H, channels: 4, background },
  })
    .composite([
      { input: silhouette, top: 0, left: 0 },
      { input: labelBand, top: TOP_H, left: 0 },
    ])
    .png()
    .toFile(output);

  const out1x = output.replace(/\.png$/i, '@1x.png');
  await sharp(output).resize(W / 2, H / 2).png().toFile(out1x);
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
  ['truth-card-preview', 'truth-card-preview.png', 'TRUTH'],
  ['dare-card-draft', 'dare-card-draft.png', 'DARE'],
];

await mkdir(OUT, { recursive: true });

for (const [srcBase, outName, label] of jobs) {
  const input = await resolveSource(srcBase);
  const output = join(OUT, outName);
  await buildCard(input, output, label);
  console.log(`Wrote ${output} and ${output.replace(/\.png$/i, '@1x.png')}`);
}
