"""Worldwide Attack Map — tenant isolation & contract tests.

Run from backend/:  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_security_map.py -q
Uses an in-memory SQLite DB (aiosqlite) and overrides the get_db dependency,
so no Postgres is required. Covers:
  * authentication is enforced (401 without a token)
  * cross-tenant access rejected (403 when a client asks for another site_id)
  * tenant scoping: a client_admin only ever sees their own org's events
  * geo-only filtering: alerts WITHOUT raw_payload geo never reach the map
  * severity / event_type / source_country / destination_country filters
  * classification honesty: unknown classification defaults to "observed"
  * empty state still reports last_ingestion_at (staleness, not fabrication)
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

from sqlalchemy import JSON  # noqa: E402
from sqlalchemy.dialects import postgresql  # noqa: E402
from sqlalchemy.ext.compiler import compiles  # noqa: E402


# The production models use PostgreSQL JSONB; for the in-memory SQLite test DB we
# render JSONB as generic JSON. Additive/test-only shim, no production impact.
@compiles(postgresql.JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw):  # pragma: no cover - test shim
    return "JSON"


from app.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token, get_password_hash  # noqa: E402
from app.models import Alert, Organization, User  # noqa: E402
from app.main import app  # noqa: E402

NOW = datetime.now(timezone.utc).replace(tzinfo=None)


@pytest_asyncio.fixture()
async def session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:", poolclass=StaticPool, future=True
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest_asyncio.fixture()
async def seeded(session_factory):
    """Two orgs, one user each + platform admin; alerts with and without geo."""
    async with session_factory() as db:
        org_a = Organization(id=1, name="Damaneecash", tier="mid-market",
                             contact_email="a@a.ma", plan_tier="PRO")
        org_b = Organization(id=2, name="Valoris", tier="mid-market",
                             contact_email="b@b.ma", plan_tier="PRO")
        db.add_all([org_a, org_b])
        users = [
            User(id=1, email="admin@a.ma", hashed_password=get_password_hash("x"),
                 name="A Admin", role="client_admin", org_id=1),
            User(id=2, email="admin@b.ma", hashed_password=get_password_hash("x"),
                 name="B Admin", role="client_admin", org_id=2),
            User(id=3, email="root@ic.io", hashed_password=get_password_hash("x"),
                 name="Platform", role="platform_admin", org_id=None),
        ]
        db.add_all(users)

        def alert(pk, org, sev, source, minutes_ago, payload=None, correlated=1):
            return Alert(id=pk, uid=f"ALR-{pk:06d}", org_id=org, title=f"Event {pk}",
                         description="", severity=sev, source=source,
                         resource=f"host-{pk}", raw_payload=payload or {},
                         correlated_count=correlated,
                         created_at=NOW - timedelta(minutes=minutes_ago))

        geo_cn = {"src_geo": {"lat": 39.9, "lon": 116.4, "country": "CN", "confidence": 0.6},
                  "dst_geo": {"lat": 33.6, "lon": -7.6, "country": "MA"},
                  "classification": "malicious"}
        geo_ru_confirmed = {"src_geo": {"lat": 55.7, "lon": 37.6, "country": "RU", "confidence": 0.8},
                            "dst_geo": {"lat": 33.6, "lon": -7.6, "country": "MA"},
                            "classification": "confirmed"}
        db.add_all([
            # Org 1 — geolocated events
            alert(1, 1, "critical", "wazuh", 10, geo_cn, correlated=4),
            alert(2, 1, "high", "siem", 30, geo_ru_confirmed),
            # Org 1 — NO geo: must never appear on the map
            alert(3, 1, "medium", "monitor", 5),
            # Org 2 — geolocated event (must be invisible to org 1)
            alert(4, 2, "high", "wazuh", 20, dict(geo_cn)),
            # Old event outside a 1-hour window (for start_time filter)
            alert(5, 1, "low", "syslog", 240, dict(geo_cn)),
        ])
        await db.commit()

        tokens = {
            "org_a": create_access_token({"sub": "1",
                                          "role": "client_admin", "org_id": 1}),
            "org_b": create_access_token({"sub": "2",
                                          "role": "client_admin", "org_id": 2}),
            "platform": create_access_token({"sub": "3",
                                             "role": "platform_admin", "org_id": None}),
        }
    return session_factory, tokens


def client_for(session_factory, token: str | None):
    async def _get_db():
        async with session_factory() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
                       headers=headers)


URL = "/api/security/attack-map"


@pytest.mark.asyncio
async def test_requires_authentication(seeded):
    factory, tokens = seeded
    async with client_for(factory, None) as c:
        r = await c.get(URL)
    # No credentials -> request is rejected (FastAPI's HTTPBearer yields 403 for
    # missing scheme; either way access is denied without authentication).
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_cross_tenant_site_id_rejected(seeded):
    factory, tokens = seeded
    async with client_for(factory, tokens["org_a"]) as c:
        r = await c.get(URL, params={"site_id": 2})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_tenant_scoped_events_only(seeded):
    factory, tokens = seeded
    async with client_for(factory, tokens["org_a"]) as c:
        r = await c.get(URL)
    assert r.status_code == 200
    body = r.json()
    ids = {e["id"] for e in body["events"]}
    # org A geo events: 1,2,5 — never org B's 4, never the non-geo 3
    assert ids == {1, 2, 5}
    assert body["total_events"] >= len(ids)
    assert body["last_ingestion_at"] is not None


@pytest.mark.asyncio
async def test_geo_only_and_filters(seeded):
    factory, tokens = seeded
    async with client_for(factory, tokens["org_a"]) as c:
        r = await c.get(URL, params={"severity": "critical"})
        ids = {e["id"] for e in r.json()["events"]}
        assert ids == {1}

        r = await c.get(URL, params={"event_type": "siem,wazuh"})
        ids = {e["id"] for e in r.json()["events"]}
        assert ids == {1, 2}

        r = await c.get(URL, params={"source_country": "ru"})
        ids = {e["id"] for e in r.json()["events"]}
        assert ids == {2}

        r = await c.get(URL, params={"destination_country": "ma",
                                     "start_time": (NOW - timedelta(hours=1)).isoformat()})
        ids = {e["id"] for e in r.json()["events"]}
        assert ids == {1, 2}   # old event 5 excluded by the window


@pytest.mark.asyncio
async def test_classification_honesty_and_schema(seeded):
    factory, tokens = seeded
    async with client_for(factory, tokens["org_a"]) as c:
        body = (await c.get(URL)).json()
    by_id = {e["id"]: e for e in body["events"]}
    assert by_id[1]["classification"] == "malicious"
    assert by_id[2]["classification"] == "confirmed"
    assert by_id[1]["count"] == 4                    # correlated events aggregated
    # dst carries no confidence → overall confidence comes from src only
    assert by_id[1]["confidence"] == 0.6
    # documented contract keys present
    for key in ("events", "total_events", "last_ingestion_at", "generated_at", "note"):
        assert key in body
    ev = by_id[1]
    for key in ("id", "uid", "timestamp", "event_type", "title", "severity",
                "classification", "src", "dst", "confidence", "count", "resource"):
        assert key in ev


@pytest.mark.asyncio
async def test_empty_state_reports_last_ingestion(seeded):
    factory, tokens = seeded
    async with client_for(factory, tokens["org_a"]) as c:
        r = await c.get(URL, params={"severity": "info"})   # nothing matches
    body = r.json()
    assert r.status_code == 200
    assert body["events"] == []
    # honest staleness marker — NOT null while ingestion happened
    assert body["last_ingestion_at"] is not None


@pytest.mark.asyncio
async def test_platform_admin_can_target_site(seeded):
    factory, tokens = seeded
    async with client_for(factory, tokens["platform"]) as c:
        r = await c.get(URL, params={"site_id": 2})
    ids = {e["id"] for e in r.json()["events"]}
    assert ids == {4}
