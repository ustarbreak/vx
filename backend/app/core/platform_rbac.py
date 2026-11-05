"""Owner-controlled platform RBAC primitives.

Platform roles are separate from tenant and partner roles. The Owner remains
the immutable superuser; all other platform roles are default-deny beyond
their small baseline and persisted, scoped grants.
"""
from datetime import datetime, timezone
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, PlatformPermissionAssignment
from app.core.security import get_current_user

PLATFORM_ROLES = {"platform_admin", "platform_expert", "platform_analyst", "platform_user"}

# Baselines are intentionally narrow. Owner can add/restrict user-level grants.
ROLE_DEFAULTS = {
    "platform_admin": {"*"},
    "platform_expert": {
        "platform.dashboard.read", "platform.tenants.read", "platform.partners.read",
        "platform.audit.read", "platform.integrations.read",
        "platform.infrastructure.read", "platform.services.read", "platform.alerts.read", "platform.alerts.manage", "platform.notifications.read",
    },
    "platform_analyst": {
        "platform.dashboard.read", "platform.tenants.read", "platform.partners.read",
        "platform.audit.read", "platform.infrastructure.read", "platform.services.read",
        "platform.reports.read", "platform.alerts.read", "platform.notifications.read",
    },
    "platform_user": {"platform.dashboard.read"},
}

PERMISSION_CATALOG = {
    "platform.dashboard.read": "View platform dashboard and aggregate metrics",
    "platform.tenants.read": "View global tenant directory and tenant details",
    "platform.tenants.manage": "Create, update, suspend and delete tenants",
    "platform.users.read": "View platform staff directory",
    "platform.users.manage": "Create, update and deactivate platform staff",
    "platform.access.manage": "Manage platform roles, profiles and permission grants",
    "platform.audit.read": "View global platform audit records",
    "platform.partners.read": "View partner program and partner records",
    "platform.partners.manage": "Manage partner lifecycle and contracts",
    "platform.billing.read": "View global billing, plans and invoices",
    "platform.billing.manage": "Change billing, licensing and commercial terms",
    "platform.integrations.read": "View integration configuration and status (secrets masked)",
    "platform.integrations.configure": "Configure and test integrations",
    "platform.integrations.delete": "Delete integrations",
    "platform.channels.read": "View tenant notification channel configuration (secrets masked)",
    "platform.channels.manage": "Change tenant notification channel configuration",
    "platform.channels.test": "Send a test notification through a tenant channel",
    "platform.infrastructure.read": "View global agent fleet and infrastructure",
    "platform.infrastructure.scan": "Start or cancel authorized infrastructure discovery",
    "platform.infrastructure.action": "Request allow-listed endpoint/device actions",
    "platform.security_ops.request": "Request allow-listed security operations",
    "platform.security_ops.approve": "Approve sensitive security operations",
    "platform.settings.read": "Read global platform settings",
    "platform.settings.manage": "Change global platform settings",
    "platform.services.read": "View platform service catalog and lifecycle",
    "platform.services.manage": "Change service catalog and lifecycle",
    "platform.reports.read": "View and export platform reports",
    "platform.alerts.read": "Read tenant alert records and summaries",
    "platform.alerts.manage": "Acknowledge, assign, resolve and annotate tenant alerts",
    "platform.alerts.ingest": "Ingest events into a tenant alert pipeline",
    "platform.alerts.evidence.read": "Read raw event evidence and provenance",
    "platform.notifications.read": "Read tenant notification delivery logs and analytics",
    "platform.notifications.manage": "Acknowledge or retry tenant notification deliveries",
    "platform.notification_rules.manage": "Create, update and delete tenant notification rules",
}

def is_platform_role(role: str | None) -> bool:
    return role in PLATFORM_ROLES

async def has_permission(user: User, permission: str, db: AsyncSession,
                         *, org_id: int | None = None, partner_id: int | None = None) -> bool:
    if user.role == "platform_admin":
        return True
    if user.role not in PLATFORM_ROLES:
        return False
    now = datetime.now(timezone.utc)
    rows = (await db.execute(select(PlatformPermissionAssignment).where(
        PlatformPermissionAssignment.user_id == user.id,
        PlatformPermissionAssignment.permission_key == permission,
        PlatformPermissionAssignment.revoked_at.is_(None),
        or_(PlatformPermissionAssignment.expires_at.is_(None),
            PlatformPermissionAssignment.expires_at > now),
    ))).scalars().all()
    matching = []
    for row in rows:
        expires_at = row.expires_at
        if expires_at is not None and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at is not None and expires_at <= now:
            continue
        if row.scope_type == "global":
            matching.append(row)
        elif row.scope_type == "tenant" and org_id is not None and row.scope_id == org_id:
            matching.append(row)
        elif row.scope_type == "partner" and partner_id is not None and row.scope_id == partner_id:
            matching.append(row)
    # Explicit deny takes precedence over grants and role defaults.
    if any(row.effect == "deny" for row in matching):
        return False
    if any(row.effect == "allow" for row in matching):
        return True
    # Role defaults are platform-wide grants for the explicitly listed actions.
    # Additional permissions require an Owner grant, optionally scoped to a tenant/partner.
    return permission in ROLE_DEFAULTS.get(user.role, set())

def require_permission(permission: str):
    async def permission_checker(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if permission not in PERMISSION_CATALOG:
            raise RuntimeError(f"Unknown platform permission: {permission}")
        if not await has_permission(current_user, permission, db):
            raise HTTPException(status_code=403, detail="Insufficient platform permission")
        return current_user
    return permission_checker


def require_scoped_permission(permission: str, *, org_param: str = "org_id", partner_param: str = "partner_id"):
    """Authorize a platform capability against an organization/partner path or query scope."""
    async def scoped_checker(
        request: Request,
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if permission not in PERMISSION_CATALOG:
            raise RuntimeError(f"Unknown platform permission: {permission}")
        raw_org = request.path_params.get(org_param) or request.query_params.get(org_param)
        raw_partner = request.path_params.get(partner_param) or request.query_params.get(partner_param)
        try:
            org_id = int(raw_org) if raw_org is not None else None
            partner_id = int(raw_partner) if raw_partner is not None else None
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Invalid permission scope")
        if not await has_permission(current_user, permission, db, org_id=org_id, partner_id=partner_id):
            raise HTTPException(status_code=403, detail="Insufficient platform permission for this resource scope")
        return current_user
    return scoped_checker
