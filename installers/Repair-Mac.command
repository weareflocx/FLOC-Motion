#!/bin/bash
set -euo pipefail
RENDERER_DIR="$HOME/Library/Application Support/FLOC Motion/Renderer"
export PATH="$RENDERER_DIR/runtime/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ ! -x "$RENDERER_DIR/runtime/bin/node" || ! -f "$RENDERER_DIR/.data/render-worker/config.json" ]]; then
  echo "Install and connect FLOC Motion Renderer on this Mac first."
  read -r -p "Press Enter to close."
  exit 1
fi
cd "$RENDERER_DIR"
unset HYPERFRAMES_BROWSER_PATH PRODUCER_HEADLESS_SHELL_PATH
export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1
echo "Preparing the dedicated rendering browser…"
runtime/bin/node node_modules/hyperframes/bin/hyperframes.mjs browser ensure
runtime/bin/node --input-type=module <<'NODE'
import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const browserPath = execFileSync(process.execPath, ['node_modules/hyperframes/bin/hyperframes.mjs', 'browser', 'path'], { encoding: 'utf8' }).trim();
execFileSync(browserPath, ['--version'], { timeout: 5000, stdio: 'pipe' });
const filename = '.data/render-worker/config.json';
const config = JSON.parse(await readFile(filename, 'utf8'));
await writeFile(`${filename}.tmp`, JSON.stringify({ ...config, browserPath }), { mode: 0o600 });
await rename(`${filename}.tmp`, filename);
NODE
runtime/bin/node scripts/renderer-autostart.mjs --stop
runtime/bin/node scripts/renderer-autostart.mjs
echo "Renderer restarted. Return to FLOC Motion and wait for Ready, then choose Render MP4."
read -r -p "Press Enter to close."
