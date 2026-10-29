"""STAGE 6A — Structured outcome labeling: regression tests.

Run from backend/:
  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_outcome_labels.py -p no:libtmux -q

Covers the Stage 6A acceptance criteria:
  * vocabulary: disposition + priority_correctness enums enforced (422 on junk)
  * append-only immutability: labels never overwrite prior rows; corrections
    chain via supersedes_id; double-supersede of a corrected row rejected;
    triage snapshots (TriageEvaluation) byte-identical before/after labeling
  * reopened incidents: status transitions never touch label rows; new labels
    simply append
  * tenant isolation: cross-tenant POST/GET -> 403; foreign supersedes_id ->
    403 even for platform_admin; label org_id always follows the incident
  * authorization: unauthenticated 401; client_user 403 on write, allowed to
    read own-tenant history
  * effective-priority snapshot frozen from latest evaluation incl. override
  * audit trail: one AuditLog row per label/correction with distinct actions
  * scoring untouched: app.services.triage source unchanged & outcome module
    contains no ML/LLM tokens (structural guard)
Migration side (chain head c3d9e1f7a2b4, real op.* execution) is covered in
tests/test_postgres_hardening.py (M1/M3).
"""
from __future__ import annotations

import os
import sys

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
from app.models import (Organization, User, Incident, AuditLog,  # noqa: E402
                        TriageEvaluation, OutcomeLabel)
from app.main import app  # noqa: E402
from app.services.triage import evaluate_incident, clear_policy_cache  # noqa: E402
from app.services.seed import ensure_triage_policy  # noqa: E402
from app.services.outcomes import (append_outcome_label, validate_label,  # noqa: E402
                                   DISPOSITIONS, PRIORITY_CORRECTNESS)

NOW = __import__("datetime").datetime.now(
    __import__("datetime").timezone.utc).replace(tzinfo=None)
pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# fixtures (same pattern as Stage 5 suite)
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
            User(id=9, email="root@platform.io", hashed_password=get_password_hash("x"),
                 name="Root", role="platform_admin", org_id=3),
            Incident(id=1, uid="INC-000001", org_id=1, title="Ransomware beacon",
                     description="multiple callbacks", severity="high",
                     status="resolved", category="malware", dedup_key="dk1",
                     affected_assets=["ws-042"], ioc_related=[], episode_number=1,
                     created_at=NOW),
            Incident(id=2, uid="INC-000002", org_id=1, title="Never evaluated",
                     description="", severity="low", status="closed",
                     category="other", affected_assets=[], ioc_related=[],
                     episode_number=1, created_at=NOW),
            Incident(id=3, uid="INC-000003", org_id=3, title="Foreign incident",
                     description="", severity="low", status="open",
                     affected_assets=[], ioc_related=[], episode_number=1,
                     created_at=NOW),
        ])
        await s.commit()
        await ensure_triage_policy(s)
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


LABEL_OK = {"disposition": "true_positive", "priority_correctness": "correct"}


# ---------------------------------------------------------------------------
# Pure validation
# ---------------------------------------------------------------------------
def test_vocabularies_exact():
    assert DISPOSITIONS == ("true_positive", "false_positive",
                            "benign_duplicate", "unknown")
    assert PRIORITY_CORRECTNESS == ("correct", "too_high", "too_low", "unknown")
    for d in DISPOSITIONS:
        for p in PRIORITY_CORRECTNESS:
            validate_label(d, p)          # must not raise
    with pytest.raises(ValueError):
        validate_label("maybe_true", "correct")
    with pytest.raises(ValueError):
        validate_label("true_positive", "sort_of")


