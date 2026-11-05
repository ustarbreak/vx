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
