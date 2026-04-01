#!/usr/bin/env bash

shared_deploy_script_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

shared_deploy_repo_root() {
  if [ -n "${SHARED_CONSOLE_DEPLOY_REPO_ROOT:-}" ]; then
    printf '%s\n' "$SHARED_CONSOLE_DEPLOY_REPO_ROOT"
    return
  fi
  cd "$(shared_deploy_script_dir)/.." && pwd
}

shared_deploy_log() {
  printf '[shared-deploy] %s\n' "$*"
}

shared_deploy_warn() {
  printf '[shared-deploy] WARN: %s\n' "$*" >&2
}

shared_deploy_fail() {
  printf '[shared-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

shared_deploy_require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || shared_deploy_fail "required command not found: $command_name"
}

shared_deploy_pnpm_cmd() {
  if command -v pnpm >/dev/null 2>&1; then
    printf '%s\n' "pnpm"
    return
  fi
  if command -v corepack >/dev/null 2>&1; then
    printf '%s\n' "corepack pnpm"
    return
  fi
  shared_deploy_fail "pnpm is not available and corepack is not installed"
}

shared_deploy_assert_repo() {
  local repo_root="$1"
  [ -d "$repo_root/.git" ] || shared_deploy_fail "not a git repository: $repo_root"
}

shared_deploy_assert_clean_worktree() {
  local repo_root="$1"
  local status
  status="$(git -C "$repo_root" status --short)"
  [ -z "$status" ] || shared_deploy_fail "working tree is not clean: $repo_root"
}

shared_deploy_run_in_repo() {
  local repo_root="$1"
  local command_text="$2"
  shared_deploy_log "running: $command_text"
  (
    cd "$repo_root"
    bash -lc "$command_text"
  )
}

shared_deploy_current_ref() {
  local repo_root="$1"
  git -C "$repo_root" rev-parse --short HEAD
}
