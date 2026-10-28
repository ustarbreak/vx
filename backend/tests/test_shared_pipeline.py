"""Stage 2 — Shared Pipeline: source parity, idempotency, failure durability.

Run from backend/:
  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_shared_pipeline.py -p no:libtmux -q

Honesty guarantees under test (approved design checklist):
  * SOURCE PARITY: HTTP/API, agent, and discovery events all run through the
    ONE shared pipeline function — every path produces durable evidence AND a
    correlated alert group (previously agent/discovery inserted alerts
    directly, bypassing correlate() entirely).
  * IDEMPOTENCY IS SEPARATE FROM GROUPING AND PAYLOAD HASHES:
      - transport retry of the same source_event_id -> zero new side effects;
      - byte-identical payload WITHOUT a source id -> distinct accepted events
        (grouped together, but each keeps its own evidence row);
      - grouping fold semantics remain unchanged.
  * EVIDENCE SURVIVES FAILURE: if processing raises after Tx A, the event's
    evidence row remains durably stored, marked status='failed', with no
    orphan alert row committed.
  * NO DUPLICATE SIDE EFFECTS ON RETRY: a re-delivered agent report cannot
    double-increment correlated_count or create a second alert row.
"""
from __future__ import annotations

import hashlib
import os
import sys
from datetime import datetime, timezone

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("DELIVERY_MODE", "simulated")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlalchemy.dialects import postgresql  # noqa: E402
from sqlalchemy.ext.compiler import compiles  # noqa: E402


@compiles(postgresql.JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw):  # pragma: no cover - test shim
    return "JSON"

from app.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token, get_password_hash  # noqa: E402
from app.models import (  # noqa: E402
    Alert, AgentProbe, AgentToken, EventEvidence, Organization, User,
)
from app.main import app  # noqa: E402
from app.services import evidence as ev  # noqa: E402
from app.services import pipeline as pl  # noqa: E402

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
            User(id=1, email="ca@one.io", hashed_password=get_password_hash("x"),
                 name="CA1", role="client_admin", org_id=1),
        ])
        await s.commit()


# ---------------------------------------------------------------------------
# P1/P2: SOURCE PARITY — agent path now produces evidence + grouped alert
# ---------------------------------------------------------------------------

async def _make_agent_setup(factory, *, token_plain: str):
    """Agent-token auth is preserved verbatim; we just enroll a probe + token."""
    async with factory() as s:
        s.add(AgentProbe(id=7, org_id=1, hostname="probe-7", status="online"))
        s.add(AgentToken(org_id=1, name="t", prefix=token_plain[:12],
                         token_hash=hashlib.sha256(token_plain.encode()).hexdigest()))
        await s.commit()


async def _post_agent_report(factory, token_plain: str, body: dict):
    from httpx import ASGITransport, AsyncClient

    async def _get_db():
        async with factory() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t",
                           headers={"Authorization": f"Bearer {token_plain}"}) as c:
        return await c.post("/api/agent/7/discovery", json=body)


SNMP_DEVICE = {"ip": "10.0.0.9", "hostname": "sw-core-01", "open_ports": [161],
               "sys_name": "sw-core-01", "sys_descr": "Cisco IOS Software, Catalyst L3 Switch"}


@pytest.mark.asyncio
async def test_agent_path_uses_shared_pipeline(session_factory):
    """P1: an SNMP-matched agent device now creates DURABLE EVIDENCE and passes
    through correlate()/grouping — both previously absent on this path."""
    await _seed(session_factory)
    tok = "icag_testtoken_" + "a" * 32
    await _make_agent_setup(session_factory, token_plain=tok)

    r = await _post_agent_report(session_factory, tok, {"devices": [SNMP_DEVICE]})
    assert r.status_code == 201, r.text

    async with session_factory() as s:
        rows = (await s.execute(
            select(EventEvidence).where(EventEvidence.source_system == "snmp")
        )).scalars().all()
        assert len(rows) == 1, "agent SNMP event must leave durable evidence"
        assert rows[0].raw_payload["ip"] == "10.0.0.9"
        assert rows[0].provenance.get("endpoint") == "/api/agent/discovery"
        assert rows[0].processing_status == "processed"

        alerts = (await s.execute(select(Alert).where(Alert.source == "snmp"))).scalars().all()
        assert len(alerts) == 1
        assert alerts[0].dedup_key, "agent alert must be grouped (correlate ran)"


