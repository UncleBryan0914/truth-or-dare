import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const SRC = join(
  process.env.CARD_SRC_DIR ||
    'C:\\Users\\anemo\\.cursor\\projects\\c-Users-anemo-Projects-truth-or-dare\\assets',
);
const OUT = join(root, 'public', 'images', 'cards');

/** @2x — matches UI --card-w 160px × --card-h 232px (ratio 1.45) */
const W = 320;
const H = 464;

/** @param {string} label */
function labelSvg(label) {
  const yCenter = Math.round(H * 0.875);
  const boxW = label === 'TRUTH' ? 118 : 108;
  const boxH = 34;
  const x = (W - boxW) / 2;
  const y = yCenter - boxH / 2;

  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="6"
    fill="rgba(15,23,42,0.55)" stroke="rgba(255,255,255,0.85)" stroke-width="1.5"/>
  <text x="${W / 2}" y="${yCenter + 9}" text-anchor="middle"
    font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="22" font-weight="700"
    letter-spacing="3" fill="#ffffff">${label}</text>
</svg>`);
}

/**
 * @param {string} input
 * @param {string} output
 * @param {string} label
 */
async function buildCard(input, output, label) {
  const base = await sharp(input)
    .rotate()
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  await sharp(base)
    .composite([{ input: labelSvg(label), top: 0, left: 0 }])
    .png()
    .toFile(output);
}

await mkdir(OUT, { recursive: true });

const jobs = [
  ['truth-card-preview.png', 'truth-card-preview.png', 'TRUTH'],
  ['dare-card-draft.png', 'dare-card-draft.png', 'DARE'],
];

for (const [srcName, outName, label] of jobs) {
  const input = join(SRC, srcName);
  const output = join(OUT, outName);
  await buildCard(input, output, label);
  console.log(`Wrote ${output} (+ @1x)`);
}
