"""Incident Response service — lifecycle rules, dedup, activity trail.

This module wraps the EXISTING engines (alerts from the notification engine,
tickets from the ticketing service, threat-intel IOCs) without rebuilding
them. Incidents reference those records by their stable identifiers
(ALR-xxxxxx / TCK-xxxxxx); they never copy or duplicate them.
"""
from __future__ import annotations

import logging

import hashlib
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
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


async def next_incident_uid(db: AsyncSession, org_id: Optional[int] = None) -> str:
    # STAGE 4: atomic counter allocation (uid_counters UPSERT+RETURNING, the
    # mechanism introduced in Stage 3) replaces the count-based allocator,
    # which raced under concurrent creation and could emit duplicate
    # INC-xxxxxx uids. The uid column is globally unique, so the counter
    # scope is global; gaps on rollback are acceptable, duplicates impossible.
    from app.services.notifications import allocate_uid
    return await allocate_uid(db, "incidents", "INC")


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


logger = logging.getLogger(__name__)

ACTIVE_EPISODE_STATUSES = ("open", "investigating", "contained")


def _is_integrity_error(exc: BaseException) -> bool:
    """True for any integrity-constraint violation regardless of how the
    driver surfaced it. SQLAlchemy normally wraps DBAPI errors in
    sqlalchemy.exc.IntegrityError, but under aiosqlite's worker-thread
    re-raise path a bare sqlite3.IntegrityError can escape unwrapped
    (verified by executed stack trace during Stage 4 concurrency work).
    On PostgreSQL the psycopg/asyncpg paths wrap correctly; this check is
    belt-and-braces and dialect-independent."""
    if isinstance(exc, IntegrityError):
        return True
    orig = getattr(exc, "orig", None)
    if isinstance(orig, IntegrityError):
        return True
    try:
        import sqlite3
        if isinstance(exc, sqlite3.IntegrityError) or isinstance(orig, sqlite3.IntegrityError):
            return True
    except Exception:
        pass
    return "UNIQUE constraint failed" in str(exc) or "duplicate key value" in str(exc)


def _detach_pending_incidents(db, extra=()) -> None:
    """Remove every Incident instance that is still PENDING (added but whose
    INSERT failed/rolled back) from the session so no later autoflush or
    commit can re-emit it. Session.expunge() refuses pending objects
    (InvalidRequestError); the safe detach for them is the sync-session
    internal _remove_impl, which AsyncSession proxies via .sync_session."""
    from sqlalchemy import inspect as _sa_inspect
    candidates = list(db.new) + list(extra)
    sync = getattr(db, "sync_session", None)
    for obj in candidates:
        if not isinstance(obj, Incident):
            continue
        try:
            state = _sa_inspect(obj)
        except Exception:
            continue
        if not (state.pending or state.detached):
            continue
        try:
            db.expunge(obj)
        except Exception:
            if sync is not None:
                try:
                    sync._remove_impl(obj, load_on_unexpire=False)
                except Exception:
                    pass


async def find_open_incident_for_alert(db: AsyncSession, alert: Alert) -> Optional[Incident]:
    """Return an existing ACTIVE incident for this alert (by alert id or dedup
    key), so alert-driven automation UPDATES rather than duplicating.

    STAGE 4 POLICY CHANGE (approved Decision 3): the match set is now the
    explicit ACTIVE statuses {open, investigating, contained}. The previous
    filter `status NOT IN ('closed')` silently reused RESOLVED incidents,
    mutating historical records. Resolved/closed episodes are never matched
    here — qualifying new evidence creates a new episode instead (see
    upsert_incident_from_alert). Tenant scoping is explicit on org_id.
    """
    inc = (await db.execute(
        select(Incident).where(Incident.alert_id == alert.id,
                               Incident.status.in_(ACTIVE_EPISODE_STATUSES))
    )).scalars().first()
    if inc:
        return inc
    key = incident_dedup_key(alert.org_id, alert.title, alert.resource)
    inc = (await db.execute(
        select(Incident)
        .where(Incident.org_id == alert.org_id,          # explicit tenant scope
               Incident.dedup_key == key,
               Incident.status.in_(ACTIVE_EPISODE_STATUSES))
        .with_for_update()                                # serialize concurrent updaters
    )).scalars().first()
    return inc


async def _latest_episode(db: AsyncSession, org_id: int, key: str) -> Optional[Incident]:
    """Most recent episode in this dedup-key lineage (any status), used to
    number and link a recurrence episode."""
    return (await db.execute(
        select(Incident)
        .where(Incident.org_id == org_id, Incident.dedup_key == key)
        .order_by(Incident.id.desc())
    )).scalars().first()


