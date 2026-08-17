#!/usr/bin/env bash
set -euo pipefail
for i in $(seq 1 40); do
  if docker compose exec -T postgres pg_isready -U resident -d resident_portal >/dev/null 2>&1; then
    echo "postgres ready"
    exit 0
  fi
  sleep 1
done
echo "postgres did not become ready in 40s" >&2
exit 1
