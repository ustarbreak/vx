# Infracentra: Agent Brief for Service Registry, Connectors, Installers and First-Success Guides

Paste or load this brief into the coding agent. It is written to the agent ("you").

## 0. Mission

Infracentra is a multi-tenant SOC / MSP platform. Your job is to make every service in the project **installable, linked and verifiable**:

1. Keep every piece of backend logic that already works in production (hard-coded automated triage, pure-Python auto-discovery monitoring, incident-response code, playbook-creation scripts).
2. Add the missing open source components (Wazuh, MISP, DFIR-IRIS/TheHive, Cortex, Shuffle, Velociraptor, Suricata, Greenbone, Rspamd, etc.) as **connectors** behind a vendor-neutral layer, so swapping a component later means a small manifest/adapter change, not a backend rewrite.
3. Link every service and every frontend page to the services it depends on or feeds, in the backend, so the project can **generate a full dependency diagram**.
4. For each service, ship a **prebuilt installer script** that downloads and installs every dependency, plus a **generated guide** that takes an operator from zero to the service's *first success* (first alert, first incident, first ticket, or first monitored device).

Do this for every service present in the project, not only the ones listed here.

## 1. Project context

| Part | Location | Size |
| --- | --- | --- |
| React frontend | `src/` | \~41,000 lines |
| FastAPI backend | `backend/` | 228 routes, \~21,000 lines |
| Go agent | `agent-go/` | \~2,900 lines |
| Install scripts, Docker, nginx | repo root / `deploy/` / `docker/` / `nginx/` | to be discovered |
| `node_modules` | committed in git | 16,364 of 16,887 tracked files |

Sidebar groups seen in the UI: *Dashboard & Intelligence* (Command Center), *SOC Operations* (Active Incidents, Security History, Incident Response, Notifications), *Assets & Infrastructure*, *Security Services & Protection* (Endpoint Protection, Email Security, Cloud Security, DNS Filtering, Firewall Management, VPN Gateway, SD-WAN).

The product is organized in three groups:

- **Security Orchestration:** AI-focused SIEM, Open XDR, ITDR, UEBA, Multi-Layer AI.
- **Network Management:** Network Monitoring, DNS Filtering, Firewall Management, VPN Gateway, SD-WAN.
- **PSA Services:** Vulnerability Scanning, Patch Management, Backup & DR, Endpoint Protection, Email Security.
- Cloud Security appears in the sidebar and is probably the 16th service. **Do not trust this list. Derive the real service list from the code and the UI router, and reconcile any difference in your audit report.**

The EDR/XDR Response Console page has buttons (Network Isolate Host, Release Isolation, Run Live Response Shell, Kill Process Tree, Quarantine File/Hash, Capture Forensic Snapshot, Cross-Fleet IOC Hunt, On-Demand Full Scan, Memory/Fileless Scan, Build Attack Timeline, XDR Cross-Correlation, Enrich with Threat Intel, Push Policy Now, Enable Ransomware Rollback, Block Office Macros, Set USB Storage Control, Force Agent Update & Reconnect, Arm Playbook (Ransomware / Phishing), Auto-Create Ticket + Assign Tier-2, Force Credential Reset). Each must resolve to a **canonical action** (section 4.2).

## 2. Hard rules

