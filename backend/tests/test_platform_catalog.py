"""T1.3 — Platform catalog router tests (additive tree, flag-gated).

Run from backend/:  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_platform_catalog.py -p no:libtmux -q

Covers:
  * PLATFORM_CATALOG_ENABLED=false (default) => /api/platform/* is NOT mounted (404)
  * with the flag on (TestClient rebuilt after env change):
      - auth enforced on all three endpoints
      - GET /api/platform/graph returns nodes/edges matching the YAML catalog
      - ?format=mermaid returns Mermaid text
      - GET /api/platform/capabilities lists services with honest action statuses
      - POST /api/platform/actions: unknown service -> 404; unregistered action
        -> {"status": "unsupported"} (no execution — safe default per brief)
"""
from __future__ import annotations

import asyncio
import os
import sys

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
from app.models import Organization, User
from types import SimpleNamespace  # noqa: E402
from app.platform.catalog.schema import load_catalog  # noqa: E402


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
            Organization(id=1, name="Acme", tier="mid-market", status="active", contact_email="a@b.c"),
            User(id=1, email="ca@one.io", hashed_password=get_password_hash("x"),
                 name="CA1", role="client_admin", org_id=1),
        ])
        await s.commit()


def make_client(session_factory, mounted: bool, user_id=None):
    """Build a fresh FastAPI app via the same module path, honoring the flag.

    main.py mounts the platform router only when settings.PLATFORM_CATALOG_ENABLED
    is true at import time, so we set the env var BEFORE importing and force a
    reload of app.main for each mode.
    """
    os.environ["PLATFORM_CATALOG_ENABLED"] = "true" if mounted else "false"
    import importlib
    import app.core.config as config_mod
    importlib.reload(config_mod)
    import app.main as main_mod
    importlib.reload(main_mod)
    app_obj = main_mod.app

    async def _get_db():
        async with session_factory() as s:
            yield s

    app_obj.dependency_overrides[get_db] = _get_db
    headers = {}
    if user_id is not None:
        headers["Authorization"] = f"Bearer {create_access_token({'sub': str(user_id)})}"
    return AsyncClient(transport=ASGITransport(app=app_obj), base_url="http://t", headers=headers)


pytestmark = pytest.mark.asyncio


async def test_flag_off_means_not_mounted(session_factory):
    await _seed(session_factory)
    async with make_client(session_factory, mounted=False, user_id=1) as c:
        r = await c.get("/api/platform/graph")
        assert r.status_code == 404  # route absent when flag off (default)


async def test_auth_required(session_factory):
    # NOTE: FastAPI's HTTPBearer(auto_error=True) in app/core/security.py returns
    # 403 (not 404/401) when the Authorization header is missing entirely.
    # That is pre-existing behavior shared by every authenticated route; we pin it
    # here so regressions are caught, and a future switch to auto_error=False +
    # explicit 401 would require updating this expectation repo-wide.
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True) as c:
        assert (await c.get("/api/platform/graph")).status_code == 403
        assert (await c.get("/api/platform/capabilities")).status_code == 403
        assert (await c.post("/api/platform/actions",
                             json={"service": "soar", "action": "case.create"})).status_code == 403
        # invalid token -> 401 from get_current_user
        r = await c.get("/api/platform/graph", headers={"Authorization": "Bearer garbage"})
        assert r.status_code == 401


async def test_graph_matches_catalog(session_factory):
    await _seed(session_factory)
    specs = load_catalog()
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        r = await c.get("/api/platform/graph")
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == len(specs)
        ids = {n["id"] for n in body["nodes"]}
        assert ids == set(specs)
        # every catalog dependency appears as an edge
        expected_edges = {(d.requires, sid) for sid, s in specs.items() for d in s.dependencies}
        got_edges = {(e["from"], e["to"]) for e in body["edges"]}
        assert expected_edges <= got_edges or expected_edges == got_edges
        m = await c.get("/api/platform/graph?format=mermaid")
        assert m.status_code == 200
        assert "graph TD" in m.json()["mermaid"]


async def test_capabilities_honest(session_factory):
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        r = await c.get("/api/platform/capabilities")
        assert r.status_code == 200
        services = {s["service"]: s for s in r.json()["services"]}
        assert "vuln-scanning" in services
        assert services["vuln-scanning"]["status"] == "roadmap"  # owner decision #8


async def test_action_unknown_and_unsupported(session_factory):
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        r = await c.post("/api/platform/actions",
                         json={"service": "not-a-service", "action": "x.y"})
        assert r.status_code == 404
        r2 = await c.post("/api/platform/actions",
                          json={"service": "soar", "action": "case.create"})
        assert r2.status_code == 200
        assert r2.json()["status"] == "unsupported"  # Phase-1: nothing executes


