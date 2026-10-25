from fastapi import APIRouter, Depends, Query
from typing import Optional, List
import asyncio

from app.core.security import get_current_user
from app.models import User
from app.services.threat_intel import aggregate, fetch_alienvault_otx, fetch_misp

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
