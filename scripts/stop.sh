#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
pnpm exec pm2 delete resident-api >/dev/null 2>&1 || true
echo "Stopped resident-api (postgres left running; use 'docker compose down' to stop it too)."
