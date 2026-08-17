#!/usr/bin/env bash
# Start the Riverbend Resident Portal under pm2 (single process: API + SPA).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "No .env found. Copy .env.example to .env and fill it in first." >&2
  exit 1
fi

echo "→ postgres"
docker compose up -d postgres >/dev/null
bash scripts/wait-db.sh

echo "→ build"
pnpm --filter @resident/shared build
pnpm --filter @resident/api build
pnpm --filter @resident/web build

echo "→ schema"
# The Prisma CLI only reads .env from its own cwd, not the workspace root.
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"'"'"'')"
pnpm --filter @resident/api exec prisma db push --skip-generate

echo "→ pm2"
pnpm exec pm2 startOrReload ecosystem.config.cjs --update-env
pnpm exec pm2 save >/dev/null 2>&1 || true

bash scripts/wait-health.sh
pnpm exec pm2 status
