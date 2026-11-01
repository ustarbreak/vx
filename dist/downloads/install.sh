#!/bin/sh
# goinfra agent installer — InfraCentra (Linux, all distros)
# Usage: curl -fsSL https://app.infracentra.com/downloads/goinfra/install.sh | sudo sh -s -- --server https://app.infracentra.com --token icag_XXXX
set -eu

SERVER=""
TOKEN=""
VERSION="${GOINFRA_VERSION:-1.0.0}"
BASE_URL="${GOINFRA_BASE_URL:-https://app.infracentra.com/downloads/goinfra}"
BIN_DIR=/usr/local/bin
STATE_DIR=/var/lib/goinfra

for arg in "$@"; do
  case "$arg" in
    --server=*) SERVER="${arg#*=}" ;;
    --token=*)  TOKEN="${arg#*=}"  ;;
    --version=*) VERSION="${arg#*=}" ;;
    --base-url=*) BASE_URL="${arg#*=}" ;;
  esac
done
# also accept "--server <val>" style
prev=""
for arg in "$@"; do
  case "$prev" in
    --server) SERVER="$arg" ;;
    --token)  TOKEN="$arg"  ;;
    --version) VERSION="$arg" ;;
  esac
  prev="$arg"
done

if [ "$(id -u)" != "0" ]; then echo "goinfra install: must run as root (use sudo)" >&2; exit 1; fi
if [ -z "$TOKEN" ]; then echo "goinfra install: --token is required (Settings -> Agents -> New API token)" >&2; exit 1; fi
[ -n "$SERVER" ] || SERVER="https://app.infracentra.com"

OS=$(uname -s | tr 'A-Z' 'a-z')
case "$OS" in linux) ;; *) echo "unsupported OS: $OS" >&2; exit 1;; esac

ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  armv7l) ARCH=arm ;;
  i386|i686) ARCH=386 ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac

URL="$BASE_URL/$VERSION/linux/$ARCH/goinfra"
echo "[goinfra] downloading $URL"
TMP=$(mktemp)
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$TMP"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP" "$URL"
else
  echo "goinfra install: need curl or wget" >&2; exit 1
fi

install -m 0755 "$TMP" "$BIN_DIR/goinfra"
rm -f "$TMP"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

# Enroll first (writes token to $STATE_DIR/enrollment.json 0600 — never stays in shell history),
# then install the service unit pointing at that state dir.
"$BIN_DIR/goinfra" enroll --server "$SERVER" --token "$TOKEN" --state-dir "$STATE_DIR"
"$BIN_DIR/goinfra" install --state-dir "$STATE_DIR"

echo "[goinfra] ✔ installed & enrolled. Verify with: goinfra status"
