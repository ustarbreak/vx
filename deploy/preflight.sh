#!/usr/bin/env bash
# deploy/preflight.sh — manual-run check before starting the connector stack.
# Sizing = conservative containerized defaults (owner decision #7):
#   8 GB RAM / 4 vCPU / 100 GB free disk / Docker Engine + Compose v2.
# Fails loudly; never installs anything itself.
set -euo pipefail

MIN_RAM_GB=${MIN_RAM_GB:-8}
MIN_CPU=${MIN_CPU:-4}
MIN_DISK_GB=${MIN_DISK_GB:-100}

fail=0
say(){ printf '%s\n' "$*"; }
chk(){ # chk <label> <ok:0/1> <hint>
  if [ "$2" -eq 0 ]; then say "OK    $1"; else say "FAIL  $1 -> $3"; fail=1; fi
}

command -v docker >/dev/null 2>&1; chk "docker CLI present" $? "install Docker Engine first"
docker compose version >/dev/null 2>&1; chk "compose v2 plugin" $? "install docker-compose-plugin"
docker info >/dev/null 2>&1; chk "docker daemon reachable (permissions)" $? "run as docker group member / sudo once"

RAM_GB=$(awk '/MemTotal/{printf "%d", $2/1024/1024}' /proc/meminfo)
[ "$RAM_GB" -ge "$MIN_RAM_GB" ]; chk "RAM >= ${MIN_RAM_GB}GB (found ${RAM_GB}GB)" $? "Wazuh+indexer alone want ~6GB; add more or run fewer profiles"

CPUS=$(nproc); [ "$CPUS" -ge "$MIN_CPU" ]; chk "vCPU >= ${MIN_CPU} (found ${CPUS})" $? "reduce profiles (--profile misp only)"

DISK_GB=$(df -Pm . | awk 'NR==2{printf "%d", $4/1024}')
[ "$DISK_GB" -ge "$MIN_DISK_GB" ]; chk "free disk >= ${MIN_DISK_GB}GB (found ${DISK_GB}GB)" $? "images+volumes need headroom; prune old images"

docker network inspect infracentra-network >/dev/null 2>&1 \
  && chk "infracentra-network exists (start main compose first)" 0 "" \
  || { say "WARN  infracentra-network missing -> run 'docker compose up -d' from repo root FIRST, then re-run preflight"; }

for p in 5432 6379 8000 3000 1514 1515 55000 9200 443 8081 8001; do
  (echo >/dev/tcp/127.0.0.1/"$p") >/dev/null 2>&1 \
    && say "WARN  host port $p already in use -> remap in compose or stop the conflicting service"
done

[ -f "$(dirname "$0")/.env.connector" ] \
  && chk ".env.connector present" 0 "" \
  || say "FAIL  $(dirname "$0")/.env.connector missing -> cp deploy/.env.connector.example deploy/.env.connector and fill secrets"

if [ "$fail" -ne 0 ]; then say "Preflight FAILED — fix items above, then re-run."; exit 1; fi
say "Preflight OK. Next: docs/guides/CONNECTOR-INSTALL.md step 3."
