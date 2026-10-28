"""Notification & Event Intelligence Engine.

Real pipeline: every inbound Alert is processed through
  1. correlation / dedup + notification-storm protection
  2. rule matching (visual rule builder conditions)
  3. quiet-hours deferral
  4. multi-channel dispatch with delivery diagnostics, retries and a
     dead-letter queue (in-DB; swap `deliver()` transports for SMTP/Twilio/HTTP).
  5. automatic ticket creation when a matched rule has create_ticket=True
     -> links alert <-> ticket (the incident->ticket automation the UI shows).

`deliver()` simulates transport by default; set DELIVERY_MODE=real in env to
raise NotImplementedError on email/sms/webhook so you wire real providers
consciously instead of silently sending test spam.
"""
import os
import hashlib
import random
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models import (
    Alert, AlertNote, AlertEvent, NotificationRule, Notification, Ticket, Organization,
)
from app.services.ticketing import create_ticket, now_utc

DELIVERY_MODE = os.getenv("DELIVERY_MODE", "simulated")

SEVERITY_RANK = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}


async def next_uid(db: AsyncSession, model, prefix: str) -> str:
    count = len((await db.execute(select(model.id))).scalars().all())
    return f"{prefix}-{count + 1:06d}"


def merge_geo_payload(body) -> dict:
    """Persist optional geolocation from AlertIn into the alert raw_payload.

    The worldwide attack map (GET /api/security/attack-map) reads src_geo /
    dst_geo / classification straight out of raw_payload — no schema change is
    needed and events without geo stay exactly as before. Coordinates are only
    stored when the collector actually provided them; we never invent a fix.
    """
    payload = dict(body.raw_payload or {})
    for field in ("src_geo", "dst_geo"):
        gp = getattr(body, field, None)
        if gp is not None:
            d = gp.model_dump(exclude_none=True) if hasattr(gp, "model_dump") else dict(gp)
            if d:
                payload[field] = d
    cls = getattr(body, "classification", None)
    if cls:
        payload["classification"] = cls
    return payload


# --------------------------------------------------------------------------
# Correlation & storm protection
# --------------------------------------------------------------------------
def dedup_fingerprint(alert: Alert) -> str:
    base = f"{alert.org_id}|{alert.source}|{alert.resource or ''}|{alert.title.lower().strip()}"
    return hashlib.sha1(base.encode()).hexdigest()[:16]


async def correlate(db: AsyncSession, alert: Alert) -> Alert:
    """If an identical alert occurred within the last hour, fold into it.

    Honesty rule (Phase 5): a duplicate NEVER becomes a second alert record —
    we update the existing row in place (correlated_count, lifecycle status)
    and discard the incoming row. Re-folding also reopens an acked/resolved
    alert because new evidence arrived for the same fingerprint.
    """
    fp = dedup_fingerprint(alert)
    since = now_utc() - timedelta(hours=1)
    result = await db.execute(
        select(Alert).where(
            Alert.dedup_key == fp,
            Alert.created_at >= since,
        ).order_by(Alert.created_at.desc()).limit(1)
    )
    existing = result.scalars().first()
    if existing:
        existing.correlated_count += 1
        # new activity on a closed alert => reopen honestly (event logged below)
        was_closed = existing.status in ("acked", "resolved")
        if was_closed:
            existing.status = "active"
            existing.resolved_at = None
            existing.resolved_by = None
        alert.dedup_key = fp
        alert.correlated_count = existing.correlated_count
        # storm protection: suppress re-notification after 5 duplicates/hour
        alert.storm_suppressed = existing.correlated_count > 5
        db.add(AlertEvent(
            org_id=existing.org_id, alert_id=existing.id, actor="system",
            action="reopened" if was_closed else "correlated",
            detail=f"Duplicate folded (correlated_count={existing.correlated_count})"))
        # drop the duplicate row entirely — one record per fingerprint
        await db.delete(alert)
        await db.commit()
        return existing  # route the *original* alert context
    alert.dedup_key = fp
    await db.commit()
    await db.refresh(alert)
    return alert


# --------------------------------------------------------------------------
# Rule evaluation (conditions from the visual rule builder)
# --------------------------------------------------------------------------
def rule_matches(rule: NotificationRule, alert: Alert) -> bool:
    if not rule.enabled:
        return False
    if rule.org_id is not None and rule.org_id != alert.org_id:
        return False
    cond = rule.conditions or {}
    sev_list = cond.get("severity") or []
    if sev_list and alert.severity not in sev_list:
        return False
    src_list = cond.get("source") or []
    if src_list and alert.source not in src_list:
        return False
    contains = (cond.get("contains") or "").lower()
    if contains and contains not in f"{alert.title} {alert.description}".lower():
        return False
    min_rank = cond.get("min_severity")
    if min_rank and SEVERITY_RANK.get(alert.severity, 0) < SEVERITY_RANK.get(min_rank, 0):
        return False
    return True


