# Platform Admin Functional Parity Baseline

Audit date: 2026-11-05  
Repository baseline: main after PR #58 merge, commit 96d6da67fbf1a2c2d3dd5879f227914bf60198f9.  
Scope: PA-01 read-only source inspection. No product code changed. Tests, build and runtime checks were not run.

## Executive findings

1. Frontend platform routes in src/App.tsx are nested under ProtectedRoute, which checks authentication only. There is no platform role/capability guard on the /admin routes.
2. backend/app/models.py documents User.role as platform_admin, client_admin and client_user. backend/app/core/security.py implements require_role as one exact role plus a platform_admin override. This is not granular permission-based authorization.
3. backend/app/routers/settings.py exposes GET and PUT /settings/system to any authenticated user. The PUT mutates a process-local dictionary, not durable settings storage.
4. GET /settings/overview in the same router returns all organization names, global rule counts and total users to any authenticated user.
5. src/pages/platform/PlatformDashboardPage.tsx imports demoOrganizations, demoUsers, demoAuditLog and serviceCatalog from mockData. Revenue, client/user counts, blocked attempts, client portfolio and recent activity are therefore fixture-driven; the MRR trend is fixed at +12%.
6. src/components/Layout.tsx conditionally displays Platform Admin navigation for platform_admin, but navigation visibility is not an authorization boundary.
7. backend/app/routers/audit.py protects the global audit endpoint with require_role("platform_admin"), demonstrating inconsistent enforcement between routers.

## Evidence and required remediation

### PA01-F01 — Platform route authorization
Evidence: src/App.tsx, ProtectedRoute and /admin route definitions.  
Finding: authenticated users pass the frontend route guard regardless of role.  
Remediation: add permission-aware route guards for user experience, while enforcing every permission on the backend.

### PA01-F02 — Missing platform RBAC
Evidence: backend/app/models.py User.role; backend/app/core/security.py require_role; src/context/AuthContext.tsx; src/components/Layout.tsx.  
Finding: Platform Expert, Platform Analyst and Platform User are not implemented as distinct platform roles. Existing role checks cannot represent granular capabilities, resource scopes, explicit approval rights or custom profiles.  
Remediation: implement canonical platform roles plus a default-deny permission engine. Keep platform roles separate from tenant roles.

### PA01-F03 — System settings authorization and persistence
Evidence: backend/app/routers/settings.py GET/PUT /settings/system.  
Finding: both endpoints require authentication only. PUT updates a module-level dictionary, which is not durable across restarts or multiple workers.  
Remediation: require explicit platform capabilities, persist settings transactionally and audit changes.

### PA01-F04 — Global metadata exposure
Evidence: backend/app/routers/settings.py GET /settings/overview.  
Finding: the endpoint queries all organizations and users and returns global metadata without a platform permission check or tenant scope.  
Remediation: restrict the global endpoint and provide separate tenant-scoped data where required.

### PA01-F05 — Demo-driven dashboard
Evidence: src/pages/platform/PlatformDashboardPage.tsx.  
Finding: dashboard metrics and portfolio/activity lists are sourced from demo fixtures, not live platform APIs.  
Remediation: use verified API/database metrics and explicit empty/unavailable states; never silently present fixtures as live data.

### PA01-F06 — Inconsistent backend authorization
Evidence: backend/app/core/security.py, backend/app/routers/settings.py and backend/app/routers/audit.py.  
Finding: audit uses require_role("platform_admin"), settings uses authentication-only dependencies for several endpoints, and the demo tenant endpoint uses a local role helper.  
Remediation: centralize permission checks and test all protected endpoints against all four platform roles and tenant scopes.

## Initial module inventory

| Area | Existing evidence | Initial status |
|---|---|---|
| Dashboard | src/pages/platform/PlatformDashboardPage.tsx | Exists; demo-driven |
| Routes/navigation | src/App.tsx; src/components/Layout.tsx | Exists; route guard is authentication-only |
| Tenants | PlatformClientsPage.tsx; TenantDetailPage.tsx; backend tenant_manager router | Exists; complete parity not yet verified |
| Partners | PlatformPartnersPage.tsx; backend partners_admin router | Exists; granular permission parity not yet verified |
| Audit | PlatformAuditPage.tsx; backend audit router | Exists; global endpoint restricted to platform_admin |
| Settings | PlatformSettingsPage.tsx; backend settings router | Exists; confirmed access and persistence gaps |
| Integrations/services/onboarding | Platform routes in src/App.tsx | Routes exist; workflow/API parity not yet verified |
| Billing/licensing | Existing pricing and organization billing code | Full global administration not yet accepted |
| Infrastructure/agents | Existing agent and discovery modules | Fleet governance and acknowledged execution need separate verification |

