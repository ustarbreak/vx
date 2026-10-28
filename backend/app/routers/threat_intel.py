from fastapi import APIRouter, Depends, Query
from typing import Optional, List
import asyncio

from sqlalchemy import select

from app.core.security import get_current_user
from app.database import get_db
from app.models import User, Integration, Incident, Alert
from app.services.threat_intel import aggregate, fetch_alienvault_otx, fetch_misp


async def _misp_integration(db):
    return (await db.execute(select(Integration).where(
        Integration.name == "MISP"))).scalars().all()

router = APIRouter(prefix="/threat-intel", tags=["Threat Intelligence"])


@router.get("/threats")
async def list_threats(
    q: Optional[str] = Query(None, description="IoC to look up: IP, domain, URL or file hash"),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
):
    """
    Real Threat Intelligence feed.

    - Without `q`: returns recent events from the configured MISP instance
      (Integrations → MISP must be active).
    - With `q`: also queries AlienVault OTX live for that indicator and
      merges everything into the platform's normalized threat format.
    """
    threats = await aggregate(value=q, limit=limit)
    return {
        "query": q,
        "count": len(threats),
        "sources": ["MISP", "AlienVault OTX"] if q else ["MISP"],
        "threats": threats,
    }


@router.get("/lookup/{ioc}")
async def lookup_ioc(
    ioc: str,
    current_user: User = Depends(get_current_user),
):
    """Single-IoC enrichment (OTX + MISP), same shape as /threats."""
    otx, misp = await asyncio.gather(
        fetch_alienvault_otx(ioc), fetch_misp(ioc), return_exceptions=True)
    items: List[dict] = []
    for res in (otx, misp):
        if isinstance(res, list):
            items.extend(res)
    return {"ioc": ioc, "count": len(items), "threats": items}


@router.get("/feeds/status")
async def feeds_status(db=Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    """Feed synchronization status — real Integration rows only.

    Never fabricates a feed: MISP is reported configured ONLY when an active
    Integration row with endpoint+key exists; AlienVault OTX is a public
    lookup source used on-demand per indicator (no stored sync)."""
    misp = await _misp_integration(db)
    feeds = [{
        "name": "MISP",
        "kind": "instance",
        "configured": bool([i for i in misp if i.status == "active"
                            and i.api_endpoint and i.api_key]),
        "statuses": [{"id": i.id, "status": i.status,
                      "endpoint_set": bool(i.api_endpoint),
                      "last_sync": i.last_sync.isoformat() if i.last_sync else None}
                     for i in misp],
    }, {
        "name": "AlienVault OTX",
        "kind": "public-on-demand",
        "configured": True,   # no credentials required; queried per indicator
        "note": "Queried live per indicator via /threat-intel/lookup/<ioc>; "
                "no stored synchronization.",
    }]
    return {"feeds": feeds,
            "no_feed_data": not any(f["configured"] for f in feeds)}


@router.get("/matches")
async def indicator_matches(db=Depends(get_db),
                            current_user: User = Depends(get_current_user)):
    """IoCs actually attached to THIS tenant's incidents (real evidence of
    indicator-to-event linkage; empty list means no matches — never invented).
    `resource` links back into device details / alert drill-down."""
    org_id = current_user.org_id
    if org_id is None:
        return {"matches": []}
    incs = (await db.execute(select(Incident).where(
        Incident.org_id == org_id, Incident.ioc_related.isnot(None)))).scalars().all()
    out = []
    for inc in incs:
        for ioc in (inc.ioc_related or []):
            if not ioc:
                continue
            alerts = (await db.execute(select(Alert.uid).where(
                Alert.org_id == org_id, Alert.resource == (inc.affected_assets or [None])[0]
            ).limit(5))).scalars().all()
            out.append({
                "indicator": str(ioc),
                "incident_uid": inc.uid,
                "severity": inc.severity,
                "category": inc.category,
                "status": inc.status,
                "assets": (inc.affected_assets or [])[:10],
                "related_alert_uids": list(alerts),
                "observed_at": inc.created_at.isoformat() if inc.created_at else None,
            })
    out.sort(key=lambda m: m.get("observed_at") or "", reverse=True)
    return {"matches": out[:200], "count": len(out)}
