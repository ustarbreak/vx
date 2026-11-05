"""Security Ops dispatch validation, authorization and tenant isolation tests."""
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
from app.models import Organization, User, SecurityOpsTask
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
            User(id=2, email="admin@two.example", hashed_password=get_password_hash("pw"),
                 name="Tenant Two Admin", role="client_admin", org_id=2),
            User(id=3, email="analyst@one.example", hashed_password=get_password_hash("pw"),
                 name="Analyst", role="analyst", org_id=1),
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
async def test_security_action_requires_authentication(session_factory):
    await seed(session_factory)
    async with client_for(session_factory) as client:
        response = await client.post("/api/security-ops/actions", json={
            "service": "endpoint-protection", "action_id": "ep-isolate",
        })
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_security_action_requires_client_admin(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 3) as client:
        response = await client.post("/api/security-ops/actions", json={
            "service": "endpoint-protection", "action_id": "ep-isolate",
        })
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_unknown_action_id_is_rejected_even_with_valid_service_prefix(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.post("/api/security-ops/actions", json={
            "service": "cloud-security", "action_id": "cloud-delete-everything",
        })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_action_prefix_must_match_service(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.post("/api/security-ops/actions", json={
            "service": "cloud-security", "action_id": "ep-isolate",
        })
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_email_security_catalog_uses_frontend_em_prefix(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.post("/api/security-ops/actions", json={
            "service": "email-security", "action_id": "em-header-analysis",
        })
    assert response.status_code == 200, response.text
    assert response.json()["task"]["status"] == "manual"
    assert "no device command was sent" in response.json()["message"].lower()


@pytest.mark.asyncio
async def test_valid_dispatch_is_tenant_scoped_and_persisted(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.post("/api/security-ops/actions", json={
            "service": "endpoint-protection", "action_id": "ep-isolate",
            "params": {"host": "workstation-01", "api_token": "must-not-persist"},
        })
        assert response.status_code == 200, response.text
        assert response.json()["ok"] is True
        own = await client.get("/api/security-ops/tasks")
        assert own.status_code == 200
        assert len(own.json()) == 1
        assert own.json()[0]["org_id"] == 1
        assert own.json()[0]["status"] == "queued"
    async with client_for(session_factory, 2) as other:
        foreign = await other.get("/api/security-ops/tasks")
        assert foreign.status_code == 200
        assert foreign.json() == []
    async with session_factory() as db:
        task = (await db.execute(__import__("sqlalchemy").select(SecurityOpsTask))).scalars().one()
        assert task.params.get("api_token") is None
        assert task.params["host"] == "workstation-01"
