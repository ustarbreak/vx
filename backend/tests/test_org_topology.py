"""Organizational Infrastructure Topology — tenant isolation & honesty tests.

Run from backend/:  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_org_topology.py -p no:libtmux -q

Covers:
  * authentication enforced (401 without token)
  * cross-tenant org_id rejected for client roles (403)
  * platform_admin may target another org
  * hierarchy nodes come ONLY from registered organizations (no invented sites)
  * HQ unconfigured -> explicit hq_configured=false, never a synthesized HQ node
  * site with zero probes -> "monitoring_unavailable" placeholder (not healthy)
  * probe health derived from real status/last_seen (healthy / stale / offline)
  * network_topology_available is always false here (no device link data)
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

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
from app.models import AgentProbe, Organization, User  # noqa: E402
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
    """Two tenants: org 1 (root + one SUBSIDIARY child + probes) and org 3 (foreign)."""
    async with factory() as s:
        s.add_all([
            Organization(id=1, name="Damaneecash", tier="mid-market", status="active",
                         contact_email="a@b.c", org_type="SUBSIDIARY", parent_org_id=None),
            Organization(id=2, name="Casablanca Agency", tier="sme", status="active",
                         contact_email="a@b.c", org_type="AGENCY", parent_org_id=1),
            Organization(id=3, name="Foreign Corp", tier="sme", status="active",
                         contact_email="x@y.z", org_type="HQ", parent_org_id=None),
            User(id=1, email="ca@one.io", hashed_password=get_password_hash("x"),
                 name="CA1", role="client_admin", org_id=1),
            User(id=2, email="pa@platform.io", hashed_password=get_password_hash("x"),
                 name="PA", role="platform_admin", org_id=None),
        ])
        s.add_all([
            # fresh online probe -> healthy
            AgentProbe(id=1, org_id=1, hostname="srv-01", status="online",
                       last_seen=NOW - timedelta(minutes=5), agent_version="1.2.0", os="linux", ip="10.0.0.5"),
            # online but silent >24h -> stale
            AgentProbe(id=2, org_id=1, hostname="old-box", status="online",
                       last_seen=NOW - timedelta(hours=30)),
            # offline flag -> offline
            AgentProbe(id=3, org_id=2, hostname="branch-pc", status="offline",
                       last_seen=NOW - timedelta(minutes=2)),
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


async def test_auth_required(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory) as c:
        r = await c.get("/api/org-topology")
    assert r.status_code in (401, 403)


async def test_tenant_scoped_hierarchy_only_registered_orgs(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.get("/api/org-topology")
    assert r.status_code == 200
    data = r.json()
    names = {n["name"] for n in data["nodes"]}
    assert "Damaneecash" in names and "Casablanca Agency" in names
    assert "Foreign Corp" not in names          # other tenant never leaks
    org_nodes = [n for n in data["nodes"] if n["kind"] != "probe"]
    assert {n["org_ref"] for n in org_nodes} == {1, 2}
    assert data["root_org_id"] == 1
    assert data["network_topology_available"] is False


async def test_hq_unconfigured_flag(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.get("/api/org-topology")
    data = r.json()
    # Org 1 is SUBSIDIARY with no HQ child -> honest unconfigured state, no fake HQ node
    assert data["hq_configured"] is False
    assert not any(n["kind"] == "hq" for n in data["nodes"])
    assert "Headquarters is not configured" in data["note"]


async def test_probe_health_from_real_timestamps(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.get("/api/org-topology")
    by_name = {n["name"]: n for n in r.json()["nodes"] if n["kind"] == "probe"}
    assert by_name["srv-01"]["health"] == "healthy"
    assert by_name["old-box"]["health"] == "stale"
    assert by_name["branch-pc"]["health"] == "offline"


async def test_site_without_probes_is_monitoring_unavailable(session_factory):
    """Org 2 loses its only probe -> honest monitoring_unavailable placeholder."""
    await _seed(session_factory)
    async with session_factory() as s:
        p = await s.get(AgentProbe, 3)
        await s.delete(p)
        await s.commit()
    async with client_for(session_factory, 1) as c:
        r = await c.get("/api/org-topology")
    nodes = r.json()["nodes"]
    placeholders = [n for n in nodes if n.get("health") == "monitoring_unavailable"]
    assert len(placeholders) == 1 and placeholders[0]["org_ref"] == 2
    # never promoted to healthy just because the site exists
    assert all(n["health"] != "healthy" for n in placeholders)


async def test_cross_tenant_rejected_for_client(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.get("/api/org-topology?org_id=3")
    assert r.status_code == 403


async def test_platform_admin_can_target_org(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 2) as c:
        r = await c.get("/api/org-topology?org_id=3")
    assert r.status_code == 200
    data = r.json()
    assert data["root_org_id"] == 3
    assert data["hq_configured"] is True   # Foreign Corp IS marked HQ
    # no probes on org 3 -> honest monitoring_unavailable placeholder
    assert any(n.get("health") == "monitoring_unavailable" for n in data["nodes"])
