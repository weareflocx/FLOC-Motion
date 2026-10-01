#!/bin/sh
set -eu

# Initialize the mounted data directory, then run the app without root privileges.
if [ "$(id -u)" = "0" ]; then
  data="${FLOC_DATA_DIR:-/app/.data}"
  mkdir -p "$data"
  chown node:node "$data"
  exec gosu node "$@"
fi
exec "$@"
