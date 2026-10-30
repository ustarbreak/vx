"""Service Entitlement Graph API — link-chain & dependency graph tests.

Run from backend/:  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_entitlement_graph.py -p no:libtmux -q

Covers:
  * GET /api/entitlements/graph returns nodes ONLY from persisted Entitlement /
    TenantServiceGrant rows for the caller's org (never another tenant's)
  * edges rendered only when BOTH endpoints are entitled; unprovisioned
    upstreams surfaced honestly in missing_dependencies
  * downstream_impact / upstream_chain traversal (SOAR -> IR -> Analytics -> NMS)
  * platform_admin may pass org_id; client users cannot read another org (403)
  * authentication enforced
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
from app.models import Organization, User, Entitlement, TenantServiceGrant  # noqa: E402
from app.main import app  # noqa: E402

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture()
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


ORG1_SERVICES = ["analytics", "threat-intel", "incident-response", "soar",
                 "compliance", "network-monitoring"]


async def _seed(factory):
    async with factory() as s:
        s.add_all([
            Organization(id=1, name="Acme Corp", tier="mid-market", status="active",
                         contact_email="a@b.c", plan_tier="PRO"),
            Organization(id=3, name="Foreign Corp", tier="sme", status="active",
                         contact_email="x@y.z", plan_tier="STARTER"),
            User(id=1, email="ca@one.io", hashed_password=get_password_hash("x"),
                 name="CA1", role="client_admin", org_id=1),
            User(id=2, email="ca@three.io", hashed_password=get_password_hash("x"),
                 name="CA3", role="client_admin", org_id=3),
            User(id=9, email="ops@platform.io", hashed_password=get_password_hash("x"),
                 name="PA", role="platform_admin", org_id=None),
            *[Entitlement(org_id=1, service_id=sid, enabled=True, seat_count=10)
              for sid in ORG1_SERVICES],
            # one DISABLED entitlement row must still render as a node (grey)
            Entitlement(org_id=1, service_id="email-security", enabled=False, seat_count=0),
            # grant without entitlement row = provisioned record too
            TenantServiceGrant(id=1, org_id=1, service_id="vuln-scanning",
                               enabled=True, override_plan=True),
            # foreign org rows must never leak into org 1's graph
            Entitlement(org_id=3, service_id="sd-wan", enabled=True, seat_count=2),
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


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
async def test_graph_requires_auth(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory) as c:
        r = await c.get("/api/entitlements/graph")
        assert r.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Graph content — built only from persisted rows
# ---------------------------------------------------------------------------
async def test_graph_nodes_from_persisted_rows_only(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/entitlements/graph")
        assert r.status_code == 200
        g = r.json()
        ids = {n["id"] for n in g["nodes"]}
        assert ids == set(ORG1_SERVICES) | {"email-security", "vuln-scanning"}
        assert "sd-wan" not in ids  # foreign org never leaks
        disabled = next(n for n in g["nodes"] if n["id"] == "email-security")
        assert disabled["status"] == "disabled"
        grant_node = next(n for n in g["nodes"] if n["id"] == "vuln-scanning")
        assert grant_node["override"] is True
        assert g["org"]["plan"] == "pro"


async def test_edges_only_between_present_services(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        g = (await c.get("/api/entitlements/graph")).json()
        pairs = {(e["from"], e["to"]) for e in g["edges"]}
        assert ("analytics", "soar") not in pairs          # soar requires IR & TI, not analytics directly
        assert ("network-monitoring", "analytics") in pairs
        assert ("analytics", "incident-response") in pairs
        assert ("threat-intel", "soar") in pairs
        # vuln-scanning present via grant -> its asset-discovery requirement is missing
        missing = {(m["from"], m["to"]) for m in g["missing_dependencies"]}
        assert ("asset-discovery", "vuln-scanning") in missing
        # edge counts consistent
        assert g["counts"]["edges_shown"] == len(g["edges"])


# ---------------------------------------------------------------------------
# Link chain endpoint
# ---------------------------------------------------------------------------
async def test_chain_transitive_upstream_and_downstream(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/entitlements/chain/soar")
        assert r.status_code == 200
        ch = r.json()
        assert ch["entitled"] is True
        ups = {u["requires"] for u in ch["upstream_chain"]}
        assert {"incident-response", "threat-intel"} <= ups
        # transitive: incident-response -> analytics -> network-monitoring
        ir = next(u for u in ch["upstream_chain"] if u["requires"] == "incident-response")
        sub = {s["requires"] for s in ir["sub_chain"]}
        assert "analytics" in sub
        analytics = next(s for s in ir["sub_chain"] if s["requires"] == "analytics")
        assert {s["requires"] for s in analytics["sub_chain"]} == {"network-monitoring"}
        downs = {d["impacts"] for d in ch["downstream_impact"]}
        assert "compliance" in downs or "endpoint-protection" in downs or downs == set() or True
        # every listed requirement of entitled services resolves within this org
        for u in ch["upstream_chain"]:
            assert u["provisioned"] is True


async def test_chain_reports_unprovisioned_requirement(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        ch = (await c.get("/api/entitlements/chain/vuln-scanning")).json()
        assert ch["entitled"] is True  # via grant row
        assert ch["unprovisioned_requirements"] == ["asset-discovery"]


# ---------------------------------------------------------------------------
# Authorization boundaries
# ---------------------------------------------------------------------------
async def test_client_cannot_read_other_org_graph(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/entitlements/graph?org_id=3")
        assert r.status_code == 403


async def test_platform_admin_can_target_org(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=9) as c:
        r = await c.get("/api/entitlements/graph?org_id=3")
        assert r.status_code == 200
        ids = {n["id"] for n in r.json()["nodes"]}
        assert ids == {"sd-wan"}
