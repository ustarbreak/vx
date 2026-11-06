"""Platform Owner control-plane API and invitation regression tests."""
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
from app.models import Organization, User, PlatformStaffInvitation
from app.main import app


@pytest_asyncio.fixture()
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        db.add(Organization(id=1, name="Client One", tier="sme", status="active", contact_email="client@example.com",
                            monthly_revenue=1200, plan_tier="STARTER"))
        db.add(User(id=1, email="owner@example.com", hashed_password=get_password_hash("OwnerPassword!123"),
                    name="Owner", role="platform_admin", org_id=None, status="active"))
        await db.commit()
    yield factory
    await engine.dispose()


def make_client(factory, user_id=1):
    async def override_db():
        async with factory() as db:
            yield db
    app.dependency_overrides[get_db] = override_db
    headers = {"Authorization": f"Bearer {create_access_token({'sub': str(user_id), 'ver': 0})}"}
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers)


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_owner_can_invite_platform_staff_and_token_is_hashed(session_factory):
    async with make_client(session_factory) as client:
        response = await client.post("/api/platform/access/invitations", json={
            "email": "analyst@example.com", "name": "SOC Analyst", "role": "platform_analyst"})
        assert response.status_code == 201, response.text
        body = response.json()
        assert "token=" in body["activation_url"]
        async with session_factory() as db:
            invitation = await db.get(PlatformStaffInvitation, body["id"])
            assert invitation.token_hash not in body["activation_url"]
            assert len(invitation.token_hash) == 64
            assert invitation.accepted_at is None


@pytest.mark.asyncio
async def test_platform_invitation_is_single_use_and_creates_unscoped_staff(session_factory):
    async with make_client(session_factory) as client:
        invited = await client.post("/api/platform/access/invitations", json={
            "email": "lead@example.com", "name": "Platform Lead", "role": "platform_expert"})
        assert invited.status_code == 201
        token = invited.json()["activation_url"].split("token=", 1)[1]
        accepted = await client.post("/api/platform/access/invitations/accept", json={
            "token": token, "password": "StrongPassword!2026"})
        assert accepted.status_code == 201, accepted.text
        assert accepted.json()["role"] == "platform_expert"
        again = await client.post("/api/platform/access/invitations/accept", json={
            "token": token, "password": "StrongPassword!2026"})
        assert again.status_code == 404
        async with session_factory() as db:
            staff = (await db.execute(__import__("sqlalchemy").select(User).where(
                User.email == "lead@example.com"))).scalar_one()
            assert staff.org_id is None
            assert staff.status == "active"


@pytest.mark.asyncio
async def test_platform_admin_overview_billing_and_unconfigured_connector_health(session_factory):
    async with make_client(session_factory) as client:
        overview = await client.get("/api/platform/admin/overview")
        assert overview.status_code == 200, overview.text
        assert overview.json()["kpis"]["tenants_total"] == 1
        assert overview.json()["kpis"]["mrr_recorded"] == 1200
        billing = await client.get("/api/platform/admin/billing?period=2026-11")
        assert billing.status_code == 200, billing.text
        assert billing.json()["summary"]["recorded_mrr"] == 1200
        health = await client.get("/api/platform/admin/health")
        assert health.status_code == 200, health.text
        assert health.json()["database"]["status"] == "healthy"
        assert health.json()["connectors"]["status"] == "not_configured"
