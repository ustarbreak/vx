from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from datetime import datetime
from app.database import get_db
from app.models import Entitlement, Organization, User, AuditLog
from app.schemas import EntitlementCreate, EntitlementUpdate, EntitlementResponse
from app.core.security import get_current_user, require_role

router = APIRouter(prefix="/entitlements", tags=["Entitlements"])


@router.get("/", response_model=List[EntitlementResponse])
async def get_entitlements(
    org_id: int = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get entitlements (platform admin sees all, client users see their org)"""
    query = select(Entitlement)
    
    if current_user.role != "platform_admin":
        # Client users can only see their own organization's entitlements
        query = query.where(Entitlement.org_id == current_user.org_id)
    elif org_id:
        # Platform admin can filter by org
        query = query.where(Entitlement.org_id == org_id)
    
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/check/{service_id}")
async def check_entitlement(
    service_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Check if current user's organization has access to a service"""
    if current_user.role == "platform_admin":
        return {"entitled": True, "service_id": service_id}
    
    result = await db.execute(
        select(Entitlement).where(
            Entitlement.org_id == current_user.org_id,
            Entitlement.service_id == service_id,
            Entitlement.enabled == True
        )
    )
    entitlement = result.scalar_one_or_none()
    
    if not entitlement:
        # Log blocked access attempt
        org_result = await db.execute(select(Organization).where(Organization.id == current_user.org_id))
        org = org_result.scalar_one_or_none()
        
        audit_log = AuditLog(
            actor_id=current_user.id,
            actor_name=current_user.name,
            actor_role=current_user.role,
            org_id=current_user.org_id,
            action="service.access_attempt",
            resource="Service",
            resource_id=service_id,
            details=f"Attempted to access {service_id} — ACCESS BLOCKED (org not entitled)",
            outcome="blocked"
        )
        db.add(audit_log)
        await db.commit()
        
        return {"entitled": False, "service_id": service_id, "org_name": org.name if org else None}
    
    return {"entitled": True, "service_id": service_id}


@router.post("/", response_model=EntitlementResponse, status_code=status.HTTP_201_CREATED)
async def create_entitlement(
    entitlement_data: EntitlementCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Create entitlement (platform admin only)"""
    # Check if organization exists
    result = await db.execute(select(Organization).where(Organization.id == entitlement_data.org_id))
    org = result.scalar_one_or_none()
    
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )
    
    # Check if entitlement already exists
    result = await db.execute(
        select(Entitlement).where(
            Entitlement.org_id == entitlement_data.org_id,
            Entitlement.service_id == entitlement_data.service_id
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Entitlement already exists for this organization and service"
        )
    
    # Create entitlement
    new_entitlement = Entitlement(
        **entitlement_data.model_dump(),
        activated_at=datetime.utcnow() if entitlement_data.enabled else None
    )
    
    db.add(new_entitlement)
    await db.commit()
    await db.refresh(new_entitlement)
    
    # Log audit
    audit_log = AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_role=current_user.role,
        org_id=entitlement_data.org_id,
        action="entitlement.created",
        resource="Entitlement",
        resource_id=str(new_entitlement.id),
        details=f"Created entitlement for {entitlement_data.service_id} (enabled: {entitlement_data.enabled})",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    await db.commit()
    
    return new_entitlement


@router.patch("/{entitlement_id}", response_model=EntitlementResponse)
async def update_entitlement(
    entitlement_id: int,
    entitlement_data: EntitlementUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Update entitlement (platform admin only) - THIS IS THE ENFORCEMENT ENDPOINT"""
    result = await db.execute(select(Entitlement).where(Entitlement.id == entitlement_id))
    entitlement = result.scalar_one_or_none()
    
    if not entitlement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entitlement not found"
        )
    
    # Track old state for audit
    old_enabled = entitlement.enabled
    
    # Update fields
    update_data = entitlement_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(entitlement, field, value)
    
    # Update timestamps based on enabled state
    if "enabled" in update_data:
        if update_data["enabled"] and not old_enabled:
            entitlement.activated_at = datetime.utcnow()
            entitlement.deactivated_at = None
        elif not update_data["enabled"] and old_enabled:
            entitlement.deactivated_at = datetime.utcnow()
    
    await db.commit()
    await db.refresh(entitlement)
    
    # Log audit
    audit_log = AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_role=current_user.role,
        org_id=entitlement.org_id,
        action="entitlement.updated",
        resource="Entitlement",
        resource_id=str(entitlement.id),
        details=f"Updated entitlement for service {entitlement.service_id}: enabled {old_enabled} → {entitlement.enabled}",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    await db.commit()
    
    return entitlement


@router.delete("/{entitlement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entitlement(
    entitlement_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Delete entitlement (platform admin only)"""
    result = await db.execute(select(Entitlement).where(Entitlement.id == entitlement_id))
    entitlement = result.scalar_one_or_none()
    
    if not entitlement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entitlement not found"
        )
    
    # Log audit before deletion
    audit_log = AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_role=current_user.role,
        org_id=entitlement.org_id,
        action="entitlement.deleted",
        resource="Entitlement",
        resource_id=str(entitlement.id),
        details=f"Deleted entitlement for service {entitlement.service_id}",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    
    await db.delete(entitlement)
    await db.commit()
    
    return None
