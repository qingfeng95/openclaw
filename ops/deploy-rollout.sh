#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/shared-console-deploy-common.sh"

usage() {
  cat <<'EOF'
Usage: deploy-rollout.sh [options]

Options:
  --target <name>     api | web | all (default: all)
  --skip-check        Skip post-restart active checks
  -h, --help          Show this help

Environment:
  SHARED_CONSOLE_API_SERVICE
  SHARED_CONSOLE_WEB_SERVICE
  SHARED_CONSOLE_API_RESTART_CMD
  SHARED_CONSOLE_WEB_RESTART_CMD
EOF
}

shared_deploy_require_command bash

TARGET="all"
SKIP_CHECK=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --target)
      shift
      [ "$#" -gt 0 ] || shared_deploy_fail "--target requires a value"
      TARGET="$1"
      ;;
    --skip-check)
      SKIP_CHECK=1
      ;;
    --*)
      shared_deploy_fail "unknown option: $1"
      ;;
    *)
      shared_deploy_fail "unexpected argument: $1"
      ;;
  esac
  shift
done

case "$TARGET" in
  api|web|all)
    ;;
  *)
    shared_deploy_fail "unsupported target: $TARGET"
    ;;
esac

run_restart() {
  local label="$1"
  local service_name="$2"
  local restart_cmd="$3"

  if [ -n "$service_name" ]; then
    shared_deploy_require_command systemctl
    shared_deploy_log "restarting $label via systemd service $service_name"
    systemctl restart "$service_name"
    if [ "$SKIP_CHECK" -ne 1 ]; then
      systemctl is-active --quiet "$service_name" || shared_deploy_fail "$label service is not active: $service_name"
    fi
    return
  fi

  if [ -n "$restart_cmd" ]; then
    shared_deploy_log "restarting $label via custom command"
    bash -lc "$restart_cmd"
    return
  fi

  shared_deploy_warn "skip $label rollout because no service or restart command is configured"
}

detect_service_name() {
  local configured_name="$1"
  local candidate_name="$2"
  local unit_name="${candidate_name}.service"

  if [ -n "$configured_name" ]; then
    printf '%s\n' "$configured_name"
    return
  fi

  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "$unit_name" --no-legend 2>/dev/null | grep -Fq "$unit_name"; then
    printf '%s\n' "$candidate_name"
    return
  fi

  printf '%s\n' ""
}

API_SERVICE_NAME="$(detect_service_name "${SHARED_CONSOLE_API_SERVICE:-}" "shared-console-api")"
WEB_SERVICE_NAME="$(detect_service_name "${SHARED_CONSOLE_WEB_SERVICE:-}" "shared-console-web")"

if [ "$TARGET" = "api" ] || [ "$TARGET" = "all" ]; then
  run_restart "shared-console-api" "$API_SERVICE_NAME" "${SHARED_CONSOLE_API_RESTART_CMD:-}"
fi

if [ "$TARGET" = "web" ] || [ "$TARGET" = "all" ]; then
  run_restart "shared-console-web" "$WEB_SERVICE_NAME" "${SHARED_CONSOLE_WEB_RESTART_CMD:-}"
fi

shared_deploy_log "rollout completed for target=$TARGET"
