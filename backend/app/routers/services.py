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
