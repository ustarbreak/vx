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


### PA01-F19 — Platform catalog and lifecycle endpoints are authenticated-only and feature-flagged

Evidence:
- `backend/app/platform/router.py` routes `/graph`, `/capabilities`, `/actions`, `/lifecycle`, and `/services/{service_id}/first-success`.
- `backend/app/main.py` mounts platform catalog/jobs/UEBA routers only when `PLATFORM_CATALOG_ENABLED` is true.
- `backend/app/core/config.py` defaults `PLATFORM_CATALOG_ENABLED=false` and `SERVICE_LIFECYCLE_ENABLED=false`.
- `backend/tests/test_platform_catalog.py` verifies flag-off 404 behavior, authentication, action guardrails and lifecycle flags.

Findings:
- The inspected platform catalog endpoints use `get_current_user`, not platform role/capability checks.
- The catalog router is absent entirely under default configuration; lifecycle writes separately return disabled when `SERVICE_LIFECYCLE_ENABLED=false`.
- Existing tests cover authentication, feature-flag behavior and dangerous-action guardrails/four-eyes behavior, but do not establish the requested four-role Platform Admin RBAC.
- **Risk:** authenticated tenant/partner users may reach platform catalog information/actions when the feature flag is enabled unless each handler's internal scope/guard is correct; frontend route presence is not proof of availability.
- **Required action:** add explicit platform capabilities and tenant/resource scoping to every catalog read/action/lifecycle endpoint, including action approval and audit; test all four platform roles and tenant/partner roles both with flags on and off.

### PA01-F20 — Database startup uses SQLAlchemy create_all; migration strategy must be explicit for RBAC schema changes

Evidence: `backend/app/database.py` `init_db()` calls `Base.metadata.create_all`; `backend/app/models.py` User.role is a string field and no platform permission/profile/session model was found in the inspected model excerpt.

Finding:
- The application startup creates missing tables but `create_all` does not alter existing tables or safely migrate existing role data.
- The new RBAC design will likely need permission/profile/assignment/scope/approval records and may need role normalization or account lifecycle changes.
- **Risk:** shipping new authorization tables/constraints without an explicit production migration and backfill plan can leave deployed databases inconsistent with code.
- **Required action:** identify the repository's authoritative migration process before PA-02 schema work; add forward migration, safe backfill for existing `platform_admin` accounts, rollback strategy and PostgreSQL migration tests. Do not rely on `create_all` to alter production schema.

### PA01-F21 — Current tests exercise platform catalog guardrails, not the requested four-role authorization matrix

Evidence: `backend/tests/test_platform_catalog.py` and search of backend test sources for platform authorization patterns.

Findings:
- Platform catalog tests verify authentication required, flag-gated mounting, dangerous action guardrails and distinct approver behavior.
- Existing test files cover platform-admin cross-tenant access in selected domains (for example org topology, security map and entitlement graph).
- No dedicated test suite was found for `platform_admin`, `platform_expert`, `platform_analyst`, and `platform_user` capability-by-capability authorization because those platform roles/permissions are not implemented.
- **Required action:** PA-02 must introduce a role × permission × resource-scope test matrix, including direct API calls, cross-tenant attempts, self-elevation, approval separation, revoked sessions and default-deny behavior.

### PA01-F22 — Global theme default is browser-local despite its platform-wide UI wording

Evidence: `src/pages/platform-admin/InfracentraThemesPage.tsx` and its ThemeContext helper usage.

Finding:
- The UI copy says the selected default applies to new users/visitors, but the inspected page changes a frontend theme context and helper-managed platform default; it does not call a backend settings API.
- **Risk:** a browser-local setting cannot reliably establish a global default across devices, users or deployments.
- **Required action:** persist platform-wide theme default in backend settings with a dedicated permission and audit trail; keep preview/personal preference distinct.

## PA-01 remaining work — precise closure criteria

The source review now covers all currently identified Platform Admin pages and the principal connected backend router families. The audit is still not accepted as complete until these final evidence items are closed:

