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
from app.models import User, Invitation, ChannelConfig, Organization, AuditLog
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
    """Resolve invitation scope without allowing caller-selected tenant changes."""
    if user.role == "platform_admin":
        if requested_org is None:
            raise HTTPException(422, "Platform admins must provide org_id for an invitation")
        return requested_org
    if user.role != "client_admin":
        raise HTTPException(403, "Only client admins can invite users for their organization")
    if not user.org_id:
        raise HTTPException(400, "User has no organization")
    if requested_org is not None and requested_org != user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    return user.org_id


CLIENT_INVITABLE_ROLES = {"technician", "analyst", "client_user"}
PLATFORM_INVITABLE_ROLES = CLIENT_INVITABLE_ROLES | {"client_admin"}


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
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(422, "A valid email address is required")

    allowed_roles = PLATFORM_INVITABLE_ROLES if current_user.role == "platform_admin" else CLIENT_INVITABLE_ROLES
    role = body.role.strip().lower()
    if role not in allowed_roles:
        raise HTTPException(403, "Role '" + role + "' cannot be assigned through invitations")

    organization = (await db.execute(select(Organization).where(Organization.id == org))).scalars().first()
    if not organization:
        raise HTTPException(404, "Organization not found")

    existing_user = (await db.execute(select(User).where(User.email == email))).scalars().first()
    if existing_user:
        raise HTTPException(409, "A user with this email already exists")

    # Pending invitations are globally unique by email in practice. Never reuse
    # another tenant's token or resend it using the caller's requested org.
    pending = (await db.execute(select(Invitation).where(
        Invitation.email == email, Invitation.status.in_(["pending", "sent"])
    ))).scalars().first()
    if pending and pending.org_id != org:
        raise HTTPException(409, "This email already has a pending invitation for another organization")
    if pending and pending.role != role:
        raise HTTPException(409, "This email already has a pending invitation with a different role")

    inv = pending
    if not inv:
        inv = Invitation(org_id=org, email=email, role=role,
                         token=secrets.token_urlsafe(24))
        db.add(inv)
        await db.flush()

    sent = await _send_activation(db, inv, org, current_user.email)
    db.add(AuditLog(
        actor_id=current_user.id, actor_name=current_user.email,
        actor_role=current_user.role, org_id=org,
        action="invitation.created" if not pending else "invitation.resent",
        resource="Invitation", resource_id=str(inv.id),
        details="Invitation for " + email + " with role " + role,
        outcome="success" if sent else "pending",
    ))
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
