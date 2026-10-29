"""Notification & Event Intelligence Engine.

Real pipeline: every inbound Alert is processed through
  1. correlation / dedup + notification-storm protection
  2. rule matching (visual rule builder conditions)
  3. quiet-hours deferral
  4. multi-channel dispatch with delivery diagnostics, retries and a
     dead-letter queue (in-DB; swap `deliver()` transports for SMTP/Twilio/HTTP).
  5. automatic ticket creation when a matched rule has create_ticket=True
     -> links alert <-> ticket (the incident->ticket automation the UI shows).

`deliver()` simulates transport by default; set DELIVERY_MODE=real in env to
raise NotImplementedError on email/sms/webhook so you wire real providers
consciously instead of silently sending test spam.
"""
import os
import hashlib
import random
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, or_
from sqlalchemy.exc import IntegrityError

from app.models import (
    Alert, AlertNote, AlertEvent, NotificationRule, Notification, Ticket,
    Organization, GroupingPolicy,
)
from app.services.ticketing import create_ticket, now_utc

DELIVERY_MODE = os.getenv("DELIVERY_MODE", "simulated")

SEVERITY_RANK = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}


async def next_uid(db: AsyncSession, model, prefix: str) -> str:
    """Allocate the next human-readable UID for `model`.

    STAGE 3 NOTE (concurrency): this is a COUNT+1 allocation and therefore
    racy under true parallel writers — two workers can compute the same
    number. It is retained ONLY for legacy compatibility paths; the shared
    pipeline now uses allocate_uid() below, which claims numbers atomically
    from a per-(table,prefix) counter row. A DB-level UNIQUE index on `uid`
    (added in models this stage) turns any residual race into a hard failure
    instead of silent duplicate identifiers.
    """
    count = len((await db.execute(select(model.id))).scalars().all())
    return f"{prefix}-{count + 1:06d}"


async def allocate_uid(db: AsyncSession, table: str, prefix: str,
                       start_from: int = 0) -> str:
    """Concurrency-safe UID allocation via atomic UPSERT + RETURNING.

    Uses PostgreSQL-compatible `INSERT ... ON CONFLICT DO UPDATE ...
    RETURNING` (also supported by SQLite >= 3.24, which the test suite runs).
    The caller's transaction owns the claim: if the surrounding transaction
    later rolls back, the counter may skip a number (gaps are acceptable;
    duplicates are impossible). NEVER call commit() inside this function.
    """
    row = (await db.execute(
        text(
            "INSERT INTO uid_counters (table_name, prefix, last_value) "
            "VALUES (:t, :p, :init) "
            "ON CONFLICT (table_name, prefix) "
            "DO UPDATE SET last_value = uid_counters.last_value + 1 "
            "RETURNING last_value"
        ),
        {"t": table, "p": prefix, "init": start_from + 1},
    )).scalar_one()
    return f"{prefix}-{row:06d}"


def merge_geo_payload(body) -> dict:
    """Persist optional geolocation from AlertIn into the alert raw_payload.

    The worldwide attack map (GET /api/security/attack-map) reads src_geo /
    dst_geo / classification straight out of raw_payload — no schema change is
    needed and events without geo stay exactly as before. Coordinates are only
    stored when the collector actually provided them; we never invent a fix.
    """
    payload = dict(body.raw_payload or {})
    for field in ("src_geo", "dst_geo"):
        gp = getattr(body, field, None)
        if gp is not None:
            d = gp.model_dump(exclude_none=True) if hasattr(gp, "model_dump") else dict(gp)
            if d:
                payload[field] = d
    cls = getattr(body, "classification", None)
    if cls:
        payload["classification"] = cls
    return payload


# --------------------------------------------------------------------------
# Correlation & storm protection
# --------------------------------------------------------------------------
# STAGE 3 — grouping policy (versioned, documented, DB-auditable).
# v1 fingerprint recipe: sha1[:16] over "org|source|resource|lower(title)".
# NOTE (honesty): title remains part of the key. Titles alone are NOT proof
# of event equivalence — that is why identity layers are separated:
#   * ingestion idempotency  -> EventEvidence.ingest_key (source event ID)
#   * payload integrity      -> payload_sha256 (never identity)
#   * alert grouping         -> dedup_fingerprint (this function)
# Changing the recipe REQUIRES a new policy_version row + migration note;
# never mutate v1 semantics in place.
POLICY_VERSION = "v1"
DEFAULT_WINDOW_MINUTES = 60       # configurable via grouping_policies row
DEFAULT_STORM_THRESHOLD = 5       # suppress re-notification above this count

_policy_cache: dict = {}


async def get_grouping_policy(db: AsyncSession) -> dict:
    """Load the active grouping policy (cached per process). Falls back to
    code defaults if the table is empty (pre-seed / legacy DBs)."""
    if POLICY_VERSION in _policy_cache:
        return _policy_cache[POLICY_VERSION]
    try:
        row = (await db.execute(
            select(GroupingPolicy).where(
                GroupingPolicy.policy_version == POLICY_VERSION)
        )).scalars().first()
    except Exception:      # table not yet created (legacy DB) — safe fallback
        row = None
    pol = {
        "window_minutes": row.window_minutes if row else DEFAULT_WINDOW_MINUTES,
        "storm_threshold": row.storm_threshold if row else DEFAULT_STORM_THRESHOLD,
    }
    _policy_cache[POLICY_VERSION] = pol
    return pol


def clear_policy_cache() -> None:
    _policy_cache.clear()


def dedup_fingerprint(alert: Alert) -> str:
    base = f"{alert.org_id}|{alert.source}|{alert.resource or ''}|{alert.title.lower().strip()}"
    return hashlib.sha1(base.encode()).hexdigest()[:16]


def window_epoch(now_dt: datetime, window_minutes: int) -> int:
    """Deterministic window bucket index. Two events in the same grouping
    window share an epoch; crossing the boundary starts a NEW group instead
    of folding forever."""
    return int(now_dt.timestamp()) // (window_minutes * 60)


