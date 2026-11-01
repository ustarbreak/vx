# Services Reconciled (T0.6)

Reconciliation of the four service-truth sources, generated 2026-11-01 from the working tree.

## Sources & counts (verified)
| Source | Count | Evidence |
|---|---|---|
| `backend/app/services/seed.py` → `ALL_SERVICES` (L215) | **16** ids + `ADVANCED_TICKETING_SERVICE` extra (L275 loop) | regex extraction: analytics, backup-dr, cloud-security, compliance, dns-filtering, email-security, endpoint-protection, firewall-mgmt, incident-response, network-monitoring, patch-management, sd-wan, soar, threat-intel, vpn-gateway, vuln-scanning |
| `backend/app/services/connectors.py` → `SERVICE_CONNECTORS` (L36) | **17** (16 + advanced-ticketing; regex also catches non-service keys `endpoints`,`headers`) | grep + parse |
| `backend/app/platform/catalog/services/*.yaml` (T1.2 output) | **18** = 16 seed + advanced-ticketing + asset-discovery | `ls` count |
| Frontend pages (`docs/audit/pages.csv`, 101 routes) | service pages exist for 14/18 | join below |

**Known drift (accepted):** catalog carries `asset-discovery` (engine-only capability with no seed entry) — documented in gen_catalog.py; drift test asserts superset relationship, not equality.

## Service ↔ page ↔ engine matrix
| Service | Page(s) under /client-admin or top-level | Backing engine / connector | Status |
|---|---|---|---|
| vpn-gateway | client-admin/vpn-gateway | connector probe only | beta |
| endpoint-protection | client-admin/endpoint-protection (+/:alertId) | connectors + wazuh.py (`get_agents/get_alerts/isolate_agent/get_vulnerabilities`) | beta |
| email-security | client-admin/email-security (+/:alertId) | connector | beta |
| dns-filtering | client-admin/dns-filtering | connector | beta |
| sd-wan | client-admin/sd-wan (+/:alertId) | connector; brief SD-WAN scope intentionally limited (ALIGNMENT §E) | roadmap |
| network-monitoring | — (served via monitored-devices/discovery pages) | discovery.py + agent-go metrics | ga (engine), page indirect |
| vuln-scanning | — | wazuh get_vulnerabilities; Greenbone deferred to Phase 6 T6.0 (decision #8) | roadmap |
| compliance | /compliance, client-admin/compliance-reports | reports/ + connector | beta |
| advanced-ticketing | /advanced-ticketing | ticketing.py (native SLA/audit chain) | ga |
| incident-response | — (served by incidents pages) | incidents.py + triage.py | ga (engine), page indirect |
| soar | client-admin/soar | soar.py (preview/simulate/execute gating) | ga-sim / execute gated |
| backup-dr | client-admin/backup-dr | connector | beta |
| firewall-mgmt | client-admin/firewall-mgmt | connector | beta |
| analytics | /analytics | analytics.py, value_engine.py | ga |
| patch-management | client-admin/patch-management | connector | beta |
| cloud-security | client-admin/cloud-security (+/:alertId) | connector | beta |
| asset-discovery | — (monitored-devices, scan-history) | discovery.py | ga (engine only, no seed row) |
| threat-intel | — (threat_intel.py service exists; dedicated page TBD) | misp.py + threat_intel.py | beta |

## Live vs mock overlay (from pages.csv columns livefeed/demoworld)
- 101 pages total; **15 use live feeds**, **25 reference demoWorld**, **21 are mock-only** (demoWorld without livefeed): incl. admin/clients, admin/dashboard, admin/tenants/:orgId, client-admin/asset-inventory, entitlements, device detail, plans, scan-history, statistics/{devices,network,performance}.
- Per owner decision #6 these pages need only an **adapter swap** to engines' existing endpoints — no backend rewrite (ADAPTED-PLAN T2.6/T4.x).

## TODO_VERIFY
- Whether each EDR-console button already calls real endpoints via `src/services/securityOps.ts` (carry-over open item from ALIGNMENT.md).
