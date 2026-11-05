"""Platform access-control API (PA-02).

Only the Owner (platform_admin) can inspect and mutate grants. The endpoint
for the current user's effective access is read-only and never exposes secrets.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import require_role, get_current_user
from app.core.platform_rbac import (
    PLATFORM_ROLES, ROLE_DEFAULTS, PERMISSION_CATALOG, has_permission, is_platform_role
)
from app.database import get_db
from app.models import User, PlatformPermissionAssignment, AuditLog

router = APIRouter(prefix="/platform/access", tags=["Platform Access"])

class PlatformRoleUpdate(BaseModel):
    role: str = Field(pattern="^(platform_expert|platform_analyst|platform_user)$")

class AssignmentCreate(BaseModel):
    user_id: int
    permission_key: str
    effect: str = Field(default="allow", pattern="^(allow|deny)$")
    scope_type: str = Field(default="global", pattern="^(global|tenant|partner)$")
    scope_id: int | None = None
    expires_at: datetime | None = None

@router.get("/me")
async def effective_access(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not is_platform_role(current_user.role):
        raise HTTPException(403, "Platform staff access required")
    keys = set(ROLE_DEFAULTS.get(current_user.role, set())) - {"*"}
    rows = (await db.execute(select(PlatformPermissionAssignment).where(
        PlatformPermissionAssignment.user_id == current_user.id,
        PlatformPermissionAssignment.revoked_at.is_(None),
    ))).scalars().all()
    now = datetime.now(timezone.utc)
    for row in rows:
        expires_at = row.expires_at
        if expires_at is not None and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at is not None and expires_at <= now:
            continue
        if row.effect == "allow" and row.scope_type == "global":
            keys.add(row.permission_key)
        elif row.effect == "deny" and row.scope_type == "global":
            keys.discard(row.permission_key)
    if current_user.role == "platform_admin":
        keys = set(PERMISSION_CATALOG)
    return {
        "user_id": current_user.id,
        "role": current_user.role,
        "owner": current_user.role == "platform_admin",
        "permissions": [
            {"key": key, "description": PERMISSION_CATALOG[key]}
            for key in sorted(keys) if key in PERMISSION_CATALOG
        ],
        "permission_catalog": [
            {"key": key, "description": value}
            for key, value in PERMISSION_CATALOG.items()
        ],
    }

@router.get("/assignments")
async def list_assignments(
    user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    owner: User = Depends(require_role("platform_admin")),
):
    stmt = select(PlatformPermissionAssignment).order_by(PlatformPermissionAssignment.created_at.desc())
    if user_id is not None:
        stmt = stmt.where(PlatformPermissionAssignment.user_id == user_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [{
        "id": row.id, "user_id": row.user_id, "permission_key": row.permission_key,
        "effect": row.effect, "scope_type": row.scope_type, "scope_id": row.scope_id,
        "granted_by": row.granted_by, "created_at": row.created_at,
        "expires_at": row.expires_at, "revoked_at": row.revoked_at,
    } for row in rows]

@router.post("/assignments", status_code=201)
async def create_assignment(
    body: AssignmentCreate,
    db: AsyncSession = Depends(get_db),
    owner: User = Depends(require_role("platform_admin")),
):
    if body.permission_key not in PERMISSION_CATALOG:
        raise HTTPException(422, "Unknown permission key")
    if body.permission_key == "platform.access.manage":
        raise HTTPException(403, "Access administration is reserved to the Owner")
    if body.scope_type == "global" and body.scope_id is not None:
        raise HTTPException(422, "Global scope must not include scope_id")
    if body.scope_type != "global" and (body.scope_id is None or body.scope_id <= 0):
        raise HTTPException(422, "Tenant and partner scopes require a positive scope_id")
    if body.expires_at:
        expiry = body.expires_at
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry <= datetime.now(timezone.utc):
            raise HTTPException(422, "expires_at must be in the future")
        body.expires_at = expiry
    target = await db.get(User, body.user_id)
    if not target or target.role not in PLATFORM_ROLES - {"platform_admin"}:
        raise HTTPException(404, "Platform Expert, Analyst or User account not found")
    if target.id == owner.id:
        raise HTTPException(403, "Owner does not need permission overrides")
    if body.scope_type == "tenant":
        from app.models import Organization
        if not await db.get(Organization, body.scope_id):
            raise HTTPException(404, "Tenant scope not found")
    if body.scope_type == "partner":
        from app.models import Organization
        partner = await db.get(Organization, body.scope_id)
        if not partner or not partner.is_partner:
            raise HTTPException(404, "Partner scope not found")
    row = PlatformPermissionAssignment(
        user_id=target.id, permission_key=body.permission_key, effect=body.effect,
        scope_type=body.scope_type, scope_id=body.scope_id,
        granted_by=owner.id, expires_at=body.expires_at,
    )
    db.add(row)
    target.auth_version = int(target.auth_version or 0) + 1
    await db.flush()
    db.add(AuditLog(
        actor_id=owner.id, actor_name=owner.email, actor_role=owner.role,
        org_id=body.scope_id if body.scope_type == "tenant" else None,
        action="platform.permission_assignment.created",
        resource="PlatformPermissionAssignment", resource_id=str(row.id),
        details=f"user_id={target.id}; permission={body.permission_key}; effect={body.effect}; scope={body.scope_type}:{body.scope_id}",
        outcome="success",
    ))
    await db.commit()
    await db.refresh(row)
    return {"id": row.id, "user_id": row.user_id, "permission_key": row.permission_key,
            "effect": row.effect, "scope_type": row.scope_type, "scope_id": row.scope_id,
            "expires_at": row.expires_at}

@router.delete("/assignments/{assignment_id}", status_code=204)
async def revoke_assignment(
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    owner: User = Depends(require_role("platform_admin")),
):
    row = await db.get(PlatformPermissionAssignment, assignment_id)
    if not row or row.revoked_at is not None:
        raise HTTPException(404, "Active permission assignment not found")
    row.revoked_at = datetime.now(timezone.utc)
    target = await db.get(User, row.user_id)
    if target:
        target.auth_version = int(target.auth_version or 0) + 1
    db.add(AuditLog(
        actor_id=owner.id, actor_name=owner.email, actor_role=owner.role,
        org_id=row.scope_id if row.scope_type == "tenant" else None,
        action="platform.permission_assignment.revoked",
        resource="PlatformPermissionAssignment", resource_id=str(row.id),
        details=f"user_id={row.user_id}; permission={row.permission_key}; scope={row.scope_type}:{row.scope_id}",
        outcome="success",
    ))
    await db.commit()


@router.get("/users")
async def list_platform_staff(
    db: AsyncSession = Depends(get_db),
    owner: User = Depends(require_role("platform_admin")),
):
    rows = (await db.execute(select(User).where(
        User.role.in_(sorted(PLATFORM_ROLES)),
    ).order_by(User.name))).scalars().all()
    return [{
        "id": row.id, "email": row.email, "name": row.name, "role": row.role,
        "status": row.status, "auth_version": row.auth_version,
        "created_at": row.created_at,
    } for row in rows]

@router.patch("/users/{user_id}/role")
async def update_platform_staff_role(
    user_id: int,
    body: PlatformRoleUpdate,
    db: AsyncSession = Depends(get_db),
    owner: User = Depends(require_role("platform_admin")),
):
    target = await db.get(User, user_id)
    if not target or target.role not in PLATFORM_ROLES - {"platform_admin"}:
        raise HTTPException(404, "Platform Expert, Analyst or User account not found")
    if target.id == owner.id:
        raise HTTPException(403, "Owner role cannot be changed")
    if target.org_id is not None:
        raise HTTPException(409, "Platform staff account has an invalid tenant assignment")
    before = target.role
    target.role = body.role
    target.auth_version = int(target.auth_version or 0) + 1
    db.add(AuditLog(
        actor_id=owner.id, actor_name=owner.email, actor_role=owner.role,
        org_id=None, action="platform.staff_role.updated", resource="User",
        resource_id=str(target.id), details=f"role: {before} -> {target.role}",
        outcome="success",
    ))
    await db.commit()
    await db.refresh(target)
    return {"id": target.id, "role": target.role, "auth_version": target.auth_version}
