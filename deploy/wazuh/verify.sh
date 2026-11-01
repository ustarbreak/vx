#!/usr/bin/env bash
# T3.2 verify — safe read-only checks after `install.sh --service wazuh`.
# Requires WAZUH_API_USER/WAZUH_API_PASS exported or in deploy/.env.connector.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.connector ] && set -a && . ./.env.connector && set +a
pass(){ echo "PASS: $1"; }
fail(){ echo "FAIL: $1 -> see docs/guides/CONNECTOR-INSTALL.md step 3"; exit 1; }

curl -sk --max-time 5 "https://localhost:55000/" >/dev/null 2>&1 \
  || fail "wazuh API :55000 unreachable (container infracentra-wazuh-manager healthy? wait 2-3 min)"
TOKEN=$(curl -sk -u "${WAZUH_API_USER:-wazuh}:${WAZUH_API_PASS:?export WAZUH_API_PASS}" \
  -X POST "https://localhost:55000/security/user/authenticate?raw=true")
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || fail "could not obtain Wazuh API token (check credentials)"
VER=$(curl -sk -H "Authorization: Bearer $TOKEN" "https://localhost:55000/manager/version")
echo "$VER" | grep -q '"data"' || fail "manager/version returned unexpected payload"
pass "Wazuh manager API reachable ($VER)"
echo "Next: register a test agent, then check /api/services/endpoint-protection/live on the platform (guide step 4)."