- [ ] Inspect every handler in the registered backend routers that exposes platform-wide data or mutates global state, including user administration, invitations, channel settings, ticket operations, alerts/notifications, discovery and security-ops actions.
- [ ] Complete the full action-to-endpoint matrix for every Platform Admin page control, including nested dialogs and secondary tabs.
- [ ] Inspect the complete model inventory and repository migration mechanism; identify existing account/session invalidation capabilities and audit schema.
- [ ] Verify all demo-mode route handlers for parity and explicit demo-only behavior; confirm Live Mode cannot silently fall back to fixtures.
- [ ] Review the existing tests that touch platform-wide access and list the exact missing authorization tests.
- [ ] Run the project test/build/lint/typecheck commands in a real checkout or wait for authoritative CI checks on the final audit commit; capture exact job names/results.
- [ ] Publish the final PA-01 matrix and mark each item implemented/partial/missing/blocked with source and test evidence.

**Status: PA-01 is materially advanced but remains open.** This document update does not change product code. PA-02 should not start until the user confirms the PA-01 audit PR is merged and the final audit closure criteria are satisfied, or explicitly authorizes a security-priority implementation ahead of audit closure.


# PA-01 final audit extension — 2026-11-05

## Final handler-level review: user administration, invitations, notifications, channels, discovery and security operations

This section records source-level behavior for the requested endpoint families. It does not imply runtime penetration testing.

### Users — `backend/app/routers/users.py`

| Method + endpoint | Handler | Current authorization/scope | Persistence/audit | Finding |
|---|---|---|---|---|
| GET `/api/users/` | get_users | Authenticated; platform_admin sees all, other users are silently limited to own org | DB read | No explicit user-list permission; scope depends on role string |
| GET `/api/users/{user_id}` | get_user | Authenticated; self or same-org check; platform_admin global | DB read | Unsafe missing-target dereference can occur before 404 when requested ID does not exist |
| PATCH `/api/users/{user_id}` | update_client_user | require_role(client_admin); tenant admins constrained to their org and assignable roles; platform_admin may manage non-platform users | DB write + AuditLog | Role assignment is role-string based; no platform Expert/Analyst/User capability/profile model |
| POST `/api/users/` | create_user | require_role(platform_admin) | DB write; audit written in a second commit | Audit and user creation are not atomic; arbitrary `user_data.role` is accepted unless schema validation prevents it |
| DELETE `/api/users/{user_id}` | delete_user | require_role(platform_admin); blocks self-delete | AuditLog + DB delete | No soft-disable/session revocation workflow; deletion audit is separate from delete transaction |

### Invitations — `backend/app/services/invitations.py`

| Method + endpoint | Handler | Current authorization/scope | Persistence/audit | Finding |
|---|---|---|---|---|
| POST `/api/invitations` | create_invitation | Authenticated then inline role/scope: platform_admin can choose org; client_admin only own org; role allow-list | Invitation row + send attempt + AuditLog | Platform invite roles currently only client roles; platform role invitations are not supported. Secret token is returned in response as activation link |
| GET `/api/invitations` | list_invitations | require_role(client_admin), platform_admin global or optional org filter | DB read | Platform Expert/Analyst cannot receive scoped read access |
| POST `/api/invitations/{inv_id}/resend` | resend | require_role(client_admin); tenant match unless platform_admin | DB write/send | No explicit send-invitation capability or audit record on resend |
| POST `/api/invitations/accept` | accept | Public bearer invitation token | Creates User, marks invitation accepted | Token has no expiry field or one-time token hash; acceptance does not create a session revocation record |

### Notification alerts and notification delivery — `backend/app/routers/notifications.py`