async def correlate(db: AsyncSession, alert: Alert) -> Alert:
    """If an identical alert occurred within the configured grouping window,
    fold into it.

    Honesty rule (Phase 5, preserved): a duplicate NEVER becomes a second
    alert record — we update the existing row in place (correlated_count,
    lifecycle status) and discard the incoming row. Re-folding also reopens
    an acked/resolved alert because new evidence arrived for the same
    fingerprint. Since Stage 1 the folded row's raw payload + provenance
    survive durably in event_evidence, so deletion loses no evidence.

    STAGE 3 concurrency design (PostgreSQL-compatible):
      * tenant-scoped match: org_id is an EXPLICIT query predicate (fixes
        audit finding R-1 — hash equality alone never proved tenancy);
      * SELECT ... .with_for_update() serializes concurrent folds on the
        matching group row (counter updates cannot be lost);
      * window_epoch makes "one active group per (org, fp, epoch)" checkable,
        backed by the partial UNIQUE index uq_alert_group_active;
      * IntegrityError on insert races is caught, the transaction is rolled
        back, and the now-committed winner group is re-read and folded into.
    SQLite (tests) ignores FOR UPDATE but still honors the unique index;
    real parallel-writer behavior must be re-verified on PostgreSQL before
    production rollout (open risk).

    STAGE 3 FIX G4-boundary (verified by executed failure): membership is a
    rolling ACTIVITY window anchored at "now" — NOT the calendar-aligned epoch
    bucket. The test pins exactly this: a group whose last activity aged past
    the window must start a NEW group even when the candidate's own creation
    lands in the same calendar bucket as the stale row. The previous code
    seeded its stamp from cur_epoch, which folded post-window duplicates back
    onto the stale group ("ALR-000001 != ALR-000001"). base_epoch below is the
    documented anchor; retained_epochs + 1 keeps the stamp distinct from every
    live same-key row so uq_alert_group_active can never see two active groups
    for one (org, key, epoch) — including concurrent candidates racing to
    start new groups after the same window expiry.

    STAGE 3 FIX G4-boundary #2 (verified by executed trace): fold membership
    must ALSO require the survivor to carry the fingerprint (dedup_key IS NOT
    NULL). An unstamped row cannot be a group member yet — correlate() owns
    group identity and stamps rows only when they become survivors. Without
    this guard, on single-connection engines (SQLite StaticPool) the pipeline's
    freshly committed UNSTAMPED candidate matched its own activity window and
    every later duplicate folded into it before promotion ever stamped it —
    i.e. "post-window duplicate folds onto ALR-000001". On PostgreSQL the
    predicate is equivalent: uncommitted candidates are invisible under READ
    COMMITTED, so this only removes rows that could never legitimately fold.
    """
    fp = dedup_fingerprint(alert)
    # STAGE 3 FIX G8 (savepoint ownership): open a SAVEPOINT for the entire
    # correlation critical section BEFORE any FOR UPDATE reads. _fold_into()
    # and the promotion paths flush into this savepoint instead of issuing
    # mid-correlation commit()s — a COMMIT on the shared StaticPool test
    # connection resets the cursor out from under concurrently interleaved
    # coroutines ("RuntimeError: pipeline: evidence ... not found (Tx A
    # missing?)" under asyncio.gather). The savepoint is RELEASED (committed
    # into the outer transaction) at every success return below and rolled
    # back at every IntegrityError recovery path, preserving the old
    # rollback-then-re-read semantics without ever ending the outer tx. The
    # OUTER commit stays with the callers (pipeline / HTTP router), exactly as
    # the design prescribes: correlate() never commits.
    _sp = await db.begin_nested()
    pol = await get_grouping_policy(db)
    window_min = pol["window_minutes"]
    # STAGE 3 BUGFIX (G4): the match query below used `created_at >= since`,
    # which compares the group's CREATION time against a rolling "now". A
    # long-lived group whose last activity is recent but whose created_at has
    # aged past the window would silently start a NEW group under the same
    # epoch — colliding with uq_alert_group_active at insert time. The
    # documented semantics are "last activity defines membership": fold iff
    # max(created_at, last_seen_at) + window > now. last_seen_at is bumped on
    # every fold below, so folds keep a group alive exactly one window after
    # its most recent event.
    since = now_utc() - timedelta(minutes=window_min)

    def _naive(dt):
        # SQLite's DATETIME column cannot carry tzinfo: bound parameters with
        # an aware datetime are REJECTED at execute time ("Error binding
        # parameter: can't convert timezone-aware datetime to integer",
        # verified by executed G4/G8 failures). Normalize every comparison
        # bound and every written timestamp to naive UTC before touching the
        # ORM. PostgreSQL receives naive-UTC timestamps exactly as the rest of
        # this codebase already sends them (created_at etc.), so behavior is
        # unchanged there.
        if dt is None:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt

    def _aware(dt):
        # Round-tripped columns come back naive on SQLite; normalize to aware
        # UTC for Python-side comparisons against aware bounds.
        if dt is not None and dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    since_db = _naive(since)          # safe bind value for all queries below
    now_db = _naive(now_utc())        # safe bind value for all writes below

    def _epoch_of(a: Alert) -> int:
        return a.window_epoch if a.window_epoch else window_epoch(_aware(a.created_at) or now_utc(), window_min)

    # STAGE 3 (G4 fix): fold membership is determined by EPOCH, not a rolling
    # window on created_at. The candidate's own epoch is authoritative; the
    # match query below only needs to find same-key/same-epoch survivors.
    # STAGE 3 FINAL FIX (G4/G8, diagnosed from instrumented trace): the
    # pipeline commits the candidate row with dedup_key=NULL and
    # window_epoch=NULL (see services/pipeline.py). Every lookup below must
    # therefore EXCLUDE the candidate itself (`Alert.id != alert.id`); without
    # this guard the stale-group query could match a same-epoch live row that
    # is our own uncommitted-in-this-tx candidate on single-connection test
    # engines, short-circuiting retirement and leaving two rows sharing one
    # (org, key, epoch) identity.
    self_excl = Alert.id != alert.id

    async def _fold_into(existing: Alert, savepoint=None) -> Optional[Alert]:
        """Critical-section fold body. MUST be called while holding the row's
        FOR UPDATE lock (or immediately after re-reading the committed winner
        of an insert race). Counter increments are in-place ORM mutations on a
        locked row — never read-modify-write from Python state.

        STAGE 3 FIX G8 (savepoint conversion): the mid-correlation commit()
        used to RESET the shared StaticPool cursor whenever another coroutine
        had interleaved statements onto the same connection between our SELECT
        and COMMIT ("RuntimeError: pipeline: evidence ... not found (Tx A
        missing?)" under asyncio.gather). The fold now runs inside a SAVEPOINT
        (`begin_nested()` taken by correlate() BEFORE the FOR UPDATE reads):
          * no commit() happens inside this function — the outer transaction
            owns durability; the caller commits AFTER correlate() returns;
          * if the savepoint is later rolled back (IntegrityError paths), the
            fold's counter increment is undone exactly like the old rollback
            would have undone it — semantics preserved;
          * the pre-fold anchor snapshot below keeps staleness judgment stable
            against the aging UPDATE (G4-boundary #4).

        `savepoint` is the enclosing nested transaction (None only for legacy
        direct calls; we then open one ourselves so NO commit ever escapes).

        Returns None when `existing` IS the incoming candidate itself (the
        IntegrityError recovery path can re-read its own uncommitted winner on
        single-connection test engines like SQLite StaticPool) — the caller
 then treats the event as a fresh group."""
        # STAGE 3 FIX G8 (race-safe self-detection): capture the candidate's
        # primary key into a plain Python int BEFORE touching any other ORM
        # state. Under asyncio.gather on a shared StaticPool connection a
        # concurrent correlate() can fold away THIS coroutine's candidate row
        # (`await db.delete(cand)` expires that object) while our FOR UPDATE
        # cursor is still open; reading `alert.id` afterwards triggers a lazy
        # refresh inside the active result cursor ("Server content queued, but
        # no way to read pending rows" / "Connection closed"), corrupting the
        # shared connection for every other coroutine. A snapshot comparison
        # never issues IO and stays correct after expiration.
        _alert_pk: Optional[int] = alert.id
        if existing.id == _alert_pk:
            return None
        # STAGE 3 FIX G4-boundary #4 (per approved design): snapshot the
        # survivor's PRE-FOLD anchor BEFORE any aging UPDATE touches
        # last_seen_at. Staleness of a fold target must be judged on the value
        # captured at selection time — min(last_seen_at, now) pre-fold — so a
        # row that aged past `since` cannot remain a fold target merely
        # because promotion/fold bookkeeping later wrote last_seen_at. The
        # in-window SELECT predicate already excludes such rows; this snapshot
        # makes the Python-side re-checks immune to intra-transaction aging.
        _prefold_anchor = _aware(existing.last_seen_at) or _aware(existing.created_at)
        if _prefold_anchor is not None and _prefold_anchor > now_utc():
            _prefold_anchor = now_utc()   # min(last_seen_at, now), per design
        # STAGE 3: un-stamp the doomed candidate BEFORE deleting it. It dies
        # inside this transaction and never needs its group identity; leaving
        # any (org, dedup_key, window_epoch) stamp on it risks a transient
        # collision with the survivor inside uq_alert_group_active at flush
        # time (SQLite validates UPDATE/DELETE ordering statement-by-
        # statement). Clearing first makes every fold flush order-safe.
        alert.dedup_key = None
        alert.window_epoch = None
        # STAGE 3 FIX G4-boundary #2 (verified by executed trace): stamp the
        # SURVIVOR with the candidate's own activity-window bucket on every
        # fold. The survivor's membership is now defined by the rolling window
        # (anchor >= since), NOT by a frozen creation-time bucket; without this
        # re-stamp a long-lived group keeps its original epoch and any NEW
        # group started after a window expiry can collide with it inside
        # uq_alert_group_active (two live rows, one (org, key, epoch)). The
        # candidate's bucket is current by construction (created_at = now), so
        # concurrent folds converge on the same value and the retired-row +
        # new-group sweep in _promote_below_window stays collision-free.
        _cand_created = _aware(alert.created_at) or now_utc()
        alert.window_epoch = existing.window_epoch = window_epoch(_cand_created, window_min)
        existing.correlated_count += 1
        existing.last_seen_at = now_db
        was_closed = existing.status in ("acked", "resolved")
        if was_closed:
            existing.status = "active"
            existing.resolved_at = None
            existing.resolved_by = None
        alert.correlated_count = existing.correlated_count
        # storm protection: suppress re-notification above threshold/window
        alert.storm_suppressed = existing.correlated_count > pol["storm_threshold"]
        # STAGE 3 (G6 FIX): mirror the suppression decision onto the SURVIVOR.
        # process_alert() reads alert.storm_suppressed from the effective
        # (survivor) row it is handed; without this the flag lived only on the
        # doomed candidate and was deleted with it, so every folded duplicate
        # re-notified — exactly the storm the threshold exists to stop. The
        # survivor's own notification history was created while its count was
        # under threshold, so setting the flag here never retroactively
        # suppresses already-delivered notifications.
        existing.storm_suppressed = alert.storm_suppressed
        # Propagate the incoming event's severity onto the SURVIVING group when
        # it is HIGHER than the group's current severity (severity escalation).
        # Lower/equal severities never downgrade the group. The folded row's
        # own raw payload + provenance remain durable in event_evidence (Stage 1),
        # so nothing is lost by updating the survivor here.
        if SEVERITY_RANK.get(alert.severity, -1) > SEVERITY_RANK.get(existing.severity, -1):
            existing.severity = alert.severity
            db.add(AlertEvent(
                org_id=existing.org_id, alert_id=existing.id, actor="system",
                action="escalated",
                detail=f"Severity raised to {alert.severity} by duplicate event"))
        db.add(AlertEvent(
            org_id=existing.org_id, alert_id=existing.id, actor="system",
            action="reopened" if was_closed else "correlated",
            detail=f"Duplicate folded (correlated_count={existing.correlated_count})"))
        # drop the duplicate row entirely — one record per fingerprint. The
        # candidate was already un-stamped above (STAGE 3), so the partial
        # unique index never sees two live rows for one group identity.
        await db.delete(alert)
        # STAGE 3 FIX G8 (Option A): replace the mid-correlation commit() with
        # SAVEPOINT semantics. The old commit reset the shared StaticPool
        # cursor whenever a concurrent coroutine had interleaved statements on
        # the same connection between our FOR UPDATE SELECT and the COMMIT —
        # "RuntimeError: pipeline: evidence ... not found (Tx A missing?)"
        # under asyncio.gather. Inside begin_nested(), flush() releases the
        # pending statements to the savepoint WITHOUT ending the outer
        # transaction or resetting the shared cursor; correlate() commits once,
        # after all fold/promotion work is done. If the savepoint later rolls
        # back (IntegrityError paths), the fold increment is undone exactly as
        # the old rollback would have undone it — semantics preserved.
        if savepoint is None:
            async with db.begin_nested():
                await db.flush()
        else:
            await db.flush()
        return existing  # route the *original* alert context

    # STAGE 3 (G4 fix): fold membership follows the DOCUMENTED one-window
    # semantics: "a duplicate folds iff the surviving group's last activity
    # (last_seen_at, falling back to created_at) is within window_minutes of
    # now". Membership is NOT the calendar-aligned epoch bucket: two events
    # seconds apart on either side of an arbitrary bucket boundary are still
    # duplicates within one hour and must fold (otherwise a steady stream
    # fragments into up to two groups per window — false splits). A folding
    # candidate therefore RETIRES the stale group by adopting its identity
    # (see _promote_below_window below); uq_alert_group_active then always
    # sees exactly one live row per (org, key, epoch) because every other
    # same-key row is already outside its own activity window. Legacy rows
    # with NULL/0 epoch fold by activity window and inherit the stamped key.
    cur_epoch = window_epoch(alert.created_at or now_utc(), window_min)
    # STAGE 3 (G4 FIX, verified by executed failure): fold membership is the
    # documented ACTIVITY WINDOW. The epoch-bucket query variant was removed
    # after an executed failure: a candidate created just after a calendar
    # bucket boundary looked for same-EPOCH groups only and folded a group
    # whose last activity had aged past the window ("ALR-000001 != ALR-000001"
    # assertion), violating the documented "one hour of activity" semantics.
    # Membership = coalesce(last_seen_at, created_at) >= since, bounded by a
    # wide index-friendly created_at floor; the precise re-check below pins it.
    _dbg = os.environ.get("G4_DEBUG")
    result = await db.execute(
        select(Alert).where(
            Alert.dedup_key == fp,
            # STAGE 3 FIX G4-boundary #2: only STAMPED rows are group members.
            # (== fp already implies NOT NULL in SQL; stated explicitly so the
            # invariant survives future refactors of the key column.)
            Alert.dedup_key.isnot(None),
            Alert.org_id == alert.org_id,          # explicit tenant scope
            self_excl,                              # STAGE 3: never match our own candidate
            # STAGE 3 FIX G4-boundary #5 (verified by executed debug harness):
            # membership is the DOCUMENTED activity anchor
            # coalesce(last_seen_at, created_at) >= since. The previous
            # `last_seen_at IS NULL OR last_seen_at >= since` variant wrongly
            # matched rows whose created_at had aged past `since` while
            # last_seen_at was still NULL — a stale group folded post-window
            # duplicates forever instead of starting a new group. Rows with
            # NULL last_seen_at are now judged on created_at, exactly like the
            # Python-side re-check below and _promote_below_window's retirement
            # predicate.
            func.coalesce(Alert.last_seen_at, Alert.created_at) >= since_db,
            Alert.created_at >= since_db - timedelta(days=365),  # index-friendly bound
        ).order_by(Alert.created_at.desc()).limit(1).with_for_update()
    )
    in_window = result.scalars().first()
    if _dbg:
        print(f"[correlate] cand_id={alert.id} since_db={since_db} in_window={in_window.uid if in_window else None}"
              f" anchor={_aware(in_window.last_seen_at) or _aware(in_window.created_at) if in_window else '-'}", flush=True)

    # STAGE 3 (G4 FIX, verified by executed failure): the stamping path must
    # NEVER collide with uq_alert_group_active. A live same-(org,key,epoch) row
    # that is OUTSIDE its activity window must be retired BEFORE the candidate
    # claims the slot; a live same-key row INSIDE the window would have been
    # folded above, so any survivor of both lookups is stale-by-anchor. The
    # previous code let the candidate stamp (fp, cur_epoch) while such a stale
    # row was still alive — the UPDATE violated the partial unique index
    # ("UNIQUE constraint failed ... [SQL: UPDATE alerts SET dedup_key=?]").
    # Retirement is ordered strictly before the stamp so no intermediate state
    # ever holds two live rows for one (org, key, epoch).
    stale = None
    if in_window is None:
        stale_result = await db.execute(
            select(Alert).where(
                Alert.dedup_key == fp,
                Alert.org_id == alert.org_id,      # explicit tenant scope
                self_excl,                          # STAGE 3: never match our own candidate
                Alert.status != "resolved",
                Alert.created_at >= since_db - timedelta(days=365),
            ).order_by(func.coalesce(Alert.last_seen_at, Alert.created_at).desc())
            .limit(1).with_for_update()
        )
        cand = stale_result.scalars().first()
        if _dbg:
            print(f"[correlate] stale-lookup cand={cand.uid if cand else None} id={cand.id if cand else '-'}", flush=True)
        if cand is not None and cand.id != alert.id:
            anchor = _aware(cand.last_seen_at) or _aware(cand.created_at)
            # STAGE 3 FIX G4-boundary #5b: judge staleness on
            # min(anchor, now) captured BEFORE any aging UPDATE lands.
            if anchor is not None and anchor > now_utc():
                anchor = now_utc()
            if anchor is None or anchor < since:
                stale = cand

    async def _promote_below_window(target: Alert) -> None:
        """Retire every out-of-window same-key group and promote THIS candidate
        into the fingerprint slot. Only called when no in-window group exists,
        so the promoted row legitimately starts a fresh grouping window.

        STAGE 3 (G4 FIX, verified by executed failure): retirement must cover
        EVERY live same-(org, key) row — including rows whose epoch equals the
        current bucket — because uq_alert_group_active would otherwise reject
        the candidate's stamp, and because distinct groups must never share one
        (org, key, epoch). The previous flow consulted only the single `stale`
        lookup; when that returned nothing but a same-epoch live row existed,
        the candidate was stamped at cur_epoch anyway and collided (deferred
        SQLite index evaluation surfaced this as "UNIQUE constraint failed" or,
        after rollback-retry, as two rows sharing one epoch)."""
        nonlocal stale
        to_retire: list[Alert] = []
        if stale is not None and stale.id != target.id:
            to_retire.append(stale)
            stale = None
        # STAGE 3 (G4 FIX): stamp with an epoch strictly DISTINCT from every
        # live same-key row. The executed G4 failure showed the old bump rule
        # (`max(now_epoch, stale.window_epoch + 1)`) could still land on
        # cur_epoch when the stale row's epoch was smaller than the current
        # bucket — the candidate UPDATE then collided with that still-live
        # row inside uq_alert_group_active ("UNIQUE constraint failed ...
        # [SQL: UPDATE alerts SET dedup_key=?]"). Taking max over ALL live
        # same-(org,key) epochs makes uniqueness structural, independent of
        # SQLite's deferred partial-index evaluation, while PostgreSQL keeps
        # identical semantics.
        live = (await db.execute(
            select(Alert).where(
                Alert.dedup_key == fp,
                Alert.org_id == alert.org_id,       # explicit tenant scope
                self_excl,
                Alert.status != "resolved",
            ).with_for_update()
        )).scalars().all()
        for a in live:
            if a.id == target.id:
                continue
            anchor = _aware(a.last_seen_at) or _aware(a.created_at)
            # STAGE 3 FIX G4-boundary #3: NEVER retire an IN-WINDOW live
            # same-key row. Such a row is the fold target for future
            # duplicates; destroying it re-splits a steady stream into
            # multiple concurrent groups (violates the documented one-group
            # invariant and the executed G8 parallel test). The stamping path
            # below keeps uq_alert_group_active satisfied structurally by
            # choosing an epoch strictly greater than every retained live
            # row's epoch (max(retained)+1), so retirement can stay purely
            # time-based. NOTE: _fold_into keeps survivors stamped at the
            # candidate's CURRENT bucket on every fold, so a long-lived active
            # group always sits in the newest bucket and a new group started
            # after a window expiry takes max()+1 — distinct by construction.
            if anchor is not None and anchor >= since:
                continue
            if anchor is None or anchor < since:
                # Out-of-window same-key group (or same-slot stale row): retire
                # it so the promoted candidate legitimately owns the
                # fingerprint slot. Live rows INSIDE the window with a distinct
                # epoch are RETAINED (they are active groups; retiring them
                # would destroy fold targets).
                to_retire.append(a)
        # STAGE 3 FIX G4-boundary #6 (verified by executed failure
        # 498107 == 498107): the bump must consider EVERY live same-key row's
        # epoch, including rows retired inside this very sweep. A stale group
        # parked in exactly the slot the new candidate wants (base_epoch) is
        # retired here, but its UPDATE only clears the partial-index entry at
        # flush time; on SQLite's deferred index evaluation — and logically on
        # both engines — two live-in-transaction rows must never share one
        # (org, key, epoch). Taking max over ALL live epochs (retained AND
        # retiring) makes the new group's stamp strictly distinct from the
        # stale group it supersedes, satisfying the documented invariant
        # "distinct groups never share one (org, key, epoch)". Retired rows
        # keep their old epoch as history; the fold path re-stamps survivors
        # to cur_epoch, so no legitimate fold target is ever displaced.
        retained_epochs = [a.window_epoch for a in live
                           if a.id != target.id and a.window_epoch]
        for r in to_retire:
            r.status = "resolved"
            r.resolved_at = now_db
            r.resolved_by = "system"
            db.add(AlertEvent(
                org_id=r.org_id, alert_id=r.id, actor="system",
                action="group_retired",
                detail="Grouping window elapsed; superseded by new active group"))
        await db.flush()   # retire FIRST — ordering keeps the index valid
        target.dedup_key = fp
        # STAGE 3 (G4 FIX, verified by executed failure 498106==498106): stamp
        # with an epoch STRICTLY DISTINCT from every retained live same-key row.
        # The previous plain-cur_epoch stamp collided whenever a live same-epoch
        # row survived retirement (retirement only excludes OUT-of-window rows);
        # max(live epochs, base)+1 bump makes distinct-group epoch uniqueness
        # structural on SQLite's deferred partial-index evaluation while
        # PostgreSQL (immediate predicate) keeps identical semantics.
        # STAGE 3 FIX G4-boundary (verified by executed failure): anchor the
        # stamp at the ROLLING activity window (`since` = now - window), not
        # the candidate's calendar bucket. The old window_epoch(now_utc())
        # seed landed in the SAME bucket as a just-aged-out stale row, so the
        # new group's stamp collided with it inside uq_alert_group_active and
        # forced either an IntegrityError or the +1 bump that broke the test's
        # `old.epoch != new.epoch` assertion. base_epoch is also THE slot that
        # concurrent new-group candidates compete for (the retirement sweep
        # below retires any live same-key row parked in this exact slot).
        base_epoch = window_epoch(since, window_min)
        target.window_epoch = (max(retained_epochs + [base_epoch]) + 1
                               if retained_epochs else base_epoch)
        target.last_seen_at = now_db

    if in_window is not None:
        # Re-check the documented window precisely against the chosen row.
        # STAGE 3 FIX G4-boundary #5b (verified by executed debug harness):
        # staleness is judged on min(captured anchor, now), where the anchor
        # snapshot is taken BEFORE any intra-transaction aging UPDATE can
        # rewrite last_seen_at. A row whose pre-fold anchor already aged past
        # `since` must never remain a fold target merely because promotion/
        # fold bookkeeping wrote last_seen_at afterwards.
        anchor = _aware(in_window.last_seen_at) or _aware(in_window.created_at)
        if anchor is not None and anchor > now_utc():
            anchor = now_utc()
        if anchor is None or anchor >= since:
            folded = await _fold_into(in_window, _sp)
            if folded is not None:
                # STAGE 3 FIX G8: release the fold savepoint into the outer
                # transaction (NO commit — callers own durability).
                await _sp.commit()
                return folded
        else:
            stale = in_window
    if stale is not None:
        await _promote_below_window(alert)
        try:
            # STAGE 3 FIX G8: was `await db.commit()` — a mid-correlation
            # COMMIT resets the shared StaticPool cursor under concurrent
            # asyncio.gather requests. Flush + savepoint release keeps the
            # retirement/promotion ordering durable within the outer tx; the
            # partial unique index still validates at this point on both
            # engines (SQLite executes statements immediately; PostgreSQL
            # validates unique indexes at statement time even inside a tx).
            await db.flush()
            await _sp.commit()
        except IntegrityError:
            # A concurrent writer retired/promoted in between; roll the
            # savepoint back (outer tx stays alive — the old db.rollback()
            # used to end it) and fall through to the normal insert-race
            # recovery below by re-stamping.
            await _sp.rollback()
            _sp = await db.begin_nested()
            alert.dedup_key = None
            alert.window_epoch = None
        else:
            # STAGE 3 (G4 FIX, verified by executed failure): `alert` was
            # committed UNSTAMPED by the pipeline, so correlate's promotion
            # UPDATE (dedup_key/window_epoch) never reached the database —
            # SQLite does not flush ORM column mutations during commit().
            # Explicit flush makes the stamp durable before refresh/return;
            # without it the "new group" kept a NULL identity and every later
            # duplicate started yet another group instead of folding.
            await db.flush()
            await db.refresh(alert)
            return alert
    # STAGE 3 (G4 FIX, verified by executed failure): the fresh-group path must
    # ALSO go through retirement. Previously it stamped (fp, cur_epoch) directly
    # whenever the two targeted lookups found nothing; but those lookups could
    # miss a live same-(org,key) row whose activity anchor made it invisible to
    # them (e.g. legacy last_seen_at semantics), leaving TWO live rows sharing
    # one (org, key, epoch) after commit — exactly the G4 assertion failure
    # (498106 == 498106). _promote_below_window now sweeps EVERY live same-key
    # row under FOR UPDATE, retires any that are out-of-window, and stamps the
    # candidate with an epoch strictly greater than every retained live row's
    # epoch, making distinct-group epoch uniqueness structural on both engines.
    await _promote_below_window(alert)
    alert.dedup_key = fp
    try:
        # STAGE 3 (G8 FIX): flush BEFORE the savepoint release so the
        # IntegrityError below is raised HERE, inside correlate's own scope.
        # The pipeline commits the candidate unstamped; if the stamp were only
        # sent during the caller's commit(), SQLite would execute it AFTER our
        # statements as an autogen UPDATE in the pipeline's post-correlate
        # flush — the exception would then land in the pipeline's generic
        # except-block and kill the event instead of taking this
        # fold-into-winner recovery path.
        # STAGE 3 FIX G8: `await db.commit()` replaced by savepoint release —
        # no mid-correlation COMMIT ever reaches the shared StaticPool cursor.
        await db.flush()
        await _sp.commit()
    except IntegrityError:
        # Concurrent writer won the race and stamped the group for this
        # (org, fp, epoch) first. Roll back ONLY our savepoint (the outer tx
        # stays alive; the old db.rollback() ended it and forced a fresh
        # implicit transaction) and fold into the survivor under the normal
        # lock path.
        await _sp.rollback()
        _sp = await db.begin_nested()
        result = await db.execute(
            select(Alert).where(
                Alert.dedup_key == fp,
                Alert.org_id == alert.org_id,      # explicit tenant scope
                Alert.window_epoch == cur_epoch,   # same-epoch winner only
            ).order_by(Alert.created_at.desc()).limit(1).with_for_update()
        )
        winner = result.scalars().first()
        if winner is None:
            await _sp.commit()
            raise   # constraint violation without a visible winner — do not mask
        folded = await _fold_into(winner, _sp)
        if folded is not None:
            await _sp.commit()
            return folded
        # Winner vanished (resolved/edge case): retry once as fresh insert.
        alert.dedup_key = fp
        alert.window_epoch = cur_epoch
        await db.flush()
        await _sp.commit()
    else:
        await db.refresh(alert)
        return alert
    await db.refresh(alert)
    return alert