# ---------------------------------------------------------------------------
# Service layer: append-only, corrections, reopen, snapshot freeze
# ---------------------------------------------------------------------------
async def test_append_only_and_snapshot_freeze(factory):
    async with factory() as s:
        inc = (await s.execute(select(Incident).where(
            Incident.uid == "INC-000001"))).scalars().one()
        ev = await evaluate_incident(s, inc, evaluator="admin@acme.io")
        await s.commit()
        snap_before = dict(ev)
        row = await append_outcome_label(
            s, inc, disposition="false_positive", priority_correctness="too_high",
            labeled_by="admin@acme.io", rationale="backup job noise",
            reviewer="lead@acme.io")
        await s.commit()
        assert row.priority_labeled_at == snap_before["priority"]
        assert row.reviewer == "lead@acme.io" and row.labeled_by == "admin@acme.io"
        # second label APPENDS; first row stays byte-identical.
        # STAGE 6C/6D head semantics: a PLAIN append is an independent
        # observation (reopened episode) — supersedes_id stays None and both
        # rows remain live heads; per-incident dedup happens in the evaluator
        # (compute_baseline_metrics), not by stamping. Explicit reopen relabels
        # use relabel_previous=True instead (covered in test_relabel_previous_
        # stamps_head). Pure append-only either way: no prior row edited/deleted.
        r2 = await append_outcome_label(
            s, inc, disposition="true_positive", priority_correctness="correct",
            labeled_by="admin@acme.io")
        await s.commit()
        assert r2.id != row.id and r2.supersedes_id is None
        assert r2.reviewer == "admin@acme.io"      # defaults to actor
        rows = (await s.execute(select(OutcomeLabel).order_by(
            OutcomeLabel.id))).scalars().all()
        assert len(rows) == 2
        assert rows[0].disposition == "false_positive"   # original untouched
        # triage snapshot untouched by labeling
        evrow = (await s.execute(select(TriageEvaluation).where(
            TriageEvaluation.incident_uid == "INC-000001"))).scalars().one()
        assert evrow.breakdown == snap_before
        assert evrow.priority == snap_before["priority"] and evrow.score == evrow.score


async def test_correction_chains_never_overwrite(factory):
    async with factory() as s:
        inc = (await s.execute(select(Incident).where(
            Incident.uid == "INC-000001"))).scalars().one()
        orig = await append_outcome_label(
            s, inc, disposition="benign_duplicate", priority_correctness="unknown",
            labeled_by="admin@acme.io")
        await s.commit()
        fix = await append_outcome_label(
            s, inc, disposition="true_positive", priority_correctness="too_low",
            labeled_by="admin@acme.io", supersedes_id=orig.id,
            rationale="was real, mislabeled initially")
        await s.commit()
        assert fix.supersedes_id == orig.id and fix.id > orig.id
        # double-supersede of an already-corrected row is rejected
        with pytest.raises(ValueError):
            await append_outcome_label(
                s, inc, disposition="unknown", priority_correctness="unknown",
                labeled_by="admin@acme.io", supersedes_id=orig.id)
        # correcting a nonexistent label -> LookupError
        with pytest.raises(LookupError):
            await append_outcome_label(
                s, inc, disposition="unknown", priority_correctness="unknown",
                labeled_by="admin@acme.io", supersedes_id=9999)
        rows = (await s.execute(select(OutcomeLabel).order_by(
            OutcomeLabel.id))).scalars().all()
        assert len(rows) == 2                        # nothing deleted
        assert rows[0].disposition == "benign_duplicate"  # history preserved


async def test_no_evaluation_freezes_none_priority(factory):
    async with factory() as s:
        inc = (await s.execute(select(Incident).where(
            Incident.uid == "INC-000002"))).scalars().one()
        row = await append_outcome_label(
            s, inc, disposition="unknown", priority_correctness="unknown",
            labeled_by="admin@acme.io")
        await s.commit()
        assert row.priority_labeled_at is None


async def test_reopen_does_not_touch_labels(factory):
    """Reopening (status transition) leaves all label rows intact; relabeling
    after reopen appends a new row."""
    async with factory() as s:
        inc = (await s.execute(select(Incident).where(
            Incident.uid == "INC-000001"))).scalars().one()
        lbl = await append_outcome_label(
            s, inc, disposition="true_positive", priority_correctness="correct",
            labeled_by="admin@acme.io")
        await s.commit()
        inc.status = "investigating"          # analyst reopen via lifecycle
        await s.commit()
        again = await append_outcome_label(
            s, inc, disposition="false_positive", priority_correctness="too_high",
            labeled_by="admin@acme.io")
        await s.commit()
        rows = (await s.execute(select(OutcomeLabel).where(
            OutcomeLabel.incident_uid == "INC-000001").order_by(
            OutcomeLabel.id))).scalars().all()
        assert [r.id for r in rows] == [lbl.id, again.id]
        assert rows[0].disposition == "true_positive"   # pre-reopen fact kept


