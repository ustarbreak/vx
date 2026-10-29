"""STAGE 6B — Data-quality audit over outcome labels (READ-ONLY).

Purpose: measure the label corpus that Stage 6A collects so an ML-readiness
review can decide, from *measured* numbers, whether a narrow supervised task
is justified. This module performs SELECTs only:

  * it never writes to any table (verified by regression test),
  * it does not touch scoring (app.services.triage unchanged),
  * tenant isolation mirrors the Stage 5/6A rule in routers/triage.py:
    platform_admin may pass org_id=None for a cross-tenant rollup; every
    other caller is hard-scoped to their own org.

Metrics produced (all measured at query time, nothing estimated):
  completeness      : labeled vs unlabeled closed/resolved incidents
  corrections       : rows with supersedes_id (label churn rate)
  unknown rates     : disposition/priority_correctness 'unknown' share
  class balance     : distribution per vocabulary value
  coverage          : by incident category and by priority_labeled_at band
  time to resolution: created -> resolved/closed (hours) and created ->
                      first-label (hours) percentiles
  data quality      : orphan labels (incident deleted), missing rationale /
                      reviewer-defaulted-to-author counts
  leakage flags     : structural notes surfaced for the reviewer (see
                      _leakage_flags docstring)
"""
from __future__ import annotations

import statistics
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Incident, Organization, OutcomeLabel, TriageEvaluation

CLOSED_STATUSES = ("resolved", "closed")


def _pct(part: int, whole: int) -> Optional[float]:
    return round(100.0 * part / whole, 1) if whole else None


