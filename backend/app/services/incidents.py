"""Incident Response service — lifecycle rules, dedup, activity trail.

This module wraps the EXISTING engines (alerts from the notification engine,
tickets from the ticketing service, threat-intel IOCs) without rebuilding
them. Incidents reference those records by their stable identifiers
(ALR-xxxxxx / TCK-xxxxxx); they never copy or duplicate them.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Incident, IncidentActivity, IncidentNote, IncidentEvidence, IncidentAction,
    Alert, Ticket,
)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Lifecycle state machine — explicit, validated transitions
# ---------------------------------------------------------------------------
INCIDENT_SEVERITIES = ("critical", "high", "medium", "low", "info")
INCIDENT_STATUSES = ("open", "investigating", "contained", "resolved", "closed")

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "open":          {"investigating", "resolved", "closed"},
    "investigating": {"contained", "resolved", "closed"},
    "contained":     {"investigating", "resolved", "closed"},
    "resolved":      {"closed", "investigating"},   # re-open => investigating
    "closed":        {"investigating"},             # explicit re-open
}


class TransitionError(ValueError):
    """Raised on an illegal status transition."""


def check_transition(current: str, new: str) -> None:
    if new not in INCIDENT_STATUSES:
        raise TransitionError(f"Unknown status '{new}'")
    if new == current:
        raise TransitionError(f"Incident is already '{current}'")
    if new not in ALLOWED_TRANSITIONS.get(current, set()):
        raise TransitionError(f"Illegal transition '{current}' → '{new}'")


def incident_dedup_key(org_id: int, title: str, resource: Optional[str]) -> str:
    """Stable fingerprint so re-processing the same alert/event updates the
    existing incident instead of creating a duplicate record."""
    base = f"{org_id}|{title.strip().lower()}|{(resource or '').strip().lower()}"
    return hashlib.sha256(base.encode()).hexdigest()[:32]


async def next_incident_uid(db: AsyncSession) -> str:
    count = len((await db.execute(select(Incident.id))).scalars().all())
    return f"INC-{count + 1:06d}"


async def append_activity(
    db: AsyncSession, incident_uid: str, actor: str, action: str,
    detail: str = "", from_value: Optional[str] = None, to_value: Optional[str] = None,
) -> IncidentActivity:
    entry = IncidentActivity(
        incident_uid=incident_uid, actor=actor, action=action, detail=detail,
        from_value=from_value, to_value=to_value, created_at=now_utc(),
    )
    db.add(entry)
    await db.flush()
    return entry


async def find_open_incident_for_alert(db: AsyncSession, alert: Alert) -> Optional[Incident]:
    """Return an existing incident for this alert (by alert id or dedup key),
    so alert-driven automation UPDATES rather than duplicating."""
    inc = (await db.execute(
        select(Incident).where(Incident.alert_id == alert.id)
    )).scalars().first()
    if inc:
        return inc
    key = incident_dedup_key(alert.org_id, alert.title, alert.resource)
    inc = (await db.execute(
        select(Incident).where(Incident.dedup_key == key,
                               Incident.status.notin_(["closed"]))
    )).scalars().first()
    return inc


async def upsert_incident_from_alert(
    db: AsyncSession, alert: Alert, actor: str = "alert-engine",
) -> tuple[Incident, bool]:
    """Create OR update the incident linked to an alert. Returns
    (incident, created_new). Never creates a duplicate when an existing
    (non-closed) record matches the dedup key."""
    existing = await find_open_incident_for_alert(db, alert)
    if existing:
        if _sev_gt(alert.severity, existing.severity):
            old = existing.severity
            existing.severity = alert.severity
            await append_activity(db, existing.uid, actor, "severity_changed",
                                  f"Escalated by repeated alerts ({alert.correlated_count} correlated)",
                                  from_value=old, to_value=alert.severity)
        await append_activity(db, existing.uid, actor, "alert_linked",
                              f"Additional alert {alert.uid} correlated (count={alert.correlated_count})")
        existing.updated_at = now_utc()
        await db.flush()
        return existing, False

    uid = await next_incident_uid(db)
    inc = Incident(
        uid=uid, org_id=alert.org_id, title=alert.title,
        description=alert.description or "", severity=alert.severity,
        status="open", reporter=actor, alert_id=alert.id,
        ticket_uid=alert.ticket_uid,
        affected_assets=[alert.resource] if alert.resource else [],
        dedup_key=incident_dedup_key(alert.org_id, alert.title, alert.resource),
        created_at=now_utc(),
    )
    db.add(inc)
    await db.flush()
    await append_activity(db, uid, actor, "created", f"Opened from alert {alert.uid}")
    return inc, True


_SEV_ORDER = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}


def _sev_gt(a: str, b: str) -> bool:
    return _SEV_ORDER.get(a, 0) > _SEV_ORDER.get(b, 0)


def incident_out(i: Incident) -> dict:
    d = {c.name: getattr(i, c.name) for c in i.__table__.columns}
    return d


async def sync_ticket_link(db: AsyncSession, incident: Incident, ticket: Ticket,
                           actor: str) -> None:
    """Link (or refresh link between) an incident and an existing ticket.
    Idempotent: relinking the same ticket is a no-op."""
    if incident.ticket_uid == ticket.uid:
        return
    incident.ticket_uid = ticket.uid
    await append_activity(db, incident.uid, actor, "linked",
                          f"Linked to ticket {ticket.uid}")
    await db.flush()