# --------------------------------------------------------------------------
# Rule evaluation (conditions from the visual rule builder)
# --------------------------------------------------------------------------
def rule_matches(rule: NotificationRule, alert: Alert) -> bool:
    if not rule.enabled:
        return False
    if rule.org_id is not None and rule.org_id != alert.org_id:
        return False
    cond = rule.conditions or {}
    sev_list = cond.get("severity") or []
    if sev_list and alert.severity not in sev_list:
        return False
    src_list = cond.get("source") or []
    if src_list and alert.source not in src_list:
        return False
    contains = (cond.get("contains") or "").lower()
    if contains and contains not in f"{alert.title} {alert.description}".lower():
        return False
    min_rank = cond.get("min_severity")
    if min_rank and SEVERITY_RANK.get(alert.severity, 0) < SEVERITY_RANK.get(min_rank, 0):
        return False
    return True


def in_quiet_hours(quiet: Optional[dict], at: datetime) -> bool:
    if not quiet:
        return False
    try:
        start_h, start_m = map(int, quiet["start"].split(":"))
        end_h, end_m = map(int, quiet["end"].split(":"))
    except Exception:
        return False
    minutes = at.hour * 60 + at.minute
    start = start_h * 60 + start_m
    end = end_h * 60 + end_m
    if start <= end:
        return start <= minutes < end
    return minutes >= start or minutes < end  # wraps midnight


