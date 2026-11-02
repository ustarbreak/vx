#!/usr/bin/env bash
# deploy/install.sh — manual entry point for the connector stack (T3.1).
# Thin wrapper over docker compose; runs preflight first; NEVER auto-runs.
# Usage:
#   bash deploy/install.sh --profile mvp        # Wazuh + MISP + DFIR-IRIS (decision #8)
#   bash deploy/install.sh --service wazuh      # one engine (wazuh|misp|iris)
#   bash deploy/install.sh --service misp --down
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="docker-compose.connectors.yml"
ENVF=".env.connector"
PROFILE=""
DOWN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2;;
    --service) PROFILE="$2"; shift 2;;
    --down) DOWN=1; shift;;
    *) echo "unknown arg: $1 (see header usage)"; exit 2;;
  esac
done

case "$PROFILE" in mvp|wazuh|misp|iris) ;; 
  greenbone) echo "Greenbone is a SEPARATE Phase-6 stack (decision #8). Run:"; \
             echo "  docker compose -f deploy/docker-compose.greenbone.yml up -d"; \
             echo "  bash deploy/greenbone/verify.sh"; exit 0;;
  *) echo "ERROR: --profile/--service must be mvp|wazuh|misp|iris (Greenbone is Phase 6, decision #8)"; exit 2;; esac

[ -f "$ENVF" ] || { echo "ERROR: $ENVF missing — cp .env.connector.example $ENVF, chmod 600, fill secrets (guide step 2)"; exit 1; }

if [ "$DOWN" = 1 ]; then
  echo ">> Tearing down profile '$PROFILE' (volumes kept; add -v manually to destroy data)"
  docker compose -f "$COMPOSE" --env-file "$ENVF" --profile "$PROFILE" down
  exit 0
fi

echo ">> Preflight (fix every FAIL before continuing):"
bash preflight.sh

echo ">> Starting profile '$PROFILE':"
docker compose -f "$COMPOSE" --env-file "$ENVF" --profile "$PROFILE" up -d
echo ">> Done. Follow docs/guides/CONNECTOR-INSTALL.md steps 3-4 to verify and wire each engine."