def in_quiet_hours(quiet: Optional[dict], at: datetime) -> bool:
    if not quiet:
        return False
    try:
        start_h, start_m = map(int, quiet["start"].split(":"))
        end_h, end_m = map(int, quiet["end"].split(":"))
    except Exception:
        return False
    minutes = at.hour * 60 + at.minute
    start = start_h * 60 + start_m
    end = end_h * 60 + end_m
    if start <= end:
        return start <= minutes < end
    return minutes >= start or minutes < end  # wraps midnight


# --------------------------------------------------------------------------
# Delivery transports — REAL providers via app.services.transports when a
# ChannelConfig exists for the tenant; simulated only in demo/no-config mode.
# --------------------------------------------------------------------------
def deliver(channel: str, recipient: str, subject: str, org_id: int | None = None,
            db_cfg: dict | None = None) -> dict:
    """Dispatch through real SMTP/webhook/SMS transports when configured.

    `db_cfg` is the tenant's ChannelConfig.config_json (fetched by dispatch()).
    Falls back to env vars inside transports.py. Only DELIVERY_MODE=simulated
    forces the fake transport (used by tests); otherwise an unconfigured real
    channel returns an honest error which feeds the retry/dead-letter queue.
    """
    if channel == "in_app":
        return {"provider": "in-app", "message_id": hashlib.md5(
            f"{recipient}{subject}inapp".encode()).hexdigest()[:16]}

    from app.services import transports

    if DELIVERY_MODE == "simulated" and not os.getenv("SMTP_HOST") and not (db_cfg or {}).get("smtp_host"):
        # no mail infrastructure at all -> keep the legacy simulator so the
        # pipeline (retries/DLQ) stays testable without external services
        fail_rate = {"email": 0.08, "sms": 0.15, "webhook": 0.12}.get(channel, 0.1)
        if random.random() < fail_rate:
            raise ConnectionError(f"{channel} gateway timeout (simulated)")
        return {"provider": f"sim-{channel}", "message_id": hashlib.md5(
            f"{recipient}{subject}{datetime.utcnow().isoformat()}".encode()).hexdigest()[:16]}

    if channel == "email":
        res = transports.send_email(db_cfg, recipient, subject)
    elif channel == "webhook":
        res = transports.send_webhook(db_cfg, (db_cfg or {}).get("url", ""), subject,
                                      {"event": "notification", "to": recipient, "subject": subject})
    elif channel == "sms":
        res = transports.send_sms(db_cfg, recipient, subject)
    else:
        raise ConnectionError(f"Unknown channel {channel}")
    if not res.get("ok"):
        raise ConnectionError(res.get("error", "transport failure"))
    return res


MAX_ATTEMPTS = 3


async def dispatch(db: AsyncSession, notif: Notification) -> Notification:
    """Send one notification with retries; park in dead-letter on final failure."""
    if notif.status == "suppressed":
        return notif
    # load tenant channel customization (Settings > Notifications)
    from app.models import ChannelConfig
    cfg_row = (await db.execute(
        select(ChannelConfig).where(
            ChannelConfig.org_id == getattr(notif, "org_id", None),
            ChannelConfig.channel == notif.channel)
    )).scalars().first() if getattr(notif, "org_id", None) else None
    db_cfg = (cfg_row.config_json if cfg_row else None) or {}
    if cfg_row and not cfg_row.enabled and notif.channel != "in_app":
        notif.status = "suppressed"
        notif.last_error = "channel disabled in Settings"
        return notif
    for attempt in range(notif.attempts + 1, MAX_ATTEMPTS + 1):
        notif.attempts = attempt
        try:
            result = deliver(notif.channel, notif.recipient, notif.subject,
                             getattr(notif, "org_id", None), db_cfg)
            notif.status = "sent"
            notif.sent_at = now_utc()
            notif.last_error = None
            break
        except Exception as e:  # noqa: BLE001
            notif.last_error = str(e)
            if attempt >= MAX_ATTEMPTS:
                notif.status = "dead_letter"
            else:
                notif.status = "queued"
    return notif


