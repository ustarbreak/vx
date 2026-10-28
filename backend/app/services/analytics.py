"""Security analytics aggregation service (Phase 4).

Every metric exposed here is computed from real rows in the platform's own
tables (alerts, incidents) — no mock data, no external calls.

Metric definitions (scope / window / timezone / denominator):
- All time windows are [since, until] UTC datetime bounds validated
  server-side; `bucket` truncates created_at to hour|day in UTC.
- "events" = Alert rows scoped to one organization (tenant isolation via
  Alert.org_id). Duplicate detections are NOT counted as separate events:
  each alert row already carries `correlated_count` (rows collapsed by the
  dedup engine), so we report both `events` (raw stored rows) and
  `raw_events_weighted` (sum of correlated_count) — never mix them.
- "detections" = Incident rows scoped to org (incidents are the deduped,
  lifecycle-managed detection records; one incident may aggregate many
  alerts). Denominator for rates below uses incidents.
- MTTD proxy = mean(created -> acknowledged) over acknowledged incidents in
  window. MTTR = mean(created -> resolved) over resolved incidents in window.
  Reported as null when the sample is empty (UI must show "no data", never 0).
"""
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Alert, Incident

SEVERITIES = ["critical", "high", "medium", "low", "info"]
CATEGORIES = ["malware", "phishing", "intrusion", "data_exfiltration",
              "policy_violation", "other"]
BUCKETS = {"hour": "%Y-%m-%dT%H:00Z", "day": "%Y-%m-%d"}


def clamp_window(since: Optional[datetime], until: Optional[datetime],
                 default_hours: int = 24, max_days: int = 366):
    """Safe time-range validation: naive datetimes are treated as UTC,
    until defaults to now, since defaults to until - default_hours,
    inverted ranges are swapped, spans > max_days are clamped."""
    if until is None:
        until = datetime.now(timezone.utc)
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    if since is None:
        since = until - timedelta(hours=default_hours)
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    if since > until:
        since, until = until, since
    max_span = timedelta(days=max_days)
    if until - since > max_span:
        since = until - max_span
    return since, until


async def _event_stats(db: AsyncSession, org_id: int, since: datetime,
                       until: datetime) -> Dict[str, Any]:
    rows = (await db.execute(
        select(Alert.severity, func.count(), func.sum(Alert.correlated_count))
        .where(Alert.org_id == org_id, Alert.created_at >= since,
               Alert.created_at <= until)
        .group_by(Alert.severity)
    )).all()
    by_sev = {s: 0 for s in SEVERITIES}
    total = weighted = 0
    for sev, cnt, wsum in rows:
        key = sev if sev in by_sev else "info"
        by_sev[key] += int(cnt or 0)
        total += int(cnt or 0)
        weighted += int(wsum or 0)
    return {"total": total, "by_severity": by_sev,
            "raw_events_weighted": weighted}


async def _detection_stats(db: AsyncSession, org_id: int, since: datetime,
                           until: datetime) -> Dict[str, Any]:
    conds = [Incident.org_id == org_id, Incident.created_at >= since,
             Incident.created_at <= until]
    by_sev_rows = (await db.execute(
        select(Incident.severity, func.count()).where(*conds)
        .group_by(Incident.severity))).all()
    by_cat_rows = (await db.execute(
        select(Incident.category, func.count()).where(*conds)
        .group_by(Incident.category))).all()
    by_status_rows = (await db.execute(
        select(Incident.status, func.count()).where(*conds)
        .group_by(Incident.status))).all()

    by_sev = {s: 0 for s in SEVERITIES}
    by_cat = {c: 0 for c in CATEGORIES}
    by_status: Dict[str, int] = {}
    total = 0
    for sev, cnt in by_sev_rows:
        by_sev[sev if sev in by_sev else "info"] += int(cnt or 0)
    for cat, cnt in by_cat_rows:
        by_cat[cat if cat in by_cat else "other"] += int(cnt or 0)
    for st, cnt in by_status_rows:
        by_status[st or "open"] = int(cnt or 0)
        total += int(cnt or 0)

    # MTTR / MTTD proxies (minutes). Empty samples -> None, never fake 0.
    # Portable AVG over datetime columns: raw SQL with explicit UTC bounds.
    # NOTE: storage stores naive-UTC datetimes; julianday() of a *naive* text
    # is interpreted as UTC midnight-based days — multiply by 1440 for minutes.
    s_iso = since.strftime("%Y-%m-%d %H:%M:%S")
    u_iso = until.strftime("%Y-%m-%d %H:%M:%S")
    dialect = db.bind.dialect.name if hasattr(db.bind, "dialect") else ""
    if dialect == "sqlite":
        diff = lambda a, b: f"(julianday({a}) - julianday({b})) * 1440.0"  # noqa: E731
    elif dialect.startswith("mysql"):
        diff = lambda a, b: f"TIMESTAMPDIFF(MINUTE, {b}, {a})"  # noqa: E731
    else:  # postgres: timestamptz subtraction yields an interval in seconds
        diff = lambda a, b: f"EXTRACT(EPOCH FROM ({a} - {b})) / 60.0"  # noqa: E731

    async def _avg(col: str) -> Optional[float]:
        sql = text(
            f"SELECT AVG({diff(col, 'created_at')}) FROM incidents "
            "WHERE org_id=:o AND created_at>=:s AND created_at<=:u "
            f"AND {col} IS NOT NULL")
        val = (await db.execute(sql, {"o": org_id, "s": s_iso, "u": u_iso})).scalar()
        return round(float(val), 1) if val is not None else None

    mttr = await _avg("resolved_at")
    mttd = await _avg("acknowledged_at")

    return {
        "total": total,
        "by_severity": by_sev,
        "by_category": by_cat,
        "by_status": by_status,
        "mttd_minutes": round(mttd * 1440, 1) if mttd is not None else None,
        "mttr_minutes": round(mttr * 1440, 1) if mttr is not None else None,
    }


async def trend(db: AsyncSession, org_id: int, since: datetime,
                until: datetime, bucket: str = "day") -> List[Dict[str, Any]]:
    """Time series of events vs detections per UTC bucket."""
    fmt = BUCKETS.get(bucket, BUCKETS["day"])
    ev = (await db.execute(
        select(func.strftime(fmt, Alert.created_at).label("b"), func.count())
        .where(Alert.org_id == org_id, Alert.created_at >= since,
               Alert.created_at <= until)
        .group_by("b").order_by("b"))).all()
    det = (await db.execute(
        select(func.strftime(fmt, Incident.created_at).label("b"), func.count())
        .where(Incident.org_id == org_id, Incident.created_at >= since,
               Incident.created_at <= until)
        .group_by("b").order_by("b"))).all()
    ev_map = {b: int(c) for b, c in ev if b}
    det_map = {b: int(c) for b, c in det if b}
    buckets = sorted(set(ev_map) | set(det_map))
    return [{"bucket": b, "events": ev_map.get(b, 0),
             "detections": det_map.get(b, 0)} for b in buckets]


async def top_assets(db: AsyncSession, org_id: int, since: datetime,
                     until: datetime, limit: int = 10) -> List[Dict[str, Any]]:
    rows = (await db.execute(
        select(Alert.resource, func.count().label("n"))
        .where(Alert.org_id == org_id, Alert.created_at >= since,
               Alert.created_at <= until, Alert.resource.isnot(None))
        .group_by(Alert.resource).order_by(func.count().desc())
        .limit(limit))).all()
    return [{"resource": r, "events": int(n)} for r, n in rows]
