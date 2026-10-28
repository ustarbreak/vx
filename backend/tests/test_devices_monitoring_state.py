"""GET /discovery/devices — pagination, filters & heartbeat-derived monitoring state.

Run from backend/:  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_devices_monitoring_state.py -p no:libtmux -q

Honesty guarantees under test (Phase 3 rules):
  * A database row alone NEVER means "online": without a matching AgentProbe
    heartbeat the device is reported "enrolled" (or "unknown" if a probe exists
    but has never reported a timestamp).
  * Stale/offline come ONLY from heartbeat age vs backend thresholds
    (OFFLINE_AFTER=600s, STALE_AFTER=900s).
  * q / type / state / offset / limit params work with tenant isolation.
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
from app.models import (  # noqa: E402
    Organization, User, DiscoveryScan, DiscoveredDevice, AgentProbe,
)
from app.main import app  # noqa: E402
from app.routers.discovery import derive_monitoring_state, OFFLINE_AFTER, STALE_AFTER  # noqa: E402

NOW = datetime.now(timezone.utc).replace(tzinfo=None)

# NOTE: pytest-asyncio >= 1.0 forbids module-level `pytestmark =
# pytest.mark.asyncio` (the mark would leak onto fixtures and collection
# aborts with "Marks cannot be applied to fixtures"), so each async test
# carries its own @pytest.mark.asyncio marker instead.


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
            Organization(id=3, name="Org Three", tier="sme", status="active", contact_email="x@y.z"),
            User(id=1, email="ca@one.io", hashed_password=get_password_hash("x"),
                 name="CA1", role="client_admin", org_id=1),
            User(id=3, email="ca@three.io", hashed_password=get_password_hash("x"),
                 name="CA3", role="client_admin", org_id=3),
            DiscoveryScan(id=10, org_id=1, network_cidr="10.0.0.0/24", status="completed",
                          credential_ids=[], total_hosts=254, discovered=4, snmp_matched=0,
                          created_by="ca@one.io", created_at=NOW),
            # fresh heartbeat -> monitored
            DiscoveredDevice(id=100, scan_id=10, org_id=1, ip="10.0.0.1", hostname="srv-fresh",
                             device_type="server", open_ports=[], snmp_match=False,
                             imported=True, created_at=NOW),
            AgentProbe(id=1, org_id=1, hostname="srv-fresh", ip="10.0.0.1", status="online",
                       last_seen=NOW - timedelta(seconds=60)),
            # heartbeat 11 min old -> offline (>600s)
            DiscoveredDevice(id=101, scan_id=10, org_id=1, ip="10.0.0.2", hostname="srv-off",
                             device_type="server", open_ports=[], snmp_match=False,
                             imported=True, created_at=NOW),
            AgentProbe(id=2, org_id=1, hostname="srv-off", ip="10.0.0.2", status="online",
                       last_seen=NOW - timedelta(seconds=660)),
            # probe exists but NEVER reported -> unknown
            DiscoveredDevice(id=102, scan_id=10, org_id=1, ip="10.0.0.3", hostname="srv-none",
                             device_type="network", open_ports=[], snmp_match=False,
                             imported=True, created_at=NOW),
            AgentProbe(id=3, org_id=1, hostname="srv-none", ip="10.0.0.3", status="unknown",
                       last_seen=None),
            # no probe at all -> enrolled (row existence must NOT mean online)
            DiscoveredDevice(id=103, scan_id=10, org_id=1, ip="10.0.0.4", hostname="sw-quiet",
                             device_type="printer", open_ports=[], snmp_match=False,
                             imported=False, created_at=NOW),
            # foreign tenant device + its own fresh probe
            DiscoveredDevice(id=200, scan_id=10, org_id=3, ip="10.9.9.9", hostname="foreign",
                             device_type="server", open_ports=[], snmp_match=False,
                             imported=True, created_at=NOW),
            AgentProbe(id=9, org_id=3, hostname="foreign", ip="10.9.9.9", status="online",
                       last_seen=NOW),
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
# Pure derivation unit checks
# ---------------------------------------------------------------------------
def test_derive_pure_function():
    assert derive_monitoring_state(False, None) == "enrolled"
    assert derive_monitoring_state(True, None) == "unknown"
    fresh = datetime.now(timezone.utc) - timedelta(seconds=30)
    assert derive_monitoring_state(True, fresh) == "monitored"
    mid = datetime.now(timezone.utc) - timedelta(seconds=800)
    assert derive_monitoring_state(True, mid) == "offline"   # >600 => offline first
    old = datetime.now(timezone.utc) - timedelta(seconds=OFFLINE_AFTER + 1)
    assert derive_monitoring_state(True, old) == "offline"
    assert STALE_AFTER > OFFLINE_AFTER  # documented threshold ordering


# ---------------------------------------------------------------------------
# Endpoint behaviour
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_state_derived_from_heartbeat_not_row_existence(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/discovery/devices?limit=50")
        assert r.status_code == 200
        body = r.json()
        by_ip = {i["ip"]: i for i in body["items"]}
        assert by_ip["10.0.0.1"]["monitoring_state"] == "monitored"
        assert by_ip["10.0.0.2"]["monitoring_state"] == "offline"      # stale heartbeat
        assert by_ip["10.0.0.3"]["monitoring_state"] == "unknown"      # probe w/o last_seen
        assert by_ip["10.0.0.4"]["monitoring_state"] == "enrolled"     # DB row only
        assert by_ip["10.0.0.4"]["collector"] is None
        assert by_ip["10.0.0.4"]["last_seen"] is None
        # collector identity exposed for matched devices (no secrets/tokens)
        assert by_ip["10.0.0.1"]["collector"]["hostname"] == "srv-fresh"
        for item in body["items"]:
            blob = str(item).lower()
            assert "community" not in blob and "token" not in blob and "secret" not in blob


@pytest.mark.asyncio
async def test_state_filter_pagination_and_search(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/discovery/devices?state=offline")
        items = r.json()["items"]
        assert [i["ip"] for i in items] == ["10.0.0.2"]
        assert r.json()["total"] == 1

        r = await c.get("/api/discovery/devices?type=printer")
        assert [i["ip"] for i in r.json()["items"]] == ["10.0.0.4"]

        r = await c.get("/api/discovery/devices?q=srv-fresh")
        assert r.json()["total"] == 1

        r = await c.get("/api/discovery/devices?offset=2&limit=1")
        body = r.json()
        assert len(body["items"]) == 1 and body["total"] == 4
        assert body["offset"] == 2 and body["limit"] == 1


@pytest.mark.asyncio
async def test_tenant_isolation_and_auth(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory) as c:
        r = await c.get("/api/discovery/devices")
        assert r.status_code in (401, 403)
    async with client_for(session_factory, user_id=3) as c:
        r = await c.get("/api/discovery/devices")
        body = r.json()
        ips = {i["ip"] for i in body["items"]}
        assert ips == {"10.9.9.9"}          # foreign device only, never org-1 rows
        assert body["total"] == 1


@pytest.mark.asyncio
async def test_empty_inventory(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=3) as c:
        r = await c.get("/api/discovery/devices?q=does-not-exist")
        assert r.status_code == 200
        assert r.json()["items"] == [] and r.json()["total"] == 0


@pytest.mark.asyncio
async def test_limit_bounds_validated(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        assert (await c.get("/api/discovery/devices?limit=0")).status_code == 422
        assert (await c.get("/api/discovery/devices?limit=201")).status_code == 422
        assert (await c.get("/api/discovery/devices?offset=-1")).status_code == 422