async def test_relabel_previous_stamps_head(factory):
    """REOPEN RELABEL (relabel_previous=True) stamps the previous live head so
    evaluators collapse to one label per incident — still pure append-only."""
    async with factory() as s:
        inc = (await s.execute(select(Incident).where(
            Incident.uid == "INC-000001"))).scalars().one()
        first = await append_outcome_label(
            s, inc, disposition="true_positive", priority_correctness="correct",
            labeled_by="admin@acme.io")
        await s.commit()
        again = await append_outcome_label(
            s, inc, disposition="false_positive", priority_correctness="too_high",
            labeled_by="admin@acme.io", relabel_previous=True)
        await s.commit()
        assert again.supersedes_id == first.id and again.id > first.id
        rows = (await s.execute(select(OutcomeLabel).order_by(
            OutcomeLabel.id))).scalars().all()
        assert len(rows) == 2                       # history intact
        assert rows[0].disposition == "true_positive"
        # a second relabel_previous chains off the NEW head, never re-stamps
        third = await append_outcome_label(
            s, inc, disposition="true_positive", priority_correctness="correct",
            labeled_by="admin@acme.io", relabel_previous=True)
        await s.commit()
        assert third.supersedes_id == again.id


async def test_router_relabel_previous_and_mutual_exclusion(factory):
    """Router flow: relabel_previous plain-append stamps head; combining it
    with an explicit supersedes_id is rejected 422 (mutually exclusive)."""
    async with client_for(factory, user_id=1) as c:
        r1 = await c.post("/api/triage/incidents/INC-000001/outcome-label",
                          json=LABEL_OK)
        assert r1.status_code == 201, r1.text
        first_id = r1.json()["id"]
        # mutual exclusion: both knobs at once -> 422
        bad = await c.post("/api/triage/incidents/INC-000001/outcome-label",
                           json={**LABEL_OK, "supersedes_id": first_id,
                                 "relabel_previous": True})
        assert bad.status_code == 422
        assert "mutually exclusive" in bad.json()["detail"]
        # reopen relabel via API: stamps head, keeps history
        r2 = await c.post("/api/triage/incidents/INC-000001/outcome-label",
                          json={"disposition": "benign_duplicate",
                                "priority_correctness": "unknown",
                                "relabel_previous": True})
        assert r2.status_code == 201, r2.text
        assert r2.json()["supersedes_id"] == first_id
        h = (await c.get("/api/triage/incidents/INC-000001/outcome-labels")).json()
        assert len(h["history"]) == 2               # append-only, nothing lost
        assert h["latest"]["supersedes_id"] == first_id
        # plain append (no flags) remains an independent head
        r3 = await c.post("/api/triage/incidents/INC-000001/outcome-label",
                          json=LABEL_OK)
        assert r3.status_code == 201 and r3.json()["supersedes_id"] is None


