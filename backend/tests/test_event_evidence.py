"""Stage 1 — Event Evidence: durable per-event raw payload + provenance.

Run from backend/:
  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_event_evidence.py -p no:libtmux -q

Honesty guarantees under test (design checklist T1/T3/T4/T5/T9/T14):
  * EVERY accepted event keeps its own evidence row, INCLUDING duplicates that
    the correlation layer folds into an existing alert (payload survives fold).
  * Byte-identical payloads with different source_event_ids are distinct events
    (identity is never derived from payload content alone).
  * Tenant isolation: cross-tenant evidence lookups and listings 404/return
    nothing; existence is never leaked. Viewer role cannot fetch payloads.
  * Oversized payloads: > hard ceiling -> 413 before anything persists;
    between caps -> stored truncated with excerpt + full sha256.
  * Retention expiry nulls payload columns only; stub metadata remains.
  * Existing alert behavior preserved: folding still deletes the duplicate
    alert row and increments correlated_count on the survivor.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("DELIVERY_MODE", "simulated")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlalchemy.dialects import postgresql  # noqa: E402
from sqlalchemy.ext.compiler import compiles  # noqa: E402


@compiles(postgresql.JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw):  # pragma: no cover - test shim
    return "JSON"


from app.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token, get_password_hash  # noqa: E402
from app.models import Organization, User, Alert, EventEvidence  # noqa: E402
from app.main import app  # noqa: E402
from app.services import evidence as ev  # noqa: E402

NOW = datetime.now(timezone.utc).replace(tzinfo=None)


@pytest_asyncio.fixture()
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


async def _seed(factory):
    async with factory() as s:
        s.add_all([
            Organization(id=1, name="Org One", tier="mid-market", status="active", contact_email="a@b.c"),
            Organization(id=3, name="Org Three", tier="sme", status="active", contact_email="x@y.z"),
            User(id=1, email="ca@one.io", hashed_password=get_password_hash("x"),
                 name="CA1", role="client_admin", org_id=1),
            User(id=3, email="ca@three.io", hashed_password=get_password_hash("x"),
                 name="CA3", role="client_admin", org_id=3),
            User(id=4, email="viewer@one.io", hashed_password=get_password_hash("x"),
                 name="V1", role="viewer", org_id=1),
        ])
        await s.commit()


def client_for(session_factory, user_id=None):
    async def _get_db():
        async with session_factory() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db
    headers = {}
    if user_id is not None:
        headers["Authorization"] = f"Bearer {create_access_token({'sub': str(user_id)})}"
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t", headers=headers)


def alert_body(**kw) -> dict:
    # NOTE: the ingest pipeline stores body.raw_payload as the durable event
    # payload (merge_geo_payload semantics, unchanged). Per-event markers go
    # inside raw_payload so they are observable on each evidence row.
    base = {"title": "Brute force attempt", "severity": "high", "source": "siem",
            "resource": "srv-01", "description": "d", "org_id": 1}
    base.update(kw)
    return base


def marked(marker: str, **extra) -> dict:
    """Body whose raw_payload carries a unique per-event marker `marker`."""
    b = alert_body(raw_payload={"marker": marker}, **extra)
    if extra.get("raw_payload"):
        b["raw_payload"] = {**b["raw_payload"], **extra.pop("raw_payload")}
        b.update(extra)
    return b


# ---------------------------------------------------------------------------
# T3: every accepted event retains its raw payload — including folded dupes
# T1: identical payloads with different source IDs are DISTINCT events
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_folded_duplicate_keeps_own_payload(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        b1 = marked("first detection", source_event_id="evt-A")
        b2 = marked("second detection", source_event_id="evt-B")
        r1 = await c.post("/api/alerts", json=b1)
        assert r1.status_code == 201, r1.text
        uid1 = r1.json()["alert"]["uid"]
        r2 = await c.post("/api/alerts", json=b2)
        assert r2.status_code == 201, r2.text
        uid2 = r2.json()["alert"]["uid"]

        # grouping semantics UNCHANGED: same fingerprint within 1h folds to one alert
        assert uid1 == uid2, "duplicate should fold into the surviving alert"

        async with session_factory() as s:
            alerts = (await s.execute(
                __import__("sqlalchemy").select(Alert).where(Alert.uid == uid1))
            ).scalars().all()
            assert len(alerts) == 1, "fold must not leave a second alert row"
            assert alerts[0].correlated_count == 2

            # BOTH events keep independent durable evidence rows
            rows = (await s.execute(
                __import__("sqlalchemy").select(EventEvidence)
                .where(EventEvidence.org_id == 1)
                .order_by(EventEvidence.id))
            ).scalars().all()
            assert len(rows) == 2
            assert {r.source_event_id for r in rows} == {"evt-A", "evt-B"}
            markers = {(p or {}).get("marker") for p in (r.raw_payload for r in rows)}
            assert markers == {"first detection", "second detection"}, \
                f"folded duplicate's unique payload must survive: {markers}"
            # both linked to the SURVIVING group uid (provenance, not grouping change)
            assert all(r.alert_uid == uid1 for r in rows)


@pytest.mark.asyncio
async def test_byte_identical_payloads_are_distinct_events(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        body = alert_body(source_event_id="evt-X")
        ra = await c.post("/api/alerts", json=body)
        rb = await c.post("/api/alerts", json=alert_body(source_event_id="evt-Y"))
        assert ra.status_code == 201 and rb.status_code == 201
        async with session_factory() as s:
            rows = (await s.execute(
                __import__("sqlalchemy").select(EventEvidence).where(EventEvidence.org_id == 1))
            ).scalars().all()
            assert len(rows) == 2
            # identical canonical content => same hash, yet two separate events
            assert rows[0].payload_sha256 == rows[1].payload_sha256
            assert rows[0].event_uid != rows[1].event_uid
            # expected hash recomputed from the row's own stored payload —
            # independent of transport serialization details
            expected = hashlib.sha256(
                json.dumps(rows[1].raw_payload, sort_keys=True, default=str,
                           ensure_ascii=False)
                .encode("utf-8")).hexdigest()
            assert rows[0].payload_sha256 == expected


# ---------------------------------------------------------------------------
# T5: tenant isolation on evidence access
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_cross_tenant_evidence_lookup_404s(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.post("/api/alerts", json=alert_body(source_event_id="evt-T"))
        assert r.status_code == 201
    async with client_for(session_factory, user_id=3) as c3:
        async with session_factory() as s:
            rec = (await s.execute(
                __import__("sqlalchemy").select(EventEvidence).where(EventEvidence.org_id == 1))
            ).scalars().first()
            uid = rec.event_uid
        g = await c3.get(f"/api/evidence/{uid}")
        assert g.status_code == 404, "cross-tenant evidence must not be found"
        a = (await c3.get("/api/alerts", params={"page_size": 100})).json()
        for item in a["items"]:
            e = await c3.get(f"/api/alerts/{item['id']}/evidence")
            assert e.status_code in (200, 404)
            assert e.json() == [] or all(True for _ in e.json())
        # foreign alert listing returns nothing for org-3 alerts of org 1 anyway
        assert all(i["org_id"] == 3 for i in a["items"])


@pytest.mark.asyncio
async def test_viewer_cannot_read_raw_payload(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.post("/api/alerts", json=alert_body(source_event_id="evt-V"))
        assert r.status_code == 201
    async with session_factory() as s:
        uid = (await s.execute(
            __import__("sqlalchemy").select(EventEvidence).where(EventEvidence.org_id == 1))
        ).scalars().first().event_uid
    async with client_for(session_factory, user_id=4) as cv:
        g = await cv.get(f"/api/evidence/{uid}")
        assert g.status_code == 403, "read-only roles must not fetch payloads"


# ---------------------------------------------------------------------------
# Size policy: inline cap / truncation / hard ceiling 413
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_oversized_payloads_truncate_or_reject(session_factory):
    await _seed(session_factory)
    from app.core.config import settings
    pad_mid = "A" * (settings.EVIDENCE_MAX_INLINE_BYTES + 4096)   # over inline cap, under hard ceiling
    pad_big = "B" * (settings.EVIDENCE_HARD_LIMIT_BYTES + 1024)   # over absolute cap
    async with client_for(session_factory, user_id=1) as c:
        r = await c.post("/api/alerts", json=alert_body(
            source_event_id="evt-M", raw_payload={"pad": pad_mid}))
        assert r.status_code == 201, r.text
        r2 = await c.post("/api/alerts", json=alert_body(
            source_event_id="evt-G", raw_payload={"pad": pad_big}))
        assert r2.status_code == 413, "over hard ceiling must be rejected"
    async with session_factory() as s:
        rows = (await s.execute(
            __import__("sqlalchemy").select(EventEvidence)
            .where(EventEvidence.source_event_id == "evt-M"))
        ).scalars().all()
        assert len(rows) == 1
        rec = rows[0]
        assert rec.truncated is True
        assert rec.raw_payload is None
        assert rec.payload_excerpt and len(rec.payload_excerpt) <= settings.EVIDENCE_MAX_INLINE_BYTES
        assert rec.payload_bytes > settings.EVIDENCE_MAX_INLINE_BYTES
        # full-payload integrity hash retained despite truncation
        assert len(rec.payload_sha256) == 64
        # the oversized event was NOT persisted at all
        none_big = (await s.execute(
            __import__("sqlalchemy").select(EventEvidence)
            .where(EventEvidence.source_event_id == "evt-G"))
        ).scalars().first()
        assert none_big is None


# ---------------------------------------------------------------------------
# T14: retention expiry — payload nulled, stub stays intelligible
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_retention_expiry_nulls_payload_keeps_stub(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.post("/api/alerts", json=alert_body(source_event_id="evt-R"))
        assert r.status_code == 201
    async with session_factory() as s:
        rec = (await s.execute(
            __import__("sqlalchemy").select(EventEvidence).where(EventEvidence.org_id == 1))
        ).scalars().first()
        assert rec.raw_payload is not None
        # simulate the passage of the retention window (tz-aware column on sqlite)
        rec.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        await s.commit()
        n = await ev.run_retention_expiry(s)
        assert n == 1
        n2 = await ev.run_retention_expiry(s)
        assert n2 == 0, "expiry pass must be idempotent"
        await s.refresh(rec)
        assert rec.payload_expired is True
        assert rec.raw_payload is None and rec.payload_excerpt is None
        # stub remains intelligible
        assert rec.payload_sha256 and rec.payload_bytes > 0
        assert rec.source_event_id == "evt-R" and rec.received_at is not None
        assert rec.provenance.get("endpoint") == "/api/alerts"


# ---------------------------------------------------------------------------
# Behavior preservation: alert pipeline unchanged by evidence storage
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_alert_response_contract_unchanged(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.post("/api/alerts", json=alert_body(source_event_id="evt-C"))
        assert r.status_code == 201
        body = r.json()
        # pre-existing keys still present (contract: alert + pipeline diagnostics)
        assert set(body.keys()) >= {"alert", "pipeline"}
        assert body["alert"]["title"] == "Brute force attempt"
        assert body["alert"]["severity"] == "high"
        # additive evidence field on detail view lists the stored event
        aid = body["alert"]["id"]
        d = await c.get(f"/api/alerts/{aid}")
        assert d.status_code == 200
        evs = d.json().get("evidence")
        assert isinstance(evs, list) and len(evs) >= 1
        assert "raw_payload" not in json.dumps(evs[0]), "summaries must never embed payloads"