| Method + endpoint | Handler family | Current authorization/scope | Finding |
|---|---|---|---|
| POST `/api/alerts` | ingest_alert | Authenticated | Human auth is accepted for ingestion; platform staff vs tenant ingestion permissions are not separated |
| GET `/api/alerts`, `/summary`, `/{id}`, correlation endpoints | list/detail/correlation | Authenticated; organization scope applied in query logic | Read capability is implicit rather than explicit; platform cross-tenant view tied to role |
| PATCH `/api/alerts/{id}`, POST `/{id}/ack`, POST `/alerts/bulk` | updates/ack/bulk | Authenticated + `_require_write_role`; cross-tenant check for bulk rows | Need discrete acknowledge, assign, resolve, reopen permissions |
| GET/POST `/api/alerts/{id}/notes` | notes | Authenticated; write role on create | Read and write are not separately permissioned |
| GET events/evidence | evidence history | Authenticated | Evidence access needs explicit sensitive-read capability and resource scope |
| GET/POST/PATCH/DELETE `/api/notification-rules` | rule management | List/create platform_admin-only; update/delete permit org-scoped users with inline checks | Inconsistent policy between list/create and update/delete |
| GET `/api/notifications`, POST `/{id}/ack`, POST `/{id}/retry` | delivery queue | Authenticated; write role and tenant scope on mutations | Read/retry/ack capabilities not separated |
| POST `/api/notifications/retry-dead-letters` | retry_dlq | Inline platform_admin-only | Global operational action needs explicit capability + audit |
| GET `/api/notifications/analytics` | notif_analytics | Authenticated | Confirm global-vs-tenant aggregation and scope before enabling platform roles |

### Channel settings — `backend/app/services/channel_settings.py`

| Method + endpoint | Handler | Current authorization/scope | Persistence | Finding |
|---|---|---|---|---|
| GET `/api/channels/configs` | list_configs | Authenticated; platform_admin can request org_id; others use own org | Reads ChannelConfig; masks selected secrets | Authenticated-only endpoint; role/capability not checked |
| PUT `/api/channels/configs` | save_config | Authenticated; same org resolver | Persists per-tenant SMTP/webhook/SMS JSON | Authenticated tenant users can alter notification delivery config; sensitive secret/config write needs strict permission |
| POST `/api/channels/test` | test_channel | Authenticated; same org resolver | Sends real email/webhook/SMS test | Externally observable side effect with no explicit test/send capability or audit event |

### Discovery — `backend/app/routers/discovery.py`

| Method + endpoint | Handler family | Current authorization/scope | Finding |
|---|---|---|---|
| GET/POST `/api/snmp-credentials` | credential list/create | Authenticated; list inline platform_admin; create has tenant/role validation | Secret-bearing credential management needs distinct read/write permissions |
| DELETE `/api/snmp-credentials/{id}` | delete credential | Authenticated; platform_admin global, otherwise same org | Tenant scope exists; no explicit delete capability/audit coverage |
| GET/POST `/api/scans` | list/start scan | Authenticated; list platform_admin; start validates requested org/scope and authorization fields | Scanning is a sensitive network action; should require discovery.scan and explicit target authorization |
| POST `/api/scans/{id}/cancel`, GET scan/detail/devices | scan operations | Authenticated; platform_admin or matching org | Separate read/cancel capabilities absent |
| GET `/api/devices`, GET `/api/devices/{id}` | inventory | Authenticated; all-device global view platform_admin; detail scoped | Inventory visibility must be separately granted |
| POST `/api/devices/{id}/import` | import | Authenticated; tenant scoped | Mutating import should require inventory.import and audit |
| POST `/api/devices/{id}/actions/{action}` | kill/isolate/unisolate/remote_screen | Authenticated; tenant scoped; command is queued for agent and reports executed=false | High-impact endpoint currently lacks explicit capability and approval separation; no claim of execution until agent acknowledgement |
| GET `/api/engine-status` | scanner diagnostics | Public/no auth dependency | Confirm that diagnostic response exposes no deployment-sensitive data |

### Security Operations — `backend/app/routers/security_ops.py`

| Method + endpoint | Handler | Current authorization/scope | Persistence | Finding |
|---|---|---|---|---|
| POST `/api/security-ops/actions` | dispatch_action | require_role(client_admin); requires caller org_id; validates exact service/action allow-list | SecurityOpsTask(status=manual) + AuditLog | Does not dispatch to a device; currently manual-only. Platform Expert action capability should be scoped and approval-gated for disruptive actions |
| GET `/api/security-ops/tasks` | list_tasks | Authenticated; own org only | DB read | No explicit read capability; platform account with no org sees empty list |