1. **Non-destructive.** Do not delete, rename or rewrite working code, routes, DB schemas or response shapes unless a section below says so. Existing API contracts used by `src/` must keep working. Add, wrap, link.
2. **Strangler pattern.** Existing hard-coded engines become `native` providers in the new registry. A service can run with `native`, a `connector`, or both (see 4.3). Nothing is switched over by default; switching is a config flag.
3. **Feature-flag everything new.** New behavior is off or additive until its verify script passes.
4. **Small commits on a branch**, one per phase, each leaving the app runnable. Never commit secrets, generated passwords, `.env`, or downloaded binaries.
5. **No invented facts.** Never invent version numbers, URLs, checksums, ports, API paths or CLI flags. Look them up from the official release page or docs when writing an installer. If you cannot verify, write `TODO_VERIFY:<what>` in the manifest and make the installer **fail loudly** rather than guess.
6. **Honest status per service.** Each service gets `status: ga | beta | roadmap`. UEBA, Multi-Layer AI, SD-WAN and anything unproven start as `beta` or `roadmap`. The UI must not claim capabilities the connected stack does not provide. Wazuh is detection-and-response, not a prevention EDR: no native network isolation, live shell or rollback without Velociraptor or custom Active Response. Capability flags must show those buttons as unsupported or degraded.
7. **Ask only for blockers.** For anything ambiguous, choose the safest reasonable default, record it in `docs/ASSUMPTIONS.md`, and continue.
8. **Security by default.** No hard-coded credentials. Installers generate random secrets, store them outside git, and print where they are. TLS on by default for inter-service traffic. Every new endpoint goes through the existing auth and RBAC, and writes to the audit log.
9. **Do not touch `node_modules`** except for section 10, and never edit files inside it.

## 3. Phase 0: read-only audit (produce reports, change no code)

Write these to `docs/audit/`:

1. **`routes.csv`:** all 228 FastAPI routes: method, path, handler, router file, auth/RBAC dependency, DB tables touched, external calls, and whether it is real logic, a stub or mock data. Generate it with a script (`python -m backend.tools.dump_routes`) so it can be re-run.
2. **`pages.csv`:** every React route/page, the API endpoints it calls (grep `fetch`, `axios`, service modules in `src/`), and which sidebar entry it belongs to. Mark pages that render mock/hard-coded data.
3. **`native-engines.md`:** inventory of the existing production-grade logic: the automated triage system, the pure-Python auto-discovery/monitoring, incident-response code, playbook scripts. For each: entry points, inputs/outputs, data stores, how it is scheduled, test coverage, and a production-readiness verdict with evidence.
4. **`agent-go.md`:** what `agent-go/` actually implements versus what is claimed (SNMP, syslog, flows, enrollment, buffering, TLS). It is untested, so list gaps and risks. Do not expand it into an EDR.
5. **`infra.md`:** every install script, Dockerfile, compose file and nginx config: what it installs, ports, volumes, env vars, and duplicates or conflicts.
6. **`services-reconciled.md`:** the true service list (code + UI + docs), mapped to routes, pages, native engines and any existing integration.
7. **`secrets-and-risks.md`:** hard-coded secrets (run gitleaks or equivalent), unauthenticated routes, mock data in prod paths, missing `tenant_id` on tables.

Stop after Phase 0 only if you find a blocker. Otherwise continue to Phase 1 using the reports as your source of truth.

## 4. Target architecture

### 4.1 Service catalog (the single source of truth for links)

Create `backend/platform/catalog/services/<service_id>.yaml`, one per service, validated by a Pydantic schema at startup (fail fast on bad YAML or dangling references). Example:

```yaml
id: siem
name: AI-Focused SIEM
group: security_orchestration
status: beta                 # ga | beta | roadmap
pages: ["/soc/incidents", "/soc/history"]      # frontend routes
api_prefixes: ["/api/v1/siem", "/api/v1/incidents"]
providers:
  - { id: native-triage, kind: native, entrypoint: "backend.triage.engine:TriageEngine", enabled: true }
  - { id: wazuh, kind: connector, connector: wazuh, enabled: false }
requires: [event_pipeline, tenancy, database]   # hard dependencies
optional: [threat_intel, ticketing, soar]
feeds:    [incidents, assets, ticketing]        # downstream consumers
consumes: [network_monitoring, endpoint_protection, email_security, dns_filtering]
capabilities: [alert.ingest, alert.query, detection.rules]
resources: { cpu: 4, ram_gb: 8, disk_gb: 100 }
license: { spdx: TODO_VERIFY, redistribution_note: "TODO_VERIFY" }
installer: deploy/installers/siem/install.sh
verify: deploy/installers/siem/verify.sh
first_success: { id: first_alert, description: "Test alert appears on Active Incidents" }
```