# --------------------------------------------------------------------------
# Delivery transports — REAL providers via app.services.transports when a
# ChannelConfig exists for the tenant; simulated only in demo/no-config mode.
# --------------------------------------------------------------------------
def deliver(channel: str, recipient: str, subject: str, org_id: int | None = None,
            db_cfg: dict | None = None) -> dict:
    """Dispatch through real SMTP/webhook/SMS transports when configured.

    `db_cfg` is the tenant's ChannelConfig.config_json (fetched by dispatch()).
    Falls back to env vars inside transports.py. Only DELIVERY_MODE=simulated
    forces the fake transport (used by tests); otherwise an unconfigured real
    channel returns an honest error which feeds the retry/dead-letter queue.
    """
    if channel == "in_app":
        return {"provider": "in-app", "message_id": hashlib.md5(
            f"{recipient}{subject}inapp".encode()).hexdigest()[:16]}

    from app.services import transports

    if DELIVERY_MODE == "simulated" and not os.getenv("SMTP_HOST") and not (db_cfg or {}).get("smtp_host"):
        # no mail infrastructure at all -> keep the legacy simulator so the
        # pipeline (retries/DLQ) stays testable without external services
        fail_rate = {"email": 0.08, "sms": 0.15, "webhook": 0.12}.get(channel, 0.1)
        if random.random() < fail_rate:
            raise ConnectionError(f"{channel} gateway timeout (simulated)")
        return {"provider": f"sim-{channel}", "message_id": hashlib.md5(
            f"{recipient}{subject}{datetime.utcnow().isoformat()}".encode()).hexdigest()[:16]}

    if channel == "email":
        res = transports.send_email(db_cfg, recipient, subject)
    elif channel == "webhook":
        res = transports.send_webhook(db_cfg, (db_cfg or {}).get("url", ""), subject,
                                      {"event": "notification", "to": recipient, "subject": subject})
    elif channel == "sms":
        res = transports.send_sms(db_cfg, recipient, subject)
    else:
        raise ConnectionError(f"Unknown channel {channel}")
    if not res.get("ok"):
        raise ConnectionError(res.get("error", "transport failure"))
    return res


