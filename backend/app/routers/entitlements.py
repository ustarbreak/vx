from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from datetime import datetime
from app.database import get_db
from app.models import Entitlement, Organization, User, AuditLog, TenantServiceGrant
from app.schemas import EntitlementCreate, EntitlementUpdate, EntitlementResponse
from app.core.security import get_current_user
from app.core.platform_rbac import has_permission, is_platform_role

router = APIRouter(prefix="/entitlements", tags=["Entitlements"])

async def _require_billing_scope(user: User, org_id: int, db: AsyncSession, permission: str) -> None:
    if user.role == "platform_admin":
        return
    if not is_platform_role(user.role) or not await has_permission(user, permission, db, org_id=org_id):
        raise HTTPException(403, "Billing permission required for this tenant scope")




@router.get("/graph")
async def get_service_graph(
    org_id: int = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Service dependency graph built ONLY from persisted entitlement rows.

    Client users see their own org's graph; platform admins may pass org_id.
    Nodes = Entitlement/TenantServiceGrant records; edges = declared rules
    rendered only when both endpoints exist; unprovisioned upstreams are
    surfaced honestly in `missing_dependencies` (never hidden, never faked).
    """
    from app.services.service_graph import build_service_graph

    if current_user.role == "platform_admin":
        target_org = org_id or current_user.org_id
        if not target_org:
            raise HTTPException(status_code=400, detail="org_id required for platform admins without an organization")
    else:
        if org_id and org_id != current_user.org_id:
            raise HTTPException(status_code=403, detail="Cannot read another organization's graph")
        target_org = current_user.org_id

    graph = await build_service_graph(db, target_org)
    if graph.get("error") == "organization_not_found":
        raise HTTPException(status_code=404, detail="Organization not found")
    return graph


@router.get("/chain/{service_id}")
async def get_service_chain(
    service_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Full link-chain for one service: every transitive upstream requirement
    (with provisioned/missing flag) and every downstream service impacted by
    it — computed on the tenant's real entitlement rows."""
    from app.services.service_graph import SERVICE_DEPENDENCY_RULES

    org_id = current_user.org_id
    if current_user.role == "platform_admin" and not org_id:
        raise HTTPException(status_code=400, detail="Platform admin must query via /graph?org_id=")

    rows = (await db.execute(
        select(Entitlement).where(Entitlement.org_id == org_id)
    )).scalars().all()
    grants = (await db.execute(
        select(TenantServiceGrant).where(TenantServiceGrant.org_id == org_id)
    )).scalars().all()
    present = {e.service_id for e in rows} | {g.service_id for g in grants}

    upstream_rules = [r for r in SERVICE_DEPENDENCY_RULES if r["service"] == service_id]

    def walk_up(sid: str, visited: set) -> list:
        chain = []
        for r in SERVICE_DEPENDENCY_RULES:
            if r["service"] == sid and r["requires"] not in visited:
                visited.add(r["requires"])
                sub = walk_up(r["requires"], visited) if r["requires"] in present else []
                chain.append({
                    "requires": r["requires"],
                    "rationale": r["rationale"],
                    "provisioned": r["requires"] in present,
                    "depth": 1 + (max([s["depth"] for s in sub], default=0)),
                    "sub_chain": sub,
                })
        return chain

    def walk_down(sid: str, visited: set) -> list:
        out = []
        for r in SERVICE_DEPENDENCY_RULES:
            if r["requires"] == sid and r["service"] not in visited:
                visited.add(r["service"])
                out.append({
                    "impacts": r["service"],
                    "rationale": r["rationale"],
                    "provisioned": r["service"] in present,
                    "sub_chain": walk_down(r["service"], visited),
                })
        return out

    missing = [u["requires"] for u in walk_up(service_id, set()) if not u["provisioned"]]
    return {
        "service_id": service_id,
        "entitled": service_id in present,
        "direct_requires": upstream_rules and [{"requires": r["requires"], "rationale": r["rationale"],
                                                "provisioned": r["requires"] in present}
                                               for r in upstream_rules] or [],
        "upstream_chain": walk_up(service_id, set()),
        "downstream_impact": walk_down(service_id, set()),
        "unprovisioned_requirements": sorted(set(missing)),
    }


@router.get("/", response_model=List[EntitlementResponse])
async def get_entitlements(
    org_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Read entitlements only within a tenant or explicitly authorized platform scope."""
    query = select(Entitlement)
    if current_user.role == "platform_admin":
        if org_id is not None:
            query = query.where(Entitlement.org_id == org_id)
    elif is_platform_role(current_user.role):
        if not await has_permission(current_user, "platform.billing.read", db, org_id=org_id):
            raise HTTPException(403, "Billing read permission required for this scope")
        if org_id is not None:
            query = query.where(Entitlement.org_id == org_id)
    else:
        if current_user.org_id is None or (org_id is not None and org_id != current_user.org_id):
            raise HTTPException(403, "Tenant entitlement scope denied")
        query = query.where(Entitlement.org_id == current_user.org_id)

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
    current_user: User = Depends(get_current_user)
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
    await _require_billing_scope(current_user, org.id, db, "platform.billing.manage")
    
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
    current_user: User = Depends(require_permission("platform.billing.manage"))
):
    """Update entitlement (platform admin only) - THIS IS THE ENFORCEMENT ENDPOINT"""
    result = await db.execute(select(Entitlement).where(Entitlement.id == entitlement_id))
    entitlement = result.scalar_one_or_none()
    
    if not entitlement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entitlement not found"
        )
    await _require_billing_scope(current_user, entitlement.org_id, db, "platform.billing.manage")
    
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
    current_user: User = Depends(require_permission("platform.billing.manage"))
):
    """Delete entitlement (platform admin only)"""
    result = await db.execute(select(Entitlement).where(Entitlement.id == entitlement_id))
    entitlement = result.scalar_one_or_none()
    
    if not entitlement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entitlement not found"
        )
    await _require_billing_scope(current_user, entitlement.org_id, db, "platform.billing.manage")
    
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
