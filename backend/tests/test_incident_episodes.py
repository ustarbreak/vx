"""STAGE 4 — Incident episodes: recurrence, history preservation, concurrency.

Run from backend/:  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_incident_episodes.py -p no:libtmux -q

Covers the approved Decision-3 policy and Stage 4 acceptance criteria:
  * active incidents receive qualifying evidence (update in place)
  * evidence after RESOLUTION creates a NEW episode; the resolved incident is
    byte-for-byte unchanged (status/timestamps/activity trail untouched)
  * CLOSED incidents likewise never auto-reopen via the alert path
  * recurrence lineage fields (recurrence_of_uid / episode_number) are set
  * explicit tenant scoping: same title/resource in another org does not match
  * manual creation route remains compatible (201 / reused semantics)
  * concurrent duplicate-active-episode prevention (partial unique index +
    race recovery): two racing POSTs yield exactly ONE active episode
  * permissions preserved: client_user still 403 on incident creation
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlalchemy.dialects import postgresql  # noqa: E402
from sqlalchemy.ext.compiler import compiles  # noqa: E402


@compiles(postgresql.JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw):  # pragma: no cover - test shim
    return "JSON"


from app.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token, get_password_hash  # noqa: E402
from app.models import Organization, User, Alert, Incident, IncidentActivity  # noqa: E402
from app.main import app  # noqa: E402

NOW = datetime.now(timezone.utc).replace(tzinfo=None)

pytestmark = pytest.mark.asyncio


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
            Organization(id=3, name="Foreign Corp", tier="sme", status="active",
                         contact_email="x@for.io", org_type="HQ"),
            User(id=1, email="admin@acme.io", hashed_password=get_password_hash("x"),
                 name="Admin", role="client_admin", org_id=1),
            User(id=2, email="user@acme.io", hashed_password=get_password_hash("x"),
                 name="User", role="client_user", org_id=1),
            User(id=4, email="admin@for.io", hashed_password=get_password_hash("x"),
                 name="FAdmin", role="client_admin", org_id=3),
            # two alerts with identical title/resource (same dedup key), distinct rows
            Alert(id=1, uid="ALR-000001", org_id=1, title="Ransomware beacon",
                  description="", severity="high", source="siem", resource="ws-042",
                  correlated_count=1, created_at=NOW),
            Alert(id=2, uid="ALR-000002", org_id=1, title="Ransomware beacon",
                  description="", severity="high", source="siem", resource="ws-042",
                  correlated_count=1, created_at=NOW),
            Alert(id=3, uid="ALR-000003", org_id=1, title="Ransomware beacon",
                  description="", severity="critical", source="siem", resource="ws-042",
                  correlated_count=1, created_at=NOW),
            # foreign-org alert with the SAME title/resource
            Alert(id=9, uid="ALR-000009", org_id=3, title="Ransomware beacon",
                  description="", severity="high", source="siem", resource="ws-042",
                  correlated_count=1, created_at=NOW),
        ])
        await s.commit()


def client_for(session_factory, user_id=None):
    """Per-CLIENT dependency override (unlike the legacy shared-override
    pattern in test_incidents_soar.py): each AsyncClient instance installs its
    own get_db override and restores the previous one on __aexit__, so two
    clients can be alive simultaneously without clobbering each other's
    session factory — required for the concurrency test below."""

    class _Client(AsyncClient):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            self._prev_override = None
            self._installed = False

        async def __aenter__(self):
            async def _get_db():
                async with session_factory() as s:
                    yield s

            self._prev_override = app.dependency_overrides.get(get_db)
            app.dependency_overrides[get_db] = _get_db
            self._installed = True
            return await super().__aenter__()

        async def __aexit__(self, *exc):
            result = await super().__aexit__(*exc)
            if self._installed:
                if self._prev_override is not None:
                    app.dependency_overrides[get_db] = self._prev_override
                else:
                    app.dependency_overrides.pop(get_db, None)
            return result

    headers = {}
    if user_id is not None:
        headers["Authorization"] = f"Bearer {create_access_token({'sub': str(user_id)})}"
    return _Client(transport=ASGITransport(app=app), base_url="http://t", headers=headers)


async def _snapshot(s: AsyncSession, uid: str) -> dict:
    inc = (await s.execute(select(Incident).where(Incident.uid == uid))).scalars().one()
    acts = (await s.execute(
        select(IncidentActivity).where(IncidentActivity.incident_uid == uid)
        .order_by(IncidentActivity.id)
    )).scalars().all()
    return {
        "status": inc.status, "severity": inc.severity,
        "resolved_at": inc.resolved_at, "closed_at": inc.closed_at,
        "updated_at": inc.updated_at,
        "activity": [(a.action, a.detail) for a in acts],
        "recurrence_of_uid": inc.recurrence_of_uid,
        "episode_number": inc.episode_number,
    }


# ---------------------------------------------------------------------------
async def test_active_incident_receives_evidence_in_place(session_factory):
    """While ACTIVE, a second matching alert updates the SAME episode."""
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r1 = await c.post("/api/incidents", json={
            "title": "Ransomware beacon", "severity": "high", "alert_uid": "ALR-000001"})
        assert r1.status_code == 201, r1.text
        uid = r1.json()["incident"]["uid"]
        assert r1.json()["incident"]["episode_number"] == 1
        r2 = await c.post("/api/incidents", json={
            "title": "Ransomware beacon", "severity": "high", "alert_uid": "ALR-000002"})
        assert r2.status_code == 201, r2.text
        assert r2.json()["reused"] is True
        assert r2.json()["incident"]["uid"] == uid  # same episode, not duplicated


async def test_resolution_then_new_evidence_creates_new_episode(session_factory):
    """Decision 3: post-resolution evidence opens a new episode; the resolved
    historical incident must be completely untouched."""
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r1 = await c.post("/api/incidents", json={
            "title": "Ransomware beacon", "severity": "high", "alert_uid": "ALR-000001"})
        uid1 = r1.json()["incident"]["uid"]
        # resolve it through the existing transition API
        rt = await c.put(f"/api/incidents/{uid1}/status", json={"status": "resolved"})
        assert rt.status_code == 200, rt.text

    async with session_factory() as s:
        before = await _snapshot(s, uid1)
    assert before["status"] == "resolved"

    # New alert arrives AFTER resolution -> new episode, NOT a reopen.
    async with client_for(session_factory, 1) as c:
        r2 = await c.post("/api/incidents", json={
            "title": "Ransomware beacon", "severity": "high", "alert_uid": "ALR-000002"})
        assert r2.status_code == 201, r2.text
        body = r2.json()
        assert body.get("reused") in (None, False)
        uid2 = body["incident"]["uid"]
        assert uid2 != uid1
        assert body["incident"]["episode_number"] == 2
        assert body["incident"]["recurrence_of_uid"] == uid1

    async with session_factory() as s:
        after = await _snapshot(s, uid1)
        new = await _snapshot(s, uid2)
    # historical incident byte-for-byte identical
    assert after == before, f"resolved incident mutated: {before} -> {after}"
    assert new["status"] == "open"
    assert new["recurrence_of_uid"] == uid1


async def test_closed_incident_not_reopened_by_alert_path(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r1 = await c.post("/api/incidents", json={
            "title": "Ransomware beacon", "severity": "high", "alert_uid": "ALR-000001"})
        uid1 = r1.json()["incident"]["uid"]
        await c.put(f"/api/incidents/{uid1}/status", json={"status": "resolved"})
        rt = await c.put(f"/api/incidents/{uid1}/status", json={"status": "closed"})
        assert rt.status_code == 200, rt.text
        r2 = await c.post("/api/incidents", json={
            "title": "Ransomware beacon", "severity": "high", "alert_uid": "ALR-000002"})
        uid2 = r2.json()["incident"]["uid"]
        assert uid2 != uid1
    async with session_factory() as s:
        inc1 = (await s.execute(select(Incident).where(Incident.uid == uid1))).scalars().one()
        assert inc1.status == "closed"  # untouched by the new episode


async def test_tenant_scoping_same_key_other_org_is_separate(session_factory):
    """Explicit org scoping: foreign-org alert with identical title/resource
    must not match Acme's active episode."""
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r1 = await c.post("/api/incidents", json={
            "title": "Ransomware beacon", "severity": "high", "alert_uid": "ALR-000001"})
        uid_acme = r1.json()["incident"]["uid"]
    pa_headers_user = 4  # foreign admin cannot even see acme's incident, but can open own
    async with client_for(session_factory, pa_headers_user) as c:
        r2 = await c.post("/api/incidents", json={
            "title": "Ransomware beacon", "severity": "high", "alert_uid": "ALR-000009"})
        assert r2.status_code == 201, r2.text
        uid_foreign = r2.json()["incident"]["uid"]
        assert uid_foreign != uid_acme
        assert r2.json().get("reused") in (None, False)
    async with session_factory() as s:
        inc_f = (await s.execute(select(Incident).where(Incident.uid == uid_foreign))).scalars().one()
        assert inc_f.org_id == 3
        assert inc_f.recurrence_of_uid is None  # no cross-org lineage leak


