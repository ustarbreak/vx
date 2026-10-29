"""Worldwide Attack Map API — real security events with geographic context.

GET /api/security/attack-map serves tenant-scoped events for the Dashboard's
worldwide threat map. Data source is the existing SIEM ingest pipeline
(POST /api/alerts): when a collector/SIEM provides approximate geolocation it
is persisted into Alert.raw_payload as src_geo / dst_geo / classification
(see app.services.notifications.merge_geo_payload).

Honesty rules enforced here:
  * Only events that actually carry a geographic fix are returned — an event
    without geo is NEVER promoted to the map (no invented coordinates).
  * IP geolocation is approximate; every point carries `confidence` when the
    source provided one, and `classification` distinguishes plain observed
    telemetry from malicious-classified or confirmed attacks.
  * Responses include `last_ingestion_at` so the UI can show staleness instead
    of fabricating activity, plus an honest empty state.
Tenancy: client roles are auto-scoped to their org; platform_admin may pass
site_id (an organization id) — cross-tenant access is rejected otherwise.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.security import get_current_user
from app.models import User, Alert
from app.services.ticketing import now_utc

router = APIRouter(prefix="/security/attack-map", tags=["Security Map"])


# ---------------------------------------------------------------------------
# Response schema (documented, stable contract for the frontend)
# ---------------------------------------------------------------------------
class MapPoint(BaseModel):
    lat: float | None = None
    lon: float | None = None
    country: str | None = None
    """Approximate only — derived from IP geolocation or collector metadata."""


class MapEvent(BaseModel):
    id: int
    uid: str
    timestamp: datetime
    event_type: str            # alert source (siem|wazuh|snmp|syslog|api|…)
    title: str
    severity: str              # critical|high|medium|low|info
    classification: str        # observed|malicious|confirmed
    src: MapPoint | None = None
    dst: MapPoint | None = None
    confidence: float | None = None    # min(src.confidence, dst.confidence)
    count: int = 1             # correlated/deduplicated events aggregated here
    resource: str | None = None        # affected asset (tenant-scoped)


class AttackMapPayload(BaseModel):
    events: list[MapEvent]
    total_events: int
    last_ingestion_at: datetime | None   # newest alert in window (any geo or not)
    generated_at: datetime
    note: str = ""


def _scope_org(user: User, requested_site: int | None) -> int | None:
    if user.role == "platform_admin":
        return requested_site
    if requested_site is not None and requested_site != user.org_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-tenant access denied")
    return user.org_id


def _point(raw: dict | None) -> MapPoint | None:
    if not isinstance(raw, dict):
        return None
    lat, lon = raw.get("lat"), raw.get("lon")
    country = raw.get("country")
    if lat is None and lon is None and not country:
        return None
    return MapPoint(lat=lat, lon=lon, country=country)


def _confidence(raw: dict | None) -> float | None:
    if isinstance(raw, dict):
        c = raw.get("confidence")
        if isinstance(c, (int, float)):
            return max(0.0, min(1.0, float(c)))
    return None


@router.get("", response_model=AttackMapPayload)
@router.get("/", response_model=AttackMapPayload)
async def attack_map(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    start_time: datetime | None = Query(None, description="ISO window start (inclusive)"),
    end_time: datetime | None = Query(None, description="ISO window end (exclusive)"),
    severity: str | None = Query(None, description="critical|high|medium|low|info (comma-list ok)"),
    event_type: str | None = Query(None, description="alert source, e.g. siem,wazuh"),
    source_country: str | None = Query(None),
    destination_country: str | None = Query(None),
    site_id: int | None = Query(None, description="platform_admin only: target org/site"),
    limit: int = Query(500, le=2000),
):
    """Authenticated, tenant-scoped geographic security events.

    Empty result + last_ingestion_at means "no geolocated events in this
    window" — the frontend must render an honest empty state, never fake arcs.
    """
    org = _scope_org(current_user, site_id)

    stmt = select(Alert).order_by(Alert.created_at.desc()).limit(limit)
    if org is not None:
        stmt = stmt.where(Alert.org_id == org)
    if start_time is not None:
        stmt = stmt.where(Alert.created_at >= start_time)
    if end_time is not None:
        stmt = stmt.where(Alert.created_at < end_time)
    rows = list((await db.execute(stmt)).scalars().all())

    sev_set = {s.strip().lower() for s in severity.split(",")} if severity else None
    type_set = {t.strip().lower() for t in event_type.split(",")} if event_type else None

    last_any = rows[0].created_at if rows else None

    events: list[MapEvent] = []
    for a in rows:
        payload = a.raw_payload if isinstance(a.raw_payload, dict) else {}
        src_raw, dst_raw = payload.get("src_geo"), payload.get("dst_geo")
        src, dst = _point(src_raw), _point(dst_raw)
        # A geographic event needs at least one real endpoint — skip the rest.
        if src is None and dst is None:
            continue
        if sev_set and a.severity.lower() not in sev_set:
            continue
        if type_set and (a.source or "").lower() not in type_set:
            continue
        if source_country and (not src or (src.country or "").lower() != source_country.lower()):
            continue
        if destination_country and (not dst or (dst.country or "").lower() != destination_country.lower()):
            continue
        cs, cd = _confidence(src_raw), _confidence(dst_raw)
        conf = min(x for x in (cs, cd) if x is not None) if (cs is not None or cd is not None) else None
        cls = payload.get("classification")
        if cls not in ("observed", "malicious", "confirmed"):
            cls = "observed"   # unverified telemetry is never shown as an attack
        events.append(MapEvent(
            id=a.id, uid=a.uid,
            timestamp=a.created_at.replace(tzinfo=a.created_at.tzinfo or timezone.utc)
            if a.created_at else now_utc(),
            event_type=a.source or "siem",
            title=a.title,
            severity=(a.severity or "medium").lower(),
            classification=cls,
            src=src, dst=dst, confidence=conf,
            count=max(1, a.correlated_count or 1),
            resource=a.resource,
        ))

    return AttackMapPayload(
        events=events,
        total_events=sum(e.count for e in events),
        last_ingestion_at=last_any,
        generated_at=datetime.now(timezone.utc),
        note=("Geolocation is approximate (IP-geolocation / collector metadata); "
              "'observed' events are telemetry, not confirmed attacks."),
    )
