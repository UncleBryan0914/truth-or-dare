/**
 * Vercel build step: write public/config.js from environment variables.
 * Set different values per Vercel environment (Production / Preview / Development).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'public', 'config.js');

const vercelEnv = process.env.VERCEL_ENV || 'development';

const apiBaseUrl =
  process.env.GAME_API_BASE_URL ||
  process.env.SUPABASE_REST_URL ||
  '';

const apiKey =
  process.env.GAME_API_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

const useSupabaseRest =
  process.env.GAME_USE_SUPABASE === 'true' ||
  (apiBaseUrl.includes('supabase.co') && apiBaseUrl.includes('/rest/v1'));

const config = {
  apiBaseUrl,
  apiKey,
  useSupabaseRest,
  truthTable: process.env.GAME_TRUTH_TABLE || 'truth_cards',
  dareTable: process.env.GAME_DARE_TABLE || 'dare_cards',
  /** Helps verify which deployment you opened (optional, app ignores unknown keys). */
  deployEnv: vercelEnv,
};

const body = `// Generated at build time — do not commit (see .gitignore)
window.GAME_CONFIG = ${JSON.stringify(config, null, 2)};
`;

writeFileSync(outPath, body, 'utf8');
console.log(`[inject-vercel-config] wrote ${outPath} (VERCEL_ENV=${vercelEnv})`);
