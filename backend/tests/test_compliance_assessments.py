"""Evidence-backed compliance assessment API tenant-scope tests."""
from __future__ import annotations

import os
import sys

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
from app.models import Organization, User, ComplianceAssessment
from app.main import app


@pytest_asyncio.fixture()
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


async def seed(factory):
    async with factory() as db:
        db.add_all([
            Organization(id=1, name="Tenant One", tier="sme", status="active", contact_email="one@example.com"),
            Organization(id=2, name="Tenant Two", tier="sme", status="active", contact_email="two@example.com"),
            User(id=1, email="admin@one.example", hashed_password=get_password_hash("pw"),
                 name="Tenant One Admin", role="client_admin", org_id=1),
            User(id=2, email="analyst@one.example", hashed_password=get_password_hash("pw"),
                 name="Analyst", role="analyst", org_id=1),
            User(id=3, email="admin@two.example", hashed_password=get_password_hash("pw"),
                 name="Tenant Two Admin", role="client_admin", org_id=2),
        ])
        await db.commit()


def client_for(factory, user_id=None):
    async def get_test_db():
        async with factory() as db:
            yield db

    app.dependency_overrides[get_db] = get_test_db
    headers = {}
    if user_id is not None:
        headers["Authorization"] = f"Bearer {create_access_token({'sub': str(user_id)})}"
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers)


@pytest.mark.asyncio
async def test_compliance_controls_require_authentication(session_factory):
    await seed(session_factory)
    async with client_for(session_factory) as client:
        response = await client.get("/api/compliance/controls")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_controls_start_unassessed_and_tenant_scoped(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as first:
        rows = (await first.get("/api/compliance/controls")).json()
        assert len(rows) == 12
        assert all(row["status"] == "not_assessed" and row["score"] is None for row in rows)
        assert rows[0]["framework"] == "NIST CSF 2.0"
    async with client_for(session_factory, 3) as second:
        rows = (await second.get("/api/compliance/controls")).json()
        assert all(row["status"] == "not_assessed" for row in rows)


@pytest.mark.asyncio
async def test_assessment_requires_evidence_note_and_admin_role(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as admin:
        missing = await admin.patch("/api/compliance/controls/ID.AM-1", json={
            "status": "compliant", "evidence": "   ",
        })
    assert missing.status_code == 422
    async with client_for(session_factory, 2) as analyst:
        denied = await analyst.patch("/api/compliance/controls/ID.AM-1", json={
            "status": "compliant", "evidence": "Inventory export reviewed",
        })
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_assessment_persists_evidence_and_does_not_leak_between_tenants(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as first:
        updated = await first.patch("/api/compliance/controls/ID.AM-1", json={
            "status": "compliant", "evidence": "Reviewed asset register export dated 2026-11-05",
        })
        assert updated.status_code == 200, updated.text
        assert updated.json()["score"] == 100
        assert updated.json()["assessed_by"] == "admin@one.example"
        assert updated.json()["evidence"].startswith("Reviewed asset register")
    async with client_for(session_factory, 3) as second:
        rows = (await second.get("/api/compliance/controls")).json()
        control = next(row for row in rows if row["id"] == "ID.AM-1")
        assert control["status"] == "not_assessed"
        assert control["evidence"] == ""
    async with session_factory() as db:
        rows = (await db.execute(__import__("sqlalchemy").select(ComplianceAssessment))).scalars().all()
        assert len(rows) == 1 and rows[0].org_id == 1


@pytest.mark.asyncio
async def test_unknown_control_and_status_are_rejected(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        unknown = await client.patch("/api/compliance/controls/ID.NOT-REAL", json={
            "status": "compliant", "evidence": "reviewed",
        })
        invalid = await client.patch("/api/compliance/controls/ID.AM-1", json={
            "status": "verified", "evidence": "reviewed",
        })
    assert unknown.status_code == 404
    assert invalid.status_code == 422
