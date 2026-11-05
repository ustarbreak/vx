"""Audit event APIs with server-side search and output redaction."""
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AuditLog, User
from app.schemas import AuditLogResponse
from app.core.security import get_current_user
from app.core.platform_rbac import require_permission, is_platform_role

router = APIRouter(prefix="/audit", tags=["Audit Logs"])

_SECRET_RE = re.compile(
    r'(?i)\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)'
    r'(\s*[:=]\s*)(?:"[^"]*"|\'[^\']*\'|[^\s,;]+)'
)
_BEARER_RE = re.compile(r'(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+')


def _redact_details(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    safe = _SECRET_RE.sub(r"\1\2[REDACTED]", value)
    return _BEARER_RE.sub("Bearer [REDACTED]", safe)


def _safe_row(row: AuditLog) -> dict:
    return {
        "id": row.id, "actor_id": row.actor_id, "actor_name": row.actor_name,
        "actor_role": row.actor_role, "org_id": row.org_id, "action": row.action,
        "resource": row.resource, "resource_id": row.resource_id,
        "details": _redact_details(row.details), "ip_address": row.ip_address,
        "outcome": row.outcome,
        "timestamp": row.timestamp,
    }


@router.get("/logs", response_model=List[AuditLogResponse])
async def get_audit_logs(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    org_id: Optional[int] = None,
    actor_role: Optional[str] = None,
    outcome: Optional[str] = None,
    q: Optional[str] = Query(default=None, max_length=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("platform.audit.read")),
):
    """Platform audit trail; all filters are applied server-side."""
    query = select(AuditLog)
    if org_id is not None:
        query = query.where(AuditLog.org_id == org_id)
    if actor_role:
        query = query.where(AuditLog.actor_role == actor_role)
    if outcome:
        query = query.where(AuditLog.outcome == outcome)
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        query = query.where(or_(
            AuditLog.actor_name.ilike(pattern), AuditLog.actor_role.ilike(pattern),
            AuditLog.action.ilike(pattern), AuditLog.resource.ilike(pattern),
            AuditLog.resource_id.ilike(pattern), AuditLog.details.ilike(pattern),
        ))
    query = query.order_by(desc(AuditLog.timestamp), desc(AuditLog.id))
    result = await db.execute(query.offset(skip).limit(limit))
    return [_safe_row(row) for row in result.scalars().all()]


@router.get("/logs/my-org", response_model=List[AuditLogResponse])
async def get_my_org_audit_logs(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Tenant-scoped audit trail. Platform staff must use the platform route."""
    if is_platform_role(current_user.role):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Platform staff should use /audit/logs endpoint",
        )
    if current_user.org_id is None:
        raise HTTPException(status_code=403, detail="Tenant audit scope is unavailable")
    query = (
        select(AuditLog)
        .where(AuditLog.org_id == current_user.org_id)
        .order_by(desc(AuditLog.timestamp), desc(AuditLog.id))
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(query)
    return [_safe_row(row) for row in result.scalars().all()]