def _dist(rows, key) -> dict:
    out: dict = {}
    for r in rows:
        k = key(r)
        out[k] = out.get(k, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def _hours(delta_seconds: float) -> float:
    return round(delta_seconds / 3600.0, 2)


def _percentiles(values: list[float]) -> dict:
    if not values:
        return {"n": 0, "p50_h": None, "p90_h": None, "max_h": None}
    q = statistics.quantiles(values, n=10) if len(values) >= 10 else []
    p50 = statistics.median(values)
    if q:
        p90 = q[8]
    else:  # small-sample fallback: max (flagged by low_n in caller)
        p90 = max(values)
    return {"n": len(values), "p50_h": _hours(p50),
            "p90_h": _hours(p90), "max_h": _hours(max(values))}


def _leakage_flags() -> list[str]:
    """Structural leakage risks a future trainer must neutralize. These are
    code-inspection findings (qualitative), not measured quantities."""
    return [
        "priority_labeled_at is frozen from the LATEST TriageEvaluation "
        "(routers override mutates ev.breakdown['override'] then updates that "
        "same row's priority, models.TriageEvaluation docstring): the label's "
        "priority snapshot therefore includes analyst overrides applied "
        "BEFORE labeling. Using it as a feature leaks the human decision; "
        "it may only be used as the thing being judged (via "
        "priority_correctness), never as an input.",
        "labels are collected AFTER close/reopen transitions: any incident "
        "feature derived from final status, assignee, ticket outcome or "
        "evidence accumulated during investigation leaks the outcome. A "
        "trainer must join features exclusively to the at-intake "
        "TriageEvaluation.breakdown snapshot (frozen at evaluation time).",
        "dedup/recurrence lineage (Stage 4: recurrence_of_uid, dedup_key): "
        "related episodes of the same underlying event must live on the SAME "
        "side of any train/test split, otherwise near-duplicates leak across "
        "folds.",
        "policy_version drift: TriageEvaluation rows carry versioned policy; "
        "mixing label pairs scored under different versions without stratifying "
        "confounds priority_correctness measurement.",
        "temporal ordering: walk-forward splits must respect created_at AND "
        "label created_at; a label cannot inform predictions made before it "
        "existed.",
    ]


async def label_quality_report(db: AsyncSession, *, org_id: Optional[int] = None,
                               recent_days: int = 30) -> dict:
    """org_id=None => cross-tenant rollup (caller MUST be platform_admin;
    enforced at the router). Otherwise single-tenant scope."""
    # ---- scope incidents ------------------------------------------------
    inc_stmt = select(Incident)
    lbl_stmt = select(OutcomeLabel)
    if org_id is not None:
        inc_stmt = inc_stmt.where(Incident.org_id == org_id)
        lbl_stmt = lbl_stmt.where(OutcomeLabel.org_id == org_id)
    incidents = list((await db.execute(inc_stmt)).scalars().all())
    labels = list((await db.execute(lbl_stmt.order_by(OutcomeLabel.id))).scalars().all())

    inc_by_uid = {i.uid: i for i in incidents}
    closed = [i for i in incidents if i.status in CLOSED_STATUSES]
    active = [i for i in incidents if i.status not in CLOSED_STATUSES]

    # ---- joins / integrity ---------------------------------------------
    known_ids = {l.id for l in labels}
    orphans = [l for l in labels if l.incident_uid not in inc_by_uid]
    dangling_supersede = [l for l in labels
                          if l.supersedes_id is not None and l.supersedes_id not in known_ids]
    corrected_incidents = {l.incident_uid for l in labels if l.supersedes_id is not None}
    per_incident: dict[str, list] = {}
    for l in labels:
        per_incident.setdefault(l.incident_uid, []).append(l)
    multi_label_incidents = {u: rows for u, rows in per_incident.items() if len(rows) > 1}

    labeled_closed = [i for i in closed if i.uid in per_incident]
    unlabeled_closed = [i for i in closed if i.uid not in per_incident]
    labeled_active = [i for i in active if i.uid in per_incident]

    # ---- distributions ---------------------------------------------------
    disp = _dist(labels, lambda l: l.disposition)
    prio = _dist(labels, lambda l: l.priority_correctness)
    cov_cat = _dist([i for i in incidents if i.uid in per_incident],
                    lambda i: i.category or "other")
    all_cat = _dist(incidents, lambda i: i.category or "other")
    cov_prio_band = _dist(labels, lambda l: l.priority_labeled_at or "untriaged")

    unknown_disp = disp.get("unknown", 0)
    unknown_prio = prio.get("unknown", 0)

    # ---- time metrics ----------------------------------------------------
    ttr, ttl = [], []
    for i in closed:
        end = i.closed_at or i.resolved_at
        if i.created_at and end:
            ttr.append((end.replace(tzinfo=None) - i.created_at.replace(tzinfo=None)).total_seconds())
    for uid, rows in per_incident.items():
        inc = inc_by_uid.get(uid)
        first = min(rows, key=lambda r: r.id)
        if inc and inc.created_at and first.created_at:
            ttl.append((first.created_at.replace(tzinfo=None)
                        - inc.created_at.replace(tzinfo=None)).total_seconds())

    # ---- collection hygiene ----------------------------------------------
    no_rationale = sum(1 for l in labels if not (l.rationale or "").strip())
    reviewer_is_author = sum(1 for l in labels if l.reviewer == l.labeled_by)
    untriaged_labels = sum(1 for l in labels if l.priority_labeled_at is None)

    # ---- recent-window activity -------------------------------------------
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=recent_days)
    recent_rows = [l for l in labels if l.created_at and l.created_at.replace(tzinfo=None) >= cutoff]

    tenant_rollup = None
    if org_id is None:
        by_org: dict[int, dict] = {}
        for l in labels:
            o = by_org.setdefault(l.org_id, {"labels": 0, "corrections": 0})
            o["labels"] += 1
            if l.supersedes_id is not None:
                o["corrections"] += 1
        for i in incidents:
            o = by_org.setdefault(i.org_id, {"labels": 0, "corrections": 0})
            o.setdefault("incidents", 0)
            o["incidents"] = o.get("incidents", 0) + 1
            if i.status in CLOSED_STATUSES:
                o["closed"] = o.get("closed", 0) + 1
            if i.uid in per_incident:
                o["labeled_incidents"] = o.get("labeled_incidents", 0) + 1
        names = {o.id: o.name for o in (await db.execute(select(Organization))).scalars().all()}
        tenant_rollup = [
            {"org_id": oid, "org_name": names.get(oid, "?"),
             "incidents": v.get("incidents", 0), "closed": v.get("closed", 0),
             "labeled_incidents": v.get("labeled_incidents", 0),
             "labels": v["labels"], "corrections": v["corrections"]}
            for oid, v in sorted(by_org.items())
        ]

    n_lbl = len(labels)
    return {
        "scope": {"org_id": org_id, "cross_tenant": org_id is None},
        "population": {
            "incidents": len(incidents), "closed_or_resolved": len(closed),
            "active": len(active),
            "labeled_incidents": len(per_incident),
            "labeled_closed_incidents": len(labeled_closed),
            "labels_total": n_lbl,
        },
        "completeness": {
            "closed_incident_label_coverage_pct": _pct(len(labeled_closed), len(closed)),
            "unlabeled_closed_incidents": len(unlabeled_closed),
            "labels_on_still_active_incidents": len(labeled_active),
        },
        "corrections": {
            "superseding_rows": sum(1 for l in labels if l.supersedes_id is not None),
            "correction_rate_pct": _pct(sum(1 for l in labels if l.supersedes_id is not None), n_lbl),
            "incidents_with_corrections": len(corrected_incidents),
            "multi_label_incidents": len(multi_label_incidents),
        },
        "class_balance": {
            "disposition": disp,
            "priority_correctness": prio,
        },
        "unknown_rates": {
            "disposition_unknown_pct": _pct(unknown_disp, n_lbl),
            "priority_unknown_pct": _pct(unknown_prio, n_lbl),
            "combined_any_unknown_pct": _pct(
                len({l.id for l in labels
                     if l.disposition == "unknown" or l.priority_correctness == "unknown"}), n_lbl),
        },
        "coverage": {
            "labeled_by_category": cov_cat,
            "all_incidents_by_category": all_cat,
            "labels_by_priority_band": cov_prio_band,
            "untriaged_labels": untriaged_labels,
        },
        "time_metrics": {
            "time_to_resolution": _percentiles(ttr),
            "time_to_first_label": _percentiles(ttl),
            "small_sample_note": "p90 falls back to max when n<10 samples",
        },
        "integrity": {
            "orphan_labels_no_matching_incident": len(orphans),
            "dangling_supersedes_id": len(dangling_supersede),
        },
        "collection_hygiene": {
            "labels_without_rationale": no_rationale,
            "reviewer_defaulted_to_author": reviewer_is_author,
        },
        f"activity_last_{recent_days}d": {"new_label_rows": len(recent_rows)},
        "leakage_flags_for_future_training": _leakage_flags(),
        "tenant_rollup": tenant_rollup,
    }