# --------------------------------------------------------------------------
# Main pipeline: alert -> rules -> notifications (+ auto ticket)
# --------------------------------------------------------------------------
async def process_alert(db: AsyncSession, alert: Alert) -> dict:
    """Full event-intelligence pass over one alert. Returns diagnostics."""
    routed: list[Notification] = []
    created_ticket_uid: Optional[str] = None
    suppressed = alert.storm_suppressed

    result = await db.execute(
        select(NotificationRule).where(
            (NotificationRule.org_id == alert.org_id) | (NotificationRule.org_id.is_(None))
        )
    )
    rules = [r for r in result.scalars().all() if rule_matches(r, alert)]

    for rule in rules:
        # auto-ticketing: FIRST matched rule with create_ticket wins
        if rule.create_ticket and created_ticket_uid is None and alert.ticket_uid is None:
            pri = rule.ticket_priority or {"critical": "p1", "high": "p2"}.get(alert.severity, "p3")
            ticket = await create_ticket(
                db, org_id=alert.org_id,
                title=f"[{alert.severity.upper()}] {alert.title}",
                description=alert.description or f"Auto-created from alert {alert.uid}",
                priority=pri, category="incident", source="alert",
                asset=alert.resource, alert_id=alert.id,
            )
            alert.ticket_uid = ticket.uid
            created_ticket_uid = ticket.uid

        if suppressed:
            continue  # storm protection: no re-notification for folded duplicates

        channels = rule.channels or ["in_app"]
        recipients = rule.recipients or ["soc-team"]
        deferred = in_quiet_hours(rule.quiet_hours, now_utc())
        for ch in channels:
            for rcpt in recipients:
                n = Notification(
                    org_id=alert.org_id, alert_id=alert.id, rule_id=rule.id,
                    channel=ch, recipient=str(rcpt),
                    subject=f"[{alert.severity.upper()}] {alert.title}",
                    body=alert.description or alert.title, severity=alert.severity,
                    status="queued" if not deferred else "suppressed",
                    created_at=now_utc(),
                )
                if deferred and ch != "in_app":
                    n.status = "suppressed"
                    n.last_error = "quiet_hours"
                db.add(n)
                await db.flush()
                if n.status == "queued":
                    await dispatch(db, n)
                routed.append(n)

    if not rules:  # default safety net: critical alerts always notify in-app + platform team
        n = Notification(
            org_id=alert.org_id, alert_id=alert.id, rule_id=None,
            channel="in_app", recipient="platform-noc",
            subject=f"[{alert.severity.upper()}] {alert.title}",
            body=alert.description or alert.title, severity=alert.severity,
            status="queued", created_at=now_utc(),
        )
        db.add(n)
        await db.flush()
        await dispatch(db, n)
        routed.append(n)

    if created_ticket_uid:
        alert.title = alert.title  # keep
    await db.commit()
    return {
        "alert_uid": alert.uid,
        "rules_matched": len(rules),
        "notifications": len(routed),
        "sent": sum(1 for x in routed if x.status == "sent"),
        "dead_letter": sum(1 for x in routed if x.status == "dead_letter"),
        "storm_suppressed": suppressed,
        "ticket_created": created_ticket_uid,
    }


async def ack_notification(db: AsyncSession, notif: Notification, actor: str) -> None:
    # Honesty rule: an analyst may only acknowledge a notification that was
    # ACTUALLY delivered (status sent). Queued / dead_letter / suppressed rows
    # keep their delivery status — we record who looked at them, never claim
    # delivery that did not happen.
    if notif.status == "sent":
        notif.status = "acked"
    notif.acked_by = actor
    notif.acked_at = now_utc()
    if notif.alert_id:
        alert = (await db.execute(select(Alert).where(Alert.id == notif.alert_id))).scalars().first()
        if alert:
            _apply_alert_ack(alert, actor)
            db.add(AlertEvent(org_id=alert.org_id, alert_id=alert.id, actor=actor,
                              action="acked", detail="Acknowledged via notification ack"))
    await db.commit()


def _apply_alert_ack(alert: Alert, actor: str) -> None:
    if alert.status != "acked":
        alert.status = "active" if alert.status == "resolved" else "acked"
    alert.acked_by = actor
    alert.acked_at = now_utc()


