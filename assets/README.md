# 牌面主檔（截圖）

請將兩張截圖放到此目錄後執行 `npm run build:cards`：

| 檔案 | 來源 |
|------|------|
| `truth-card-master.png` | `截圖 2026-06-02 凌晨12.17.19.png`（真心話） |
| `dare-card-master.png` | `截圖 2026-06-02 凌晨12.17.29.png`（大冒險） |

## Mac 一鍵匯入（建議）

將 Cursor 對話中上傳的兩張截圖存到本機後執行：

```bash
node scripts/import-card-masters.mjs \
  "/Users/bryanchou/Documents/截圖 2026-06-02 凌晨12.17.19.png" \
  "/Users/bryanchou/Documents/截圖 2026-06-02 凌晨12.17.29.png"
npm run build:cards
```

或手動複製為 `assets/truth-card-master.png`、`assets/dare-card-master.png` 後執行 `npm run build:cards`。

## 建置原則

- **完整保留**截圖中的比例、字體、剪影位置與大小（僅等比縮放到 320×464）。
- **僅調整**：(1) 兩張牌的 TRUTH / DARE 字樣垂直對齊；(2) 大冒險上方剪影區去毛邊。

產出：`public/images/cards/`（@2x 320×464、@1x 160×232）。