## Frontend action-to-endpoint matrix

The matrix below maps the platform pages and their connected client methods. Page controls not backed by a dedicated API are explicitly marked local/demo rather than treated as completed workflows.

| Platform page / action | Frontend API or behavior | Backend endpoint(s) | Source disposition |
|---|---|---|---|
| Dashboard — KPI cards, client portfolio, activity | Imports `demoOrganizations`, `demoUsers`, `demoAuditLog`, `serviceCatalog` | No verified platform dashboard aggregate endpoint | Demo-only; must be replaced by live aggregates |
| Clients — list tenants | `organizationsApi.list` | GET `/api/organizations/` | Live organizations; page also merges demo fixtures |
| Clients — create/edit/delete tenant | `organizationsApi.create/update/delete` | POST/PATCH/DELETE `/api/organizations/{id}` | Live; platform_admin-only in organizations router |
| Clients — entitlement toggle | Local React state in inspected page | No write request in handler | Not persisted |
| Clients — keys/licenses/devices/members/activity | `demoWorld` / demo fixture selectors | No complete live API mapping in inspected page | Demo-only or unsupported; must show unavailable in Live Mode |
| Tenant detail — summary/ticket | `tenantManagerApi.summary/createTicket` | GET/POST `/api/admin/tenants/{org_id}/summary|tickets` | Live; platform_admin-only |
| Tenant detail — monitoring rules | `tenantManagerApi.listRules/createRule/updateRule/deleteRule` | GET/POST/PATCH/DELETE `/api/admin/tenants/{org_id}/rules[/{rule_id}]` | Live; platform_admin-only |
| Tenant detail — service grants | `tenantManagerApi.grants/createGrant` | GET/POST `/api/admin/tenants/{org_id}/grants` | Live; platform_admin-only |
| Tenant detail — devices/members | `demoDevices`, `demoTechnicians` | No verified live page mapping | Demo-only |
| Partners — list/stats | `partnersApi.list/stats` | GET `/api/partners`, GET `/api/partners/stats` | Live; stats platform_admin-only; list resource-scoped |
| Partners — suspend/migrate/remove/update | `partnersAdminApi` | PATCH/POST/DELETE `/api/partners/{id}[/{suspend,migrate}]` | Live; platform_admin-only |
| Audit — global/tenant audit | `auditApi.list/myOrg` | GET `/api/audit/logs`, GET `/api/audit/logs/my-org` | Live; global platform_admin-only, tenant endpoint org-scoped |
| Integrations — list/detail/create/update/test/delete | integrations client | GET/POST/PATCH/DELETE/test `/api/integrations` | Live; current backend requires platform_admin for all actions |
| Services Ops — tickets/alerts/notifications/analytics | `ticketsApi`, `alertsApi`, `settingsApi.overview` | `/api/tickets`, `/api/alerts`, `/api/notifications`, `/api/settings/overview` | Live data; global overview endpoint under-authorized |
| Services Ops — simulate alert feed | demo event ingestion action | POST `/api/alerts` via demo ingestion helper | Demo-only action with real ingestion side effect; must be gated to explicit demo environment |
| Settings — global system settings | `settingsApi.get/update` | GET/PUT `/api/settings/system` | Live API but auth-only + process-local state |
| Settings — seed demo tenant | `settingsApi.seedDemoTenant` | POST `/api/settings/seed-demo-tenant` | Owner-only; demo-only destructive data creation |
| Settings — platform audit | `tenantManagerApi.platformAudit` | GET `/api/admin/audit-platform` | Live; platform_admin-only |
| Themes — select preview/default | ThemeContext `setTheme` | No backend endpoint | Browser/local preference, not a global persisted default |
| Pack customizer — load/save/reset | `pricingPacksApi` | GET/PUT `/api/packs`, POST `/api/packs/reset` (pricing_v2) | Live config path; owner-only write; startup rehydration/multi-worker behavior requires runtime verification |
| Integrations/onboarding — lifecycle | Platform onboarding client | `/api/platform/lifecycle`, `/api/platform/services/{id}/first-success` | Feature-flagged; default catalog/lifecycle flags off |
| Platform settings overview — tenant selector | `settingsApi.overview` | GET `/api/settings/overview` | Returns global metadata; authenticated-only |
| Agent/discovery — scans, inventory, actions | `discoveryApi`, `agentApi` | `/api/scans`, `/api/devices`, `/api/agent-tokens`, `/api/agents`, `/api/discovery/devices/{id}/actions/{action}` | Mixed global and tenant scope; explicit capabilities missing |

