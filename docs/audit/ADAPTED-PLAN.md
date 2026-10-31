# ADAPTED-PLAN — Brief phases mapped to this repository
Derived from `docs/audit/ALIGNMENT.md`. Each task is scoped to fit ~35 agent steps.
Prefix convention: every new backend feature lives under `backend/platform/` (new tree, additive only).
API prefix in this repo is `/api/...` (not `/api/v1/...`) — see ALIGNMENT §F.

## Phase 0 — Read-only audit (completes what this session started)  [DONE partially: ALIGNMENT.md]
- T0.1 `backend/tools/dump_routes.py` → `docs/audit/routes.csv` (method, path, handler, router, auth dep, tables, real/stub/mock). ~20 steps.
- T0.2 `backend/tools/dump_pages.py` (parse `src/App.tsx` 101 routes + grep `src/services/*.ts`, `useLiveFeed` usage) → `docs/audit/pages.csv`. ~25 steps.
- T0.3 `docs/audit/native-engines.md`: triage / discovery / incidents / soar / ticketing deep-read with test coverage evidence (`backend/tests/`). ~30 steps.
- T0.4 `docs/audit/agent-go.md`: collectors vs claims (SNMP ✔, syslog ✖?, buffering ✖?, mTLS ✖ — InsecureSkipVerify found); gap list. ~25 steps.
- T0.5 `docs/audit/infra.md`: compose files ×2, Dockerfiles, nginx.conf, start scripts, install.sh/ps1 duplicates (`public/downloads` vs `scripts/downloads`). ~20 steps.
- T0.6 `docs/audit/services-reconciled.md`: 16 services of `seed.py ALL_SERVICES` ↔ connectors ↔ pages ↔ engines. ~20 steps.
- T0.7 `docs/audit/secrets-and-risks.md`: run gitleaks; verify=False inventory; default SECRET_KEY; org_id coverage per table. ~30 steps.

## Phase 1 — Catalog + graph (small, additive commits)
- T1.1 Create `backend/platform/catalog/schema.py` (Pydantic ServiceSpec) + loader + startup validation behind flag `PLATFORM_CATALOG_ENABLED=false`. ~30 steps.
- T1.2 Author the 16 service YAMLs + 9 platform-component YAMLs, seeded from `connectors.SERVICE_CONNECTORS` and `service_graph.SERVICE_DEPENDENCY_RULES`; add drift-check test comparing catalog vs those two sources. ~35 steps.
- T1.3 `GET /api/platform/graph` (+`?format=mermaid`) reading catalog; auth via existing `get_current_user`; audit-log write. ~25 steps.
- T1.4 `backend/tools/gen_diagram.py` → `docs/architecture/platform.mmd` + per-service mmd + service×page×route matrix CSV. ~25 steps.
- T1.5 CI bootstrap (none exists): GitHub Actions running pytest + catalog validation + orphan-route/page check. ~30 steps.

## Phase 2 — Connector SDK + canonical actions
- T2.1 `backend/platform/connectors/base.py` + `models.py` (Detection = EndpointAlert shape + MITRE + org_id; severity enums match `triage.SEVERITY_ORDER`). ~30 steps.
- T2.2 `registry.py` + manifest.yaml discovery + `_template/` + `mock` connector + `docs/connectors/WRITING_A_CONNECTOR.md`. ~30 steps.
- T2.3 Wrap current read-pullers as providers: `wazuh`, `misp`, `thehive` (existing code paths), fix nothing else. Characterization tests first. ~35 steps.
- T2.4 `jobs.py` async job store on Redis (already in compose): queued→running→succeeded|failed|unsupported, idempotency keys, retries. ~35 steps.
- T2.5 `guardrails.py`: RBAC per action, four-eyes for dangerous ops, dry-run, protected assets, audit log — reuse `soar.py` consequential-action gating concepts. **Owner decision #5:** all connector HTTP calls go through one transport helper honoring `CONNECTOR_TLS_VERIFY` (default `false` = current lenient behavior; opt-in strict). ~30 steps.
- T2.6 `POST /api/actions` + `GET /api/capabilities?org_id=`; **owner decision #6: this is the "simple adapter" layer — map existing console buttons (`securityOps.ts` action groups) to canonical names by thin delegation to current routes/engines; no backend rewrite; unsupported ones return `unsupported` (honesty rule).** ~35 steps.
- T2.7 Native-provider adapters: `TriageEngine`, `DiscoveryEngine`, `IncidentResponseRunner`, SOAR runner behind provider interface + `provider_mode` config flag (default `native`). ~35 steps.

