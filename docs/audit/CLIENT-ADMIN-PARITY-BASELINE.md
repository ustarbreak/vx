# Client Admin parity baseline — post-PR #31

Audit date: 2026-11-04  
Audited base: `main` at `ae366c1508118516c82c18fee5e77782fae17fb5` (PR #31 merge commit)  
Scope: current frontend route inventory, Client Admin navigation, selected page implementations, and the checked-in backend route inventory.  
Method: read-only GitHub source inspection. No application code or backend data was changed. No local build or test execution was performed in this audit.

## Executive result

The next implementation phase should be **Client Admin parity**, not a visual redesign and not a Platform Admin rebuild. Preserve the existing nine Client Admin navigation groups and existing routes. Prioritize truthful live-vs-demo behavior, action-to-backend parity, and tenant-safe workflows.

The checked-in audit CSVs are not a fully current source of truth: `docs/audit/routes.csv` contains 238 route rows (236 classified real, 1 stub, 1 mock by its source-inspection heuristic); `docs/audit/pages.csv` contains 101 rows and 18 `component-file-not-found` notes. Those classifications are heuristic and the page inventory has stale/missing component mappings. The current source tree contains 91 files under `src/pages/` with TS/TSX/JS/JSX extensions, so counts are not directly comparable (component files, route aliases and non-route components are included). Re-generate and reconcile these inventories before using them as completion metrics.

## Existing Client Admin navigation — preserve exactly

1. Command Center
2. SOC Operations
3. Assets & Infrastructure
4. Security Services & Protection
5. Threat Intelligence
6. Respond & Automate
7. MSSP & Service Management
8. Governance & Reporting
9. Platform Administration (client-scoped)

The navigation is defined in `src/components/Layout.tsx` under the `client_admin` role. The last group currently contains only Subscription & Billing; it must remain client-scoped and must not be confused with global Platform Admin.

## Evidence-backed implementation findings

### P0 — correctness / trust issues to resolve first

1. **Runbooks are not reliably persisted in live mode.**  
   `src/pages/client-admin/AutomationRunbooksPage.tsx` has a create path guarded by `if (demo || true)`, which always takes the local-only branch. Newly created runbooks are appended to component state in `finally`; the page also loads `GET /api/projects/runbooks`, while the checked-in route inventory shows project routes but no `/api/projects/runbooks` route. The “Auto-execute remaining” button has no `onClick` handler. Treat creation, step persistence, and execution as separate capabilities; do not imply execution until a real, authorized backend action exists.

2. **Cloud Security displays fabricated-looking sample findings in live mode.**  
   `src/pages/client-admin/CloudSecurityPage.tsx` tries `tryLiveFeed('cloud-security')` and, when it returns no feed, inserts three hard-coded AWS/Azure/GCP findings with fixed timestamps. The page needs an explicit unavailable / not configured state in live mode; fixture data belongs only in Demo Mode.

3. **Endpoint Protection uses demo fixtures when the live feed is absent.**  
   `src/pages/client-admin/EndpointProtectionPage.tsx` falls back to `demoEndpointAlerts` after `tryLiveFeed('endpoint-protection')` returns no data, including a tenant-filter attempt. Confirm the behavior of `tryLiveFeed` and the OpsConsole action path, then make the source state explicit: live, demo, or unavailable. Do not show fixtures as production findings.

4. **Security action offline behavior needs a trust-boundary review.**  
   `src/services/securityOps.ts::runSecurityAction` returns `ok: true` with `source: 'demo'` after backend failure, with text saying nothing was sent and a local simulation is running. `OpsConsole` must visibly preserve that source distinction in every success/result surface. For live mode, a failed request must never be presented as a device action that actually ran.

### P1 — verify end-to-end and tenant scope

5. **Command Center dashboard** (`ClientAdminDashboardPage.tsx`, `DashboardOpsWidgets.tsx`) calls alert and agent APIs and has unavailable states for those feeds. Validate tenant scoping of asset/compliance context, dashboard widgets, and persisted layout; avoid treating organization metadata as live telemetry.
6. **SOC Operations** has a substantive alert API surface (`/api/alerts`, detail, acknowledgement, bulk action, correlation, evidence, events, notes) and incident lifecycle API (`/api/incidents`). Test filters, detail drawer, assignment, transitions, evidence, notes, and audit history against a tenant with no data and against two isolated tenants.
7. **Assets & Infrastructure** has discovery scans, scan polling/cancel, discovered devices, import, SNMP credential CRUD/test, agent probes, inventory, metrics, and topology endpoints. Confirm the actual tenant authorization path for agent ingestion routes: the checked-in route inventory marks agent-token routes as `NONE`, which may be intentional machine-token auth but needs direct handler review, not a conclusion from the CSV.
8. **Security Services & Protection** has ten service pages and a shared `POST /api/security-ops/actions` / task surface. Audit every displayed action ID against the backend catalog and capability/connector state. Unsupported or unconfigured actions must return an explicit unsupported/configuration-required result, never a success-like dispatch.
9. **Threat Intelligence** should be checked for feed status, IOC lookup, matches, tenant-specific visibility, and source attribution using the existing threat-intel endpoints.
10. **Respond & Automate** has SOAR playbook CRUD, preview, run, runs, cancel and retry endpoints. Verify role gates, dry-run/execute semantics, dangerous-action approval, audit events and per-tenant isolation. Script and runbook screens require separate capability checks.
11. **MSSP & Service Management** includes tickets, approvals, evidence, escalation/workload, projects, entitlements, and technician/team pages. Verify ownership and org scoping for every list/detail/mutation.
12. **Governance & Reporting** includes compliance/report pages, report catalogue/export/refresh endpoints, value proof pack/receipt and audit logs. Confirm report contents are tenant-scoped and generated from real evidence.
13. **Client-scoped Platform Administration** currently exposes plans/subscription in the nine-group nav. Check actual tenant users, roles, settings and integrations access without exposing global admin operations.

## Backend route inventory caveat

The checked-in `docs/audit/routes.csv` is a snapshot, not a proof that every handler is implemented correctly. Its heuristic labels most routes `real` when the handler source does not obviously return a constant or raise NotImplementedError. It does not prove authorization correctness, tenant isolation, live connector configuration, or external-system success. Notable route row: `POST /api/integrations/{integration_id}/test` is classified `stub` by the CSV. Reconcile this against the current handler before deciding its actual behavior.

## Global Platform Admin — later phase, verify rather than rebuild

Existing global Platform Admin routes include Dashboard, Tenant Manager, Partner Program, Audit Log, Themes, Pack Customizer, Platform Settings, Integrations, Service Operations, and catalog-gated Onboarding. The source contains dedicated pages under `src/pages/platform/` and `src/pages/platform-admin/`. After Client Admin parity, audit these pages against organization, partner, user/role, integration, service catalog, jobs, monitoring, security/audit, plans and entitlements APIs. Keep global Platform Admin distinct from the client-scoped Platform Administration navigation group.

## Delivery sequence

1. Finish a page/action/API/authorization matrix for all nine Client Admin groups; use current source, not the stale CSV classifications.
2. Fix P0 truthfulness and persistence issues first (runbooks, Cloud Security, Endpoint Protection, action result provenance).
3. Complete SOC Operations and Assets & Infrastructure end-to-end tests.
4. Complete the ten Security Services & Protection pages against the backend action catalog and connector capabilities.
5. Complete Threat Intelligence, Respond & Automate, MSSP & Service Management, and Governance & Reporting.
6. Audit client-scoped administration, then separately audit Global Platform Admin and Partner Admin.
7. Run frontend build/typecheck, backend tests, route/catalog drift checks, and multi-tenant authorization regression tests.

## Explicit limitations

- This is a source-inspection baseline, not a runtime acceptance test.
- No live customer integrations, credentials, collector fleet, or external systems were available for verification.
- No UI route was declared complete solely because a component or backend route exists.
- No code was changed by this audit.
