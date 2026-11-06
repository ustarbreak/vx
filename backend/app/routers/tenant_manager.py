"""Phase 4 — Tenant Manager avancé (plateforme admin).

Miroir EXACT des shapes servies par src/services/demoMode.ts :
  GET   /admin/tenants/{org_id}/summary        résumé agrégé synchronisé
  POST  /admin/tenants/{org_id}/tickets        ticket créé POUR ce client
  GET   /admin/tenants/{org_id}/rules          liste règles de supervision
  POST  /admin/tenants/{org_id}/rules          créer une règle
  PATCH /admin/tenants/{org_id}/rules/{rid}    modifier (toggle enabled, seuil…)
  DELETE /admin/tenants/{org_id}/rules/{rid}   supprimer
  POST  /admin/tenants/{org_id}/grants         grant service (override plan) + audit entitlement.updated
  GET   /admin/tenants/{org_id}/grants         map {service_id: grant}
  GET   /admin/audit-platform                  journal des actions admin plateforme

Sécurité : réservé platform_admin (require_role). Le tenant ciblé vient
toujours du JWT pour les clients ; ici l'org_id en URL est légitime car le
rôle platform_admin est explicitement vérifié.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as safunc
from typing import Dict
import uuid

from app.database import get_db
from app.models import (Organization, User, Ticket, AuditLog, Entitlement,
                        DiscoveredDevice, MonitoringRule, TenantServiceGrant, AgentProbe, AgentToken)
from app.schemas import (TenantSummaryOut, ClientTicketIn, RuleCreateIn,
                         RuleUpdateIn, RuleOut, GrantIn, GrantOut)
from app.core.platform_rbac import require_scoped_permission, require_permission

router = APIRouter(prefix="/admin", tags=["Tenant Manager"])


async def _get_org(db: AsyncSession, org_id: int) -> Organization:
    org = await db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail=f"Tenant {org_id} introuvable")
    return org


def _platform_audit(current_user: User, action: str, details: str) -> AuditLog:
    """Ligne d'audit miroir de pushPlatformAudit() côté démo."""
    return AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name or current_user.email,
        actor_role=current_user.role,
        org_id=None,                      # plateforme, pas un tenant
        action=action,                    # partner.updated / rule.created / entitlement.updated…
        resource="platform",
        resource_id=action,
        details=details,
        outcome="success",
    )


@router.get("/tenants/{org_id}/summary", response_model=TenantSummaryOut)
async def tenant_summary(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scoped_permission("platform.tenants.read")),
):
    org = await _get_org(db, org_id)

    devices = (await db.execute(
        select(DiscoveredDevice).where(DiscoveredDevice.org_id == org.id)
    )).scalars().all()
    members = (await db.execute(
        select(safunc.count(User.id)).where(User.org_id == org.id)
    )).scalar_one()
    services_active = (await db.execute(
        select(safunc.count(Entitlement.id)).where(
            Entitlement.org_id == org.id, Entitlement.enabled.is_(True))
    )).scalar_one()
    open_incidents = (await db.execute(
        select(safunc.count(Ticket.id)).where(
            Ticket.org_id == org.id, Ticket.status.in_(["new", "triage", "open", "in_progress"]))
    )).scalar_one()
    children = (await db.execute(
        select(Organization).where(Organization.parent_org_id == org.id)
    )).scalars().all()

    return TenantSummaryOut(
        id=org.id, name=org.name,
        org_type=org.org_type or "HQ",
        location=org.country or "—",
        plan_tier=org.plan_tier or "STARTER",
        billing_cycle=org.billing_cycle or "MONTHLY",
        endpoints=len(devices), members=int(members or 0),
        services_active=int(services_active or 0), open_incidents=int(open_incidents or 0),
        probes=[{"id": d.id, "hostname": d.hostname or d.ip, "ip": d.ip,
                 "status": "online"} for d in devices if d.is_probe],
        children=[{"id": c.id, "name": c.name, "org_type": c.org_type} for c in children],
    )


