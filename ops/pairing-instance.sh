#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/shared-instance-common.sh"

usage() {
  cat <<'EOF'
Usage: pairing-instance.sh <list|approve-latest> <instance-id|instance-dir> [options]

Options:
  --root <dir>     Instances root directory
  -h, --help       Show this help
EOF
}

INSTANCE_ACTION=""
INSTANCE_SELECTOR=""
INSTANCES_ROOT="$(shared_ops_default_instances_root)"

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
    --*)
      shared_ops_fail "unknown option: $1"
      ;;
    *)
      if [ -z "$INSTANCE_ACTION" ]; then
        INSTANCE_ACTION="$1"
      elif [ -z "$INSTANCE_SELECTOR" ]; then
        INSTANCE_SELECTOR="$1"
      else
        shared_ops_fail "unexpected argument: $1"
      fi
      ;;
  esac
  shift
done

[ -n "$INSTANCE_ACTION" ] || {
  usage
  exit 1
}

[ -n "$INSTANCE_SELECTOR" ] || {
  usage
  exit 1
}

case "$INSTANCE_ACTION" in
  list|approve-latest)
    ;;
  *)
    shared_ops_fail "unsupported action: $INSTANCE_ACTION"
    ;;
esac

INSTANCE_DIR="$(shared_ops_resolve_instance_dir "$INSTANCES_ROOT" "$INSTANCE_SELECTOR")"
shared_ops_load_instance_env "$INSTANCE_DIR"

instance_gateway_token() {
  local token="${INSTANCE_PROXY_TOKEN:-${OPENCLAW_GATEWAY_TOKEN:-}}"
  printf '%s\n' "$token"
}

run_host_cli() {
  local gateway_token="$1"
  shift
  shared_ops_require_command node
  export OPENCLAW_PROFILE OPENCLAW_STATE_DIR OPENCLAW_CONFIG_PATH
  if [ -n "$gateway_token" ]; then
    export OPENCLAW_GATEWAY_TOKEN="$gateway_token"
  else
    unset OPENCLAW_GATEWAY_TOKEN || true
  fi
  cd "$(shared_ops_repo_root)"
  node "$(shared_ops_entrypoint)" "$@"
}

run_container_cli() {
  local gateway_token="$1"
  shift
  shared_ops_require_command docker
  local container_selector
  container_selector="$(shared_ops_container_selector)"
  local container_repo_root="${INSTANCE_CONTAINER_REPO_ROOT:-$(shared_ops_default_container_repo_root)}"
  local container_state_dir="${INSTANCE_CONTAINER_STATE_DIR:-}"
  local container_config_path="${INSTANCE_CONTAINER_CONFIG_PATH:-}"
  local container_profile="${OPENCLAW_PROFILE:-${INSTANCE_PROFILE:-}}"

  [ -n "$container_state_dir" ] || shared_ops_fail "container-managed instance is missing INSTANCE_CONTAINER_STATE_DIR"
  [ -n "$container_config_path" ] || shared_ops_fail "container-managed instance is missing INSTANCE_CONTAINER_CONFIG_PATH"
  [ -n "$container_profile" ] || shared_ops_fail "container-managed instance is missing OPENCLAW_PROFILE"

  docker exec "$container_selector" sh -lc '
set -eu
cd "$1"
export OPENCLAW_PROFILE="$2"
export OPENCLAW_STATE_DIR="$3"
export OPENCLAW_CONFIG_PATH="$4"
if [ -n "$5" ]; then
  export OPENCLAW_GATEWAY_TOKEN="$5"
else
  unset OPENCLAW_GATEWAY_TOKEN || true
fi
shift 5
exec node openclaw.mjs "$@"
' sh "$container_repo_root" "$container_profile" "$container_state_dir" "$container_config_path" "$gateway_token" "$@"
}

run_instance_cli() {
  local gateway_token
  gateway_token="$(instance_gateway_token)"
  if [ "${INSTANCE_RUNTIME_KIND:-host}" = "container" ]; then
    run_container_cli "$gateway_token" "$@"
    return
  fi
  run_host_cli "$gateway_token" "$@"
}

case "$INSTANCE_ACTION" in
  list)
    run_instance_cli devices list --json
    ;;
  approve-latest)
    run_instance_cli devices approve --latest --json
    ;;
esac
