# ALIGNMENT — Infracentra Agent Brief vs. actual repository
Analysis-only audit, 2026-10-31. No code was changed. Every claim below cites a file I actually opened
or a command I ran in this repo. Items not checked are marked **TODO_VERIFY**.

Brief analyzed: `Infracentra Agent Brief for Service Registry, Connectors, Installers and First-S.md` (245 lines, at repo root — not in a `vx/` folder).

## Owner decisions log (2026-10-31, turn 2) - authoritative answers to the open questions

| # | Question from this audit | Owner decision | Effect on docs/plan |
| --- | --- | --- | --- |
| 1 | Git remote / push | **Manual by owner.** Agent commits only; no push attempts. | Commits stay local on branch; owner pushes. |
| 2 | Installer target: VM or containers? | **Deployment VM is the end goal, but containers for now.** | Phase 3 installers are Docker-compose based (`deploy/installers/<id>/` with compose file + `install.sh`/`verify.sh` wrappers); bare-metal path deferred; preflight still checks host RAM/disk/ports for container sizing. |
| 3 | Tenant key naming | **Confirmed: `org_id` IS the tenant/client key** (the client's ID). "Tenant" in UI-speak refers to the whole client-admin area, not a rename target. | No `tenant_id` rename ever. Docs wording everywhere: "`org_id` (the tenant key)". |
| 4 | Cases backend | **Keep native tickets as default AND add DFIR-IRIS.** | T3.4 (IRIS installer) confirmed in scope; IRIS is an opt-in connector/provider alongside TheHive; native `ticketing.py` remains primary until a per-org switch. |
| 5 | TLS verify=False / InsecureSkipVerify | **Fix behind a flag; keep current lenient behavior as default** (no breakage of existing self-signed lab setups). | Add `CONNECTOR_TLS_VERIFY` env (default false = current behavior) and agent-go `--insecure` config (default true); flip defaults later via explicit migration note, never silently. |
| 6 | EDR console wiring | **Already pre-installed/coded; day-of implementation needs only a simple adapter change, not a backend rewrite.** | Resolves that TODO_VERIFY directionally: thin adapters map console actions to `/api/actions`; characterization tests first; no route rewrites, no React restructuring. |

Status legend used throughout: **ga** = production-grade and tested here, **beta** = real code, unverified against live external systems, **roadmap** = scaffold/label only.

---

## A. My understanding of the brief (≤10 lines)

1. Make every one of the platform's ~16 services installable, linked and verifiable without breaking what works.
2. Keep existing hard-coded engines (triage, discovery, incident response, playbooks) as `native` providers behind a new registry (strangler pattern).
3. Add open-source SOC tools (Wazuh, MISP, DFIR-IRIS, Cortex, Shuffle, Velociraptor, Suricata, Greenbone, Rspamd…) as connectors behind a vendor-neutral SDK with canonical actions and async jobs.
4. Create a YAML service catalog as single source of truth; derive a full dependency graph, `/api/v1/platform/graph`, Mermaid diagrams and CI orphan checks.
5. Ship per-service idempotent installers (`install.sh`/`verify.sh`/`uninstall.sh`/`versions.lock`) with pinned checksums, secrets generation and preflight resource checks.
6. Generate operator guides from the catalog, each ending in a visible "first success" milestone plus an in-UI onboarding checklist.
7. Enforce multi-tenancy (`tenant_id` everywhere), RBAC, audit logging and TLS-by-default on all new endpoints.
8. Keep `agent-go/` as a site collector only (enrollment, SNMP, buffering); never grow it into an EDR.
9. Phase 0 is a read-only audit producing seven reports in `docs/audit/`; later phases gate on tests.
10. Be honest: `ga|beta|roadmap` status per service, no invented facts (`TODO_VERIFY` instead), no UI claims the backend can't back.

---

## B. Already in the project

Verified by reading files (all paths relative to repo root):

| Brief asks for | Where it exists | Verdict |
| --- | --- | --- |
| Automated triage engine | `backend/app/services/triage.py` — deterministic 0–100 scoring, policy versioning (`TriagePolicy`), critical floor, audit rows; router `backend/app/routers/triage.py` | **Production-grade**, docstring states design contract explicitly |
| Auto-discovery / monitoring | `backend/app/services/discovery.py` — real `nmap` when present, pure-Python async TCP fallback, pysnmp cross-reference with graceful simulation; background task + polling; routers `discovery.py`, `discovery_extra.py` | **Real logic with simulated fallback** (honest degradation, but mixed real/mock) |
| Incident-response code | `backend/app/services/incidents.py` — dedup keys, episode lineage/recurrence, state machine (`check_transition`), ticket sync; router `incidents.py` | **Production-grade** |
| Playbook creation/run | `backend/app/services/soar.py` + `routers/soar.py` — DB-persisted playbooks, allow-listed steps (`SAFE_ACTIONS`), preview/simulate/execute modes, redaction, backward-compatible `/api/playbooks` shim | **Production-grade, deliberately safety-limited** (no arbitrary shell) |
| Connector layer | `backend/app/services/connectors.py` — `SERVICE_CONNECTORS` catalogue for all 16 services + `advanced-ticketing`, httpx probes against Wazuh/TheHive/MISP/Grafana/n8n etc., credentials from `integrations` table; `services/wazuh.py`, `services/misp.py`, `normalizers.py`, `transports.py`, `elastic.py` | **Exists but different shape than brief**: a Python-dict catalogue of read-only live-data pullers, not the manifest/adapter SDK of §4.2. Degrades gracefully; `verify=False` on httpx (risk, see G) |
| Service status endpoint | `GET /api/services/{id}/status` and `/live` in `routers/services.py`, consumed by `src/hooks/useLiveFeed.ts` (live → demo fallback with badge) | **Real**, auth via `get_current_user` |
| Dependency graph | `backend/app/services/service_graph.py` (entitlement-based edges, mirrors `src/data/serviceDependencies.ts`), `device_graph.py`, `org_topology.py` | **Real but entitlement-scoped**, not the catalog-driven requires/feeds/consumes graph of §4.4; no Mermaid/diagram tool |
| Tickets | `models.Ticket`, `services/ticketing.py`, `routers/tickets.py` (list/create/tenant meta) | **Production-grade native provider** — matches brief's `native_ticket` |
| Event ingestion/evidence | `services/evidence.py` (ingest keys, provenance, size limits), `services/pipeline.py` | **Real**; no NATS/Kafka bus (compose has Redis) |
| Multi-tenancy | `org_id` used across models (46 occurrences in `models.py`), token-scoped agent API | **Partially done** — column is `org_id`, not `tenant_id`; coverage per table **TODO_VERIFY** |
| Go agent | `agent-go/` (~2,930 LOC): `internal/snmpx/snmp.go`, collectors (host, portscan, LLDP, IPMI, SMART, SMB, discovery), `transport/client.go` (Bearer token, HTTP), `state/state.go` (persists last scan results), Windows/Unix service wrappers | **Site collector, real code**; enrollment/token flow server-side in `routers/agent.py` (SHA-256 hashed `icag_` tokens, org-scoped). TLS verification disabled (risk), syslog receiver & uplink buffering **not found** — TODO_VERIFY |
| Agent installer | `public/downloads/install.sh` + `install.ps1` (also mirrored in `scripts/downloads/`): `set -eu`, root check, token required, OS/arch detection, versioned download | **Real but thin**; no checksums/`versions.lock` verified in what I read — TODO_VERIFY |
| Docker / infra | `docker-compose.yml` (postgres:18, redis:7-alpine, backend, frontend w/ demo seed), `docker-compose.prebuilt.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf` (proxies `/api/` → `backend:8000`), `start*.bat`, `start-kali.sh` | **Works for the app itself**; nothing installs the external OSS stack |
| React frontend | `src/` ≈41,068 lines, 101 `<Route path>` entries in `App.tsx`; client-admin pages incl. `EndpointProtectionPage.tsx` with the exact console buttons listed in the brief | **Real UI**; Endpoint page data = `tryLiveFeed('endpoint-protection')` → falls back to `demoWorld.ts` mock; button actions wired to `services/securityOps.ts` — whether they hit real backend endpoints **TODO_VERIFY** |
| Tests | `backend/tests/` (20 files: triage, discovery auth, incidents episodes, entitlement graph…), `tests/test_pricing_golden.py` | **Present but narrow**; no connector/catalog/installer tests yet |

---

## C. Missing (brief asks, does not exist)

1. **YAML service catalog** — no `backend/platform/catalog/services/*.yaml`; equivalent data lives in `connectors.py` dict, `seed.py ALL_SERVICES`, `src/data/mockData.ts`. No Pydantic startup validation.
2. **Connector SDK** — no `backend/platform/connectors/` (`base.py` protocol, `registry.py`, `models.py` canonical Detection/Asset/Incident/Job, `jobs.py` async job queue w/ retries+circuit breaker, `guardrails.py` four-eyes/blast-radius/dry-run). Existing `wazuh.py`/`misp.py` are ad-hoc classes, not capability-governed connectors.
3. **Canonical action bus** — no `POST /api/v1/actions`, no `GET /api/v1/capabilities`; EDR console buttons have no unified backend route.
4. **Per-service installers** — no `deploy/` directory at all; nothing installs Wazuh, MISP, IRIS, Velociraptor, Greenbone, Rspamd, Suricata, Shuffle. Only the goinfra agent installer exists.
5. **Generated docs/guides** — no `docs/services/*`, no `python -m backend.tools.gen_docs`, no `backend/tools/` module (`dump_routes`, `gen_diagram` likewise absent).
6. **Graph API/diagram** — no `/platform/graph`, no Mermaid output, no Platform Map page, no CI orphan/cycle check (and **no CI at all**: no `.github/`).
7. **Message bus / normalizer pipeline** — no NATS/Kafka, no OCSF/ECS normalization (only bespoke `normalizers.py`).
8. **Secrets abstraction** — no `backend/platform/secrets/`; secrets come from env + `integrations` table.
9. **The OSS components themselves** — compose runs Postgres/Redis/backend/frontend only; no Wazuh manager/indexer/dashboard, MISP, IRIS/TheHive, Cortex, Shuffle, Velociraptor, Suricata, Greenbone, Rspamd containers.
10. **Phase-0 reports** — `routes.csv`, `pages.csv`, `native-engines.md`, `agent-go.md`, `infra.md`, `services-reconciled.md`, `secrets-and-risks.md` did not exist before this document set (this audit covers parts of them informally).
11. **Onboarding checklist / status chips driven by verify scripts** — `useLiveFeed` badge exists; the four-state lifecycle chip does not.

---

## D. Can implement within this stack

| Item | Size | Notes |
| --- | --- | --- |
| Catalog YAML + Pydantic validator + loader (`backend/platform/catalog/`) seeded from existing `SERVICE_CONNECTORS`/`ALL_SERVICES` | medium | Pure addition; no existing code touched |
| `dump_routes`/`pages.csv` generator tools + this Phase-0 report set completed | small–medium | FastAPI introspection + grep of `src/` |
| Canonical action types + `POST /api/actions` + `GET /api/capabilities` mapping to existing engines (ticket.create→ticketing, notify→notifications, isolate/block→existing gated SOAR steps) | medium | Reuses `soar.SAFE_ACTIONS` semantics; keeps legacy routes |
| Connector SDK `base/registry/models/jobs` wrapping current `wazuh.py`, `misp.py`, `connectors.py` fetchers as providers; `mock` connector | medium | Strangler adapters only |
| Native-provider wrappers + characterization tests for Triage/Discovery/Incidents/SOAR | medium | Test-first, then thin adapters |
| Graph endpoint `/api/platform/graph` (+`?format=mermaid`) built from catalog; `gen_diagram` writing `docs/architecture/*.mmd` | medium | Extends idea already proven in `service_graph.py` |
| Guide generator `docs/services/<id>.md` + `GETTING_STARTED.md`; onboarding checklist UI + `/services/{id}/status` extension | medium | Status probe already exists |
| MVP installers (Docker-compose based) for Wazuh, MISP, DFIR-IRIS, Greenbone under `deploy/installers/<id>/` with `verify.sh` first-success tests (EICAR/GUBE-style safe inputs) | large | Compose approach fits existing `docker-compose.yml` pattern; pins/checksums must be researched, many `TODO_VERIFY` expected |
| agent-go hardening: enable TLS verification (flagged config), unit tests, fake-SNMP integration test, build/release script with checksums | small–medium | Server side already token-scoped |
| Job runner on Redis (already in compose) for `jobs.py` async actions | medium | Avoids introducing Kafka/NATS prematurely |
| `node_modules` de-tracking (brief §10) | small | Mechanical, separate commit; needs confirmation `npm ci` builds |

## E. Cannot / should not implement (now)

1. **Full live install of the whole OSS fleet in this environment** — installing Wazuh+OpenSearch+Greenbone needs ≥16 GB RAM VMs and internet downloads; cannot be verified here. Scripts can be written but stay unverified → mark `TODO_VERIFY` and ship fail-loudly (per brief rule 5).
2. **Real network isolation / live shell / rollback from the EDR console** — no Velociraptor or Wazuh Active Response is deployed; `soar.py` intentionally refuses raw sockets/subprocess. Faking these would violate honesty rule 6; correct move is capability flags showing "unsupported".
3. **NATS/Kafka event bus replacing current flow** — risky rewrite of working alert→incident→triage pipeline for no current need; defer (design note only). Default choice if ever needed: Redis Streams (already deployed).
4. **Hashicorp Vault backend** — external system, no deployment target here; keep the interface stub only.
5. **OTX self-hosting** — brief itself notes OTX is cloud-only; treat as feed into MISP via existing `threat_intel.py`.
6. **SD-WAN / UEBA / Multi-Layer AI implementations** — no native code exists (`comingSoonServices.ts` signals roadmap status); scaffolds only, labeled `roadmap/beta`.
7. **Renaming `org_id` → `tenant_id` everywhere** — conflicts with 46 model usages and every router; additive alias/migration only if truly needed (brief's own non-destructive rule takes precedence).
8. **Rewriting the 101-route React app or restructuring `src/`** — brief forbids it; only additive `src/platform/` module.
9. **Git history cleanup of node_modules** — brief requires explicit approval; out of scope.
10. **Commercial/edge appliances (FortiGate, OPNsense real devices, AD/Entra)** — depend on customer hardware; adapters only, unverifiable here.

---

## F. Brief vs. reality (adapted wording)

| Brief says | Reality (evidence) | Proposed wording |
| --- | --- | --- |
| File is in `vx/` (user prompt) | File is at repo root | Reference the root path |
| "FastAPI backend, 228 routes" | 193 decorator-defined routes across 31 router files (`grep -rE "@(app|router)\.(get|post|…)"` = 193) | "~193 declared routes, 31 routers; regenerate with dump_routes" |
| "backend ~21,000 lines" | 27,734 Python LOC in `backend/` | "~28k lines" |
| "`src/` ~41,000 lines" | 41,068 TS/TSX LOC ✔ | keep |
| "`agent-go/` ~2,900 lines" | 2,930 LOC ✔ | keep |
| Routes prefixed `/api/v1/...` | All mounted under plain `/api` (`main.py:108-157`); pricing_v2 has its own v1 router | Use `/api/...`; new endpoints follow `/api/<feature>` |
| Deploy dirs `deploy/`, `docker/`, `nginx/` | None exist; infra = `docker-compose*.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, `start*.bat`, `scripts/` | Point installers at a new `deploy/` tree; reuse compose patterns |
| "catalog generates dependency diagram" | Dependency data already exists twice: `service_graph.py` + `src/data/serviceDependencies.ts` | Seed catalog from those; plan convergence, don't duplicate a third time |
| Canonical severity `critical|high|medium|low|info` | Matches both `triage.SEVERITY_ORDER` and `EndpointAlert` type ✔ | keep |
| Detection shape "(type, severity, device, IP, threat, action, time, ticket)" | Exactly `EndpointAlert` in `EndpointProtectionPage.tsx:70-80` ✔ | keep — good anchor |
| Tickets via DFIR-IRIS/TheHive | Working native `tickets` table/router already exists | Treat native as primary provider (brief allows this in §7) |
| `tenant_id` column | Codebase uses `org_id` | Say "`org_id` (the tenant key)" or add additive aliases; do not rename |
| TheHive as case backend | `connectors.py` already points at TheHive; brief warns TheHive 5 licensing limits | Keep TheHive as configured default in code, prefer IRIS for *new* installs; reconcile in catalog |
| "PlaybookBuilder/PlaybookRunner" | Actual names: `soar.validate_steps`, `Playbook`/`PlaybookRun` models, `/api/playbooks` legacy shim | Use real symbols in manifests |
| node_modules "16,364 of 16,887 tracked" | Verified exactly ✔ (`git ls-files`) | keep |
| Sidebar groups list | Frontend has 101 routes incl. landing/pricing/partner/client-admin areas beyond the SOC sidebar | Derive pages.csv from `App.tsx`, not the brief's group list |

## G. Conflicts & risks

1. **TLS verification disabled in 4 places** — `wazuh.py:21`, `connectors.py:155,187` (`verify=False`), `agent-go/internal/transport/client.go:29` (`InsecureSkipVerify: true`). Any "TLS on by default" work must fix these behind a flag without breaking self-signed lab setups. (Fixing = behavior change → schedule deliberately.)
2. **Default secret in prod path** — `core/config.py:18` ships `SECRET_KEY="your-super-secret-key-change-in-production…"`. New code must refuse to start with it in non-dev mode; changing now could break running deployments → TODO_VERIFY deployment envs.
3. **Strangler risk:** `GET /api/playbooks` shape is depended upon by `src/services/soarApi.ts`; any catalog/action refactor must keep it byte-compatible (legacy shim already exists — extend, don't replace).
4. **Mock/demo coupling:** pages fall back to `demoWorld.ts` silently; enabling connectors could flip tables from demo to live mid-demo. Mitigate with the existing live/fallback badge + explicit per-tenant connector flag.
5. **Duplicate catalogs:** service lists currently in 4 places (`seed.py ALL_SERVICES`, `connectors.py`, `src/data/mockData.ts`, `serviceDependencies.ts`). Adding a 5th (YAML) without a generated-from or validated-against mechanism creates drift. CI check needed (none exists today — no `.github/`).
6. **Installer downloads:** `public/downloads/install.sh` piped-install pattern (`curl … | sudo sh`) conflicts with brief §5 "no curl|bash of unverified content" until checksums added.
7. **node_modules committed** makes any npm-phase diff enormous; do §10 in its own labeled commit only after verifying `npm ci && vite build`.
8. **Not checked (TODO_VERIFY):** per-table `org_id` completeness; whether EDR buttons call real endpoints (`securityOps.ts` internals); syslog listener existence anywhere; agent uplink buffering; gitleaks scan not run; alembic migration state; `dist/` freshness; partner/client-admin route ownership; whether `docker-compose.prebuilt.yml` differs meaningfully.
