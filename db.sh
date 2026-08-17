#!/usr/bin/env bash
# Run a Prisma command with DATABASE_URL taken from the workspace-root .env.
#
#   scripts/db.sh push     — apply schema.prisma to the database
#   scripts/db.sh seed     — load the Riverbend demo dataset
#   scripts/db.sh studio   — open Prisma Studio
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "No .env found at $ROOT" >&2
  exit 1
fi

DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/^["'"'"']//; s/["'"'"']$//')"
export DATABASE_URL

case "${1:-push}" in
  push)   pnpm --filter @resident/api exec prisma db push --skip-generate ;;
  seed)   pnpm --filter @resident/api exec tsx prisma/seed.ts ;;
  studio) pnpm --filter @resident/api exec prisma studio ;;
  reset)  pnpm --filter @resident/api exec prisma db push --force-reset --skip-generate ;;
  *)      echo "usage: scripts/db.sh [push|seed|studio|reset]" >&2; exit 1 ;;
esac