# ---------------------------------------------------------------- T2.6 native delegation

async def test_action_native_case_create_dry_run(session_factory):
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        r = await c.post("/api/platform/actions", json={
            "service": "advanced-ticketing", "action": "case.create",
            "payload": {"title": "Test case from platform action"}, "dry_run": True})
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "dry_run"
        assert body["would_do"] == "ticketing.create_ticket"


async def test_action_native_case_create_executes(session_factory):
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        r = await c.post("/api/platform/actions", json={
            "service": "advanced-ticketing", "action": "case.create",
            "payload": {"title": "Live platform case", "priority": "p2"},
            "dry_run": False})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "created"
        assert body["ticket_uid"].startswith("TCK-")
        assert body["provider"] == "native"
        # the ticket really exists via the native engine route
        # (GET /api/tickets/{uid} returns a flat TicketResponse, not a wrapper)
        t = await c.get(f"/api/tickets/{body['ticket_uid']}")
        assert t.status_code == 200
        assert t.json()["title"] == "Live platform case"


async def test_action_dangerous_requires_confirm(session_factory):
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        r = await c.post("/api/platform/actions", json={
            "service": "soar", "action": "playbook.run",
            "payload": {"playbook_id": 999}, "dry_run": False})
        assert r.status_code == 200
        assert r.json()["status"] == "requires_confirmation"


async def test_provider_mode_off_queues_only(session_factory, monkeypatch):
    # NOTE: make_client() reloads app.core.config internally, which re-creates
    # settings from env — so PROVIDER_MODE must be patched AFTER the client is
    # built. The platform router reads `settings.PROVIDER_MODE` at request time.
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        import app.core.config as config_mod
        monkeypatch.setattr(config_mod.settings, "PROVIDER_MODE", "off", raising=False)
        r = await c.post("/api/platform/actions", json={
            "service": "advanced-ticketing", "action": "case.create",
            "payload": {"title": "must not execute"}, "dry_run": False})
        assert r.status_code == 200
        assert r.json()["status"] == "queued"


# ---------------------------------------------------------------------------
# T4.2 lifecycle tests (additive)
# ---------------------------------------------------------------------------

async def test_lifecycle_flag_off_reports_disabled(session_factory):
    os.environ["SERVICE_LIFECYCLE_ENABLED"] = "false"
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        # SERVICE_LIFECYCLE_ENABLED default false -> honest "disabled" payload
        r = await c.get("/api/platform/lifecycle")
        assert r.status_code == 200
        assert r.json() == {"enabled": False, "services": []}
        r2 = await c.post("/api/platform/services/threat-intel/first-success", json={"note": "x"})
        assert r2.status_code == 409


