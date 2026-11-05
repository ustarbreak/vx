"""PA-07 regression tests for the platform partner administration actions."""
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
            Organization(id=1, name="Partner One", tier="enterprise", status="active",
                         contact_email="partner@example.com", is_partner=True, partner_code="MSP-ONE"),
            Organization(id=2, name="End Client", tier="sme", status="active",
                         contact_email="client@example.com", parent_org_id=1),
            Organization(id=3, name="Empty Partner", tier="sme", status="active",
                         contact_email="empty@example.com", is_partner=True, partner_code="MSP-EMPTY"),
            User(id=1, email="owner@example.com", hashed_password=get_password_hash("test-password"),
                 name="Owner", role="platform_admin", org_id=None),
            User(id=2, email="partner@example.com", hashed_password=get_password_hash("test-password"),
                 name="Partner Admin", role="partner_admin", org_id=1),
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
async def test_partner_admin_patch_persists_contact_name_and_canonical_tier(session_factory):
    async with _client(session_factory, 1) as owner:
        updated = await owner.patch("/api/partners/1", json={
            "company": "Partner One Updated", "contact_name": "New Partner Contact",
            "contact_email": "new@example.com", "tier": "gold"
        })
        assert updated.status_code == 200, updated.text
        assert updated.json()["tier_override"] == "gold"

        migrated = await owner.post("/api/partners/1/migrate", json={"tier": "platinum"})
        assert migrated.status_code == 200, migrated.text
        assert migrated.json()["tier"] == "platinum"

        wrong_contract = await owner.post("/api/partners/1/migrate", json={"plan": "Scale"})
        assert wrong_contract.status_code == 422

    async with session_factory() as db:
        partner_admin = (await db.execute(select(User).where(User.id == 2))).scalar_one()
        partner = await db.get(Organization, 1)
        assert partner_admin.name == "New Partner Contact"
        assert partner.name == "Partner One Updated"
        assert partner.partner_tier_override == "platinum"


@pytest.mark.asyncio
async def test_partner_removal_refuses_attached_end_clients_and_soft_removes_empty_partner(session_factory):
    async with _client(session_factory, 1) as owner:
        blocked = await owner.delete("/api/partners/1")
        assert blocked.status_code == 409
        removed = await owner.delete("/api/partners/3")
        assert removed.status_code == 204

    async with session_factory() as db:
        partner = await db.get(Organization, 3)
        assert partner.is_partner is False
        assert partner.partner_code is None


@pytest.mark.asyncio
async def test_partner_admin_cannot_use_platform_partner_management_routes(session_factory):
    async with _client(session_factory, 2) as partner_admin:
        response = await partner_admin.patch("/api/partners/1", json={"company": "Unauthorized"})
        assert response.status_code == 403
