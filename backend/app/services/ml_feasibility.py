"""STAGE 6D — ML feasibility assessment (read-only gate; NO training).

Purpose: turn the Stage 6C baseline report + Stage 6B label audit into a
MEASURED, reproducible readiness decision for a future shadow-mode model.
This module only SELECTs and computes; it never writes rows, never touches
app.services.triage scoring, and contains no training/ML runtime code.

Design target recommended here (and enforced as the evaluation contract in
Stage 6C): binary "p1/p2 vs p3/p4" prioritization on at-intake features,
judged against analyst outcome labels (disposition true_positive = positive
class; false_positive = negative; benign_duplicate/unknown excluded).

Readiness gates are DELIBERATELY not "500 labels / 90 days". Each gate is
computed from actual data:

  G1 volume      : >= N_MIN_VALIDATED validated head labels (default 300)
  G2 balance     : minority class >= N_MIN_MINORITY (default 50) AND minority
                   share within [0.05, 0.95] (extreme imbalance -> unreliable)
  G3 diversity   : >= 2 distinct tenants contributing validated labels AND
                   >= 4 distinct incident categories (single-tenant or
                   single-category corpora cannot support a general model)
  G4 time        : >= TIME_SPAN_MIN_DAYS (default 60) between earliest and
                   latest validated label timestamps (walk-forward splits
                   need real temporal spread)
  G5 noise       : unknown-disposition rate <= MAX_UNKNOWN_RATE (0.25) AND
                   correction rate <= MAX_CORRECTION_RATE (0.15)
  G6 baseline    : rules baseline must have MEASURED precision/recall with
                   Wilson CI half-width <= CI_HALF_WIDTH_MAX (0.15); an
                   "insufficient_data" baseline means we cannot even measure
                   the bar the model must beat
  G7 leakage     : every validated label must pair with a TriageEvaluation
                   snapshot (priority_labeled_at frozen); orphan labels are
                   counted and must be 0 for feature joins to be sound

The verdict is READY / NOT_READY with per-gate measured values. Estimates vs
measurements: all numbers in `gates` are measured from the DB; the only
estimates are the threshold constants themselves (documented policy choices,
not data-derived) — surfaced explicitly under `thresholds_are_estimates`.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Incident, OutcomeLabel, TriageEvaluation
from app.services.baseline_eval import _head_labels, baseline_report


def _ci_half_width(ci) -> Optional[float]:
    """Half-width of a [lo, hi] interval (either CI style), or None."""
    if not ci or len(ci) != 2 or ci[0] is None or ci[1] is None:
        return None
    return round((ci[1] - ci[0]) / 2.0, 4)

# --- Gate thresholds: POLICY ESTIMATES, not measurements. Chosen conservatively;
# changing them changes the readiness bar and must be a deliberate review act.
N_MIN_VALIDATED = 300          # est.: ~300 gives ~30+ minority positives/category
N_MIN_MINORITY = 50            # est.: floor for stable per-class rates
MINORITY_SHARE_BAND = (0.05, 0.95)
TIME_SPAN_MIN_DAYS = 60        # est.: two full drift windows minimum
MAX_UNKNOWN_RATE = 0.25        # est.: >1/4 unlabeled truth => noisy target
MAX_CORRECTION_RATE = 0.15     # est.: >15% rework => label process unstable
CI_HALF_WIDTH_MAX = 0.15       # est.: baseline must be known +/-15pp at 95%
MIN_TENANTS = 2
MIN_CATEGORIES = 4


async def assess_feasibility(db: AsyncSession, *, org_id: Optional[int] = None,
                             window_days: Optional[int] = None) -> dict:
    """Compute all gates from live data. Read-only."""
    rep = await baseline_report(db, org_id=org_id, window_days=window_days)
    corpus = rep["corpus"]
    metrics = rep.get("metrics_p1_vs_rest") or {}

    heads = await _head_labels(db, org_id)
    # validated head labels joined to incidents for tenant/category coverage
    uids = [h.incident_uid for h in heads
            if h.disposition in ("true_positive", "false_positive")]
    inc_rows = []
    if uids:
        inc_rows = list((await db.execute(
            select(Incident.org_id, Incident.category, Incident.uid)
            .where(Incident.uid.in_(uids)))).all())
    tenants = {r.org_id for r in inc_rows}
    categories = {(r.category or "uncategorized") for r in inc_rows}

    ts = sorted([h.created_at for h in heads
                 if h.created_at and h.disposition in ("true_positive", "false_positive")])
    span_days = ((ts[-1] - ts[0]).total_seconds() / 86400.0) if len(ts) >= 2 else 0.0

    total_heads = len(heads)
    unknown_n = sum(1 for h in heads if h.disposition == "unknown")
    unknown_rate = round(unknown_n / total_heads, 4) if total_heads else None

    # correction rate: corrected rows / all rows (needs full table incl. history)
    q = select(OutcomeLabel.supersedes_id)
    if org_id is not None:
        q = q.where(OutcomeLabel.org_id == org_id)
    all_sup = list((await db.execute(q)).all())
    n_rows = len(all_sup)
    n_chained = sum(1 for (s,) in all_sup if s is not None)
    correction_rate = round(n_chained / n_rows, 4) if n_rows else None

    orphans = [h.incident_uid for h in heads if h.priority_labeled_at is None
               and h.disposition in ("true_positive", "false_positive")]

    ci_hw = _ci_half_width(metrics.get("precision_ci95")
                           or metrics.get("wilson_precision_ci95"))

    validated = corpus.get("validated", 0)
    pos_n = metrics.get("tp", 0) + metrics.get("fn", 0)
    neg_n = metrics.get("fp", 0) + metrics.get("tn", 0)
    total_val = pos_n + neg_n
    minority = min(pos_n, neg_n) if total_val else None
    minority_share = round(minority / total_val, 4) if total_val else None

    gates = {
        "G1_volume": {"measured": validated, "threshold": N_MIN_VALIDATED,
                      "pass": validated >= N_MIN_VALIDATED},
        "G2_balance": {"minority_n": minority, "minority_share": minority_share,
                       "pass": (minority is not None
                                and minority >= N_MIN_MINORITY
                                and MINORITY_SHARE_BAND[0] <= minority_share <= MINORITY_SHARE_BAND[1])},
        "G3_diversity": {"tenants": len(tenants), "categories": sorted(categories),
                         "threshold": {"tenants": MIN_TENANTS, "categories": MIN_CATEGORIES},
                         "pass": len(tenants) >= MIN_TENANTS and len(categories) >= MIN_CATEGORIES},
        "G4_time_span": {"span_days": round(span_days, 2), "threshold": TIME_SPAN_MIN_DAYS,
                         "pass": span_days >= TIME_SPAN_MIN_DAYS},
        "G5_label_noise": {"unknown_rate": unknown_rate, "correction_rate": correction_rate,
                           "thresholds": {"unknown_max": MAX_UNKNOWN_RATE,
                                          "correction_max": MAX_CORRECTION_RATE},
                           "pass": (unknown_rate is not None
                                    and unknown_rate <= MAX_UNKNOWN_RATE
                                    and correction_rate is not None
                                    and correction_rate <= MAX_CORRECTION_RATE)},
        "G6_measurable_baseline": {"baseline_reliable": metrics.get("reliable"),
                                   "ci_half_width_precision": ci_hw,
                                   "threshold": CI_HALF_WIDTH_MAX,
                                   "pass": (metrics.get("reliable") is True
                                            and ci_hw is not None
                                            and ci_hw <= CI_HALF_WIDTH_MAX)},
        "G7_leakage_integrity": {"orphan_validated_labels": len(orphans),
                                 "pass": total_heads > 0 and len(orphans) == 0},
    }

    failing = sorted(k for k, v in gates.items() if not v["pass"])
    ready = not failing
    return {
        "stage": "6D",
        "read_only": True,
        "ai_assist_used": False,
        "scope_org_id": org_id,
        "window_days": window_days,
        "verdict": "READY_FOR_SHADOW_DESIGN" if ready else "NOT_READY",
        "failing_gates": failing,
        "gates": gates,
        "recommended_target": {
            "task": "binary prioritization: predict p1/p2 vs p3/p4 band",
            "positive_class": "label disposition == true_positive AND judged too_low "
                              "OR rule-band p1/p2 agreement (see 6C confusion)",
            "features_allowed": "at-intake fields only, joined via the frozen "
                                "TriageEvaluation breakdown snapshot",
            "safeguard": "critical-severity floor stays a hard post-processing rule "
                         "(CS_CRITICAL_FLOOR) regardless of model output",
        },
        "thresholds_are_estimates": {
            "note": "gate thresholds below are conservative POLICY CHOICES (estimates), "
                    "not derived from data; all 'measured' fields come from live rows.",
            "values": {"N_MIN_VALIDATED": N_MIN_VALIDATED, "N_MIN_MINORITY": N_MIN_MINORITY,
                        "MINORITY_SHARE_BAND": list(MINORITY_SHARE_BAND),
                        "TIME_SPAN_MIN_DAYS": TIME_SPAN_MIN_DAYS,
                        "MAX_UNKNOWN_RATE": MAX_UNKNOWN_RATE,
                        "MAX_CORRECTION_RATE": MAX_CORRECTION_RATE,
                        "CI_HALF_WIDTH_MAX": CI_HALF_WIDTH_MAX,
                        "MIN_TENANTS": MIN_TENANTS, "MIN_CATEGORIES": MIN_CATEGORIES},
        },
        "minimum_additional_data_needed": _next_steps(gates),
    }


def _next_steps(gates: dict) -> list[str]:
    steps = []
    g = gates
    if not g["G1_volume"]["pass"]:
        steps.append(f"Collect {g['G1_volume']['threshold'] - g['G1_volume']['measured']} "
                     "more validated (TP/FP) head labels via the 6A endpoint.")
    if not g["G2_balance"]["pass"]:
        steps.append("Grow the minority class to >= %d with share inside %s; "
                     "if structurally imbalanced, redefine target or use stratified sampling."
                     % (N_MIN_MINORITY, str(MINORITY_SHARE_BAND)))
    if not g["G3_diversity"]["pass"]:
        steps.append(f"Need >= {MIN_TENANTS} tenants and >= {MIN_CATEGORIES} categories "
                     "with validated labels before a shared model is defensible.")
    if not g["G4_time_span"]["pass"]:
        steps.append(f"Accumulate >= {TIME_SPAN_MIN_DAYS} days of labeled history so "
                     "walk-forward validation has real temporal spread.")
    if not g["G5_label_noise"]["pass"]:
        steps.append("Reduce unknown-disposition labeling and correction churn "
                     "(reviewer step + close-time prompt in the analyst UI).")
    if not g["G6_measurable_baseline"]["pass"]:
        steps.append("Baseline is not yet measurable with tight enough CIs; keep "
                     "collecting labels — do not compare a model to an unmeasured bar.")
    if not g["G7_leakage_integrity"]["pass"]:
        steps.append("Fix orphan labels (validated labels without a frozen triage "
                     "snapshot) by triaging before labeling; audit import pipelines.")
    if not steps:
        steps.append("All gates pass: proceed to Stage 6E shadow design (advisory-only, "
                     "versioned policy rows, critical floor preserved).")
    return steps
