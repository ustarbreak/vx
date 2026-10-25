"""Value Engine API — the 6 money-showing mechanics, backed by real DB data.

  GET /api/value?period=YYYY-MM          → full payload (receipt, red line,
                                           risk cost, maturity, proof pack)
  GET /api/value/receipt                 → Value Receipt only (dashboard widget)
  GET /api/value/proof-pack.pdf|csv      → mechanic 6 export

Tenancy: client roles are auto-scoped to their org; platform_admin may pass
org_id to inspect a specific tenant (used by the Tenant Manager).
"""
from __future__ import annotations

import io
import csv

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.security import get_current_user
from app.models import User
from app.services import value_engine

router = APIRouter(prefix="/value", tags=["Value Engine"])


def _scope(user: User, requested_org: int | None) -> int | None:
    if user.role == "platform_admin":
        return requested_org
    return user.org_id


@router.get("")
async def value_payload(period: str = Query("", pattern=r"^$|^\d{4}-\d{2}$"),
                        org_id: int | None = Query(None),
                        current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    org = _scope(current_user, org_id)
    return await value_engine.compute_value(org, db, period or None)


@router.get("/receipt")
async def value_receipt(period: str = Query(""), org_id: int | None = Query(None),
                        current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    v = await value_engine.compute_value(_scope(current_user, org_id), db, period or None)
    return {"period": v["period"], **v["receipt"], "maturity": v["maturity"]["score"]}


@router.get("/proof-pack")
async def proof_pack(fmt: str = Query("csv", pattern="^(csv|json)$"),
                     period: str = Query(""), org_id: int | None = Query(None),
                     current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    v = await value_engine.compute_value(_scope(current_user, org_id), db, period or None)
    if fmt == "json":
        return v
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Infracentra Proof Pack", v["period"]])
    w.writerow([])
    w.writerow(["Mechanic", "Metric", "Value"])
    r, rl, rc, m = v["receipt"], v["red_line"], v["risk_cost"], v["maturity"]
    rows = [
        ["1. Value Receipt", "Total saved (USD)", r["total_usd"]],
        ["1. Value Receipt", "Analyst hours saved", r["hours_saved"]],
        ["1. Value Receipt", "Labor saved (USD)", r["labor_saved_usd"]],
        ["1. Value Receipt", "Downtime avoided (USD)", r["downtime_avoided_usd"]],
        ["2. Red Line", "Avg MTTR (min)", rl["avg_mttr_min"]],
        ["2. Red Line", "Industry baseline MTTR (min)", rl["baseline_mttr_min"]],
        ["2. Red Line", "Improvement (%)", rl["improvement_pct"]],
        ["3. Risk Cost", "Open exposure (USD)", rc["exposure_usd"]],
        ["3. Risk Cost", "Critical open", rc["critical_open"]],
        ["5. Maturity", "Score /100", m["score"]],
        ["5. Maturity", "Sector benchmark", m["benchmark_sector_avg"]],
    ]
    for row in rows:
        w.writerow(row)
    data = "\ufeff" + buf.getvalue()
    return StreamingResponse(
        io.BytesIO(data.encode("utf-8")),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="infracentra-proof-pack-{v["period"]}.csv"'},
    )
