"""Shared ingestion processing pipeline — Stage 2 (single core path for all sources).

Mission (approved product decision #2): every eligible ingestion source —
HTTP/API, agent, and discovery — runs the SAME core processing sequence:

    durable evidence (Tx A, already committed by the caller)
      -> ingestion-idempotency check
      -> canonical alert construction (source adapter supplies fields)
      -> persist candidate row
      -> correlation / grouping          (nv.correlate — UNCHANGED semantics)
      -> grouping provenance on evidence (metadata only)
      -> rule matching + side effects    (nv.process_alert, idempotency-guarded)

Source-specific differences live ONLY in what the caller passes in:
authentication (JWT vs agent token vs internal task), validation, and the
adapter-supplied canonical fields / payload / provenance. No core logic is
duplicated per source anymore — previously agent/discovery inserted alerts
directly, bypassing correlate() entirely (Stage 1 audit finding).

Identity taxonomy (deliberately three separate mechanisms, never conflated):
  * ingest_key        — ingestion IDEMPOTENCY: sha256(org|source_system|
                        source_event_id), present only when the upstream
                        collector provided a source event ID. A transport
                        retry of the same source event re-enters here and
                        returns the stored outcome WITHOUT creating another
                        alert group increment, ticket, or notification.
  * payload_sha256    — integrity metadata only. Byte-identical payloads are
                        NOT proof of the same event; without a source ID each
                        accepted submission is its own event.
  * dedup_fingerprint — alert GROUPING identity owned by notifications.correlate();
                        unchanged by this stage.

Failure & recovery semantics:
  * Evidence is committed BEFORE the pipeline runs (Stage 1 Tx A), so persisted
    evidence survives any processing failure.
  * On pipeline exception the candidate row is rolled back (no orphan alert),
    the evidence row is durably marked status='failed' with the error, and the
    exception propagates to the caller's existing error behavior.
  * Side-effect duplication guard: before re-processing an event that already
    reached 'processed', we return the recorded outcome instead of running
    tickets/notifications again. Existing guards inside process_alert
    (alert.ticket_uid check, storm_suppressed flag) remain untouched.

Out of scope (later stages): locking/concurrency hardening, correlate() org
filter change, incident episodes, triage scoring, ML/LLM, queueing.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Alert, EventEvidence, Ticket
from app.schemas import AlertResponse
from app.services import evidence as ev
from app.services import notifications as nv
from app.services.ticketing import now_utc

logger = logging.getLogger("infracentra.pipeline")


async def process_ingested_event(
    db: AsyncSession,
    *,
    org_id: int,
    evidence_uid: str,
    fields: dict,
    run_side_effects: bool = True,
) -> dict:
    """Run the ONE canonical processing sequence for an already-persisted event.

    Args:
        db: active session (evidence row must already be COMMITTED by caller).
        org_id: tenant — validated by the caller's auth layer, never derived
                from the payload here.
        evidence_uid: the Stage-1 EventEvidence.event_uid for this accepted event.
        fields: adapter-supplied canonical alert fields:
                {title, description, severity, source, resource, raw_payload}.
        run_side_effects: False keeps the legacy fire-and-forget behavior of the
                pre-pipeline paths (alert row + grouping only, no rules/tickets).
                HTTP path passes True (unchanged from before).

    Returns: {"status": "processed"|"duplicate", "alert_uid", "evidence_uid",
              "folded_into_existing", "pipeline": diagnostics|None}
    """
    rec = (await db.execute(
        select(EventEvidence).where(EventEvidence.event_uid == evidence_uid)
    )).scalars().first()
    if rec is None:
        raise RuntimeError(f"pipeline: evidence {evidence_uid} not found (Tx A missing?)")

    # --- ingestion idempotency (distinct from payload hash and grouping) ----
    if rec.processing_status == "processed":
        # Transport-level retry of an ALREADY-PROCESSED source event: return the
        # recorded outcome; zero new groups, counters, tickets, or notifications.
        logger.info("pipeline: duplicate submission suppressed for %s", rec.ingest_key)
        prior_ticket: Optional[str] = None
        if rec.alert_uid:
            survivor = (await db.execute(
                select(Alert).where(Alert.uid == rec.alert_uid))).scalars().first()
            if survivor and survivor.ticket_uid:
                # The alert's ticket link may have been set AFTER our stored
                # snapshot (manual linking, incident flow) — read live state.
                prior_ticket = survivor.ticket_uid
        if prior_ticket is None and rec.alert_db_id:
            # The original alert row was folded away; recover the ticket from
            # the persisted side-effect itself (source='alert', alert_id link).
            tkt = (await db.execute(
                select(Ticket).where(Ticket.alert_id == rec.alert_db_id,
                                     Ticket.source == "alert")
                .order_by(Ticket.id.desc()).limit(1))).scalars().first()
            prior_ticket = tkt.uid if tkt else None
        diag = {"alert_uid": rec.alert_uid, "rules_matched": 0, "notifications": 0,
                "sent": 0, "dead_letter": 0, "storm_suppressed": True,
                "ticket_created": None, "existing_ticket_uid": prior_ticket,
                "idempotent_replay": True}
        return {"status": "duplicate", "alert_uid": rec.alert_uid,
                "evidence_uid": rec.event_uid, "folded_into_existing": True,
                "pipeline": diag}

    # STAGE 3 FIX G8 (per approved design): initialize the compensation id at
    # function top. If the failure happens BEFORE the candidate is committed
    # (e.g. inside allocate_uid under concurrent StaticPool interleaving), the
    # except-block previously raised UnboundLocalError on `candidate_db_id` and
    # masked the original exception.
    candidate_db_id: Optional[int] = None
    rec_pk: Optional[int] = rec.id

    try:
        # --- persist candidate alert row (same contract as legacy HTTP path) --
        # STAGE 3: UID allocated atomically from uid_counters (no COUNT+1 race);
        # window_epoch starts at the CURRENT window so a concurrent insert for
        # the same (org, fp, epoch) hits the partial unique index and folds.
        _pol = await nv.get_grouping_policy(db)
        _now = now_utc()
        alert = Alert(
            uid=await nv.allocate_uid(db, "alerts", "ALR"), org_id=org_id,
            title=fields["title"], description=fields.get("description") or "",
            severity=fields.get("severity", "info"), source=fields.get("source"),
            resource=fields.get("resource"),
            raw_payload=fields.get("raw_payload") or {}, created_at=_now,
            # STAGE 3 FINAL FIX (G4/G8): the candidate is committed UNSTAMPED.
            # correlate() owns group identity and stamps the survivor path; a
            # pre-stamped candidate could itself violate uq_alert_group_active
            # at commit time (two candidates sharing one (org, fp, epoch))
            # before correlation ever gets a chance to fold them.
        )
        db.add(alert)
        await db.commit()
        await db.refresh(alert)
        # The candidate row is committed BEFORE correlate() runs (legacy HTTP
        # contract), so a later transaction rollback cannot undo it. Track the
        # durable id for failure compensation below; never rely on ORM object
        # state after a rollback.
        candidate_db_id: Optional[int] = alert.id
        # Snapshot the evidence record's identity NOW. After a transaction
        # rollback the ORM instance `rec` is expired, and touching any of its
        # attributes in the except-block would trigger a lazy refresh outside
        # greenlet context (MissingGreenlet). Plain values are rollback-safe.
        rec_pk: int = rec.id

        # --- correlation / grouping — UNCHANGED semantics ---------------------
        effective = await nv.correlate(db, alert)
        folded = effective.id != alert.id

        # --- grouping provenance on the evidence row (metadata only) ----------
        await ev.attach_group_provenance(
            db, evidence_uid,
            fingerprint=effective.dedup_key or "",
            surviving_alert_db_id=effective.id,
            surviving_alert_uid=effective.uid)
        if folded:
            # Idempotency bookkeeping for the durable evidence row: correlate()
            # commits its fold in its OWN transaction and deletes this event's
            # candidate alert row, so record the pre-fold alert_db_id here
            # BEFORE any later rollback can expire the ORM state. The replay
            # path uses this to recover ticket/audit links after the candidate
            # row is gone.
            rec.alert_db_id = alert.id
            await db.flush()

        # --- rule matching + side effects (guarded) ----------------------------
        diagnostics = None
        if run_side_effects:
            diagnostics = await nv.process_alert(db, effective)

        await ev.mark_processed(db, evidence_uid)
        await db.commit()

        refreshed = (await db.execute(
            select(Alert).where(Alert.id == alert.id))).scalars().first()
        if refreshed is None:
            # duplicate folded into an existing row — return the survivor
            refreshed = (await db.execute(
                select(Alert).where(Alert.uid == effective.uid))).scalars().first()

        return {
            "status": "processed",
            "alert_uid": refreshed.uid if refreshed else effective.uid,
            "evidence_uid": evidence_uid,
            "folded_into_existing": folded,
            "response": AlertResponse.model_validate(refreshed).model_dump()
                        if refreshed else None,
            "pipeline": diagnostics,
        }
    except Exception as exc:
        # Evidence stays durable; mark the attempt failed for later recovery.
        try:
            await db.rollback()
            # COMPENSATION: the candidate alert row was committed BEFORE
            # correlate() ran (same contract as the legacy HTTP path), so a
            # transaction rollback cannot undo it. If this event's own
            # candidate row still exists after the failure, remove it so a
            # crashed pipeline never leaves an orphan alert. A folded
            # survivor row (alert already deleted by correlate) is untouched.
            if candidate_db_id is not None:
                leftover = (await db.execute(
                    select(Alert).where(Alert.id == candidate_db_id))).scalars().first()
                if leftover is not None:
                    await db.delete(leftover)
            # Re-load the evidence row by PRIMARY KEY via a fresh SELECT — the
            # `rec` ORM instance is expired after rollback and must not be
            # touched. mark_failed() then uses a Core UPDATE (no lazy IO).
            ev_row = (await db.execute(
                select(EventEvidence).where(EventEvidence.id == rec_pk)
            )).scalars().first()
            if ev_row is not None:
                await ev.mark_failed(db, ev_row.event_uid,
                                     f"{type(exc).__name__}: {exc}")
            await db.commit()
        except Exception:  # marker best-effort; original error must propagate
            logger.exception("pipeline: failed to record failure marker")
        logger.error("pipeline: processing failed for %s: %s", evidence_uid, exc)
        raise
