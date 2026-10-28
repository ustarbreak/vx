"""Incident Response API — real backend for the incident list/detail pages.

Wraps the EXISTING engines without rebuilding them:
  * alerts come from the SIEM/notification engine (app.models.Alert)
  * tickets come from the ticketing service (linked by stable TCK- uid)
  * playbook runs come from the SOAR v2 engine (app.models.PlaybookRun)

Guarantees required by the brief:
  * every endpoint is authenticated and tenant-scoped (403 cross-tenant)
  * lifecycle transitions are validated against an explicit state machine
  * no duplicate incidents: alert-driven creation UPDATES via dedup key,
    manual creation flags likely duplicates instead of silently inserting
  * assignment / acknowledgment / notes / evidence / actions are recorded
    in an immutable activity trail (audit history)
  * timestamps always returned; current status distinct from history
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_, case, String, inspect
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.security import get_current_user
from app.models import (
    User, Organization, Incident, IncidentNote, IncidentActivity,
    IncidentEvidence, IncidentAction, Alert, Ticket, PlaybookRun, AuditLog,
)
from app.services.incidents import (
    INCIDENT_SEVERITIES, INCIDENT_STATUSES, TransitionError, check_transition,
    incident_dedup_key, next_incident_uid, append_activity,
    upsert_incident_from_alert, sync_ticket_link, now_utc,
)
from app.services.ticketing import create_ticket

router = APIRouter(prefix="/incidents", tags=["Incident Response"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _iso(v):
    if isinstance(v, datetime):
        return v.isoformat()
    return v


def _inc_out(i: Incident) -> dict:
    # Explicit column list + expunge-safe snapshot: avoids lazy-load IO after
    # commit (MissingGreenlet) and keeps internal fields from leaking.
    d = {}
    for k in ("uid", "org_id", "site_org_id", "title", "description", "severity",
              "status", "reporter", "assignee", "acknowledged_by", "ticket_uid",
              "affected_assets", "ioc_related", "tags", "category",
              "acknowledged_at", "resolved_at", "closed_at", "created_at",
              "updated_at"):
        d[k] = getattr(i, k, None)
    # Stable SIEM alert identifier (preserved relationship, not the internal PK).
    # Callers pass it explicitly when they have already loaded the Alert row;
    # reading i.alert_id here is safe because it is a loaded column.
    d["alert_uid"] = getattr(i, "_alert_uid_cache", None)
    for k in ("created_at", "updated_at", "acknowledged_at", "resolved_at", "closed_at"):
        d[k] = _iso(d.get(k))
    return d


async def _cache_alert_uid(db: AsyncSession, i: Incident) -> None:
    """Resolve the stable ALR- uid for an incident's linked alert once and
    stash it on the instance so _inc_out never triggers implicit IO."""
    if getattr(i, "_alert_uid_cache", None) is not None or not i.alert_id:
        return
    alert = (await db.execute(select(Alert).where(Alert.id == i.alert_id))).scalars().first()
    i._alert_uid_cache = alert.uid if alert else None


async def _snapshot_incident(db: AsyncSession, i: Incident) -> dict:
    """Capture a plain-dict copy BEFORE commit so response building never
    touches an expired ORM instance (avoids MissingGreenlet/DetachedInstanceError
    on async engines).

    A nested flush inside the ticketing/link services expires server-managed
    columns (e.g. `updated_at`). Reading `.loaded_value` does NOT force a
    reload, so we explicitly refresh only unloaded/expired columns while the
    instance is still bound to the session, then build the dict from the
    populated state. No IO happens after this point.
    """
    state = inspect(i)
    expired = list(state.unloaded) or None  # keys not currently loaded/expired
    if state.session is not None and expired:
        await db.refresh(i, attribute_names=[k for k in expired])
    return _inc_out(i)


def _can_view(user: User, inc: Incident) -> bool:
    return user.role == "platform_admin" or inc.org_id == user.org_id


async def _get_incident(db: AsyncSession, uid: str, user: User) -> Incident:
    inc = (await db.execute(select(Incident).where(Incident.uid == uid))).scalars().first()
    if not inc:
        raise HTTPException(404, "Incident not found")
    if not _can_view(user, inc):
        raise HTTPException(403, "Cross-tenant access denied")
    return inc


def _audit(db: AsyncSession, user: User, action: str, resource_id: str,
           details: str, outcome: str = "success") -> None:
    db.add(AuditLog(actor_id=user.id, actor_name=user.email, actor_role=user.role,
                    org_id=user.org_id, action=action, resource="incident",
                    resource_id=resource_id, details=details, outcome=outcome))


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class IncidentCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=300)
    description: str = ""
    severity: str = "medium"
    category: str = "other"
    site_org_id: Optional[int] = None
    affected_assets: list[str] = []
    tags: list[str] = []
    assignee: Optional[str] = None
    alert_uid: Optional[str] = None      # link into the existing SIEM alert
    org_id: Optional[int] = None         # platform admin only


class IncidentUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=3, max_length=300)
    description: Optional[str] = None
    severity: Optional[str] = None
    category: Optional[str] = None
    assignee: Optional[str] = None
    affected_assets: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    site_org_id: Optional[int] = None


class StatusChange(BaseModel):
    status: str
    note: str = ""


class AssignIn(BaseModel):
    assignee: str = Field(..., min_length=3, max_length=200)


class AckIn(BaseModel):
    pass


class NoteIn(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)
    internal: bool = True


class EvidenceIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    kind: str = "log"
    detail: str = ""


class ActionIn(BaseModel):
    action_type: str
    detail: str = ""


class LinkTicketIn(BaseModel):
    ticket_uid: str


# ---------------------------------------------------------------------------
# List — search / filtering / sorting / pagination
# ---------------------------------------------------------------------------
@router.get("")
async def list_incidents(q: Optional[str] = None,
                         status_f: Optional[str] = Query(None, alias="status"),
                         severity: Optional[str] = None,
                         assignee: Optional[str] = None,
                         category: Optional[str] = None,
                         org_id: Optional[int] = Query(None),
                         sort: str = Query("created_at",
                                           pattern="^(created_at|updated_at|severity|status|title)$"),
                         order: str = Query("desc", pattern="^(asc|desc)$"),
                         page: int = Query(1, ge=1),
                         page_size: int = Query(25, ge=1, le=200),
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    stmt = select(Incident)
    if user.role != "platform_admin":
        stmt = stmt.where(Incident.org_id == user.org_id)
    elif org_id is not None:
        stmt = stmt.where(Incident.org_id == org_id)
    if status_f:
        if status_f not in INCIDENT_STATUSES:
            raise HTTPException(422, f"Unknown status '{status_f}'")
        stmt = stmt.where(Incident.status == status_f)
    if severity:
        if severity not in INCIDENT_SEVERITIES:
            raise HTTPException(422, f"Unknown severity '{severity}'")
        stmt = stmt.where(Incident.severity == severity)
    if assignee:
        stmt = stmt.where(Incident.assignee == assignee)
    if category:
        stmt = stmt.where(Incident.category == category)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(
            func.lower(Incident.title).like(like),
            func.lower(Incident.description).like(like),
            func.lower(Incident.uid).like(like),
            func.cast(Incident.affected_assets, String).ilike(f"%{q}%"),
        ))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0

    if sort == "severity":
        sev_rank = case(
            (Incident.severity == "critical", 0),
            (Incident.severity == "high", 1),
            (Incident.severity == "medium", 2),
            (Incident.severity == "low", 3),
            else_=4,
        )
        # desc = most severe first (rank ascending); asc = least severe first
        order_clause = sev_rank.asc() if order == "desc" else sev_rank.desc()
    else:
        col = getattr(Incident, sort)
        order_clause = col.desc() if order == "desc" else col.asc()
    rows_stmt = stmt.order_by(order_clause, Incident.id.desc())
    rows = (await db.execute(rows_stmt.offset((page - 1) * page_size)
                             .limit(page_size))).scalars().all()

    count_stmt = select(Incident.status, func.count()).group_by(Incident.status)
    if user.role != "platform_admin":
        count_stmt = count_stmt.where(Incident.org_id == user.org_id)
    counts = dict((await db.execute(count_stmt)).all())
    return {"items": [_inc_out(i) for i in rows], "total": total,
            "page": page, "page_size": page_size,
            "status_counts": {s: int(counts.get(s, 0)) for s in INCIDENT_STATUSES}}


# ---------------------------------------------------------------------------
# Create (manual) — with duplicate guard; alert-based path uses upsert service
# ---------------------------------------------------------------------------
@router.post("", status_code=201)
async def create_incident(body: IncidentCreate, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    if body.severity not in INCIDENT_SEVERITIES:
        raise HTTPException(422, f"severity must be one of {INCIDENT_SEVERITIES}")
    if user.role == "client_user":
        raise HTTPException(403, "Only administrators can open incidents")
    target_org = user.org_id
    if user.role == "platform_admin" and body.org_id is not None:
        target_org = body.org_id
    if target_org is None:
        raise HTTPException(422, "No tenant scope available for this account")
    if body.site_org_id is not None:
        site = (await db.execute(select(Organization).where(
            Organization.id == body.site_org_id))).scalars().first()
        if not site:
            raise HTTPException(404, "Site organization not found")
        if user.role != "platform_admin" and site.parent_org_id != user.org_id and site.id != user.org_id:
            raise HTTPException(403, "Cross-tenant access denied")

    # link an existing SIEM alert rather than duplicating its signal
    alert = None
    if body.alert_uid:
        alert = (await db.execute(select(Alert).where(Alert.uid == body.alert_uid))).scalars().first()
        if not alert:
            raise HTTPException(404, "Alert not found")
        if user.role != "platform_admin" and alert.org_id != user.org_id:
            raise HTTPException(403, "Cross-tenant access denied")
        inc, created = await upsert_incident_from_alert(db, alert, actor=user.email)
        if not created:
            _audit(db, user, "incident_deduped", inc.uid,
                   f"Manual open matched existing incident from alert {alert.uid}")
            inc._alert_uid_cache = alert.uid
            snap = await _snapshot_incident(db, inc)
            await db.commit()
            return {"reused": True, "incident": snap}
        # fall through: enrich the auto-created incident with manual fields
        inc.title = body.title or inc.title
        inc.description = body.description or inc.description
        inc.category = body.category
        inc.site_org_id = body.site_org_id
        if body.affected_assets:
            inc.affected_assets = body.affected_assets
        if body.assignee:
            inc.assignee = body.assignee
            await append_activity(db, inc.uid, user.email, "assigned",
                                  f"Assigned at creation", to_value=body.assignee)
        inc.updated_at = now_utc()
        _audit(db, user, "incident_created", inc.uid, f"'{inc.title}' from alert {alert.uid}")
        inc._alert_uid_cache = alert.uid
        snap = await _snapshot_incident(db, inc)
        await db.commit()
        return {"reused": False, "incident": snap}

    key = incident_dedup_key(target_org, body.title,
                             body.affected_assets[0] if body.affected_assets else None)
    dup = (await db.execute(select(Incident).where(
        Incident.dedup_key == key, Incident.status.notin_(["closed"])))).scalars().first()
    if dup:
        raise HTTPException(409, f"A non-closed incident with the same title/asset already exists ({dup.uid}). "
                                "Update it instead of creating a duplicate.")

    uid = await next_incident_uid(db)
    inc = Incident(uid=uid, org_id=target_org, title=body.title.strip(),
                   description=body.description, severity=body.severity,
                   status="open", reporter=user.email, assignee=body.assignee,
                   affected_assets=body.affected_assets, tags=body.tags,
                   category=body.category, site_org_id=body.site_org_id,
                   dedup_key=key, created_at=now_utc())
    db.add(inc)
    await db.flush()
    await append_activity(db, uid, user.email, "created", "Manually opened")
    _audit(db, user, "incident_created", uid, f"'{inc.title}'")
    snap = await _snapshot_incident(db, inc)
    await db.commit()
    return {"reused": False, "incident": snap}


# ---------------------------------------------------------------------------
# Detail view — relationships + activity trail
# ---------------------------------------------------------------------------
@router.get("/{uid}")
async def get_incident(uid: str, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    inc = await _get_incident(db, uid, user)
    out = _inc_out(inc)

    alert = None
    if inc.alert_id:
        pass
    if inc.alert_id:
        alert = (await db.execute(select(Alert).where(Alert.id == inc.alert_id))).scalars().first()
    if alert:
        out["alert"] = {"uid": alert.uid, "severity": alert.severity, "source": alert.source,
                        "resource": alert.resource, "correlated_count": alert.correlated_count,
                        "created_at": _iso(alert.created_at)}
    else:
        out["alert"] = None

    ticket = None
    if inc.ticket_uid:
        ticket = (await db.execute(select(Ticket).where(Ticket.uid == inc.ticket_uid))).scalars().first()
    out["ticket"] = None if not ticket else {
        "uid": ticket.uid, "status": ticket.status, "priority": ticket.priority,
        "assignee": ticket.assignee, "due_resolve_at": _iso(ticket.due_resolve_at)}

    org = (await db.execute(select(Organization).where(
        Organization.id == inc.org_id))).scalars().first()
    out["organization"] = None if not org else {"id": org.id, "name": org.name}
    site = None
    if inc.site_org_id:
        site = (await db.execute(select(Organization).where(
            Organization.id == inc.site_org_id))).scalars().first()
    out["site"] = None if not site else {"id": site.id, "name": site.name,
                                         "org_type": site.org_type}

    notes = (await db.execute(select(IncidentNote).where(
        IncidentNote.incident_uid == uid).order_by(IncidentNote.id))).scalars().all()
    out["notes"] = [{"id": n.id, "author": n.author, "content": n.content,
                     "internal": n.internal, "created_at": _iso(n.created_at)} for n in notes]

    acts = (await db.execute(select(IncidentActivity).where(
        IncidentActivity.incident_uid == uid).order_by(IncidentActivity.id))).scalars().all()
    out["activity"] = [{"id": a.id, "actor": a.actor, "action": a.action, "detail": a.detail,
                        "from_value": a.from_value, "to_value": a.to_value,
                        "created_at": _iso(a.created_at)} for a in acts]

    evs = (await db.execute(select(IncidentEvidence).where(
        IncidentEvidence.incident_uid == uid).order_by(IncidentEvidence.id))).scalars().all()
    out["evidence"] = [{"id": e.id, "name": e.name, "kind": e.kind, "sha256": e.sha256,
                        "ticket_uid": e.ticket_uid, "collected_by": e.collected_by,
                        "created_at": _iso(e.created_at)} for e in evs]

    acts2 = (await db.execute(select(IncidentAction).where(
        IncidentAction.incident_uid == uid).order_by(IncidentAction.id))).scalars().all()
    out["actions"] = [{"id": a.id, "action_type": a.action_type, "status": a.status,
                       "detail": a.detail, "performed_by": a.performed_by,
                       "playbook_run_uid": a.playbook_run_uid,
                       "created_at": _iso(a.created_at)} for a in acts2]

    runs = (await db.execute(select(PlaybookRun).where(
        PlaybookRun.incident_uid == uid).order_by(PlaybookRun.id.desc()).limit(10))).scalars().all()
    out["playbook_runs"] = [{"uid": r.uid, "mode": r.mode, "status": r.status,
                             "triggered_by": r.triggered_by, "started_at": _iso(r.started_at),
                             "finished_at": _iso(r.finished_at)} for r in runs]
    return out


# ---------------------------------------------------------------------------
# Lifecycle transitions — validated state machine
# ---------------------------------------------------------------------------
@router.put("/{uid}/status")
async def change_status(uid: str, body: StatusChange,
                        user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    inc = await _get_incident(db, uid, user)
    if user.role == "client_user":
        raise HTTPException(403, "Only administrators can change incident status")
    try:
        check_transition(inc.status, body.status)
    except TransitionError as e:
        raise HTTPException(409, str(e))
    old = inc.status
    inc.status = body.status
    ts = now_utc()
    if body.status == "resolved":
        inc.resolved_at = ts
    if body.status == "closed":
        inc.closed_at = ts
        if inc.resolved_at is None:
            inc.resolved_at = ts
    if body.status == "investigating" and old in ("resolved", "closed"):
        inc.resolved_at = inc.closed_at = None   # re-open clears terminal stamps
    inc.updated_at = ts
    await append_activity(db, uid, user.email, "status_changed",
                          body.note or f"Status moved {old} → {body.status}",
                          from_value=old, to_value=body.status)
    _audit(db, user, "incident_status_changed", uid, f"{old} → {body.status}")
    snap = await _snapshot_incident(db, inc)
    await db.commit()
    return snap


@router.put("/{uid}/assign")
async def assign_incident(uid: str, body: AssignIn,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    inc = await _get_incident(db, uid, user)
    if user.role == "client_user":
        raise HTTPException(403, "Only administrators can assign incidents")
    target = (await db.execute(select(User).where(
        User.email == body.assignee))).scalars().first()
    if not target:
        raise HTTPException(404, "Assignee user not found")
    if user.role != "platform_admin" and target.org_id != user.org_id:
        raise HTTPException(403, "Cannot assign across tenants")
    old = inc.assignee
    inc.assignee = body.assignee
    inc.updated_at = now_utc()
    await append_activity(db, uid, user.email, "assigned",
                          "Ownership transferred", from_value=old, to_value=body.assignee)
    _audit(db, user, "incident_assigned", uid, f"{old} → {body.assignee}")
    snap = await _snapshot_incident(db, inc)
    await db.commit()
    return snap


@router.post("/{uid}/acknowledge")
async def acknowledge_incident(uid: str, body: AckIn,
                               user: User = Depends(get_current_user),
                               db: AsyncSession = Depends(get_db)):
    inc = await _get_incident(db, uid, user)
    if inc.acknowledged_at is not None:
        raise HTTPException(409, f"Already acknowledged by {inc.acknowledged_by}")
    inc.acknowledged_by = user.email
    inc.acknowledged_at = now_utc()
    inc.updated_at = now_utc()
    await append_activity(db, uid, user.email, "acked", "Acknowledged")
    _audit(db, user, "incident_acknowledged", uid, "")
    snap = await _snapshot_incident(db, inc)
    await db.commit()
    return snap


@router.patch("/{uid}")
async def update_incident(uid: str, body: IncidentUpdate,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    inc = await _get_incident(db, uid, user)
    if user.role == "client_user":
        raise HTTPException(403, "Only administrators can edit incidents")
    if body.severity is not None and body.severity not in INCIDENT_SEVERITIES:
        raise HTTPException(422, f"severity must be one of {INCIDENT_SEVERITIES}")
    changed: list[str] = []
    for field in ("title", "description", "category", "affected_assets", "tags", "site_org_id"):
        v = getattr(body, field)
        if v is not None and getattr(inc, field) != v:
            if field == "title":
                setattr(inc, "dedup_key",
                        incident_dedup_key(inc.org_id, v,
                                           (v and inc.affected_assets or [None])[0]))
            setattr(inc, field, v)
            changed.append(field)
    if body.severity is not None and body.severity != inc.severity:
        old = inc.severity
        inc.severity = body.severity
        await append_activity(db, uid, user.email, "severity_changed",
                              "Severity adjusted during triage",
                              from_value=old, to_value=body.severity)
        changed.append("severity")
    if not changed:
        return await _snapshot_incident(db, inc)   # idempotent no-op
    inc.updated_at = now_utc()
    await append_activity(db, uid, user.email, "updated",
                          "Updated fields: " + ", ".join(changed))
    _audit(db, user, "incident_updated", uid, ", ".join(changed))
    snap = await _snapshot_incident(db, inc)
    await db.commit()
    return snap


# ---------------------------------------------------------------------------
# Notes / evidence / actions / links
# ---------------------------------------------------------------------------
@router.post("/{uid}/notes", status_code=201)
async def add_note(uid: str, body: NoteIn, user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)):
    inc = await _get_incident(db, uid, user)
    n = IncidentNote(incident_uid=uid, author=user.email, content=body.content,
                     internal=body.internal, created_at=now_utc())
    db.add(n)
    await append_activity(db, uid, user.email, "note_added",
                          "Internal note" if body.internal else "Client-visible note")
    await db.commit()
    return {"id": n.id, "author": n.author, "content": n.content,
            "internal": n.internal, "created_at": _iso(n.created_at)}


@router.post("/{uid}/evidence", status_code=201)
async def add_evidence_entry(uid: str, body: EvidenceIn,
                             user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    inc = await _get_incident(db, uid, user)
    e = IncidentEvidence(incident_uid=uid, ticket_uid=inc.ticket_uid,
                         kind=body.kind, name=body.name,
                         sha256=None, collected_by=user.email, created_at=now_utc())
    db.add(e)
    await append_activity(db, uid, user.email, "evidence_added", f"Collected '{body.name}'")
    _audit(db, user, "incident_evidence_added", uid, body.name)
    await db.commit()
    return {"id": e.id, "name": e.name, "kind": e.kind,
            "created_at": _iso(e.created_at)}


@router.post("/{uid}/actions", status_code=201)
async def record_action(uid: str, body: ActionIn, user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    """Record a response action in the ledger. Allowed types are fixed —
    this endpoint NEVER executes anything itself (execution belongs to the
    SOAR engine or the ticketing engine)."""
    ALLOWED = {"escalate", "contain", "isolate_host", "block_ip", "notify",
               "create_ticket", "run_playbook", "resolve", "custom"}
    if body.action_type not in ALLOWED:
        raise HTTPException(422, f"action_type must be one of {sorted(ALLOWED)}")
    inc = await _get_incident(db, uid, user)
    a = IncidentAction(incident_uid=uid, action_type=body.action_type,
                       status="completed", detail=body.detail,
                       performed_by=user.email, created_at=now_utc())
    db.add(a)
    await append_activity(db, uid, user.email, "action_recorded",
                          f"{body.action_type}: {body.detail[:200]}")
    _audit(db, user, "incident_action_recorded", uid, body.action_type)
    await db.commit()
    return {"id": a.id, "action_type": a.action_type, "status": a.status,
            "created_at": _iso(a.created_at)}


@router.post("/{uid}/link-ticket")
async def link_ticket(uid: str, body: LinkTicketIn, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    inc = await _get_incident(db, uid, user)
    t = (await db.execute(select(Ticket).where(Ticket.uid == body.ticket_uid))).scalars().first()
    if not t:
        raise HTTPException(404, "Ticket not found")
    if user.role != "platform_admin" and t.org_id != user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    await sync_ticket_link(db, inc, t, user.email)
    _audit(db, user, "incident_linked_ticket", uid, body.ticket_uid)
    snap = await _snapshot_incident(db, inc)
    await db.commit()
    return snap


@router.post("/{uid}/create-ticket")
async def open_ticket_for_incident(uid: str, user: User = Depends(get_current_user),
                                   db: AsyncSession = Depends(get_db)):
    """Spawn a ticket through the EXISTING ticketing engine (SLA clocks,
    audit chain, evidence snapshot all handled there). Idempotent: an
    incident already linked to a live ticket returns that ticket."""
    inc = await _get_incident(db, uid, user)
    if user.role == "client_user":
        raise HTTPException(403, "Only administrators can open tickets here")
    if inc.ticket_uid:
        existing = (await db.execute(select(Ticket).where(
            Ticket.uid == inc.ticket_uid))).scalars().first()
        if existing and existing.status not in ("closed",):
            return {"reused": True, "ticket_uid": existing.uid}
    prio = {"critical": "p1", "high": "p2", "medium": "p3",
            "low": "p4", "info": "p4"}.get(inc.severity, "p3")
    t = await create_ticket(db, org_id=inc.org_id,
                            title=f"[INC {uid}] {inc.title}",
                            description=inc.description or f"Opened from incident {uid}",
                            priority=prio, category="incident", source="incident",
                            reporter=user.email, asset=(inc.affected_assets or [None])[0],
                            alert_id=inc.alert_id, auto_ai=False)
    await sync_ticket_link(db, inc, t, user.email)
    db.add(IncidentAction(incident_uid=uid, action_type="create_ticket",
                          status="completed", detail=f"Ticket {t.uid} opened",
                          performed_by=user.email, created_at=now_utc()))
    _audit(db, user, "incident_created_ticket", uid, t.uid)
    await db.commit()
    return {"reused": False, "ticket_uid": t.uid}


# ---------------------------------------------------------------------------
# Activity trail (standalone endpoint for paginated history views)
# ---------------------------------------------------------------------------
@router.get("/{uid}/activity")
async def get_activity(uid: str, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db),
                       page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    inc = await _get_incident(db, uid, user)
    stmt = select(IncidentActivity).where(IncidentActivity.incident_uid == inc.uid)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    rows = (await db.execute(stmt.order_by(IncidentActivity.id.desc())
                             .offset((page - 1) * page_size).limit(page_size))).scalars().all()
    return {"items": [{"id": a.id, "actor": a.actor, "action": a.action, "detail": a.detail,
                       "from_value": a.from_value, "to_value": a.to_value,
                       "created_at": _iso(a.created_at)} for a in rows],
            "total": total, "page": page, "page_size": page_size}
