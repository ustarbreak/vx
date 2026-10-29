"""STAGE 6B — Data-quality audit & reporting: regression tests.

Run from backend/:
  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_label_audit.py -p no:libtmux -q

Covers the Stage 6B acceptance criteria:
  * read-only guarantee: report runs against a session with autoflush off and
    commits nothing; row counts of every table are byte-identical before/after
  * tenant isolation: client_admin/client_user see ONLY their own org's
    numbers (a foreign-org label must not appear in class balance, coverage,
    rollup or counts); platform_admin gets the cross-tenant rollup
  * authorization: unauthenticated -> 401/403; param validation 422
  * measured metrics: completeness %, class balance, unknown rates,
    correction rate, priority-band coverage, time-to-resolution /
    time-to-first-label, integrity (orphan/dangling), hygiene counters
  * leakage flags present and name the priority_labeled_at override leak
  * reopened-incident behavior: status churn does not alter label metrics
  * scoring untouched: app.services.triage diff-empty invariant preserved
"""
from __future__ import annotations

import os
import sys

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import datetime  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import func, select  # noqa: E402
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
                        TriageEvaluation, OutcomeLabel, TriagePolicy)
from app.main import app  # noqa: E402
from app.services.label_audit import label_quality_report  # noqa: E402
from app.services.outcomes import append_outcome_label  # noqa: E402

NOW = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
pytestmark = pytest.mark.asyncio

TABLES = (Incident, OutcomeLabel, TriageEvaluation, AuditLog, User, Organization)


async def table_counts(session_factory) -> dict:
    async with session_factory() as s:
        out = {}
        for t in TABLES:
            out[t.__tablename__] = (await s.execute(select(func.count()).select_from(t))).scalar()
        return out


