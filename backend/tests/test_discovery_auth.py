"""Auto-Discovery API — authorization, tenant isolation & bounded-scan tests.

Run from backend/:  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_discovery_auth.py -p no:libtmux -q

Covers (no intrusive scanning is performed — scans stay queued; the background
executor is never scheduled against real networks in tests):
  * authentication enforced on every discovery endpoint
  * cross-tenant access rejected (scan status / devices / cancel / import)
  * scan creation requires explicit operator authorization (authorized=true;
    403 otherwise — checked BEFORE input validation so an unauthorized caller
    never learns which payloads would be valid)
  * scan creation validates CIDR, rejects unbounded prefixes (< /22), and
    rejects prefix overrides that WIDEN the requested scope
  * unknown credential ids for the tenant are rejected (422)
  * cancel transitions only queued/running -> cancelled (409 otherwise)
  * provenance fields are server-derived: verified == snmp_match,
    source == "discovery", last_seen == created_at (never synthesized)
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
    Organization, User, SnmpCredential, DiscoveryScan, DiscoveredDevice,
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
            Organization(id=1, name="Damaneecash", tier="mid-market", status="active", contact_email="a@b.c"),
            Organization(id=3, name="Foreign Corp", tier="sme", status="active", contact_email="x@y.z"),
            User(id=1, email="ca@one.io", hashed_password=get_password_hash("x"),
                 name="CA1", role="client_admin", org_id=1),
            User(id=2, email="ca@three.io", hashed_password=get_password_hash("x"),
                 name="CA3", role="client_admin", org_id=3),
            SnmpCredential(id=1, org_id=1, name="edge v2c", version="v2c", community="public", port=161),
            SnmpCredential(id=2, org_id=3, name="foreign cred", version="v2c", community="secret", port=161),
            # scan owned by org 1
            DiscoveryScan(id=10, org_id=1, network_cidr="10.0.0.0/24", status="queued",
                          credential_ids=[1], total_hosts=254, discovered=0, snmp_matched=0,
                          created_by="ca@one.io", created_at=NOW),
            DiscoveryScan(id=11, org_id=1, network_cidr="10.0.1.0/24", status="completed",
                          credential_ids=[1], total_hosts=254, discovered=5, snmp_matched=2,
                          created_by="ca@one.io", created_at=NOW),
            # discovered devices under scan 11 (org 1)
            DiscoveredDevice(id=100, scan_id=11, org_id=1, ip="10.0.1.7", hostname="sw-01.lan.local",
                             mac="aa:bb:cc:dd:ee:01", device_type="network", os_guess="FortiOS 7.4",
                             open_ports=[22, 443], snmp_match=True, sys_desc="FortiGate",
                             imported=False, created_at=NOW),
            DiscoveredDevice(id=101, scan_id=11, org_id=1, ip="10.0.1.9", hostname=None,
                             open_ports=[], snmp_match=False, imported=False, created_at=NOW),
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


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
async def test_auth_required_on_all_discovery_endpoints(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory) as c:
        for path in ("/api/discovery/scans", "/api/discovery/devices",
                     "/api/discovery/snmp-credentials", "/api/discovery/scans/10"):
            r = await c.get(path)
            assert r.status_code in (401, 403), path


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------
async def test_scans_are_tenant_scoped(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.get("/api/discovery/scans")
        assert r.status_code == 200
        assert {s["id"] for s in r.json()} == {10, 11}
    async with client_for(session_factory, 2) as c:
        r = await c.get("/api/discovery/scans")
        assert r.json() == []  # foreign tenant sees nothing


async def test_cross_tenant_scan_status_and_devices_rejected(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 2) as c:
        assert (await c.get("/api/discovery/scans/10")).status_code == 403
        assert (await c.get("/api/discovery/scans/11/devices")).status_code == 403
        assert (await c.post("/api/discovery/scans/10/cancel")).status_code == 403
        assert (await c.post("/api/discovery/devices/100/import")).status_code == 403


async def test_devices_list_never_leaks_other_tenant(session_factory):
    """The devices endpoint returns a paginated envelope; a foreign tenant's
    page must be empty even though org 1 has rows."""
    await _seed(session_factory)
    async with client_for(session_factory, 2) as c:
        r = await c.get("/api/discovery/devices")
        assert r.status_code == 200
        body = r.json()
        assert body["items"] == [] and body["total"] == 0


# ---------------------------------------------------------------------------
# Bounded, validated scan creation
# ---------------------------------------------------------------------------
async def test_scan_requires_explicit_authorization(session_factory):
    """Intrusive action gate: authorized=false (the default) is refused with 403
    before any other validation runs — even for an otherwise valid payload."""
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/discovery/scans", json={"network_cidr": "10.0.0.0/24"})
        assert r.status_code == 403
        assert "authoriz" in r.text.lower()


async def test_invalid_cidr_rejected(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/discovery/scans",
                         json={"network_cidr": "not-a-cidr", "authorized": True})
        assert r.status_code == 422


async def test_unbounded_prefix_override_rejected(session_factory):
    """A /8 override on a /24 widens the scope AND is unbounded (< /22) — refuse.

    The router checks "cannot widen" first; either rejection message proves the
    request was refused with 422 before any scan was scheduled.
    """
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/discovery/scans",
                         json={"network_cidr": "10.0.0.0/24", "prefix": 8, "authorized": True})
        assert r.status_code == 422
        text = r.text.lower()
        assert "unbounded" in text or "/22" in text or "widen" in text
        # no scan should have been created for the rejected payload
        scans = (await c.get("/api/discovery/scans")).json()
        assert all(s["network_cidr"] != "10.0.0.0/8" for s in scans)


async def test_unbounded_prefix_same_mask_rejected(session_factory):
    """prefix == the CIDR's own mask doesn't widen anything, but < /22 is still
    an unbounded-scope policy violation -> 422 'unbounded'."""
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/discovery/scans",
                         json={"network_cidr": "10.0.0.0/16", "prefix": 16, "authorized": True})
        assert r.status_code == 422
        assert "unbounded" in r.text.lower() or "/22" in r.text


async def test_prefix_override_cannot_widen_scope(session_factory):
    """prefix smaller than the CIDR's own mask would ENLARGE the target — refuse."""
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/discovery/scans",
                         json={"network_cidr": "10.0.0.0/24", "prefix": 23, "authorized": True})
        assert r.status_code == 422


