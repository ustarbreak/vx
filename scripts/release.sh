#!/usr/bin/env bash
# Build goinfra for every supported platform and publish it under the backend's
# static downloads mount:  https://app.infracentra.com/downloads/goinfra/...
#
# Usage:   ./scripts/release.sh [version]      (default: 1.0.0)
# Result:  backend/static/downloads/goinfra/<version>/<os>/<arch>/goinfra[.exe]
#          + install.sh / install.ps1 copied to .../goinfra/install.{sh,ps1}
# Then deploy the backend (the static dir ships with the image / volume).
set -eu

VERSION="${1:-1.0.0}"
cd "$(dirname "$0")/.."
OUT="backend/static/downloads/goinfra/$VERSION"
mkdir -p "$OUT"

echo "[release] building goinfra $VERSION"
( cd agent-go && \
  CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "../$OUT/linux/amd64/goinfra"   ./cmd/goinfra && \
  CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o "../$OUT/linux/arm64/goinfra"   ./cmd/goinfra && \
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "../$OUT/windows/amd64/goinfra.exe" ./cmd/goinfra )

# optional extras if you keep supporting them:
# CGO_ENABLED=0 GOOS=linux GOARCH=arm   go build ... $OUT/linux/arm/goinfra
# CGO_ENABLED=0 GOOS=windows GOARCH=386 go build ... $OUT/windows/386/goinfra.exe

cp scripts/downloads/install.sh  "backend/static/downloads/goinfra/install.sh"
cp scripts/downloads/install.ps1 "backend/static/downloads/goinfra/install.ps1"

echo "[release] checksums:"
( cd "$OUT" && find . -type f \( -name 'goinfra*' \) -exec sha256sum {} \; | tee SHA256SUMS.txt )
echo "[release] ✔ published to $OUT"
