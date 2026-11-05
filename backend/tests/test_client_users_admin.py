"""Client Admin team-directory API authorization and tenant-scope tests."""
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
from app.models import Organization, User, AuditLog
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
            User(id=2, email="tech@one.example", hashed_password=get_password_hash("pw"),
                 name="Technician", role="technician", org_id=1),
            User(id=3, email="admin@two.example", hashed_password=get_password_hash("pw"),
                 name="Tenant Two Admin", role="client_admin", org_id=2),
            User(id=4, email="tech@two.example", hashed_password=get_password_hash("pw"),
                 name="Foreign Technician", role="technician", org_id=2),
            User(id=5, email="analyst@one.example", hashed_password=get_password_hash("pw"),
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
async def test_client_admin_user_list_is_tenant_scoped(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.get("/api/users/")
    assert response.status_code == 200
    assert {row["id"] for row in response.json()} == {1, 2, 5}


@pytest.mark.asyncio
async def test_client_admin_can_change_own_tenant_member_role_and_status(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.patch("/api/users/2", json={
            "role": "analyst", "status": "inactive",
        })
    assert response.status_code == 200, response.text
    assert response.json()["role"] == "analyst"
    assert response.json()["status"] == "inactive"
    async with session_factory() as db:
        logs = (await db.execute(__import__("sqlalchemy").select(AuditLog))).scalars().all()
        assert any(log.action == "user.updated" and log.org_id == 1 for log in logs)


@pytest.mark.asyncio
async def test_client_admin_cannot_modify_foreign_tenant_user(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.patch("/api/users/4", json={"status": "inactive"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_client_admin_cannot_assign_privileged_role(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.patch("/api/users/2", json={"role": "platform_admin"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_client_admin_cannot_change_another_client_admin(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.patch("/api/users/3", json={"status": "inactive"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_user_cannot_change_own_role_or_status(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.patch("/api/users/1", json={"status": "inactive"})
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_non_admin_cannot_manage_team_members(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 5) as client:
        response = await client.patch("/api/users/2", json={"status": "inactive"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_invalid_user_status_is_rejected(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.patch("/api/users/2", json={"status": "deleted"})
    assert response.status_code == 422
