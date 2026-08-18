#!/usr/bin/env bash
# Deploy Pocket Omaha static PWA files to /var/www/omaha
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${DEST:-/var/www/omaha}"

sudo mkdir -p "$DEST"
sudo chown "$(id -un):$(id -gn)" "$DEST"
rsync -a --delete "$ROOT/web/" "$DEST/"

sudo restorecon -R "$DEST" 2>/dev/null || true
echo "deployed Pocket Omaha PWA -> ${DEST}"
