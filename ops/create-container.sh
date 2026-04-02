#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/shared-instance-common.sh"

usage() {
  cat <<'EOF'
Usage: create-container.sh --name <container-name> [options]

Options:
  --name <name>                         Container name; may be specified multiple times
  --image <image>                       Docker image (default: node:22-bookworm-slim)
  --repo-root-host <dir>               Host repo root to mount (default: repo adjacent to ops/)
  --shared-instances-root-host <dir>   Host shared instances root to mount
  --dedicated-instances-root-host <dir> Host dedicated instances root to mount
  --repo-root-container <dir>          Repo path inside container
  --shared-instances-root-container <dir>
                                       Shared instances path inside container
  --dedicated-instances-root-container <dir>
                                       Dedicated instances path inside container
  --workdir <dir>                      Working directory inside container
  --command <cmd>                      Shell command run inside container
                                       (default: while true; do sleep 3600; done)
  --restart-policy <policy>            Docker restart policy (default: unless-stopped)
  --pull-missing                       Pull image if not present locally
  -h, --help                           Show this help
EOF
}

shared_ops_require_command docker

validate_container_name() {
  [[ "${1:-}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]
}

CONTAINER_NAMES=()
IMAGE_NAME="node:22-bookworm-slim"
HOST_REPO_ROOT="$(shared_ops_repo_root)"
HOST_SHARED_ROOT="$(shared_ops_default_instances_root)"
HOST_DEDICATED_ROOT="$(shared_ops_default_dedicated_instances_root)"
CONTAINER_REPO_ROOT="$(shared_ops_default_container_repo_root)"
CONTAINER_SHARED_ROOT="$(shared_ops_default_container_instances_root "$HOST_SHARED_ROOT")"
CONTAINER_DEDICATED_ROOT="$(shared_ops_default_container_instances_root "$HOST_DEDICATED_ROOT")"
WORKDIR_PATH=""
START_COMMAND="while true; do sleep 3600; done"
RESTART_POLICY="unless-stopped"
PULL_MISSING=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --name)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--name requires a value"
      CONTAINER_NAMES+=("$1")
      ;;
    --image)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--image requires a value"
      IMAGE_NAME="$1"
      ;;
    --repo-root-host)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--repo-root-host requires a value"
      HOST_REPO_ROOT="$1"
      ;;
    --shared-instances-root-host)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--shared-instances-root-host requires a value"
      HOST_SHARED_ROOT="$1"
      ;;
    --dedicated-instances-root-host)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--dedicated-instances-root-host requires a value"
      HOST_DEDICATED_ROOT="$1"
      ;;
    --repo-root-container)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--repo-root-container requires a value"
      CONTAINER_REPO_ROOT="$1"
      ;;
    --shared-instances-root-container)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--shared-instances-root-container requires a value"
      CONTAINER_SHARED_ROOT="$1"
      ;;
    --dedicated-instances-root-container)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--dedicated-instances-root-container requires a value"
      CONTAINER_DEDICATED_ROOT="$1"
      ;;
    --workdir)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--workdir requires a value"
      WORKDIR_PATH="$1"
      ;;
    --command)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--command requires a value"
      START_COMMAND="$1"
      ;;
    --restart-policy)
      shift
      [ "$#" -gt 0 ] || shared_ops_fail "--restart-policy requires a value"
      RESTART_POLICY="$1"
      ;;
    --pull-missing)
      PULL_MISSING=1
      ;;
    --*)
      shared_ops_fail "unknown option: $1"
      ;;
    *)
      shared_ops_fail "unexpected argument: $1"
      ;;
  esac
  shift
done

[ "${#CONTAINER_NAMES[@]}" -gt 0 ] || {
  usage
  exit 1
}

[ -d "$HOST_REPO_ROOT" ] || shared_ops_fail "host repo root not found: $HOST_REPO_ROOT"
[ -f "$HOST_REPO_ROOT/openclaw.mjs" ] || shared_ops_fail "openclaw.mjs not found under host repo root: $HOST_REPO_ROOT"
mkdir -p "$HOST_SHARED_ROOT" "$HOST_DEDICATED_ROOT"

if [ -z "$WORKDIR_PATH" ]; then
  WORKDIR_PATH="$CONTAINER_REPO_ROOT"
fi

case "$RESTART_POLICY" in
  no|always|unless-stopped|on-failure*)
    ;;
  *)
    shared_ops_fail "unsupported restart policy: $RESTART_POLICY"
    ;;
esac

for container_name in "${CONTAINER_NAMES[@]}"; do
  validate_container_name "$container_name" || shared_ops_fail "invalid container name: $container_name"
done

if [ "$PULL_MISSING" -eq 1 ] && ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  shared_ops_log "pulling image $IMAGE_NAME"
  docker pull "$IMAGE_NAME" >/dev/null
fi

docker image inspect "$IMAGE_NAME" >/dev/null 2>&1 || shared_ops_fail "docker image not found locally: $IMAGE_NAME"

for container_name in "${CONTAINER_NAMES[@]}"; do
  if docker ps -a --format '{{.Names}}' | grep -Fx "$container_name" >/dev/null 2>&1; then
    shared_ops_fail "container already exists: $container_name"
  fi

  shared_ops_log "creating container $container_name with image=$IMAGE_NAME"
  container_id="$(
    docker run -d \
      --name "$container_name" \
      --restart "$RESTART_POLICY" \
      --label "ai.openclaw.shared-console=managed" \
      --label "ai.openclaw.shared-console.role=worker" \
      --label "ai.openclaw.shared-console.repo-root=$CONTAINER_REPO_ROOT" \
      --label "ai.openclaw.shared-console.shared-root=$CONTAINER_SHARED_ROOT" \
      --label "ai.openclaw.shared-console.dedicated-root=$CONTAINER_DEDICATED_ROOT" \
      --mount "type=bind,src=$HOST_REPO_ROOT,dst=$CONTAINER_REPO_ROOT" \
      --mount "type=bind,src=$HOST_SHARED_ROOT,dst=$CONTAINER_SHARED_ROOT" \
      --mount "type=bind,src=$HOST_DEDICATED_ROOT,dst=$CONTAINER_DEDICATED_ROOT" \
      -w "$WORKDIR_PATH" \
      "$IMAGE_NAME" \
      sh -lc "$START_COMMAND"
  )"
  shared_ops_log "created container name=$container_name id=$container_id"
done
