"""Source adapters (Phase 2, brief §4).

Common interface — every adapter implements:
    async def fetch(tenant: str, period: str) -> list[dict]   # rows in rpt_* shape
    async def health() -> dict                                # {ok, last_ok, last_error}

Design rules:
  * each adapter is pluggable/removable without touching the rest;
  * a dead source NEVER stops the other adapters (per-adapter try/except);
  * credentials come from the `integrations` table / env only (no secrets);
  * third-party tool names stay INTERNAL (brief §1 confidentiality rule) —
    adapters output normalized rows, never vendor labels.

Adapter registry keyed by report id. Reports not listed here have no real
source yet and honestly render "Donnee indisponible" until wired.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Alert, Ticket, NotificationRule, Integration

_HEALTH: dict[str, dict[str, Any]] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _period_range(period: str) -> tuple[datetime, datetime]:
    y, m = int(period[:4]), int(period[5:7])
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + (m == 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
    return start, end


def _tenant_org(tenant: str) -> Optional[int]:
    try:
        return int(tenant)
    except (TypeError, ValueError):
        return None


async def _integration_row(org: int | None, service_id: str) -> Optional[Integration]:
    """Active integration config for this tenant. NOTE: the `integrations`
    table is PLATFORM-level (no org_id column), so a single active row per
    service feeds every tenant; isolation is enforced downstream by the
    period+tenant filters of each query/adapter."""
    async with AsyncSessionLocal() as db:
        q = (select(Integration)
             .where(Integration.service_id == service_id,
                    Integration.status == "active"))
        row = (await db.execute(q)).scalars().first()
        return row


# ====================================================== platform-native ====
class PlatformAlertsAdapter:
    """SIEM-side facts derived from live `alerts` table (normalized)."""
    key = "alerts"

    async def fetch(self, tenant: str, period: str) -> list[dict]:
        org = _tenant_org(tenant)
        if org is None:
            return []
        start, end = _period_range(period)
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                select(Alert).where(Alert.org_id == org,
                                    Alert.created_at >= start,
                                    Alert.created_at < end)
            )).scalars().all()
        out = []
        for a in rows:
            sev = {"critical": "crit", "high": "high", "medium": "med",
                   "low": "low", "info": "low"}.get(a.severity, "low")
            out.append({
                "table": "rpt_alerts",
                "severity": sev,
                "category": (a.raw_payload or {}).get("category") or a.source,
                "source_zone": (a.raw_payload or {}).get("zone") or "platform",
                "rule_name": a.title[:128],
                "attack_id": (a.raw_payload or {}).get("attack_id"),
                "qualified": bool(a.acked_by or a.ticket_uid),
                "false_positive": (a.raw_payload or {}).get("disposition") == "benign",
                "detected_at": a.created_at,
                "first_event_at": (a.raw_payload or {}).get("first_event_at"),
                "source": "platform",
            })
        return out

    async def health(self) -> dict:
        return {"ok": True, "last_ok": _now().isoformat(), "last_error": None}


class PlatformTicketsAdapter:
    """Ticketing facts from live `tickets` table -> rpt_ticket_facts rows."""
    key = "tickets"

    async def fetch(self, tenant: str, period: str) -> list[dict]:
        org = _tenant_org(tenant)
        if org is None:
            return []
        start, end = _period_range(period)
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                select(Ticket).where(Ticket.org_id == org,
                                     Ticket.created_at >= start,
                                     Ticket.created_at < end)
            )).scalars().all()
        out = []
        for t in rows:
            breached = bool(t.due_resolve_at and
                            (t.resolved_at or _now()) > t.due_resolve_at)
            out.append({
                "table": "rpt_ticket_facts",
                "ref": t.uid, "category": t.category, "priority": t.priority,
                "status": t.status, "opened_at": t.created_at,
                "resolved_at": t.resolved_at, "sla_breached": breached,
                "assignee": t.assignee, "source": "ticketing",
            })
        return out

    async def health(self) -> dict:
        return {"ok": True, "last_ok": _now().isoformat(), "last_error": None}


# ================================================== external OSS engines ====
class ConnectorBackedAdapter:
    """Generic adapter over app.services.connectors (MISP/OTX, TheHive, n8n,
    OpenVAS, Fleet, Restic wrapper, Rspamd, Prowler, Netdata/LibreNMS, Pi-hole,
    OPNsense, Tailscale, NetBox, GLPI...). Uses the tenant's active
    `integrations` row; on any failure records health and returns [] so the
    builder renders 'Donnee indisponible' instead of fake numbers."""
    def __init__(self, key: str, service_id: str, target_table: str):
        self.key = key
        self.service_id = service_id      # internal only, never client-facing
        self.target_table = target_table  # rpt_* destination table label

    async def fetch(self, tenant: str, period: str) -> list[dict]:
        try:
            from app.services import connectors, normalizers
            org = _tenant_org(tenant)
            integ = await _integration_row(org, self.service_id)
            if integ is None:
                _HEALTH[self.key] = {"ok": False, "last_ok": None,
                                     "last_error": "no active integration configured"}
                return []
            cfg = {"api_endpoint": integ.api_endpoint, "api_key": integ.api_key,
                   "username": getattr(integ, "username", None),
                   "password": getattr(integ, "password", None)}
            # real connector API: returns {"service_id","engine","records":[...],"error"?}
            res = await connectors.fetch_live_records(self.service_id, cfg, limit=200)
            if res.get("error"):
                _HEALTH[self.key] = {"ok": False, "last_ok": (_HEALTH.get(self.key) or {})
                                     .get("last_ok"), "last_error": str(res["error"])[:300]}
                return []
            normed = normalizers.normalize(self.service_id, res)
            records = normed.get("records") or normed.get("items") or []
            rows = [{**r, "table": self.target_table, "source": self.service_id}
                    for r in records if isinstance(r, dict)]
            _HEALTH[self.key] = {"ok": bool(rows), "last_ok": _now().isoformat(),
                                 "last_error": None if rows else "empty response"}
            return rows
        except Exception as e:  # noqa: BLE001 — one dead source must not stop others
            _HEALTH[self.key] = {"ok": False, "last_ok": (_HEALTH.get(self.key) or {})
                                 .get("last_ok"), "last_error": str(e)[:300]}
            return []

    async def health(self) -> dict:
        return _HEALTH.get(self.key, {"ok": False, "last_ok": None,
                                      "last_error": "never run"})


# ================================================================= demo ====
class DemoAdapter:
    """Explicit demo adapter used ONLY by tests and the server-side mirror
    (?demo=1). Never reachable from a real-mode request."""
    key = "demo"

    async def fetch(self, tenant: str, period: str) -> list[dict]:
        from app.services.reporting import demo_data as dd
        return [{"table": "_demo", "payload": dd.build_demo_report("executive", tenant, period)}]

    async def health(self) -> dict:
        return {"ok": os.getenv("REPORTING_DEMO", "1") == "1",
                "last_ok": _now().isoformat(), "last_error": None}


# ------------------------------------------------------------- registry ---
ADAPTERS: dict[str, list[Any]] = {
    # report id          -> adapters feeding its builders
    "incident":      [PlatformAlertsAdapter(), PlatformTicketsAdapter()],
    "tickets":       [PlatformTicketsAdapter()],
    "soar":          [ConnectorBackedAdapter("soar", "soar", "rpt_playbook_runs")],
    "threatintel":   [ConnectorBackedAdapter("threatintel", "threat-intel", "rpt_iocs")],
    "hunting":       [PlatformAlertsAdapter()],
    "vuln":          [ConnectorBackedAdapter("vuln", "vuln-scanning", "rpt_vulnerabilities")],
    "patch":         [ConnectorBackedAdapter("patch", "patch-management", "rpt_patches")],
    "cloud":         [ConnectorBackedAdapter("cloud", "cloud-security", "rpt_vulnerabilities")],
    "network":       [ConnectorBackedAdapter("network", "network-monitoring", "rpt_network_metrics")],
    "backup":        [ConnectorBackedAdapter("backup", "backup-dr", "rpt_backups")],
    "endpoint":      [ConnectorBackedAdapter("endpoint", "endpoint-protection", "rpt_endpoint_health")],
    "email":         [ConnectorBackedAdapter("email", "email-security", "rpt_email_stats")],
    "compliance":    [ConnectorBackedAdapter("compliance", "compliance", "rpt_controls")],
    "regulatory":    [ConnectorBackedAdapter("regulatory", "compliance", "rpt_controls")],
    "audit":         [PlatformAlertsAdapter()],
    "infra":         [ConnectorBackedAdapter("infra", "network-monitoring", "rpt_assets")],
    "uba":           [],   # ML scoring pipeline — Phase 2b (no honest source yet)
    "executive":     [PlatformAlertsAdapter(), PlatformTicketsAdapter()],
    "roi":           [],   # needs rpt_roi_parameters seed (Phase 3 job M)
    "value":         [PlatformTicketsAdapter()],
}


async def fetch_all(report_key: str, tenant: str, period: str) -> dict[str, list[dict]]:
    """Run every adapter registered for a report; group resulting rows by
    target rpt_* table. A failing adapter contributes nothing but does not
    break the others (acceptance criterion Phase 2)."""
    grouped: dict[str, list[dict]] = {}
    for ad in ADAPTERS.get(report_key, []):
        try:
            rows = await ad.fetch(tenant, period)
        except Exception:  # noqa: BLE001 — belt & braces
            rows = []
        for r in rows:
            grouped.setdefault(r.get("table", "misc"), []).append(r)
    return grouped


async def adapters_health() -> dict:
    out = {}
    for key, ads in ADAPTERS.items():
        states = []
        for ad in ads:
            try:
                states.append({"adapter": ad.key, **(await ad.health())})
            except Exception as e:  # noqa: BLE001
                states.append({"adapter": ad.key, "ok": False, "last_error": str(e)[:200]})
        out[key] = states
    return out
