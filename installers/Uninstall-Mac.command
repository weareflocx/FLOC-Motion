#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
"$ROOT/runtime/bin/node" "$ROOT/scripts/renderer-autostart.mjs" --uninstall
