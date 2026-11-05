"""Service data endpoints — real backend wiring for ALL 16 platform services.

GET  /api/services/{service_id}/status   -> probe the service's open-source engine
GET  /api/services/{service_id}/live     -> pull REAL records from that engine
POST /api/services/sync                  -> fan-out sync of every configured engine

Demo Mode is a purely client-side concern (src/services/demoMode.ts intercepts
before any network call). These routes only ever run against the real backend,
so whatever they return is genuine data from the configured OSS tools.
"""
import logging
from typing import List
from fastapi import Body
from sqlalchemy import select, func
from app.core.platform_rbac import require_permission
from app.models import PlatformSetting, PlanEntitlementV2, ServiceLifecycleState, Integration, AuditLog

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.database import get_db
from app.models import User
from app.services import connectors, normalizers

logger = logging.getLogger("services_router")
router = APIRouter(prefix="/services", tags=["Services"])


@router.get("/catalog")
async def service_catalog(current_user: User = Depends(get_current_user)):
    """The 16+1 service -> open-source engine mapping (documentation endpoint)."""
    return [
        {"service_id": sid, "engine": meta["engine"], "docs": meta["docs"],
         "endpoints": list(meta["endpoints"].keys())}
        for sid, meta in connectors.SERVICE_CONNECTORS.items()
    ]


@router.get("/{service_id}/status")
async def service_status(
    service_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if service_id not in connectors.SERVICE_CONNECTORS:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            f"Unknown service '{service_id}'. See /api/services/catalog")
    cfg = await connectors.load_connector_config(service_id, db)
    if not cfg.get("api_endpoint"):
        return {"service_id": service_id, "configured": False, "reachable": False,
                "reason": "No active integration — add one under Integrations",
                "engine": connectors.SERVICE_CONNECTORS[service_id]["engine"]}
    res = await connectors.probe_connector(service_id, cfg)
    res["configured"] = True
    # T4.2 (additive, flag-gated): advance the per-org onboarding lifecycle
    # from probe results. Payload shape unchanged unless the flag is on.
    from app.core.config import settings
    if settings.SERVICE_LIFECYCLE_ENABLED:
        from app.platform import lifecycle
        target = "connected" if res.get("reachable") else "installed"
        row = await lifecycle.advance(db, current_user.org_id, service_id, target)
        res["lifecycle"] = lifecycle.as_dict(row)
    return res


@router.get("/{service_id}/live")
async def service_live(
    service_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """REAL records for a service, straight from its open-source backend."""
    if service_id not in connectors.SERVICE_CONNECTORS:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            f"Unknown service '{service_id}'. See /api/services/catalog")
    cfg = await connectors.load_connector_config(service_id, db)
    result = await connectors.fetch_live_records(service_id, cfg, limit=min(limit, 200))
    # Map the engine's native JSON onto the platform record structure so the
    # UI renders real data in exactly the same shape as the reference dataset.
    return normalizers.normalize(service_id, result)


@router.post("/sync")
async def sync_all(db: AsyncSession = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    """Health-check every configured connector at once (admin dashboards poll this)."""
    results: List[dict] = await connectors.status_all(db)
    return {"checked": len(results), "results": results}


# ---------------------------------------------------------------------------
# PA-10 — Owner-managed service catalog and plan entitlements.
# Configuration is persisted in platform_settings; plan inclusions are stored
# in PlanEntitlementV2 and immediately drive the subscription catalog.
# ---------------------------------------------------------------------------
PLAN_CODES = {"starter", "pro", "souverain", "custom", "trial"}


async def _catalog_config(db: AsyncSession) -> dict:
    row = await db.get(PlatformSetting, "platform.service_catalog")
    return row.value_json if row and isinstance(row.value_json, dict) else {}


@router.get("/platform-catalog")
async def platform_service_catalog(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("platform.services.read")),
):
    config = await _catalog_config(db)
    plans = (await db.execute(select(PlanEntitlementV2))).scalars().all()
    lifecycle = (await db.execute(
        select(ServiceLifecycleState.service_id, ServiceLifecycleState.state, func.count())
        .group_by(ServiceLifecycleState.service_id, ServiceLifecycleState.state)
    )).all()
    integrations = (await db.execute(
        select(Integration.service_id, Integration.status, func.count())
        .group_by(Integration.service_id, Integration.status)
    )).all()
    lifecycle_counts: dict[str, dict[str, int]] = {}
    for service_id, state, count in lifecycle:
        lifecycle_counts.setdefault(service_id, {})[state] = count
    integration_counts: dict[str, dict[str, int]] = {}
    for service_id, state, count in integrations:
        integration_counts.setdefault(service_id, {})[state] = count
    plan_map: dict[str, list[str]] = {}
    for row in plans:
        if row.included:
            plan_map.setdefault(row.plan, []).append(row.service_id)
    items = []
    for service_id, meta in connectors.SERVICE_CONNECTORS.items():
        override = config.get(service_id, {})
        items.append({
            "service_id": service_id,
            "engine": meta["engine"],
            "docs": meta["docs"],
            "endpoints": list(meta["endpoints"].keys()),
            "active": override.get("active", True),
            "label": override.get("label", service_id.replace("_", " ").title()),
            "description": override.get("description", ""),
            "lifecycle": lifecycle_counts.get(service_id, {}),
            "integrations": integration_counts.get(service_id, {}),
            "included_in_plans": sorted(code for code, ids in plan_map.items() if service_id in ids),
        })
    return {
        "services": items,
        "plans": [{"code": code, "service_ids": sorted(plan_map.get(code, []))} for code in sorted(PLAN_CODES)],
        "source": "connectors + platform_settings + plan_entitlements_v2 + service_lifecycle_states + integrations",
    }


