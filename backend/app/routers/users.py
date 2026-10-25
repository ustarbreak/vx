from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from app.database import get_db
from app.models import User, Organization, AuditLog
from app.schemas import UserCreate, UserResponse
from app.core.security import get_password_hash, get_current_user, require_role

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/", response_model=List[UserResponse])
async def get_users(
    org_id: int = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get users (platform admin sees all, client admin sees their org)"""
    query = select(User)
    
    # Filter by organization
    if current_user.role != "platform_admin":
        # Client users can only see their own organization
        query = query.where(User.org_id == current_user.org_id)
    elif org_id:
        # Platform admin can filter by org
        query = query.where(User.org_id == org_id)
    
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get user by ID"""
    # Check permissions
    if current_user.role != "platform_admin":
        if current_user.id != user_id and current_user.org_id != (
            await db.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none().org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this user"
            )
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return user


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Create a new user (platform admin only)"""
    # Check if email already exists
    result = await db.execute(select(User).where(User.email == user_data.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # If org_id provided, check if organization exists
    if user_data.org_id:
        result = await db.execute(select(Organization).where(Organization.id == user_data.org_id))
        if not result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found"
            )
    
    # Create user
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        email=user_data.email,
        hashed_password=hashed_password,
        name=user_data.name,
        role=user_data.role,
        org_id=user_data.org_id
    )
    
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    # Log audit
    audit_log = AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_role=current_user.role,
        org_id=new_user.org_id,
        action="user.created",
        resource="User",
        resource_id=str(new_user.id),
        details=f"Created user: {new_user.email}",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    await db.commit()
    
    return new_user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin"))
):
    """Delete user (platform admin only)"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Prevent self-deletion
    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account"
        )
    
    # Log audit before deletion
    audit_log = AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name,
        actor_role=current_user.role,
        org_id=user.org_id,
        action="user.deleted",
        resource="User",
        resource_id=str(user.id),
        details=f"Deleted user: {user.email}",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    
    await db.delete(user)
    await db.commit()
    
    return None
