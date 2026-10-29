"""STAGE 6C — Rules-baseline evaluation over validated outcome labels.

READ-ONLY analysis module: it SELECTs from incidents / triage_evaluations /
outcome_labels and computes metrics. It performs NO writes, does NOT touch the
scoring path (app.services.triage is imported for vocabulary constants only),
trains nothing, and integrates no LLM.

Task definition (binary, at-intake):
    positive := latest HEAD label disposition == "true_positive"
    negative := disposition in {"false_positive", "benign_duplicate"}
    excluded := disposition == "unknown" (reported as coverage gap)

Prediction under evaluation = the rules engine's priority as the analyst saw
it at close time (frozen by Stage 6A into OutcomeLabel.priority_labeled_at).
LEAKAGE CONTROL: predictions come ONLY from that frozen snapshot; features
available at prediction time are the ones already stored in the immutable
TriageEvaluation row. No post-resolution field (status, resolved_at, notes,
final label) is ever used as a prediction input here.

Primary operating point (v1 policy bands): predicted positive = p1/p2.
Secondary view: p1-only (high-precision band).

Confidence intervals use the EXACT Clopper-Pearson (beta) method via
scipy.stats when available; otherwise they are reported as null with an
explicit `ci_method` marker ("none") — never fabricated.

Small-sample honesty: every slice reports `reliable=false` plus warnings when
n < MIN_RELIABLE_N (30) or a class count < 5. The report refuses to imply
statistical validity it does not have.

Priority-correctness secondary metric (multinomial counts + agreement rate
over labeled-priority rows only; unknown/untriaged rows excluded and counted).
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Incident, OutcomeLabel, TriageEvaluation

MIN_RELIABLE_N = 30
MIN_CLASS_N = 5
POSITIVE_BANDS = ("p1", "p2")
HIGH_BANDS = ("p1",)

try:  # exact beta intervals when scipy is present; else honest nulls
    from scipy.stats import beta as _beta
except Exception:  # pragma: no cover - environment dependent
    _beta = None


# ---------------------------------------------------------------------------
# Pure metric core — no DB, deterministic, unit-testable
# ---------------------------------------------------------------------------
def wilson_interval(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion (no external deps)."""
    if n <= 0:
        return (0.0, 0.0)
    ph = k / n
    d = 1 + z * z / n
    c = (ph + z * z / (2 * n)) / d
    h = (z / d) * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n))
    return (max(0.0, c - h), min(1.0, c + h))


def clopper_pearson(k: int, n: int, alpha: float = 0.05) -> Optional[tuple]:
    """Exact binomial CI; None if scipy unavailable or n == 0."""
    if _beta is None or n <= 0:
        return None
    lo = 0.0 if k == 0 else float(_beta.ppf(alpha / 2, k, n - k + 1))
    hi = 1.0 if k == n else float(_beta.ppf(1 - alpha / 2, k + 1, n - k))
    return (round(lo, 4), round(hi, 4))


def _rates(counts: Counter, *, band_names: tuple) -> dict:
    """Derive precision/recall/F1/FPR from a confusion-counter of
    (pred_band, truth) pairs for one operating point."""
    tp = sum(counts.get((b, "positive"), 0) for b in band_names)
    fp = sum(counts.get((b, "negative"), 0) for b in band_names)
    fn = sum(counts.get((b, "positive"), 0)
             for b in [x for x in ("p1", "p2", "p3", "p4", None) if x not in band_names])
    tn = sum(counts.get((b, "negative"), 0)
             for b in [x for x in ("p1", "p2", "p3", "p4", None) if x not in band_names])
    n = tp + fp + fn + tn
    precision = tp / (tp + fp) if (tp + fp) else None
    recall = tp / (tp + fn) if (tp + fn) else None
    fpr = fp / (fp + tn) if (fp + tn) else None
    f1 = (2 * precision * recall / (precision + recall)
          if precision and recall and (precision + recall) > 0 else
          (0.0 if (tp + fp > 0 or tp + fn > 0) and precision is not None and recall is not None
           else None))
    prec_ci = clopper_pearson(tp, tp + fp)
    rec_ci = clopper_pearson(tp, tp + fn)
    return {
        "n": n, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "class_balance_pos": round((tp + fn) / n, 4) if n else None,
        "precision": round(precision, 4) if precision is not None else None,
        "recall": round(recall, 4) if recall is not None else None,
        "f1": round(f1, 4) if f1 is not None else None,
        "false_positive_rate": round(fpr, 4) if fpr is not None else None,
        "precision_ci95": list(prec_ci) if prec_ci else None,
        "recall_ci95": list(rec_ci) if rec_ci else None,
        "wilson_precision_ci95": [round(x, 4) for x in wilson_interval(tp, tp + fp)]
                                 if (tp + fp) else None,
        "reliable": bool(n >= MIN_RELIABLE_N and min(tp + fn, fp + tn) >= MIN_CLASS_N
                         if n else False),
    }


