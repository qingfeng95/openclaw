#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/shared-instance-common.sh"

usage() {
  cat <<'EOF'
Usage: start-instance.sh <instance-id|instance-dir> [options]

Options:
  --root <dir>     Instances root directory
  --verbose        Pass --verbose to gateway
  -h, --help       Show this help
EOF
}

shared_ops_require_command node
shared_ops_require_command curl

INSTANCES_ROOT="$(shared_ops_default_instances_root)"
INSTANCE_SELECTOR=""
GATEWAY_VERBOSE=0

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
    --verbose)
      GATEWAY_VERBOSE=1
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

INSTANCE_DIR="$(shared_ops_resolve_instance_dir "$INSTANCES_ROOT" "$INSTANCE_SELECTOR")"
shared_ops_load_instance_env "$INSTANCE_DIR"

[ -f "$OPENCLAW_CONFIG_PATH" ] || shared_ops_fail "config file not found: $OPENCLAW_CONFIG_PATH"
[ -f "$(shared_ops_entrypoint)" ] || shared_ops_fail "entrypoint not found: $(shared_ops_entrypoint)"

if [ -f "$INSTANCE_PID_FILE" ]; then
  existing_pid="$(cat "$INSTANCE_PID_FILE" 2>/dev/null || true)"
  if shared_ops_pid_is_running "$existing_pid"; then
    shared_ops_fail "instance is already running (pid=$existing_pid)"
  fi
  rm -f "$INSTANCE_PID_FILE"
fi

shared_ops_port_is_available "$INSTANCE_PORT" || shared_ops_fail "port is already in use: $INSTANCE_PORT"

mkdir -p "$INSTANCE_LOG_DIR" "$INSTANCE_RUN_DIR" "$INSTANCE_STATE_DIR"

stdout_log="$INSTANCE_LOG_DIR/gateway.stdout.log"
stderr_log="$INSTANCE_LOG_DIR/gateway.stderr.log"
touch "$stdout_log" "$stderr_log"

cmd=(node "$(shared_ops_entrypoint)" gateway --port "$INSTANCE_PORT" --bind "$INSTANCE_BIND" --allow-unconfigured)
if [ "$GATEWAY_VERBOSE" -eq 1 ]; then
  cmd+=(--verbose)
fi

(
  export OPENCLAW_PROFILE OPENCLAW_STATE_DIR OPENCLAW_CONFIG_PATH
  export OPENCLAW_INSTANCE_ID="$INSTANCE_ID"
  export OPENCLAW_INSTANCE_NAME="$INSTANCE_NAME"
  nohup "${cmd[@]}" >>"$stdout_log" 2>>"$stderr_log" < /dev/null &
  echo $! >"$INSTANCE_PID_FILE"
)

gateway_pid="$(cat "$INSTANCE_PID_FILE")"

for _ in $(seq 1 80); do
  if ! shared_ops_pid_is_running "$gateway_pid"; then
    rm -f "$INSTANCE_PID_FILE"
    shared_ops_fail "gateway exited during startup; see logs: $stderr_log"
  fi
  if shared_ops_curl_json "$(shared_ops_gateway_health_url "$INSTANCE_PORT")" 2 >/dev/null 2>&1; then
    shared_ops_log "instance $INSTANCE_ID started (pid=$gateway_pid, port=$INSTANCE_PORT)"
    exit 0
  fi
  sleep 0.25
done

if shared_ops_pid_is_running "$gateway_pid"; then
  shared_ops_warn "gateway process is running but /healthz is not ready yet"
  shared_ops_log "pid=$gateway_pid"
  exit 0
fi

rm -f "$INSTANCE_PID_FILE"
shared_ops_fail "gateway failed to start; see logs: $stderr_log"