@pytest.mark.asyncio
async def test_agent_retry_no_duplicate_side_effects(session_factory):
    """P2: re-delivering the SAME agent scan batch (same source_event_ids)
    must not duplicate alerts, counters, or evidence rows."""
    await _seed(session_factory)
    tok = "icag_testtoken_" + "b" * 32
    await _make_agent_setup(session_factory, token_plain=tok)

    body = {"devices": [SNMP_DEVICE]}
    r1 = await _post_agent_report(session_factory, tok, body)
    assert r1.status_code == 201
    r2 = await _post_agent_report(session_factory, tok, body)
    assert r2.status_code == 201  # report itself is idempotent per-device-key

    async with session_factory() as s:
        ev_rows = (await s.execute(
            select(EventEvidence).where(EventEvidence.source_system == "snmp")
        )).scalars().all()
        assert len(ev_rows) == 1, "retry must not store a second evidence row"

        alerts = (await s.execute(select(Alert).where(Alert.source == "snmp"))).scalars().all()
        assert len(alerts) == 1
        # THE key assertion: idempotency replay did NOT bump correlated_count
        assert alerts[0].correlated_count == 1, (
            f"retried delivery must not re-fold/re-count (got {alerts[0].correlated_count})")


# ---------------------------------------------------------------------------
# P3: discovery-path parity at the pipeline level. The full background scan
# depends on seeded SnmpCredentials + RNG-simulated probes (flaky to pin in a
# unit test); instead we exercise the EXACT adapter contract the discovery
# service uses against the same shared entrypoint. Router/service wiring was
# verified by source inspection; end-to-end scan behavior stays covered by
# tests/test_discovery_auth.py.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_discovery_adapter_parity_with_http(session_factory):
    await _seed(session_factory)
    fields = {
        "title": "SNMP-matched device discovered at 10.0.0.9",
        "description": "Auto-discovery found a device responding to credential 'comm1'",
        "severity": "info", "source": "nmap", "resource": "host-9.lan.local",
        "raw_payload": {"scan_id": 42, "ip": "10.0.0.9"},
    }
    async with session_factory() as s:
        rec = await ev.store_event_evidence(
            s, org_id=1, payload=fields["raw_payload"], source_system="nmap",
            source_event_id="scan-42-10.0.0.9",
            provenance={"actor": "discovery-service", "endpoint": "services/discovery.run_scan"})
        await s.commit()
        out1 = await pl.process_ingested_event(s, org_id=1, evidence_uid=rec.event_uid,
                                               fields=fields, run_side_effects=False)
        assert out1["status"] == "processed"

        # Second discovery finding for a DIFFERENT scan/IP-event but the same
        # detection identity -> grouped via correlate, evidence kept separate.
        rec2 = await ev.store_event_evidence(
            s, org_id=1, payload={"scan_id": 43, "ip": "10.0.0.9"}, source_system="nmap",
            source_event_id="scan-43-10.0.0.9", provenance={})
        await s.commit()
        out2 = await pl.process_ingested_event(s, org_id=1, evidence_uid=rec2.event_uid,
                                               fields=fields, run_side_effects=False)
        assert out2["folded_into_existing"] is True
        assert out2["alert_uid"] == out1["alert_uid"]

        # Parity check vs HTTP path: same shape of outcome keys
        assert {"status", "alert_uid", "evidence_uid", "folded_into_existing"} <= set(out2)

        n_ev = len((await s.execute(
            select(EventEvidence).where(EventEvidence.source_system == "nmap"))).scalars().all())
        assert n_ev == 2, "each accepted discovery event keeps its own evidence"


# ---------------------------------------------------------------------------
# P4: idempotency taxonomy — ingest key vs payload hash vs grouping
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_identical_payload_without_source_id_is_distinct_events(session_factory):
    await _seed(session_factory)
    async with session_factory() as s:
        payload = {"marker": "same bytes"}
        r1 = await ev.store_event_evidence(s, org_id=1, payload=payload,
                                            source_system="api", source_event_id=None)
        r2 = await ev.store_event_evidence(s, org_id=1, payload=payload,
                                           source_system="api", source_event_id=None)
        assert r1.event_uid != r2.event_uid, (
            "byte-identical payloads are NOT proof of the same event")
        assert r1.payload_sha256 == r2.payload_sha256  # integrity metadata agrees
        assert r1.ingest_key is None and r2.ingest_key is None  # no idem key claimed
        await s.commit()


@pytest.mark.asyncio
async def test_transport_retry_returns_original_and_skips_processing(session_factory):
    """Same source_event_id replayed through the FULL pipeline: second call is
    a recorded-outcome replay — no counter bump, no second alert row."""
    await _seed(session_factory)
    async with session_factory() as s:
        fields = {"title": "Brute force attempt", "description": "d", "severity": "high",
                  "source": "siem", "resource": "srv-01", "raw_payload": {"marker": "evt-A"}}
        rec = await ev.store_event_evidence(s, org_id=1, payload=fields["raw_payload"],
                                            source_system="api", source_event_id="evt-A")
        await s.commit()
        o1 = await pl.process_ingested_event(s, org_id=1, evidence_uid=rec.event_uid, fields=fields)
        assert o1["status"] == "processed"

        # Simulate transport retry: same ingest identity resolves to the SAME
        # evidence row (store returns original), then pipeline replays outcome.
        rec_again = await ev.store_event_evidence(s, org_id=1, payload=fields["raw_payload"],
                                                  source_system="api", source_event_id="evt-A")
        assert rec_again.event_uid == rec.event_uid
        o2 = await pl.process_ingested_event(s, org_id=1, evidence_uid=rec_again.event_uid,
                                             fields=fields)
        assert o2["status"] == "duplicate"
        assert o2["pipeline"]["idempotent_replay"] is True
        assert o2["alert_uid"] == o1["alert_uid"]

        alerts = (await s.execute(select(Alert))).scalars().all()
        assert len(alerts) == 1
        assert alerts[0].correlated_count == 1, "replay must not re-fold"


