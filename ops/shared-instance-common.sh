#!/usr/bin/env bash

shared_ops_script_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

shared_ops_repo_root() {
  cd "$(shared_ops_script_dir)/.." && pwd
}

shared_ops_default_instances_root() {
  if [ -n "${OPENCLAW_SHARED_INSTANCES_ROOT:-}" ]; then
    printf '%s\n' "$OPENCLAW_SHARED_INSTANCES_ROOT"
    return
  fi
  printf '%s\n' "$(shared_ops_repo_root)/.shared-instances"
}

shared_ops_default_dedicated_instances_root() {
  if [ -n "${OPENCLAW_DEDICATED_INSTANCES_ROOT:-}" ]; then
    printf '%s\n' "$OPENCLAW_DEDICATED_INSTANCES_ROOT"
    return
  fi
  printf '%s\n' "$(shared_ops_repo_root)/.dedicated-instances"
}

shared_ops_default_container_repo_root() {
  if [ -n "${OPENCLAW_CONTAINER_REPO_ROOT:-}" ]; then
    printf '%s\n' "$OPENCLAW_CONTAINER_REPO_ROOT"
    return
  fi
  printf '%s\n' "/opt/shared-console/repo"
}

shared_ops_instances_root_kind() {
  local root="${1:-}"
  case "$root" in
    *dedicated*)
      printf '%s\n' "dedicated"
      ;;
    *)
      printf '%s\n' "shared"
      ;;
  esac
}

shared_ops_default_container_instances_root() {
  local host_root="${1:-}"

  if [ -n "${OPENCLAW_CONTAINER_INSTANCES_ROOT:-}" ]; then
    printf '%s\n' "$OPENCLAW_CONTAINER_INSTANCES_ROOT"
    return
  fi

  case "$(shared_ops_instances_root_kind "$host_root")" in
    dedicated)
      if [ -n "${OPENCLAW_CONTAINER_DEDICATED_INSTANCES_ROOT:-}" ]; then
        printf '%s\n' "$OPENCLAW_CONTAINER_DEDICATED_INSTANCES_ROOT"
        return
      fi
      printf '%s\n' "/opt/dedicated-instances"
      ;;
    *)
      if [ -n "${OPENCLAW_CONTAINER_SHARED_INSTANCES_ROOT:-}" ]; then
        printf '%s\n' "$OPENCLAW_CONTAINER_SHARED_INSTANCES_ROOT"
        return
      fi
      printf '%s\n' "/opt/shared-instances"
      ;;
  esac
}

shared_ops_log() {
  printf '[shared-instance] %s\n' "$*"
}

shared_ops_warn() {
  printf '[shared-instance] WARN: %s\n' "$*" >&2
}

shared_ops_fail() {
  printf '[shared-instance] ERROR: %s\n' "$*" >&2
  exit 1
}

shared_ops_require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || shared_ops_fail "required command not found: $command_name"
}

shared_ops_is_integer() {
  [[ "${1:-}" =~ ^[0-9]+$ ]]
}

shared_ops_validate_port() {
  local port="$1"
  shared_ops_is_integer "$port" || return 1
  [ "$port" -ge 1 ] && [ "$port" -le 65535 ]
}

shared_ops_validate_instance_id() {
  [[ "${1:-}" =~ ^[A-Za-z0-9._-]+$ ]]
}

shared_ops_resolve_instance_dir() {
  local root="$1"
  local selector="$2"

  if [ -d "$selector" ] && [ -f "$selector/instance.env" ]; then
    cd "$selector" && pwd
    return
  fi

  printf '%s\n' "$root/$selector"
}

shared_ops_load_instance_env() {
  local instance_dir="$1"
  local env_file="$instance_dir/instance.env"

  [ -f "$env_file" ] || shared_ops_fail "instance env not found: $env_file"

  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a

  : "${INSTANCE_ID:?missing INSTANCE_ID in instance.env}"
  : "${INSTANCE_NAME:?missing INSTANCE_NAME in instance.env}"
  : "${INSTANCE_DIR:?missing INSTANCE_DIR in instance.env}"
  : "${INSTANCE_PORT:?missing INSTANCE_PORT in instance.env}"
  : "${INSTANCE_BIND:?missing INSTANCE_BIND in instance.env}"
  : "${OPENCLAW_STATE_DIR:?missing OPENCLAW_STATE_DIR in instance.env}"
  : "${OPENCLAW_CONFIG_PATH:?missing OPENCLAW_CONFIG_PATH in instance.env}"
  : "${INSTANCE_LOG_DIR:?missing INSTANCE_LOG_DIR in instance.env}"
  : "${INSTANCE_RUN_DIR:?missing INSTANCE_RUN_DIR in instance.env}"
  : "${INSTANCE_PID_FILE:?missing INSTANCE_PID_FILE in instance.env}"
}

shared_ops_container_selector() {
  if [ -n "${INSTANCE_CONTAINER_NAME:-}" ]; then
    printf '%s\n' "$INSTANCE_CONTAINER_NAME"
    return
  fi
  if [ -n "${INSTANCE_CONTAINER_ID:-}" ]; then
    printf '%s\n' "$INSTANCE_CONTAINER_ID"
    return
  fi
  shared_ops_fail "instance $INSTANCE_ID is missing INSTANCE_CONTAINER_NAME / INSTANCE_CONTAINER_ID"
}

shared_ops_docker_exec() {
  local selector="$1"
  shift
  docker exec "$selector" "$@"
}

