"""Security Analytics API (Phase 4).

GET /api/analytics/overview?since&until&bucket&site_org_id
    -> KPIs, severity/category/status distributions, trend series, top assets.

All numbers are aggregated server-side from the tenant's own Alert and
Incident rows (see app/services/analytics.py for metric definitions).
Timezone: everything is UTC; `generated_at` marks data freshness.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.database import get_db
from app.models import User
from app.services import analytics
from app.routers.discovery import _scope_org  # same tenant-scoping rules

router = APIRouter(prefix="/analytics", tags=["Security Analytics"])


@router.get("/overview")
async def overview(
    since: Optional[datetime] = Query(None, description="UTC ISO start bound"),
    until: Optional[datetime] = Query(None, description="UTC ISO end bound"),
    bucket: str = Query("day", pattern="^(hour|day)$"),
    site_org_id: Optional[int] = Query(None),
    limit_assets: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _scope_org(current_user, site_org_id)
    since_c, until_c = analytics.clamp_window(since, until)

    events = await analytics._event_stats(db, org_id, since_c, until_c)
    detections = await analytics._detection_stats(db, org_id, since_c, until_c)
    trend = await analytics.trend(db, org_id, since_c, until_c, bucket)
    assets = await analytics.top_assets(db, org_id, since_c, until_c,
                                        limit=limit_assets)

    return {
        "org_id": org_id,
        "window": {"since": since_c.isoformat(), "until": until_c.isoformat(),
                   "timezone": "UTC", "bucket": bucket},
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "events": events,          # inbound alert rows (raw storage view)
        "detections": detections,  # deduped incident records
        "trend": trend,            # [{bucket, events, detections}]
        "top_assets": assets,
        "data_freshness": "live" if (events["total"] or detections["total"])
                          else "empty",
    }
