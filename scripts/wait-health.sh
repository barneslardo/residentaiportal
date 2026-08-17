#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="$(grep -E '^API_PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')"
PORT="${PORT:-3220}"

for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "health ok on :${PORT}"
    curl -fsS "http://127.0.0.1:${PORT}/health"
    echo
    exit 0
  fi
  sleep 1
done
echo "API did not answer /health on :${PORT} within 30s" >&2
exit 1
