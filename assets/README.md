# 牌面原始圖

將以下檔案放在此目錄後執行 `npm run build:cards`：

| 檔案 | 說明 |
|------|------|
| `truth-card-preview.png` | 真心話牌面（含剪影） |
| `dare-card-draft.png` | 大冒險牌面（含剪影） |

亦可使用同名 `.svg`。建置腳本會輸出 **320×464**（@2x，對應 UI 160×232）至 `public/images/cards/`，剪影置於上方 **75%**，底部 **25%** 疊上白字與細線框標籤。

環境變數 `CARD_SRC_DIR` 可指定其他來源目錄。