async def upsert_incident_from_alert(
    db: AsyncSession, alert: Alert, actor: str = "alert-engine",
) -> tuple[Incident, bool]:
    """Create OR update the incident linked to an alert. Returns
    (incident, created_new).

    STAGE 4 episode policy (approved Decision 3):
      * ACTIVE episode ({open|investigating|contained}) matching the dedup key
        -> updated in place (severity escalation + activity trail), same as
        before, but now with explicit tenant scoping and row locking.
      * No active episode but a RESOLVED/CLOSED episode exists for the same
        key -> a NEW EPISODE is created, linked via recurrence_of_uid /
        episode_number. The historical resolved/closed row is NOT reopened,
        NOT mutated, keeps its status/timestamps/activity trail untouched.
      * Concurrency: SELECT ... FOR UPDATE above plus partial unique index
        uq_incident_active_episode prevents two racing requests from creating
        duplicate active episodes for the same (org, dedup_key). On an index
        collision we roll back to savepoint, re-select the winner, and update
        it instead — no duplicate, no error surfaced to callers.
    """
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

    key = incident_dedup_key(alert.org_id, alert.title, alert.resource)
    # Recurrence lineage: previous episode may be resolved or closed; neither
    # is touched below except being referenced by uid.
    prior = await _latest_episode(db, alert.org_id, key)

    # STAGE 4 CONCURRENCY FIX (approved direction): replace the fragile
    # check-then-insert ORM flow (add + flush inside a savepoint, with
    # post-hoc expunge recovery) with the race-safe pattern already proven
    # for alerts in Stage 3: a single atomic statement
    #     INSERT ... ON CONFLICT (partial unique index) DO NOTHING RETURNING id
    # followed by a re-select of the winning row when no id comes back.
    #
    # Why the old approach failed (verified by executed stack traces):
    #   * Under asyncio.gather on a shared StaticPool connection, the loser's
    #     PENDING Incident instance survived savepoint rollback; later
    #     autoflushes re-emitted its INSERT and raised IntegrityError again
    #     outside the recovery path.
    #   * aiosqlite surfaced the partial-index violation as a BARE
    #     sqlite3.IntegrityError, escaping `except IntegrityError`.
    # With ON CONFLICT DO NOTHING there is NO exception to catch at all, no
    # pending ORM INSERT to detach, and nothing for autoflush to re-emit —
    # both failure classes are eliminated by construction, not patched.
    #
    # Column list mirrors Incident's schema; JSON fields are serialized by
    # the driver-bound String params below (SQLite stores them as text;
    # PostgreSQL json/jsonb accepts the same literals).
    # NOTE (verified): on SQLite the raw INSERT must be fully drained before
    # any other statement runs on the shared connection — an open RETURNING
    # cursor caused "cannot commit transaction - SQL statements in progress"
    # under asyncio.gather. .first() closes the cursor immediately; portable
    # to PostgreSQL.
    import json as _json
    uid = await next_incident_uid(db)
    ep_no = (prior.episode_number or 1) + 1 if prior else 1
    rec_uid = prior.uid if prior else None
    assets_json = _json.dumps([alert.resource] if alert.resource else [])
    now = now_utc()
    inserted_id = (await db.execute(
        text(
            "INSERT INTO incidents "
            "(uid, org_id, site_org_id, title, description, severity, status, "
            " assignee, reporter, acknowledged_by, acknowledged_at, resolved_at, "
            " closed_at, affected_assets, ioc_related, tags, alert_id, ticket_uid, "
            " category, dedup_key, recurrence_of_uid, episode_number, created_at, updated_at) "
            "VALUES (:uid, :org_id, NULL, :title, :description, :severity, 'open', "
            " NULL, :reporter, NULL, NULL, NULL, "
            " NULL, :assets, '[]', '[]', :alert_id, :ticket_uid, "
            " 'other', :dedup_key, :recurrence_of_uid, :episode_number, :created_at, NULL) "
            # Conflict target is the PARTIAL unique index uq_incident_active_episode
            # (one active episode per org+dedup_key). Postgres requires naming the
            # index with its WHERE clause for partial-index inference; SQLite
            # ignores the trailing WHERE after parsing (verified working here).
            "ON CONFLICT (org_id, dedup_key) "
            "WHERE status NOT IN ('resolved','closed') AND dedup_key IS NOT NULL "
            "DO NOTHING "
            "RETURNING id"
        ),
        {
            "uid": uid, "org_id": alert.org_id, "title": alert.title,
            "description": alert.description or "", "severity": alert.severity,
            "reporter": actor, "assets": assets_json, "alert_id": alert.id,
            "ticket_uid": alert.ticket_uid, "dedup_key": key,
            "recurrence_of_uid": rec_uid, "episode_number": ep_no,
            "created_at": now,
        },
    )).scalars().first()   # drain/close cursor immediately (see note above)

    if inserted_id is None:
        # Lost the race (or raced past the pre-check): the active episode
        # already exists — fold into the winner instead of duplicating.
        logger.info("incident episode race on (%s, %s): folding into winner",
                    alert.org_id, key)
        winner = (await db.execute(
            select(Incident)
            .where(Incident.org_id == alert.org_id,
                   Incident.dedup_key == key,
                   Incident.status.in_(ACTIVE_EPISODE_STATUSES))
            .with_for_update()
        )).scalars().first()
        if winner is None:
            # Winner vanished between statements (e.g. just resolved/closed);
            # retry once through the normal path rather than surfacing an error.
            return await upsert_incident_from_alert(db, alert, actor=actor)
        await append_activity(db, winner.uid, actor, "alert_linked",
                              f"Concurrent alert {alert.uid} folded into active episode (race-safe)")
        winner.updated_at = now_utc()
        await db.flush()
        return winner, False

    # We won: build the returned instance from exactly what we wrote (all
    # values are plain Python data — the row is already persisted by the
    # drained INSERT above, so nothing here can be re-flushed and no cursor
    # stays open at router-commit time; both were verified failure modes on
    # SQLite StaticPool under asyncio.gather, and both fixes are portable to
    # PostgreSQL). ORM autoflush cannot re-emit the INSERT because this
    # instance is deliberately NEVER added to the session.
    inc = Incident(
        uid=uid, org_id=alert.org_id, title=alert.title,
        description=alert.description or "", severity=alert.severity,
        status="open", reporter=actor, alert_id=alert.id,
        ticket_uid=alert.ticket_uid,
        affected_assets=[alert.resource] if alert.resource else [],
        dedup_key=key, recurrence_of_uid=rec_uid, episode_number=ep_no,
        created_at=now,
    )
    await append_activity(db, inc.uid, actor, "created",
                          f"Opened from alert {alert.uid}"
                          + (f" — new episode #{inc.episode_number} recurring {prior.uid}"
                             if prior else ""))
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