# ---------------------------------------------------------------------------
# P5: failure durability — evidence survives processing failure
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_pipeline_failure_keeps_evidence_durable_marked_failed(session_factory, monkeypatch):
    await _seed(session_factory)

    async def boom(db, alert):  # explode inside correlate (Tx B)
        raise RuntimeError("synthetic pipeline crash")

    monkeypatch.setattr("app.services.notifications.correlate", boom)
    async with session_factory() as s:
        fields = {"title": "Will fail", "description": "", "severity": "high",
                  "source": "siem", "resource": "srv-02", "raw_payload": {"marker": "crash"}}
        rec = await ev.store_event_evidence(s, org_id=1, payload=fields["raw_payload"],
                                            source_system="api", source_event_id="evt-crash")
        await s.commit()  # Tx A durable BEFORE processing

        with pytest.raises(RuntimeError):
            await pl.process_ingested_event(s, org_id=1, evidence_uid=rec.event_uid, fields=fields)

        # Evidence row still there, marked failed, payload intact
        got = (await s.execute(
            select(EventEvidence).where(EventEvidence.event_uid == rec.event_uid)
        )).scalars().first()
        assert got is not None
        assert got.processing_status == "failed"
        assert "synthetic pipeline crash" in (got.processing_error or "")
        assert got.raw_payload == {"marker": "crash"}

        # No orphan candidate alert committed
        orphans = (await s.execute(
            select(Alert).where(Alert.title == "Will fail"))).scalars().all()
        assert orphans == []


# ---------------------------------------------------------------------------
# P6: cross-source grouping parity — HTTP and agent detections of the same
#     logical event share one group (behavior CHANGE vs pre-Stage-2, pinned
#     here intentionally so it is visible in review).
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cross_source_fold_via_shared_pipeline(session_factory):
    """Shared-pipeline grouping parity: an HTTP-ingested event and an AGENT-
    reported detection with the SAME grouping identity (org|source|resource|
    title — source IS part of the fingerprint, unchanged semantics) now fold
    into ONE alert group. Before Stage 2 the agent path bypassed correlate()
    entirely and would have created a second row. Both events keep their own
    durable evidence."""
    await _seed(session_factory)
    tok = "icag_testtoken_" + "c" * 32
    await _make_agent_setup(session_factory, token_plain=tok)

    # --- Agent FIRST (full router path through the shared pipeline) ---------
    r = await _post_agent_report(session_factory, tok, {"devices": [SNMP_DEVICE]})
    assert r.status_code == 201
    async with session_factory() as s:
        first = (await s.execute(
            select(Alert).where(Alert.source == "snmp"))).scalars().all()
        assert len(first) == 1
        assert first[0].correlated_count == 1
        agent_uid, agent_resource = first[0].uid, first[0].resource

    # --- Then the SAME detection identity arrives via the HTTP pipeline -----
    # (adapter-supplied fields identical to what the agent adapter emits:
    #  source="snmp", resource=<hostname>, same title.)
    async with session_factory() as s:
        fields = {"title": f"SNMP-matched device discovered at {SNMP_DEVICE['ip']} "
                           f"(via probe probe-7)",
                  "description": "http-side duplicate of the agent detection",
                  "severity": "info", "source": "snmp", "resource": agent_resource,
                  "raw_payload": {"via": "http"}}
        rec = await ev.store_event_evidence(s, org_id=1, payload=fields["raw_payload"],
                                            source_system="api", source_event_id="h-1")
        await s.commit()
        o2 = await pl.process_ingested_event(s, org_id=1, evidence_uid=rec.event_uid,
                                             fields=fields, run_side_effects=False)
        assert o2["folded_into_existing"] is True, (
            "HTTP duplicate must fold into the agent-created group")
        assert o2["alert_uid"] == agent_uid

        alerts = (await s.execute(
            select(Alert).where(Alert.uid == agent_uid))).scalars().all()
        assert len(alerts) == 1, "both sources must land in ONE group"
        assert alerts[0].correlated_count == 2, (
            "agent-path group now receives HTTP folds (shared pipeline)")

        evs = (await s.execute(
            select(EventEvidence).where(EventEvidence.org_id == 1)
        )).scalars().all()
        assert len(evs) == 2, "both events keep independent evidence"
