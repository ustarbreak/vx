# Client Admin implementation and acceptance status

**Snapshot:** 2026-11-05  
**Repository baseline:** `main` at `823c0cf3f3965aa19c7c53d0fe621ce124378326` (PR #46 merge)  
**Status:** implementation in progress; Client Admin is not yet accepted as complete.

This document separates delivered code, CI evidence, and capabilities that still require a real integration or end-to-end acceptance. A green PR workflow is not equivalent to production acceptance.

## Work submitted in the current implementation wave

| Area | PR | Scope | CI at snapshot |
|---|---:|---|---|
| Account / invitations | [#47](https://github.com/ustarbreak/vx/pull/47) | Tenant-scoped invitations, role allow-list, invitation listing/resend authorization, audit entries, regression tests | Success |
| Security Services | [#48](https://github.com/ustarbreak/vx/pull/48) | Exact 197-action allow-list across all ten service pages; fixes Email Security `em` prefix parity | Success |
| Team directory | [#49](https://github.com/ustarbreak/vx/pull/49) | Real tenant users/invitations UI, role/status API, audit log and scope tests | Success |
| Project runbooks | [#50](https://github.com/ustarbreak/vx/pull/50) | Persistent tenant/project runbook CRUD, checklist state, Alembic migration and tenant tests | Success |
| Security Ops honesty | [#51](https://github.com/ustarbreak/vx/pull/51) | Marks actions as manual until a collector pickup/acknowledgement route exists; explicit no-device-command message and UI status | Success; stacked on #48 |
| Compliance | [#52](https://github.com/ustarbreak/vx/pull/52) | Tenant-scoped NIST CSF 2.0 starter control register, evidence notes, audit trail, migration, no default scores | Success; stacked on #50 |
| Threat Intelligence | [#53](https://github.com/ustarbreak/vx/pull/53) | Prevents demo threat indicators leaking into Live Mode | Success |
| SOC Command Center | [#54](https://github.com/ustarbreak/vx/pull/54) | Uses tenant APIs for alert/threat/compliance/SOAR counts; removes fabricated Live Mode risk/trend values | Success; stacked on #52 |
| Infrastructure statistics | [#55](https://github.com/ustarbreak/vx/pull/55) | Live device/network inventory only; removes fabricated CPU, memory, disk, throughput and performance history from Live Mode | Frontend typecheck/build passed; backend workflow still running at snapshot |

### Merge dependencies

- Merge #48 before #51.
- Merge #50 before #52.
- Merge #52 before #54.
- #47, #49, #53 and #55 are based on the current main line and do not depend on those stacks.

The older audit PRs #32 and #33 remain stale/diverged and must not be merged over these current-main implementations.

## Client Admin acceptance inventory

| Navigation group | Current implementation state | Remaining acceptance / blocker |
|---|---|---|
| Command Center | Live tenant counts and recent alerts are connected in #54. | No validated predictive-risk endpoint; no historical threat-trend endpoint. These values are intentionally unavailable in Live Mode. |
| SOC Operations | Incident API, status transitions, analyst notes, evidence references and audit history exist in the current backend/UI. | Run the full role/tenant integration suite against a populated PostgreSQL environment; verify evidence retention and incident-resolution/reopen lifecycle. |
| Assets & Infrastructure | Discovery, inventory and device action endpoints exist. #55 removes simulated statistics from Live Mode. | CPU/memory/disk/network telemetry ingestion is not connected. Collector-backed device action execution/acknowledgement must be verified separately. |
| Security Services & Protection | Ten service pages, exact action allow-list in #48, honest manual task status in #51. | No shared security-ops task consumer currently executes those service actions on devices. Tasks are manual; do not present them as device-executed. Verify each vendor connector before enabling live execution. |
| Threat Intelligence | Backend feed/match APIs exist; #53 prevents demo data fallback in Live Mode. | Configure and verify a real tenant feed (e.g. MISP/OTX) and test provenance, refresh, IOC lifecycle and tenant isolation with real feed records. |
| Respond & Automate | SOAR run lifecycle/recovery/approval work exists from earlier merged work; #50 adds persistent project checklists. | Project runbooks are checklists, not executable SOAR. Complete end-to-end approval/cancel/retry/audit verification with real collector/target acknowledgements. |
| MSSP & Service Management | Ticket APIs and service desk UI exist, including SLA/status data. | Verify SLA clock, escalation and four-eyes approval with PostgreSQL-backed multi-tenant tests and real notification delivery. |
| Governance & Reporting | #52 adds a 12-control NIST CSF 2.0 starter register with human-entered evidence notes; reports page reflects API availability. | This is not a full NIST assessment or automatic evidence collector. Compliance/regulatory/audit report adapters and verified exports remain incomplete where the reporting API reports unavailable. |
| Account / Tenant Settings | #47 and #49 add tenant-safe invitations, team listing and member role/status updates. | Verify email delivery/activation end-to-end and review remaining subscription/billing setting actions against backend support. |

## Acceptance gates before Platform Admin work

1. Merge the PRs in dependency order and rerun CI on the final merged `main`.
2. Run backend tests against PostgreSQL, including tenant isolation, authorization and concurrency tests.
3. Run frontend typecheck/build and browser end-to-end tests for each of the nine Client Admin groups.
4. Exercise the workflows with at least two separate tenants and the relevant client-admin, analyst and technician roles.
5. Verify all actions labelled live against actual backend persistence and collector/device acknowledgement. Manual or unavailable states must remain explicit.
6. Close every critical/high-priority finding and record evidence for the acceptance run.

**Decision:** Client Admin is not yet ready to be declared complete. The implementation wave closes several known false-data and authorization gaps, but live telemetry, service-action execution, real threat-feed configuration, report adapters and end-to-end acceptance remain open. The separate global Platform Admin page should start only after these gates pass.
