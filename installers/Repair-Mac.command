#!/bin/bash
set -euo pipefail
RENDERER_DIR="$HOME/Library/Application Support/FLOC Motion/Renderer"
export PATH="$RENDERER_DIR/runtime/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ ! -x "$RENDERER_DIR/runtime/bin/node" || ! -f "$RENDERER_DIR/.data/render-worker/config.json" ]]; then
  echo "Install and connect FLOC Motion Renderer on this Mac first."
  read -r -p "Press Enter to close."
  exit 1
fi
if [[ ! -f "$RENDERER_DIR/launcher.mjs" || ! -f "$RENDERER_DIR/current.json" ]]; then
  echo "Open Install-Mac.command from this package once to update the renderer. It keeps your connection."
  read -r -p "Press Enter to close."
  exit 1
fi
cd "$RENDERER_DIR"
unset HYPERFRAMES_BROWSER_PATH PRODUCER_HEADLESS_SHELL_PATH
export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1
runtime/bin/node launcher.mjs stop
# Setup prepares the dedicated rendering browser, checks graphics, keeps the existing
# connection and starts the renderer again.
echo "Preparing the dedicated rendering browser…"
runtime/bin/node launcher.mjs setup
echo "Renderer restarted. Return to FLOC Motion and wait for Ready, then choose Render MP4."
read -r -p "Press Enter to close."