@router.post("/tenants/{org_id}/tickets", status_code=201)
async def create_ticket_for_client(
    org_id: int, body: ClientTicketIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scoped_permission("platform.tenants.manage")),
):
    org = await _get_org(db, org_id)
    count = (await db.execute(select(safunc.count(Ticket.id)))).scalar_one() or 0
    uid = f"TCK-{10000 + int(count) + 1}"
    t = Ticket(
        uid=uid, org_id=org.id, title=body.title, description=body.description,
        priority=(body.priority or "P3").lower(), status="open", source="manual",
        assignee=body.assignee, asset=body.asset, category=body.category,
    )
    db.add(t)
    db.add(_platform_audit(current_user, "ticket.created_for_client",
                           f"{uid} ({body.priority}) ouvert pour {org.name}"))
    await db.commit()
    await db.refresh(t)
    return {"id": t.id, "uid": t.uid, "title": t.title, "priority": t.priority.upper(),
            "status": t.status, "source": t.source, "orgId": t.org_id,
            "asset": t.asset, "assignee": t.assignee, "category": t.category}


@router.get("/tenants/{org_id}/rules", response_model=list[RuleOut])
async def list_rules(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scoped_permission("platform.tenants.read")),
):
    rows = (await db.execute(
        select(MonitoringRule).where(MonitoringRule.org_id.in_([org_id]))
    )).scalars().all()
    return rows


@router.post("/tenants/{org_id}/rules", response_model=RuleOut, status_code=201)
async def create_rule(
    org_id: int, body: RuleCreateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scoped_permission("platform.tenants.manage")),
):
    org = await _get_org(db, org_id)
    n = (await db.execute(select(safunc.count(MonitoringRule.id)))) .scalar_one() or 0
    rid = f"RUL-{str(int(n) + 1).zfill(3)}"
    r = MonitoringRule(
        id=rid, org_id=org.id, name=body.name, scope=body.scope,
        target_asset_id=body.target_asset_id, trigger_metric=body.trigger_metric,
        operator=body.operator, threshold=body.threshold, duration_min=body.duration_min,
        action=body.action, ticket_priority=body.ticket_priority,
        notify_channels=body.notify_channels, enabled=True,
        created_by=current_user.email,
    )
    db.add(r)
    db.add(_platform_audit(current_user, "rule.created",
                           f"Règle « {body.name} » créée pour {org.name} "
                           f"({body.trigger_metric} {body.operator} {body.threshold} → {body.action})"))
    await db.commit()
    await db.refresh(r)
    return r


@router.patch("/tenants/{org_id}/rules/{rule_id}", response_model=RuleOut)
async def update_rule(
    org_id: int, rule_id: str, body: RuleUpdateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scoped_permission("platform.tenants.manage")),
):
    r = await db.get(MonitoringRule, rule_id)
    if not r or r.org_id != org_id:
        raise HTTPException(status_code=404, detail="Règle introuvable")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(r, k, v)
    db.add(_platform_audit(current_user, "rule.updated", f"Règle {rule_id} modifiée"))
    await db.commit()
    await db.refresh(r)
    return r


@router.delete("/tenants/{org_id}/rules/{rule_id}", status_code=204)
async def delete_rule(
    org_id: int, rule_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scoped_permission("platform.tenants.manage")),
):
    r = await db.get(MonitoringRule, rule_id)
    if not r or r.org_id != org_id:
        raise HTTPException(status_code=404, detail="Règle introuvable")
    await db.delete(r)
    db.add(_platform_audit(current_user, "rule.deleted", f"Règle « {r.name} » supprimée"))
    await db.commit()


@router.post("/tenants/{org_id}/grants", response_model=GrantOut)
async def set_grant(
    org_id: int, body: GrantIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scoped_permission("platform.tenants.manage")),
):
    """Active/désactive un service pour un client, avec override éventuel du plan.
    Écrit systématiquement la ligne d'audit `entitlement.updated` (miroir démo)."""
    org = await _get_org(db, org_id)
    existing = (await db.execute(
        select(TenantServiceGrant).where(
            TenantServiceGrant.org_id == org.id,
            TenantServiceGrant.service_id == body.service_id)
    )).scalar_one_or_none()
    g = existing or TenantServiceGrant(org_id=org.id, service_id=body.service_id)
    g.enabled = body.enabled
    g.override_plan = body.override_plan
    g.granted_by = current_user.email
    db.add(g)

    # Synchronise aussi l'entitlement canonique si présent
    ent = (await db.execute(
        select(Entitlement).where(Entitlement.org_id == org.id,
                                  Entitlement.service_id == body.service_id)
    )).scalar_one_or_none()
    if ent:
        ent.enabled = body.enabled
        db.add(ent)

    db.add(_platform_audit(current_user, "entitlement.updated",
                           f"Service « {body.service_id} » {'activé' if body.enabled else 'désactivé'}"
                           f"{' (override plan)' if body.override_plan else ''} pour {org.name}"))
    await db.commit()
    await db.refresh(g)
    return g


