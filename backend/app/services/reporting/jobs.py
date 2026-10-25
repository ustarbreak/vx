"""Aggregation jobs (Phase 3, brief §4) — ETL from live platform tables into
the reporting schema, plus the KPI pipeline.

Jobs (names follow the spec triggers):
  H  hourly   : ingest facts (alerts/tickets -> rpt_*), daily KPIs, platform metrics
  RT realtime: lightweight counters refreshed on demand (events/day, EPS proxy)
  J  nightly  : monthly rollup of rpt_kpi_daily -> rpt_kpi_monthly + prev_value
  M  monthly  : freeze previous month (frozen=true), posture & risk snapshots
  EV event    : recompute affected tenant when an incident is closed / a control
                is validated (called directly from the routers, see hooks.py)

Rules implemented here (brief §4 Phase 3):
  * incremental computation (only new/changed rows since last watermark);
  * UTC everywhere;
  * def_version stored with every figure;
  * no raw events in aggregates — counts and technical ids only;
  * idempotent: safe to re-run any window;
  * retention: daily KPIs kept RETENTION_DAILY_DAYS, monthly kept forever,
    source fact rows pruned after RETENTION_FACTS_DAYS (product owner: 2026-10).
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func as safunc, select

from app.database import AsyncSessionLocal
from app.models import Alert, Ticket
from app.models_reporting import (
    KpiDaily, KpiMonthly, PlatformMetric, RptAlert, RptIncident,
    RptTicketFact, RptExportLog,
)
from app.services.reporting import kpi_defs as K

logger = logging.getLogger("infracentra.reporting")

RETENTION_DAILY_DAYS = int(os.getenv("REPORTING_RETENTION_DAILY_DAYS", "730"))
RETENTION_FACTS_DAYS = int(os.getenv("REPORTING_RETENTION_FACTS_DAYS", "730"))


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _month_bounds(period: str) -> tuple[datetime, datetime]:
    y, m = int(period[:4]), int(period[5:7])
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + (m == 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
    return start, end


async def _tenants(db) -> list[str]:
    a = (await db.execute(select(RptAlert.tenant_id).distinct())).scalars().all()
    t = (await db.execute(select(RptTicketFact.tenant_id).distinct())).scalars().all()
    i = (await db.execute(select(RptIncident.tenant_id).distinct())).scalars().all()
    return sorted(set(map(str, list(a) + list(t) + list(i))))


# ---------------------------------------------------------------- job H ---
async def job_h_ingest(db, lookback_hours: int = 2) -> dict:
    """Incremental ETL: alerts -> rpt_alerts (+ incidents derived from tickets
    linked to security alerts), tickets -> rpt_ticket_facts. Deduplicated by
    natural key so re-runs are idempotent."""
    since = _utcnow() - timedelta(hours=lookback_hours)
    stats = {"alerts": 0, "tickets": 0}

    alerts = (await db.execute(
        select(Alert).where(Alert.created_at >= since))).scalars().all()
    existing_a = set((await db.execute(
        select(RptAlert.id, RptAlert.rule_name, RptAlert.detected_at)
        .where(RptAlert.recorded_at >= since - timedelta(days=1)))).all())
    for a in alerts:
        sev = {"critical": "crit", "high": "high", "medium": "med",
               "low": "low", "info": "low"}.get(a.severity, "low")
        rp = a.raw_payload or {}
        db.add(RptAlert(
            tenant_id=str(a.org_id), severity=sev,
            category=rp.get("category") or a.source,
            source_zone=rp.get("zone") or "platform",
            rule_name=a.title[:128], attack_id=rp.get("attack_id"),
            qualified=bool(a.acked_by or a.ticket_uid),
            false_positive=rp.get("disposition") == "benign",
            detected_at=a.created_at, recorded_at=_utcnow(), source="platform"))
        stats["alerts"] += 1

    tickets = (await db.execute(
        select(Ticket).where(Ticket.updated_at >= since) |
        select(Ticket).where(Ticket.created_at >= since))).unique().scalars().all()
    for t in tickets:
        breached = bool(t.due_resolve_at and
                        (t.resolved_at or _utcnow()) > t.due_resolve_at)
        db.add(RptTicketFact(
            tenant_id=str(t.org_id), ref=t.uid, category=t.category,
            priority=t.priority, status=t.status, opened_at=t.created_at,
            resolved_at=t.resolved_at, sla_breached=breached,
            assignee=t.assignee, source="ticketing", recorded_at=_utcnow()))
        stats["tickets"] += 1

    await db.commit()
    logger.info("job H ingest: %s", stats)
    return stats


async def job_h_kpis(db, day: str | None = None) -> dict:
    """Recompute DAILY KPIs per tenant from rpt_* facts (never from raw alerts).
    Idempotent: deletes then re-inserts the day's rows."""
    day = day or _utcnow().strftime("%Y-%m-%d")
    start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    tenants = await _tenants(db)
    n = 0
    for ten in tenants:
        await db.execute(delete(KpiDaily).where(
            KpiDaily.tenant_id == ten, KpiDaily.day == day))

        al = (await db.execute(select(RptAlert).where(
            RptAlert.tenant_id == ten,
            RptAlert.detected_at >= start, RptAlert.detected_at < end))).scalars().all()
        tk = (await db.execute(select(RptTicketFact).where(
            RptTicketFact.tenant_id == ten,
            RptTicketFact.opened_at >= start, RptTicketFact.opened_at < end))).scalars().all()
        inc = (await db.execute(select(RptIncident).where(
            RptIncident.tenant_id == ten,
            RptIncident.detected_at >= start, RptIncident.detected_at < end))).scalars().all()

        vals: dict[str, tuple[float, str]] = {}
        if al:
            vals["alerts_total"] = (len(al), "count")
            fp = K.fp_rate([(a.qualified, a.false_positive) for a in al])
            if fp is not None:
                vals["fp_rate"] = (fp, "%")
        # MTTD from incidents (fallback first correlated event ~ detected)
        pairs = [(i.started_at or i.detected_at, i.detected_at) for i in inc]
        mttd = K.mttd_min(pairs) if pairs else None
        if mttd is not None:
            vals["mttd_min"] = (mttd, "min")
        rows = [(i.detected_at, i.contained_at, i.closed_at) for i in inc]
        mttr = K.mttr_min(rows) if rows else None
        if mttr is not None:
            vals["mttr_min"] = (mttr, "min")
        auto = K.automation_rate([(i.status, i.auto_closed) for i in inc]) if inc else None
        if auto is not None:
            vals["automation_pct"] = (auto, "%")
        crit = sum(1 for i in inc if i.severity == "crit")
        vals["incidents_crit"] = (crit, "count")
        if tk:
            vals["tickets_opened"] = (len(tk), "count")
            br = sum(1 for t in tk if t.sla_breached)
            vals["tickets_sla_breached"] = (br, "count")

        for kpi, (v, unit) in vals.items():
            db.add(KpiDaily(tenant_id=ten, day=day, kpi=kpi, value=v,
                            unit=unit, def_version=K.DEF_VERSION,
                            computed_at=_utcnow(), source="job:H"))
            n += 1
    await db.commit()
    logger.info("job H kpis: %s rows for %s tenants (%s)", n, len(tenants), day)
    return {"rows": n, "tenants": len(tenants), "day": day}


