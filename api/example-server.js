/**
 * 自建 API 範例（Node 18+）
 * 執行：node api/example-server.js
 * 前端 GAME_CONFIG.apiBaseUrl = 'http://localhost:8787/api'
 *
 * 正式環境請改接真實資料庫（Postgres / SQLite），此檔僅示範 JSON 結構。
 */

const http = require('http');

const PORT = 8787;

/** 實務上從 DB 讀取；此處為記憶體示範 */
const deck = {
  truth: [
    { id: 't1', text: '說出一個你從沒告訴過在場任何人的秘密。' },
    { id: 't2', text: '你最後一次說謊是什麼時候？為什麼？' },
  ],
  dare: [
    { id: 'd1', text: '對著窗外大喊：「我是最帥／美的！」' },
    { id: 'd2', text: '模仿在場一位朋友的招牌動作或語氣。' },
  ],
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/api/cards') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(deck));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Cards API: http://localhost:${PORT}/api/cards`);
});
