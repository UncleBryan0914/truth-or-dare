/**
 * 一鍵：載入 .env.local → 寫入 public/config.js → 驗證 Supabase →（可選）推送到 Vercel
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env.local');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    process.env[k] = v;
  }
  console.log('📂 已載入 .env.local');
} else {
  console.log('ℹ️  未找到 .env.local，使用目前 process.env（Cursor Secrets）');
}

const apiBaseUrl = process.env.GAME_API_BASE_URL || '';
const apiKey = process.env.GAME_API_KEY || '';
const useSupabase =
  process.env.GAME_USE_SUPABASE === 'true' ||
  (apiBaseUrl.includes('supabase.co') && apiBaseUrl.includes('/rest/v1'));

if (!apiBaseUrl || !apiKey) {
  console.error(`
❌ 缺少 Supabase 連線資訊，請擇一：

1) 在專案根目錄建立 .env.local（參考 .env.example）
2) 或在 Cursor → Cloud Agent → Secrets 設定：
   GAME_API_BASE_URL、GAME_API_KEY、GAME_USE_SUPABASE=true

取得位置：Supabase → Project Settings → API
  - URL 請用：https://xxxx.supabase.co/rest/v1
  - Key 請用：anon public（不是 service_role）
`);
  process.exit(1);
}

const config = {
  apiBaseUrl,
  apiKey,
  useSupabaseRest: useSupabase,
  truthTable: process.env.GAME_TRUTH_TABLE || 'truth_cards',
  dareTable: process.env.GAME_DARE_TABLE || 'dare_cards',
  deployEnv: 'local-setup',
};

writeFileSync(
  join(root, 'public', 'config.js'),
  `// 由 scripts/setup-cloud.mjs 產生 — 含連線設定，勿 commit 含金鑰的版本\nwindow.GAME_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
  'utf8',
);
console.log('✅ 已寫入 public/config.js（本機預覽用）');

const verify = spawnSync('node', ['scripts/verify-supabase.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
if (verify.status !== 0) process.exit(verify.status ?? 1);

if (process.env.VERCEL_TOKEN) {
  console.log('\n🚀 正在寫入 Vercel 環境變數…');
  const push = spawnSync('node', ['scripts/push-vercel-env.mjs'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (push.status !== 0) process.exit(push.status ?? 1);
} else {
  console.log('\nℹ️  未設定 VERCEL_TOKEN，略過 Vercel。若要代寫入請加上 Token 後再執行 npm run setup:cloud');
}

console.log('\n✅ 設定完成。Table Editor 改題後，玩家重整網頁即可，無需改程式碼。');