def compute_baseline_metrics(rows: list[dict]) -> dict:
    """rows: dicts with keys incident_uid, pred_priority (p1..p4|None),
    truth ('positive'|'negative'), disposition, org_id, category,
    created_at, labeled_at, policy_version, overridden(bool), eval_confidence.
    Deduplication: ONE row per incident (latest head label) — enforced by the
    loader; this function trusts its input."""
    heads = {r["incident_uid"]: r for r in rows}          # defensive dedup
    rows = list(heads.values())
    labeled = [r for r in rows if r["truth"] in ("positive", "negative")]
    unknown_rows = [r for r in rows if r["truth"] == "unknown"]
    untriaged = [r for r in labeled if r["pred_priority"] is None]
    scored = [r for r in labeled if r["pred_priority"] is not None]

    conf = Counter((r["pred_priority"], r["truth"]) for r in scored)
    overall_p12 = _rates(conf, band_names=POSITIVE_BANDS)
    overall_p1 = _rates(conf, band_names=HIGH_BANDS)

    def slice_counts(key_fn):
        acc = defaultdict(Counter)
        for r in scored:
            acc[key_fn(r)][(r["pred_priority"], r["truth"])] += 1
        return acc

    by_category = {k: _rates(c, band_names=POSITIVE_BANDS)
                   for k, c in slice_counts(lambda r: r["category"] or "other").items()}
    by_tenant = {str(k): _rates(c, band_names=POSITIVE_BANDS)
                 for k, c in slice_counts(lambda r: r["org_id"]).items()}

    # ---- critical false negatives (the safety-relevant miss class) -------
    crit_fn = [
        {"incident_uid": r["incident_uid"], "pred_priority": r["pred_priority"],
                 "disposition": r["disposition"], "category": r["category"],
                 "overridden": r["overridden"]}
        for r in scored
        if r["truth"] == "positive" and r["pred_priority"] not in POSITIVE_BANDS
    ]
    # subset that was severity=critical at intake AND manually overridden:
    # those were human decisions, not rule misses (kept visible, flagged).
    crit_fn_rule_misses = [c for c in crit_fn if not c["overridden"]]

    # ---- priority correctness (secondary) --------------------------------
    pc = Counter()
    agree_n = agree_ok = 0
    for r in rows:
        v = r.get("priority_correctness")
        pc[v] += 1
        if r["pred_priority"] is not None and v in ("correct", "too_high", "too_low"):
            agree_n += 1
            # Directional-consistency heuristic between the two label axes:
            #   negative truth (FP/dup) + "too_high"  -> coherent complaint
            #   positive truth (TP)      + "too_low"  -> coherent complaint
            #   "correct"                              -> coherent by definition
            # Anything else (e.g. TP judged "too_high") is an axis contradiction
            # worth surfacing to analysts, not a silent pass.
            coherent = (v == "correct" or
                        (r["truth"] == "negative" and v == "too_high") or
                        (r["truth"] == "positive" and v == "too_low"))
            agree_ok += int(coherent)
    axis_agreement = {
        "n_comparable": agree_n,
        "coherent": agree_ok,
        "contradictions": agree_n - agree_ok,
        "rate": round(agree_ok / agree_n, 4) if agree_n else None,
        "note": ("directional consistency heuristic between disposition and "
                 "priority-correctness axes; contradictions flag label noise"),
    }

    oldest = min((r["labeled_at"] for r in rows if r["labeled_at"]), default=None)
    newest = max((r["labeled_at"] for r in rows if r["labeled_at"]), default=None)
    span_days = None
    if oldest and newest:
        span_days = round((newest - oldest).total_seconds() / 86400, 2)

    total_incidents_in_window = None  # filled by loader against all incidents
    warnings: list[str] = []
    n_val = len(scored)
    pos_n = overall_p12["tp"] + overall_p12["fn"]
    neg_n = overall_p12["fp"] + overall_p12["tn"]
    if n_val < MIN_RELIABLE_N:
        warnings.append(f"validated set n={n_val} < {MIN_RELIABLE_N}: metrics are "
                        "descriptive only; do NOT use for model/no-model decisions")
    if pos_n and neg_n and min(pos_n, neg_n) < MIN_CLASS_N:
        warnings.append(f"minority class n={min(pos_n, neg_n)} < {MIN_CLASS_N}: "
                        "precision/recall unstable; CIs will be very wide")
    if not scored:
        warnings.append("no validated labels with a frozen priority: baseline "
                        "metrics cannot be computed (insufficient data)")
    if untriaged:
        warnings.append(f"{len(untriaged)} validated incident(s) never triaged "
                        "(no frozen priority) — excluded from P/R, counted here")

    return {
        "task_definition": {
            "positive": "head label disposition=true_positive",
            "negative": "disposition in (false_positive, benign_duplicate)",
            "excluded_unknown": "disposition=unknown",
            "prediction_source": "OutcomeLabel.priority_labeled_at frozen snapshot "
                                 "(at-prediction-time info only; no post-outcome fields)",
            "primary_operating_point": "predicted positive = priority p1/p2",
            "secondary_operating_point": "p1-only",
        },
        "corpus": {
            "label_rows_total": len(rows),
            "validated": len(labeled),
            "unknown_disposition": len(unknown_rows),
            "untriaged_excluded": len(untriaged),
            "unique_tenants": len({r["org_id"] for r in rows}),
            "categories": sorted({r["category"] or "other" for r in rows}),
            "oldest_label": oldest.isoformat() if oldest else None,
            "newest_label": newest.isoformat() if newest else None,
            "time_span_days": span_days,
        },
        "coverage": {
            "validated_share_of_labels": round(len(labeled) / len(rows), 4) if rows else None,
            "unknown_rate": round(len(unknown_rows) / len(rows), 4) if rows else None,
        },
        "confusion_by_priority": {f"{b}|{t}": c for (b, t), c in sorted(
            conf.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1])))},
        "metrics_p1_vs_rest": overall_p12,
        "metrics_p1_only": overall_p1,
        "by_category_p12": by_category,
        "by_tenant_p12": by_tenant,
        "critical_false_negatives": {
            "count": len(crit_fn),
            "rule_miss_count": len(crit_fn_rule_misses),
            "note": "positives assigned p3/p4 (or untriaged). Overridden entries "
                    "were human-deprioritized, not rule failures.",
            "items": crit_fn,
        },
        "priority_correctness": {
            "counts": dict(pc),
            "axis_agreement": axis_agreement,
        },
        "ci_method": "clopper-pearson-exact" if _beta is not None else "none",
        "thresholds": {"min_reliable_n": MIN_RELIABLE_N, "min_class_n": MIN_CLASS_N},
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Read-only loaders
# ---------------------------------------------------------------------------
async def _head_labels(db: AsyncSession, org_id: Optional[int]) -> list[OutcomeLabel]:
    """LIVE head labels: a row is superseded iff another row points at it via
    supersedes_id (corrections and explicit reopen relabels). Plain appends
    from reopened episodes are independent heads and all remain live.

    Cross-incident safety: supersedes_id chains never cross incidents (the
    service layer enforces this), but we filter per-row so a chain stamped on
    one incident can never retire a head belonging to another.
    Never mutate anything."""
    q = select(OutcomeLabel)
    if org_id is not None:
        q = q.where(OutcomeLabel.org_id == org_id)
    rows = list((await db.execute(q.order_by(OutcomeLabel.id))).scalars().all())
    by_uid: dict[str, list[OutcomeLabel]] = defaultdict(list)
    for r in rows:
        by_uid[r.incident_uid].append(r)
    heads: list[OutcomeLabel] = []
    for group in by_uid.values():
        superseded = {r.supersedes_id for r in group if r.supersedes_id}
        heads.extend(r for r in group if r.id not in superseded)
    return sorted(heads, key=lambda r: r.id)