Also catalog **platform components** that are not user-facing services but are depended on: `database`, `event_pipeline`, `tenancy`, `secrets_vault`, `threat_intel`, `ticketing`, `soar`, `identity`, `reverse_proxy`.

### 4.2 Connector SDK and canonical actions

Create `backend/platform/connectors/` containing:

- `base.py`: a `Connector` protocol with `capabilities`, `execute(action) -> JobRef`, `job_status`, `fetch_events(since)`, `normalize(raw)`, `resolve_asset(asset_id)`, `health()`, `get_policy`, `apply_policy`.
- `registry.py`: discovers connectors, loads their `manifest.yaml`, exposes capability queries.
- `models.py`: canonical models: `Detection`, `Asset`, `Incident`, `Job`, `PolicyIntent`, with enums severity (`critical|high|medium|low|info`) and action (`blocked|quarantined|detected|cleaned`). The existing Endpoint Protection table columns (type, severity, device, IP, threat, action, time, ticket) are the starting `Detection` shape. Include MITRE technique IDs and a `tenant_id`.
- `jobs.py`: every action is an async job: `queued → running → succeeded | failed | unsupported`. Retries with backoff, per-connector rate limit and circuit breaker, idempotency keys.
- `guardrails.py`: RBAC per action, four-eyes approval for dangerous actions (live shell, mass isolation, fleet-wide policy push), protected-asset list (domain controllers, backup servers), blast-radius limit, dry-run mode, full audit log, shell command allowlist and session recording.

Canonical action names (the UI and playbooks use only these):

```
host.isolate  host.release  host.shell.open  host.collect  host.scan  agent.update  agent.reconnect
process.kill  file.quarantine  hash.block  hunt.ioc  incident.timeline
policy.apply  policy.set  enrich.indicator  ticket.create  identity.reset_credentials
```

Route the console buttons through one endpoint, `POST /api/v1/actions` with `{action, target, params, tenant_id, dry_run}`. Keep existing endpoints; make them thin wrappers if they overlap. `GET /api/v1/capabilities?tenant_id=` returns which actions are supported per asset, and the React console disables or relabels buttons accordingly.

Build connectors under `backend/connectors/<name>/` (`manifest.yaml`, `connector.py`, `mapping.py`, `tests/`). Vendor-specific API paths, field mappings, severity/status maps and policy translations live in the manifest and mapping files, so most changes are config. Start with:

- **Detection/response:** `wazuh` (alerts, agents, Active Response), `velociraptor` (live response, collection, hunts).
- **Intel/enrichment:** `misp` (OTX and other feeds ingested into MISP; OTX is a cloud feed and cannot be self-hosted), `cortex`.
- **Cases/tickets:** `dfir_iris` (preferred; TheHive 5 has licensing limits, so keep it as an optional adapter only), plus a `native_ticket` provider if the project already has tickets.
- **SOAR:** `shuffle` (optional; the native playbook runner remains the default).
- **Network/DNS/mail/etc.:** adapters listed in section 7.

Add a `connectors/_template/` and a `docs/connectors/WRITING_A_CONNECTOR.md` so a new vendor is a copy-and-fill exercise. Include a `mock` connector with deterministic fake data used by tests and demos.

### 4.3 Native providers (existing code stays)

Wrap each existing production engine behind the same interface as a `native` provider: `TriageEngine`, `DiscoveryEngine` (auto-discovery/monitoring), `IncidentResponseRunner`, `PlaybookBuilder`/`PlaybookRunner`. No logic rewrites; add only an adapter module and tests that lock current behavior (characterization tests) *before* wrapping. Per service, a config flag `provider_mode: native | connector | both` decides who handles the request. In `both` mode, native triage runs on incoming detections and the connector supplies enrichment/response.