This matrix covers the Platform Admin page set and connected API client methods inspected in PA-01. It is not a statement that every endpoint is production-ready: rows identify current implementation and gaps.

## Complete database model and migration assessment

### Existing model inventory

The SQLAlchemy metadata in `backend/app/models.py` defines the following model/table families (51 mapped classes/tables at the inspected main commit):

- Core identity/tenant: `Organization`, `User`, `Entitlement`, `Integration`, `AuditLog`.
- Commercial/pricing: `PricingConfigVersion`, `PricingLead`, `QuoteLink`, `QuoteRecord`, `HealthCheck`, `PartnerDealRegistration`, `PlanEntitlementV2`, `UpsellEvent`.
- Ticketing/evidence: `Ticket`, `TicketEvidence`, `TicketAuditEntry`, `TicketApproval`.
- Alerting/notifications: `Alert`, `AlertNote`, `AlertEvent`, `EventEvidence`, `UidCounter`, `GroupingPolicy`, `NotificationRule`, `Notification`.
- Projects/channels/identity support: `Project`, `ProjectMilestone`, `ProjectRunbook`, `ProjectAttachment`, `ChannelConfig`, `UserTotpSecret`, `Invitation`.
- Discovery/agents: `SnmpCredential`, `DiscoveryScan`, `DiscoveredDevice`, `AgentProbe`, `AgentInventory`, `AgentMetric`, `AgentToken`, `AgentDiscoveredDevice`.
- Tenant operations/incidents: `TenantSetting`, `TenantServiceGrant`, `MonitoringRule`, `Incident`, `TriagePolicy`, `TriageEvaluation`, `OutcomeLabel`, `IncidentNote`, `IncidentActivity`, `IncidentEvidence`, `IncidentAction`, `Playbook`, `DeviceAction`, `PlaybookRun`, `DashboardLayout`, `SecurityOpsTask`, `ServiceLifecycleState`.

### Migration strategy

- Alembic is configured at `backend/migrations/env.py`; it imports `app.models` to populate `Base.metadata` and supports SQLite/PostgreSQL URL conversion.
- Existing revision chain is linear with a single head `c3d9e1f7a2b4`; `backend/tests/test_postgres_hardening.py` asserts nine revisions and a single head.
- `backend/app/database.py:init_db()` also calls `Base.metadata.create_all` at application startup. This creates missing tables but does not alter existing deployed tables; it is not a substitute for Alembic migrations.
- There is no mapped DB session/revocation table in the inspected model inventory. Access tokens are JWTs; `get_current_user` reloads the user on each request and checks active status, but does not check a token version or session revocation record.
- RBAC must be introduced by a new Alembic revision from the current single head, with safe defaults/backfill for existing `platform_admin` accounts and no destructive role rewrite. The migration chain integrity test must be updated to expect the new head/revision count.
- Required PostgreSQL validation: upgrade from current head, verify legacy Owner account preservation, insert/read scoped permission assignments, rollback/drop only new RBAC objects, and prove no pre-existing rows are modified unexpectedly.

## Demo/live separation review