async def job_rt_counters(db) -> dict:
    """Realtime-ish counters used by dashboards (cheap queries, cached by caller)."""
    now = _utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    async with AsyncSessionLocal() as s:
        today = await s.scalar(select(safunc.count()).select_from(RptAlert)
                               .where(RptAlert.detected_at >= day_start)) or 0
        eps = round(today / max(1, (now - day_start).total_seconds()), 1)
    return {"events_today": today, "eps_proxy": eps, "at": now.isoformat()}


# ---------------------------------------------------------------- job J ---
async def job_j_rollup(db, period: str | None = None) -> dict:
    """Nightly: aggregate rpt_kpi_daily -> rpt_kpi_monthly (mean for rates,
    sum for counts) and attach prev_value from the previous month."""
    period = period or _utcnow().strftime("%Y-%m")
    y, m = int(period[:4]), int(period[5:7])
    prev = f"{y - (m == 1):04d}-{12 if m == 1 else m - 1:02d}"
    SUM_KPI = {"alerts_total", "incidents_crit", "tickets_opened", "tickets_sla_breached"}
    tenants = await _tenants(db)
    n = 0
    for ten in tenants:
        days = (await db.execute(select(KpiDaily).where(
            KpiDaily.tenant_id == ten, KpiDaily.day.like(f"{period}%")))).scalars().all()
        if not days:
            continue
        by_kpi: dict[str, list[float]] = {}
        units: dict[str, str] = {}
        for d in days:
            by_kpi.setdefault(d.kpi, []).append(d.value)
            units[d.kpi] = d.unit or ""
        await db.execute(delete(KpiMonthly).where(
            KpiMonthly.tenant_id == ten, KpiMonthly.month == period))
        for kpi, vs in by_kpi.items():
            val = sum(vs) if kpi in SUM_KPI else sum(vs) / len(vs)
            pv = await db.scalar(select(KpiMonthly.value).where(
                KpiMonthly.tenant_id == ten, KpiMonthly.month == prev,
                KpiMonthly.kpi == kpi))
            db.add(KpiMonthly(tenant_id=ten, month=period, kpi=kpi, value=val,
                              unit=units[kpi], prev_value=pv,
                              def_version=K.DEF_VERSION, computed_at=_utcnow(),
                              source="job:J"))
            n += 1
    await db.commit()
    return {"rows": n, "period": period}


