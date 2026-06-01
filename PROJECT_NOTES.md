# truth-or-dare 專案說明（跨裝置同步用）

> 此檔記錄開發脈絡，方便在 Mac / 新 Cursor 工作區延續。  
> Repo: https://github.com/UncleBryan0914/truth-or-dare

## 功能摘要

- 左側：真心話牌堆；右側：大冒險牌堆；每次擇一抽取。
- 本局已抽過的卡不會再出現。
- 本局狀態存在瀏覽器 `localStorage`（key: `truth_or_dare_session_v1`）。
- **重新整理網頁不會重置本局**；只有按 **「開啟新局」** 才會清空。
- 牌庫版本變更（後端卡牌 id 集合改變）時會自動開新局。

## 目錄結構

| 路徑 | 說明 |
|------|------|
| `public/index.html` | 主頁 UI |
| `public/app.js` | 抽卡邏輯、API 載入、localStorage |
| `public/config.example.js` | API 設定範例（複製為 `config.js`，勿 commit 含 key 的檔） |
| `supabase/schema.sql` | Supabase 資料表與 RLS |
| `api/example-server.js` | 自建 API 範例 |
| `vercel.json` / `netlify.toml` | 靜態部署設定 |

## 卡牌內容要放哪裡

| 方式 | 適用 |
|------|------|
| `app.js` 的 `DEMO_DECK` | 本機試玩，`GAME_CONFIG.apiBaseUrl` 留空 |
| **Supabase** `truth_cards` / `dare_cards` | 建議：常態維護題庫 |
| 自建 `GET /api/cards` | 進階、需後台時 |

欄位：`text`（題目）、`sort_order`（排序）、`enabled`（false = 下架）。

## 前端接上 Supabase

在 `public/index.html` 的 `GAME_CONFIG`：

```javascript
window.GAME_CONFIG = {
  apiBaseUrl: 'https://YOUR_PROJECT.supabase.co/rest/v1',
  apiKey: 'YOUR_SUPABASE_ANON_KEY',
  useSupabaseRest: true,
  truthTable: 'truth_cards',
  dareTable: 'dare_cards',
};
```

## 本機預覽

```bash
cd public
open index.html          # macOS
# 或
npx --yes serve .
```

## 部署（前端）

1. Push 到 GitHub。
2. Vercel / Netlify 連動 repo，發佈目錄 `public`（見 `vercel.json`）。

## 規劃中：自訂牌組

- **一次性自訂**：僅前端覆蓋 `catalog`，可用 `sessionStorage` 或記憶體；關分頁即消失；**不必**寫入 Supabase。
- **持久牌組**：需寫入目前環境的 DB + 使用者識別（登入）。
- 建議產品形態：預設題庫（後端）+「本局自訂」+ 可選「儲存我的牌組」。

## Mac 換機步驟

```bash
brew install git gh
gh auth login
mkdir -p ~/Projects && cd ~/Projects
git clone https://github.com/UncleBryan0914/truth-or-dare.git
cd truth-or-dare
```

Cursor：**Open Folder** → 本 repo；新 chat 可引用本檔。

## 請 Agent 更新 GitHub 時

在 Cursor 開啟本 repo 資料夾後說：**「請 commit 並 push 到 GitHub」**。
