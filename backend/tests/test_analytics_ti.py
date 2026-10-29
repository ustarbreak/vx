"""Phase 4 — Security Analytics & Threat Intelligence endpoints.

Run from backend/:
  DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_analytics_ti.py -p no:libtmux -q

Honesty guarantees under test:
  * Every KPI comes from real Alert/Incident rows scoped to the tenant.
  * Duplicate events are NOT counted as independent detections (incidents are
    the deduped record; alert correlated_count is reported separately).
  * Empty window -> zeros + null MTTD/MTTR (never fake 0 durations).
  * Cross-tenant access is denied (403) for non-admin users.
  * /threat-intel/feeds/status never fabricates a feed: MISP "configured"
    only when an active Integration row with endpoint+key exists.
  * /threat-intel/matches returns ONLY IoCs actually stored on the tenant's
    incidents; empty list when nothing matches.
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
from app.models import Organization, User, Alert, Incident, Integration  # noqa: E402
from app.main import app  # noqa: E402
from app.services.analytics import clamp_window  # noqa: E402

NOW = datetime.now(timezone.utc).replace(tzinfo=None)


@pytest_asyncio.fixture()
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    # point the threat-intel service's own session maker at the test DB
    import app.database as database
    old = database.AsyncSessionLocal
    database.AsyncSessionLocal = factory
    yield factory
    database.AsyncSessionLocal = old
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
            # --- events (alerts) in window ---
            Alert(id=1, uid="ALR-1", org_id=1, title="Brute force", severity="high",
                  source="siem", resource="srv-01", correlated_count=5, created_at=NOW - timedelta(hours=2)),
            Alert(id=2, uid="ALR-2", org_id=1, title="Malware exec", severity="critical",
                  source="wazuh", resource="srv-01", correlated_count=1, created_at=NOW - timedelta(hours=3)),
            Alert(id=3, uid="ALR-3", org_id=1, title="Policy warn", severity="low",
                  source="syslog", resource="sw-02", correlated_count=2, created_at=NOW - timedelta(days=10)),
            # foreign tenant alert must never leak into org 1 metrics
            Alert(id=9, uid="ALR-9", org_id=3, title="Foreign", severity="critical",
                  source="siem", resource="other-host", correlated_count=1, created_at=NOW),
            # --- detections (incidents) in window ---
            Incident(id=1, uid="INC-1", org_id=1, title="Brute force campaign", severity="high",
                     status="investigating", category="intrusion", alert_id=1,
                     affected_assets=["srv-01"], ioc_related=["185.220.101.7"],
                     created_at=NOW - timedelta(hours=2),
                     acknowledged_at=NOW - timedelta(hours=1, minutes=46)),
            Incident(id=2, uid="INC-2", org_id=1, title="Malware on srv-01", severity="critical",
                     status="resolved", category="malware",
                     affected_assets=["srv-01"], ioc_related=[],
                     created_at=NOW - timedelta(hours=5), resolved_at=NOW - timedelta(hours=2, minutes=30)),
            Incident(id=9, uid="INC-9", org_id=3, title="Foreign incident", severity="low",
                     status="open", category="other", affected_assets=["h"], ioc_related=["evil.example"],
                     created_at=NOW),
            # inactive MISP integration -> feeds/status must say not configured
            Integration(id=1, name="MISP", service_id="threat-intel", integration_type="api",
                        status="inactive", license_type="open-source", pricing="free",
                        api_endpoint=None, api_key=None),
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
# Pure window validation
# ---------------------------------------------------------------------------
def test_clamp_window_boundaries():
    until = datetime(2026, 10, 27, 12, tzinfo=timezone.utc)
    s, u = clamp_window(None, until)
    assert u - s == timedelta(hours=24)                      # default window
    s, u = clamp_window(until, until - timedelta(hours=1))   # inverted -> swapped
    assert s == until - timedelta(hours=1) and u == until
    s, u = clamp_window(until - timedelta(days=400), until)  # oversized -> clamped
    assert (u - s) == timedelta(days=366)
    naive = datetime(2026, 10, 1, 0, 0)                     # naive treated as UTC
    s, u = clamp_window(naive, until)
    assert s.tzinfo is not None and u.tzinfo is not None


@pytest.mark.asyncio
async def test_overview_metrics_correctness(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/analytics/overview?since=" + (NOW - timedelta(days=1)).isoformat())
        assert r.status_code == 200
        body = r.json()
        ev = body["events"]
        # 2 alerts in the last day for org 1 (the 10-day-old one is outside);
        # foreign-tenant alert excluded by org scoping
        assert ev["total"] == 2
        assert ev["by_severity"]["high"] == 1 and ev["by_severity"]["critical"] == 1
        assert ev["raw_events_weighted"] == 6   # 5 correlated + 1, reported separately
        det = body["detections"]
        assert det["total"] == 2                # deduped incidents, not raw alerts
        assert det["by_category"]["intrusion"] == 1 and det["by_category"]["malware"] == 1
        assert det["by_status"]["investigating"] == 1 and det["by_status"]["resolved"] == 1
        # MTTR sample = INC-2: 5h -> 2.5h resolved = 150 min
        assert det["mttr_minutes"] == pytest.approx(150.0, abs=1.0)
        # MTTD sample = INC-1 acked 14 min after creation
        assert det["mttd_minutes"] == pytest.approx(14.0, abs=1.0)
        assert body["window"]["timezone"] == "UTC"
        assert any(a["resource"] == "srv-01" for a in body["top_assets"])
        assert body["top_assets"][0]["events"] == 2  # both in-window alerts hit srv-01
        # trend buckets present and consistent
        assert sum(b["events"] for b in body["trend"]) == ev["total"]
        assert sum(b["detections"] for b in body["trend"]) == det["total"]


@pytest.mark.asyncio
async def test_empty_dataset_and_no_fake_durations(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=3) as c:
        # org 3 has data but only for "now"; query a past empty window.
        # Pass params as a dict so httpx percent-encodes the "+" in the UTC
        # offset (raw isoformat() strings put "+00:00" in the URL, which
        # form-decodes to a space and fails server-side datetime parsing).
        since = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
        until = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        r = await c.get("/api/analytics/overview", params={"since": since, "until": until})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["events"]["total"] == 0 and body["detections"]["total"] == 0
        assert body["detections"]["mttr_minutes"] is None      # no sample => null
        assert body["detections"]["mttd_minutes"] is None
        assert body["trend"] == [] and body["top_assets"] == []
        assert body["data_freshness"] == "empty"


@pytest.mark.asyncio
async def test_tenant_isolation_and_auth(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/analytics/overview?site_org_id=3")
        assert r.status_code == 403           # cross-tenant denied
        r = await c.get("/api/analytics/overview")
        assert r.json()["org_id"] == 1
        assert "Foreign" not in str(r.json())
    async with client_for(session_factory, user_id=None) as c:
        r = await c.get("/api/analytics/overview")
        assert r.status_code in (401, 403)    # unauthorized


@pytest.mark.asyncio
async def test_feeds_status_never_fabricates(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/threat-intel/feeds/status")
        assert r.status_code == 200
        body = r.json()
        misp = next(f for f in body["feeds"] if f["name"] == "MISP")
        assert misp["configured"] is False     # inactive integration => honest NO
        otx = next(f for f in body["feeds"] if f["name"] == "AlienVault OTX")
        assert otx["kind"] == "public-on-demand"
        # secrets must never be exposed
        assert "api_key" not in str(body)


@pytest.mark.asyncio
async def test_indicator_matches_only_real_links(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/threat-intel/matches")
        body = r.json()
        inds = [m["indicator"] for m in body["matches"]]
        assert inds == ["185.220.101.7"]          # only org-1 incident IoC
        assert "evil.example" not in inds         # foreign tenant never leaks
        m = body["matches"][0]
        assert m["incident_uid"] == "INC-1" and m["assets"] == ["srv-01"]
        assert m["related_alert_uids"] == ["ALR-1", "ALR-2"]  # drill-down evidence
    async with client_for(session_factory, user_id=3) as c:
        r = await c.get("/api/threat-intel/matches")
        assert [m["indicator"] for m in r.json()["matches"]] == ["evil.example"]
