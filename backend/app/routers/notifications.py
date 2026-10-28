"""Notification & Event Intelligence API.

This is the real ingest point: SIEM/Wazuh/SNMP/syslog integrations POST events
to /api/alerts and the engine immediately runs correlation -> rule matching ->
multi-channel dispatch -> automatic ticket creation. The frontend "waits for
data to come in" by polling this API (long-running backend, no mock data).

Phase 5 additions (alert management + notification operations):
  GET  /alerts                 paginated/searchable/sortable inventory (+summary)
  GET  /alerts/summary         severity/status totals over the FULL filtered set
  GET  /alerts/{id}            detail with related incidents/tickets/notes/history
  PATCH  /alerts/{id}          validated lifecycle transitions + assignment
                               (optimistic concurrency via expected_version -> 409)
  POST /alerts/bulk            bounded bulk ack/resolve/reopen/assign (per-row audit)
  GET/POST /alerts/{id}/notes  append-only investigation notes
  GET  /alerts/{id}/events     immutable lifecycle history
  POST /notifications/{id}/retry  single dead-letter retry, backend-confirmed outcome
All list endpoints are server-side tenant-scoped; role checks on mutations.
"""
import math
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.sql.expression import case as sql_case

from app.database import get_db
from app.core.security import get_current_user
from app.models import (
    User, Alert, AlertNote, AlertEvent, NotificationRule, Notification,
    Incident, Ticket,
)
from app.schemas import (
    AlertIn, AlertResponse, RuleCreate, RuleUpdate, RuleResponse,
    NotificationResponse, AlertSummaryResponse, AlertUpdateIn,
    BulkAlertActionIn, AlertNoteIn, AlertNoteResponse, AlertEventResponse,
    AlertPageResponse, AlertDetailResponse, NotificationRetryResult,
)
from app.services import notifications as nv
from app.services.ticketing import now_utc

router = APIRouter(tags=["Notification Engine"])


def _scope_org(user: User, requested_org: int | None) -> int | None:
    if user.role == "platform_admin":
        return requested_org
    if requested_org is not None and requested_org != user.org_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-tenant access denied")
    return user.org_id


WRITE_ROLES = {"platform_admin", "client_admin", "analyst", "technician"}


def _require_write_role(user: User) -> None:
    """Read-only roles (viewer/client_user) cannot mutate alert state."""
    if user.role not in WRITE_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            f"Role '{user.role}' cannot modify alerts")


