"""Channel configuration API (Settings > Notifications for client admins,
and platform admins for any tenant). Real backend: stores per-tenant SMTP /
webhook / SMS customization in `channel_configs` and exposes a real
"Send test" endpoint that actually dispatches through transports.py."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.core.security import get_current_user
from app.models import User, ChannelConfig, AuditLog
from app.core.platform_rbac import has_permission, is_platform_role
from app.services import transports

router = APIRouter(prefix="/channels", tags=["Notification Channels"])

CHANNELS = ("email", "webhook", "sms")


def _scope_org(user: User, requested_org: int | None) -> int:
    if user.role == "platform_admin" or is_platform_role(user.role):
        if requested_org is None:
            raise HTTPException(422, "Platform staff must select an explicit tenant scope")
        return requested_org
    if user.role != "client_admin" or not user.org_id:
        raise HTTPException(403, "Client administrator access required")
    if requested_org is not None and requested_org != user.org_id:
        raise HTTPException(403, "Cross-tenant channel access denied")
    return user.org_id


async def _authorize_channel_access(user: User, db: AsyncSession, org_id: int, permission: str) -> None:
    if user.role == "platform_admin":
        return
    if is_platform_role(user.role):
        if not await has_permission(user, permission, db, org_id=org_id):
            raise HTTPException(403, "Insufficient channel permission for this tenant")
        return
    if user.role == "client_admin" and user.org_id == org_id:
        return
    raise HTTPException(403, "Insufficient channel permission")


class ChannelConfigBody(BaseModel):
    channel: str
    enabled: bool = True
    config: dict = {}
    org_id: int | None = None


@router.get("/configs")
async def list_configs(org_id: int | None = None,
                      current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    scope = _scope_org(current_user, org_id)
    await _authorize_channel_access(current_user, db, scope, "platform.channels.read")
    rows = (await db.execute(
        select(ChannelConfig).where(ChannelConfig.org_id == scope))).scalars().all()
    out = {}
    for ch in CHANNELS:
        row = next((r for r in rows if r.channel == ch), None)
        cfg = dict(row.config_json or {}) if row else {}
        # never echo secrets back to the UI
        for k in ("smtp_password", "twilio_auth_token", "secret", "webhook_secret", "api_key", "auth_token", "password"):
            if cfg.get(k):
                cfg[k] = "********"
        out[ch] = {
            "enabled": bool(row.enabled) if row else False,
            "configured": bool(cfg),
            "config": cfg,
        }
    return out


@router.put("/configs")
async def save_config(body: ChannelConfigBody,
                     current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    if body.channel not in CHANNELS:
        raise HTTPException(422, f"channel must be one of {CHANNELS}")
    scope = _scope_org(current_user, body.org_id)
    await _authorize_channel_access(current_user, db, scope, "platform.channels.manage")
    row = (await db.execute(select(ChannelConfig).where(
        ChannelConfig.org_id == scope, ChannelConfig.channel == body.channel
    ))).scalars().first()
    if not row:
        row = ChannelConfig(org_id=scope, channel=body.channel)
        db.add(row)
    # keep existing secrets when UI sent masked placeholders
    merged = dict(row.config_json or {})
    for k, v in (body.config or {}).items():
        if v == "********":
            continue
        merged[k] = v
    row.config_json = merged
    row.enabled = body.enabled
    db.add(AuditLog(
        actor_id=current_user.id, actor_name=current_user.email, actor_role=current_user.role,
        org_id=scope, action="notification_channel.config_updated",
        resource="ChannelConfig", resource_id=f"{scope}:{body.channel}",
        details=f"Updated {body.channel} channel configuration (secret values omitted)",
        outcome="success",
    ))
    await db.commit()
    await db.refresh(row)
    return {"ok": True, "channel": row.channel, "enabled": row.enabled}


@router.post("/test")
async def test_channel(body: ChannelConfigBody,
                       current_user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    """Actually send a test email/webhook/SMS using the saved configuration."""
    if body.channel not in CHANNELS:
        raise HTTPException(422, "invalid channel")
    scope = _scope_org(current_user, body.org_id)
    await _authorize_channel_access(current_user, db, scope, "platform.channels.test")
    row = (await db.execute(select(ChannelConfig).where(
        ChannelConfig.org_id == scope, ChannelConfig.channel == body.channel
    ))).scalars().first()
    cfg = dict(row.config_json or {}) if row else {}
    cfg.update({k: v for k, v in (body.config or {}).items() if v != "********"})
    subject = "[INFRAvx] Test notification"

    if body.channel == "email":
        recipient = cfg.get("test_recipient") or current_user.email
        res = transports.send_email(cfg, recipient, subject,
                                    "If you received this, your SMTP channel works.")
    elif body.channel == "webhook":
        res = transports.send_webhook(cfg, cfg.get("url", ""), subject,
                                      {"event": "test", "org_id": scope})
    else:
        res = transports.send_sms(cfg, cfg.get("test_number", ""), subject)
    db.add(AuditLog(
        actor_id=current_user.id, actor_name=current_user.email, actor_role=current_user.role,
        org_id=scope, action="notification_channel.test_sent",
        resource="ChannelConfig", resource_id=f"{scope}:{body.channel}",
        details=f"Test delivery attempted for {body.channel} channel",
        outcome="success" if res.get("ok", False) else "failure",
    ))
    await db.commit()
    return {"channel": body.channel, **res}