@router.get("/tenants/{org_id}/grants")
async def get_grants(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scoped_permission("platform.tenants.read")),
) -> Dict[str, GrantOut]:
    rows = (await db.execute(
        select(TenantServiceGrant).where(TenantServiceGrant.org_id == org_id)
    )).scalars().all()
    return {g.service_id: GrantOut.model_validate(g) for g in rows}


@router.get("/audit-platform")
async def platform_audit_log(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("platform.audit.read")),
):
    """Journal des actions admin plateforme (grants, rules, partners, tickets)."""
    rows = (await db.execute(
        select(AuditLog).where(AuditLog.org_id.is_(None))
        .order_by(AuditLog.timestamp.desc()).limit(200)
    )).scalars().all()
    return [{"id": a.id, "actor": a.actor_name, "role": a.actor_role,
             "action": a.action, "detail": a.details,
             "date": a.timestamp.isoformat() if a.timestamp else None} for a in rows]


@router.get("/tenants/{org_id}/devices")
async def tenant_devices(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scoped_permission("platform.tenants.read")),
):
    """Persisted tenant inventory with probe evidence; never infer online state."""
    await _get_org(db, org_id)
    devices = (await db.execute(
        select(DiscoveredDevice).where(DiscoveredDevice.org_id == org_id)
        .order_by(DiscoveredDevice.created_at.desc()).limit(1000)
    )).scalars().all()
    probes = (await db.execute(
        select(AgentProbe).where(AgentProbe.org_id == org_id)
    )).scalars().all()
    result = []
    for device in devices:
        probe = next((p for p in probes if (
            (device.ip and p.ip == device.ip) or
            (device.hostname and p.hostname and p.hostname.lower() == device.hostname.lower())
        )), None)
        result.append({
            "id": device.id, "hostname": device.hostname, "ip": device.ip,
            "mac": device.mac, "os": device.os_guess, "device_type": device.device_type,
            "is_probe": bool(device.is_probe), "imported": bool(device.imported),
            "monitoring_status": probe.status if probe else "not_monitored",
            "last_seen": probe.last_seen.isoformat() if probe and probe.last_seen else None,
            "probe_id": probe.id if probe else None,
        })
    return result


@router.get("/tenants/{org_id}/members")
async def tenant_members(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scoped_permission("platform.tenants.read")),
):
    """Tenant directory metadata only; password hashes and secrets are never serialized."""
    await _get_org(db, org_id)
    rows = (await db.execute(
        select(User).where(User.org_id == org_id).order_by(User.name).limit(500)
    )).scalars().all()
    return [{
        "id": row.id, "name": row.name, "email": row.email, "role": row.role,
        "status": row.status, "mfa_enabled": bool(row.mfa_enabled),
        "last_login": row.last_login.isoformat() if row.last_login else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    } for row in rows]


@router.get("/tenants/{org_id}/api-keys")
async def tenant_api_keys(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scoped_permission("platform.tenants.read")),
):
    """Show safe agent-token metadata only. Token hashes and bearer values are never returned."""
    await _get_org(db, org_id)
    rows = (await db.execute(
        select(AgentToken).where(AgentToken.org_id == org_id)
        .order_by(AgentToken.created_at.desc()).limit(500)
    )).scalars().all()
    return [{
        "id": row.id, "name": row.name, "prefix": row.prefix,
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
        "status": "revoked" if row.revoked_at else "active",
    } for row in rows]


@router.get("/tenants/{org_id}/activity")
async def tenant_activity(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_scoped_permission("platform.tenants.read")),
):
    """Tenant-scoped audit trail, newest first."""
    await _get_org(db, org_id)
    rows = (await db.execute(
        select(AuditLog).where(AuditLog.org_id == org_id)
        .order_by(AuditLog.timestamp.desc()).limit(100)
    )).scalars().all()
    return [{
        "id": row.id, "actor": row.actor_name, "actor_role": row.actor_role,
        "action": row.action, "resource": row.resource, "resource_id": row.resource_id,
        "details": row.details, "outcome": row.outcome,
        "timestamp": row.timestamp.isoformat() if row.timestamp else None,
    } for row in rows]
