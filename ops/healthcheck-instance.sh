#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/shared-instance-common.sh"

usage() {
  cat <<'EOF'
Usage: healthcheck-instance.sh <instance-id|instance-dir> [options]

Options:
  --root <dir>                    Instances root directory
  --timeout <seconds>             HTTP timeout for each probe (default: 3)
  --strict-shared-endpoints       Fail when /version or /shared/usage/summary are missing
  -h, --help                      Show this help
EOF
}

shared_ops_require_command curl
shared_ops_require_command node

INSTANCES_ROOT="$(shared_ops_default_instances_root)"
INSTANCE_SELECTOR=""
HTTP_TIMEOUT=3
STRICT_SHARED_ENDPOINTS=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --root)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--root requires a value"
      INSTANCES_ROOT="$1"
      ;;
    --timeout)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--timeout requires a value"
      HTTP_TIMEOUT="$1"
      ;;
    --strict-shared-endpoints)
      STRICT_SHARED_ENDPOINTS=1
      ;;
    --*)
      shared_ops_fail "unknown option: $1"
      ;;
    *)
      if [ -n "$INSTANCE_SELECTOR" ]; then
        shared_ops_fail "instance already provided: $INSTANCE_SELECTOR"
      fi
      INSTANCE_SELECTOR="$1"
      ;;
  esac
  shift
done

[ -n "$INSTANCE_SELECTOR" ] || {
  usage
  exit 1
}

shared_ops_is_integer "$HTTP_TIMEOUT" || shared_ops_fail "invalid timeout: $HTTP_TIMEOUT"

INSTANCE_DIR="$(shared_ops_resolve_instance_dir "$INSTANCES_ROOT" "$INSTANCE_SELECTOR")"
shared_ops_load_instance_env "$INSTANCE_DIR"

if [ -f "$INSTANCE_PID_FILE" ]; then
  gateway_pid="$(cat "$INSTANCE_PID_FILE" 2>/dev/null || true)"
else
  gateway_pid=""
fi

if ! shared_ops_pid_is_running "$gateway_pid"; then
  shared_ops_fail "instance process is not running: $INSTANCE_ID"
fi

health_payload="$(shared_ops_curl_json "$(shared_ops_gateway_health_url "$INSTANCE_PORT")" "$HTTP_TIMEOUT")" || exit 2
ready_payload="$(shared_ops_curl_json "$(shared_ops_gateway_ready_url "$INSTANCE_PORT")" "$HTTP_TIMEOUT")" || exit 2

version_source="http"
if version_payload="$(shared_ops_curl_json "$(shared_ops_gateway_version_url "$INSTANCE_PORT")" "$HTTP_TIMEOUT" 2>/dev/null)"; then
  if shared_ops_payload_is_html "$version_payload"; then
    version_payload=""
  fi
else
  version_payload=""
fi

if [ -z "${version_payload:-}" ]; then
  if [ "$STRICT_SHARED_ENDPOINTS" -eq 1 ]; then
    shared_ops_fail "/version endpoint is unavailable for instance $INSTANCE_ID"
  fi
  version_source="local"
  version_payload="$(shared_ops_local_version)" || shared_ops_fail "failed to resolve local version"
  shared_ops_warn "/version endpoint is unavailable; fell back to local package version"
fi

usage_log_path="$OPENCLAW_STATE_DIR/logs/shared-tool-usage.jsonl"
usage_summary_source="http"
if usage_summary_payload="$(shared_ops_curl_json "$(shared_ops_gateway_usage_summary_url "$INSTANCE_PORT")" "$HTTP_TIMEOUT" 2>/dev/null)"; then
  if shared_ops_payload_is_html "$usage_summary_payload"; then
    usage_summary_payload=""
  fi
else
  usage_summary_payload=""
fi

if [ -z "${usage_summary_payload:-}" ]; then
  if [ "$STRICT_SHARED_ENDPOINTS" -eq 1 ]; then
    shared_ops_fail "/shared/usage/summary endpoint is unavailable for instance $INSTANCE_ID"
  fi
  usage_summary_source="local"
  usage_summary_payload="$(shared_ops_usage_summary_json "$usage_log_path")" || shared_ops_fail "failed to read local usage summary"
  shared_ops_warn "/shared/usage/summary endpoint is unavailable; fell back to local usage log"
fi

shared_ops_log "instance=$INSTANCE_ID pid=$gateway_pid port=$INSTANCE_PORT"
shared_ops_log "health=$health_payload"
shared_ops_log "ready=$ready_payload"
shared_ops_log "version_source=$version_source version=$version_payload"
shared_ops_log "usage_summary_source=$usage_summary_source usage_summary=$usage_summary_payload"
