/**
 * 將 GAME_* 環境變數寫入 Vercel 專案（需 VERCEL_TOKEN + VERCEL_PROJECT_ID）
 * 使用方式：node scripts/push-vercel-env.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvLocal() {
  const path = join(root, '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvLocal();

const token = process.env.VERCEL_TOKEN;
const projectId =
  process.env.VERCEL_PROJECT_ID ||
  (() => {
    try {
      const p = JSON.parse(
        readFileSync(join(root, '.vercel', 'project.json'), 'utf8'),
      );
      return p.projectId;
    } catch {
      return '';
    }
  })();

if (!token || !projectId) {
  console.error('❌ 需要 VERCEL_TOKEN 與 VERCEL_PROJECT_ID（或先 vercel link）');
  process.exit(1);
}

const vars = [
  { key: 'GAME_API_BASE_URL', value: process.env.GAME_API_BASE_URL },
  { key: 'GAME_API_KEY', value: process.env.GAME_API_KEY },
  { key: 'GAME_USE_SUPABASE', value: process.env.GAME_USE_SUPABASE || 'true' },
].filter((v) => v.value);

if (vars.length < 2) {
  console.error('❌ 請先在 .env.local 設定 GAME_API_BASE_URL 與 GAME_API_KEY');
  process.exit(1);
}

const targets = ['production', 'preview', 'development'];

async function listEnv() {
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${projectId}/env`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`list env: ${res.status} ${await res.text()}`);
  return res.json();
}

async function deleteEnv(id) {
  await fetch(
    `https://api.vercel.com/v9/projects/${projectId}/env/${id}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
}

async function createEnv(key, value, target) {
  const res = await fetch(
    `https://api.vercel.com/v10/projects/${projectId}/env`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key,
        value,
        type: 'encrypted',
        target: [target],
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`create ${key}/${target}: ${res.status} ${await res.text()}`);
  }
}

try {
  const existing = await listEnv();
  for (const { key, value } of vars) {
    for (const target of targets) {
      const old = (existing.envs || []).filter(
        (e) => e.key === key && e.target?.includes(target),
      );
      for (const e of old) await deleteEnv(e.id);
      await createEnv(key, value, target);
      console.log(`✅ Vercel env: ${key} → ${target}`);
    }
  }
  console.log('\n請到 Vercel Dashboard → Deployments → Redeploy 讓設定生效。');
} catch (err) {
  console.error('❌', err.message);
  process.exit(1);
}