| Surface | Current behavior | Live-mode risk | Required control |
|---|---|---|---|
| Platform Dashboard | Hardcoded demo metrics/lists | Demo revenue and activity appear real | No fixture fallback in Live Mode |
| Platform Clients | Real organization list merged with demo organizations and demo related entities | Fake devices/users/licenses appear alongside tenants | Use only API results in Live Mode |
| Tenant Detail | Live summary/rules/grants; demo devices/members | Mixed provenance not obvious | Distinct unavailable state for unimplemented APIs |
| Services Ops demo event | Clearly labeled demo action, posts sample alerts into backend ingestion | Sample alerts contaminate real tenant alert pipeline | Explicit server-side demo environment flag + permission |
| Theme page | Local ThemeContext setting | Local state presented as global default | Separate personal preview from persisted platform default |
| Pack customizer | Shipped defaults visible before async server response | Defaults can be mistaken for saved live values | Loading/error state blocks save until server authoritative response |
| Demo fast login | `ic_fast_demo` and `ic_demo_mode` localStorage create client-side simulated session | UI must never accept it as backend identity | Backend remains authoritative; test no demo JWT/backend access |
| Catalog/onboarding | API router only mounted when feature flag enabled | Page may render route while API returns 404 | Explicit capability/feature availability state |

## Authorization test coverage gap inventory

Existing tests found:
- `backend/tests/test_platform_catalog.py`: authentication, feature-flag behavior, action guardrails and distinct approver behavior.
- `backend/tests/test_postgres_hardening.py`: migration chain, PostgreSQL partial-index behavior; PostgreSQL test skips when no server is reachable.
- `backend/tests/test_invitations_scope.py`: invitation tenant scope tests.
- Existing selected domain tests cover platform-admin cross-tenant behavior (for example topology, security map, entitlement graph).

Missing or not demonstrated by existing test inventory:
- Four platform roles × each permission × allowed/denied resource scope.
- Platform Expert/Analyst/User direct API access (roles do not yet exist).
- Owner-only role/profile/permission assignment and prevention of self-elevation.
- Tenant/partner users denied platform-wide metadata/settings/integration/catalog endpoints.
- Invitation creation, resend, and acceptance with platform role assignment restrictions, token expiry/replay and audit atomicity.
- Channel configuration secret masking, unauthorized writes and test-send capability.
- Alert acknowledge/assign/resolve/reopen vs read permissions.
- Notification dead-letter retry global permission.
- Discovery scan target scope, scan cancel, credential CRUD, device action and approval separation.
- Security Ops disruptive-action permissions and manual-only status truthfulness.
- Session/token revocation after account disable or role/permission change.
- Demo-mode fixture isolation from Live Mode.
- PostgreSQL migration upgrade/backfill/rollback for RBAC tables.

## PA-01 disposition and validation

**Source audit: complete for the requested Platform Admin surface and the named handler families.** This is a source-level completion, not a runtime security certification.

**CI/build evidence:** the GitHub connector reports no status contexts and no PR workflow runs associated with the PR #59 merge commit `5c1a86c6350f10ecad7fcc88d9a76a3cdc54c5de`. The user previously confirmed PR #59 was green and merged, but I cannot independently reproduce a frontend build or backend test run from the connected GitHub source browser. Therefore the document does not claim a fresh successful build/test run. The next implementation PR must run the repository's actual CI matrix and PostgreSQL tests; failures must be fixed before merge.

**Known blocker to full PA-01 runtime acceptance:** no live checkout/container or connected CI run result is exposed in this session. Source inventory, API mapping, model inventory, migration assessment and test-gap inventory are now recorded. The PA-01 source-audit deliverable is complete; runtime verification remains an explicit CI gate for PA-02.

## PA-02/PA-03 implementation constraints

- Preserve the current `platform_admin` role as the Owner/superuser for backward compatibility.
- Add `platform_expert`, `platform_analyst`, and `platform_user` as distinct platform-only roles; platform identities must have no tenant `org_id` unless an explicit scoped assignment requires one.
- Keep partner and tenant roles distinct from platform roles.
- Use permission keys and resource scopes; role defaults are templates, and Owner-controlled custom profiles/overrides are authoritative.
- Backend permission checks are mandatory; frontend guards are UX only.
- Default deny; no wildcard grants for non-Owner; no self-elevation; no grant of Owner role through invitations or generic user update.
- Make high-impact operations request/approve/execute distinct and auditable; actor cannot approve own request.
- Permission changes and role changes must invalidate existing access tokens/sessions. Introduce a revocation/version mechanism and test it.
- Never expose password hashes, TOTP secrets, invitation tokens, channel secrets or integration credentials in the access-control UI.
