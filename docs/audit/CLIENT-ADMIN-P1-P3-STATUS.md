# Client Admin P1–P3 implementation slice

Audit basis: source at PR #33 head `94972a8f5a54993ea1dc31c21912840c38325839`.  
Branch is intentionally stacked on `client-admin/p0-live-data-truthfulness`; merge PR #33 before this branch.

## Changes in this slice

### 1. Shared service-feed safety boundary
Updated `src/hooks/useLiveFeed.ts`:
- Demo Mode still returns `null`, allowing the page's clearly designated demo fixtures.
- Live Mode returns actual records, including an empty array when the connector is unavailable, unconfigured, or has no records.
- This is deliberately compatible with existing pages that use `if (live) { ...; return; }`: an empty array is truthy in JavaScript, so those pages stop before their legacy fixture fallback.
- This prevents fabricated service records from being shown as live customer telemetry across pages using this helper, including vulnerability scanning, email security, firewall, DNS filtering, backup/DR, patch management, SD-WAN and VPN.

Important: this is a safety boundary, not proof that any connector is configured or that the service is operational. A page may still need a clearer empty/unavailable banner and service-specific data mapping.

### 2. Client-scoped user directory
Updated `src/pages/client-admin/ClientUsersPage.tsx`:
- Replaced local `demoUsers` filtering with `usersDirectoryApi.list()`.
- Relies on the backend's authenticated-user tenant scope; does not send a browser-selected org ID.
- Shows explicit loading, error and empty states, plus backend-returned role, status, MFA, last-login and creation values.
- Removed the inert Invite User control. The inspected backend only permits create/delete user operations to Platform Admin, so the Client Admin page is explicitly read-only rather than presenting a non-working invitation action.

## P1/P2/P3 verification map and remaining blockers

| Area | Evidence from source inspection | Status / next work |
|---|---|---|
| Command Center | Uses alert summary, agent probes, organization asset/compliance fields and widget board | Verify KPI provenance and tenant-scoped widget persistence in runtime; organization metadata is not live telemetry |
| SOC Operations | Alert API has server-side filters, detail, optimistic version update, notes and bulk actions | Run two-tenant isolation and lifecycle tests against PostgreSQL; not runtime-verified here |
| Assets & Infrastructure | Agent-token CRUD and probe data APIs exist; agent handlers scope probe lookup to token org | Exercise cross-tenant token/probe attempts and discovery import/scan cancellation against PostgreSQL |
| Security Services | Shared live-feed helper protects pages that use it; ten service pages expose action catalogs | Compare every action ID with backend catalog/capabilities; do not equate queued job with device execution |
| Threat Intelligence | Existing backend route surface is present in route inventory | Verify provider configuration, IOC provenance, tenant visibility and empty/error states |
| Respond & Automate | SOAR playbook endpoints exist; runbooks lack a confirmed persistence/execution API | Test dry-run, approval, cancel/retry and audit trail; runbooks remain read-only in Live Mode until APIs exist |
| MSSP & Service Management | Ticketing, approvals, evidence, projects and entitlements API surfaces exist | Verify owner/org scoping for every detail and mutation; exercise SLA and escalation transitions |
| Governance & Reporting | Compliance/report, audit and value proof-pack surfaces exist | Validate report source records and tenant scoping; no report should claim immutable/continuous monitoring without backend evidence |
| Client-scoped administration | User directory GET is tenant scoped; backend create/delete user routes are Platform Admin only | User list now reads from backend and is read-only; tenant role/settings/integration mutation needs explicit client-admin backend endpoints |
| Global Platform Admin / Partner Admin | Separate route/page families exist | Not included in this Client Admin slice; audit and implement as separate workstreams |

## Explicitly not claimed complete

- No end-to-end runtime tests were run against a populated PostgreSQL database or two real tenants.
- No customer integrations, agent fleet, cloud accounts, EDR, firewall, backup or email provider credentials were available.
- This change does not implement missing connector adapters, runbook persistence/execution, or client-admin user invitation/role-management endpoints.
- A green frontend build or backend test suite cannot by itself prove tenant isolation or real external action execution.

## Validation plan

CI must run frontend install/typecheck/build and backend tests. Follow with dedicated multi-tenant authorization tests and connector acceptance tests before declaring these areas production-ready.
