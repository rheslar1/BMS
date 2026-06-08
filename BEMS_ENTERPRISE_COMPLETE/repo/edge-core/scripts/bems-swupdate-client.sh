#!/bin/sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "Usage: bems-swupdate-client <swu-url-or-file>" >&2
  exit 64
fi

SOURCE="$1"
SOFTWARE_SET="${SWUPDATE_SOFTWARE_SET:-stable}"
SOFTWARE_MODE="${SWUPDATE_MODE:-copy-2}"
PUBLIC_KEY="${SWUPDATE_PUBLIC_KEY:-/etc/swupdate/swupdate-public.pem}"
DOWNLOAD_DIR="${SWUPDATE_DOWNLOAD_DIR:-/var/lib/bems/swupdate}"
EXPECTED_SHA256="${SWUPDATE_EXPECTED_SHA256:-}"
SYSTEM_PACKAGES="${SWUPDATE_SYSTEM_PACKAGES:-}"
PACKAGE_MANAGER="${SWUPDATE_PACKAGE_MANAGER:-auto}"

mkdir -p "$DOWNLOAD_DIR"

case "$SOURCE" in
  http://*|https://*)
    SWU_FILE="$DOWNLOAD_DIR/$(basename "$SOURCE")"
    curl -fsSL "$SOURCE" -o "$SWU_FILE"
    ;;
  *)
    SWU_FILE="$SOURCE"
    ;;
esac

if [ ! -f "$SWU_FILE" ]; then
  echo "SWUpdate image not found: $SWU_FILE" >&2
  exit 66
fi

if [ -n "$EXPECTED_SHA256" ]; then
  printf '%s  %s\n' "$EXPECTED_SHA256" "$SWU_FILE" | sha256sum -c -
fi

KEY_ARGS=""
if [ -f "$PUBLIC_KEY" ]; then
  KEY_ARGS="-k $PUBLIC_KEY"
fi

if command -v swupdate-progress >/dev/null 2>&1; then
  swupdate-progress -w &
  PROGRESS_PID="$!"
else
  PROGRESS_PID=""
fi

swupdate -i "$SWU_FILE" -e "$SOFTWARE_SET,$SOFTWARE_MODE" $KEY_ARGS

if [ -n "$PROGRESS_PID" ]; then
  wait "$PROGRESS_PID" || true
fi

if [ -n "$SYSTEM_PACKAGES" ]; then
  export SWUPDATE_SYSTEM_PACKAGES="$SYSTEM_PACKAGES"
  export SWUPDATE_PACKAGE_MANAGER="$PACKAGE_MANAGER"
  if [ -x /usr/lib/swupdate/bems-system-package-update.sh ]; then
    /usr/lib/swupdate/bems-system-package-update.sh
  else
    "$(dirname "$0")/bems-system-package-update.sh"
  fi
fi
