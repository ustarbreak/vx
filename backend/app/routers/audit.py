from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import List, Optional
from app.database import get_db
from app.models import AuditLog, User
from app.schemas import AuditLogResponse
from app.core.security import get_current_user, require_role

router = APIRouter(prefix="/audit", tags=["Audit Logs"])


@router.get("/logs", response_model=List[AuditLogResponse])
async def get_audit_logs(
    skip: int = 0,
    limit: int = 100,
    org_id: Optional[int] = None,
    actor_role: Optional[str] = None,
    outcome: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Get audit logs (platform admin only)"""
    query = select(AuditLog)
    
    # Apply filters
    if org_id:
        query = query.where(AuditLog.org_id == org_id)
    
    if actor_role:
        query = query.where(AuditLog.actor_role == actor_role)
    
    if outcome:
        query = query.where(AuditLog.outcome == outcome)
    
    # Order by timestamp descending
    query = query.order_by(desc(AuditLog.timestamp))
    
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.get("/logs/my-org", response_model=List[AuditLogResponse])
async def get_my_org_audit_logs(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get audit logs for current user's organization"""
    if current_user.role == "platform_admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Platform admins should use /audit/logs endpoint"
        )
    
    query = (
        select(AuditLog)
        .where(AuditLog.org_id == current_user.org_id)
        .order_by(desc(AuditLog.timestamp))
        .offset(skip)
        .limit(limit)
    )
    
    result = await db.execute(query)
    return result.scalars().all()