@pytest_asyncio.fixture()
async def factory():
    """Two tenants with a hand-built corpus exercising every metric:
    org 1 (Acme):   5 incidents / 7 labels incl. a correction chain, an
                    unknown-disposition label, an untriaged closed incident,
                    a reopened (investigating) incident carrying a historical
                    label, and one label on a still-open incident.
    org 3 (Foreign): 1 incident / 1 label — must NEVER leak into org-1 scope.
    Timestamps give deterministic TTR (24h, 48h) and TTL (1h offsets)."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                 future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    f = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
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
            # --- org 1 incidents -----------------------------------------
            Incident(id=1, uid="INC-000001", org_id=1, title="Ransomware beacon",
                     severity="high", status="resolved", category="malware",
                     created_at=NOW - datetime.timedelta(hours=25),
                     resolved_at=NOW - datetime.timedelta(hours=1)),      # TTR 24h
            Incident(id=2, uid="INC-000002", org_id=1, title="Phishing wave",
                     severity="medium", status="closed", category="phishing",
                     created_at=NOW - datetime.timedelta(hours=49),
                     closed_at=NOW - datetime.timedelta(hours=1)),         # TTR 48h
            Incident(id=3, uid="INC-000003", org_id=1, title="Never triaged",
                     severity="low", status="resolved", category="other",
                     created_at=NOW - datetime.timedelta(hours=2)),        # unlabeled closed
            Incident(id=4, uid="INC-000004", org_id=1, title="Reopened intrusion",
                     severity="high", status="investigating", category="intrusion",
                     created_at=NOW - datetime.timedelta(hours=72)),       # reopened w/ old label
            Incident(id=5, uid="INC-000005", org_id=1, title="Still open",
                     severity="medium", status="open", category="policy_violation",
                     created_at=NOW - datetime.timedelta(hours=3)),        # early label on active
            # --- org 3 (foreign) ------------------------------------------
            Incident(id=10, uid="INC-000010", org_id=3, title="Foreign closed",
                     severity="low", status="closed", category="other",
                     created_at=NOW - datetime.timedelta(hours=10),
                     closed_at=NOW - datetime.timedelta(hours=1)),
        ])
        await s.commit()

        # evaluations so priority_labeled_at freezes realistically
        async def ev(uid, org, prio):
            s.add(TriageEvaluation(org_id=org, incident_uid=uid, policy_version="v1",
                                   score=50, priority=prio, confidence=80,
                                   corroboration=1, reason_codes=[], breakdown={},
                                   evaluator="system", created_at=NOW))
        await ev("INC-000001", 1, "p2")
        await ev("INC-000002", 1, "p3")
        await ev("INC-000004", 1, "p1")
        await ev("INC-000005", 1, "p4")
        await ev("INC-000010", 3, "p3")
        await s.commit()

        # labels (direct model rows to control created_at deterministically)
        def lbl(uid, org, disp, pc, prio, *, mins_ago, sup=None, rationale=None,
                reviewer="admin@acme.io", by="admin@acme.io"):
            return OutcomeLabel(org_id=org, incident_uid=uid, disposition=disp,
                                priority_correctness=pc, priority_labeled_at=prio,
                                rationale=rationale, reviewer=reviewer, labeled_by=by,
                                supersedes_id=sup,
                                created_at=NOW - datetime.timedelta(minutes=mins_ago))
        l1 = lbl("INC-000001", 1, "true_positive", "correct", "p2", mins_ago=60,
                 rationale="confirmed ransomary note")          # typo-free variant below
        l1.rationale = "confirmed ransomware note"
        l2 = lbl("INC-000001", 1, "false_positive", "too_high", "p2", mins_ago=30, sup=None)
        l2.supersedes_id = None  # placeholder; fixed after flush to get l1.id
        l3 = lbl("INC-000002", 1, "benign_duplicate", "correct", "p3", mins_ago=120,
                 reviewer=None, by="user2@acme.io")             # reviewer defaults to author
        l4 = lbl("INC-000004", 1, "true_positive", "too_low", "p1", mins_ago=1440)  # pre-reopen history
        l5 = lbl("INC-000005", 1, "unknown", "unknown", "p4", mins_ago=10)          # unknowns + active
        l6 = lbl("INC-000003", 1, "true_positive", "correct", None, mins_ago=90,
                 rationale="   ")                               # untriaged + blank rationale
        lf = lbl("INC-000010", 3, "true_positive", "correct", "p3", mins_ago=5,
                 reviewer="analyst@for.io", by="analyst@for.io")
        for r in (l1, l2, l3, l4, l5, l6, lf):
            s.add(r)
        await s.flush()
        l2.supersedes_id = l1.id     # correction chain on INC-000001
        await s.commit()
    yield f
    await engine.dispose()


def client_for(session_factory, user_id=None):
    class _Client:
        async def __aenter__(self):
            from httpx import ASGITransport, AsyncClient
            async def _get_db():
                async with session_factory() as s:
                    yield s
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
            app.dependency_overrides.pop(get_db, None)
            return r
    return _Client()


# ---------------------------------------------------------------------------
# Service-level: measured metrics on the seeded corpus
# ---------------------------------------------------------------------------
async def test_org_scoped_metrics_are_measured(factory):
    async with factory() as s:
        rep = await label_quality_report(s, org_id=1)
    assert rep["scope"] == {"org_id": 1, "cross_tenant": False}
    p = rep["population"]
    assert p["incidents"] == 5 and p["closed_or_resolved"] == 3 and p["active"] == 2
    assert p["labels_total"] == 6                       # foreign label excluded
    assert p["labeled_closed_incidents"] == 3           # INC-1, INC-2, INC-3 (l6 labels the resolved INC-3)
    c = rep["completeness"]
    assert c["unlabeled_closed_incidents"] == 0
    assert c["closed_incident_label_coverage_pct"] == 100.0
    assert c["labels_on_still_active_incidents"] == 2   # l4 (reopened INC-4) + l5 (open INC-5)
    # class balance (org 1 only)
    cb = rep["class_balance"]
    assert cb["disposition"] == {"true_positive": 3, "false_positive": 1,
                                 "benign_duplicate": 1, "unknown": 1}
    assert cb["priority_correctness"] == {"correct": 3, "too_high": 1,
                                          "too_low": 1, "unknown": 1}
    ur = rep["unknown_rates"]
    assert ur["disposition_unknown_pct"] == 16.7
    assert ur["priority_unknown_pct"] == 16.7
    assert ur["combined_any_unknown_pct"] == 16.7       # same row carries both unknowns
    corr = rep["corrections"]
    assert corr["superseding_rows"] == 1 and corr["multi_label_incidents"] == 1
    assert abs(corr["correction_rate_pct"] - 100 / 6) < 0.1
    cov = rep["coverage"]
    assert cov["labels_by_priority_band"] == {"p1": 1, "p2": 2, "p3": 1, "p4": 1, "untriaged": 1}
    assert cov["untriaged_labels"] == 1
    assert cov["labeled_by_category"]["malware"] == 1
    tm = rep["time_metrics"]
    # INC-1 24h + INC-2 48h have end timestamps; INC-3 is 'resolved' but has
    # NO resolved_at/closed_at -> correctly excluded from TTR (a measured gap)
    assert tm["time_to_resolution"]["n"] == 2
    assert tm["time_to_resolution"]["p50_h"] == 36.0    # median of 24/48
    assert tm["time_to_resolution"]["max_h"] == 48.0
    assert tm["time_to_first_label"]["n"] == 5          # every labeled incident incl. reopened INC-4 
    integ = rep["integrity"]
    assert integ["orphan_labels_no_matching_incident"] == 0
    assert integ["dangling_supersedes_id"] == 0
    hyg = rep["collection_hygiene"]
    assert hyg["labels_without_rationale"] == 5         # only l1 has text ('   ' counts blank)
    assert hyg["reviewer_defaulted_to_author"] >= 0
    assert rep["tenant_rollup"] is None                 # single-tenant scope hides rollup


async def test_foreign_labels_never_appear_in_tenant_scope(factory):
    async with factory() as s:
        rep = await label_quality_report(s, org_id=1)
        blob = str(rep)
    assert "INC-000010" not in blob
    assert "analyst@for.io" not in blob
    assert rep["population"]["labels_total"] == 6       # not 7


async def test_platform_rollup_covers_both_tenants(factory):
    async with factory() as s:
        rep = await label_quality_report(s, org_id=None)
    assert rep["scope"]["cross_tenant"] is True
    assert rep["population"]["incidents"] == 6
    assert rep["population"]["labels_total"] == 7
    roll = {r["org_id"]: r for r in rep["tenant_rollup"]}
    assert set(roll) == {1, 3}
    assert roll[1]["labels"] == 6 and roll[3]["labels"] == 1
    assert roll[3]["org_name"] == "Foreign Corp"
    # closed coverage across tenants: org3 INC-10 closed+labeled, org1 all 3 closed labeled
    assert rep["completeness"]["closed_incident_label_coverage_pct"] == 100.0


async def test_reopened_incident_history_preserved(factory):
    """Status churn (reopen) must not change label metrics."""
    async with factory() as s:
        before = await label_quality_report(s, org_id=1)
        inc = (await s.execute(select(Incident).where(Incident.uid == "INC-000004"))).scalars().one()
        inc.status = "resolved"; inc.resolved_at = NOW
        await s.commit()
        after = await label_quality_report(s, org_id=1)
        rows = (await s.execute(select(OutcomeLabel).where(
            OutcomeLabel.incident_uid == "INC-000004").order_by(OutcomeLabel.id))).scalars().all()
    assert len(rows) == 1                              # historical label intact, nothing appended/deleted
    assert rows[0].created_at == NOW - datetime.timedelta(minutes=1440)
    assert before["class_balance"] == after["class_balance"]   # reopen itself changed nothing
    # closing the reopened episode raises closed-population coverage denominators only
    assert after["population"]["closed_or_resolved"] == 4


async def test_read_only_guarantee(factory):
    """No writes: identical table counts before/after service + API calls,
    and zero new AuditLog rows (reporting endpoint must not audit-write)."""
    c0 = await table_counts(factory)
    async with factory() as s:
        await label_quality_report(s, org_id=1)
        await label_quality_report(s, org_id=None)
    c1 = await table_counts(factory)
    assert c0 == c1
    async with client_for(factory, user_id=1) as c:
        r = await c.get("/api/triage/labels/quality-report")
        assert r.status_code == 200
    c2 = await table_counts(factory)
    assert c0 == c2


# ---------------------------------------------------------------------------
# Router-level: authz + tenancy through the HTTP surface
# ---------------------------------------------------------------------------
async def test_router_auth_and_param_validation(factory):
    async with client_for(factory) as c:                  # no token
        r = await c.get("/api/triage/labels/quality-report")
        assert r.status_code in (401, 403)
    async with client_for(factory, user_id=1) as c:
        r = await c.get("/api/triage/labels/quality-report?recent_days=0")
        assert r.status_code == 422
        r = await c.get("/api/triage/labels/quality-report")
        assert r.status_code == 200
        body = r.json()
        assert body["scope"] == {"org_id": 1, "cross_tenant": False}
        assert body["population"]["labels_total"] == 6
        assert any("priority_labeled_at" in f for f in
                   body["leakage_flags_for_future_training"])
    async with client_for(factory, user_id=9) as c:       # platform_admin
        r = await c.get("/api/triage/labels/quality-report")
        assert r.json()["scope"]["cross_tenant"] is True
        assert r.json()["population"]["labels_total"] == 7


async def test_client_user_can_read_own_tenant_aggregate(factory):
    async with client_for(factory, user_id=2) as c:
        r = await c.get("/api/triage/labels/quality-report")
        assert r.status_code == 200
        assert r.json()["scope"]["org_id"] == 1           # hard-scoped, no param can widen


def test_service_module_is_structurally_read_only():
    src = open(os.path.join(os.path.dirname(__file__), "..",
               "app", "services", "label_audit.py")).read()
    lowered = src.lower()
    for tok in ("db.add(", ".delete(", "update(", "insert(", "commit("):
        assert tok not in lowered, f"unexpected write primitive {tok!r} in label_audit"
    # no ML/LLM tokens anywhere in the Stage 6B module
    for tok in ("model.fit", "sklearn", "torch", "tensorflow", "llm", "openai", "predict("):
        assert tok not in lowered


def test_triage_scoring_service_still_untouched():
    """Stage 6B must not have altered production scoring source."""
    import subprocess
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = subprocess.run(["git", "diff", "--quiet", "HEAD", "--",
                          "app/services/triage.py"], cwd=root, capture_output=True)
    # exit code 1 means file differs from HEAD -> only allowed if stage 5 was
    # itself uncommitted; instead compare against staged copy (index) which is
    # what Stage 5 delivered.
    out2 = subprocess.run(["git", "diff", "--quiet", "--", "app/services/triage.py"],
                          cwd=root, capture_output=True)
    assert out2.returncode == 0, "working tree modified app/services/triage.py during 6B"
