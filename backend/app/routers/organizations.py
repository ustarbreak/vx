from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from app.database import get_db
from app.models import Organization, User, AuditLog
from app.schemas import OrganizationCreate, OrganizationUpdate, OrganizationResponse
from app.core.security import get_current_user, require_role

router = APIRouter(prefix="/organizations", tags=["Organizations"])


@router.get("/", response_model=List[OrganizationResponse])
async def get_organizations(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Get all organizations (platform admin only)"""
    result = await db.execute(
        select(Organization).offset(skip).limit(limit)
    )
    return result.scalars().all()


@router.get("/{org_id}", response_model=OrganizationResponse)
async def get_organization(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get organization by ID"""
    # Platform admins can see all, client users can only see their own
    if current_user.role != "platform_admin" and current_user.org_id != org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to view this organization"
        )
    
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )
    
    return org


@router.post("/", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_organization(
    org_data: OrganizationCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Create a new organization (platform admin only)"""
    # Check if name already exists
    result = await db.execute(select(Organization).where(Organization.name == org_data.name))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Organization name already exists"
        )
    
    new_org = Organization(**org_data.model_dump())
    db.add(new_org)
    await db.commit()
    await db.refresh(new_org)
    
    # Log audit
    audit_log = AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_role=current_user.role,
        action="organization.created",
        resource="Organization",
        resource_id=str(new_org.id),
        details=f"Created organization: {new_org.name}",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    await db.commit()
    
    return new_org


@router.patch("/{org_id}", response_model=OrganizationResponse)
async def update_organization(
    org_id: int,
    org_data: OrganizationUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Update organization (platform admin only)"""
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )
    
    # Update fields
    update_data = org_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(org, field, value)
    
    await db.commit()
    await db.refresh(org)
    
    # Log audit
    audit_log = AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_role=current_user.role,
        action="organization.updated",
        resource="Organization",
        resource_id=str(org.id),
        details=f"Updated organization: {org.name}",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    await db.commit()
    
    return org


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(
    org_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Delete organization (platform admin only)"""
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    org = result.scalar_one_or_none()
    
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )
    
    # Log audit before deletion
    audit_log = AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_role=current_user.role,
        action="organization.deleted",
        resource="Organization",
        resource_id=str(org.id),
        details=f"Deleted organization: {org.name}",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    
    await db.delete(org)
    await db.commit()
    
    return None
