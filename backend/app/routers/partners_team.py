"""Partner Portal — Phase 5.1/5.4: team users, partner audit log, enablement & support.

Routes (all under /api/partners, scoped to the caller's own partner org):

  GET    /partners/{pid}/team                 list partner-team users (partner_admin only)
  POST   /partners/{pid}/team                 invite/create user with a validated role
  PATCH  /partners/{pid}/team/{uid}           change role / status (no self-demotion)
  DELETE /partners/{pid}/team/{uid}           deactivate + strip MFA secret
  GET    /partners/{pid}/audit                partner-level audit trail (own org rows only)
  GET    /partners/{pid}/sales-kit            static sales-kit manifest (decks/datasheets/ROI)
  POST   /partners/{pid}/support/escalate     escalation ticket to the vendor (audited)

HARD RULES honoured:
  * rule 1 — every query is filtered by the resolved partner org; uid targets are
    re-checked against that org (cross-org id -> 403 "Cross-partner access denied").
  * rule 5 — roles are Pydantic Literals ("partner_admin|analyst|billing|read_only"),
    never free text; writes rate-limited and audited into AuditLog.
  * rule 3 — no mock fallback: non-partner callers get 404 "not configured".
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user, get_password_hash
from app.database import get_db
from app.models import AuditLog, Organization, TenantSetting, UserTotpSecret, User
from app.routers.partners import (
    _audit, _children, _partner_out, _rate_limit, _resolve_partner,
    _save_settings, _settings,
)

router = APIRouter(prefix="/partners", tags=["Partner Portal Team"])

TEAM_ROLES = ("partner_admin", "analyst", "billing", "read_only")


async def partner_requires_mfa(db: AsyncSession, org_id: int) -> bool:
    """Per-partner MFA enforcement policy (Phase 5.1). Stored in the existing
    TenantSetting JSON under key 'mfa_policy' — no schema change, no migration.
    Default: not enforced."""
    data = await _settings(db, org_id)
    return bool((data.get("mfa_policy") or {}).get("require_mfa", False))


class TeamUserOut(BaseModel):
    id: int
    name: str
    email: str
    role: str
    status: str
    mfa_enabled: bool
    last_login: Optional[str] = None
    mfa_required: bool = False       # per-partner enforcement policy
    mfa_enrollment_pending: bool = False  # required but not enrolled yet


class TeamUserIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    role: Literal["partner_admin", "analyst", "billing", "read_only"]
    # Initial password is optional: when absent the account stays in "pending"
    # until an activation flow sets one (never defaults to a shared secret).
    password: Optional[str] = Field(default=None, min_length=8, max_length=200)


class TeamUserPatch(BaseModel):
    role: Optional[Literal["partner_admin", "analyst", "billing", "read_only"]] = None
    status: Optional[Literal["active", "pending", "disabled"]] = None


class MfaPolicyIn(BaseModel):
    require_mfa: bool


def _out(u: User, mfa_required: bool = False) -> dict:
    return TeamUserOut(
        id=u.id, name=u.name or "", email=u.email, role=u.role,
        status=u.status or "active", mfa_enabled=bool(u.mfa_enabled),
        last_login=u.last_login.isoformat() if u.last_login else None,
        mfa_required=mfa_required,
        mfa_enrollment_pending=bool(mfa_required and not u.mfa_enabled
                                    and (u.status or "active") == "active"),
    ).model_dump()


@router.get("/{pid}/team")
async def team_list(pid: str, request: Request,
                    user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    if user.role not in ("partner_admin", "platform_admin"):
        raise HTTPException(403, "Insufficient permissions")
    rows = (await db.execute(select(User).where(User.org_id == partner.id).order_by(User.id))
            ).scalars().all()
    required = await partner_requires_mfa(db, partner.id)
    return {"items": [_out(u, required) for u in rows]}


# --------------------------------------------------------------------------- #
# 5.1 MFA enforcement policy (per-partner toggle)                             #
# --------------------------------------------------------------------------- #
@router.get("/{pid}/mfa-policy")
async def get_mfa_policy(pid: str, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """Current enforcement state + compliance snapshot (partner_admin only)."""
    partner = await _resolve_partner(pid, user, db)
    if user.role not in ("partner_admin", "platform_admin"):
        raise HTTPException(403, "Insufficient permissions")
    required = await partner_requires_mfa(db, partner.id)
    team = (await db.execute(select(User).where(User.org_id == partner.id))
            ).scalars().all()
    active = [u for u in team if (u.status or "active") == "active"]
    enrolled = [u for u in active if u.mfa_enabled]
    return {
        "require_mfa": required,
        "team_size": len(active),
        "mfa_enrolled": len(enrolled),
        "non_compliant_emails": sorted(u.email for u in active if not u.mfa_enabled)
                                if required else [],
    }


@router.put("/{pid}/mfa-policy")
async def put_mfa_policy(pid: str, body: MfaPolicyIn, request: Request,
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """Enable/disable MFA enforcement for all active team members of this partner.

    Enforcement point: /api/auth/login checks this policy and returns an explicit
    mfa_setup_required challenge for non-enrolled accounts (see auth.py). No
    password is ever bypassed; enabling the policy never locks anyone out — it
    routes them through /mfa/setup first."""
    _rate_limit(f"mfapol:{user.id}", max_calls=10)
    partner = await _resolve_partner(pid, user, db)
    if user.role != "partner_admin" and user.role != "platform_admin":
        raise HTTPException(403, "Insufficient permissions")
    data = await _settings(db, partner.id)
    data["mfa_policy"] = {"require_mfa": body.require_mfa,
                          "updated_at": datetime.now(timezone.utc).isoformat(),
                          "updated_by": user.email}
    await _save_settings(db, partner.id, data)
    db.add(_audit(user, "partner.mfa_policy.update", str(partner.id),
                  f"require_mfa={body.require_mfa}", partner.id))
    await db.commit()
    return {"ok": True, "require_mfa": body.require_mfa}


@router.post("/{pid}/team", status_code=201)
async def team_create(pid: str, body: TeamUserIn, request: Request,
                      user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    _rate_limit(f"team:{user.id}", max_calls=10)
    partner = await _resolve_partner(pid, user, db)
    if user.role != "partner_admin" and user.role != "platform_admin":
        raise HTTPException(403, "Insufficient permissions")
    dup = (await db.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "Un compte existe déjà avec cet email")
    u = User(
        email=body.email.lower(),
        hashed_password=get_password_hash(body.password) if body.password else "!",
        name=body.name, role=body.role, org_id=partner.id,
        status="active" if body.password else "pending",
        mfa_enabled=False,
    )
    db.add(u)
    db.add(_audit(user, "partner.team.create", str(partner.id),
                  f"{body.role} {body.email.lower()} org={partner.id}", partner.id))
    await db.commit()
    await db.refresh(u)
    return _out(u, await partner_requires_mfa(db, partner.id))


@router.patch("/{pid}/team/{uid}")
async def team_patch(pid: str, uid: int, body: TeamUserPatch, request: Request,
                     user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    _rate_limit(f"team:{user.id}", max_calls=10)
    partner = await _resolve_partner(pid, user, db)
    if user.role != "partner_admin" and user.role != "platform_admin":
        raise HTTPException(403, "Insufficient permissions")
    target = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if not target or target.org_id != partner.id:
        raise HTTPException(403, "Cross-partner access denied")
    if target.id == user.id and body.role in ("analyst", "billing", "read_only"):
        raise HTTPException(400, "Auto-rétrogradation refusée — utilisez un autre administrateur")
    if target.id == user.id and body.status == "disabled":
        raise HTTPException(400, "Impossible de désactiver son propre compte")
    changes = []
    if body.role:
        changes.append(f"role->{body.role}"); target.role = body.role
    if body.status:
        changes.append(f"status->{body.status}"); target.status = body.status
        if body.status == "disabled":
            target.mfa_enabled = False
            await db.execute(UserTotpSecret.__table__.delete().where(UserTotpSecret.user_id == target.id))
    db.add(_audit(user, "partner.team.update", str(target.id),
                  ", ".join(changes) or "noop", partner.id))
    await db.commit()
    return _out(target, await partner_requires_mfa(db, partner.id))


@router.delete("/{pid}/team/{uid}", status_code=204)
async def team_delete(pid: str, uid: int,
                      user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    _rate_limit(f"team:{user.id}", max_calls=10)
    partner = await _resolve_partner(pid, user, db)
    if user.role != "partner_admin" and user.role != "platform_admin":
        raise HTTPException(403, "Insufficient permissions")
    target = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if not target or target.org_id != partner.id:
        raise HTTPException(403, "Cross-partner access denied")
    if target.id == user.id:
        raise HTTPException(422, "Impossible de supprimer son propre compte")
    admins = (await db.execute(select(User).where(User.org_id == partner.id)
                               .where(User.role == "partner_admin")
                               .where(User.status == "active"))).scalars().all()
    if target.role == "partner_admin" and len(admins) <= 1:
        raise HTTPException(422, "Au moins un administrateur partenaire actif est requis")
    target.status = "disabled"
    target.mfa_enabled = False
    await db.execute(UserTotpSecret.__table__.delete().where(UserTotpSecret.user_id == target.id))
    db.add(_audit(user, "partner.team.delete", str(target.id), f"deactivated {target.email}", partner.id))
    await db.commit()


@router.get("/{pid}/audit")
async def partner_audit(pid: str, limit: int = 100,
                        user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    """Partner-level audit trail: rows whose org_id is the partner OR one of its children."""
    partner = await _resolve_partner(pid, user, db)
    kids = await _children(db, partner.id)
    org_ids = [partner.id] + [c.id for c in kids]
    limit = max(1, min(limit, 500))
    rows = (await db.execute(select(AuditLog).where(AuditLog.org_id.in_(org_ids))
                              .order_by(AuditLog.id.desc()).limit(limit))).scalars().all()
    return {"items": [{
        "id": r.id, "action": r.action, "actor_name": r.actor_name, "actor_role": r.actor_role,
        "org_id": r.org_id, "resource": r.resource, "resource_id": r.resource_id,
        "details": r.details, "outcome": r.outcome,
        "created_at": r.timestamp.isoformat() if r.timestamp else None,
    } for r in rows]}


# --------------------------------------------------------------------------- #
# 5.4 Enablement: sales kit (static manifest) + vendor support escalation      #
# --------------------------------------------------------------------------- #
_SALES_KIT = [
    {"id": "deck-soc-overview", "type": "deck", "title": "SOC 24/7 — Présentation partenaire",
     "file": "assets/saleskit/soc-overview.pdf", "updated": "2026-10-02"},
    {"id": "datasheet-agent", "type": "datasheet", "title": "Fiche technique — Agent Go InfraCentra",
     "file": "assets/saleskit/agent-datasheet.pdf", "updated": "2026-09-15"},
    {"id": "datasheet-pricing", "type": "datasheet", "title": "Grille tarifaire MAD (wholesale)",
     "file": "assets/saleskit/pricing-mad.pdf", "updated": "2026-10-01"},
    {"id": "roi-calculator", "type": "calculator", "title": "Calculateur ROI client",
     "url": "/pricing?roi=1", "updated": "2026-10-02"},
]


@router.get("/{pid}/sales-kit")
async def sales_kit(pid: str, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    await _resolve_partner(pid, user, db)
    return {"items": _SALES_KIT}


class EscalationIn(BaseModel):
    subject: str = Field(min_length=5, max_length=200)
    description: str = Field(min_length=10, max_length=4000)
    severity: Literal["low", "medium", "high", "critical"] = "medium"
    client_org_id: Optional[int] = None


@router.post("/{pid}/support/escalate", status_code=201)
async def escalate_to_vendor(pid: str, body: EscalationIn,
                             user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    _rate_limit(f"esc:{user.id}", max_calls=5)
    partner = await _resolve_partner(pid, user, db)
    # rule 1: an escalation may reference only the partner's own clients.
    if body.client_org_id is not None:
        kids = await _children(db, partner.id)
        if body.client_org_id not in {c.id for c in kids}:
            raise HTTPException(403, "Cross-partner access denied")
    ref = f"ESC-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{partner.id}"
    db.add(_audit(user, "partner.support.escalate", ref,
                  f"[{body.severity}] {body.subject} client={body.client_org_id}", partner.id))
    await db.commit()
    return {"ok": True, "reference": ref,
            "sla_response_hours": {"low": 48, "medium": 24, "high": 8, "critical": 2}[body.severity]}