A route or page existing does not prove its actions are functional, persisted or correctly authorized.

## Four-role target

- platform_admin: Owner; full platform authority and exclusive permission administration.
- platform_expert: technical and operational actions explicitly granted by the Owner.
- platform_analyst: monitoring, investigation, reporting and read capabilities explicitly granted by the Owner.
- platform_user: restricted capabilities explicitly granted by the Owner.

The Owner must also be able to create custom permission profiles. Role names are defaults, not substitutes for permissions.

Minimum requirements: backend enforcement; default deny; tenant/partner/resource scopes; separate platform and tenant roles; separate initiate/approve/execute rights for sensitive operations; no self-elevation; session revocation; audit history; protection against accidental loss of Owner access.

## PA roadmap

1. PA-01: finish source audit and action-to-API parity matrix.
2. PA-02: backend roles, permission engine, resource scopes and authorization tests.
3. PA-03: Owner access-control UI, account lifecycle, custom profiles, session revocation and approval configuration.
4. PA-04: live Platform Dashboard.
5. PA-05: global Tenant and Organization Management.
6. PA-06: Subscription, Licensing and Billing.
7. PA-07: MSSP and Partner Governance.
8. PA-08: Global Infrastructure and Agent Fleet, including pickup/acknowledgement.
9. PA-09: Platform Security and Governance.
10. PA-10: Service Catalog, Business Intelligence and Global Platform Operations.

## Validation and limitations

Inspected: App routes, authentication context, shared layout/navigation, User model, security dependencies, settings router, audit router, dashboard and API router registration.

Tests/build/browser verification and database migration/runtime verification were not run. PA-01 remains open until the remaining page/API inventory and test evidence are recorded. No product code was changed in this audit.


## Extended page-to-API and data-source inventory

This extension inspects the major Platform Admin pages and the backend routers they call. It remains a source audit; endpoint behavior has not yet been exercised against a running database.

### PA01-F07 — Client Management is a mixed live/demo implementation

Evidence:
- `src/pages/platform/PlatformClientsPage.tsx` lines 4-9, 21-23, 39-102, 218-257.
- `src/services/api.ts` organization and tenant-manager clients.
- `backend/app/routers/organizations.py`.

Findings:
- The page loads real organizations through `organizationsApi.list()`, but merges them with `demoOrganizations` unconditionally.
- Entitlements are initialized from demo organizations and `toggleEntitlement` updates only local React state in the inspected page; it does not persist a grant.
- API keys, licenses, devices, members and tenant activity are derived from `demoWorld` fixtures. The fallback license expiry dates are hardcoded.
- Backend organization list/create/update/delete endpoints are protected by `require_role("platform_admin")`; organization detail uses `get_current_user` and requires separate scope review.
- **Risk:** the UI can combine real tenants with simulated related records, and some apparent administrative changes are only local state.
- **Required action:** make live backend data the only source in Live Mode; persist entitlement changes through tenant-manager grant endpoints; implement real APIs for keys/licenses/devices/members/activity or display explicit unavailable states.

### PA01-F08 — Tenant Detail has real summary/rules/grants but demo-only devices and members

Evidence:
- `src/pages/platform/TenantDetailPage.tsx` lines 14, 37, 123, 151, 182, 204-210, 268-287.
- `backend/app/routers/tenant_manager.py` lines 56-241.

Findings:
- Tenant summary, ticket creation, rules and service grants call tenant-manager APIs.
- The Devices tab and Members tab are populated directly from `demoDevices` and `demoTechnicians`.
- Tenant-manager summary, ticket, rules, grant and platform audit endpoints require `platform_admin` through `require_role`.
- **Risk:** tenant detail presents incomplete simulated device/member data alongside live summary and operational data.
- **Required action:** connect devices and members to tenant-scoped persisted endpoints; label unsupported data honestly; apply granular permissions to each read/write action.

### PA01-F09 — Partner management has a mixture of scoped partner access and platform-only controls

