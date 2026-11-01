#!/usr/bin/env bash
# T3.4 verify — DFIR-IRIS server answers on :8001.
set -euo pipefail
R=$(curl -s --max-time 5 http://localhost:8001/api/v1.0/about/version || true)
echo "$R" | grep -qE '(status_code|version)' && echo "PASS: IRIS API responds ($R)" \
  || { echo "FAIL: IRIS :8001 not answering — check infracentra-iris-server/-app logs"; exit 1; }
echo "First-success: create a case in IRIS UI, then POST /api/platform/actions case.create (dry_run) on the platform."
