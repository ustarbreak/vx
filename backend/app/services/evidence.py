"""Event evidence service — Stage 1 (durable per-event raw payload + provenance).

Mission: EVERY accepted ingestion event keeps its original raw payload and
provenance, even when the correlation layer folds it into an existing alert.
This module only STORES and SERVES evidence; it does not change grouping,
incident lifecycle, scoring, or notification semantics (explicit scope rule).

Identity model (kept deliberately separate):
  * event_uid        — our own uuid4 for this accepted ingestion event.
  * source_event_id  — the upstream detector's ID, if it provides one.
  * payload_sha256   — integrity metadata over the serialized payload; byte
    equality does NOT prove event identity, so it is never a dedup key.
  * alerts.dedup_key — unchanged group identity (owned by notifications.correlate).

Size policy (configurable via settings):
  * <= EVIDENCE_MAX_INLINE_BYTES          stored whole, truncated=False
  * between inline cap and hard ceiling   first N bytes kept as excerpt,
                                          truncated=True, full sha256 retained
  * > EVIDENCE_HARD_LIMIT_BYTES           EvidenceTooLarge -> router returns 413

Retention policy (configurable via settings.EVIDENCE_RETENTION_DAYS):
  * expires_at = received_at + retention days (computed at store time).
  * run_retention_expiry() nulls payload columns after expiry; the row remains
    as an intelligible stub (hash, sizes, provenance, timestamps) so alert and
    incident history stays explainable. Rows are NEVER deleted by this stage.
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import EventEvidence
from app.services.ticketing import now_utc

logger = logging.getLogger("infracentra.evidence")


class EvidenceTooLarge(Exception):
    """Payload exceeds the absolute ingest ceiling (HTTP 413 at the router)."""

    def __init__(self, size_bytes: int, limit_bytes: int):
        self.size_bytes = size_bytes
        self.limit_bytes = limit_bytes
        super().__init__(f"event payload {size_bytes}B exceeds hard limit {limit_bytes}B")


def serialize_payload(payload: dict | None) -> tuple[bytes, str]:
    """Deterministic serialization used for hashing and size accounting."""
    body = json.dumps(payload or {}, sort_keys=True, default=str, ensure_ascii=False)
    raw = body.encode("utf-8", errors="replace")
    return raw, hashlib.sha256(raw).hexdigest()


def compute_ingest_key(org_id: int, source_system: str,
                       source_event_id: str | None) -> str | None:
    """Ingestion-IDEMPOTENCY identity — distinct from payload hash (integrity)
    and from dedup fingerprint (alert grouping). Returns None when the upstream
    collector supplied no source event ID: byte-identical payloads WITHOUT a
    source ID are never assumed to be the same event."""
    if not source_event_id:
        return None
    base = f"{org_id}|{source_system}|{source_event_id}"
    return hashlib.sha256(base.encode()).hexdigest()[:64]


async def find_by_ingest_key(db: AsyncSession, ingest_key: str | None) -> EventEvidence | None:
    """Idempotency lookup used by the shared pipeline BEFORE re-processing."""
    if not ingest_key:
        return None
    res = await db.execute(
        select(EventEvidence).where(EventEvidence.ingest_key == ingest_key)
    )
    return res.scalars().first()


async def mark_processed(db: AsyncSession, event_uid: str) -> None:
    await db.execute(
        update(EventEvidence).where(EventEvidence.event_uid == event_uid)
        .values(processing_status="processed", processing_error=None,
                processed_at=now_utc())
    )


async def mark_failed(db: AsyncSession, event_uid: str, error: str) -> None:
    """Permanent-failure marker. The evidence row itself is NEVER removed —
    durable payload/provenance survive processing failure by design."""
    await db.execute(
        update(EventEvidence).where(EventEvidence.event_uid == event_uid)
        .values(processing_status="failed", processing_error=error[:1000])
    )


async def store_event_evidence(
    db: AsyncSession,
    *,
    org_id: int,
    payload: dict | None,
    source_system: str = "api",
    source_event_id: str | None = None,
    provenance: dict | None = None,
    source_occurred_at=None,
    dedup_fingerprint: str | None = None,
    alert_db_id: int | None = None,
    alert_uid: str | None = None,
) -> EventEvidence:
    """Persist durable evidence for ONE accepted event. Raises EvidenceTooLarge
    only when the payload breaches the absolute hard ceiling (caller must NOT
    accept such an event). Never mutates or deletes any pre-existing row."""
    raw, digest = serialize_payload(payload)
    size = len(raw)
    if size > settings.EVIDENCE_HARD_LIMIT_BYTES:
        raise EvidenceTooLarge(size, settings.EVIDENCE_HARD_LIMIT_BYTES)

    truncated = size > settings.EVIDENCE_MAX_INLINE_BYTES
    excerpt = None
    stored_payload = payload if not truncated else None
    if truncated:
        excerpt = raw[: settings.EVIDENCE_MAX_INLINE_BYTES].decode("utf-8", errors="replace")

    # --- ingestion idempotency: one evidence row per (org, source_system,
    # source_event_id). A transport retry of the SAME source event re-enters
    # through this lookup and returns the ORIGINAL row — never a second copy.
    # Events without an upstream ID get their own row per accepted submission
    # (identical payloads are not proof of the same event).
    key = compute_ingest_key(org_id, source_system, source_event_id)
    existing = await find_by_ingest_key(db, key)
    if existing is not None:
        return existing

    received = now_utc()
    ev = EventEvidence(
        event_uid=str(uuid.uuid4()),
        org_id=org_id,
        source_system=source_system,
        source_event_id=(str(source_event_id)[:255] if source_event_id else None),
        ingest_key=key,
        dedup_fingerprint=dedup_fingerprint,
        raw_payload=stored_payload,
        payload_sha256=digest,
        payload_bytes=size,
        truncated=truncated,
        payload_excerpt=excerpt,
        payload_expired=False,
        provenance=dict(provenance or {}),
        source_occurred_at=source_occurred_at,
        received_at=received,
        normalization_version="v1",
        retention_policy_version="v1",
        expires_at=received + timedelta(days=settings.EVIDENCE_RETENTION_DAYS),
        alert_db_id=alert_db_id,
        alert_uid=alert_uid,
    )
    db.add(ev)
    await db.flush()
    return ev


async def attach_group_provenance(db: AsyncSession, event_uid: str, *, fingerprint: str,
                                  surviving_alert_db_id: int, surviving_alert_uid: str) -> None:
    """Record grouping provenance on an already-stored event AFTER correlate().
    This documents WHERE the event was grouped — it does not change grouping."""
    await db.execute(
        update(EventEvidence)
        .where(EventEvidence.event_uid == event_uid)
        .values(dedup_fingerprint=fingerprint,
                alert_db_id=surviving_alert_db_id,
                alert_uid=surviving_alert_uid)
    )


async def list_evidence_for_alert(db: AsyncSession, *, org_id: int, alert_uid: str):
    """Tenant-scoped listing of evidence rows behind one alert GROUP (by uid,
    which survives folding). Ordered newest first."""
    res = await db.execute(
        select(EventEvidence)
        .where(EventEvidence.org_id == org_id, EventEvidence.alert_uid == alert_uid)
        .order_by(EventEvidence.received_at.desc(), EventEvidence.id.desc())
    )
    return res.scalars().all()


async def get_evidence(db: AsyncSession, *, org_id: int, event_uid: str):
    """Fetch one evidence row STRICTLY within the caller's tenant. Cross-tenant
    lookups return None (router maps to 404 — existence is never leaked)."""
    res = await db.execute(
        select(EventEvidence).where(
            EventEvidence.org_id == org_id,
            EventEvidence.event_uid == event_uid,
        )
    )
    return res.scalars().first()


async def run_retention_expiry(db: AsyncSession) -> int:
    """Null out expired payloads (rows survive as stubs). Returns count expired.
    Idempotent: only touches rows not already flagged expired."""
    cutoff = now_utc()
    res = await db.execute(
        update(EventEvidence)
        .where(EventEvidence.expires_at.is_not(None),
               EventEvidence.expires_at < cutoff,
               EventEvidence.payload_expired.is_(False))
        .values(raw_payload=None, payload_excerpt=None, payload_expired=True)
    )
    await db.commit()
    count = res.rowcount or 0
    if count:
        logger.info("evidence retention: expired %s payload(s), stubs retained", count)
    return count
