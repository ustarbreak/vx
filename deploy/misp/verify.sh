#!/usr/bin/env bash
# T3.3 verify — MISP up and queryable with an API key.
set -euo pipefail
[ -n "${MISP_API_KEY:-}" ] || { echo "export MISP_API_KEY from the MISP UI (site admin > User List > your key) first"; exit 2; }
curl -s --max-time 5 http://localhost:8081/users/login >/dev/null || { echo "FAIL: MISP :8081 unreachable"; exit 1; }
N=$(curl -s -H "Authorization: $MISP_API_KEY" -H "Accept: application/json" \
  "http://localhost:8081/servers/getVersion" | head -c 200)
echo "$N" | grep -qiE 'version' && echo "PASS: MISP reachable ($N)" || { echo "FAIL: unexpected response"; exit 1; }
echo "First-success: create one test IoC event in the UI, then check /api/services/threat-intel/status (live)."
