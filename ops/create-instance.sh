#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/shared-instance-common.sh"

usage() {
  cat <<'EOF'
Usage: create-instance.sh <instance-id> [options]

Options:
  --root <dir>          Instances root directory
  --port <port>         Gateway port; auto-allocates when omitted
  --profile <name>      OPENCLAW_PROFILE value (default: shared-<instance-id>)
  --template <name>     Template label or path (default: internal-test)
  --bind <mode>         Gateway bind mode (default: loopback)
  --name <name>         Human-readable instance name
  --runtime-kind <kind> host | container (default: host)
  --container-name <n>  Target container name for container-managed instances
  --container-id <id>   Target container id for container-managed instances
  --container-repo-root <dir>
                        Repo root inside the target container
  --container-instances-root <dir>
                        Instances root inside the target container
  -h, --help            Show this help
EOF
}

shared_ops_require_command node

INSTANCE_ID=""
INSTANCE_NAME=""
INSTANCES_ROOT="$(shared_ops_default_instances_root)"
INSTANCE_PORT=""
INSTANCE_PROFILE=""
INSTANCE_TEMPLATE="internal-test"
INSTANCE_BIND="loopback"
INSTANCE_RUNTIME_KIND="host"
INSTANCE_CONTAINER_NAME=""
INSTANCE_CONTAINER_ID=""
INSTANCE_CONTAINER_REPO_ROOT=""
INSTANCE_CONTAINER_ROOT=""

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
    --port)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--port requires a value"
      INSTANCE_PORT="$1"
      ;;
    --profile)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--profile requires a value"
      INSTANCE_PROFILE="$1"
      ;;
    --template)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--template requires a value"
      INSTANCE_TEMPLATE="$1"
      ;;
    --bind)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--bind requires a value"
      INSTANCE_BIND="$1"
      ;;
    --name)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--name requires a value"
      INSTANCE_NAME="$1"
      ;;
    --runtime-kind)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--runtime-kind requires a value"
      INSTANCE_RUNTIME_KIND="$1"
      ;;
    --container-name)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--container-name requires a value"
      INSTANCE_CONTAINER_NAME="$1"
      ;;
    --container-id)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--container-id requires a value"
      INSTANCE_CONTAINER_ID="$1"
      ;;
    --container-repo-root)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--container-repo-root requires a value"
      INSTANCE_CONTAINER_REPO_ROOT="$1"
      ;;
    --container-instances-root)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--container-instances-root requires a value"
      INSTANCE_CONTAINER_ROOT="$1"
      ;;
    --*)
      shared_ops_fail "unknown option: $1"
      ;;
    *)
      if [ -n "$INSTANCE_ID" ]; then
        shared_ops_fail "instance id already provided: $INSTANCE_ID"
      fi
      INSTANCE_ID="$1"
      ;;
  esac
  shift
done

[ -n "$INSTANCE_ID" ] || {
  usage
  exit 1
}

shared_ops_validate_instance_id "$INSTANCE_ID" || shared_ops_fail "invalid instance id: $INSTANCE_ID"

if [ -z "$INSTANCE_NAME" ]; then
  INSTANCE_NAME="$INSTANCE_ID"
fi

if [ -z "$INSTANCE_PROFILE" ]; then
  INSTANCE_PROFILE="shared-$INSTANCE_ID"
fi

case "$INSTANCE_BIND" in
  loopback|lan|tailnet|auto|custom)
    ;;
  *)
    shared_ops_fail "unsupported bind mode: $INSTANCE_BIND"
    ;;
esac

case "$INSTANCE_RUNTIME_KIND" in
  host|container)
    ;;
  *)
    shared_ops_fail "unsupported runtime kind: $INSTANCE_RUNTIME_KIND"
    ;;
esac

if [ "$INSTANCE_RUNTIME_KIND" = "container" ] && [ -z "$INSTANCE_CONTAINER_NAME" ] && [ -z "$INSTANCE_CONTAINER_ID" ]; then
  shared_ops_fail "container runtime requires --container-name or --container-id"
fi

if [ "$INSTANCE_RUNTIME_KIND" = "container" ] && [ -z "$INSTANCE_CONTAINER_REPO_ROOT" ]; then
  INSTANCE_CONTAINER_REPO_ROOT="$(shared_ops_default_container_repo_root)"
fi

if [ "$INSTANCE_RUNTIME_KIND" = "container" ] && [ -z "$INSTANCE_CONTAINER_ROOT" ]; then
  INSTANCE_CONTAINER_ROOT="$(shared_ops_default_container_instances_root "$INSTANCES_ROOT")"
