#!/bin/bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
RENDERER_DIR="$HOME/Library/Application Support/FLOC Motion/Renderer"
NODE_VERSION="v24.21.0"
case "$(uname -m)" in arm64) NODE_ARCH="arm64" ;; x86_64) NODE_ARCH="x64" ;; *) echo "This Mac architecture is not supported."; exit 1 ;; esac
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  if ! command -v brew >/dev/null; then
    echo "Install Homebrew from https://brew.sh, then open this installer again."
    read -r -p "Press Enter to close."; exit 1
  fi
  brew install ffmpeg
fi
mkdir -p "$RENDERER_DIR"
# Stops the renderer of either layout: both register this LaunchAgent.
launchctl bootout "gui/$(id -u)/dev.floc.motion.personal-renderer" 2>/dev/null || true
cp "$SOURCE_DIR/Start-Mac.command" "$RENDERER_DIR/Start-Mac.command"
cp "$SOURCE_DIR/Stop-Mac.command" "$RENDERER_DIR/Stop-Mac.command"
cp "$SOURCE_DIR/Uninstall-Mac.command" "$RENDERER_DIR/Uninstall-Mac.command"
chmod +x "$RENDERER_DIR/"*.command
DOWNLOAD_DIR="$(mktemp -d)"
trap 'rm -rf -- "$DOWNLOAD_DIR"' EXIT
ARCHIVE="node-$NODE_VERSION-darwin-$NODE_ARCH.tar.gz"
curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/$NODE_VERSION/$ARCHIVE" -o "$DOWNLOAD_DIR/$ARCHIVE"
curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$DOWNLOAD_DIR/SHASUMS256.txt"
EXPECTED="$(awk -v name="$ARCHIVE" '$2 == name {print $1}' "$DOWNLOAD_DIR/SHASUMS256.txt")"
ACTUAL="$(shasum -a 256 "$DOWNLOAD_DIR/$ARCHIVE" | awk '{print $1}')"
if [[ -z "$EXPECTED" || "$EXPECTED" != "$ACTUAL" ]]; then echo "Runtime download verification failed."; exit 1; fi
tar -xzf "$DOWNLOAD_DIR/$ARCHIVE" -C "$DOWNLOAD_DIR"
rm -rf -- "$RENDERER_DIR/runtime"
mv "$DOWNLOAD_DIR/node-$NODE_VERSION-darwin-$NODE_ARCH" "$RENDERER_DIR/runtime"
export PATH="$RENDERER_DIR/runtime/bin:$PATH"
cd "$RENDERER_DIR"
# Installs this package's engine into engines/<version> with shared dependencies, the
# launcher and current.json, then removes the previous single-folder layout (.data stays).
"$RENDERER_DIR/runtime/bin/node" "$SOURCE_DIR/scripts/renderer-update.mjs" --install-local "$SOURCE_DIR" --home "$RENDERER_DIR"
"$RENDERER_DIR/runtime/bin/node" "$RENDERER_DIR/launcher.mjs" setup "$@"
echo "Ready. Return to FLOC Motion and choose Render MP4."
if [[ -t 0 ]]; then read -r -p "Press Enter to close."; fi
