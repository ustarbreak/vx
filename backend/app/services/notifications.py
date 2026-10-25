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

from app.models import Alert, NotificationRule, Notification, Ticket, Organization
from app.services.ticketing import create_ticket, now_utc

DELIVERY_MODE = os.getenv("DELIVERY_MODE", "simulated")

SEVERITY_RANK = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}


async def next_uid(db: AsyncSession, model, prefix: str) -> str:
    count = len((await db.execute(select(model.id))).scalars().all())
    return f"{prefix}-{count + 1:06d}"


# --------------------------------------------------------------------------
# Correlation & storm protection
# --------------------------------------------------------------------------
def dedup_fingerprint(alert: Alert) -> str:
    base = f"{alert.org_id}|{alert.source}|{alert.resource or ''}|{alert.title.lower().strip()}"
    return hashlib.sha1(base.encode()).hexdigest()[:16]


async def correlate(db: AsyncSession, alert: Alert) -> Alert:
    """If an identical alert occurred within the last hour, fold into it."""
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
        alert.dedup_key = fp
        alert.correlated_count = existing.correlated_count
        # storm protection: suppress re-notification after 5 duplicates/hour
        alert.storm_suppressed = existing.correlated_count > 5
        await db.commit()
        await db.refresh(alert)
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
    notif.status = "acked" if notif.status == "sent" else notif.status
    notif.acked_by = actor
    notif.acked_at = now_utc()
    if notif.alert_id:
        alert = (await db.execute(select(Alert).where(Alert.id == notif.alert_id))).scalars().first()
        if alert:
            alert.acked_by = actor
            alert.acked_at = now_utc()
    await db.commit()


async def retry_dead_letters(db: AsyncSession) -> int:
    """Re-attempt everything parked in the dead-letter queue."""
    result = await db.execute(select(Notification).where(Notification.status == "dead_letter"))
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
