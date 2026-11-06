"""P5 reporting contract, tenant isolation and export regression tests."""
from __future__ import annotations

import os
import sys
import zipfile
from io import BytesIO

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.compiler import compiles

@compiles(postgresql.JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw):
    return "JSON"

from app.database import Base, get_db
from app.core.security import create_access_token, get_password_hash
from app.models import Organization, User
from app.models_reporting import RptExportLog
from app.main import app
from app.routers import reports


@pytest_asyncio.fixture()
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        db.add_all([
            Organization(id=1, name="Tenant One", tier="sme", status="active", contact_email="one@example.com"),
            Organization(id=2, name="Tenant Two", tier="sme", status="active", contact_email="two@example.com"),
            User(id=1, email="owner@example.com", hashed_password=get_password_hash("pw"),
                 name="Owner", role="platform_admin", org_id=None),
            User(id=5, email="tenant@example.com", hashed_password=get_password_hash("pw"),
                 name="Tenant Admin", role="client_admin", org_id=1),
        ])
        await db.commit()
    yield factory
    await engine.dispose()


def client_for(factory, user_id):
    async def override_db():
        async with factory() as db:
            yield db
    app.dependency_overrides[get_db] = override_db
    headers = {"Authorization": f"Bearer {create_access_token({'sub': str(user_id), 'ver': 0})}"}
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers)


@pytest.fixture(autouse=True)
def restore_overrides():
    yield
    app.dependency_overrides.clear()


def test_catalog_is_exactly_twenty_reports_and_sixty_two_pages():
    assert len(reports.dd.REPORTS) == 20
    assert sum(row[4] for row in reports.dd.REPORTS) == 62
    from app.services.reporting.builders import BUILDERS
    assert set(reports.BY_KEY) == set(BUILDERS)


def test_real_requests_never_resolve_to_demo_from_server_environment(monkeypatch):
    monkeypatch.setenv("REPORTING_DEMO", "1")
    assert reports._resolve_demo(0, "") is False
    assert reports._resolve_demo(1, "") is True


@pytest.mark.asyncio
async def test_tenant_cannot_request_another_tenants_report(session_factory, monkeypatch):
    async def live_builder(*args):
        return [
            ["Overview", "Live", [["M", "Source", [["ok", "o"]]]]]
        ]
    monkeypatch.setattr(reports, "_real_pages", live_builder)
    async with client_for(session_factory, 5) as client:
        response = await client.get("/api/v1/reports/tickets?period=2026-11&org_id=2")
        assert response.status_code == 403
        own = await client.get("/api/v1/reports/tickets?period=2026-11&org_id=1")
        assert own.status_code == 200
        assert own.json()["tenant_id"] == "1"


@pytest.mark.asyncio
async def test_owner_can_select_tenant_and_export_family_bundle(session_factory, monkeypatch):
    async def live_builder(*args):
        return [
            ["Overview", "Live source", [["M", "Source", [["verified", "o"]]]]]
        ]
    monkeypatch.setattr(reports, "_real_pages", live_builder)
    async with client_for(session_factory, 1) as client:
        response = await client.get("/api/v1/reports/bundle?scope=family&family=inc&period=2026-11&org_id=2")
        assert response.status_code == 200, response.text
        assert response.headers["content-type"].startswith("application/zip")
        archive = zipfile.ZipFile(BytesIO(response.content))
        names = archive.namelist()
        assert "manifest.json" in names
        assert len([n for n in names if n.endswith(".csv")]) == 3
        async with session_factory() as db:
            logs = (await db.execute(__import__("sqlalchemy").select(RptExportLog))).scalars().all()
            assert len(logs) == 3
            assert {x.tenant_id for x in logs} == {"2"}


@pytest.mark.asyncio
async def test_report_exports_csv_and_pdf_from_same_payload(session_factory, monkeypatch):
    async def live_builder(*args):
        return [
            ["Overview", "Live source", [["M", "Source", [["verified", "o"]]]]]
        ]
    monkeypatch.setattr(reports, "_real_pages", live_builder)
    async with client_for(session_factory, 1) as client:
        csv_response = await client.get("/api/v1/reports/tickets/export?format=csv&period=2026-11&org_id=2")
        pdf_response = await client.get("/api/v1/reports/tickets/export?format=pdf&period=2026-11&org_id=2")
        assert csv_response.status_code == 200
        assert csv_response.content.startswith(b"\xef\xbb\xbf")
        assert pdf_response.status_code == 200
        assert pdf_response.content.startswith(b"%PDF")
