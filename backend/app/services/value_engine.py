"""Value Engine — the 6 "show the money" mechanics, computed from REAL data.

Design rules (brief §2): read-only over the platform; no third-party tool names
in outputs; every number derived from ticketing/alert/playbook tables so demo
and real mode use the exact same formulas.

Mechanics:
 1. Value Receipt   → money saved this month (analyst time + avoided downtime)
 2. Red Line        → before/after comparison of key ops metrics
 3. Risk Cost       → residual-risk cost of open tickets/vulns
 4. Before/After    → KPI deltas vs previous period
 5. Maturity Score  → security maturity 0-100 with sector benchmark
 6. Proof Pack      → exportable summary blocks for internal advocacy

Pricing assumptions (editable via roi_parameters later):
  ANALYST_HOURLY_COST = 45 USD/h   (Morocco/EU blended SOC analyst rate)
  DOWNTIME_HOURLY_COST = 800 USD/h (conservative mid-market estimate)
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Ticket, Alert, Organization

ANALYST_HOURLY = 45.0
DOWNTIME_HOURLY = 800.0
# minutes of manual analyst work replaced by each automated action
AUTOMATION_MINUTES = {
    "triage": 12, "enrichment": 8, "isolation": 25, "block": 15,
    "reset": 20, "ticket": 10, "escalation": 18, "notification": 5,
}


def _month_bounds(period: str | None = None) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    if period and "-" in period:
        y, m = int(period.split("-")[0]), int(period.split("-")[1])
    else:
        y, m = now.year, now.month
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + (m == 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
    return start, end


async def compute_value(org_id: int | None, db: AsyncSession,
                        period: str | None = None) -> dict:
    """Return the synchronized value payload used by all 6 mechanics."""
    start, end = _month_bounds(period)

    tstmt = select(Ticket).where(Ticket.created_at >= start, Ticket.created_at < end)
    astmt = select(Alert).where(Alert.created_at >= start, Alert.created_at < end)
    if org_id is not None:
        tstmt = tstmt.where(Ticket.org_id == org_id)
        astmt = astmt.where(Alert.org_id == org_id)
    tickets = list((await db.execute(tstmt)).scalars().all())
    alerts = list((await db.execute(astmt)).scalars().all())

    # ---- automation savings --------------------------------------------------
    resolved = [t for t in tickets if t.status in ("resolved", "closed")]
    auto_closed = [t for t in tickets if t.source in ("alert", "api", "discovery")
                   and t.status in ("resolved", "closed")]
    ai_triaged = [t for t in tickets if t.triaged_at or t.ai_category]
    acked = [a for a in alerts if getattr(a, "acked_at", None)]
    suppressed = [a for a in alerts if getattr(a, "storm_suppressed", False)]

    minutes_saved = (
        len(auto_closed) * AUTOMATION_MINUTES["isolation"]
        + len(ai_triaged) * AUTOMATION_MINUTES["triage"]
        + len(acked) * AUTOMATION_MINUTES["enrichment"]
        + len(suppressed) * AUTOMATION_MINUTES["notification"]
    )
    hours_saved = round(minutes_saved / 60.0, 1)
    labor_saved = round(hours_saved * ANALYST_HOURLY, 2)

    # ---- downtime avoided (MTTR proxy) --------------------------------------
    durations_min = []
    for t in resolved:
        det = t.triaged_at or t.created_at
        if det and t.resolved_at:
            d = (t.resolved_at - det).total_seconds() / 60.0
            if 0 < d < 60 * 24 * 30:
                durations_min.append(d)
    avg_mttr_min = round(sum(durations_min) / len(durations_min), 1) if durations_min else 0.0
    # baseline industry MTTR ~ 4h without platform → delta × incidents × cost/h
    baseline_min = 240.0
    avoided_hours = round(max(baseline_min - avg_mttr_min, 0) * len(resolved) / 60.0, 1)
    downtime_avoided = round(avoided_hours * DOWNTIME_HOURLY, 2)

    total_usd = round(labor_saved + downtime_avoided, 2)

    # ---- risk cost (mechanic 3) ---------------------------------------------
    crit_open = [t for t in tickets if t.priority == "p1" and t.status not in ("resolved", "closed")]
    high_open = [t for t in tickets if t.priority == "p2" and t.status not in ("resolved", "closed")]
    breach = [t for t in tickets if getattr(t, "sla_state", None) == "breached"
              and t.status not in ("resolved", "closed")]
    exposure = round(len(crit_open) * 25_000 + len(high_open) * 8_000
                     + len(breach) * 3_500, 2)

    # ---- maturity score (mechanic 5) ----------------------------------------
    total_alerts = max(len(alerts), 1)
    coverage = min(100.0, round(len(acked) / total_alerts * 100, 1))
    automation_rate = round(len(auto_closed) / max(len(tickets), 1) * 100, 1)
    triage_rate = round(len(ai_triaged) / max(len(tickets), 1) * 100, 1)
    sla_ok = [t for t in tickets if getattr(t, "sla_state", None) != "breached"]
    sla_rate = round(len(sla_ok) / max(len(tickets), 1) * 100, 1)
    maturity = round(coverage * 0.2 + automation_rate * 0.3 + triage_rate * 0.2 + sla_rate * 0.3, 1)

    fp = round(len([a for a in alerts if a.severity in ("low", "info")]) / total_alerts * 100, 1)

    receipt_hash = hashlib.sha256(json.dumps(
        {"o": org_id, "p": f"{start:%Y-%m}", "u": total_usd, "h": hours_saved}, sort_keys=True
    ).encode()).hexdigest()[:16]

    return {
        "period": f"{start:%Y-%m}",
        "receipt": {
            "hash": receipt_hash,
            "hours_saved": hours_saved,
            "labor_saved_usd": labor_saved,
            "downtime_avoided_usd": downtime_avoided,
            "total_usd": total_usd,
            "tickets_total": len(tickets),
            "tickets_resolved": len(resolved),
            "auto_closed": len(auto_closed),
            "ai_triaged": len(ai_triaged),
            "alerts_total": len(alerts),
            "alerts_suppressed": len(suppressed),
        },
        "red_line": {
            "avg_mttr_min": avg_mttr_min,
            "baseline_mttr_min": baseline_min,
            "improvement_pct": round(max(0.0, (baseline_min - avg_mttr_min) / baseline_min * 100), 1),
            "false_positive_pct": fp,
        },
        "risk_cost": {
            "exposure_usd": exposure,
            "critical_open": len(crit_open),
            "high_open": len(high_open),
            "sla_breaches": len(breach),
            "per_action": {
                "close_p1": 25_000, "close_p2": 8_000, "fix_breach": 3_500,
            },
        },
        "maturity": {
            "score": maturity,
            "benchmark_sector_avg": 54.0,
            "components": {
                "alert_coverage": coverage,
                "automation_rate": automation_rate,
                "ai_triage_rate": triage_rate,
                "sla_compliance": sla_rate,
            },
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
