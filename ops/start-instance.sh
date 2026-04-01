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

if [ "${INSTANCE_RUNTIME_KIND:-host}" = "container" ]; then
  shared_ops_require_command docker

  container_selector="$(shared_ops_container_selector)"
  container_repo_root="${INSTANCE_CONTAINER_REPO_ROOT:-$(shared_ops_default_container_repo_root)}"
  container_state_dir="${INSTANCE_CONTAINER_STATE_DIR:-}"
  container_run_dir="${INSTANCE_CONTAINER_RUN_DIR:-}"
  container_log_dir="${INSTANCE_CONTAINER_LOG_DIR:-}"
  container_config_path="${INSTANCE_CONTAINER_CONFIG_PATH:-}"
  container_pid_file="${INSTANCE_CONTAINER_PID_FILE:-}"

  [ -n "$container_state_dir" ] || shared_ops_fail "container-managed instance is missing INSTANCE_CONTAINER_STATE_DIR"
  [ -n "$container_run_dir" ] || shared_ops_fail "container-managed instance is missing INSTANCE_CONTAINER_RUN_DIR"
  [ -n "$container_log_dir" ] || shared_ops_fail "container-managed instance is missing INSTANCE_CONTAINER_LOG_DIR"
  [ -n "$container_config_path" ] || shared_ops_fail "container-managed instance is missing INSTANCE_CONTAINER_CONFIG_PATH"
  [ -n "$container_pid_file" ] || shared_ops_fail "container-managed instance is missing INSTANCE_CONTAINER_PID_FILE"

  shared_ops_docker_exec "$container_selector" sh -lc '
set -eu
instance_id="$1"
instance_name="$2"
repo_root="$3"
config_path="$4"
profile="$5"
state_dir="$6"
run_dir="$7"
log_dir="$8"
pid_file="$9"
stdout_log="${10}"
stderr_log="${11}"
port="${12}"
bind="${13}"
verbose="${14}"

[ -f "$config_path" ] || { printf "config file not found: %s\n" "$config_path" >&2; exit 41; }
[ -f "$repo_root/openclaw.mjs" ] || { printf "entrypoint not found: %s/openclaw.mjs\n" "$repo_root" >&2; exit 42; }

mkdir -p "$log_dir" "$run_dir" "$state_dir"
touch "$stdout_log" "$stderr_log"

if [ -f "$pid_file" ]; then
  existing_pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    printf "instance is already running (pid=%s)\n" "$existing_pid" >&2
    exit 43
  fi
  rm -f "$pid_file"
fi

cd "$repo_root"
set -- node openclaw.mjs gateway --port "$port" --bind "$bind" --allow-unconfigured
if [ "$verbose" = "1" ]; then
  set -- "$@" --verbose
fi

(
  export OPENCLAW_PROFILE="$profile"
  export OPENCLAW_STATE_DIR="$state_dir"
  export OPENCLAW_CONFIG_PATH="$config_path"
  export OPENCLAW_INSTANCE_ID="$instance_id"
  export OPENCLAW_INSTANCE_NAME="$instance_name"
  nohup "$@" >>"$stdout_log" 2>>"$stderr_log" < /dev/null &
  echo $! >"$pid_file"
)
' sh "$INSTANCE_ID" "$INSTANCE_NAME" "$container_repo_root" "$container_config_path" "$OPENCLAW_PROFILE" "$container_state_dir" "$container_run_dir" "$container_log_dir" "$container_pid_file" "$container_log_dir/gateway.stdout.log" "$container_log_dir/gateway.stderr.log" "$INSTANCE_PORT" "$INSTANCE_BIND" "$GATEWAY_VERBOSE"

  for _ in $(seq 1 40); do
    if [ -f "$INSTANCE_PID_FILE" ]; then
      break
    fi
    sleep 0.25
  done

  [ -f "$INSTANCE_PID_FILE" ] || shared_ops_fail "container instance started but pid file is not visible on host; verify the instance root is mounted into $container_selector"

  gateway_pid="$(cat "$INSTANCE_PID_FILE" 2>/dev/null || true)"
  for _ in $(seq 1 80); do
    if ! shared_ops_container_pid_is_running "$container_selector" "$gateway_pid"; then
      rm -f "$INSTANCE_PID_FILE"
      shared_ops_fail "containerized gateway exited during startup; see logs: $INSTANCE_LOG_DIR/gateway.stderr.log"
    fi
    if shared_ops_container_http_ok "$container_selector" "$(shared_ops_gateway_health_url "$INSTANCE_PORT")" 2; then
      shared_ops_log "instance $INSTANCE_ID started in container $container_selector (pid=$gateway_pid, port=$INSTANCE_PORT)"
      exit 0
    fi
    sleep 0.25
  done

  if shared_ops_container_pid_is_running "$container_selector" "$gateway_pid"; then
    shared_ops_warn "containerized gateway process is running but /healthz is not ready yet"
    shared_ops_log "pid=$gateway_pid container=$container_selector"
    exit 0
  fi

  rm -f "$INSTANCE_PID_FILE"
  shared_ops_fail "containerized gateway failed to start; see logs: $INSTANCE_LOG_DIR/gateway.stderr.log"
fi

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
