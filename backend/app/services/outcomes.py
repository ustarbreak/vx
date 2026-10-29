"""STAGE 6A — Structured outcome labeling (data collection only).

Purpose: collect analyst ground-truth labels on closed incidents so a future
ML-readiness review can measure rules-baseline precision/recall. This module
is PURE DATA COLLECTION:

  * it NEVER reads from or writes to the scoring path (app.services.triage is
    untouched; production scoring behavior is unchanged),
  * labels are append-only and immutable — corrections insert a NEW row with
    `supersedes_id` set; prior rows (and prior triage snapshots /
    TriageEvaluation history) are never edited or deleted,
  * every label/correction is mirrored into the platform AuditLog.

Label vocabulary (validated here, enforced again by Pydantic at the router):
  disposition          : true_positive | false_positive | benign_duplicate | unknown
  priority_correctness : correct | too_high | too_low | unknown

Effective-priority snapshot: when an incident has been triaged, the label
freezes the CURRENT effective priority (latest TriageEvaluation.priority,
which already reflects any analyst override per Stage 5 semantics) into
`priority_labeled_at`. No evaluation -> None. This gives future evaluators a
timestamped pairing of (label, priority judged) without touching history.

Reopened incidents: labels describe the episode as understood at close time
and remain valid historical facts. Reopening (status back to investigating)
does not delete/invalidate them; if the reopened episode resolves differently,
analysts either add a new label row (append) or file a correction via
supersedes_id. The dedup/episode lineage in Incident (Stage 4) keeps episodes
themselves distinct rows, so cross-episode contamination is visible.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Incident, OutcomeLabel, TriageEvaluation

DISPOSITIONS = ("true_positive", "false_positive", "benign_duplicate", "unknown")
PRIORITY_CORRECTNESS = ("correct", "too_high", "too_low", "unknown")


def validate_label(disposition: str, priority_correctness: str) -> None:
    """Raise ValueError on unknown vocabulary (router maps to HTTP 422)."""
    if disposition not in DISPOSITIONS:
        raise ValueError(f"Unknown disposition '{disposition}'; "
                         f"expected one of {DISPOSITIONS}")
    if priority_correctness not in PRIORITY_CORRECTNESS:
        raise ValueError(f"Unknown priority_correctness '{priority_correctness}'; "
                         f"expected one of {PRIORITY_CORRECTNESS}")


async def effective_priority(db: AsyncSession, incident_uid: str) -> Optional[str]:
    """Priority the analyst was seeing at close time: latest evaluation row's
    priority (Stage 5 overrides mutate that row's reported priority while
    keeping the rule score frozen), or None if never evaluated."""
    ev = (await db.execute(
        select(TriageEvaluation).where(TriageEvaluation.incident_uid == incident_uid)
        .order_by(TriageEvaluation.id.desc()).limit(1))).scalars().first()
    return ev.priority if ev else None


async def current_head_label_id(db: AsyncSession, org_id: int,
                                incident_uid: str) -> Optional[int]:
    """ID of the incident's CURRENT live label row (its head), or None.

    Head semantics (STAGE 6C fix — append-only, corrections chain off the
    LIVE label; reopen appends a new head):
      * a plain-append label becomes the new head for that incident,
        superseding the previous head implicitly (history is preserved);
      * a correction (supersedes_id set) replaces exactly the row it points
        at and does NOT disturb other heads;
      * a row is a head iff no other row supersedes it.
    Used by append_outcome_label to stamp supersedes_id on reopen appends so
    evaluators can dedup to one label per incident without losing history.

    NOTE: the superseded-id set must be computed over the incident's OWN rows
    only — never across all incidents — otherwise a reopen-relabel stamped on
    this incident could retire another incident's head.
    """
    rows = list((await db.execute(
        select(OutcomeLabel.id, OutcomeLabel.supersedes_id)
        .where(OutcomeLabel.org_id == org_id,
               OutcomeLabel.incident_uid == incident_uid)
        .order_by(OutcomeLabel.id))).all())
    ids = {i for (i, _) in rows}
    superseded = {s for (_, s) in rows if s is not None and s in ids}
    heads = [i for (i, _) in rows if i not in superseded]
    return max(heads) if heads else None


async def append_outcome_label(
    db: AsyncSession, inc: Incident, *, disposition: str,
    priority_correctness: str, labeled_by: str,
    rationale: Optional[str] = None, reviewer: Optional[str] = None,
    supersedes_id: Optional[int] = None,
    relabel_previous: bool = False,
) -> OutcomeLabel:
    """Append one immutable label row. Corrections pass supersedes_id = id of
    the row being corrected; that row must exist, belong to the SAME incident
    AND the same tenant org (cross-tenant supersede attempts are rejected),
    and must itself be a current head (a row already superseded cannot be
    superseded again — corrections always chain off the live label)."""
    validate_label(disposition, priority_correctness)
    if supersedes_id is not None:
        prev = (await db.execute(select(OutcomeLabel).where(
            OutcomeLabel.id == supersedes_id))).scalars().first()
        if prev is None:
            raise LookupError(f"Label {supersedes_id} not found")
        if prev.incident_uid != inc.uid or prev.org_id != inc.org_id:
            # tenant isolation + record identity: never let a correction point
            # at another incident's or another tenant's label
            raise PermissionError("supersedes_id does not belong to this incident/tenant")
        already = (await db.execute(select(OutcomeLabel).where(
            OutcomeLabel.supersedes_id == prev.id))).scalars().first()
        if already is not None:
            raise ValueError(f"Label {prev.id} was already corrected by label "
                             f"{already.id}; corrections must chain off the "
                             f"current label, not overwrite history")
    # STAGE 6C/6D head semantics — two distinct operations, never conflated:
    #  * CORRECTION (explicit supersedes_id): replaces the row it points at.
    #    The corrected row leaves the live-head set; history stays intact.
    #  * REOPEN RELABEL (relabel_previous=True, no supersedes_id): stamps the
    #    previous head so evaluators dedup to ONE live label per incident —
    #    used when an analyst re-labels after a reopen and the new judgment
    #    stands alone.
    #  * PLAIN APPEND (default): an ADDITIONAL independent observation from a
    #    reopened episode. It does NOT replace the previous head; both rows
    #    remain live heads for their respective episodes (Stage 4 recurrence
    #    lineage keeps episodes distinct). This is what the original Stage 6A
    #    append-only contract describes ("supersedes_id is None").
    head_id = supersedes_id
    if head_id is None and relabel_previous:
        head_id = await current_head_label_id(db, inc.org_id, inc.uid)
    row = OutcomeLabel(
        org_id=inc.org_id,
        incident_uid=inc.uid,
        disposition=disposition,
        priority_correctness=priority_correctness,
        priority_labeled_at=await effective_priority(db, inc.uid),
        rationale=rationale,
        reviewer=(reviewer or "").strip() or labeled_by,
        labeled_by=labeled_by,
        supersedes_id=head_id,
    )
    db.add(row)
    await db.flush()          # same StaticPool-safe pattern as routers/_audit
    return row


async def latest_labels(db: AsyncSession, incident_uid: str) -> list[OutcomeLabel]:
    """All label rows for one incident, newest first (full immutable history)."""
    return list((await db.execute(
        select(OutcomeLabel).where(OutcomeLabel.incident_uid == incident_uid)
        .order_by(OutcomeLabel.id.desc()))).scalars().all())


def label_out(row: OutcomeLabel) -> dict:
    return {
        "id": row.id, "incident_uid": row.incident_uid,
        "disposition": row.disposition,
        "priority_correctness": row.priority_correctness,
        "priority_labeled_at": row.priority_labeled_at,
        "rationale": row.rationale, "reviewer": row.reviewer,
        "labeled_by": row.labeled_by, "supersedes_id": row.supersedes_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
