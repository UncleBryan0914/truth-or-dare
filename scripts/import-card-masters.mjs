#!/usr/bin/env node
/**
 * Copy screenshot masters into assets/ for build:cards.
 *
 * Usage:
 *   node scripts/import-card-masters.mjs \
 *     "/Users/bryanchou/Documents/截圖 2026-06-02 凌晨12.17.19.png" \
 *     "/Users/bryanchou/Documents/截圖 2026-06-02 凌晨12.17.29.png"
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'assets');

const truthSrc = process.argv[2];
const dareSrc = process.argv[3];

if (!truthSrc || !dareSrc) {
  console.error(
    'Usage: node scripts/import-card-masters.mjs <truth-screenshot.png> <dare-screenshot.png>',
  );
  process.exit(1);
}

await mkdir(assets, { recursive: true });
await copyFile(truthSrc, join(assets, 'truth-card-master.png'));
await copyFile(dareSrc, join(assets, 'dare-card-master.png'));
console.log('Copied to assets/truth-card-master.png and assets/dare-card-master.png');
console.log('Run: npm run build:cards');