Evidence:
- `src/pages/platform/PlatformPartnersPage.tsx`.
- `backend/app/routers/partners.py`, `partners_admin.py`, `partners_ops.py`, `partners_commercial.py`, `partners_service.py`, `partners_team.py`, `partners_keys.py`, `partners_connectors.py`.

Findings:
- The main partner page calls `partnersApi.list()` and `partnersApi.stats()`, and mutation controls call the partner-admin API.
- Partner route handlers commonly use `get_current_user` and then enforce partner membership/resource ownership in `_resolve_partner`; this is useful resource scoping but does not distinguish Platform Expert, Analyst and User capabilities.
- Global partner stats and partner-admin mutation endpoints use `require_role("platform_admin")`.
- Partner-specific operational, commercial, reporting, team, API-key and connector endpoints often rely on authenticated partner/resource scope, with selected high-impact actions adding inline `platform_admin` checks.
- **Risk:** authentication and partner ownership are not sufficient to express the Owner-controlled platform role policy. The partner routers need a systematic endpoint/action permission matrix, not a blanket role replacement.
- **Required action:** preserve partner resource ownership checks, add capability checks per action, and separate platform-wide vendor administration from partner self-service. Explicitly review partner impersonation, offboarding, deal approvals, API keys, connector secrets and billing actions as sensitive operations.

### PA01-F10 — Global integrations endpoints are platform-admin-only, but no granular capabilities

Evidence: `backend/app/routers/integrations.py` lines 17-233; `src/pages/platform/PlatformIntegrationsPage.tsx`.

Finding:
- List, detail, create, update, test and delete endpoints all use `require_role("platform_admin")`.
- **Risk:** Expert permissions cannot be granted for approved technical integration tasks, and Analysts cannot receive read-only visibility without making them full platform admins.
- **Required action:** split integration read, configure, test and delete capabilities; protect secret-bearing operations and audit mutations.

### PA01-F11 — Pricing pack writes have inline platform-admin checks; other commercial endpoints need separate scoping review

Evidence: `backend/app/routers/pricing_v2.py` lines 802-890 and the broader pricing router.

Finding:
- Pack update/reset endpoints check `user.role == "platform_admin"` inline and persist entitlement rows; this is a stronger boundary than authentication alone.
- The same router contains lead, quote, partner deal, upgrade and billing-related endpoints using authenticated-user dependencies, with some operations adding inline platform-admin checks.
- **Risk:** commercial capabilities are not consistently represented by a centralized policy; individual handlers must be reviewed for actor/partner/tenant scope and approval requirements.
- **Required action:** map each commercial endpoint to view/create/edit/approve/export capabilities and enforce tenant/partner ownership plus explicit approval for vendor-level decisions.

### PA01-F12 — Agent token management has tenant scoping but no granular platform capability

Evidence: `backend/app/routers/agent.py` lines 25-110 and 446-536.

Finding:
- Token creation, listing and revocation use `get_current_user` and `_scope_org`; platform_admin may specify a tenant, while non-platform users are restricted to their own organization.
- Platform-wide token visibility and cross-tenant token operations are currently coupled to the single `platform_admin` role.
- Agent/probe telemetry routes authenticate using agent tokens and are a separate machine identity boundary.
- **Risk:** platform Experts cannot be granted controlled fleet/token operations independently, while Analyst read access is not expressible. Agent-token and machine-token permissions must not be conflated.
- **Required action:** define scoped capabilities for token issue/list/revoke and fleet visibility; keep agent-token authentication separate from human platform RBAC.

### PA01-F13 — System settings and legacy playbook endpoints require separate authorization review

Evidence: `backend/app/routers/settings.py` lines 58-205.

Finding:
- The earlier findings on `/settings/system` and `/settings/overview` are confirmed.
- Legacy playbook list/create/update/delete endpoints use authentication-only dependencies; the legacy run endpoint returns HTTP 410.
- **Risk:** authenticated users may reach global settings or legacy playbook mutation paths without a clearly enforced platform capability.
- **Required action:** explicitly retire or scope legacy routes, authorize settings reads/writes separately, and ensure current SOAR endpoints—not the legacy in-memory router—are the execution authority.

## Route/API inventory summary

