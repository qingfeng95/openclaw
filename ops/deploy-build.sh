#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/shared-console-deploy-common.sh"

usage() {
  cat <<'EOF'
Usage: deploy-build.sh [options]

Options:
  --repo-root <dir>   Deployment repo root (default: repo adjacent to ops/)
  --skip-install      Skip dependency installation
  --skip-app-build    Skip main repo build
  --skip-web-build    Skip shared-console frontend build
  -h, --help          Show this help

Environment overrides:
  SHARED_CONSOLE_DEPLOY_INSTALL_CMD
  SHARED_CONSOLE_DEPLOY_BUILD_CMD
  SHARED_CONSOLE_DEPLOY_WEB_BUILD_CMD
EOF
}

shared_deploy_require_command bash
shared_deploy_require_command node
if ! command -v pnpm >/dev/null 2>&1 && ! command -v corepack >/dev/null 2>&1; then
  shared_deploy_fail "pnpm or corepack is required"
fi

REPO_ROOT="$(shared_deploy_repo_root)"
SKIP_INSTALL=0
SKIP_APP_BUILD=0
SKIP_WEB_BUILD=0

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
    --skip-install)
      SKIP_INSTALL=1
      ;;
    --skip-app-build)
      SKIP_APP_BUILD=1
      ;;
    --skip-web-build)
      SKIP_WEB_BUILD=1
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

shared_deploy_assert_repo "$REPO_ROOT"

PNPM_CMD="${SHARED_CONSOLE_DEPLOY_PNPM_CMD:-$(shared_deploy_pnpm_cmd)}"
INSTALL_CMD="${SHARED_CONSOLE_DEPLOY_INSTALL_CMD:-$PNPM_CMD install --frozen-lockfile}"
APP_BUILD_CMD="${SHARED_CONSOLE_DEPLOY_BUILD_CMD:-$PNPM_CMD build}"
WEB_BUILD_CMD="${SHARED_CONSOLE_DEPLOY_WEB_BUILD_CMD:-$PNPM_CMD shared-console:build}"

shared_deploy_log "repo_root=$REPO_ROOT"
shared_deploy_log "pnpm_cmd=$PNPM_CMD"

if [ "$SKIP_INSTALL" -ne 1 ]; then
  shared_deploy_run_in_repo "$REPO_ROOT" "$INSTALL_CMD"
fi

if [ "$SKIP_APP_BUILD" -ne 1 ]; then
  shared_deploy_run_in_repo "$REPO_ROOT" "$APP_BUILD_CMD"
fi

if [ "$SKIP_WEB_BUILD" -ne 1 ]; then
  shared_deploy_run_in_repo "$REPO_ROOT" "$WEB_BUILD_CMD"
fi

shared_deploy_log "build completed for commit $(shared_deploy_current_ref "$REPO_ROOT")"