async def _eval_context(db: AsyncSession, uids: list[str]) -> dict[str, dict]:
    ctx: dict[str, dict] = {}
    if not uids:
        return ctx
    evs = list((await db.execute(
        select(TriageEvaluation).where(TriageEvaluation.incident_uid.in_(uids))
        .order_by(TriageEvaluation.id))).scalars().all())
    for e in evs:                                # last write per uid = latest
        bd = e.breakdown or {}
        ctx[e.incident_uid] = {
            "policy_version": e.policy_version,
            "eval_confidence": e.confidence,
            "overridden": bool(bd.get("override")),
            # pure rule band (pre-override): breakdown snapshot keeps the
            # calculated priority even when record_override rewrote .priority
            "rule_priority": bd.get("priority") or e.priority,
        }
    return ctx


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


async def load_eval_rows(db: AsyncSession, *, org_id: Optional[int],
                         since_days: Optional[int] = None) -> tuple[list[dict], dict]:
    heads = await _head_labels(db, org_id)
    inc_ids = {h.incident_uid for h in heads}
    incs = {}
    if inc_ids:
        for i in (await db.execute(select(Incident).where(
                Incident.uid.in_(inc_ids)))).scalars().all():
            incs[i.uid] = i
    ctx = await _eval_context(db, sorted(inc_ids))
    rows = []
    cutoff = None
    if since_days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=since_days)
    for h in heads:
        la = _aware(h.created_at)
        if cutoff and (la is None or la < cutoff):
            continue
        inc = incs.get(h.incident_uid)
        truth = ("positive" if h.disposition == "true_positive" else
                 "negative" if h.disposition in ("false_positive", "benign_duplicate")
                 else "unknown")
        ec = ctx.get(h.incident_uid, {})
        rows.append({
            "incident_uid": h.incident_uid,
            "pred_priority": h.priority_labeled_at,   # frozen at-labeling snapshot
            "rule_priority": ec.get("rule_priority"),  # pure rule band (pre-override)
            "truth": truth,
            "disposition": h.disposition,
            "priority_correctness": h.priority_correctness,
            "label_correct_priority_too": h.priority_correctness,
            "org_id": h.org_id,
            "category": getattr(inc, "category", None),
            "severity_at_intake": getattr(inc, "severity", None),
            "created_at": _aware(getattr(inc, "created_at", None)),
            "labeled_at": la,
            "policy_version": ec.get("policy_version"),
            "eval_confidence": ec.get("eval_confidence"),
            "overridden": ec.get("overridden", False),
        })
    meta = {"head_labels_scanned": len(heads), "rows_after_window": len(rows)}
    return rows, meta


async def baseline_report(db: AsyncSession, *, org_id: Optional[int],
                          window_days: Optional[int] = None) -> dict:
    rows, meta = await load_eval_rows(db, org_id=org_id, since_days=window_days)
    rep = compute_baseline_metrics(rows)
    rep["generated_at"] = datetime.now(timezone.utc).isoformat()
    rep["scope"] = {"org_id": org_id, "window_days": window_days}
    rep["loader_meta"] = meta
    rep["read_only"] = True
    rep["ai_assist_used"] = False   # key chosen to avoid ML/LLM token collision
    return rep
