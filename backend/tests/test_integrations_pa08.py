"""PA-08 integration credential and connection-test regression tests."""
from __future__ import annotations

import os
import sys

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.core.security import create_access_token, get_password_hash
from app.models import AuditLog, Integration, User
from app.main import app


@pytest_asyncio.fixture()
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        db.add(User(id=1, email="owner@example.com", hashed_password=get_password_hash("test-password"),
                    name="Owner", role="platform_admin", org_id=None))
        await db.commit()
    yield factory
    await engine.dispose()


def _client(factory):
    async def override_db():
        async with factory() as db:
            yield db
    app.dependency_overrides[get_db] = override_db
    token = create_access_token({"sub": "1", "ver": 0})
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
                       headers={"Authorization": f"Bearer {token}"})


@pytest.mark.asyncio
async def test_integration_credentials_are_write_only_and_missing_wazuh_user_is_audited(session_factory):
    async with _client(session_factory) as client:
        created = await client.post("/api/integrations/", json={
            "name": "Wazuh", "service_id": "endpoint", "integration_type": "api",
            "license_type": "commercial", "pricing": "paid", "status": "active",
            "api_key": "sensitive-test-secret", "api_username": None,
            "api_endpoint": "https://wazuh.example.test", "notes": "integration test"
        })
        assert created.status_code == 201, created.text
        payload = created.json()
        assert "api_key" not in payload
        assert "sensitive-test-secret" not in created.text
        assert payload["api_username"] is None

        listed = await client.get("/api/integrations/")
        assert listed.status_code == 200
        assert "sensitive-test-secret" not in listed.text
        assert all("api_key" not in item for item in listed.json())

        tested = await client.post(f"/api/integrations/{payload['id']}/test")
        assert tested.status_code == 200
        assert tested.json()["success"] is False
        assert "username" in tested.json()["message"].lower() or "credentials" in tested.json()["message"].lower()

    async with session_factory() as db:
        row = await db.get(Integration, payload["id"])
        assert row.status == "inactive"
        actions = (await db.execute(select(AuditLog.action))).scalars().all()
        assert "integration.test_failed" in actions