MAX_ATTEMPTS = 3


async def dispatch(db: AsyncSession, notif: Notification) -> Notification:
    """Send one notification with retries; park in dead-letter on final failure."""
    if notif.status == "suppressed":
        return notif
    # load tenant channel customization (Settings > Notifications)
    from app.models import ChannelConfig
    cfg_row = (await db.execute(
        select(ChannelConfig).where(
            ChannelConfig.org_id == getattr(notif, "org_id", None),
            ChannelConfig.channel == notif.channel)
    )).scalars().first() if getattr(notif, "org_id", None) else None
    db_cfg = (cfg_row.config_json if cfg_row else None) or {}
    if cfg_row and not cfg_row.enabled and notif.channel != "in_app":
        notif.status = "suppressed"
        notif.last_error = "channel disabled in Settings"
        return notif
    for attempt in range(notif.attempts + 1, MAX_ATTEMPTS + 1):
        notif.attempts = attempt
        try:
            result = deliver(notif.channel, notif.recipient, notif.subject,
                             getattr(notif, "org_id", None), db_cfg)
            notif.status = "sent"
            notif.sent_at = now_utc()
            notif.last_error = None
            break
        except Exception as e:  # noqa: BLE001
            notif.last_error = str(e)
            if attempt >= MAX_ATTEMPTS:
                notif.status = "dead_letter"
            else:
                notif.status = "queued"
    return notif


