/**
 * 驗證 Supabase 連線與卡牌數量（不修改資料庫）
 */
const base = (process.env.GAME_API_BASE_URL || '').replace(/\/$/, '');
const key = process.env.GAME_API_KEY || '';
const truthTable = process.env.GAME_TRUTH_TABLE || 'truth_cards';
const dareTable = process.env.GAME_DARE_TABLE || 'dare_cards';

if (!base || !key) {
  console.error('❌ 缺少 GAME_API_BASE_URL 或 GAME_API_KEY');
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
};

async function countTable(table) {
  const url = `${base}/${table}?select=id&enabled=eq.true`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table}: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  const rows = await res.json();
  return rows.length;
}

try {
  const [truth, dare] = await Promise.all([
    countTable(truthTable),
    countTable(dareTable),
  ]);
  console.log('✅ Supabase 連線成功');
  console.log(`   ${truthTable}: ${truth} 張（enabled=true）`);
  console.log(`   ${dareTable}: ${dare} 張（enabled=true）`);
  if (truth + dare === 0) {
    console.warn('⚠️ 牌庫為空，請到 Table Editor 新增卡牌或確認 enabled=true');
    process.exit(2);
  }
} catch (err) {
  console.error('❌', err.message);
  process.exit(1);
}
