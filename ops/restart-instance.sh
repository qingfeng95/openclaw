#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/stop-instance.sh" "$@" --force
"$SCRIPT_DIR/start-instance.sh" "$@"