fi

mapfile -t INSTANCE_PORT_SEARCH_ROOTS < <(shared_ops_port_search_roots "$INSTANCES_ROOT" | awk '!seen[$0]++')

if [ -n "$INSTANCE_PORT" ]; then
  shared_ops_validate_port "$INSTANCE_PORT" || shared_ops_fail "invalid port: $INSTANCE_PORT"
  shared_ops_port_is_assignable "$INSTANCE_PORT" "${INSTANCE_PORT_SEARCH_ROOTS[@]}" ||
    shared_ops_fail "port is already in use or reserved by another instance: $INSTANCE_PORT"
else
  INSTANCE_PORT="$(shared_ops_find_available_port 19100 400 "${INSTANCE_PORT_SEARCH_ROOTS[@]}")" ||
    shared_ops_fail "failed to allocate an available port"
fi

INSTANCE_DIR="$INSTANCES_ROOT/$INSTANCE_ID"
[ ! -e "$INSTANCE_DIR" ] || shared_ops_fail "instance already exists: $INSTANCE_DIR"

INSTANCE_CONFIG_DIR="$INSTANCE_DIR/config"
INSTANCE_TEMPLATE_DIR="$INSTANCE_CONFIG_DIR/templates"
INSTANCE_LOG_DIR="$INSTANCE_DIR/logs"
INSTANCE_RUN_DIR="$INSTANCE_DIR/run"
INSTANCE_PROFILE_DIR="$INSTANCE_DIR/profile"
INSTANCE_STATE_DIR="$INSTANCE_DIR/state"
INSTANCE_TMP_DIR="$INSTANCE_DIR/tmp"
INSTANCE_CONFIG_PATH="$INSTANCE_CONFIG_DIR/openclaw.instance.json5"
INSTANCE_ENV_PATH="$INSTANCE_DIR/instance.env"
INSTANCE_PID_FILE="$INSTANCE_RUN_DIR/gateway.pid"
INSTANCE_CONTAINER_DIR=""
INSTANCE_CONTAINER_CONFIG_PATH=""
INSTANCE_CONTAINER_LOG_DIR=""
INSTANCE_CONTAINER_RUN_DIR=""
INSTANCE_CONTAINER_PROFILE_DIR=""
INSTANCE_CONTAINER_STATE_DIR=""
INSTANCE_CONTAINER_PID_FILE=""
INSTANCE_PROXY_TOKEN=""

if [ "$INSTANCE_RUNTIME_KIND" = "container" ]; then
  INSTANCE_CONTAINER_DIR="$INSTANCE_CONTAINER_ROOT/$INSTANCE_ID"
  INSTANCE_CONTAINER_CONFIG_PATH="$INSTANCE_CONTAINER_DIR/config/openclaw.instance.json5"
  INSTANCE_CONTAINER_LOG_DIR="$INSTANCE_CONTAINER_DIR/logs"
  INSTANCE_CONTAINER_RUN_DIR="$INSTANCE_CONTAINER_DIR/run"
  INSTANCE_CONTAINER_PROFILE_DIR="$INSTANCE_CONTAINER_DIR/profile"
  INSTANCE_CONTAINER_STATE_DIR="$INSTANCE_CONTAINER_DIR/state"
  INSTANCE_CONTAINER_PID_FILE="$INSTANCE_CONTAINER_RUN_DIR/gateway.pid"
  INSTANCE_PROXY_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(18).toString('base64url'))")"
fi

mkdir -p \
  "$INSTANCE_TEMPLATE_DIR" \
  "$INSTANCE_LOG_DIR" \
  "$INSTANCE_RUN_DIR" \
  "$INSTANCE_PROFILE_DIR" \
  "$INSTANCE_STATE_DIR" \
  "$INSTANCE_TMP_DIR"

REPO_ROOT="$(shared_ops_repo_root)"
BASE_TEMPLATE_PATH="$REPO_ROOT/config/templates/shared-instance.base.yaml"
INTERNAL_TEMPLATE_PATH="$REPO_ROOT/config/templates/shared-instance.internal-test.yaml"
OVERRIDE_TEMPLATE_PATH="$REPO_ROOT/config/templates/shared-instance.override.example.yaml"

for template_path in "$BASE_TEMPLATE_PATH" "$INTERNAL_TEMPLATE_PATH" "$OVERRIDE_TEMPLATE_PATH"; do
  [ -f "$template_path" ] || shared_ops_fail "template not found: $template_path"
  cp "$template_path" "$INSTANCE_TEMPLATE_DIR/"
