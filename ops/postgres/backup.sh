#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p backups
STAMP="$(date +%F-%H%M%S)"
OUT="backups/backup-${STAMP}.sql"

echo "[postgres] writing backup to ${OUT}"
docker exec openclaw-postgres pg_dump -U "${POSTGRES_USER:-openclaw}" "${POSTGRES_DB:-openclaw_control}" > "$OUT"
echo "[postgres] done"
