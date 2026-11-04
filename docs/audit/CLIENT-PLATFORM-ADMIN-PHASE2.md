# Client Admin / Platform Admin completion phase 2

Base: PR #34 merge commit `5a43d335e3ea2ae0b55c565538875ea0d07f6308`.

## Implemented in this phase

### Global Platform Admin dashboard
- Replaced demo-only organization, user and audit KPIs with `organizationsApi.list()`, `usersDirectoryApi.list()` and platform-wide `auditApi.logs()`.
- Dashboard now has loading, refresh, empty and partial-error states.
- Removed unsupported MRR/revenue, risk and compliance claims from the dashboard. Service catalog count is explicitly described as catalog entries, not active integrations.

### Global Platform Admin tenant portfolio
- In Live Mode, the portfolio list now contains backend organizations only. Demo tenants are included only when Demo Mode is explicitly enabled.
- In Live Mode, demo-only devices, members, API keys, licenses and activity fixtures are not rendered in tenant detail panels.
- Demo entitlement toggles are disabled in Live Mode; license renewal is clearly disabled because no billing renewal action is wired in this view.
- The organization create action continues to use the existing backend endpoint.

### Client Admin technician/team directory
- Demo Mode continues to use explicitly simulated technician fixtures.
- Live Mode now loads users from the authenticated tenant-scoped user directory.
- Live workload and service assignment fields remain unknown rather than showing fabricated counts.
- Add/edit/delete controls are disabled in Live Mode because this API surface does not provide client-admin team invitation or role-management operations.

## Previously completed and retained
- PR #33: P0 live-vs-demo truthfulness, cloud/endpoint fallback fixes, action failure provenance, runbooks read-only in Live Mode.
- PR #34: shared service feed returns an empty array instead of falling through to hard-coded fixtures on Live Mode failure; Client Users page uses backend directory.

## Evidence / validation boundaries
- Alert routes use `_scope_org` and reject a requested org different from the authenticated user's org; non-platform users are scoped to their own org.
- Agent-token management uses the authenticated user's organization, and probe lookups constrain both probe ID and token organization.
- Source inspection is not a substitute for running two-tenant PostgreSQL authorization tests.
- No live tenant database, agent fleet, or customer integration credentials were available in this environment.
- No claim is made that queued security actions have been executed on endpoint devices.
- No local frontend build or backend test execution was available. CI on this PR must pass before considering merge.

## Still outstanding after this phase

| Area | Remaining work |
|---|---|
| SOC Operations | Two-tenant runtime tests for alert list/detail, notes, bulk updates, incident lifecycle, evidence and audit history |
| Assets & Infrastructure | Two-tenant tests for scan, cancel, import, SNMP credentials, agent tokens, probes, inventory and device actions |
| Security Services | Validate all action IDs against backend catalog/capabilities; test actual connector acceptance and collector acknowledgement |
| Threat Intelligence | Provider configuration, source attribution, IOC provenance and tenant visibility acceptance tests |
| SOAR | Validate dry-run/execute, approvals, dangerous action gates, cancellation, retry, audit and tenant isolation |
| MSSP Service Management | Validate ticket ownership, approvals, evidence, SLA and escalation transitions |
| Governance & Reporting | Validate exports and compliance reports against persisted tenant evidence and audit sources |
| Client administration | Implement dedicated tenant-scoped invitation, role, MFA and settings APIs before enabling mutations |
| Runbooks | Implement backend persistence and authorized execution endpoints before enabling Live Mode mutations |
| Platform integrations | Replace static integration catalogue presentation with persisted integration configuration and health APIs; current page is not an operational integration inventory |
| Partner Admin | Separate end-to-end audit and acceptance pass |

The phase improves source-level correctness and removes misleading demo data in the touched views. It does not certify the entire product as production-ready.