| Platform surface | Frontend/data path | Backend evidence | Audit disposition |
|---|---|---|---|
| Dashboard | Direct imports from mockData | No verified live dashboard aggregation in the inspected page | Replace demo metrics with real API |
| Clients | organizationsApi + demoWorld | organizations + tenant_manager | Mixed live/demo; entitlements local-only |
| Tenant detail | tenantManagerApi + demoWorld | tenant_manager | Summary/rules/grants live; devices/members demo |
| Partners | partnersApi + partnersAdminApi | partners + partner subrouters | Resource-scoped but capability model absent |
| Audit | auditApi | audit /logs platform-admin; /logs/my-org tenant-scoped | Role-specific read policy needed |
| Integrations | integrations API | integrations router | All endpoints platform_admin-only |
| Services operations | tickets, alerts, analytics, settings overview, demo event action | tickets/notifications/settings and analytics routers | Separate operational read/action permissions; demo event action must remain explicitly demo-only |
| Settings | settingsApi + tenantManagerApi platform audit | settings + tenant_manager | Global settings/overview auth and persistence gaps |
| Agent fleet/tokens | agentApi and discovery surfaces | agent router and discovery-related routers | Tenant scoping exists; platform capability model absent |
| Pricing/pack customization | pricingPacksApi and pricing pages | pricing_v2 | Pack mutation inline platform-admin; wider commercial endpoint audit needed |
| Onboarding | PlatformOnboardingPage | API feature-flagged path | Verify exact enabled behavior and endpoint permission before acceptance |

## Remaining PA-01 checklist

The source audit is substantially expanded but **PA-01 is not complete yet**. Still required:

1. Inspect every remaining Platform Admin route/page and all buttons/forms, including themes, pack customizer, onboarding, service operations, and any hidden/feature-flagged screens.
2. Trace each frontend API method to the exact backend endpoint and record HTTP method, auth dependency, resource scope, persistence and audit behavior.
3. Inspect all registered routers for platform-wide endpoints that are reachable by authenticated tenant/partner users, not only the pages linked in navigation.
4. Inspect demo-mode handlers alongside live handlers to ensure the UI does not imply that demo-only actions are production capabilities.
5. Inspect schema/migrations and existing tests for platform users, account lifecycle, settings persistence, role enforcement and audit trails.
6. Run focused backend/frontend tests and builds where the repository environment allows; record exact commands and outcomes. Do not infer test success from a green documentation-only PR.
7. Produce a final action-to-endpoint matrix with a disposition for every platform UI action.

No authorization or product behavior should be changed as part of this audit-only extension. The confirmed security defects should be fixed in PA-02, with any emergency security fix separately reviewed if the repository owner wants it prioritized.


### PA01-F14 — Checked-in route/page inventories are stale or contradictory to source

Evidence: `docs/audit/pages.csv`, `docs/audit/routes.csv`, compared with current source files inspected on `main`.

Findings:
- `pages.csv` marks the Platform Dashboard as having no API import and a demo-world dependency; direct source inspection confirms it imports demo fixtures and has no live dashboard API client.
- `pages.csv` marks the theme page as having no API and no demo-world source; source inspection shows it applies themes through the local ThemeContext and browser event/local preference behavior. It is not a persisted organization-wide platform default setting.
- `routes.csv` records multiple Platform Admin endpoint auth dependencies as `current_user`, while current source for tenant_manager and integrations uses `require_role("platform_admin")`. The CSV therefore cannot be trusted as the sole authorization inventory.
- The route inventory lists `/api/settings/system` and `/api/settings/overview` as authenticated-user endpoints, consistent with the confirmed security issue.
- **Risk:** implementation planning based on these generated/maintained CSVs can miss security boundaries and misstate live/demo behavior.
- **Required action:** regenerate or reconcile the route and page inventories from current source, and add a CI check or documented regeneration procedure so they do not silently drift.

### PA01-F15 — Theme controls are local user preferences, not a persisted global platform default

Evidence: `src/pages/platform-admin/InfracentraThemesPage.tsx`; source lines show `useTheme()`, `setTheme()`, a browser event listener for `infracentra-theme-default-changed`, and direct calls to `setTheme`.

Finding:
- The page's theme selector applies a theme through the current frontend ThemeContext. The inspected page does not call a backend settings API.
- **Risk:** the Owner may believe they are setting a platform-wide default when the inspected behavior is local to the current frontend context/browser.
- **Required action:** distinguish personal preview/preference from organization/platform default. Persist a true global default server-side, audit changes and define whether it applies to all users or only new sessions.