async def test_manual_creation_still_compatible(session_factory):
    """Manual route without alert_uid behaves exactly as before (201, new rec)."""
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/incidents", json={
            "title": "Suspicious USB activity", "severity": "medium"})
        assert r.status_code == 201, r.text
        assert r.json()["incident"]["status"] == "open"
        assert r.json()["incident"]["episode_number"] == 1


async def test_permissions_preserved(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory) as c:
        r = await c.post("/api/incidents", json={"title": "Needle incident", "severity": "low"})
        assert r.status_code in (401, 403)
    async with client_for(session_factory, 2) as c:  # client_user
        r = await c.post("/api/incidents", json={"title": "Needle incident", "severity": "low"})
        assert r.status_code == 403


async def test_concurrent_duplicate_active_episode_prevented(session_factory):
    """Two racing alert-driven creations for the same (org, dedup_key) must
    converge to exactly ONE active episode via the partial unique index +
    savepoint recovery path."""
    await _seed(session_factory)

    async def one(alert_uid: str):
        async with client_for(session_factory, 1) as c:
            r = await c.post("/api/incidents", json={
                "title": "Ransomware beacon", "severity": "high", "alert_uid": alert_uid})
            assert r.status_code == 201, r.text
            return r.json()["incident"]["uid"], r.json().get("reused", False)

    # Force real interleaving on the shared StaticPool connection.
    results = await asyncio.gather(one("ALR-000001"), one("ALR-000002"))
    uids = {u for u, _ in results}
    async with session_factory() as s:
        actives = (await s.execute(
            select(Incident).where(
                Incident.org_id == 1,
                Incident.title == "Ransomware beacon",
                Incident.status.notin_(["resolved", "closed"]))
        )).scalars().all()
    assert len(actives) == 1, f"expected single active episode, got {[a.uid for a in actives]}"
    # Both requests reference the same surviving episode
    assert len(uids) == 1, f"racers returned different uids: {uids}"


async def test_uid_counter_no_duplicates(session_factory):
    """Atomic INC uid allocation: sequential creations get distinct uids."""
    await _seed(session_factory)
    seen = set()
    async with client_for(session_factory, 1) as c:
        for i in range(5):
            r = await c.post("/api/incidents", json={
                "title": f"Distinct incident {i}", "severity": "low"})
            assert r.status_code == 201, r.text
            seen.add(r.json()["incident"]["uid"])
    assert len(seen) == 5