## Phase 3 — MVP installers (compose-based per owner decision #2; fail-loudly on TODO_VERIFY pins)
- T3.1 `deploy/preflight.sh` (RAM/CPU/disk/port checks vs catalog resources, sized for containers on the target VM) + top-level `deploy/install.sh --service …|--profile mvp`. ~30 steps.
- T3.2 Wazuh single-node installer + connector registration + `verify.sh` (API reachable, test alert appears via `/api/incidents`). ~35 steps. Versions/checksums: research official pages or emit TODO_VERIFY.
- T3.3 MISP installer + `verify.sh` (test IoC event queryable) reusing `services/misp.py`. ~30 steps.
- T3.4 DFIR-IRIS installer + case-create-from-alert verify; **owner decision #4: IRIS confirmed in scope** — native tickets stay default provider, IRIS opt-in per org (`org_id`), TheHive kept as configured connector. ~35 steps.
- T3.5 Greenbone minimal installer + first-finding verify (heaviest — preflight gate). ~35 steps.
- T3.6 nginx routing for new UIs under separate paths w/ TLS notes; merge duplicate compose configs found in T0.5. ~25 steps.

## Phase 4 — Guides + onboarding UI
- T4.1 `backend/tools/gen_docs.py` → `docs/services/<id>.md`, `_index.md`, `GETTING_STARTED.md` from catalog + template. ~30 steps.
- T4.2 Extend `GET /api/services/{id}/status` with lifecycle state (not_installed→installed→connected→first_success) + persisted timestamp per org. ~25 steps.
- T4.3 Additive `src/platform/`: `useCapabilities()`, `ServiceStatusChip`, `OnboardingChecklist`, Platform Map page (admin route only). No restructuring. ~35 steps.

## Phase 5 — Endpoint/DNS/Email/SOAR migration
- T5.1 Velociraptor connector (live response/collection/hunt) marked beta; wire `host.collect` only if deployed, else capability=unsupported. ~35 steps.
- T5.2 EICAR-safe endpoint first-success: Wazuh agent SCA/malware check row in Endpoint Protection table via existing `/live` feed. ~30 steps.
- T5.3 DNS filtering connector (Unbound RPZ fed from MISP) + GTUBE-style email test via Rspamd adapter. ~35 steps.
- T5.4 Playbook canonical-action shim: allow new-style actions in playbook steps while old `SAFE_ACTIONS` keep working; migration script dry-run by default. ~30 steps.

## Phase 6 — Firewall/VPN/Backup/Patch/Cloud (adapters only, honest beta)
- T6.1 OPNsense/pfSense API adapter + config-backup verify (needs customer device → mock-backed tests only). ~30 steps.
- T6.2 WireGuard peer enrollment verify (containerizable locally). ~30 steps.
- T6.3 Restic/UrBackup backup+restore first-success (locally verifiable). ~30 steps.
- T6.4 osquery/Ansible patch-management read-only listing. ~30 steps.
- T6.5 Prowler read-only cloud scan adapter. ~25 steps.

## Phase 7 — UEBA / AI / SD-WAN scaffolds
- T7.1 UEBA baseline scaffold on existing `baseline_eval.py` data; status beta, no anomaly claims until window met. ~30 steps.
- T7.2 LLM incident summary behind flag + analyst approval label; no vendor key invented. ~25 steps.
- T7.3 SD-WAN roadmap stub with explicit "experimental" UI labeling. ~15 steps.

## Phase 8 — Repo hygiene + final report
- T8.1 Verify `npm ci && npm run build` clean; then separate labeled commit: gitignore + `git rm -r --cached node_modules`; add npm ci step to Dockerfile. ~30 steps.
- T8.2 agent-go: TLS verification flag (default keep current behavior to avoid breakage), unit tests, fake SNMP integration test, checksummed release script feeding `install.sh`. ~35 steps.
- T8.3 `docs/REPORT.md` in brief §13 format: kept/wrapped/added/not-done, all TODO_VERIFYs, license review list (AGPL components, TheHive). ~25 steps.

## Explicit deviations from the brief (recorded here instead of silently) — updated with owner decisions 2026-10-31
- Routes stay `/api/...` (repo reality), not `/api/v1/...`.
- Tenant key remains `org_id`; **owner confirmed (#3): `org_id` IS the client/tenant ID; "tenant" = the client-admin area. No rename, ever.**
- Event bus deferred: Redis jobs now; NATS/Kafka only if volume demands (design note).
- Native tickets are the primary case provider; **DFIR-IRIS added as opt-in connector per owner decision #4**; TheHive stays as configured connector.
- Installers are Docker-compose based **per owner decision #2 (containers now, VM bare-metal later)**; preflight still validates host capacity for the container fleet.
- TLS verification: new `CONNECTOR_TLS_VERIFY` / agent-go `--insecure` flags introduced with defaults preserving today's lenient behavior (**owner decision #5**); strict-by-default is a later, explicit migration step.
- EDR console: thin adapter mapping to `/api/actions` only — **owner decision #6: no backend rewrite; wiring already exists.**
- Push: agent commits locally; **owner pushes manually (decision #1)**.
- Nothing switches from native to connector by default; every phase gated by its verify script + characterization tests.

**Plan APPROVED by owner on 2026-10-31 (with decisions #1–#6 above incorporated). Implementation may begin at T0.1.**