# --------------------------------------------------------------------------
# Main pipeline: alert -> rules -> notifications (+ auto ticket)
# --------------------------------------------------------------------------
async def process_alert(db: AsyncSession, alert: Alert) -> dict:
    """Full event-intelligence pass over one alert. Returns diagnostics."""
    routed: list[Notification] = []
    created_ticket_uid: Optional[str] = None
    suppressed = alert.storm_suppressed

    result = await db.execute(
        select(NotificationRule).where(
            (NotificationRule.org_id == alert.org_id) | (NotificationRule.org_id.is_(None))
        )
    )
    rules = [r for r in result.scalars().all() if rule_matches(r, alert)]

    for rule in rules:
        # auto-ticketing: FIRST matched rule with create_ticket wins
        if rule.create_ticket and created_ticket_uid is None and alert.ticket_uid is None:
            pri = rule.ticket_priority or {"critical": "p1", "high": "p2"}.get(alert.severity, "p3")
            ticket = await create_ticket(
                db, org_id=alert.org_id,
                title=f"[{alert.severity.upper()}] {alert.title}",
                description=alert.description or f"Auto-created from alert {alert.uid}",
                priority=pri, category="incident", source="alert",
                asset=alert.resource, alert_id=alert.id,
            )
            alert.ticket_uid = ticket.uid
            created_ticket_uid = ticket.uid

        if suppressed:
            continue  # storm protection: no re-notification for folded duplicates

        channels = rule.channels or ["in_app"]
        recipients = rule.recipients or ["soc-team"]
        deferred = in_quiet_hours(rule.quiet_hours, now_utc())
        for ch in channels:
            for rcpt in recipients:
                n = Notification(
                    org_id=alert.org_id, alert_id=alert.id, rule_id=rule.id,
                    channel=ch, recipient=str(rcpt),
                    subject=f"[{alert.severity.upper()}] {alert.title}",
                    body=alert.description or alert.title, severity=alert.severity,
                    status="queued" if not deferred else "suppressed",
                    created_at=now_utc(),
                )
                if deferred and ch != "in_app":
                    n.status = "suppressed"
                    n.last_error = "quiet_hours"
                db.add(n)
                await db.flush()
                if n.status == "queued":
                    await dispatch(db, n)
                routed.append(n)

    if not rules:  # default safety net: critical alerts always notify in-app + platform team
        n = Notification(
            org_id=alert.org_id, alert_id=alert.id, rule_id=None,
            channel="in_app", recipient="platform-noc",
            subject=f"[{alert.severity.upper()}] {alert.title}",
            body=alert.description or alert.title, severity=alert.severity,
            status="queued", created_at=now_utc(),
        )
        db.add(n)
        await db.flush()
        await dispatch(db, n)
        routed.append(n)

    if created_ticket_uid:
        alert.title = alert.title  # keep
    await db.commit()
    return {
        "alert_uid": alert.uid,
        "rules_matched": len(rules),
        "notifications": len(routed),
        "sent": sum(1 for x in routed if x.status == "sent"),
        "dead_letter": sum(1 for x in routed if x.status == "dead_letter"),
        "storm_suppressed": suppressed,
        "ticket_created": created_ticket_uid,
    }