async def test_unknown_credential_id_rejected(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/discovery/scans",
                         json={"network_cidr": "10.0.0.0/24", "credential_ids": [2],
                               "authorized": True})
        assert r.status_code == 422  # cred 2 belongs to another tenant


# ---------------------------------------------------------------------------
# Cancel semantics
# ---------------------------------------------------------------------------
async def test_cancel_queued_scan_persists(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/discovery/scans/10/cancel")
        assert r.status_code == 200 and r.json()["status"] == "cancelled"
        r2 = await c.get("/api/discovery/scans/10")
        assert r2.json()["status"] == "cancelled"


async def test_cancel_completed_scan_conflict(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/discovery/scans/11/cancel")
        assert r.status_code == 409


# ---------------------------------------------------------------------------
# Provenance honesty (task 4/5: discovered vs verified vs manual)
# ---------------------------------------------------------------------------
async def test_provenance_fields_server_derived(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.get("/api/discovery/devices")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 2 and len(body["items"]) == 2
        by_id = {d["id"]: d for d in body["items"]}
        snmp_dev, plain_dev = by_id[100], by_id[101]
        assert snmp_dev["verified"] is True and plain_dev["verified"] is False
        assert snmp_dev["source"] == "discovery"      # scanner finding, not manual CMDB
        # last_seen is heartbeat-derived: no AgentProbe matches the seeded rows,
        # so it must stay None — never synthesized from created_at.
        assert snmp_dev["last_seen"] is None and plain_dev["last_seen"] is None
        # ...and without a collector probe the honest state is 'enrolled',
        # never 'monitored'/'online' just because a DB row exists.
        assert snmp_dev["monitoring_state"] == "enrolled"
        assert plain_dev["monitoring_state"] == "enrolled"
        assert snmp_dev["collector"] is None and plain_dev["collector"] is None
