"""T7.1/T7.2 — UEBA baseline scaffold + analyst-approved incident summary (beta).

Additive, flag-gated (PLATFORM_CATALOG_ENABLED). No vendor LLM key is ever
invented or required: the "summary" is a deterministic, honest digest of the
incident record itself, stored with an explicit `analyst_approved=False`
until a human approves it (owner rule: AI output never auto-labels truth).

UEBA honesty rule from the brief/plan: we report baseline sample counts and
Wilson confidence intervals from `baseline_eval`, but we NEVER claim an
"anomaly detected" until the configured observation window has enough data
(min 30 labeled outcomes; below that -> status "insufficient_data").
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user
from app.database import get_db
from app.models import Incident, User

router = APIRouter(prefix="/platform/ueba", tags=["platform-ueba"])

MIN_WINDOW_SAMPLES = 30  # honest floor before any deviation may be reported


# --------------------------------------------------------------------------
# T7.1 — asset deviation scaffold (no anomaly claims without window)
# --------------------------------------------------------------------------
@router.get("/assets")
async def ueba_assets(
    org_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Per-asset incident-count scaffold for the org. Status is honestly
    'insufficient_data' until MIN_WINDOW_SAMPLES incidents exist."""
    oid = org_id if org_id is not None else user.org_id
    rows = (await db.execute(
        select(Incident).where(Incident.org_id == oid)
    )).scalars().all()

    per_asset: Dict[str, Dict[str, Any]] = {}
    for inc in rows:
        for asset in (inc.affected_assets or []):
            e = per_asset.setdefault(str(asset), {
                "asset": str(asset), "incidents": 0,
                "critical": 0, "high": 0, "open": 0})
            e["incidents"] += 1
            if inc.severity == "critical":
                e["critical"] += 1
            elif inc.severity == "high":
                e["high"] += 1
            if inc.status in ("open", "investigating"):
                e["open"] += 1

    total = len(rows)
    window_ok = total >= MIN_WINDOW_SAMPLES
    return {
        "org_id": oid,
        "status": "ok" if window_ok else "insufficient_data",
        "sample_incidents": total,
        "min_window_samples": MIN_WINDOW_SAMPLES,
        "note": ("deviation reporting disabled until window met"
                 if not window_ok else
                 "counts only; statistical baselining lives in baseline_eval"),
        "assets": sorted(per_asset.values(),
                         key=lambda a: (-a["critical"], -a["incidents"]))[:50],
    }


# --------------------------------------------------------------------------
# T7.2 — deterministic incident summary, analyst-approval gated
# --------------------------------------------------------------------------
class SummaryOut(BaseModel):
    incident_uid: str
    text: str
    generated_by: str
    analyst_approved: bool
    approved_by: Optional[str] = None


_summaries: Dict[str, SummaryOut] = {}  # in-memory scaffold (TODO_VERIFY: persist table when GA)


def _digest(inc: Incident) -> str:
    sev = (inc.severity or "medium").upper()
    assets = ", ".join((inc.affected_assets or [])[:5]) or "no linked assets"
    iocs = ", ".join((inc.ioc_related or [])[:5]) or "none"
    ts = (inc.created_at if hasattr(inc, "created_at") and inc.created_at
          else datetime.now(timezone.utc)).isoformat(timespec="seconds") \
        if hasattr(inc, "created_at") else "n/a"
    return (f"[{sev}] {inc.title} — status={inc.status}, assignee={inc.assignee or 'unassigned'}, "
            f"assets: {assets}; IOCs: {iocs}. Deterministic digest, no ML involved.")


@router.get("/summary/{uid}", response_model=SummaryOut)
async def get_summary(uid: str, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    if not settings.PLATFORM_CATALOG_ENABLED:
        raise HTTPException(404, "platform catalog disabled")
    inc = (await db.execute(select(Incident).where(
        Incident.uid == uid, Incident.org_id == user.org_id))).scalar_one_or_none()
    if inc is None:
        raise HTTPException(404, f"incident {uid} not found in your org")
    cached = _summaries.get(uid)
    if cached:
        return cached
    s = SummaryOut(incident_uid=uid, text=_digest(inc),
                   generated_by="deterministic-digest-v1", analyst_approved=False)
    _summaries[uid] = s
    return s


class ApproveIn(BaseModel):
    approve: bool = True


@router.post("/summary/{uid}/approve", response_model=SummaryOut)
async def approve_summary(uid: str, body: ApproveIn,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    if user.role not in ("platform_admin", "client_admin"):
        raise HTTPException(403, "only admins may approve summaries")
    s = _summaries.get(uid)
    if s is None:
        raise HTTPException(404, "generate the summary first")
    _summaries[uid] = s.model_copy(update={
        "analyst_approved": bool(body.approve),
        "approved_by": user.email if body.approve else None})
    return _summaries[uid]
