"""STAGE 6D — ML feasibility gate: unit + integration tests.

Run from backend/:
  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_ml_feasibility.py -p no:libtmux -q

Covers the Stage 6D acceptance criteria:
  * gates G1-G7 compute MEASURED values from live rows (no fabricated passes)
  * empty corpus -> NOT_READY with every data-dependent gate failing
  * fixture corpus (8 labels, 1 tenant) -> NOT_READY; volume/diversity/time
    gates fail with correct measured numbers and actionable next steps
  * pure logic tested via monkeypatched baseline_report so pass-path math is
    exercised without inventing a 300-label DB corpus
  * read-only guarantee: assess_feasibility performs no writes
  * router authz/tenancy/validation mirrors the 6C baseline-report endpoint
  * structural guard: module source contains no training/LLM tokens
"""
from __future__ import annotations

import inspect
import os
import re as _re
import sys

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from sqlalchemy import func, select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.models import AuditLog, OutcomeLabel, TriageEvaluation  # noqa: E402
from app.services import ml_feasibility as mf  # noqa: E402
from app.services.ml_feasibility import assess_feasibility  # noqa: E402

from tests.test_baseline_eval import (  # noqa: E402,F401
    client_for, factory, seed_acme_corpus, _triage_and_label)

pytestmark = pytest.mark.asyncio


def _synthetic_rep(validated=350, pos=120, neg=230, reliable=True,
                   ci=(0.86, 0.97), tenants=3, cats=("malware", "phishing",
                                                     "intrusion", "policy_violation"),
                   span_days=95.0):
    """Hand-built baseline_report shape for pure-logic pass-path testing."""
    tp = int(pos * 0.9)
    fn = pos - tp
    fp = int(neg * 0.05)
    tn = neg - fp
    return {
        "corpus": {"validated": validated, "unknown_disposition": 10,
                   "untriaged_excluded": 0, "unique_tenants": tenants,
                   "categories": list(cats), "time_span_days": span_days},
        "metrics_p1_vs_rest": {"tp": tp, "fp": fp, "fn": fn, "tn": tn,
                               "reliable": reliable, "precision_ci95": list(ci)},
    }


class _Head:
    def __init__(self, uid, disp, prio, created):
        self.incident_uid, self.disposition = uid, disp
        self.priority_labeled_at, self.created_at = prio, created


async def _all_pass_env(monkeypatch, tmp=None):
    """Patch assess_feasibility's collaborators to an all-gates-pass world
    built from hand-specified objects (pure logic test, no DB needed)."""
    from datetime import datetime, timedelta, timezone
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    heads = []
    uids = []
    for i in range(120):
        uid = f"INC-T{i:04d}"
        heads.append(_Head(uid, "true_positive", "p1", base))
        uids.append((i % 3 or 1, ["malware", "phishing", "intrusion",
                                  "policy_violation"][i % 4], uid))
    for i in range(230):
        uid = f"INC-F{i:04d}"
        heads.append(_Head(uid, "false_positive", "p3", base + timedelta(days=95)))
        uids.append(((i % 3) + 1, ["malware", "phishing", "intrusion",
                                   "other"][i % 4], uid))
    heads.append(_Head("INC-U1", "unknown", "p4", base))
    sup_ids = [None] * len(heads)          # no corrections in this world

    async def fake_report(db, *, org_id, window_days=None):
        return _synthetic_rep()

    async def fake_heads(db, org_id):
        return heads

    async def fake_incidents(db, stmt):
        class R:
            def __init__(self, rows): self._rows = rows
            def all(self):
                return [type("Row", (), {"org_id": o, "category": c, "uid": u})
                        for o, c, u in self._rows]
        # org scoping is irrelevant here: the test calls with org_id=None
        return R(list(uids))

    async def fake_sup(db, stmt):
        class R:
            def __init__(self, rows): self._rows = rows
            def all(self): return list(self._rows)   # 1-tuples, like Row.all()
        return R([(s,) for s in sup_ids])

    async def fake_exec(st):
        txt = str(st)
        if "supersedes_id" in txt and "outcome_labels" in txt:
            return await fake_sup(None, st)
        return await fake_incidents(None, st)

    monkeypatch.setattr(mf, "baseline_report", fake_report)
    monkeypatch.setattr(mf, "_head_labels", fake_heads)
    db = type("FakeDB", (), {"execute": staticmethod(fake_exec)})()
    return db, heads


# ---------------------------------------------------------------------------
# Pure-logic: pass path (hand-built worlds, thresholds are policy estimates)
# ---------------------------------------------------------------------------
async def test_all_gates_pass_verdict_ready(monkeypatch):
    db, heads = await _all_pass_env(monkeypatch)
    out = await assess_feasibility(db, org_id=None)
    assert out["verdict"] == "READY_FOR_SHADOW_DESIGN"
    assert out["failing_gates"] == []
    g = out["gates"]
    assert g["G1_volume"]["measured"] == 350 and g["G1_volume"]["pass"]
    assert g["G2_balance"]["minority_n"] == 120 and g["G2_balance"]["pass"]
    assert g["G3_diversity"]["tenants"] >= 2 and g["G3_diversity"]["pass"]
    assert g["G4_time_span"]["span_days"] >= 60
    assert g["G5_label_noise"]["unknown_rate"] <= 0.25
    assert g["G6_measurable_baseline"]["ci_half_width_precision"] <= 0.15
    assert g["G7_leakage_integrity"]["orphan_validated_labels"] == 0
    assert any("proceed to Stage 6E" in s
               for s in out["minimum_additional_data_needed"])