Make the playbook runner understand canonical actions only, so the Ransomware Containment playbook reads `host.isolate → process.kill → host.collect → hash.block → identity.reset_credentials → ticket.create` and runs on any provider that supports those capabilities. Existing playbook scripts must keep running; provide a compatibility shim and a migration script (dry-run by default).

### 4.4 Dependency graph and diagram

From the catalog, build the graph (nodes: services, components, connectors, pages, API prefixes; edges: `requires`, `optional`, `feeds`, `consumes`, `renders`, `implemented_by`).

- `GET /api/v1/platform/graph` returns JSON for the graph. Add `?format=mermaid` for Mermaid output.
- `python -m backend.tools.gen_diagram` writes `docs/architecture/platform.mmd`, per-service diagrams, and a matrix (service × page × route × connector) as CSV.
- Add a **Platform Map** page in the React app (admin only) rendering the graph with whatever graph/diagram library is already in `src/`; otherwise render the Mermaid text with the lightest option. Clicking a node shows its status, health, installer, guide and first-success state.
- A CI check fails if a page/route has no owning service, a service references a missing dependency, or a dependency cycle exists among hard `requires`.

### 4.5 Multi-tenancy (design before adding services)

Every event, asset, detection, incident, ticket, policy and job carries `tenant_id`. Audit existing tables (from Phase 0) and add the column through an additive migration with a default tenant for legacy rows. Map tenants to: Wazuh agent groups and OpenSearch tenants/index patterns, MISP organizations, IRIS customers, per-tenant credentials in the secrets abstraction (`backend/platform/secrets/` with a file/env backend now and a Vault-compatible interface).

### 4.6 Event pipeline

Create one ingestion path: collector/agent → message bus (NATS or Kafka, choose by what the project already uses; default NATS for small footprint) → normalizer (OCSF or ECS, pick one and document it) → store + correlation + triage. Existing syslog/SNMP/Go-agent ingestion must keep working and feed this path. Provide a replay tool for stored raw events.

## 5. Installers

For each service create `deploy/installers/<service_id>/` with:

- `install.sh`: idempotent (safe to re-run), `set -euo pipefail`, supports `--dry-run`, `--offline-bundle <path>`, `--tenant`, `--yes`. Detects OS (Ubuntu/Debian first; document others), checks CPU/RAM/disk/ports against the catalog, installs dependencies, pulls pinned images or packages, generates secrets, writes config, starts the service, registers the connector in the platform, and runs `verify.sh`.
- `verify.sh`: health checks plus the **first-success test** (section 6). Exit code 0 only if it passes; machine-readable JSON output (`--json`).
- `uninstall.sh` and `rollback` notes: remove what was added, keep data unless `--purge`.
- `versions.lock`: exact pinned versions plus SHA256 checksums for any downloaded artifact. Verify checksums and signatures before executing anything. **No `curl | bash` of unverified content.** Pin container images by version (digest where possible).
- `compose.yaml` (or compose profile) where the component is containerized, using shared networks and named volumes, and **no published ports beyond what the catalog declares**.

Top-level: `deploy/install.sh --service <id>[,<id>] | --profile mvp|full`, a `deploy/preflight.sh` (resource and port conflict checks across selected services), a `deploy/offline-bundle.sh` that downloads every dependency of selected services for air-gapped installs, and compose profiles so users can run only what they need. Integrate with the existing install scripts, Docker and nginx config: reuse them where they work, merge duplicates, and route new web UIs through nginx under tenant-safe paths or separate hostnames, with TLS.

Resource guardrail: Wazuh indexer, OpenSearch and Greenbone are heavy. Preflight must refuse or warn when RAM/disk is insufficient, and the guide must include sizing by endpoints and retention days.

## 6. Generated guides and first-success milestones

Generate `docs/services/<service_id>.md` from the catalog plus a template (`python -m backend.tools.gen_docs`), never hand-maintained drift. Each guide contains:

1. What the service does, status (`ga/beta/roadmap`), limitations stated honestly.
2. Dependency diagram (Mermaid) for this service: what it requires, feeds and consumes, and which pages show it.
3. Prerequisites and sizing.
4. Installation: the exact installer command, offline variant, expected output.
5. Configuration: tenant mapping, credentials, the catalog flag to enable the provider.
6. **Path to first success**, numbered, copy-pasteable, ending in a visible result in the UI.
7. Verification: `verify.sh` output explained.
8. Troubleshooting, uninstall, upgrade, and license notes.

Also generate `docs/GETTING_STARTED.md` (MVP profile end to end) and `docs/services/_index.md`.

In the UI, add an **Onboarding checklist** per service: a status chip (`not installed → installed → connected → first success reached`) driven by `GET /api/v1/services/{id}/status`, which runs the lightweight verify checks. Persist the first-success timestamp per tenant.

## 7. Per-service targets

Implement in this order of priority. "First success" is what `verify.sh` must demonstrate with **safe test inputs only** (EICAR, GTUBE, benign scripts), never real malware or destructive actions.

| Service | Native code to keep | Open source components to add | First success (visible in UI) |
| --- | --- | --- | --- |
| Network Monitoring | pure-Python auto-discovery, Go agent, SNMP/syslog | optional LibreNMS or Telegraf adapter, ntopng or Suricata for flows | one device auto-discovered via SNMP, polled, shown in Assets & Infrastructure with a live metric |
| AI-Focused SIEM | hard-coded triage | Wazuh manager + indexer + dashboard, Sigma rule pack | an enrolled agent triggers a test rule; an incident appears in Active Incidents with triage score |
| Incident Response / cases / tickets | IR code, playbook scripts | DFIR-IRIS (TheHive optional), MISP, Cortex, Shuffle (optional) | an alert auto-creates a case/ticket; the Ticket column shows "View" with a working link |
| Endpoint Protection | existing EDR console UI | Wazuh agent, ClamAV, YARA, Velociraptor | EICAR file detected, row appears in the Endpoint Protection table; `host.collect` returns a triage package |
| Open XDR | none likely | Wazuh + Suricata/Zeek + Velociraptor + native correlation | a scripted multi-source event chain (email → host → network) correlates into one incident |
| ITDR | partial? (verify) | Wazuh on AD/Entra/Keycloak logs, Sigma identity rules, BloodHound CE (optional) | a simulated failed-login burst raises an identity incident |
| UEBA | none likely | OpenSearch anomaly detection or native models | status `beta`: baseline collecting indicator, first anomaly after the minimum baseline window |
| Multi-Layer AI | triage scoring | LLM summary behind a flag, analyst approval required | an incident shows an AI summary and suggested next steps, labeled as AI-generated and approval-gated |
| DNS Filtering | verify | Unbound/CoreDNS/Technitium with RPZ fed from MISP/OTX | a blocklisted test domain is refused and logged on the DNS page |
| Firewall Management | verify | OPNsense/pfSense API adapter, Ansible for others | config backup and rule list retrieved; a diff is shown |
| VPN Gateway | verify | WireGuard, or Netbird/Headscale | a peer is enrolled and its handshake shows as connected |
| SD-WAN | none | flexiWAN or WireGuard overlay + FRR | `roadmap/experimental`: two-node tunnel up; clearly labeled |
| Vulnerability Scanning | verify | Greenbone/OpenVAS, Nuclei, Trivy | a scan of one asset yields a first finding with CVSS |
| Patch Management | verify | Ansible/AWX, osquery/Fleet (check licenses of any RMM) | pending updates listed for one host; apply is approval-gated |
| Backup & DR | verify | UrBackup, Restic/Kopia, Proxmox Backup Server (choose per project) | first backup job succeeds and a single-file restore test passes |
| Email Security | verify | Rspamd, ClamAV, parsedmarc, GoPhish (optional), Proxmox Mail Gateway (optional) | GTUBE test message is flagged and visible on the Email Security page |
| Cloud Security | verify | Prowler or Steampipe/CloudQuery (read-only credentials) | a read-only cloud account connected and a first finding listed |

