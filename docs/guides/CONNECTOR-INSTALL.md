# Connector Installation & Wiring Guide (MVP: Wazuh · MISP · DFIR-IRIS)

**Audience:** the operator. Everything here is run **manually**, step by step.
Nothing in this repo starts these containers for you. The platform code for
every connector is **already written** (`backend/app/platform/connectors/providers/`)
— installing an engine only makes its probe/live endpoints answer; there is
**no backend rewrite**, just configuration (owner decision #6).

Scope per decisions: containers-first (#2), default sizing 8 GB RAM / 4 vCPU /
100 GB disk (#7), Greenbone/OpenVAS deferred to Phase 6 (#8). Other catalog
services (Grafana, n8n, Pi-hole, OPNsense, …) follow the same pattern later —
their provider code already exists too; they just have no compose file yet
(TODO_VERIFY list at bottom).

---

## Step 0 — Prerequisites check
```bash
bash deploy/preflight.sh
```
Fix every FAIL/WARN it prints. It checks Docker + Compose v2, RAM/CPU/disk
defaults, the `infracentra-network` (created by the main stack), port clashes
(443 vs nginx!), and that `deploy/.env.connector` exists.

## Step 1 — Start the platform first (if not running)
```bash
docker compose up -d          # repo root: db, redis, backend :8000, frontend :3000
```

## Step 2 — Secrets file
```bash
cp deploy/.env.connector.example deploy/.env.connector
chmod 600 deploy/.env.connector
# fill every CHANGE_ME:  openssl rand -hex 32
```

## Step 3 — Launch the MVP connector stack
```bash
docker compose -f deploy/docker-compose.connectors.yml --profile mvp --env-file deploy/.env.connector up -d
# or one engine at a time:  --profile wazuh | --profile misp | --profile iris
docker compose -f deploy/docker-compose.connectors.yml ps
```
Wazuh takes ~2–3 min to become healthy. Verify:
```bash
curl -sk -u "$WAZUH_API_USER:$WAZUH_API_PASS" https://localhost:55000/manager/version   # JSON token follows
curl -s http://localhost:8081/servers/getVersion | head -c 200                          # MISP (needs API key header for real calls)
curl -s http://localhost:8001/api/v1.0/about/version                                     # DFIR-IRIS (login as admin created on first boot)
```

## Step 4 — Wire each engine into the platform (UI, no code)
For each service below: open **Integrations → Add**, then
1. set `service_id`, `api_endpoint`, `api_key` exactly as tabled,
2. set `status = active`, `license_type = open-source`, `integration_type = api`.
The connector probes read the `integrations` table (`load_connector_config`).

| service_id           | api_endpoint (from backend container)      | api_key format                | verify with |
|----------------------|--------------------------------------------|-------------------------------|-------------|
| endpoint-protection / compliance | `https://wazuh-manager:55000`    | `user:password` (HTTP Basic)  | Services page → status shows *live* |
| threat-intel         | `http://misp`                              | `Bearer <MISP API key>` (site admin > User > your key) | `/api/services/threat-intel/status` |
| incident-response    | `http://iris-server:8000`                  | `Bearer <IRIS API key>` (IRIS UI → account → API keys) | `/api/services/incident-response/status` |

Host-only alternative endpoints: `https://localhost:55000`, `http://localhost:8081`, `http://localhost:8001`.

Then confirm honestly from the CLI:
```bash
TOKEN="<jwt from /api/auth/login>"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/services/endpoint-protection/live | head -c 300
```
`"source":"live"` means wired; `"none"/"unreachable"` means the guide step above
was missed — the UI shows **NO LIVE SOURCE**, never fake data.

## Step 5 — Platform-side flags (optional, opt-in)
In `backend/.env` (or compose environment):
```
PLATFORM_CATALOG_ENABLED=true   # enables GET /api/platform/graph|capabilities, POST /api/platform/actions
PROVIDER_MODE=native            # canonical actions delegate to native engines (default)
CONNECTOR_TLS_VERIFY=false      # keep lenient self-signed behavior (decision #5); flip to true once certs are real
```
Restart backend. Check:
```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/platform/capabilities \
  | python3 -m json.tool | grep -A2 '"service": "threat-intel"'
```
`connector_code_shipped: ["threat-intel"]` proves the adapter exists even before deployment.

## Step 6 — First-success milestones (per brief §first-success)
1. **Endpoint:** install a Wazuh agent on one test host (agent-go installer docs / Wazuh docs URL in catalog). Agent appears in EDR console live list.
2. **Intel:** push one MISP event; it appears under Threat Intel live records.
3. **Case:** `POST /api/platform/actions {"service":"incident-response","action":"case.create","payload":{"title":"drill"}}` → returns ok via native ticketing (dry_run defaults true — set false to write).
4. **Playbook:** run a non-dangerous SOAR playbook from the Playbooks page; audit log records it.

## Step 7 — Uninstall / teardown (manual, safe)
```bash
docker compose -f deploy/docker-compose.connectors.yml --profile mvp down        # keeps volumes
docker compose -f deploy/docker-compose.connectors.yml --profile mvp down -v     # DESTROYS data — confirm first
```
Then deactivate the matching rows in Integrations so probes honestly report
"no endpoint configured".

---

### TODO_VERIFY (checkboxes to tick on the day of implementation)
- [ ] Image pins in `deploy/docker-compose.connectors.yml` (all marked TODO_VERIFY) match what actually installed cleanly.
- [ ] Wazuh dashboard :443 collision with nginx resolved (remap or disable dashboard port).
- [ ] `andriux/misp` build still current; else switch to official misp/misp image.
- [ ] IRIS exact version tag pinned after first successful boot.
- [ ] Active Response enabled if you want real `endpoint.isolate` semantics.
- [ ] Non-MVP engines (Grafana, n8n, OpenVAS→Phase 6, Pi-hole, OPNsense, Tailscale, Restic, Rspamd, CloudSploit/Prowler, Fleet, NetBox/LibreNMS, GLPI): provider code exists; add compose services under new profiles when needed.