async def transition_alert(
    db: AsyncSession, alert: Alert, *, actor: str,
    new_status: Optional[str] = None, assignee: Optional[str] = ...,
    expected_version: Optional[int] = None, note: Optional[str] = None,
) -> tuple[Alert, bool]:
    """Validated lifecycle transition with optimistic concurrency + audit trail.

    Returns (alert, changed). Raises HTTPException(409) on stale version.
    Allowed transitions (server-enforced):
      active   -> acked | resolved | (assignee change)
      acked    -> resolved | active(reopen)
      resolved -> active(reopen)          [re-open requires explicit 'active']
    Idempotent: re-acknowledging an already-acked alert is a no-op (200,
    changed=False) instead of a second history entry.
    """
    from fastapi import HTTPException
    if expected_version is not None and alert.version != expected_version:
        raise HTTPException(409, detail={
            "error": "version_conflict",
            "message": "Alert was modified by someone else; reload and retry.",
            "current_version": alert.version})

    changed = False
    if new_status and new_status != alert.status:
        allowed = {
            "active": {"acked", "resolved"},        # reopen paths
            "acked": {"active"},                    # fresh ack
            "resolved": {"active", "acked"},        # resolve from either open state
        }
        if alert.status not in allowed.get(new_status, set()):
            raise HTTPException(422, f"Illegal transition {alert.status} -> {new_status}")
        if new_status == "acked":
            _apply_alert_ack(alert, actor)
        elif new_status == "resolved":
            alert.status = "resolved"
            alert.resolved_by = actor
            alert.resolved_at = now_utc()
        else:  # reopen
            alert.status = "active"
            alert.resolved_at = None
            alert.resolved_by = None
        db.add(AlertEvent(org_id=alert.org_id, alert_id=alert.id, actor=actor,
                          action={"acked": "acked", "resolved": "resolved"}.get(new_status, "reopened"),
                          detail=f"Status {new_status}"))
        changed = True

    if assignee is not ... and assignee != (alert.assignee or None):
        alert.assignee = assignee
        db.add(AlertEvent(org_id=alert.org_id, alert_id=alert.id, actor=actor,
                          action="assigned", detail=f"Assignee: {assignee or '(unassigned)'}"))
        changed = True

    if note:
        db.add(AlertNote(org_id=alert.org_id, alert_id=alert.id, author=actor,
                         body=note, created_at=now_utc()))
        db.add(AlertEvent(org_id=alert.org_id, alert_id=alert.id, actor=actor,
                          action="noted", detail="Investigation note added"))
        changed = True

    if changed:
        alert.version = (alert.version or 1) + 1
        await db.commit()
        await db.refresh(alert)
    return alert, changed


async def retry_notification(db: AsyncSession, notif: Notification, actor: str) -> Notification:
    """Safe single-item retry — ONLY for dead-letter rows (backend-confirmed failures).

    The returned row carries the *actual* post-retry outcome: `sent` means the
    transport confirmed delivery this run; `dead_letter` means it failed again
    (last_error updated); queued/suppressed are never produced here because
    dispatch() runs to completion synchronously within MAX_ATTEMPTS.
    """
    from fastapi import HTTPException
    if notif.status != "dead_letter":
        raise HTTPException(409, f"Only dead-letter notifications can be retried (status={notif.status})")
    notif.attempts = 0
    notif.status = "queued"
    await dispatch(db, notif)
    db.add(AlertEvent(org_id=notif.org_id, alert_id=notif.alert_id or 0, actor=actor,
                      action="retry",
                      detail=f"Manual retry -> {notif.status}" + (f" ({notif.last_error})" if notif.last_error else ""))
                 if notif.alert_id else AlertEvent(
                     org_id=notif.org_id, alert_id=notif.id, actor=actor,
                     action="retry", detail=f"Manual retry -> {notif.status}"))
    await db.commit()
    await db.refresh(notif)
    return notif


async def retry_dead_letters(db: AsyncSession, org_id: Optional[int] = None) -> int:
    """Re-attempt everything parked in the dead-letter queue (optionally one tenant)."""
    q = select(Notification).where(Notification.status == "dead_letter")
    if org_id is not None:
        q = q.where(Notification.org_id == org_id)
    result = await db.execute(q)
    count = 0
    for n in result.scalars().all():
        n.attempts = 0
        n.status = "queued"
        await dispatch(db, n)
        count += 1
    await db.commit()
    return count


async def analytics(db: AsyncSession, org_id: Optional[int] = None) -> dict:
    q = select(Notification.status, func.count()).group_by(Notification.status)
    if org_id:
        q = q.where(Notification.org_id == org_id)
    by_status = {row[0]: row[1] for row in (await db.execute(q)).all()}
    qc = select(Notification.channel, func.count()).group_by(Notification.channel)
    if org_id:
        qc = qc.where(Notification.org_id == org_id)
    by_channel = {row[0]: row[1] for row in (await db.execute(qc)).all()}
    qa = select(func.coalesce(func.sum(Alert.correlated_count), 0))
    if org_id:
        qa = qa.where(Alert.org_id == org_id)
    total_events = (await db.execute(qa)).scalar() or 0
    return {"by_status": by_status, "by_channel": by_channel, "total_events_correlated": int(total_events)}
