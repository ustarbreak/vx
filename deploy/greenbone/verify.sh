#!/usr/bin/env bash
# deploy/greenbone/verify.sh — T6.0 read-only first-success check (Greenbone, Phase 6).
set -euo pipefail
echo ">> Greenbone stack containers:"
docker compose -f deploy/docker-compose.greenbone.yml ps || true
echo ">> gvmd/openvasd reachability (from scanner container):"
docker exec gvmd-supervisor bash -c 'echo ok' 2>/dev/null \
  || docker ps --format '{{.Names}}' | grep -i greenbone || true
echo ">> Web UI (run from host, expect HTTP response on :9392):"
curl -sk -m 5 -o /dev/null -w 'gsa http_code=%{http_code}\n' https://127.0.0.1:9392/ || echo "GSA not reachable yet (first boot sync can take minutes)"
echo "NOTE: default credentials must be changed on first login — see docs/guides/CONNECTOR-INSTALL.md TODO_VERIFY."
