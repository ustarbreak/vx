"""Platform Owner control-plane aggregates.

These endpoints expose only operational facts already persisted by Infracentra.
They deliberately do not invent revenue, usage, connector health or service counts.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.platform_rbac import require_permission
from app.database import get_db
from app.models import (
    Organization, User, Ticket, Alert, Incident, Integration, AgentProbe,
    UsageEvent, AuditLog,
)
from app.services.pricing_engine import PRICING_CONFIG
from app.services import connectors

router = APIRouter(prefix="/platform/admin", tags=["Platform Admin Control Plane"])


async def _count(db: AsyncSession, model, *conditions) -> int:
    stmt = select(func.count()).select_from(model)
    if conditions:
        stmt = stmt.where(*conditions)
    return int((await db.execute(stmt)).scalar_one() or 0)


@router.get("/overview")
async def platform_overview(
    current_user: User = Depends(require_permission("platform.dashboard.read")),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=15)
    active_tenants = await _count(db, Organization, Organization.status == "active",
                                  Organization.is_partner.is_(False))
    total_tenants = await _count(db, Organization, Organization.is_partner.is_(False))
    partners = await _count(db, Organization, Organization.is_partner.is_(True))
    total_users = await _count(db, User)
    platform_staff = await _count(db, User, User.role.in_(
        ["platform_admin", "platform_expert", "platform_analyst", "platform_user"]))
    active_tickets = await _count(db, Ticket, Ticket.status.notin_(["resolved", "closed"]))
    breached_tickets = await _count(db, Ticket, Ticket.due_resolve_at.is_not(None),
        Ticket.due_resolve_at < now, Ticket.status.notin_(["resolved", "closed"]))
    active_incidents = await _count(db, Incident, Incident.status.notin_(["resolved", "closed"]))
    active_alerts = await _count(db, Alert, Alert.status == "active")
    integrations_total = await _count(db, Integration)
    integrations_active = await _count(db, Integration, Integration.status == "active")
    probes_total = await _count(db, AgentProbe)
    probes_recent = await _count(db, AgentProbe, AgentProbe.last_seen >= since)

    mrr = (await db.execute(select(func.coalesce(func.sum(Organization.monthly_revenue), 0))
        .where(Organization.status == "active"))).scalar_one()
    country_rows = (await db.execute(select(Organization.country, func.count())
        .where(Organization.is_partner.is_(False), Organization.country.is_not(None))
        .group_by(Organization.country).order_by(func.count().desc()).limit(12))).all()
    activity_rows = (await db.execute(select(func.date(AuditLog.timestamp), func.count())
        .where(AuditLog.timestamp >= now - timedelta(days=14))
        .group_by(func.date(AuditLog.timestamp)).order_by(func.date(AuditLog.timestamp)))).all()
    recent = (await db.execute(select(AuditLog).order_by(AuditLog.timestamp.desc()).limit(12))).scalars().all()

    return {
        "generated_at": now.isoformat(),
        "currency": PRICING_CONFIG.get("currency", "MAD"),
        "kpis": {
            "tenants_total": total_tenants, "tenants_active": active_tenants,
            "partners_total": partners, "users_total": total_users,
            "platform_staff": platform_staff, "mrr_recorded": float(mrr or 0),
            "tickets_active": active_tickets, "tickets_sla_breached": breached_tickets,
            "incidents_active": active_incidents, "alerts_active": active_alerts,
            "integrations_total": integrations_total, "integrations_active": integrations_active,
            "agents_total": probes_total, "agents_seen_15m": probes_recent,
        },
        "tenant_countries": [{"country": country, "count": count} for country, count in country_rows],
        "audit_activity_14d": [{"date": str(day), "events": count} for day, count in activity_rows],
        "recent_activity": [{
            "id": row.id, "actor": row.actor_name, "role": row.actor_role,
            "action": row.action, "resource": row.resource, "resource_id": row.resource_id,
            "outcome": row.outcome, "timestamp": row.timestamp.isoformat() if row.timestamp else None,
        } for row in recent],
    }


@router.get("/billing")
async def platform_billing(
    period: str = Query(..., pattern=r"^\\d{4}-(0[1-9]|1[0-2])$"),
    current_user: User = Depends(require_permission("platform.billing.read")),
    db: AsyncSession = Depends(get_db),
):
    year, month = map(int, period.split("-"))
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=timezone.utc)
    usage_rows = (await db.execute(select(UsageEvent.metric, func.sum(UsageEvent.quantity),
        func.count(UsageEvent.id)).where(UsageEvent.occurred_at >= start,
        UsageEvent.occurred_at < end).group_by(UsageEvent.metric))).all()
    usage = {metric: {"quantity": float(quantity or 0), "events": int(events)}
             for metric, quantity, events in usage_rows}
    orgs = (await db.execute(select(Organization).order_by(Organization.name))).scalars().all()
    active = [org for org in orgs if org.status == "active"]
    mrr = sum(int(org.monthly_revenue or 0) for org in active)
    return {
        "period": period, "currency": PRICING_CONFIG.get("currency", "MAD"),
        "summary": {
            "recorded_mrr": mrr, "active_organizations": len(active),
            "trial_organizations": sum(1 for org in orgs if org.trial),
            "partner_organizations": sum(1 for org in orgs if org.is_partner),
            "usage_event_count": sum(x["events"] for x in usage.values()),
        },
        "usage": usage,
        "organizations": [{
            "id": org.id, "name": org.name, "status": org.status,
            "is_partner": bool(org.is_partner), "plan_tier": org.plan_tier,
            "billing_cycle": org.billing_cycle, "monthly_revenue": int(org.monthly_revenue or 0),
            "endpoint_count": int(org.endpoint_count or org.asset_count or 0),
            "seat_limit": int(org.seat_limit or 0), "contract_end": (
                org.contract_end.isoformat() if org.contract_end else None),
        } for org in orgs],
        "invoice_system": "Partner invoices are available in partner billing statements. Direct tenant invoice records are not currently persisted as a global invoice ledger.",
    }


@router.get("/connectors")
async def platform_connectors(
    current_user: User = Depends(require_permission("platform.integrations.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await connectors.status_all(db)
    return {"checked": len(rows), "results": rows,
            "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/health")
async def platform_health(
    current_user: User = Depends(require_permission("platform.dashboard.read")),
    db: AsyncSession = Depends(get_db),
):
    generated = datetime.now(timezone.utc)
    try:
        await db.execute(select(1))
        database = {"status": "healthy"}
    except Exception as exc:
        database = {"status": "unavailable", "error": type(exc).__name__}
    connector_state = "not_checked"
    connector_count = None
    if await _can_read_integrations(current_user, db):
        try:
            rows = await connectors.status_all(db)
            connector_count = len(rows)
            connector_state = "healthy" if all(x.get("status") in ("active", "healthy", "connected") for x in rows) else "attention"
        except Exception:
            connector_state = "unavailable"
    return {"generated_at": generated.isoformat(), "database": database,
            "connectors": {"status": connector_state, "count": connector_count}}


async def _can_read_integrations(user: User, db: AsyncSession) -> bool:
    from app.core.platform_rbac import has_permission
    return await has_permission(user, "platform.integrations.read", db)
