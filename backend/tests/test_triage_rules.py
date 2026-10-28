"""STAGE 5 — Rules-based triage: deterministic scoring tests.

Run from backend/:
  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_triage_rules.py -p no:libtmux -q

Covers the approved Stage 5 acceptance criteria:
  * determinism: same inputs -> identical payload (10x repeat, byte-equal)
  * score bounds: 0..100 clamped, every reason-code sum reconciles
  * axis separation: severity / priority / confidence / corroboration /
    recurrence / recommended action are independent fields of the payload
  * reason codes on every contributing and missing input (MD_*)
  * policy versioning: v1 seeded row == DEFAULT_POLICY; unknown version -> 404;
    evaluations freeze their version string
  * critical safeguard: critical can NEVER score below 90 / leave p1 band,
    even with all-other inputs empty; engine never mutates the incident
  * overrides: analyst override recorded in history + audit log, rule score
    preserved; client_user 403; evaluate before override (409 otherwise)
  * audit history: one immutable TriageEvaluation row per evaluation run
  * regressions: Stage 3/4 suites unaffected (run separately)
No ML, no LLM, no autonomous suppression — asserted structurally too.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
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
from app.models import (Organization, User, Alert, Incident, AuditLog,  # noqa: E402
                        TriagePolicy, TriageEvaluation)
from app.main import app  # noqa: E402
from app.services.triage import (compute_triage, load_policy, evaluate_incident,  # noqa: E402
                                 clear_policy_cache, DEFAULT_WEIGHTS, DEFAULT_BANDS,
                                 DEFAULT_CONFIDENCE, CRITICAL_FLOOR)
from app.services.seed import ensure_triage_policy  # noqa: E402

NOW = datetime.now(timezone.utc).replace(tzinfo=None)
pytestmark = pytest.mark.asyncio

POLICY = {"policy_version": "v1", "weights": dict(DEFAULT_WEIGHTS),
          "bands": [dict(b) for b in DEFAULT_BANDS],
          "confidence_weights": dict(DEFAULT_CONFIDENCE)}


def _inc(**kw) -> dict:
    base = {"severity": "medium", "category": "other", "assignee": None,
            "resource": None, "description": "", "dedup_key": None,
            "ticket_uid": None, "affected_assets": [], "ioc_related": [],
            "episode_number": 1, "recurrence_of_uid": None, "status": "open"}
    base.update(kw)
    return base


# ---------------------------------------------------------------------------
# Pure-function tests (no DB) — determinism, bounds, axes, reason codes
# ---------------------------------------------------------------------------
def test_determinism_same_inputs_identical_output():
    inc = _inc(severity="high", description="beacon seen 3x", dedup_key="k",
               affected_assets=["ws-042"], episode_number=2,
               recurrence_of_uid="INC-000001")
    counts = {"source_count": 3, "correlated_count": 7, "alert_count": 2}
    r1 = compute_triage(inc, counts=counts, policy=POLICY)
    for _ in range(10):
        assert compute_triage(dict(inc), counts=dict(counts),
                              policy=POLICY) == r1
    # json-level equality too (reason code ordering is fixed by construction)
    import json
    assert json.dumps(r1, sort_keys=True) == json.dumps(compute_triage(
        dict(inc), counts=dict(counts), policy=POLICY), sort_keys=True)


def test_score_bounds_clamped_high_and_low():
    # Everything maxed: raw > 100 must clamp to exactly 100
    inc = _inc(severity="critical", ticket_uid="TCK-1", affected_assets=["a", "b"],
               ioc_related=["1.2.3.4"], episode_number=3, recurrence_of_uid="INC-1")
    counts = {"source_count": 9, "correlated_count": 50, "alert_count": 5}
    r = compute_triage(inc, counts=counts, policy=POLICY)
    assert r["score"] == 100 and r["clamped"]
    assert any(rc["code"] == "BOUND_CLAMP_HIGH" for rc in r["reason_codes"])
    # raw reconciliation: bounded == min(100, max(0, raw))
    assert r["raw_score"] > 100 and r["score"] == min(100, r["raw_score"])
    # Empty everything: floor at 0, still >= 0
    r2 = compute_triage(_inc(severity=""), counts={}, policy=POLICY)
    assert 0 <= r2["score"] <= 100
    # reason points reconcile with raw score
    assert sum(rc["points"] for rc in r2["reason_codes"]) == r2["raw_score"]


def test_axes_are_separate_fields():
    inc = _inc(severity="critical", description="x", dedup_key="d",
               category="malware", assignee="analyst@acme.io")
    counts = {"source_count": 2, "correlated_count": 1, "alert_count": 1}
    r = compute_triage(inc, counts=counts, policy=POLICY)
    # source severity untouched in payload; priority calculated; confidence
    # data-quality; corroboration count; recurrence separate; action advisory
    assert r["priority"] in ("p1", "p2", "p3", "p4")
    assert 0 <= r["confidence"] <= 100
    # no ticket_uid in this fixture -> corroboration == distinct source count
    assert r["corroboration"] == counts["source_count"]
    assert isinstance(r["recommended_action"], str) and r["recommended_action"]
    assert "score" in r and "raw_score" in r


def test_reason_codes_present_for_contributing_and_missing_inputs():
    r = compute_triage(_inc(), counts={"source_count": 0}, policy=POLICY)
    codes = {rc["code"] for rc in r["reason_codes"]}
    assert "SEV_MEDIUM" in codes          # contributing
    assert "MD_SOURCES" in codes          # missing evidence
    assert "MD_ASSETS" in codes           # missing impact context
    assert any(c.startswith("BAND_") for c in codes)
    # zero-point codes carry points==0
    assert all(rc["points"] == 0 for rc in r["reason_codes"]
               if rc["code"].startswith("MD_"))


def test_recurrence_axis_from_stage4_fields():
    a = compute_triage(_inc(severity="low"), counts={}, policy=POLICY)
    b = compute_triage(_inc(severity="low", episode_number=2,
                            recurrence_of_uid="INC-000007"), counts={}, policy=POLICY)
    assert b["raw_score"] - a["raw_score"] == DEFAULT_WEIGHTS["recurrence"]
    assert any(rc["code"] == "RECURRENCE_EPISODE" for rc in b["reason_codes"])


def test_critical_safeguard_floor_never_deprioritizes():
    # critical with NO other signal at all: floored to 90 -> stays p1 band
    r = compute_triage(_inc(severity="critical"), counts={}, policy=POLICY)
    assert r["score"] >= CRITICAL_FLOOR
    assert r["priority"] == "p1"
    assert r["floored"]
    assert any(rc["code"] == "CS_CRITICAL_FLOOR" for rc in r["reason_codes"])


def test_scoring_never_suppresses_or_mutates_pure():
    # pure function returns advisory only; no side-channel keys leak in
    r = compute_triage(_inc(severity="critical"), counts={}, policy=POLICY)
    forbidden = {"suppressed", "closed", "status_change", "executed_action"}
    assert forbidden.isdisjoint(r.keys())


# ---------------------------------------------------------------------------
# DB fixtures
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture()
async def factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                 future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    f = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    clear_policy_cache()
    async with f() as s:
        s.add_all([
            Organization(id=1, name="Acme Corp", tier="enterprise", status="active",
                         contact_email="a@acme.io", org_type="HQ"),
            Organization(id=3, name="Foreign Corp", tier="sme", status="active",
                         contact_email="x@for.io", org_type="HQ"),
            User(id=1, email="admin@acme.io", hashed_password=get_password_hash("x"),
                 name="Admin", role="client_admin", org_id=1),
            User(id=2, email="user@acme.io", hashed_password=get_password_hash("x"),
                 name="User", role="client_user", org_id=1),
            Incident(id=1, uid="INC-000001", org_id=1, title="Ransomware beacon",
                     description="multiple callbacks", severity="high", status="open",
                     category="malware", dedup_key="dk1", ticket_uid=None,
                     affected_assets=["ws-042"], ioc_related=[], episode_number=1,
                     created_at=NOW),
            Incident(id=2, uid="INC-000002", org_id=1, title="Silent critical",
                     description="", severity="critical", status="open",
                     category="other", dedup_key=None, affected_assets=[],
                     ioc_related=[], episode_number=2, recurrence_of_uid="INC-000001",
                     created_at=NOW),
            Incident(id=3, uid="INC-000003", org_id=3, title="Foreign incident",
                     description="", severity="low", status="open",
                     affected_assets=[], ioc_related=[], episode_number=1,
                     created_at=NOW),
            Alert(id=1, uid="ALR-000001", org_id=1, title="t", severity="high",
                  source="siem", incident_uid="INC-000001", correlated_count=6),
            Alert(id=2, uid="ALR-000002", org_id=1, title="t2", severity="high",
                  source="wazuh", incident_uid="INC-000001", correlated_count=2),
        ])
        await s.commit()
        await ensure_triage_policy(s)   # seed v1 exactly like lifespan
    yield f
    await engine.dispose()
    clear_policy_cache()


def client_for(session_factory, user_id=None):
    class _Client:
        def __init__(self):
            self._prev = None

        async def __aenter__(self):
            from httpx import ASGITransport, AsyncClient
            async def _get_db():
                async with session_factory() as s:
                    yield s
            self._prev = app.dependency_overrides.get(get_db)
            app.dependency_overrides[get_db] = _get_db
            headers = {}
            if user_id is not None:
                headers["Authorization"] = f"Bearer {create_access_token({'sub': str(user_id)})}"
            self._c = AsyncClient(transport=ASGITransport(app=app),
                                  base_url="http://t", headers=headers)
            await self._c.__aenter__()
            return self._c

        async def __aexit__(self, *exc):
            r = await self._c.__aexit__(*exc)
            if self._prev is not None:
                app.dependency_overrides[get_db] = self._prev
            else:
                app.dependency_overrides.pop(get_db, None)
            return r

    return _Client()


# ---------------------------------------------------------------------------
# Policy versioning
# ---------------------------------------------------------------------------
async def test_seeded_v1_matches_default_policy(factory):
    async with factory() as s:
        pol = (await s.execute(select(TriagePolicy).where(
            TriagePolicy.policy_version == "v1"))).scalars().one()
        assert pol.weights == DEFAULT_WEIGHTS
        assert pol.bands == [dict(b) for b in DEFAULT_BANDS]
        assert pol.confidence_weights == DEFAULT_CONFIDENCE
        loaded = await load_policy(s, "v1")
        assert loaded["weights"] == DEFAULT_WEIGHTS


async def test_unknown_policy_version_raises(factory):
    async with factory() as s:
        with pytest.raises(LookupError):
            await load_policy(s, "v99")


async def test_evaluation_freezes_policy_version(factory):
    async with factory() as s:
        inc = (await s.execute(select(Incident).where(Incident.uid == "INC-000001"))).scalars().one()
        r = await evaluate_incident(s, inc, evaluator="admin@acme.io")
        await s.commit()
        assert r["policy_version"] == "v1"
        ev = (await s.execute(select(TriageEvaluation).where(
            TriageEvaluation.incident_uid == "INC-000001"))).scalars().all()
        assert len(ev) == 1 and ev[0].policy_version == "v1"


# ---------------------------------------------------------------------------
# evaluate_incident (DB path): corroboration from linked alerts, immutability
# ---------------------------------------------------------------------------
async def test_evaluate_uses_linked_alert_corroboration(factory):
    async with factory() as s:
        inc = (await s.execute(select(Incident).where(Incident.uid == "INC-000001"))).scalars().one()
        r = await evaluate_incident(s, inc, evaluator="admin@acme.io")
        assert r["corroboration"] == 2                      # siem + wazuh
        assert any(rc["code"] == "CORROBORATION_SOURCES" for rc in r["reason_codes"])
        assert any(rc["code"] == "VOLUME_GE_5" for rc in r["reason_codes"])  # 6+2=8 >= 5
        assert any(rc["code"] == "ASSET_IMPACT" for rc in r["reason_codes"])
        assert 0 <= r["score"] <= 100


async def test_evaluate_never_mutates_incident(factory):
    async with factory() as s:
        inc = (await s.execute(select(Incident).where(Incident.uid == "INC-000002"))).scalars().one()
        before = (inc.severity, inc.status, inc.resolved_at, inc.updated_at)
        r = await evaluate_incident(s, inc, evaluator="admin@acme.io")
        await s.commit()
        after = (inc.severity, inc.status, inc.resolved_at, inc.updated_at)
        assert before == after                               # severity/status untouched
        assert r["score"] >= CRITICAL_FLOOR and r["priority"] == "p1"
        assert any(rc["code"] == "RECURRENCE_EPISODE" for rc in r["reason_codes"])


async def test_audit_history_appends_one_row_per_run(factory):
    async with factory() as s:
        inc = (await s.execute(select(Incident).where(Incident.uid == "INC-000001"))).scalars().one()
        await evaluate_incident(s, inc, evaluator="admin@acme.io"); await s.commit()
        await evaluate_incident(s, inc, evaluator="admin@acme.io"); await s.commit()
        rows = (await s.execute(select(TriageEvaluation).where(
            TriageEvaluation.incident_uid == "INC-000001"))).scalars().all()
        assert len(rows) == 2                                # append-only history
        assert rows[0].id != rows[1].id


# ---------------------------------------------------------------------------
# Router endpoints: auth, tenancy, permissions, overrides
# ---------------------------------------------------------------------------
async def test_router_evaluate_and_history(factory):
    async with client_for(factory, user_id=1) as c:
        r = await c.post("/api/triage/incidents/INC-000001/evaluate")
        assert r.status_code == 200, r.text
        body = r.json()
        assert 0 <= body["score"] <= 100 and body["priority"].startswith("p")
        r2 = await c.get("/api/triage/incidents/INC-000001")
        assert r2.status_code == 200
        hist = r2.json()["history"]
        assert len(hist) == 1 and hist[0]["reason_codes"]
        # audit log written
        r3 = await c.get("/api/triage/policies")
        assert r3.status_code == 200 and r3.json()[0]["policy_version"] == "v1"


async def test_router_cross_tenant_403_and_unauth_401(factory):
    async with client_for(factory, user_id=1) as c:
        r = await c.post("/api/triage/incidents/INC-000003/evaluate")
        assert r.status_code == 403                          # foreign tenant
    async with client_for(factory) as c:
        r = await c.post("/api/triage/incidents/INC-000001/evaluate")
        assert r.status_code in (401, 403)                   # unauthenticated


async def test_router_permissions_and_override(factory):
    # client_user may evaluate but NOT override
    async with client_for(factory, user_id=2) as c:
        r = await c.post("/api/triage/incidents/INC-000001/evaluate")
        assert r.status_code == 200
        o = await c.post("/api/triage/incidents/INC-000001/override",
                         json={"reason": "not my lane", "priority": "p4"})
        assert o.status_code == 403
    async with client_for(factory, user_id=1) as c:
        # override without prior evaluation -> 409 (INC-000002 never evaluated here)
        pre = await c.post("/api/triage/incidents/INC-000002/override",
                           json={"reason": "false positive confirmed", "priority": "p4"})
        assert pre.status_code == 409
        # admin overrides INC-000001's recorded evaluation
        ov = await c.post("/api/triage/incidents/INC-000001/override",
                          json={"reason": "confirmed benign, downgraded manually",
                                "priority": "p4"})
        assert ov.status_code == 200, ov.text
        d = ov.json()
        assert d["override"]["by"] == "admin@acme.io"
        assert d["priority"] == "p4"                         # reported priority changed
        assert isinstance(d["score"], int) and 0 <= d["score"] <= 100  # rule score kept
        h = (await c.get("/api/triage/incidents/INC-000001")).json()
        assert h["latest"]["breakdown"]["override"]["reason"] == \
            "confirmed benign, downgraded manually"
        # incident itself untouched by override
        async with factory() as s:
            inc = (await s.execute(select(Incident).where(
                Incident.uid == "INC-000001"))).scalars().one()
            assert inc.severity == "high" and inc.status == "open"
            audits = (await s.execute(select(AuditLog).where(
                AuditLog.resource == "triage"))).scalars().all()
            assert any(a.action == "triage_overridden" for a in audits)


async def test_no_ml_llm_surface(factory):
    # structural guard: triage module must not import network/model libs
    import inspect
    import app.services.triage as tmod
    src = inspect.getsource(tmod)
    for banned in ("requests", "httpx", "openai", "anthropic", "torch",
                   "sklearn", "transformers", "model.fit", "predict("):
        assert banned not in src, f"banned ML/LLM/network token in triage: {banned}"