async def test_orphan_label_fails_g7_only(monkeypatch):
    db, heads = await _all_pass_env(monkeypatch)
    heads[0].priority_labeled_at = None      # TP label with no frozen snapshot
    out = await assess_feasibility(db, org_id=None)
    assert out["verdict"] == "NOT_READY"
    assert out["failing_gates"] == ["G7_leakage_integrity"]
    assert out["gates"]["G7_leakage_integrity"]["orphan_validated_labels"] == 1


async def test_wide_ci_fails_g6(monkeypatch):
    db, _ = await _all_pass_env(monkeypatch)
    orig = mf.baseline_report

    async def wide(db_, *, org_id, window_days=None):
        rep = await orig(db_, org_id=org_id, window_days=window_days)
        rep["metrics_p1_vs_rest"]["precision_ci95"] = [0.4, 0.99]
        return rep
    monkeypatch.setattr(mf, "baseline_report", wide)
    out = await assess_feasibility(db, org_id=None)
    assert "G6_measurable_baseline" in out["failing_gates"]


# ---------------------------------------------------------------------------
# Integration: real fixtures must report honest NOT_READY
# ---------------------------------------------------------------------------
async def test_empty_db_is_not_ready_no_fabrication(factory):
    async with factory() as s:
        out = await assess_feasibility(s, org_id=1)
    assert out["verdict"] == "NOT_READY"
    assert out["read_only"] is True and out["ai_assist_used"] is False
    g = out["gates"]
    assert g["G1_volume"]["measured"] == 0 and not g["G1_volume"]["pass"]
    assert g["G2_balance"]["minority_n"] is None and not g["G2_balance"]["pass"]
    assert g["G5_label_noise"]["unknown_rate"] is None   # no labels -> None, not 0
    assert not g["G7_leakage_integrity"]["pass"]         # total_heads == 0
    assert len(out["failing_gates"]) >= 5


async def test_fixture_corpus_measured_not_ready(factory):
    await seed_acme_corpus(factory)
    async with factory() as s:
        out = await assess_feasibility(s, org_id=1)
    assert out["verdict"] == "NOT_READY"
    g = out["gates"]
    # measured from the 6C fixture: 7 validated TP/FP head labels, 1 tenant
    assert g["G1_volume"]["measured"] == 7
    assert g["G3_diversity"]["tenants"] == 1
    assert g["G4_time_span"]["span_days"] < 60
    assert g["G5_label_noise"]["unknown_rate"] == round(1 / 8, 4)
    assert not g["G1_volume"]["pass"] and not g["G3_diversity"]["pass"] \
        and not g["G4_time_span"]["pass"] and not g["G6_measurable_baseline"]["pass"]
    steps = " ".join(out["minimum_additional_data_needed"])
    assert "more validated" in steps and "walk-forward" in steps
    # recommended target present but gated behind NOT_READY
    assert out["recommended_target"]["task"].startswith("binary prioritization")


async def test_assessment_is_strictly_read_only(factory):
    await seed_acme_corpus(factory)
    async with factory() as s:
        before = {
            "labels": (await s.execute(select(func.count()).select_from(OutcomeLabel))).scalar(),
            "evals": (await s.execute(select(func.count()).select_from(TriageEvaluation))).scalar(),
            "audits": (await s.execute(select(func.count()).select_from(AuditLog))).scalar(),
        }
        await assess_feasibility(s, org_id=None)
        after = {
            "labels": (await s.execute(select(func.count()).select_from(OutcomeLabel))).scalar(),
            "evals": (await s.execute(select(func.count()).select_from(TriageEvaluation))).scalar(),
            "audits": (await s.execute(select(func.count()).select_from(AuditLog))).scalar(),
        }
    assert before == after


# ---------------------------------------------------------------------------
# Router: authz, tenancy scoping, validation
# ---------------------------------------------------------------------------
async def test_endpoint_authz_window_and_tenant_scope(factory):
    await seed_acme_corpus(factory)
    await _triage_and_label(factory, "INC-000101", "true_positive", "correct",
                            reviewer="foreign-analyst@for.io")
    async with client_for(factory, None) as c:
        assert (await c.get("/api/triage/labels/ml-feasibility")).status_code in (401, 403)
    async with client_for(factory, 1) as c:                     # client_admin org 1
        r = await c.get("/api/triage/labels/ml-feasibility")
        assert r.status_code == 200
        body = r.json()
        assert body["scope_org_id"] == 1
        # foreign tenant's single label must not leak into tenant scope
        assert body["gates"]["G3_diversity"]["tenants"] == 1
        bad = await c.get("/api/triage/labels/ml-feasibility?window_days=0")
        assert bad.status_code == 422
        bad2 = await c.get("/api/triage/labels/ml-feasibility?window_days=99999")
        assert bad2.status_code == 422
    async with client_for(factory, 9) as c:                     # platform_admin
        r = await c.get("/api/triage/labels/ml-feasibility")
        assert r.status_code == 200
        assert r.json()["scope_org_id"] is None
        assert r.json()["gates"]["G3_diversity"]["tenants"] == 2


def test_structural_guard_no_training_tokens():
    src = inspect.getsource(mf)
    lines = [l.split("#", 1)[0] for l in src.splitlines()]
    code_only = _re.sub(r"(?s)^\s*\"\"\".*?\"\"\"", "", "\n".join(lines),
                        flags=_re.MULTILINE)
    low = code_only.lower()
    for forbidden in ("db.add", "commit(", "insert(", "delete(", ".update(",
                      "sklearn", "tensorflow", "torch", "lightgbm", "xgboost",
                      "openai", "fit(", "predict("):
        assert forbidden not in low, f"ml_feasibility must be read-only/no-training: {forbidden}"
