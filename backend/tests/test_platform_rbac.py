"""PA-02 platform RBAC foundation tests: direct API checks and scoped overrides."""
from __future__ import annotations
import os, sys
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
from app.core.platform_rbac import has_permission
from app.models import Organization, User
from app.main import app

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
            Organization(id=3, name="Partner One", tier="sme", status="active", contact_email="partner@example.com", is_partner=True),
            User(id=1, email="owner@example.com", hashed_password=get_password_hash("pw"), name="Owner", role="platform_admin", org_id=None),
            User(id=2, email="expert@example.com", hashed_password=get_password_hash("pw"), name="Expert", role="platform_expert", org_id=None),
            User(id=3, email="analyst@example.com", hashed_password=get_password_hash("pw"), name="Analyst", role="platform_analyst", org_id=None),
            User(id=4, email="staff@example.com", hashed_password=get_password_hash("pw"), name="User", role="platform_user", org_id=None),
            User(id=5, email="tenant@example.com", hashed_password=get_password_hash("pw"), name="Tenant Admin", role="client_admin", org_id=1),
        ])
        await db.commit()
    yield factory
    await engine.dispose()

def client_for(factory, user_id):
    async def override_db():
        async with factory() as db:
            yield db
    app.dependency_overrides[get_db] = override_db
    headers={"Authorization": f"Bearer {create_access_token({'sub': str(user_id)})}"}
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers)

@pytest.mark.asyncio
async def test_effective_access_returns_distinct_role_baselines(session_factory):
    async with client_for(session_factory, 2) as c:
        expert=(await c.get("/api/platform/access/me")).json()
        assert expert["role"] == "platform_expert"
        keys={p["key"] for p in expert["permissions"]}
        assert "platform.integrations.read" in keys
        assert "platform.access.manage" not in keys
    async with client_for(session_factory, 3) as c:
        analyst=(await c.get("/api/platform/access/me")).json()
        keys={p["key"] for p in analyst["permissions"]}
        assert "platform.audit.read" in keys
        assert "platform.integrations.configure" not in keys
    async with client_for(session_factory, 4) as c:
        staff=(await c.get("/api/platform/access/me")).json()
        assert {p["key"] for p in staff["permissions"]} == {"platform.dashboard.read"}

@pytest.mark.asyncio
async def test_owner_only_grant_management_and_audit(session_factory):
    async with client_for(session_factory, 2) as c:
        denied=await c.post("/api/platform/access/assignments", json={
            "user_id": 3, "permission_key": "platform.billing.read"
        })
        assert denied.status_code == 403
    async with client_for(session_factory, 1) as c:
        created=await c.post("/api/platform/access/assignments", json={
            "user_id": 3, "permission_key": "platform.billing.read",
            "effect": "allow", "scope_type": "tenant", "scope_id": 1
        })
        assert created.status_code == 201, created.text
        assignment=created.json()
        listed=await c.get("/api/platform/access/assignments?user_id=3")
        assert listed.status_code == 200
        assert any(x["id"] == assignment["id"] for x in listed.json())
        revoked=await c.delete(f"/api/platform/access/assignments/{assignment['id']}")
        assert revoked.status_code == 204

@pytest.mark.asyncio
async def test_scoped_grants_and_deny_precedence(session_factory):
    from app.models import PlatformPermissionAssignment
    async with session_factory() as db:
        analyst=await db.get(User, 3)
        db.add(PlatformPermissionAssignment(user_id=3, permission_key="platform.billing.read",
            effect="allow", scope_type="tenant", scope_id=1, granted_by=1))
        await db.commit()
        assert await has_permission(analyst, "platform.billing.read", db, org_id=1) is True
        assert await has_permission(analyst, "platform.billing.read", db, org_id=2) is False
        db.add(PlatformPermissionAssignment(user_id=3, permission_key="platform.billing.read",
            effect="deny", scope_type="tenant", scope_id=1, granted_by=1))
        await db.commit()
        assert await has_permission(analyst, "platform.billing.read", db, org_id=1) is False

@pytest.mark.asyncio
async def test_non_platform_user_cannot_read_platform_access(session_factory):
    async with client_for(session_factory, 5) as c:
        response=await c.get("/api/platform/access/me")
        assert response.status_code == 403
