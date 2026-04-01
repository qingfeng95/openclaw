#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/shared-console-deploy-common.sh"

usage() {
  cat <<'EOF'
Usage: deploy-pull.sh [options]

Options:
  --repo-root <dir>  Deployment repo root (default: repo adjacent to ops/)
  --remote <name>    Git remote name (default: origin)
  --ref <name>       Branch, tag, or commit to deploy (default: current branch)
  --allow-dirty      Skip clean-worktree guard
  -h, --help         Show this help
EOF
}

shared_deploy_require_command git

REPO_ROOT="$(shared_deploy_repo_root)"
REMOTE_NAME="origin"
REF_NAME=""
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

shared_deploy_assert_repo "$REPO_ROOT"
if [ "$ALLOW_DIRTY" -ne 1 ]; then
  shared_deploy_assert_clean_worktree "$REPO_ROOT"
fi

if [ -z "$REF_NAME" ]; then
  REF_NAME="$(git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  [ -n "$REF_NAME" ] || shared_deploy_fail "--ref is required when the repo is in detached HEAD state"
fi

shared_deploy_log "fetching remote=$REMOTE_NAME ref=$REF_NAME"
git -C "$REPO_ROOT" fetch "$REMOTE_NAME" --tags

if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/remotes/$REMOTE_NAME/$REF_NAME"; then
  if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$REF_NAME"; then
    git -C "$REPO_ROOT" checkout "$REF_NAME"
  else
    git -C "$REPO_ROOT" checkout -b "$REF_NAME" "$REMOTE_NAME/$REF_NAME"
  fi
  git -C "$REPO_ROOT" merge --ff-only "$REMOTE_NAME/$REF_NAME"
else
  git -C "$REPO_ROOT" fetch "$REMOTE_NAME" "$REF_NAME" --tags
  git -C "$REPO_ROOT" checkout --detach FETCH_HEAD
fi

CURRENT_COMMIT="$(shared_deploy_current_ref "$REPO_ROOT")"
CURRENT_BRANCH="$(git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || printf 'DETACHED')"

shared_deploy_log "repo_root=$REPO_ROOT"
shared_deploy_log "branch=$CURRENT_BRANCH"
shared_deploy_log "commit=$CURRENT_COMMIT"
