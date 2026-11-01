# Native Engines — Deep-Read Audit (T0.3)

Evidence gathered 2026-11-01 by direct file inspection. All line/function references below were checked with grep against the working tree. Status legend: **ga** = production-ready, **beta** = functional but partial, **stub** = placeholder.

## 1. Triage — `backend/app/services/triage.py` + `backend/app/routers/triage.py` (271 lines) — **ga**
- Core: `compute_triage(inc, counts, policy)` (L84) rules-based scoring; `load_policy` (L228) versioned policy from DB (`TRIAGE_POLICY_VERSION`); `evaluate_incident` (L257); `record_override` (L308) with human-override audit trail.
- Tests: `backend/tests/test_triage_rules.py`, `test_safe_grouping.py`, `test_outcome_labels.py`, `test_label_audit.py`.
- Verdict: real logic, DB-backed policy, test-covered. No mock data in the service layer.

## 2. Discovery — `backend/app/services/discovery.py` + `routers/discovery.py` (486 L), `discovery_extra.py` — **ga (with honest fallback)**
- Runs **real nmap** when present: `nmap_available()` (L38-39, `shutil.which("nmap")`). SNMP via pysnmp "if installed; graceful simulated match otherwise" (module docstring L6) — fallback is documented, not silently faked.
- Background scanner (docstring L3). Agent-reported devices arrive via `agent-go` `ReportDiscovery` → discovery queue (`transport/client.go` L167+).
- Tests: `test_discovery_auth.py`, `test_devices_monitoring_state.py`.

## 3. Incidents — `backend/app/services/incidents.py` + `routers/incidents.py` (663 L) — **ga**
- Lifecycle state machine: `check_transition` (L49); dedup keyed by org: `incident_dedup_key(org_id, title, resource)` (L58); `next_incident_uid` (L65, org-scoped); activity log `append_activity` (L75); integrity-error handling (L93).
- Tests: `test_incidents_soar.py`, `test_incident_episodes.py`, `test_alerts_lifecycle.py`, `test_event_evidence.py`.

## 4. SOAR / Playbooks — `backend/app/services/soar.py` + `routers/soar.py` (539 L) — **ga for simulate/preview; execute is gated scaffolding**
- Safety model verified in code: `validate_steps` (L59) rejects actions not in allow-list ("action '...' is not allowed", L75); `has_consequential` (L117); `redact` (L102).
- Router run modes (routers/soar.py L6): `preview | simulate | execute`; `mode` default `simulate` (L116); `confirm: bool = False — must be true to run consequential steps in execute mode` (L118). Execution engine itself maps only to internal/native actions — no external SOAR backend wired (see ALIGNMENT §C).
- Tests: `test_incidents_soar.py`.

## 5. Ticketing — `backend/app/services/ticketing.py` + `routers/tickets.py` (289 L) — **ga (native)**
- SLA: `apply_sla` (L35), `sla_state` (L47), `breach_prediction` (L75), auto `run_escalations` (L107). Classification `classify` (L158); duplicate detection `find_duplicate(org_id,...)` (L186); hash-chained audit `append_audit` (L217 `_entry_hash` chain); evidence `add_evidence` (L238); closure approvals `request_closure`/`decide_approval` (L330/L348).
- TheHive/MISP paths exist as connectors (`services/misp.py`, `connectors.py`) but native ticketing is the default per owner decision #4 (DFIR-IRIS to be added as connector in Phase 3, not replacing native).

## Cross-cutting
- All five engines are org-scoped (`org_id` confirmed as tenant key, owner decision #3) and covered by 21 test files under `backend/tests/`.
- Route census (docs/audit/routes.csv): triage 11 routes, soar 11, incidents ~20+, tickets ~10+ — all classified `real` except 1 stub + 1 mock repo-wide (236/238 real).
