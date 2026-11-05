"""Project runbook persistence and tenant isolation tests."""
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
from app.models import Organization, User, Project, ProjectRunbook
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
            Project(id=10, org_id=1, name="Tenant One Project", created_by="admin@one.example"),
            Project(id=20, org_id=2, name="Tenant Two Project", created_by="admin@two.example"),
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
async def test_project_runbooks_require_authentication(session_factory):
    await seed(session_factory)
    async with client_for(session_factory) as client:
        response = await client.get("/api/projects/10/runbooks")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_project_runbook_crud_persists_checklist_state(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        created = await client.post("/api/projects/10/runbooks", json={
            "title": "Incident response procedure",
            "phase": "Response",
            "est_minutes": 45,
            "steps": [
                {"text": "Preserve evidence", "owner": "Analyst", "done": False},
                {"text": "Notify incident lead", "owner": "SOC", "done": False},
            ],
        })
        assert created.status_code == 201, created.text
        runbook_id = created.json()["id"]
        assert created.json()["steps"][0]["done"] is False

        updated = await client.patch(f"/api/projects/10/runbooks/{runbook_id}", json={
            "steps": [
                {"text": "Preserve evidence", "owner": "Analyst", "done": True},
                {"text": "Notify incident lead", "owner": "SOC", "done": False},
            ],
        })
        assert updated.status_code == 200, updated.text
        assert updated.json()["steps"][0]["done"] is True

        listed = await client.get("/api/projects/10/runbooks")
        assert listed.status_code == 200
        assert len(listed.json()) == 1
        assert listed.json()[0]["id"] == runbook_id

        deleted = await client.delete(f"/api/projects/10/runbooks/{runbook_id}")
        assert deleted.status_code == 204
        assert (await client.get("/api/projects/10/runbooks")).json() == []


@pytest.mark.asyncio
async def test_project_runbooks_are_tenant_isolated(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        assert (await client.get("/api/projects/20/runbooks")).status_code == 403
        created = await client.post("/api/projects/10/runbooks", json={
            "title": "Private procedure",
            "steps": [{"text": "Tenant one only"}],
        })
        assert created.status_code == 201
        runbook_id = created.json()["id"]
        assert (await client.get(f"/api/projects/20/runbooks/{runbook_id}")).status_code == 404
    async with client_for(session_factory, 2) as foreign:
        assert (await foreign.get("/api/projects/20/runbooks")).json() == []


@pytest.mark.asyncio
async def test_project_runbook_rejects_too_many_steps(session_factory):
    await seed(session_factory)
    async with client_for(session_factory, 1) as client:
        response = await client.post("/api/projects/10/runbooks", json={
            "title": "Oversized", "steps": [{"text": str(i)} for i in range(51)],
        })
    assert response.status_code == 422