# ---------------------------------------------------------------------------
# Alerts — inbound event pipeline
# ---------------------------------------------------------------------------
@router.post("/alerts", response_model=dict, status_code=status.HTTP_201_CREATED)
async def ingest_alert(
    body: AlertIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Real ingest endpoint. Trigger an alert here and the engine will:
    correlate/dedup it, match notification rules, dispatch across channels and
    AUTOMATICALLY create a ticket when a matched rule has create_ticket=true."""
    org = _scope_org(current_user, body.org_id)
    if org is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "org_id required for platform-admin ingest")
    alert = Alert(
        uid=await nv.next_uid(db, Alert, "ALR"), org_id=org,
        title=body.title, description=body.description or "",
        severity=body.severity, source=body.source, resource=body.resource,
        raw_payload=nv.merge_geo_payload(body), created_at=now_utc(),
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    effective = await nv.correlate(db, alert)
    diagnostics = await nv.process_alert(db, effective)
    refreshed = (await db.execute(select(Alert).where(Alert.id == alert.id))).scalars().first()
    if refreshed is None:
        # duplicate folded into an existing row — return the surviving record
        refreshed = (await db.execute(
            select(Alert).where(Alert.uid == effective.uid))).scalars().first()
    return {"alert": AlertResponse.model_validate(refreshed).model_dump(),
            "pipeline": diagnostics}


_SORTABLE = {
    "created_at": Alert.created_at,
    "severity": Alert.severity,
    "status": Alert.status,
    "title": Alert.title,
    "source": Alert.source,
}
_SEV_ORDER = sql_case(
    (Alert.severity == "critical", 0), (Alert.severity == "high", 1),
    (Alert.severity == "medium", 2), (Alert.severity == "low", 3),
    else_=4)


def _alert_filters(stmt, *, org, severity, a_status, source, assignee, q, since, until):
    if org is not None:
        stmt = stmt.where(Alert.org_id == org)
    if severity:
        stmt = stmt.where(Alert.severity.in_([s.strip() for s in severity.split(",") if s.strip()]))
    if a_status:
        stmt = stmt.where(Alert.status.in_([s.strip() for s in a_status.split(",") if s.strip()]))
    if source:
        stmt = stmt.where(Alert.source.in_([s.strip() for s in source.split(",") if s.strip()]))
    if assignee == "__unassigned__":
        stmt = stmt.where(Alert.assignee.is_(None))
    elif assignee:
        stmt = stmt.where(Alert.assignee == assignee)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Alert.title.ilike(like), Alert.description.ilike(like),
                              Alert.resource.ilike(like), Alert.uid.ilike(like)))
    if since:
        stmt = stmt.where(Alert.created_at >= since)
    if until:
        stmt = stmt.where(Alert.created_at <= until)
    return stmt


@router.get("/alerts", response_model=AlertPageResponse)
async def list_alerts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    org_id: int | None = Query(None),
    severity: str | None = None,          # csv: critical,high
    status_f: str | None = Query(None, alias="status"),   # csv: active,acked
    source: str | None = None,            # csv
    assignee: str | None = None,          # email or "__unassigned__"
    q: str | None = Query(None, max_length=200),
    since: datetime | None = None,
    until: datetime | None = None,
    sort: str = Query("created_at", ),
    order: str = Query("desc", pattern=r"^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    """Server-side search/filter/sort/pagination over persisted alerts."""
    eff = _scope_org(current_user, org_id)
    if sort not in _SORTABLE:
        raise HTTPException(422, f"Unknown sort field '{sort}'")
    base = _alert_filters(select(Alert), org=eff, severity=severity, a_status=status_f,
                          source=source, assignee=assignee, q=q, since=since, until=until)
    total = (await db.execute(
        _alert_filters(select(func.count(Alert.id)), org=eff, severity=severity,
                       a_status=status_f, source=source, assignee=assignee, q=q,
                       since=since, until=until))).scalar() or 0
    col = _SORTABLE[sort]
    ordering = _SEV_ORDER.asc() if sort == "severity" else (
        col.desc() if order == "desc" else col.asc())
    secondary = Alert.created_at.desc() if sort != "created_at" else Alert.id.desc()
    stmt = base.order_by(ordering, secondary).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(stmt)).scalars().all()
    return AlertPageResponse(
        items=[AlertResponse.model_validate(r) for r in rows],
        total=int(total), page=page, page_size=page_size,
        pages=max(1, math.ceil(total / page_size)))


@router.get("/alerts/summary", response_model=AlertSummaryResponse)
async def alerts_summary(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    org_id: int | None = Query(None),
    severity: str | None = None,
    status_f: str | None = Query(None, alias="status"),
    source: str | None = None,
    assignee: str | None = None,
    q: str | None = Query(None, max_length=200),
    since: datetime | None = None,
    until: datetime | None = None,
):
    """Severity/status totals over the FULL filtered set (not just the page)."""
    eff = _scope_org(current_user, org_id)
    common = dict(org=eff, severity=severity, a_status=status_f, source=source,
                  assignee=assignee, q=q, since=since, until=until)
    total = (await db.execute(_alert_filters(select(func.count(Alert.id)), **common))).scalar() or 0
    sev_q = _alert_filters(select(Alert.severity, func.count()).group_by(Alert.severity), **common)
    st_q = _alert_filters(select(Alert.status, func.count()).group_by(Alert.status), **common)
    un_q = _alert_filters(
        select(func.count()).select_from(Alert).where(Alert.status == "active",
                                                      Alert.assignee.is_(None)), **common)
    return AlertSummaryResponse(
        total=int(total),
        by_severity={r[0]: r[1] for r in (await db.execute(sev_q)).all()},
        by_status={r[0]: r[1] for r in (await db.execute(st_q)).all()},
        unassigned_active=int((await db.execute(un_q)).scalar() or 0))


async def _get_alert_or_40x(db: AsyncSession, alert_id: int, user: User) -> Alert:
    alert = (await db.execute(select(Alert).where(Alert.id == alert_id))).scalars().first()
    if not alert:
        raise HTTPException(404, "Alert not found")
    if user.role != "platform_admin" and alert.org_id != user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    return alert


@router.get("/alerts/{alert_id}", response_model=AlertDetailResponse)
async def alert_detail(alert_id: int,
                       current_user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    alert = await _get_alert_or_40x(db, alert_id, current_user)
    incs = (await db.execute(
        select(Incident).where(Incident.alert_id == alert.id))).scalars().all()
    tks = (await db.execute(
        select(Ticket).where(Ticket.alert_id == alert.id))).scalars().all()
    notes = (await db.execute(
        select(AlertNote).where(AlertNote.alert_id == alert.id)
        .order_by(AlertNote.created_at.desc()))).scalars().all()
    events = (await db.execute(
        select(AlertEvent).where(AlertEvent.alert_id == alert.id)
        .order_by(AlertEvent.created_at.desc()))).scalars().all()
    detail = AlertDetailResponse.model_validate(alert)
    detail.related_incidents = [
        {"uid": i.uid, "title": i.title, "severity": i.severity, "status": i.status}
        for i in incs]
    detail.related_tickets = [
        {"uid": t.uid, "title": t.title, "status": t.status, "priority": t.priority}
        for t in tks]
    detail.notes = [AlertNoteResponse.model_validate(n) for n in notes]
    detail.events = [AlertEventResponse.model_validate(e) for e in events]
    return detail


@router.patch("/alerts/{alert_id}", response_model=AlertResponse)
async def update_alert(alert_id: int, body: AlertUpdateIn,
                       current_user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    """Validated transition + assignment + optional atomic note. 409 on stale version."""
    _require_write_role(current_user)
    alert = await _get_alert_or_40x(db, alert_id, current_user)
    assignee_sent = ... if (body.assignee is None and not body.clear_assignee) else (
        None if body.clear_assignee else body.assignee)
    updated, changed = await nv.transition_alert(
        db, alert, actor=current_user.email, new_status=body.status,
        assignee=assignee_sent, expected_version=body.expected_version, note=body.note)
    return AlertResponse.model_validate(updated)


@router.post("/alerts/{alert_id}/ack")
async def ack_alert(alert_id: int, current_user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    """Legacy ack endpoint — now routed through the validated transition so the
    lifecycle status, history and version token stay consistent (idempotent)."""
    _require_write_role(current_user)
    alert = await _get_alert_or_40x(db, alert_id, current_user)
    if alert.status == "acked":
        return {"ok": True, "changed": False, "alert": AlertResponse.model_validate(alert).model_dump()}
    updated, changed = await nv.transition_alert(db, alert, actor=current_user.email,
                                                 new_status="acked")
    return {"ok": True, "changed": changed,
            "alert": AlertResponse.model_validate(updated).model_dump()}


@router.post("/alerts/bulk", response_model=dict)
async def bulk_alert_action(body: BulkAlertActionIn,
                            current_user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    """Bounded bulk action (<=200 ids). Per-row results; illegal/stale transitions
    are skipped honestly — never silently forced."""
    _require_write_role(current_user)
    if body.action == "assign" and not body.assignee:
        raise HTTPException(422, "assignee required for action=assign")
    target_status = {"ack": "acked", "resolve": "resolved", "reopen": "active"}.get(body.action)
    results = []
    for aid in body.ids:
        alert = (await db.execute(select(Alert).where(Alert.id == aid))).scalars().first()
        if not alert or (current_user.role != "platform_admin" and alert.org_id != current_user.org_id):
            results.append({"id": aid, "ok": False, "reason": "not_found_or_cross_tenant"})
            continue
        try:
            _, changed = await nv.transition_alert(
                db, alert, actor=current_user.email, new_status=target_status,
                assignee=(body.assignee if body.action == "assign" else ...))
            results.append({"id": aid, "ok": True, "changed": changed})
        except HTTPException as e:
            results.append({"id": aid, "ok": False, "reason": str(e.detail)})
    return {"results": results,
            "applied": sum(1 for r in results if r.get("ok") and r.get("changed"))}


@router.get("/alerts/{alert_id}/notes", response_model=list[AlertNoteResponse])
async def list_notes(alert_id: int, current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    alert = await _get_alert_or_40x(db, alert_id, current_user)
    return (await db.execute(
        select(AlertNote).where(AlertNote.alert_id == alert.id)
        .order_by(AlertNote.created_at.desc()))).scalars().all()


@router.post("/alerts/{alert_id}/notes", response_model=AlertNoteResponse, status_code=201)
async def add_note(alert_id: int, body: AlertNoteIn,
                   current_user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)):
    _require_write_role(current_user)
    alert = await _get_alert_or_40x(db, alert_id, current_user)
    note = AlertNote(org_id=alert.org_id, alert_id=alert.id, author=current_user.email,
                     body=body.body.strip(), created_at=now_utc())
    db.add(note)
    db.add(AlertEvent(org_id=alert.org_id, alert_id=alert.id, actor=current_user.email,
                      action="noted", detail="Investigation note added"))
    alert.version = (alert.version or 1) + 1
    await db.commit()
    await db.refresh(note)
    return note


@router.get("/alerts/{alert_id}/events", response_model=list[AlertEventResponse])
async def list_events(alert_id: int, current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    alert = await _get_alert_or_40x(db, alert_id, current_user)
    return (await db.execute(
        select(AlertEvent).where(AlertEvent.alert_id == alert.id)
        .order_by(AlertEvent.created_at.desc()))).scalars().all()


# ---------------------------------------------------------------------------
# Notification rules (visual rule builder persists here)
# ---------------------------------------------------------------------------
@router.get("/notification-rules", response_model=list[RuleResponse])
async def list_rules(current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    stmt = select(NotificationRule).order_by(NotificationRule.id)
    if current_user.role != "platform_admin":
        stmt = stmt.where((NotificationRule.org_id == current_user.org_id) |
                          (NotificationRule.org_id.is_(None)))
    return (await db.execute(stmt)).scalars().all()


@router.post("/notification-rules", response_model=RuleResponse, status_code=201)
async def create_rule(body: RuleCreate, current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    org = _scope_org(current_user, body.org_id)
    if current_user.role != "platform_admin":
        org = current_user.org_id  # clients can only build tenant-scoped rules
    rule = NotificationRule(
        org_id=org, name=body.name, enabled=body.enabled, conditions=body.conditions,
        channels=body.channels, recipients=body.recipients, create_ticket=body.create_ticket,
        ticket_priority=body.ticket_priority, escalate_after_minutes=body.escalate_after_minutes,
        quiet_hours=body.quiet_hours,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.patch("/notification-rules/{rule_id}", response_model=RuleResponse)
async def update_rule(rule_id: int, body: RuleUpdate,
                      current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    rule = (await db.execute(select(NotificationRule).where(NotificationRule.id == rule_id))).scalars().first()
    if not rule:
        raise HTTPException(404, "Rule not found")
    if current_user.role != "platform_admin" and rule.org_id not in (None, current_user.org_id):
        raise HTTPException(403, "Cross-tenant access denied")
    for field, val in (body.model_dump(exclude_unset=True)).items():
        setattr(rule, field, val)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/notification-rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    rule = (await db.execute(select(NotificationRule).where(NotificationRule.id == rule_id))).scalars().first()
    if not rule:
        raise HTTPException(404, "Rule not found")
    if current_user.role != "platform_admin" and rule.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    await db.delete(rule)
    await db.commit()


# ---------------------------------------------------------------------------
# Notifications (delivery log + diagnostics + dead-letter queue)
# ---------------------------------------------------------------------------
@router.get("/notifications", response_model=list[NotificationResponse])
async def list_notifications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    org_id: int | None = Query(None),
    status_f: str | None = Query(None, alias="status"),
    channel: str | None = None,
    q: str | None = Query(None, max_length=200),
    alert_uid: str | None = None,
    limit: int = Query(300, le=1000),
    page: int = Query(1, ge=1),
):
    eff = _scope_org(current_user, org_id)
    stmt = select(Notification).order_by(Notification.created_at.desc())
    if eff is not None:
        stmt = stmt.where(Notification.org_id == eff)
    if status_f:
        stmt = stmt.where(Notification.status.in_(
            [s.strip() for s in status_f.split(",") if s.strip()]))
    if channel:
        stmt = stmt.where(Notification.channel.in_(
            [c.strip() for c in channel.split(",") if c.strip()]))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Notification.subject.ilike(like),
                              Notification.recipient.ilike(like)))
    if alert_uid:
        arow = (await db.execute(select(Alert.id).where(Alert.uid == alert_uid))).scalar()
        stmt = stmt.where(Notification.alert_id == arow)  # honest empty if unknown uid
    stmt = stmt.limit(limit).offset((page - 1) * limit)
    rows = (await db.execute(stmt)).scalars().all()
    # Resolve alert UIDs server-side so the UI can drill down without keeping
    # any frontend-only join state.
    aids = {r.alert_id for r in rows if r.alert_id}
    uid_by_id: dict[int, str] = {}
    if aids:
        uid_by_id = {
            a.id: a.uid for a in (await db.execute(
                select(Alert).where(Alert.id.in_(aids)))).scalars().all()}
    out = []
    for r in rows:
        resp = NotificationResponse.model_validate(r)
        resp.alert_uid = uid_by_id.get(r.alert_id or 0)
        out.append(resp)
    return out


@router.post("/notifications/{notif_id}/retry", response_model=NotificationRetryResult)
async def retry_one_notification(notif_id: int, current_user: User = Depends(get_current_user),
                                 db: AsyncSession = Depends(get_db)):
    """Safe single-item retry. Backend-confirmed outcome only: the response
    reports what actually happened on this attempt (sent / dead_letter again).
    Only dead-letter rows are retryable; anything else -> 409."""
    _require_write_role(current_user)
    n = (await db.execute(select(Notification).where(Notification.id == notif_id))).scalars().first()
    if not n:
        raise HTTPException(404, "Notification not found")
    if current_user.role != "platform_admin" and n.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    n = await nv.retry_notification(db, n, actor=current_user.email)
    return NotificationRetryResult(id=n.id, status=n.status, attempts=n.attempts,
                                   last_error=n.last_error, sent_at=n.sent_at)


@router.post("/notifications/{notif_id}/ack")
async def ack(notif_id: int, current_user: User = Depends(get_current_user),
              db: AsyncSession = Depends(get_db)):
    _require_write_role(current_user)
    n = (await db.execute(select(Notification).where(Notification.id == notif_id))).scalars().first()
    if not n:
        raise HTTPException(404, "Notification not found")
    if current_user.role != "platform_admin" and n.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    await nv.ack_notification(db, n, actor=current_user.email)
    return {"ok": True}


@router.post("/notifications/retry-dead-letters")
async def retry_dlq(current_user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    """Bulk DLQ flush stays platform-admin-only (cross-tenant operation).
    Tenant admins use POST /notifications/{id}/retry per item."""
    if current_user.role != "platform_admin":
        raise HTTPException(403, "Platform admins only")
    return {"retried": await nv.retry_dead_letters(db)}


@router.get("/notifications/analytics")
async def notif_analytics(current_user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    eff = _scope_org(current_user, None)
    return await nv.analytics(db, org_id=eff)
