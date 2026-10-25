"""Notification & Event Intelligence API.

This is the real ingest point: SIEM/Wazuh/SNMP/syslog integrations POST events
to /api/alerts and the engine immediately runs correlation -> rule matching ->
multi-channel dispatch -> automatic ticket creation. The frontend "waits for
data to come in" by polling this API (long-running backend, no mock data).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.core.security import get_current_user
from app.models import User, Alert, NotificationRule, Notification
from app.schemas import (
    AlertIn, AlertResponse, RuleCreate, RuleUpdate, RuleResponse,
    NotificationResponse,
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
        raw_payload=body.raw_payload or {}, created_at=now_utc(),
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    effective = await nv.correlate(db, alert)
    diagnostics = await nv.process_alert(db, effective)
    refreshed = (await db.execute(select(Alert).where(Alert.id == alert.id))).scalars().first()
    return {"alert": AlertResponse.model_validate(refreshed).model_dump(),
            "pipeline": diagnostics}


@router.get("/alerts", response_model=list[AlertResponse])
async def list_alerts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    org_id: int | None = Query(None),
    severity: str | None = None,
    limit: int = Query(200, le=1000),
):
    eff = _scope_org(current_user, org_id)
    stmt = select(Alert).order_by(Alert.created_at.desc()).limit(limit)
    if eff is not None:
        stmt = stmt.where(Alert.org_id == eff)
    rows = (await db.execute(stmt)).scalars().all()
    if severity:
        rows = [r for r in rows if r.severity == severity]
    return rows


@router.post("/alerts/{alert_id}/ack")
async def ack_alert(alert_id: int, current_user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    alert = (await db.execute(select(Alert).where(Alert.id == alert_id))).scalars().first()
    if not alert:
        raise HTTPException(404, "Alert not found")
    if current_user.role != "platform_admin" and alert.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    alert.acked_by = current_user.email
    alert.acked_at = now_utc()
    await db.commit()
    return {"ok": True}


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
    limit: int = Query(300, le=1000),
):
    eff = _scope_org(current_user, org_id)
    stmt = select(Notification).order_by(Notification.created_at.desc()).limit(limit)
    if eff is not None:
        stmt = stmt.where(Notification.org_id == eff)
    rows = (await db.execute(stmt)).scalars().all()
    if status_f:
        rows = [r for r in rows if r.status == status_f]
    if channel:
        rows = [r for r in rows if r.channel == channel]
    return rows


@router.post("/notifications/{notif_id}/ack")
async def ack(notif_id: int, current_user: User = Depends(get_current_user),
              db: AsyncSession = Depends(get_db)):
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
    if current_user.role != "platform_admin":
        raise HTTPException(403, "Platform admins only")
    return {"retried": await nv.retry_dead_letters(db)}


@router.get("/notifications/analytics")
async def notif_analytics(current_user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    eff = _scope_org(current_user, None)
    return await nv.analytics(db, org_id=eff)
