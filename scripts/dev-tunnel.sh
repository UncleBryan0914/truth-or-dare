#!/usr/bin/env bash
# 本機預覽 + Cloudflare 臨時隧道（含最新 public/ 檔案）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8790}"
BIN="$ROOT/.bin/cloudflared"

if [[ ! -x "$BIN" ]]; then
  echo "缺少 $BIN，請先下載 cloudflared 或執行 Agent 部署步驟。"
  exit 1
fi

cd "$ROOT"
echo "→ 靜態檔：$ROOT/public (http://127.0.0.1:$PORT)"
npx --yes serve public -l "$PORT" &
SERVE_PID=$!
trap 'kill $SERVE_PID 2>/dev/null || true' EXIT

sleep 1
exec "$BIN" tunnel --url "http://127.0.0.1:$PORT"
