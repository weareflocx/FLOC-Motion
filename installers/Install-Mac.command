#!/bin/bash
set -euo pipefail
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
RENDERER_DIR="$HOME/Library/Application Support/FLOC Motion/Renderer"
NODE_VERSION="v22.23.3"
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
if [[ -x "$RENDERER_DIR/runtime/bin/node" && -f "$RENDERER_DIR/scripts/renderer-autostart.mjs" ]]; then
  "$RENDERER_DIR/runtime/bin/node" "$RENDERER_DIR/scripts/renderer-autostart.mjs" --stop
fi
for item in src server scripts public package.json package-lock.json; do
  rm -rf -- "$RENDERER_DIR/$item"
  cp -R "$SOURCE_DIR/$item" "$RENDERER_DIR/$item"
done
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
mkdir -p "$RENDERER_DIR/runtime"
tar -xzf "$DOWNLOAD_DIR/$ARCHIVE" -C "$RENDERER_DIR/runtime" --strip-components=1
export PATH="$RENDERER_DIR/runtime/bin:$PATH"
cd "$RENDERER_DIR"
npm ci --omit=dev --no-audit --no-fund
node scripts/renderer-setup.mjs "$@"
echo "Ready. Return to FLOC Motion and choose Render MP4."
if [[ -t 0 ]]; then read -r -p "Press Enter to close."; fi