shared_ops_container_pid_is_running() {
  local selector="$1"
  local pid="${2:-}"
  [ -n "$pid" ] || return 1
  shared_ops_docker_exec "$selector" sh -lc 'kill -0 "$1" 2>/dev/null' sh "$pid" >/dev/null 2>&1
}

shared_ops_container_http_ok() {
  local selector="$1"
  local url="$2"
  local timeout_seconds="${3:-3}"
  local timeout_ms=$((timeout_seconds * 1000))

  shared_ops_docker_exec "$selector" node -e "const http = require('node:http'); const url = process.argv[1]; const timeoutMs = Number(process.argv[2]); let done = false; const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); process.exit(ok ? 0 : 1); }; const req = http.get(url, (res) => { res.resume(); finish(res.statusCode === 200); }); req.on('error', () => finish(false)); const timer = setTimeout(() => { req.destroy(); finish(false); }, timeoutMs); timer.unref?.();" "$url" "$timeout_ms" >/dev/null 2>&1
}

shared_ops_pid_is_running() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

shared_ops_port_is_available() {
  local port="$1"
  node -e "const net = require('node:net'); const port = Number(process.argv[1]); const server = net.createServer(); server.once('error', () => process.exit(1)); server.once('listening', () => server.close(() => process.exit(0))); server.listen(port, '127.0.0.1');" "$port" >/dev/null 2>&1
}

shared_ops_reserved_ports_from_root() {
  local root="${1:-}"

  [ -n "$root" ] || return 0
  [ -d "$root" ] || return 0

  find "$root" -mindepth 2 -maxdepth 2 -type f -name instance.env -print 2>/dev/null |
    while IFS= read -r env_file; do
      awk -F= '
        $1 == "INSTANCE_PORT" {
          value = $2
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
          gsub(/^"/, "", value)
          gsub(/"$/, "", value)
          if (value ~ /^[0-9]+$/) {
            print value
          }
        }
      ' "$env_file"
    done
}

shared_ops_port_search_roots() {
  local current_root="${1:-}"

  printf '%s\n' "$current_root"
  printf '%s\n' "$(shared_ops_default_instances_root)"
  printf '%s\n' "$(shared_ops_default_dedicated_instances_root)"
}

shared_ops_port_is_reserved() {
  local port="$1"
  shift || true
  local root
  local reserved_port

  for root in "$@"; do
    [ -n "$root" ] || continue
    while IFS= read -r reserved_port; do
      [ -n "$reserved_port" ] || continue
      if [ "$reserved_port" = "$port" ]; then
        return 0
      fi
    done < <(shared_ops_reserved_ports_from_root "$root")
  done

  return 1
}

shared_ops_port_is_assignable() {
  local port="$1"
  shift || true

  shared_ops_port_is_available "$port" || return 1
  shared_ops_port_is_reserved "$port" "$@" && return 1
  return 0
}

shared_ops_find_available_port() {
  local start_port="$1"
  local attempts="${2:-200}"
  shift 2 || true
  local port="$start_port"
  local remaining="$attempts"

  while [ "$remaining" -gt 0 ]; do
    if shared_ops_port_is_assignable "$port" "$@"; then
      printf '%s\n' "$port"
      return 0
    fi
    port=$((port + 1))
    remaining=$((remaining - 1))
  done

  return 1
}

shared_ops_entrypoint() {
  printf '%s\n' "$(shared_ops_repo_root)/openclaw.mjs"
}

shared_ops_gateway_health_url() {
  local port="$1"
  printf 'http://127.0.0.1:%s/healthz\n' "$port"
}

shared_ops_gateway_ready_url() {
  local port="$1"
  printf 'http://127.0.0.1:%s/readyz\n' "$port"
}

shared_ops_gateway_version_url() {
  local port="$1"
  printf 'http://127.0.0.1:%s/version\n' "$port"
}

shared_ops_gateway_usage_summary_url() {
  local port="$1"
  printf 'http://127.0.0.1:%s/shared/usage/summary\n' "$port"
}

shared_ops_curl_json() {
  local url="$1"
  local timeout_seconds="${2:-3}"
  curl -fsS --max-time "$timeout_seconds" "$url"
}

shared_ops_payload_is_html() {
  local payload="${1:-}"
  local trimmed="${payload#"${payload%%[![:space:]]*}"}"
  [[ "$trimmed" == \<* ]]
}

shared_ops_local_version() {
  local repo_root
  repo_root="$(shared_ops_repo_root)"
  node -e "const fs = require('node:fs'); const path = require('node:path'); const pkg = JSON.parse(fs.readFileSync(path.join(process.argv[1], 'package.json'), 'utf8')); if (typeof pkg.version !== 'string' || !pkg.version.trim()) { process.exit(1); } process.stdout.write(pkg.version);" "$repo_root"
}

shared_ops_usage_summary_json() {
  local usage_log_path="$1"
  node -e "const fs = require('node:fs'); const filePath = process.argv[1]; if (!fs.existsSync(filePath)) { process.stdout.write(JSON.stringify({ totalCount: 0, filePath, note: 'No shared tool usage log found.' })); process.exit(0); } const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/); let totalCount = 0; for (const line of lines) { const trimmed = line.trim(); if (!trimmed) { continue; } JSON.parse(trimmed); totalCount += 1; } process.stdout.write(JSON.stringify({ totalCount, filePath }));" "$usage_log_path"
}
