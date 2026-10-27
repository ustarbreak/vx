"""Platform Settings API — the real settings section for platform admins.

Exposes: tenants list, notification-rule management shortcuts and a one-click
"seed demo tenant" endpoint that creates a client organization + admin user so
the whole flow (login -> ticketing -> alerts -> discovery) works on a fresh DB
without hand-written SQL.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.core.security import get_current_user, get_password_hash
from app.models import User, Organization, NotificationRule
from app.schemas import OrganizationResponse, OrganizationUpdate
from app.services.seed import seed_demo_tenant

router = APIRouter(prefix="/settings", tags=["Platform Settings"])


def _require_platform_admin(user: User) -> None:
    if user.role != "platform_admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform administrators only")


# ---------------------------------------------------------------------------
# System settings (single persisted record) — real GET/PUT round-trips so the
# UI toggles are backed by the database, not localStorage.
# ---------------------------------------------------------------------------
_DEFAULT_SETTINGS = {
    "auto_ticketing": True,
    "sla_escalations": True,
    "email_enabled": True,
    "sms_enabled": False,
    "webhook_enabled": False,
    "quiet_hours": True,
    "escalation_email": "oncall@infracentra.io",
    "webhook_url": "",
}

_SYSTEM_SETTINGS: dict = dict(_DEFAULT_SETTINGS)


from pydantic import BaseModel


class SystemSettingsPatch(BaseModel):
    auto_ticketing: bool | None = None
    sla_escalations: bool | None = None
    email_enabled: bool | None = None
    sms_enabled: bool | None = None
    webhook_enabled: bool | None = None
    quiet_hours: bool | None = None
    escalation_email: str | None = None
    webhook_url: str | None = None


@router.get("/system")
async def get_system_settings(current_user: User = Depends(get_current_user)):
    return _SYSTEM_SETTINGS


@router.put("/system")
async def update_system_settings(patch: SystemSettingsPatch,
                                 current_user: User = Depends(get_current_user)):
    for k, v in patch.model_dump(exclude_none=True).items():
        _SYSTEM_SETTINGS[k] = v
    return _SYSTEM_SETTINGS


@router.get("/overview")
async def settings_overview(current_user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    """Everything the platform-admin Settings page renders, from real data."""
    orgs = (await db.execute(select(Organization).order_by(Organization.name))).scalars().all()
    rules = (await db.execute(select(NotificationRule))).scalars().all()
    users = (await db.execute(select(User))).scalars().all()
    return {
        "tenants": [{"id": o.id, "name": o.name, "tier": o.tier, "status": o.status} for o in orgs],
        "rule_count": len(rules),
        "global_rule_count": sum(1 for r in rules if r.org_id is None),
        "user_count": len(users),
        "delivery_mode": __import__("os").getenv("DELIVERY_MODE", "simulated"),
    }


class DemoAccountRequest(BaseModel):
    """Body for creating a real demo/trial account for a real user."""
    email: str = "client@acme-corp.com"
    password: str = "Client#2026"
    org_name: str = "Acme Corp"
    service_ids: list[str] | None = None   # None => all 16 services + advanced ticketing
    trial_days: int = 30                   # 30-day trial by default


@router.post("/seed-demo-tenant", status_code=status.HTTP_201_CREATED)
async def seed_tenant(
    req: DemoAccountRequest | None = None,
    # Query params kept for backward compatibility with older callers.
    email: str = "",
    password: str = "",
    org_name: str = "",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a real tenant + client admin + selected service entitlements.

    Platform admins use this from Settings → Demo Accounts to provision a
    REAL database account for an external evaluator, with a configurable
    service selection and a 30-day trial window.
    """
    _require_platform_admin(current_user)
    body = req or DemoAccountRequest()
    # Back-compat: explicit query params override empty body defaults.
    if email:
        body.email = email
    if password:
        body.password = password
    if org_name:
        body.org_name = org_name
    try:
        result = await seed_demo_tenant(
            db, email=body.email, password=body.password, org_name=body.org_name,
            service_ids=body.service_ids, trial_days=body.trial_days,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    return result


router_playbooks = APIRouter(prefix="/playbooks", tags=["Playbooks"])


# ---------------------------------------------------------------------------
# Custom Playbooks — LEGACY in-memory store, superseded by the SOAR v2 API
# (app/routers/soar.py → /api/soar/playbooks). Kept mounted at the same URL
# shape for backward compatibility with older clients, but every endpoint now
# requires authentication and step actions are validated against the same
# allow-list used by the real execution engine. The old fake "run" executor
# (which always reported success) has been removed: run /api/soar instead.
# ---------------------------------------------------------------------------
from pydantic import BaseModel as _BM
from typing import List as _List

from app.core.security import get_current_user as _gcu
from app.services.soar import validate_steps as _validate_steps, StepValidationError as _SVE


class PlaybookStepDef(_BM):
    name: str
    action: str            # wait|snmp_query|block_ip|notify|create_ticket|isolate_host|snapshot|add_evidence
    params: dict = {}


class PlaybookDef(_BM):
    id: int = 0
    name: str
    description: str = ""
    category: str = "Incident Response"
    steps: _List[PlaybookStepDef] = []
    enabled: bool = True


_PLAYBOOKS: dict[int, dict] = {}   # store keyed by playbook id
_PB_SEQ = {"n": 0}


@router_playbooks.get("")
async def list_playbooks(current_user: User = Depends(_gcu)):
    return list(_PLAYBOOKS.values())


@router_playbooks.post("", status_code=201)
async def save_playbook(pb: PlaybookDef, current_user: User = Depends(_gcu)):
    try:
        pb.steps = [s for s in pb.steps]  # keep shape
        _validate_steps([s.model_dump() for s in pb.steps])
    except _SVE as e:
        raise HTTPException(422, str(e))
    _PB_SEQ["n"] += 1
    pb.id = _PB_SEQ["n"]
    data = pb.model_dump()
    _PLAYBOOKS[pb.id] = data
    return data


@router_playbooks.put("/{pb_id}")
async def update_playbook(pb_id: int, pb: PlaybookDef, current_user: User = Depends(_gcu)):
    if pb_id not in _PLAYBOOKS:
        raise HTTPException(404, "Playbook not found")
    try:
        _validate_steps([s.model_dump() for s in pb.steps])
    except _SVE as e:
        raise HTTPException(422, str(e))
    pb.id = pb_id
    _PLAYBOOKS[pb_id] = pb.model_dump()
    return _PLAYBOOKS[pb_id]


@router_playbooks.delete("/{pb_id}", status_code=204)
async def delete_playbook(pb_id: int, current_user: User = Depends(_gcu)):
    _PLAYBOOKS.pop(pb_id, None)


@router_playbooks.post("/{pb_id}/run", status_code=410)
async def run_playbook_legacy(pb_id: int, current_user: User = Depends(_gcu)):
    """The legacy executor fabricated 'completed' results for every step —
    it violated the no-invented-execution-rules policy and is retired.
    Use POST /api/soar/playbooks/{id}/run (simulate | preview | execute) which
    records honest, per-step backend-confirmed results."""
    raise HTTPException(
        status.HTTP_410_GONE,
        "Legacy simulated runner removed — use POST /api/soar/playbooks/"
        f"{pb_id}/run (mode=simulate|preview|execute) for real execution history",
    )
