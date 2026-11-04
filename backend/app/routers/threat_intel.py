from fastapi import APIRouter, Depends, Query
from typing import Optional, List
import asyncio
import re

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


def _contains_exact_ioc(value, ioc: str) -> bool:
    """Find an exact IOC value in structured alert evidence without matching
    substrings (e.g. 185.220.101.7 must not match 185.220.101.70)."""
    if isinstance(value, dict):
        return any(_contains_exact_ioc(v, ioc) for v in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains_exact_ioc(v, ioc) for v in value)
    if not isinstance(value, str):
        return False
    candidate = value.strip()
    if candidate.casefold() == ioc.casefold():
        return True
    boundary = r"(?<![A-Za-z0-9_.:-])" + re.escape(ioc) + r"(?![A-Za-z0-9_.:-])"
    return re.search(boundary, candidate, flags=re.IGNORECASE) is not None


def _alert_ioc_provenance(alert: Alert, ioc: str) -> list[str]:
    """Return only fields that actually contain the exact IOC value."""
    fields = []
    if _contains_exact_ioc(alert.raw_payload or {}, ioc):
        fields.append("raw_payload")
    if _contains_exact_ioc(alert.title or "", ioc):
        fields.append("title")
    if _contains_exact_ioc(alert.description or "", ioc):
        fields.append("description")
    return fields


@router.get("/matches")
async def indicator_matches(db=Depends(get_db),
                            current_user: User = Depends(get_current_user)):
    """Return tenant incident IoCs and only alerts whose stored evidence
    contains that exact indicator. Asset co-location alone is not provenance."""
    org_id = current_user.org_id
    if org_id is None:
        return {"matches": []}
    incs = (await db.execute(select(Incident).where(
        Incident.org_id == org_id, Incident.ioc_related.isnot(None)))).scalars().all()
    out = []
    # Fetch the tenant's bounded candidate set once, not once per incident IOC.
    candidates = (await db.execute(
        select(Alert).where(Alert.org_id == org_id)
        .order_by(Alert.created_at.desc()).limit(5000)
    )).scalars().all()
    for inc in incs:
        for raw_ioc in (inc.ioc_related or []):
            if not raw_ioc:
                continue
            ioc = str(raw_ioc).strip()
            if not ioc:
                continue
            provenance = []
            for alert in candidates:
                matched_fields = _alert_ioc_provenance(alert, ioc)
                if matched_fields:
                    provenance.append({"uid": alert.uid, "matched_fields": matched_fields})
            out.append({
                "indicator": ioc,
                "incident_uid": inc.uid,
                "severity": inc.severity,
                "category": inc.category,
                "status": inc.status,
                "assets": (inc.affected_assets or [])[:10],
                "related_alert_uids": [p["uid"] for p in provenance[:5]],
                "related_alert_provenance": provenance[:5],
                "observed_at": inc.created_at.isoformat() if inc.created_at else None,
            })
    out.sort(key=lambda m: m.get("observed_at") or "", reverse=True)
    return {"matches": out[:200], "count": len(out)}
