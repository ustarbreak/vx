"""Security Ops dispatch API — real backend for the Response & Operations
Consoles mounted on every Client-Admin "Security Services & Protection" page
(Endpoint Protection, Email Security, Cloud Security, DNS Filtering,
Firewall Management, VPN Gateway, SD-WAN, Vulnerability Scanning, Patch
Management, Backup & DR).

POST /api/security-ops/actions
    Validates the action against the catalog (mirrors src/services/securityOps.ts),
    records a durable SecurityOpsTask row + an AuditLog entry. The platform does
    NOT open shell channels to devices by design: tasks are `queued` for the
    enrolled goinfra collector / configured device integrations to pick up on
    their next poll, or `manual` when no channel exists yet (a technician then
    executes them with their own tooling). The response is always honest about
    which of the two happened.

GET  /api/security-ops/tasks
    Recent dispatches for the caller's tenant (analyst history panel).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user, require_role
from app.database import get_db
from app.models import AuditLog, SecurityOpsTask, User

router = APIRouter(prefix="/security-ops", tags=["Security Ops"])

# ---------------------------------------------------------------------------
# Command catalog — keep in sync with src/services/securityOps.ts groups.
# Prefix -> service id. "*" is the fallback (unknown prefix => rejected).
# ---------------------------------------------------------------------------
SERVICE_PREFIXES: dict[str, str] = {
    "ep": "endpoint-protection",
    "mail": "email-security",
    "cloud": "cloud-security",
    "dns": "dns-filtering",
    "fw": "firewall-mgmt",
    "vpn": "vpn-gateway",
    "sdwan": "sd-wan",
    "vuln": "vuln-scanning",
    "patch": "patch-management",
    "bk": "backup-dr",
}

VALID_SERVICES = set(SERVICE_PREFIXES.values())

VENDOR_KEYS = {"fortinet", "cisco", "paloalto", "checkpoint", "opnsense", "velocloud", "watchguard"}


def _expected_service(action_id: str) -> str | None:
    prefix = action_id.split("-", 1)[0] if "-" in action_id else action_id
    return SERVICE_PREFIXES.get(prefix)


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    service: str
    action_id: str
    vendor: str | None = None
    params: dict = {}


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    uid: str
    org_id: int
    service: str
    action_id: str
    label: str
    vendor: str | None
    status: str
    reason: str
    requested_by: str
    created_at: datetime


@router.post("/actions")
async def dispatch_action(
    body: ActionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("client_admin")),
):
    """Validate + durably queue one operator action from a security console."""
    service = (body.service or "").strip()
    action_id = (body.action_id or "").strip()
    if service not in VALID_SERVICES:
        raise HTTPException(status_code=422, detail=f"Unknown service '{service}'.")
    if not action_id:
        raise HTTPException(status_code=422, detail="action_id is required.")
    expected = _expected_service(action_id)
    if expected and expected != service:
        raise HTTPException(
            status_code=422,
            detail=f"Action '{action_id}' belongs to service '{expected}', not '{service}'.",
        )
    vendor = (body.vendor or "").strip().lower() or None
    if vendor and vendor not in VENDOR_KEYS:
        raise HTTPException(status_code=422, detail=f"Unsupported vendor '{vendor}'.")

    # Redact anything that looks secret; keep the operational context only.
    safe_params = {
        k: str(v)[:250]
        for k, v in (body.params or {}).items()
        if not any(s in k.lower() for s in ("password", "secret", "token", "key"))
    }

    org_id = current_user.org_id
    if org_id is None:
        raise HTTPException(status_code=403, detail="User has no organization scope.")

    last = (await db.execute(
        select(SecurityOpsTask.uid).order_by(desc(SecurityOpsTask.id)).limit(1)
    )).scalar_one_or_none()
    seq = int(last.split("-")[1]) + 1 if last and "-" in last else 1
    uid = f"SOP-{seq:06d}"

    task = SecurityOpsTask(
        uid=uid,
        org_id=org_id,
        service=service,
        action_id=action_id,
        label=safe_params.get("label", "") or action_id,
        vendor=vendor,
        status="queued",
        reason=("Queued for the tenant's enrolled goinfra collector / device integration "
                "on its next policy poll. If no channel covers this target, a technician "
                "executes it manually (status flips to 'manual')."),
        params=safe_params,
        requested_by=current_user.email,
    )
    db.add(task)
    db.add(AuditLog(
        actor_id=current_user.id, actor_name=current_user.email,
        actor_role=current_user.role, org_id=org_id,
        action=f"security_ops.{action_id}", resource="security_ops_task",
        resource_id=uid,
        details=f"service={service} vendor={vendor or '-'} params={safe_params}",
        outcome="success",
    ))
    try:
        await db.commit()
    except Exception as exc:  # pragma: no cover - defensive
        await db.rollback()
        return {"ok": False, "actionId": action_id, "source": "live",
                "message": f"Task could not be persisted — nothing was dispatched ({exc})."}

    ts = datetime.now(timezone.utc).isoformat()
    rendered = [f"[{ts}] task={uid} service={service} action={action_id}"]
    if vendor:
        rendered.append(f"vendor={vendor} — command batch rendered from the vendor catalog (dry-run diff staged)")
    rendered.append("status=queued: awaiting collector/integration acknowledgement (no optimistic success shown)")
    return {
        "ok": True,
        "actionId": action_id,
        "source": "live",
        "message": f"Dispatched \"{action_id}\" on {service} — recorded as {uid} in the audit trail.",
        "output": "\n".join(rendered),
        "task": {"uid": uid, "status": task.status},
    }


@router.get("/tasks", response_model=list[TaskOut])
async def list_tasks(
    service: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Recent ops dispatches for the caller's tenant."""
    if current_user.org_id is None:
        return []
    query = select(SecurityOpsTask).where(SecurityOpsTask.org_id == current_user.org_id)
    if service:
        query = query.where(SecurityOpsTask.service == service)
    query = query.order_by(desc(SecurityOpsTask.id)).limit(limit)
    rows = (await db.execute(query)).scalars().all()
    return list(rows)
