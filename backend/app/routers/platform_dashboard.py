"""Live Platform Admin dashboard aggregates (PA-04).

Only low-cardinality operational counts are returned. No tenant names,
credentials, alert contents, or other tenant records are exposed here.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.platform_rbac import require_permission
from app.database import get_db
from app.models import (
    AgentProbe, Alert, AuditLog, DiscoveredDevice, Entitlement, Integration,
    Notification, Organization, PlaybookRun, SecurityOpsTask, Ticket, User,
)

router = APIRouter(prefix="/platform/dashboard", tags=["Platform Dashboard"])


async def _count(db: AsyncSession, model, *criteria) -> int:
    statement = select(func.count()).select_from(model)
    if criteria:
        statement = statement.where(*criteria)
    return int((await db.execute(statement)).scalar_one())


async def _distinct_count(db: AsyncSession, model, column, *criteria) -> int:
    statement = select(func.count(func.distinct(column))).select_from(model)
    if criteria:
        statement = statement.where(*criteria)
    return int((await db.execute(statement)).scalar_one())


@router.get("/overview")
async def platform_dashboard_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("platform.dashboard.read")),
):
    """Return database-backed platform aggregates for users granted dashboard.read."""
    tenants_total = await _count(db, Organization, Organization.is_partner.is_(False))
    tenants_active = await _count(
        db, Organization, Organization.is_partner.is_(False), Organization.status == "active"
    )
    partners_total = await _count(db, Organization, Organization.is_partner.is_(True))
    partners_active = await _count(
        db, Organization, Organization.is_partner.is_(True), Organization.status == "active"
    )

    users_total = await _count(db, User)
    users_active = await _count(db, User, User.status == "active")
    platform_staff = await _count(db, User, User.role.in_([
        "platform_admin", "platform_expert", "platform_analyst", "platform_user"
    ]))

    integrations_total = await _count(db, Integration)
    integrations_active = await _count(db, Integration, Integration.status == "active")
    enabled_entitlements = await _count(db, Entitlement, Entitlement.enabled.is_(True))
    enabled_services = await _distinct_count(
        db, Entitlement, Entitlement.service_id, Entitlement.enabled.is_(True)
    )

    probes_total = await _count(db, AgentProbe)
    probes_online = await _count(db, AgentProbe, AgentProbe.status == "online")
    discovered_devices = await _count(db, DiscoveredDevice)

    alerts_total = await _count(db, Alert)
    tickets_total = await _count(db, Ticket)
    playbook_runs_total = await _count(db, PlaybookRun)
    security_ops_tasks_total = await _count(db, SecurityOpsTask)

    notifications_total = await _count(db, Notification)
    notifications_queued = await _count(db, Notification, Notification.status == "queued")
    notifications_failed = await _count(
        db, Notification, Notification.status.in_(["failed", "dead_letter"])
    )
    audit_total = await _count(db, AuditLog)
    audit_failures = await _count(db, AuditLog, AuditLog.outcome == "failure")
    audit_blocked = await _count(db, AuditLog, AuditLog.outcome == "blocked")

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "database",
        "tenants": {"total": tenants_total, "active": tenants_active},
        "partners": {"total": partners_total, "active": partners_active},
        "users": {"total": users_total, "active": users_active, "platform_staff": platform_staff},
        "commercial": {
            "enabled_entitlements": enabled_entitlements,
            "enabled_services_in_use": enabled_services,
            "subscriptions": {
                "available": False,
                "reason": "The current schema has no subscription record. Entitlements are not represented as subscriptions."
            }
        },
        "integrations": {"total": integrations_total, "active": integrations_active},
        "infrastructure": {
            "collector_probes": probes_total,
            "collector_probes_online": probes_online,
            "discovered_devices": discovered_devices
        },
        "operations": {
            "alerts": alerts_total,
            "tickets": tickets_total,
            "playbook_runs": playbook_runs_total,
            "security_ops_tasks": security_ops_tasks_total
        },
        "notification_queue": {
            "total": notifications_total,
            "queued": notifications_queued,
            "failed_or_dead_letter": notifications_failed
        },
        "audit": {
            "total": audit_total,
            "failures": audit_failures,
            "blocked": audit_blocked
        }
    }