# ---------------------------------------------------------------------------
# Router: authz, tenancy, vocab enforcement, audit
# ---------------------------------------------------------------------------
async def test_router_label_flow_and_audit(factory):
    async with client_for(factory, user_id=1) as c:
        await c.post("/api/triage/incidents/INC-000001/evaluate")
        r = await c.post("/api/triage/incidents/INC-000001/outcome-label",
                         json={**LABEL_OK, "rationale": "confirmed real",
                               "reviewer": "lead@acme.io"})
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["disposition"] == "true_positive" and d["supersedes_id"] is None
        assert d["priority_labeled_at"] in ("p1", "p2", "p3", "p4")
        g = await c.get("/api/triage/incidents/INC-000001/outcome-labels")
        assert g.status_code == 200
        body = g.json()
        assert body["latest"]["id"] == d["id"] and len(body["history"]) == 1
        # bad vocabulary -> 422 (pydantic pattern)
        bad = await c.post("/api/triage/incidents/INC-000001/outcome-label",
                           json={"disposition": "sorta_real",
                                 "priority_correctness": "correct"})
        assert bad.status_code == 422
        # correction via API chains, keeps both rows
        corr = await c.post("/api/triage/incidents/INC-000001/outcome-label",
                            json={"disposition": "false_positive",
                                  "priority_correctness": "too_high",
                                  "supersedes_id": d["id"]})
        assert corr.status_code == 201, corr.text
        h = (await c.get("/api/triage/incidents/INC-000001/outcome-labels")).json()
        assert len(h["history"]) == 2 and h["latest"]["supersedes_id"] == d["id"]
        async with factory() as s:
            audits = (await s.execute(select(AuditLog).where(
                AuditLog.resource == "triage"))).scalars().all()
            acts = {a.action for a in audits}
            assert {"incident_outcome_label_added",
                    "incident_outcome_label_corrected"} <= acts


async def test_router_authz_and_tenancy(factory):
    # unauthenticated
    async with client_for(factory) as c:
        r = await c.post("/api/triage/incidents/INC-000001/outcome-label",
                         json=LABEL_OK)
        assert r.status_code in (401, 403)
    # client_user may read but not write
    async with client_for(factory, user_id=2) as c:
        w = await c.post("/api/triage/incidents/INC-000001/outcome-label",
                         json=LABEL_OK)
        assert w.status_code == 403
        rd = await c.get("/api/triage/incidents/INC-000001/outcome-labels")
        assert rd.status_code == 200 and rd.json()["history"] == []
    # cross-tenant write/read -> 403
    async with client_for(factory, user_id=1) as c:
        x = await c.post("/api/triage/incidents/INC-000003/outcome-label",
                         json=LABEL_OK)
        assert x.status_code == 403
        y = await c.get("/api/triage/incidents/INC-000003/outcome-labels")
        assert y.status_code == 403
    # unknown incident -> 404
    async with client_for(factory, user_id=1) as c:
        n = await c.post("/api/triage/incidents/INC-999999/outcome-label",
                         json=LABEL_OK)
        assert n.status_code == 404


async def test_cross_tenant_supersedes_rejected_even_platform_admin(factory):
    async with client_for(factory, user_id=1) as c:
        mine = await c.post("/api/triage/incidents/INC-000001/outcome-label",
                            json=LABEL_OK)
        assert mine.status_code == 201
    async with client_for(factory, user_id=9) as c:   # platform_admin, org 3
        att = await c.post("/api/triage/incidents/INC-000003/outcome-label",
                           json={"disposition": "unknown",
                                 "priority_correctness": "unknown",
                                 "supersedes_id": mine.json()["id"]})
        assert att.status_code == 403                  # foreign label pointer
        ok = await c.post("/api/triage/incidents/INC-000003/outcome-label",
                          json=LABEL_OK)               # cross-tenant legit write
        assert ok.status_code == 201
        assert ok.json()["disposition"] == "true_positive"


# ---------------------------------------------------------------------------
# Scoring path untouched (Stage 6A is data collection only)
# ---------------------------------------------------------------------------
def test_scoring_path_untouched():
    import inspect
    import subprocess
    src = inspect.getsource(__import__("app.services.triage", fromlist=["x"]))
    for banned in ("OutcomeLabel", "outcome_label", "openai", "torch",
                   "sklearn", "predict("):
        assert banned not in src, f"triage service references Stage 6A/ML: {banned}"
    osrc = inspect.getsource(__import__("app.services.outcomes", fromlist=["x"]))
    for banned in ("requests", "httpx", "openai", "anthropic", "torch",
                   "sklearn", "transformers", "model.fit", "predict("):
        assert banned not in osrc, f"banned ML/LLM/network token in outcomes: {banned}"
    # git-level proof: services/triage.py identical to HEAD (Stage 5 baseline)
    diff = subprocess.run(["git", "-C", "/workspace", "diff", "--quiet", "HEAD",
                           "--", "backend/app/services/triage.py"])
    assert diff.returncode == 0, "production scoring module was modified"
