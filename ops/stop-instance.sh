#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/shared-instance-common.sh"

usage() {
  cat <<'EOF'
Usage: stop-instance.sh <instance-id|instance-dir> [options]

Options:
  --root <dir>     Instances root directory
  --force          Send SIGKILL after graceful timeout
  -h, --help       Show this help
EOF
}

INSTANCES_ROOT="$(shared_ops_default_instances_root)"
INSTANCE_SELECTOR=""
FORCE_KILL=0

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
    --force)
      FORCE_KILL=1
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
  container_pid_file="${INSTANCE_CONTAINER_PID_FILE:-}"
  [ -n "$container_pid_file" ] || shared_ops_fail "container-managed instance is missing INSTANCE_CONTAINER_PID_FILE"

  container_pid=""
  if [ -f "$INSTANCE_PID_FILE" ]; then
    container_pid="$(cat "$INSTANCE_PID_FILE" 2>/dev/null || true)"
  fi
  if [ -z "$container_pid" ]; then
    container_pid="$(shared_ops_docker_exec "$container_selector" sh -lc 'cat "$1" 2>/dev/null || true' sh "$container_pid_file" 2>/dev/null || true)"
  fi

  if [ -z "$container_pid" ]; then
    rm -f "$INSTANCE_PID_FILE"
    shared_ops_log "instance $INSTANCE_ID is already stopped"
    exit 0
  fi

  if ! shared_ops_container_pid_is_running "$container_selector" "$container_pid"; then
    rm -f "$INSTANCE_PID_FILE"
    shared_ops_docker_exec "$container_selector" sh -lc 'rm -f "$1"' sh "$container_pid_file" >/dev/null 2>&1 || true
    shared_ops_warn "removed stale container pid file for instance $INSTANCE_ID"
    exit 0
  fi

  shared_ops_docker_exec "$container_selector" sh -lc 'kill "$1" 2>/dev/null || true' sh "$container_pid" >/dev/null 2>&1 || true

  for _ in $(seq 1 40); do
    if ! shared_ops_container_pid_is_running "$container_selector" "$container_pid"; then
      rm -f "$INSTANCE_PID_FILE"
      shared_ops_docker_exec "$container_selector" sh -lc 'rm -f "$1"' sh "$container_pid_file" >/dev/null 2>&1 || true
      shared_ops_log "instance $INSTANCE_ID stopped in container $container_selector"
      exit 0
    fi
    sleep 0.25
  done

  if [ "$FORCE_KILL" -eq 1 ]; then
    shared_ops_warn "graceful stop timed out; sending SIGKILL to container pid=$container_pid"
    shared_ops_docker_exec "$container_selector" sh -lc 'kill -9 "$1" 2>/dev/null || true' sh "$container_pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      if ! shared_ops_container_pid_is_running "$container_selector" "$container_pid"; then
        rm -f "$INSTANCE_PID_FILE"
        shared_ops_docker_exec "$container_selector" sh -lc 'rm -f "$1"' sh "$container_pid_file" >/dev/null 2>&1 || true
        shared_ops_log "instance $INSTANCE_ID force-stopped in container $container_selector"
        exit 0
      fi
      sleep 0.25
    done
  fi

  shared_ops_fail "failed to stop container-managed instance $INSTANCE_ID (pid=$container_pid, container=$container_selector)"
fi

if [ ! -f "$INSTANCE_PID_FILE" ]; then
  shared_ops_log "instance $INSTANCE_ID is already stopped"
  exit 0
fi

gateway_pid="$(cat "$INSTANCE_PID_FILE" 2>/dev/null || true)"
if ! shared_ops_pid_is_running "$gateway_pid"; then
  rm -f "$INSTANCE_PID_FILE"
  shared_ops_warn "removed stale pid file for instance $INSTANCE_ID"
  exit 0
fi

kill "$gateway_pid" 2>/dev/null || true

for _ in $(seq 1 40); do
  if ! shared_ops_pid_is_running "$gateway_pid"; then
    rm -f "$INSTANCE_PID_FILE"
    shared_ops_log "instance $INSTANCE_ID stopped"
    exit 0
  fi
  sleep 0.25
done

if [ "$FORCE_KILL" -eq 1 ]; then
  shared_ops_warn "graceful stop timed out; sending SIGKILL to pid=$gateway_pid"
  kill -9 "$gateway_pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    if ! shared_ops_pid_is_running "$gateway_pid"; then
      rm -f "$INSTANCE_PID_FILE"
      shared_ops_log "instance $INSTANCE_ID force-stopped"
      exit 0
    fi
    sleep 0.25
  done
fi

shared_ops_fail "failed to stop instance $INSTANCE_ID (pid=$gateway_pid)"
