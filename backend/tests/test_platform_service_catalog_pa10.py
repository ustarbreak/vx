"""PA-10 tests for persisted service catalog and plan entitlement controls."""
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
from app.models import AuditLog, Organization, PlanEntitlementV2, PlatformSetting, User
from app.main import app


@pytest_asyncio.fixture()
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        db.add_all([
            Organization(id=1, name="Tenant One", tier="sme", status="active",
                         contact_email="tenant@example.com"),
            User(id=1, email="owner@example.com", hashed_password=get_password_hash("test-password"),
                 name="Owner", role="platform_admin", org_id=None),
            User(id=2, email="staff@example.com", hashed_password=get_password_hash("test-password"),
                 name="Platform User", role="platform_user", org_id=None),
            PlanEntitlementV2(plan="pro", service_id="analytics", included=True),
        ])
        await db.commit()
    yield factory
    await engine.dispose()


def _client(factory, user_id: int):
    async def override_db():
        async with factory() as db:
            yield db
    app.dependency_overrides[get_db] = override_db
    token = create_access_token({"sub": str(user_id), "ver": 0})
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
                       headers={"Authorization": f"Bearer {token}"})


@pytest.mark.asyncio
async def test_owner_can_manage_catalog_and_plan_entitlements(session_factory):
    async with _client(session_factory, 1) as owner:
        catalog = await owner.get("/api/services/platform-catalog")
        assert catalog.status_code == 200, catalog.text
        assert any(row["service_id"] == "analytics" for row in catalog.json()["services"])

        changed = await owner.patch("/api/services/platform-catalog/analytics", json={
            "active": False, "label": "Analytics Disabled"
        })
        assert changed.status_code == 200, changed.text
        assert changed.json()["active"] is False

        plan = await owner.put("/api/services/platform-catalog/plans/pro", json={
            "service_ids": ["analytics"]
        })
        assert plan.status_code == 200, plan.text
        assert plan.json()["service_ids"] == ["analytics"]

        # Disabled catalog entries must not be advertised as purchasable plan services.
        subscription_catalog = await owner.get("/api/platform/subscriptions/catalog")
        assert subscription_catalog.status_code == 200
        pro = next((row for row in subscription_catalog.json()["plans"] if row["code"] == "pro"), None)
        assert pro is None or "analytics" not in pro["services"]

    async with session_factory() as db:
        setting = await db.get(PlatformSetting, "platform.service_catalog")
        assert setting.value_json["analytics"]["active"] is False
        plan_rows = (await db.execute(select(PlanEntitlementV2).where(
            PlanEntitlementV2.plan == "pro"
        ))).scalars().all()
        assert [row.service_id for row in plan_rows] == ["analytics"]
        actions = (await db.execute(select(AuditLog.action))).scalars().all()
        assert "platform.service_catalog.updated" in actions
        assert "platform.plan_entitlements.replaced" in actions


@pytest.mark.asyncio
async def test_platform_user_cannot_manage_service_catalog(session_factory):
    async with _client(session_factory, 2) as staff:
        read = await staff.get("/api/services/platform-catalog")
        update = await staff.patch("/api/services/platform-catalog/analytics", json={"active": False})
        assert read.status_code == 403
        assert update.status_code == 403


@pytest.mark.asyncio
async def test_plan_matrix_rejects_unknown_services_and_duplicate_ids(session_factory):
    async with _client(session_factory, 1) as owner:
        unknown = await owner.put("/api/services/platform-catalog/plans/pro", json={
            "service_ids": ["not-a-real-service"]
        })
        duplicate = await owner.put("/api/services/platform-catalog/plans/pro", json={
            "service_ids": ["analytics", "analytics"]
        })
        assert unknown.status_code == 422
        assert duplicate.status_code == 422
