#!/usr/bin/env bash
# Build the debug app and install it on the dev phone attached to the lenovo server.
# Usage: scripts/phone-deploy.sh [--no-build]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${PHONE_HOST:-lenovo}"
# The SDK's adb, not /usr/bin/adb: two adb versions fight over the server daemon.
ADB='~/Android/Sdk/platform-tools/adb'
PKG=com.zandaulion.omaha
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
REMOTE_APK=/tmp/omaha-debug.apk

ssh "$HOST" "$ADB get-state" >/dev/null || { echo "no phone attached to $HOST" >&2; exit 1; }

if [[ "${1:-}" != "--no-build" ]]; then
  (cd "$ROOT/android" && ./gradlew :app:assembleDebug --console=plain -q)
fi

scp -q "$APK" "$HOST:$REMOTE_APK"
ssh "$HOST" "$ADB install -r $REMOTE_APK && rm -f $REMOTE_APK \
  && $ADB shell am force-stop $PKG \
  && $ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1"
echo "deployed $PKG debug -> phone on $HOST"