### PA01-F16 — Platform onboarding is explicitly feature-flagged and may be unavailable

Evidence: `src/pages/platform-admin/PlatformOnboardingPage.tsx`.

Finding:
- The page calls `/platform/services/{service_id}/first-success` and `/platform/lifecycle`.
- Its own comments and empty state state that the backend catalog may be disabled when `PLATFORM_CATALOG_ENABLED=false`, resulting in 404.
- **Risk:** a route existing in the frontend does not mean the platform catalog lifecycle is enabled or operational in the target environment.
- **Required action:** verify deployment flag, backend router registration, persistence and role permissions. If disabled, label it as unavailable rather than presenting it as an operational feature.

### PA01-F17 — Pack customizer UI loads defaults before server response

Evidence: `src/pages/platform-admin/PackCustomizerPage.tsx`; `backend/app/routers/pricing_v2.py` `GET /packs`, `PUT /packs/{pack_id}`, `POST /packs/reset`.

Finding:
- The page initializes its pack state from shipped defaults, then loads pricing config and pack definitions asynchronously.
- Backend update/reset handlers enforce `platform_admin` inline and persist entitlement rows, but the live config also uses a module-level `_live_config` structure and a persistence helper. Runtime restart/multi-worker consistency needs verification.
- **Risk:** transient UI state can look like live configuration before the server response; in-memory effective configuration and database entitlement rows may diverge if persistence/rehydration is incomplete.
- **Required action:** keep save/reset disabled until the authoritative load succeeds; verify startup rehydration and multi-worker consistency; audit every change.

### PA01-F18 — Services Operations mixes live monitoring with an explicit demo-ingestion action

Evidence: `src/pages/platform/PlatformServicesOverviewPage.tsx`.

Finding:
- The page polls tickets, alerts, dead-letter notifications and alert analytics through API clients and loads tenant choices from `settingsApi.overview()`.
- It also exposes a clearly labeled "Demo Mode: simulate an alert feed" action that pushes sample events through the ingestion pipeline; the UI disables this action unless `user.role === "platform_admin"`.
- **Risk:** the monitoring view depends on the under-authorized global settings overview endpoint; the demo ingestion action is a production side effect even though it is explicitly labeled as sample data.
- **Required action:** protect tenant metadata through platform capability and scope checks; require a dedicated demo-data permission and explicit environment/demo-mode gate for sample event injection; ensure it cannot be mistaken for customer telemetry.

## Further audit of existing route inventory and implementation status

The checked-in `docs/audit/routes.csv` is a useful starting list of registered routes, but its `auth` column is not reliable enough to prove the live dependency because several rows disagree with the actual handler source. The `pages.csv` similarly provides a navigation/data-source index, not proof of behavior. PA-01 acceptance must use the actual route handler and frontend action source as its authority.

## PA-01 status after extended inspection

Completed in this source pass:
- Major Platform Admin page set reviewed: dashboard, clients, tenant detail, partners, audit, integrations, service operations, settings, themes, pack customizer and onboarding.
- Primary related routers reviewed: organizations, tenant_manager, partners and its operational/commercial/service/team/key/connector subrouters, integrations, settings, audit, pricing_v2 and agent.
- Demo/live mixing and several endpoint authorization patterns recorded.
- Existing CSV inventories compared against source and found to need reconciliation.

Still open before PA-01 acceptance:
1. Complete handler-level review of every platform-facing route in the registered backend routers, including the security-sensitive partner, billing, user, notification and service actions not fully traced above.
2. Verify exact frontend API method to endpoint mapping for every Platform Admin button/form, including all tabs and dialogs.
3. Inspect model/migration definitions for User, sessions, platform settings, permission-related records (if any), audit, organization billing and agent lifecycle.
4. Inspect relevant existing tests and identify missing test coverage for direct API access by all four target roles.
5. Run backend tests, frontend tests, lint/typecheck and production build in a real checkout/CI environment; capture exact outcomes.
6. Finalize a complete permission matrix (capability × HTTP endpoint × resource scope × approval × audit) as the input to PA-02.

**PA-01 remains open.** The green checks on the documentation PR validate the documentation change only; they do not establish that runtime tests or all audit tasks have passed. No product behavior has been changed in this audit branch.
