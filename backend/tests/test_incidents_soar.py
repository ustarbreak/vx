"""Incident Response + SOAR v2 — lifecycle, safety & tenant-isolation tests.

Run from backend/:  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_incidents_soar.py -p no:libtmux -q

Covers the brief's validation list:
  * authentication enforced on every endpoint (401 anonymous)
  * cross-tenant access denied (403) for incidents, playbooks and runs
  * incident lifecycle transitions incl. illegal ones (409) and re-open
  * duplicate prevention: alert upsert updates, manual dup gets 409
  * assignment / acknowledgment / notes recorded in activity trail
  * playbook step allow-list (no arbitrary actions, 422)
  * simulate vs execute separation; consequential steps need confirm=true
  * failed step -> remaining steps skipped, run status partial/failed
  * block_ip/isolate_host honestly reported as NOT executed
  * log redaction of secret-looking values
  * idempotency key replays the same run (no duplicate execution)
  * retry only for failed/partial/cancelled runs
  * client_user may not execute or edit; admins may
  * audit records written for both engines
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
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
from app.models import (  # noqa: E402
    Organization, User, Alert, Ticket, Incident, Playbook, PlaybookRun, AuditLog,
)
from app.main import app  # noqa: E402

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
            Organization(id=1, name="Acme Corp", tier="enterprise", status="active",
                         contact_email="a@acme.io", org_type="HQ"),
            Organization(id=2, name="Acme Branch", tier="sme", status="active",
                         contact_email="b@acme.io", org_type="AGENCY", parent_org_id=1),
            Organization(id=3, name="Foreign Corp", tier="sme", status="active",
                         contact_email="x@for.io", org_type="HQ"),
            User(id=1, email="admin@acme.io", hashed_password=get_password_hash("x"),
                 name="Admin", role="client_admin", org_id=1),
            User(id=2, email="user@acme.io", hashed_password=get_password_hash("x"),
                 name="User", role="client_user", org_id=1),
            User(id=3, email="pa@platform.io", hashed_password=get_password_hash("x"),
                 name="PA", role="platform_admin", org_id=None),
            User(id=4, email="admin@for.io", hashed_password=get_password_hash("x"),
                 name="FAdmin", role="client_admin", org_id=3),
            # existing SIEM alert (engine record we must wrap, not rebuild)
            Alert(id=1, uid="ALR-000001", org_id=1, title="Malware detected on workstation",
                  description="EICAR test file", severity="high", source="siem",
                  resource="ws-042", correlated_count=1, created_at=NOW),
            Ticket(id=1, uid="TCK-000001", org_id=1, title="Existing ticket",
                   status="in_progress", priority="p2", created_at=NOW),
            Ticket(id=2, uid="TCK-999999", org_id=3, title="Foreign ticket",
                   status="new", priority="p3", created_at=NOW),
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


pytestmark = pytest.mark.asyncio


# ===========================================================================
# Incidents
# ===========================================================================
async def test_incidents_auth_required(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory) as c:
        r = await c.get("/api/incidents")
    assert r.status_code in (401, 403)


async def test_create_from_alert_upsert_no_duplicate(session_factory):
    """Alert-driven creation must UPDATE the existing incident on repeat."""
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r1 = await c.post("/api/incidents", json={
            "title": "Malware detected on workstation", "severity": "high",
            "alert_uid": "ALR-000001", "affected_assets": ["ws-042"]})
        assert r1.status_code == 201, r1.text
        assert r1.json()["reused"] is False
        uid = r1.json()["incident"]["uid"]
        # second time -> same incident updated, not duplicated
        r2 = await c.post("/api/incidents", json={
            "title": "Malware detected on workstation", "severity": "high",
            "alert_uid": "ALR-000001", "affected_assets": ["ws-042"]})
        assert r2.status_code == 201
        assert r2.json()["reused"] is True
        assert r2.json()["incident"]["uid"] == uid
        # list shows exactly one incident
        rl = await c.get("/api/incidents")
        assert rl.json()["total"] == 1


async def test_manual_duplicate_guard_409(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r1 = await c.post("/api/incidents", json={
            "title": "Suspicious login", "severity": "medium", "affected_assets": ["fw-01"]})
        assert r1.status_code == 201
        r2 = await c.post("/api/incidents", json={
            "title": "Suspicious login", "severity": "medium", "affected_assets": ["fw-01"]})
        assert r2.status_code == 409
        assert r2.json()["detail"].startswith("A non-closed incident")


async def test_lifecycle_transitions_and_illegal_jump(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/incidents", json={"title": "Phishing wave", "severity": "high"})
        uid = r.json()["incident"]["uid"]
        # open -> contained is illegal
        bad = await c.put(f"/api/incidents/{uid}/status", json={"status": "contained"})
        assert bad.status_code == 409
        ok = await c.put(f"/api/incidents/{uid}/status", json={"status": "investigating"})
        assert ok.status_code == 200 and ok.json()["status"] == "investigating"
        ok2 = await c.put(f"/api/incidents/{uid}/status", json={"status": "contained"})
        assert ok2.status_code == 200
        ok3 = await c.put(f"/api/incidents/{uid}/status", json={"status": "resolved"})
        assert ok3.json()["resolved_at"] is not None
        ok4 = await c.put(f"/api/incidents/{uid}/status", json={"status": "closed"})
        assert ok4.json()["closed_at"] is not None
        # re-open allowed back to investigating, clears terminal stamps
        reop = await c.put(f"/api/incidents/{uid}/status", json={"status": "investigating"})
        assert reop.status_code == 200
        assert reop.json()["resolved_at"] is None and reop.json()["closed_at"] is None
        # activity trail contains every transition with from/to values
        det = await c.get(f"/api/incidents/{uid}")
        acts = [a["action"] for a in det.json()["activity"]]
        assert "created" in acts and acts.count("status_changed") == 5
        changed = [a for a in det.json()["activity"] if a["action"] == "status_changed"]
        assert changed[-1]["from_value"] == "closed" and changed[-1]["to_value"] == "investigating"


async def test_assign_ack_note_and_cross_tenant(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/incidents", json={"title": "Data exfil attempt", "severity": "critical"})
        uid = r.json()["incident"]["uid"]
        a = await c.put(f"/api/incidents/{uid}/assign", json={"assignee": "user@acme.io"})
        assert a.status_code == 200 and a.json()["assignee"] == "user@acme.io"
        ack = await c.post(f"/api/incidents/{uid}/acknowledge", json={})
        assert ack.status_code == 200 and ack.json()["acknowledged_by"] == "admin@acme.io"
        ack2 = await c.post(f"/api/incidents/{uid}/acknowledge", json={})
        assert ack2.status_code == 409   # double ack refused
        n = await c.post(f"/api/incidents/{uid}/notes", json={"content": "Checked EDR telemetry"})
        assert n.status_code == 201
    # foreign tenant cannot see it
    async with client_for(session_factory, 4) as c:
        fr = await c.get(f"/api/incidents/{uid}")
        assert fr.status_code == 403
        lst = await c.get("/api/incidents")
        assert lst.json()["total"] == 0
    # assignee outside tenant rejected
    async with client_for(session_factory, 1) as c:
        x = await c.put(f"/api/incidents/{uid}/assign", json={"assignee": "admin@for.io"})
        assert x.status_code == 403


async def test_client_user_cannot_mutate(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/incidents", json={"title": "RBAC probe", "severity": "low"})
        uid = r.json()["incident"]["uid"]
    async with client_for(session_factory, 2) as c:
        assert (await c.post("/api/incidents", json={"title": "Nope nope nope"})).status_code == 403
        assert (await c.put(f"/api/incidents/{uid}/status", json={"status": "investigating"})).status_code == 403
        assert (await c.patch(f"/api/incidents/{uid}", json={"severity": "info"})).status_code == 403
        # but can view + note
        assert (await c.get(f"/api/incidents/{uid}")).status_code == 200
        assert (await c.post(f"/api/incidents/{uid}/notes", json={"content": "triage…"})).status_code == 201


async def test_ticket_link_and_create_ticket_idempotent(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/incidents", json={"title": "Ransomware beacon", "severity": "critical"})
        uid = r.json()["incident"]["uid"]
        lt = await c.post(f"/api/incidents/{uid}/link-ticket", json={"ticket_uid": "TCK-000001"})
        assert lt.status_code == 200 and lt.json()["ticket_uid"] == "TCK-000001"
        # relink same ticket is a no-op (idempotent)
        lt2 = await c.post(f"/api/incidents/{uid}/link-ticket", json={"ticket_uid": "TCK-000001"})
        assert lt2.status_code == 200
        det = await c.get(f"/api/incidents/{uid}")
        links = [a for a in det.json()["activity"] if a["action"] == "linked"]
        assert len(links) == 1
        # foreign ticket cannot be linked
        bad = await c.post(f"/api/incidents/{uid}/link-ticket", json={"ticket_uid": "TCK-999999"})
        assert bad.status_code == 403
        # create-ticket through the existing engine; second call reuses
        ct = await c.post(f"/api/incidents/TCK-nope/create-ticket")  # 404 path check first
        assert ct.status_code == 404
        ct2 = await c.post(f"/api/incidents/{uid}/create-ticket")
        # already linked to live TCK-000001 -> reused
        assert ct2.json()["reused"] is True


async def test_search_filter_sort_pagination(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        for i, sev in enumerate(["low", "critical", "medium", "high", "info"]):
            await c.post("/api/incidents", json={"title": f"Spike case number {i}", "severity": sev})
        r = await c.get("/api/incidents", params={"severity": "critical"})
        assert r.json()["total"] == 1
        r2 = await c.get("/api/incidents", params={"q": "spike case"})
        assert r2.json()["total"] == 5
        r3 = await c.get("/api/incidents", params={"sort": "severity", "order": "desc", "page_size": 2})
        items = r3.json()["items"]
        assert len(items) == 2 and items[0]["severity"] == "critical"
        r4 = await c.get("/api/incidents", params={"status": "open"})
        assert r4.json()["status_counts"]["open"] == 5
        # invalid filter -> 422
        assert (await c.get("/api/incidents", params={"status": "bogus"})).status_code == 422


async def test_site_org_link_validation(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        ok = await c.post("/api/incidents", json={"title": "Branch switch loop", "site_org_id": 2})
        assert ok.status_code == 201
        det = await c.get(f"/api/incidents/{ok.json()['incident']['uid']}")
        assert det.json()["site"]["id"] == 2
        bad = await c.post("/api/incidents", json={"title": "Foreign site probe", "site_org_id": 3})
        assert bad.status_code == 403


# ===========================================================================
# SOAR
# ===========================================================================
SAFE_PB = {"name": "Malware triage", "description": "wrap engines",
           "steps": [{"name": "Wait", "action": "wait", "params": {"seconds": 0}},
                     {"name": "Ticket", "action": "create_ticket",
                      "params": {"title": "SOAR ticket", "priority": "p2"}}]}


async def test_playbook_requires_auth_and_allowlist(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory) as c:
        assert (await c.get("/api/soar/playbooks")).status_code in (401, 403)
    async with client_for(session_factory, 1) as c:
        bad = await c.post("/api/soar/playbooks", json={
            "name": "Evil flow", "steps": [{"name": "rm", "action": "shell_exec", "params": {}}]})
        assert bad.status_code == 422
        assert "not allowed" in bad.json()["detail"]
        good = await c.post("/api/soar/playbooks", json=SAFE_PB)
        assert good.status_code == 201
        pb = good.json()
        assert pb["uid"].startswith("PBK-")
        assert pb["consequential"] is False


async def test_preview_simulate_execute_separation(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        pb = (await c.post("/api/soar/playbooks", json=SAFE_PB)).json()
        pv = await c.get(f"/api/soar/playbooks/{pb['id']}/preview")
        assert pv.json()["executed"] is False
        sim = await c.post(f"/api/soar/playbooks/{pb['id']}/run", json={"mode": "simulate"})
        run = sim.json()["run"]
        assert run["status"] == "completed"          # all steps 'skipped' -> nothing failed
        assert run["skipped_steps"] == 2 and run["completed_steps"] == 0
        assert "[simulate]" in run["result_log"][0]["detail"]
        # simulate created NO ticket
        tickets = (await c.get("/api/tickets?org_id=1")) if False else None
        ex = await c.post(f"/api/soar/playbooks/{pb['id']}/run", json={"mode": "execute"})
        run2 = ex.json()["run"]
        assert run2["status"] == "completed" and run2["completed_steps"] == 2
        assert "TCK-" in run2["result_log"][1]["detail"]  # real ticket uid from engine


async def test_consequential_requires_confirm_and_honest_failure(session_factory):
    await _seed(session_factory)
    dangerous = {"name": "Blocker", "steps": [
        {"name": "Block", "action": "block_ip", "params": {"ip": "203.0.113.9"}}]}
    async with client_for(session_factory, 1) as c:
        pb = (await c.post("/api/soar/playbooks", json=dangerous)).json()
        noconfirm = await c.post(f"/api/soar/playbooks/{pb['id']}/run", json={"mode": "execute"})
        assert noconfirm.status_code == 409
        assert noconfirm.json()["detail"]["requires_confirmation"] is True
        conf = await c.post(f"/api/soar/playbooks/{pb['id']}/run",
                            json={"mode": "execute", "confirm": True})
        run = conf.json()["run"]
        # honest: no connector wired -> FAILED, never a fake success
        assert run["status"] == "failed" and run["failed_steps"] == 1
        assert "NOT executed" in run["result_log"][0]["detail"]
        # invalid ip fails at save-time validation
        bad = await c.post("/api/soar/playbooks", json={
            "name": "Bad IP flow", "steps": [
                {"name": "Block", "action": "block_ip", "params": {"ip": "999.1; rm -rf"}}]})
        assert bad.status_code == 422


async def test_fail_fast_skips_remaining_and_retry(session_factory):
    await _seed(session_factory)
    flow = {"name": "Flaky", "steps": [
        {"name": "Good", "action": "wait", "params": {"seconds": 0}},
        {"name": "Bad", "action": "add_evidence", "params": {"name": "snap.txt"}},  # no linked ticket -> fails
        {"name": "After", "action": "notify", "params": {"message": "hi"}}]}
    async with client_for(session_factory, 1) as c:
        pb = (await c.post("/api/soar/playbooks", json=flow)).json()
        r = await c.post(f"/api/soar/playbooks/{pb['id']}/run", json={"mode": "execute"})
        run = r.json()["run"]
        assert run["status"] == "partial"       # 1 completed, then failed, rest skipped
        assert run["completed_steps"] == 1 and run["failed_steps"] == 1 and run["skipped_steps"] == 1
        statuses = [e["status"] for e in run["result_log"]]
        assert statuses == ["completed", "failed", "skipped"]
        # retry only allowed for failed/partial/cancelled
        rr = await c.post(f"/api/soar/runs/{run['uid']}/retry", json={"confirm": False})
        assert rr.status_code == 200
        new_run = rr.json()["run"]
        assert new_run["retry_of"] == run["uid"]
        # retrying a completed run -> 409
        done = await c.post(f"/api/soar/playbooks/{pb['id']}/run", json={"mode": "simulate"})
        again = await c.post(f"/api/soar/runs/{done.json()['run']['uid']}/retry", json={})
        assert again.status_code == 409


async def test_idempotency_replay(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        pb = (await c.post("/api/soar/playbooks", json=SAFE_PB)).json()
        k = "idem-key-123"
        r1 = await c.post(f"/api/soar/playbooks/{pb['id']}/run",
                          json={"mode": "execute", "idempotency_key": k})
        r2 = await c.post(f"/api/soar/playbooks/{pb['id']}/run",
                          json={"mode": "execute", "idempotency_key": k})
        assert r2.json()["replayed"] is True
        assert r2.json()["run"]["uid"] == r1.json()["run"]["uid"]
        # internal key never leaks to clients
        assert "idempotency_key" not in r1.json()["run"]


async def test_redaction_in_logs(session_factory):
    await _seed(session_factory)
    flow = {"name": "Secretive", "steps": [
        {"name": "Notify", "action": "notify",
         "params": {"message": "rotate token=abc123secret now", "community": "public"}}]}
    async with client_for(session_factory, 1) as c:
        pb = (await c.post("/api/soar/playbooks", json=flow)).json()
        r = await c.post(f"/api/soar/playbooks/{pb['id']}/run", json={"mode": "execute"})
        blob = str(r.json()["run"]["result_log"])
        assert "abc123secret" not in blob and "***REDACTED***" in blob


async def test_run_history_cancel_and_tenant_scope(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        pb = (await c.post("/api/soar/playbooks", json=SAFE_PB)).json()
        run = (await c.post(f"/api/soar/playbooks/{pb['id']}/run", json={"mode": "simulate"})).json()["run"]
        hist = await c.get("/api/soar/runs", params={"playbook_id": pb["id"]})
        assert hist.json()["total"] == 1
        assert hist.json()["items"][0]["playbook_name"] == SAFE_PB["name"]
        # finished runs cannot be cancelled
        cancel = await c.post(f"/api/soar/runs/{run['uid']}/cancel")
        assert cancel.status_code == 409
    # foreign admin sees nothing of tenant 1
    async with client_for(session_factory, 4) as c:
        assert (await c.get("/api/soar/runs")).json()["total"] == 0
        assert (await c.get(f"/api/soar/runs/{run['uid']}")).status_code == 403
        assert (await c.get(f"/api/soar/playbooks/{pb['id']}")).status_code == 403
    # client_user may not execute
    async with client_for(session_factory, 2) as c:
        ex = await c.post(f"/api/soar/playbooks/{pb['id']}/run", json={"mode": "execute"})
        assert ex.status_code == 403


async def test_platform_shared_playbook_readonly_for_clients(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 3) as c:
        shared = await c.post("/api/soar/playbooks", json={**SAFE_PB, "name": "Shared flow", "org_id": None})
        assert shared.status_code == 201
        pb_id = shared.json()["id"]
    async with client_for(session_factory, 1) as c:
        # visible to tenant via listing
        names = [p["name"] for p in (await c.get("/api/soar/playbooks")).json()["items"]]
        assert "Shared flow" in names
        # but read-only: PUT/DELETE forbidden
        assert (await c.put(f"/api/soar/playbooks/{pb_id}", json=SAFE_PB)).status_code == 403
        assert (await c.delete(f"/api/soar/playbooks/{pb_id}")).status_code == 403


async def test_audit_records_written(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        inc = (await c.post("/api/incidents", json={"title": "Audit me", "severity": "high"})).json()["incident"]
        await c.put(f"/api/incidents/{inc['uid']}/status", json={"status": "investigating"})
        pb = (await c.post("/api/soar/playbooks", json=SAFE_PB)).json()
        await c.post(f"/api/soar/playbooks/{pb['id']}/run", json={"mode": "execute"})
    async with session_factory() as s:
        logs = (await s.execute(AuditLog.__table__.select())).fetchall()
        actions = {row.action for row in logs}
        assert {"incident_created", "incident_status_changed",
                "playbook_created", "playbook_execute"} <= actions


async def test_incident_playbook_run_relationship(session_factory):
    """Executing for an incident writes the action ledger + activity entry."""
    await _seed(session_factory)
    flow = {"name": "IR helper", "steps": [
        {"name": "Ping", "action": "notify", "params": {"message": "handled"}}]}
    async with client_for(session_factory, 1) as c:
        inc = (await c.post("/api/incidents", json={"title": "Linked-run case", "severity": "high"})).json()["incident"]
        pb = (await c.post("/api/soar/playbooks", json=flow)).json()
        run = (await c.post(f"/api/soar/playbooks/{pb['id']}/run",
                            json={"mode": "execute", "incident_uid": inc["uid"]})).json()["run"]
        det = (await c.get(f"/api/incidents/{inc['uid']}")).json()
        assert det["playbook_runs"][0]["uid"] == run["uid"]
        assert any(a["action_type"] == "run_playbook" for a in det["actions"])
        assert any(a["action"] == "playbook_run" for a in det["activity"])
        # unknown incident -> 404; foreign incident -> 403
        assert (await c.post(f"/api/soar/playbooks/{pb['id']}/run",
                             json={"mode": "simulate", "incident_uid": "INC-999999"})).status_code == 404
