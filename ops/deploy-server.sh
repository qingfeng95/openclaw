#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/shared-console-deploy-common.sh"

usage() {
  cat <<'EOF'
Usage: deploy-server.sh [options]

Options:
  --repo-root <dir>   Deployment repo root (default: repo adjacent to ops/)
  --remote <name>     Git remote name used by deploy-pull.sh (default: origin)
  --ref <name>        Branch, tag, or commit to deploy (default: current branch)
  --target <name>     api | web | all (default: all)
  --skip-pull         Skip git fetch / checkout
  --skip-install      Skip dependency installation
  --skip-app-build    Skip main repo build
  --skip-web-build    Skip shared-console frontend build
  --skip-rollout      Skip service restart rollout
  --skip-check        Skip post-restart active checks in deploy-rollout.sh
  --allow-dirty       Forward to deploy-pull.sh
  -h, --help          Show this help
EOF
}

REPO_ROOT="$(shared_deploy_repo_root)"
REMOTE_NAME="origin"
REF_NAME=""
TARGET="all"
SKIP_PULL=0
SKIP_INSTALL=0
SKIP_APP_BUILD=0
SKIP_WEB_BUILD=0
SKIP_ROLLOUT=0
SKIP_CHECK=0
ALLOW_DIRTY=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --repo-root)
      shift
      [ "$#" -gt 0 ] || shared_deploy_fail "--repo-root requires a value"
      REPO_ROOT="$1"
      ;;
    --remote)
      shift
      [ "$#" -gt 0 ] || shared_deploy_fail "--remote requires a value"
      REMOTE_NAME="$1"
      ;;
    --ref)
      shift
      [ "$#" -gt 0 ] || shared_deploy_fail "--ref requires a value"
      REF_NAME="$1"
      ;;
    --target)
      shift
      [ "$#" -gt 0 ] || shared_deploy_fail "--target requires a value"
      TARGET="$1"
      ;;
    --skip-pull)
      SKIP_PULL=1
      ;;
    --skip-install)
      SKIP_INSTALL=1
      ;;
    --skip-app-build)
      SKIP_APP_BUILD=1
      ;;
    --skip-web-build)
      SKIP_WEB_BUILD=1
      ;;
    --skip-rollout)
      SKIP_ROLLOUT=1
      ;;
    --skip-check)
      SKIP_CHECK=1
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
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

shared_deploy_log "repo_root=$REPO_ROOT"

if [ "$SKIP_PULL" -ne 1 ]; then
  pull_args=(--repo-root "$REPO_ROOT" --remote "$REMOTE_NAME")
  if [ -n "$REF_NAME" ]; then
    pull_args+=(--ref "$REF_NAME")
  fi
  if [ "$ALLOW_DIRTY" -eq 1 ]; then
    pull_args+=(--allow-dirty)
  fi
  "$SCRIPT_DIR/deploy-pull.sh" "${pull_args[@]}"
fi

build_args=(--repo-root "$REPO_ROOT")
if [ "$SKIP_INSTALL" -eq 1 ]; then
  build_args+=(--skip-install)
fi
if [ "$SKIP_APP_BUILD" -eq 1 ]; then
  build_args+=(--skip-app-build)
fi
if [ "$SKIP_WEB_BUILD" -eq 1 ]; then
  build_args+=(--skip-web-build)
fi
"$SCRIPT_DIR/deploy-build.sh" "${build_args[@]}"

if [ "$SKIP_ROLLOUT" -ne 1 ]; then
  rollout_args=(--target "$TARGET")
  if [ "$SKIP_CHECK" -eq 1 ]; then
    rollout_args+=(--skip-check)
  fi
  "$SCRIPT_DIR/deploy-rollout.sh" "${rollout_args[@]}"
fi

shared_deploy_log "server deployment completed"