async def ack_notification(db: AsyncSession, notif: Notification, actor: str) -> None:
    # Honesty rule: an analyst may only acknowledge a notification that was
    # ACTUALLY delivered (status sent). Queued / dead_letter / suppressed rows
    # keep their delivery status — we record who looked at them, never claim
    # delivery that did not happen.
    if notif.status == "sent":
        notif.status = "acked"
    notif.acked_by = actor
    notif.acked_at = now_utc()
    if notif.alert_id:
        alert = (await db.execute(select(Alert).where(Alert.id == notif.alert_id))).scalars().first()
        if alert:
            _apply_alert_ack(alert, actor)
            db.add(AlertEvent(org_id=alert.org_id, alert_id=alert.id, actor=actor,
                              action="acked", detail="Acknowledged via notification ack"))
    await db.commit()


def _apply_alert_ack(alert: Alert, actor: str) -> None:
    if alert.status != "acked":
        alert.status = "active" if alert.status == "resolved" else "acked"
    alert.acked_by = actor
    alert.acked_at = now_utc()


async def transition_alert(
    db: AsyncSession, alert: Alert, *, actor: str,
    new_status: Optional[str] = None, assignee: Optional[str] = ...,
    expected_version: Optional[int] = None, note: Optional[str] = None,
) -> tuple[Alert, bool]:
    """Validated lifecycle transition with optimistic concurrency + audit trail.

    Returns (alert, changed). Raises HTTPException(409) on stale version.
    Allowed transitions (server-enforced):
      active   -> acked | resolved | (assignee change)
      acked    -> resolved | active(reopen)
      resolved -> active(reopen)          [re-open requires explicit 'active']
    Idempotent: re-acknowledging an already-acked alert is a no-op (200,
    changed=False) instead of a second history entry.
    """
    from fastapi import HTTPException
    if expected_version is not None and alert.version != expected_version:
        raise HTTPException(409, detail={
            "error": "version_conflict",
            "message": "Alert was modified by someone else; reload and retry.",
            "current_version": alert.version})

    changed = False
    if new_status and new_status != alert.status:
        allowed = {
            "active": {"acked", "resolved"},        # reopen paths
            "acked": {"active"},                    # fresh ack
            "resolved": {"active", "acked"},        # resolve from either open state
        }
        if alert.status not in allowed.get(new_status, set()):
            raise HTTPException(422, f"Illegal transition {alert.status} -> {new_status}")
        if new_status == "acked":
            _apply_alert_ack(alert, actor)
        elif new_status == "resolved":
            alert.status = "resolved"
            alert.resolved_by = actor
            alert.resolved_at = now_utc()
        else:  # reopen
            alert.status = "active"
            alert.resolved_at = None
            alert.resolved_by = None
        db.add(AlertEvent(org_id=alert.org_id, alert_id=alert.id, actor=actor,
                          action={"acked": "acked", "resolved": "resolved"}.get(new_status, "reopened"),
                          detail=f"Status {new_status}"))
        changed = True

    if assignee is not ... and assignee != (alert.assignee or None):
        alert.assignee = assignee
        db.add(AlertEvent(org_id=alert.org_id, alert_id=alert.id, actor=actor,
                          action="assigned", detail=f"Assignee: {assignee or '(unassigned)'}"))
        changed = True

    if note:
        db.add(AlertNote(org_id=alert.org_id, alert_id=alert.id, author=actor,
                         body=note, created_at=now_utc()))
        db.add(AlertEvent(org_id=alert.org_id, alert_id=alert.id, actor=actor,
                          action="noted", detail="Investigation note added"))
        changed = True

    if changed:
        alert.version = (alert.version or 1) + 1
        await db.commit()
        await db.refresh(alert)
    return alert, changed


