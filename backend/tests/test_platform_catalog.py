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
from app.models import Organization, User  # noqa: E402
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
