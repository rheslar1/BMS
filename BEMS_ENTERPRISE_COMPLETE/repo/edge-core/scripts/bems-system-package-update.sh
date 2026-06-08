#!/bin/sh
set -eu

SYSTEM_PACKAGES="${SWUPDATE_SYSTEM_PACKAGES:-${SYSTEM_PACKAGES:-}}"
PACKAGE_MANAGER="${SWUPDATE_PACKAGE_MANAGER:-${PACKAGE_MANAGER:-auto}}"

if [ -z "$SYSTEM_PACKAGES" ]; then
  echo "No system packages requested."
  exit 0
fi

RESOLVED_MANAGER="$PACKAGE_MANAGER"
if [ "$RESOLVED_MANAGER" = "auto" ]; then
  if command -v opkg >/dev/null 2>&1; then
    RESOLVED_MANAGER="opkg"
  elif command -v dnf >/dev/null 2>&1; then
    RESOLVED_MANAGER="dnf"
  elif command -v apt-get >/dev/null 2>&1; then
    RESOLVED_MANAGER="apt"
  else
    echo "No supported package manager found for: $SYSTEM_PACKAGES" >&2
    exit 69
  fi
fi

case "$RESOLVED_MANAGER" in
  opkg)
    opkg update
    opkg install $SYSTEM_PACKAGES
    ;;
  dnf)
    dnf -y makecache
    dnf -y install $SYSTEM_PACKAGES
    ;;
  apt)
    apt-get update
    apt-get install -y $SYSTEM_PACKAGES
    ;;
  *)
    echo "Unsupported package manager: $RESOLVED_MANAGER" >&2
    exit 69
    ;;
esac