"verify" means: use what the audit found. If a working implementation exists, keep it as the `native` provider and add the open source component as an alternative connector, not a replacement.

## 8. Frontend integration (`src/`)

- Do not restructure the app. Add a small `src/platform/` module: a hook `useCapabilities()`, a `ServiceStatusChip`, an `OnboardingChecklist`, and the Platform Map page.
- Wire the EDR/XDR console buttons to `POST /api/v1/actions` with a confirmation dialog, approval flow for dangerous actions, job-status toasts, and disabled/tooltip states from capabilities. Replace mock data on pages listed in `pages.csv` **only** where a real provider exists; otherwise show an explicit "not connected" empty state with a link to the guide.
- Every page header shows the services it depends on and their health, using catalog data.
- Keep the existing look and component library.

## 9. Go agent (`agent-go/`)

Keep it as the **site collector**, not an EDR. Scope for this brief: verify and fix what is needed to reach "first device monitored": enrollment with a token and mTLS, `tenant_id` and `site_id` on every message, SNMP polling, syslog receiver, local buffering when the uplink drops, outbound-only connection to the platform. Add unit tests, an integration test against a fake SNMP target, and a build/release script producing checksummed binaries for the installer. Endpoint telemetry comes from the Wazuh agent, not from this code. Do not expand features beyond this without a note in `ASSUMPTIONS.md`.

## 10. Repo hygiene: committed `node_modules`

16,364 of the 16,887 tracked files are `node_modules`. In a **separate, clearly labeled commit** (and only after confirming `package.json` plus a lockfile exist and `npm ci` builds the app): add `node_modules/` to `.gitignore`, remove it from the index with `git rm -r --cached node_modules` (files stay on disk), add an `npm ci` step to the Docker build and CI, and document it. Do not rewrite git history without explicit approval; mention optional history cleanup in the report.

## 11. Tests and CI

- Characterization tests for each native engine before wrapping.
- Unit tests for every connector using recorded or mocked vendor responses; contract tests against the `mock` connector.
- Catalog validation test (schema, references, no cycles, every route and page owned).
- Shell-script linting (shellcheck) and a dry-run test for each installer.
- A docker-based end-to-end smoke test for the MVP profile: install → verify → first success.
- Existing tests must still pass; report any that were already failing.

## 12. Phases and definition of done

| Phase | Output | Done when |
| --- | --- | --- |
| 0 | Audit reports (section 3) | all seven reports committed |
| 1 | Catalog + schema + graph API + diagram tool + CI checks | `/platform/graph` and Mermaid output render for all services; no orphan pages/routes |
| 2 | Connector SDK, canonical actions, jobs, guardrails, `mock` connector, native wrappers | console buttons run through `/actions`; legacy endpoints unchanged |
| 3 | MVP installers + connectors: Network Monitoring, Wazuh SIEM, cases/tickets (IRIS + MISP), Vulnerability Scanning | each `verify.sh` passes in a clean VM/container |
| 4 | Guide generator + onboarding checklist in the UI | guides generated for all services; checklist shows real state |
| 5 | Endpoint (Velociraptor), DNS, Email, SOAR/playbook migration | first-success tests pass |
| 6 | Firewall, VPN, Backup, Patch, Cloud Security | first-success tests pass or status honestly set to `beta` |
| 7 | UEBA, AI, SD-WAN scaffolds | clearly labeled `beta`/`roadmap`, no false claims in UI |
| 8 | `node_modules` cleanup, final docs | clean clone builds with `npm ci` and compose profile `mvp` |

Do not start a phase until the previous phase's tests pass.

## 13. Final report format

When finished (or when stopping), produce `docs/REPORT.md` with: what was kept untouched, what was wrapped, what was added, what was not done and why, every `TODO_VERIFY`, every assumption, license risks to review by a human (AGPL and other copyleft or source-available components in a hosted multi-tenant service, RMM restrictions, TheHive licensing), known gaps, and the exact commands to reproduce the MVP install and reach first alert, first incident, first ticket and first monitored device.