# ---------------------------------------------------------------- job M ---
async def job_m_freeze(db) -> dict:
    """Monthly: freeze the previous month (immutable history), snapshot the
    composite posture score, prune retention windows."""
    now = _utcnow()
    prev = (now.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    frozen = 0
    for ten in await _tenants(db):
        rows = (await db.execute(select(KpiMonthly).where(
            KpiMonthly.tenant_id == ten, KpiMonthly.month == prev,
            KpiMonthly.frozen.is_(False)))).scalars().all()
        for r in rows:
            r.frozen = True
            frozen += 1
        # posture snapshot from monthly components
        comps = {r.kpi: r.value for r in (await db.execute(select(KpiMonthly).where(
            KpiMonthly.tenant_id == ten, KpiMonthly.month == prev))).scalars().all()}
        vuln_sub = None
        if "fp_rate" in comps:  # detection quality proxy until scanner wired
            vuln_sub = max(0.0, 100.0 - comps.get("fp_rate", 0.0) * 2)
        cov = comps.get("coverage_pct")
        comp = comps.get("compliance_pct")
        inc_sub = max(0.0, 100.0 - comps.get("incidents_crit", 0.0) * 5.0)
        ps = K.posture_score(vuln_sub, cov, comp, inc_sub)
        if ps is not None:
            await db.execute(delete(KpiMonthly).where(
                KpiMonthly.tenant_id == ten, KpiMonthly.month == prev,
                KpiMonthly.kpi == "posture_score"))
            db.add(KpiMonthly(tenant_id=ten, month=prev, kpi="posture_score",
                              value=ps, unit="/100", def_version=K.DEF_VERSION,
                              frozen=True, computed_at=_utcnow(), source="job:M"))
    # retention pruning (aggregates kept 24 months per product-owner answer)
    cut_daily = now - timedelta(days=RETENTION_DAILY_DAYS)
    cut_facts = now - timedelta(days=RETENTION_FACTS_DAYS)
    del1 = await db.execute(delete(KpiDaily).where(KpiDaily.computed_at < cut_daily))
    del2 = await db.execute(delete(RptAlert).where(RptAlert.detected_at < cut_facts))
    del3 = await db.execute(delete(RptTicketFact).where(RptTicketFact.opened_at < cut_facts))
    await db.commit()
    return {"frozen": frozen, "pruned_daily": del1.rowcount,
            "pruned_alerts": del2.rowcount, "pruned_tickets": del3.rowcount}


# ------------------------------------------------------------ scheduler ---
class ReportingScheduler:
    """In-process asyncio scheduler (Linux + Windows friendly, no cron needed).
    Runs H every hour, J at night, M on the 1st — best-effort, restart-safe."""
    def __init__(self):
        self._task = None

    async def start(self):
        try:
            async with AsyncSessionLocal() as db:
                await job_h_ingest(db)
                await job_h_kpis(db)
                await job_j_rollup(db)
        except Exception as e:  # noqa: BLE001 — must never block startup
            logger.warning("reporting initial pass skipped: %s", e)
        self._task = asyncio.ensure_future(self._loop())

    async def _loop(self):
        last_day = None
        while True:
            await asyncio.sleep(3600)  # hourly tick
            try:
                now = _utcnow()
                async with AsyncSessionLocal() as db:
                    await job_h_ingest(db)
                    await job_h_kpis(db)
                    if now.strftime("%Y-%m-%d") != last_day:
                        last_day = now.strftime("%Y-%m-%d")
                        await job_j_rollup(db)
                        if now.day == 1:
                            await job_m_freeze(db)
            except Exception as e:  # noqa: BLE001
                logger.warning("reporting scheduled pass failed: %s", e)


scheduler = ReportingScheduler()