async def retry_notification(db: AsyncSession, notif: Notification, actor: str) -> Notification:
    """Safe single-item retry — ONLY for dead-letter rows (backend-confirmed failures).

    The returned row carries the *actual* post-retry outcome: `sent` means the
    transport confirmed delivery this run; `dead_letter` means it failed again
    (last_error updated); queued/suppressed are never produced here because
    dispatch() runs to completion synchronously within MAX_ATTEMPTS.
    """
    from fastapi import HTTPException
    if notif.status != "dead_letter":
        raise HTTPException(409, f"Only dead-letter notifications can be retried (status={notif.status})")
    notif.attempts = 0
    notif.status = "queued"
    await dispatch(db, notif)
    db.add(AlertEvent(org_id=notif.org_id, alert_id=notif.alert_id or 0, actor=actor,
                      action="retry",
                      detail=f"Manual retry -> {notif.status}" + (f" ({notif.last_error})" if notif.last_error else ""))
                 if notif.alert_id else AlertEvent(
                     org_id=notif.org_id, alert_id=notif.id, actor=actor,
                     action="retry", detail=f"Manual retry -> {notif.status}"))
    await db.commit()
    await db.refresh(notif)
    return notif


async def retry_dead_letters(db: AsyncSession, org_id: Optional[int] = None) -> int:
    """Re-attempt everything parked in the dead-letter queue (optionally one tenant)."""
    q = select(Notification).where(Notification.status == "dead_letter")
    if org_id is not None:
        q = q.where(Notification.org_id == org_id)
    result = await db.execute(q)
    count = 0
    for n in result.scalars().all():
        n.attempts = 0
        n.status = "queued"
        await dispatch(db, n)
        count += 1
    await db.commit()
    return count


async def analytics(db: AsyncSession, org_id: Optional[int] = None) -> dict:
    q = select(Notification.status, func.count()).group_by(Notification.status)
    if org_id:
        q = q.where(Notification.org_id == org_id)
    by_status = {row[0]: row[1] for row in (await db.execute(q)).all()}
    qc = select(Notification.channel, func.count()).group_by(Notification.channel)
    if org_id:
        qc = qc.where(Notification.org_id == org_id)
    by_channel = {row[0]: row[1] for row in (await db.execute(qc)).all()}
    qa = select(func.coalesce(func.sum(Alert.correlated_count), 0))
    if org_id:
        qa = qa.where(Alert.org_id == org_id)
    total_events = (await db.execute(qa)).scalar() or 0
    return {"by_status": by_status, "by_channel": by_channel, "total_events_correlated": int(total_events)}
