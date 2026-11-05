"""Invitation authorization and tenant-isolation regression tests."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

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
from app.models import Organization, User, Invitation
from app.main import app
from app.services import invitations as invitation_service


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
            User(id=2, email="admin@two.example", hashed_password=get_password_hash("pw"),
                 name="Tenant Two Admin", role="client_admin", org_id=2),
            User(id=3, email="analyst@one.example", hashed_password=get_password_hash("pw"),
                 name="Analyst", role="analyst", org_id=1),
            User(id=4, email="platform@example.com", hashed_password=get_password_hash("pw"),
                 name="Platform Admin", role="platform_admin", org_id=None),
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


@pytest.fixture(autouse=True)
def fake_mail(monkeypatch):
    monkeypatch.setattr(invitation_service.transports, "send_email",
                        lambda *args, **kwargs: {"ok": True})


@pytest.mark.asyncio
async def test_invitation_requires_authentication(session_factory):
    await seed(session_factory)
    async with client_for(session_factory) as client:
        response = await client.post("/api/invitations", json={"email": "new@example.com"})
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_client_admin_cannot_invite_into_another_tenant(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.post("/api/invitations", json={
            "email": "new@example.com", "role": "technician", "org_id": 2,
        })
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_non_admin_cannot_create_invitations(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 3) as client:
        response = await client.post("/api/invitations", json={
            "email": "new@example.com", "role": "technician",
        })
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_client_admin_cannot_escalate_invited_role(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.post("/api/invitations", json={
            "email": "promoted@example.com", "role": "platform_admin",
        })
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_client_admin_can_invite_allowed_role_to_own_tenant(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.post("/api/invitations", json={
            "email": "  New.User@Example.com ", "role": "technician",
        })
        assert response.status_code == 201, response.text
        assert response.json()["email"] == "new.user@example.com"
        listed = await client.get("/api/invitations")
        assert listed.status_code == 200
        assert len(listed.json()) == 1
        assert listed.json()[0]["role"] == "technician"


@pytest.mark.asyncio
async def test_pending_invitation_cannot_be_reused_across_tenants(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as first:
        created = await first.post("/api/invitations", json={
            "email": "shared@example.com", "role": "technician",
        })
        assert created.status_code == 201
    async with client_for(session_factory, 2) as second:
        conflict = await second.post("/api/invitations", json={
            "email": "shared@example.com", "role": "technician",
        })
    assert conflict.status_code == 409


@pytest.mark.asyncio
async def test_platform_admin_must_select_existing_organization(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 4) as client:
        missing = await client.post("/api/invitations", json={
            "email": "new@example.com", "role": "client_admin",
        })
        unknown = await client.post("/api/invitations", json={
            "email": "new@example.com", "role": "client_admin", "org_id": 999,
        })
    assert missing.status_code == 422
    assert unknown.status_code == 404


@pytest.mark.asyncio
async def test_client_admin_cannot_invite_another_client_admin(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.post("/api/invitations", json={
            "email": "admin2@example.com", "role": "client_admin",
        })
    assert response.status_code == 403



@pytest.mark.asyncio
async def test_non_admin_cannot_list_or_resend_invitations(session_factory):
    await seed(session_factory)
    async with session_factory() as db:
        db.add(Invitation(org_id=1, email="pending@example.com", role="technician",
                          token="test-token", status="pending"))
        await db.commit()
    async with client_for(session_factory, 3) as client:
        listed = await client.get("/api/invitations")
        resent = await client.post("/api/invitations/1/resend")
    assert listed.status_code == 403
    assert resent.status_code == 403



@pytest.mark.asyncio
async def test_accepted_invitation_cannot_be_resent(session_factory):
    await seed(session_factory)
    async with session_factory() as db:
        db.add(Invitation(org_id=1, email="accepted@example.com", role="technician",
                          token="accepted-token", status="accepted"))
        await db.commit()
    async with client_for(session_factory, 1) as client:
        response = await client.post("/api/invitations/1/resend")
    assert response.status_code == 409
