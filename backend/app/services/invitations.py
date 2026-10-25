"""Technician / user activation invitations — real backend.

POST /invitations            -> creates the invitation row AND immediately
                               tries to send the activation email through the
                               tenant's configured SMTP channel (transports.py).
                               If no mail server is set up yet, the invitation
                               stays status=pending with the error recorded —
                               it is NOT lost; POST /invitations/{id}/resend
                               retries once your mail server exists.
GET  /invitations            -> list for the tenant (status column in UI)
POST /invitations/accept     -> public: token -> creates the User with a
                               chosen password, marks accepted.
The frontend Technicians page calls these; demo mode never reaches them.
"""
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.core.security import get_current_user, get_password_hash
from app.models import User, Invitation, ChannelConfig
from app.services import transports

router = APIRouter(prefix="/invitations", tags=["Activation Emails"])

BASE_URL = __import__("os").getenv("APP_BASE_URL", "http://localhost:5173")


class InviteCreate(BaseModel):
    email: str
    name: str = ""
    role: str = "technician"
    org_id: int | None = None


class InviteAccept(BaseModel):
    token: str
    password: str
    name: str = ""


def _scope_org(user: User, requested_org: int | None) -> int:
    if user.role == "platform_admin":
        return requested_org or (user.org_id or 1)
    if not user.org_id:
        raise HTTPException(400, "User has no organization")
    return user.org_id


async def _send_activation(db: AsyncSession, inv: Invitation, org_id: int, actor_email: str) -> bool:
    cfg_row = (await db.execute(select(ChannelConfig).where(
        ChannelConfig.org_id == org_id, ChannelConfig.channel == "email"))).scalars().first()
    cfg = dict(cfg_row.config_json or {}) if cfg_row else {}
    link = f"{BASE_URL}/#/invite?token={inv.token}"
    body = (f"Hello {inv.email},\n\n"
            f"{actor_email} invited you to INFRAvx as {inv.role}.\n"
            f"Activate your account (valid until used):\n{link}\n\n— INFRAvx Platform")
    res = transports.send_email(cfg, inv.email, "[INFRAvx] Activate your account", body)
    if res.get("ok"):
        inv.status, inv.error, inv.sent_at = "sent", "", datetime.now(timezone.utc)
        return True
    inv.status, inv.error = "pending", res.get("error", "unknown")
    return False


@router.post("", status_code=201)
async def create_invitation(body: InviteCreate, current_user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    org = _scope_org(current_user, body.org_id)
    existing_user = (await db.execute(select(User).where(
        User.email == body.email.lower()))).scalars().first()
    if existing_user:
        raise HTTPException(409, "A user with this email already exists")
    inv = (await db.execute(select(Invitation).where(
        Invitation.email == body.email.lower(), Invitation.status.in_(["pending", "sent"])))).scalars().first()
    if not inv:
        inv = Invitation(org_id=org, email=body.email.lower(), role=body.role,
                         token=secrets.token_urlsafe(24))
        db.add(inv)
        await db.flush()
    sent = await _send_activation(db, inv, org, current_user.email)
    await db.commit()
    await db.refresh(inv)
    return {"id": inv.id, "email": inv.email, "status": inv.status,
            "activation_link": f"{BASE_URL}/#/invite?token={inv.token}",
            "delivery_error": inv.error or None,
            "note": None if sent else "No SMTP configured yet — invitation queued; use Resend after setting up mail."}


@router.get("")
async def list_invitations(org_id: int | None = None,
                           current_user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    stmt = select(Invitation).order_by(Invitation.created_at.desc())
    if current_user.role != "platform_admin":
        stmt = stmt.where(Invitation.org_id == current_user.org_id)
    elif org_id:
        stmt = stmt.where(Invitation.org_id == org_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [{"id": i.id, "email": i.email, "role": i.role, "status": i.status,
             "error": i.error, "created_at": i.created_at.isoformat() if i.created_at else None,
             "sent_at": i.sent_at.isoformat() if i.sent_at else None} for i in rows]


@router.post("/{inv_id}/resend")
async def resend(inv_id: int, current_user: User = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)):
    inv = (await db.execute(select(Invitation).where(Invitation.id == inv_id))).scalars().first()
    if not inv:
        raise HTTPException(404, "Invitation not found")
    if current_user.role != "platform_admin" and inv.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    sent = await _send_activation(db, inv, inv.org_id, current_user.email)
    await db.commit()
    return {"ok": sent, "status": inv.status, "error": inv.error or None}


@router.post("/accept")
async def accept(body: InviteAccept, db: AsyncSession = Depends(get_db)):
    """Public endpoint: activate an invited account by choosing a password."""
    inv = (await db.execute(select(Invitation).where(
        Invitation.token == body.token, Invitation.status.in_(["pending", "sent"])))).scalars().first()
    if not inv:
        raise HTTPException(404, "Invalid or already-used activation token")
    if len(body.password) < 8:
        raise HTTPException(422, "Password too short (min 8 chars)")
    user = User(email=inv.email, hashed_password=get_password_hash(body.password),
                name=body.name or inv.email.split("@")[0], role=inv.role,
                org_id=inv.org_id, is_active=True)
    db.add(user)
    inv.status = "accepted"
    await db.commit()
    return {"ok": True, "email": user.email, "role": user.role}
