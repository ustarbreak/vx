"""KPI definition module — the SINGLE source of truth for every formula
(brief §4 Phase 1 + §6). No formula may be duplicated anywhere else; report
builders and aggregation jobs must call these functions.

Every function is pure: it takes plain values/sequences and returns a float or
None (None = "not computable", rendered honestly as 'Donnee indisponible',
never as a misleading zero — brief §4).

DEF_VERSION is stored alongside every computed figure in rpt_kpi_daily /
rpt_kpi_monthly so historical numbers can always be traced to their formula.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, Optional, Sequence

DEF_VERSION = "v1"


def _mean(vals: Sequence[float]) -> Optional[float]:
    return sum(vals) / len(vals) if vals else None


# ------------------------------------------------------------------ MTTD --
def mttd_min(pairs: Iterable[tuple[Optional[datetime], Optional[datetime]]]) -> Optional[float]:
    """MTTD = mean(detected_at - activity_start). When the real activity start
    is unknown, fall back to (detected_at - first_correlated_event) per pair.
    `pairs` yields (start_or_first_event, detected). Returns minutes."""
    durs = []
    for start, det in pairs:
        if det is None:
            continue
        s = start
        if s is None:
            continue
        delta = (det - s).total_seconds()
        if delta < 0:
            continue
        durs.append(delta / 60.0)
    return _mean(durs)


# ------------------------------------------------------------------ MTTR --
def mttr_min(rows: Iterable[tuple[Optional[datetime], Optional[datetime], Optional[datetime]]]) -> Optional[float]:
    """MTTR = mean((closed_at or contained_at) - detected_at), minutes."""
    durs = []
    for detected, contained, closed in rows:
        end = closed or contained
        if detected is None or end is None:
            continue
        delta = (end - detected).total_seconds()
        if delta < 0:
            continue
        durs.append(delta / 60.0)
    return _mean(durs)


# ------------------------------------------------------- false positives --
def fp_rate(alerts: Sequence[tuple[bool, bool]]) -> Optional[float]:
    """FP% = alerts classified benign / qualified alerts * 100.
    `alerts` yields (qualified, false_positive). None when nothing qualified."""
    qualified = [fp for q, fp in alerts if q]
    if not qualified:
        return None
    return 100.0 * sum(1 for fp in qualified if fp) / len(qualified)


# ------------------------------------------------------------ automation --
def automation_rate(incidents: Sequence[tuple[str, bool]]) -> Optional[float]:
    """Automation% = incidents closed without human action / all incidents * 100.
    `incidents` yields (status, auto_closed)."""
    total = len(incidents)
    if not total:
        return None
    auto = sum(1 for _s, a in incidents if a)
    return 100.0 * auto / total


# ------------------------------------------------------------- coverage ---
def coverage_pct(connected: int, expected: int) -> Optional[float]:
    """Coverage% = connected assets / expected assets * 100."""
    if expected <= 0:
        return None
    return min(100.0, 100.0 * connected / expected)


# ------------------------------------------------------ posture score ------
POSTURE_WEIGHTS = {"vuln": 0.30, "coverage": 0.25, "compliance": 0.25, "incident": 0.20}


def posture_score(vuln: Optional[float], coverage: Optional[float],
                  compliance: Optional[float], incident: Optional[float]) -> Optional[float]:
    """Weighted posture score 0..100 with weights 30/25/25/20 (validated by
    product owner, Oct 2026). Missing sub-scores are renormalized over the
    available components; returns None only if NOTHING is available."""
    parts = [(vuln, POSTURE_WEIGHTS["vuln"]),
             (coverage, POSTURE_WEIGHTS["coverage"]),
             (compliance, POSTURE_WEIGHTS["compliance"]),
             (incident, POSTURE_WEIGHTS["incident"])]
    avail = [(v, w) for v, w in parts if v is not None]
    if not avail:
        return None
    tot_w = sum(w for _v, w in avail)
    return sum(v * w for v, w in avail) / tot_w


# ---------------------------------------------------- global risk score ----
def global_risk_score(risks: Sequence[tuple[int, int]]) -> Optional[float]:
    """Risk exposure 0..100 = normalized mean(probability x impact) over OPEN
    risks (prob & impact on 1..5 scale => max product 25)."""
    if not risks:
        return None
    mean_prod = _mean([p * i for p, i in risks])
    return round(100.0 * mean_prod / 25.0, 1)


# ----------------------------------------------------- compliance score ----
def compliance_score(statuses: Sequence[str]) -> Optional[float]:
    """Compliant / applicable controls * 100; a partial control counts 0.5
    (brief §6). `statuses` items: compliant|partial|non_compliant."""
    pts = {"compliant": 1.0, "partial": 0.5, "non_compliant": 0.0}
    vals = [pts.get(s) for s in statuses]
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return 100.0 * sum(vals) / len(vals)


# --------------------------------------------------- hours saved (SOAR) ----
def hours_saved(runs: Sequence[tuple[float, Optional[float]]]) -> Optional[float]:
    """Saved analyst hours = SUM(manual_minutes_estimated)/60 over SUCCESSFUL
    playbook executions. `runs` yields (manual_minutes, success)."""
    ok = [m for m, success in runs if success and m is not None]
    if not ok:
        return None
    return sum(ok) / 60.0


# --------------------------------------------------------------- helpers ---
def fmt_min(v: Optional[float]) -> str:
    if v is None:
        return "—"
    if v < 60:
        return f"{v:.0f} min"
    h = v / 60.0
    if h < 48:
        return f"{h:.1f} h"
    return f"{h / 24:.1f} j"


def fmt_pct(v: Optional[float], digits: int = 1) -> str:
    return "—" if v is None else f"{v:.{digits}f} %"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
