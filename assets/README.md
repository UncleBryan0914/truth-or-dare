# 牌面原始圖

| 檔案 | 說明 |
|------|------|
| `truth-card-preview-source.png` | 真心話主檔（建置優先使用） |
| `truth-card-preview.png` | 真心話備用 |
| `dare-card-draft.png` | 大冒險主檔 |

執行 `npm run build:cards` 產出 `public/images/cards/`。

## 建置原則

- **保留**您圖檔中的剪影大小、間距、在畫面中的相對位置與底色。
- **僅調整**：(1) TRUTH / DARE 字樣共用同一套高度與基線；(2) 大冒險剪影去毛邊（不位移、不縮放比例）。
- 輸出尺寸：@2x **320×464**、@1x **160×232**（與 `public/index.html` 牌堆一致）。
