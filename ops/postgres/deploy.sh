#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  cat > .env <<'EOF'
POSTGRES_USER=openclaw
POSTGRES_PASSWORD=change_me_strong_password
POSTGRES_DB=openclaw_control
POSTGRES_PORT=5432
EOF
  echo "[postgres] created default .env; please edit the password before continuing."
fi

mkdir -p data backups

echo "[postgres] starting container..."
docker compose up -d

echo "[postgres] waiting for readiness..."
for _ in {1..30}; do
  if docker exec openclaw-postgres pg_isready -U "${POSTGRES_USER:-openclaw}" -d "${POSTGRES_DB:-openclaw_control}" >/dev/null 2>&1; then
    echo "[postgres] ready"
    exit 0
  fi
  sleep 2
done

echo "[postgres] readiness check timed out" >&2
exit 1