@router.patch("/platform-catalog/{service_id}")
async def update_platform_service(
    service_id: str,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("platform.services.manage")),
):
    if service_id not in connectors.SERVICE_CONNECTORS:
        raise HTTPException(404, "Unknown service")
    allowed = {"active", "label", "description"}
    if not body or set(body) - allowed:
        raise HTTPException(422, "Only active, label and description can be changed")
    if "active" in body and not isinstance(body["active"], bool):
        raise HTTPException(422, "active must be boolean")
    if "label" in body and (not isinstance(body["label"], str) or not body["label"].strip() or len(body["label"]) > 80):
        raise HTTPException(422, "label must contain 1-80 characters")
    if "description" in body and (not isinstance(body["description"], str) or len(body["description"]) > 500):
        raise HTTPException(422, "description must contain at most 500 characters")
    row = await db.get(PlatformSetting, "platform.service_catalog")
    config = dict(row.value_json) if row and isinstance(row.value_json, dict) else {}
    config[service_id] = {**config.get(service_id, {}), **body}
    if row is None:
        row = PlatformSetting(key="platform.service_catalog", value_json=config, updated_by=user.id)
        db.add(row)
    else:
        row.value_json = config
        row.updated_by = user.id
    db.add(AuditLog(
        actor_id=user.id, actor_name=user.name, actor_role=user.role,
        action="platform.service_catalog.updated", resource="platform_service",
        resource_id=service_id, details="Updated fields: " + ", ".join(sorted(body)),
        outcome="success",
    ))
    await db.commit()
    return {"service_id": service_id, **config[service_id]}


@router.put("/platform-catalog/plans/{plan_code}")
async def replace_plan_services(
    plan_code: str,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_permission("platform.services.manage")),
):
    if plan_code not in PLAN_CODES:
        raise HTTPException(404, "Unknown plan code")
    service_ids = body.get("service_ids") if isinstance(body, dict) else None
    if not isinstance(service_ids, list) or any(not isinstance(x, str) for x in service_ids):
        raise HTTPException(422, "service_ids must be a list of service IDs")
    if len(service_ids) != len(set(service_ids)):
        raise HTTPException(422, "service_ids must not contain duplicates")
    unknown = set(service_ids) - set(connectors.SERVICE_CONNECTORS)
    if unknown:
        raise HTTPException(422, "Unknown service IDs: " + ", ".join(sorted(unknown)))
    existing = (await db.execute(
        select(PlanEntitlementV2).where(PlanEntitlementV2.plan == plan_code)
    )).scalars().all()
    for row in existing:
        await db.delete(row)
    for service_id in service_ids:
        db.add(PlanEntitlementV2(plan=plan_code, service_id=service_id, included=True))
    db.add(AuditLog(
        actor_id=user.id, actor_name=user.name, actor_role=user.role,
        action="platform.plan_entitlements.replaced", resource="plan",
        resource_id=plan_code, details=f"service_count={len(service_ids)}",
        outcome="success",
    ))
    await db.commit()
    return {"plan_code": plan_code, "service_ids": sorted(service_ids)}