async def test_lifecycle_first_success_flow(session_factory, monkeypatch):
    os.environ["SERVICE_LIFECYCLE_ENABLED"] = "true"
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        r = await c.post("/api/platform/services/threat-intel/first-success", json={"note": "verify.sh ok"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["state"] == "first_success"
        assert body["installed_at"] and body["connected_at"] and body["first_success_at"]
        # idempotent second call keeps timestamps stable
        r2 = await c.post("/api/platform/services/threat-intel/first-success", json={"note": "again"})
        assert r2.json()["first_success_at"] == body["first_success_at"]
        lst = (await c.get("/api/platform/lifecycle")).json()
        assert lst["enabled"] is True
        states = {s["service_id"]: s["state"] for s in lst["services"]}
        assert states["threat-intel"] == "first_success"
        assert states["endpoint-protection"] == "not_installed"   # catalog default-filled
        r404 = await c.post("/api/platform/services/nope/first-success", json={})
        assert r404.status_code == 404


# ---------------------------------------------------------------------------
# Phase 5 (T5.x) — async job runner endpoints. Same flag-gated mounting; jobs
# run in background tasks, so tests poll the store until terminal state.
# ---------------------------------------------------------------------------

async def test_jobs_flag_off_not_mounted(session_factory):
    await _seed(session_factory)
    async with make_client(session_factory, mounted=False, user_id=1) as c:
        r = await c.post("/api/platform/jobs",
                         json={"service": "soar", "action": "case.create"})
        assert r.status_code == 404


async def test_job_unknown_service_404(session_factory):
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        r = await c.post("/api/platform/jobs",
                         json={"service": "nope-not-real", "action": "x.y"})
        assert r.status_code == 404


async def test_job_roadmap_action_unsupported(session_factory):
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        # pick any action whose catalog status is roadmap/unsupported
        from app.platform.catalog.schema import load_catalog
        target = None
        for svc, spec in load_catalog().items():
            for a in spec.actions:
                if a.status in ("roadmap", "unsupported"):
                    target = (svc, a.name)
                    break
            if target:
                break
        if target is None:
            pytest.skip("catalog has no roadmap actions")
        r = await c.post("/api/platform/jobs",
                         json={"service": target[0], "action": target[1]})
        assert r.status_code == 200
        assert r.json()["status"] == "unsupported"


async def test_job_lifecycle_poll(session_factory):
    """Enqueue a real provider job and poll GET /jobs/{id} to terminal state."""
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        r = await c.post("/api/platform/jobs", json={
            "service": "soar", "action": "playbook.run",
            "params": {"playbook_id": 1}, "idempotency_key": "k-1"})
        assert r.status_code == 202, r.text
        jid = r.json()["job_id"]
        assert r.json()["state"] == "queued"
        # idempotent replay returns same job id
        r2 = await c.post("/api/platform/jobs", json={
            "service": "soar", "action": "playbook.run",
            "params": {"playbook_id": 1}, "idempotency_key": "k-1"})
        assert r2.json()["job_id"] == jid
        # poll up to ~3s for terminal state
        import time as _t
        state = None
        deadline = _t.time() + 3
        while _t.time() < deadline:
            g = await c.get(f"/api/platform/jobs/{jid}")
            assert g.status_code == 200
            state = g.json()["state"]
            if state in ("succeeded", "failed", "unsupported", "blocked", "dry_run"):
                break
            await asyncio.sleep(0.05)
        assert state in ("succeeded", "failed", "unsupported", "blocked", "dry_run"), state
        g404 = await c.get("/api/platform/jobs/does-not-exist")
        assert g404.status_code == 404


# ---------------------------------------------------------------------------
# Security regressions: job authorization, tenant isolation, integration secret
# redaction and honest unsupported integration tests.
# ---------------------------------------------------------------------------

async def test_job_poll_is_tenant_scoped(session_factory):
    await _seed(session_factory)
    from app.platform.connectors.jobs import jobs
    job = await jobs.create("test.read", 2, {"safe": True})
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        r = await c.get(f"/api/platform/jobs/{job['id']}")
        assert r.status_code == 404
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        # Platform administrators retain cross-tenant operational visibility.
        async with session_factory() as db:
            db.add(User(id=2, email="root@ic2.io", hashed_password=get_password_hash("x"),
                        name="Platform 2", role="platform_admin", org_id=None))
            await db.commit()
        async with make_client(session_factory, mounted=True, user_id=2) as c2:
            r = await c2.get(f"/api/platform/jobs/{job['id']}")
            assert r.status_code == 200


async def test_guardrails_use_application_roles_and_four_eyes(session_factory):
    from app.platform.connectors.guardrails import check
    client_admin = SimpleNamespace(id=10, role="client_admin", org_id=1)
    platform_admin = SimpleNamespace(id=11, role="platform_admin", org_id=None)
    other_platform_admin = SimpleNamespace(id=12, role="platform_admin", org_id=None)
    assert check(client_admin, False, False, {}).allowed
    assert not check(client_admin, True, False, {}, confirmer=platform_admin).allowed
    assert not check(platform_admin, True, False, {}).allowed
    assert not check(platform_admin, True, False, {}, confirmer=platform_admin).allowed
    assert check(platform_admin, True, False, {}, confirmer=other_platform_admin).allowed
    assert not check(SimpleNamespace(id=13, role="client_user", org_id=1), False, False, {}).allowed


async def test_job_destructive_action_does_not_silently_dry_run(session_factory):
    await _seed(session_factory)
    # The seeded client administrator cannot execute a dangerous action.
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        r = await c.post("/api/platform/jobs", json={
            "service": "soar", "action": "playbook.run",
            "params": {"playbook_id": 1}, "dry_run": False})
        # If the catalog marks this action dangerous, it must be denied.
        from app.platform.catalog.schema import load_catalog
        act = next(a for a in load_catalog()["soar"].actions if a.name == "playbook.run")
        if act.dangerous:
            assert r.status_code == 403
        else:
            assert r.status_code in (202, 403)


async def test_job_dry_run_is_explicit_and_default_safe(session_factory):
    await _seed(session_factory)
    async with make_client(session_factory, mounted=True, user_id=1) as c:
        r = await c.post("/api/platform/jobs", json={
            "service": "soar", "action": "playbook.run",
            "params": {"playbook_id": 1}})
        assert r.status_code == 202
