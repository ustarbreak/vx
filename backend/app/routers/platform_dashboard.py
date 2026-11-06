"""Live Platform Super Admin overview.

Only persisted platform records are counted. This endpoint intentionally does
not infer revenue, connector reachability, geographic locations, or health
from configuration-only rows.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.platform_rbac import require_permission
from app.database import get_db
from app.models import (
    Alert, AgentProbe, AuditLog, Incident, Integration, Organization,
    PlaybookRun, SecurityOpsTask, Ticket, User,
)

router = APIRouter(prefix="/platform/dashboard", tags=["Platform Dashboard"])


async def _count(db: AsyncSession, model, *criteria) -> int:
    stmt = select(func.count()).select_from(model)
    if criteria:
        stmt = stmt.where(*criteria)
    return int((await db.execute(stmt)).scalar_one())


async def _group_counts(db: AsyncSession, column) -> dict[str, int]:
    rows = (await db.execute(
        select(column, func.count()).group_by(column)
    )).all()
    return {str(key if key is not None else "unknown"): int(value) for key, value in rows}


@router.get("/overview")
async def platform_dashboard_overview(
    _owner=Depends(require_permission("platform.dashboard.read")),
    db: AsyncSession = Depends(get_db),
):
    """Global operational inventory and workload counts, with explicit limits."""
    generated_at = datetime.now(timezone.utc).isoformat()
    organizations = await _count(db, Organization)
    active_tenants = await _count(db, Organization, Organization.status == "active")\n    partners = await _count(db, Organization, Organization.is_partner.is_(True))\n    platform_staff = await _count(db, User, User.role.in_(("platform_admin", "platform_expert", "platform_analyst", "platform_user")))
    suspended_tenants = await _count(db, Organization, Organization.status == "suspended")
    users = await _count(db, User)
    integrations = await _count(db, Integration)
    integration_status = await _group_counts(db, Integration.status)
    probes = await _count(db, AgentProbe)
    probe_status = await _group_counts(db, AgentProbe.status)
    alerts = await _count(db, Alert)
    tickets = await _count(db, Ticket)
    open_tickets = await _count(db, Ticket, Ticket.status.notin_(("resolved", "closed")))
    incidents = await _count(db, Incident)
    active_incidents = await _count(db, Incident, Incident.status.notin_(("resolved", "closed")))
    playbook_runs = await _count(db, PlaybookRun)
    security_tasks = await _count(db, SecurityOpsTask)
    audit_events = await _count(db, AuditLog)

    return {
        "generated_at": generated_at,
        "data_mode": "live",
        "scope": "global_platform",
        "counts": {
            "organizations": organizations,
            "active_tenants": active_tenants,\n            "partners": partners,\n            "platform_staff": platform_staff,
            "suspended_tenants": suspended_tenants,
            "users": users,
            "integrations": integrations,
            "agents": probes,
            "alerts": alerts,
            "tickets": tickets,
            "open_tickets": open_tickets,
            "incidents": incidents,
            "active_incidents": active_incidents,
            "playbook_runs": playbook_runs,
            "security_ops_tasks": security_tasks,
            "audit_events": audit_events,
        },
        "distributions": {
            "tenant_status": await _group_counts(db, Organization.status),\n            "tenant_country": await _group_counts(db, Organization.country),
            "integration_status": integration_status,
            "agent_status": probe_status,
            "ticket_status": await _group_counts(db, Ticket.status),
            "incident_status": await _group_counts(db, Incident.status),
            "security_task_status": await _group_counts(db, SecurityOpsTask.status),
        },
        "limitations": {
            "revenue": "unavailable: no verified payment/settlement ledger is connected",
            "connector_reachability": "not measured by integration configuration status",
            "agent_health": "based on last persisted probe status; freshness must be evaluated separately",
            "geographic_map": "unavailable: no trusted geolocation dataset is exposed by this aggregate",
        },
    }