done

SELECTED_TEMPLATE_NAME="$INSTANCE_TEMPLATE"
if [ -f "$INSTANCE_TEMPLATE" ]; then
  cp "$INSTANCE_TEMPLATE" "$INSTANCE_TEMPLATE_DIR/selected-template.snapshot"
  SELECTED_TEMPLATE_NAME="$INSTANCE_TEMPLATE"
fi

CONTROL_UI_HOST_HEADER_FALLBACK_LINE=""
if [ "$INSTANCE_RUNTIME_KIND" = "container" ]; then
  CONTROL_UI_HOST_HEADER_FALLBACK_LINE='      dangerouslyAllowHostHeaderOriginFallback: true,'
fi

cat >"$INSTANCE_CONFIG_PATH" <<EOF
{
  gateway: {
    mode: "local",
    port: $INSTANCE_PORT,
    auth: {
      mode: "none",
    },
    controlUi: {
      enabled: true,
${CONTROL_UI_HOST_HEADER_FALLBACK_LINE}
    },
  },
  browser: {
    sharedRoutedExecutionEnabled: true,
  },
  tools: {
    shared: {
      localSourceValidation: {
        allowedPathPrefixes: ["./", ".\\\\", "tmp/", "tmp\\\\", "./tmp/", ".\\\\tmp\\\\"],
      },
    },
  },
}
EOF

cat >"$INSTANCE_ENV_PATH" <<EOF
INSTANCE_ID="$INSTANCE_ID"
INSTANCE_NAME="$INSTANCE_NAME"
INSTANCE_DIR="$INSTANCE_DIR"
INSTANCE_ROOT="$INSTANCES_ROOT"
INSTANCE_RUNTIME_KIND="$INSTANCE_RUNTIME_KIND"
INSTANCE_PORT="$INSTANCE_PORT"
INSTANCE_PROFILE="$INSTANCE_PROFILE"
INSTANCE_BIND="$INSTANCE_BIND"
INSTANCE_TEMPLATE="$SELECTED_TEMPLATE_NAME"
INSTANCE_PROXY_TOKEN="$INSTANCE_PROXY_TOKEN"
INSTANCE_CONTAINER_NAME="$INSTANCE_CONTAINER_NAME"
INSTANCE_CONTAINER_ID="$INSTANCE_CONTAINER_ID"
INSTANCE_CONTAINER_REPO_ROOT="$INSTANCE_CONTAINER_REPO_ROOT"
INSTANCE_CONTAINER_ROOT="$INSTANCE_CONTAINER_ROOT"
INSTANCE_CONTAINER_DIR="$INSTANCE_CONTAINER_DIR"
INSTANCE_CONTAINER_CONFIG_PATH="$INSTANCE_CONTAINER_CONFIG_PATH"
INSTANCE_CONTAINER_LOG_DIR="$INSTANCE_CONTAINER_LOG_DIR"
INSTANCE_CONTAINER_RUN_DIR="$INSTANCE_CONTAINER_RUN_DIR"
INSTANCE_CONTAINER_PROFILE_DIR="$INSTANCE_CONTAINER_PROFILE_DIR"
INSTANCE_CONTAINER_STATE_DIR="$INSTANCE_CONTAINER_STATE_DIR"
INSTANCE_CONTAINER_PID_FILE="$INSTANCE_CONTAINER_PID_FILE"
INSTANCE_LOG_DIR="$INSTANCE_LOG_DIR"
INSTANCE_RUN_DIR="$INSTANCE_RUN_DIR"
INSTANCE_PROFILE_DIR="$INSTANCE_PROFILE_DIR"
INSTANCE_STATE_DIR="$INSTANCE_STATE_DIR"
INSTANCE_CONFIG_PATH="$INSTANCE_CONFIG_PATH"
INSTANCE_PID_FILE="$INSTANCE_PID_FILE"
OPENCLAW_PROFILE="$INSTANCE_PROFILE"
OPENCLAW_STATE_DIR="$INSTANCE_STATE_DIR"
OPENCLAW_CONFIG_PATH="$INSTANCE_CONFIG_PATH"
EOF

shared_ops_log "created instance $INSTANCE_ID"
shared_ops_log "instance_dir=$INSTANCE_DIR"
shared_ops_log "port=$INSTANCE_PORT"
shared_ops_log "config=$INSTANCE_CONFIG_PATH"
