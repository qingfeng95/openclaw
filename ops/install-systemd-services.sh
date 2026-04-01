#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMD_DIR="$SCRIPT_DIR/systemd"
ENV_TEMPLATE="$SCRIPT_DIR/shared-console.env.example"
TARGET_ENV_DIR="/etc/openclaw"
TARGET_ENV_FILE="$TARGET_ENV_DIR/shared-console.env"

usage() {
  cat <<'EOF'
Usage: install-systemd-services.sh [options]

Options:
  --env-file <path>   Source env file to install instead of the example template
  --force-env         Overwrite an existing /etc/openclaw/shared-console.env
  --start             Enable and restart services after installation
  -h, --help          Show this help
EOF
}

ENV_SOURCE="$ENV_TEMPLATE"
FORCE_ENV=0
START_SERVICES=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --env-file)
      shift
      [ "$#" -gt 0 ] || { echo "--env-file requires a value" >&2; exit 1; }
      ENV_SOURCE="$1"
      ;;
    --force-env)
      FORCE_ENV=1
      ;;
    --start)
      START_SERVICES=1
      ;;
    --*)
      echo "unknown option: $1" >&2
      exit 1
      ;;
    *)
      echo "unexpected argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

[ -f "$ENV_SOURCE" ] || { echo "env file not found: $ENV_SOURCE" >&2; exit 1; }

install -d -m 0755 "$TARGET_ENV_DIR"
install -m 0644 "$SYSTEMD_DIR/shared-console-api.service" /etc/systemd/system/shared-console-api.service
install -m 0644 "$SYSTEMD_DIR/shared-console-web.service" /etc/systemd/system/shared-console-web.service

if [ ! -f "$TARGET_ENV_FILE" ] || [ "$FORCE_ENV" -eq 1 ]; then
  install -m 0644 "$ENV_SOURCE" "$TARGET_ENV_FILE"
else
  echo "keeping existing env file: $TARGET_ENV_FILE"
fi

systemctl daemon-reload
systemctl enable shared-console-api.service shared-console-web.service

if [ "$START_SERVICES" -eq 1 ]; then
  systemctl restart shared-console-api.service shared-console-web.service
  systemctl --no-pager --full status shared-console-api.service shared-console-web.service
else
  echo "services installed. Start them with:"
  echo "  systemctl restart shared-console-api.service shared-console-web.service"
fi
