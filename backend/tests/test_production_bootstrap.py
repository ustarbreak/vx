"""Production bootstrap must never create the public demo administrator."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from app.models import User
from app.core.security import get_password_hash
from app.services.seed import ensure_platform_admin


class _Scalars:
    def first(self):
        return None


class _Result:
    def scalars(self):
        return _Scalars()


class _Session:
    def __init__(self):
        self.added = []
        self.committed = False

    async def execute(self, _statement):
        return _Result()

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        self.committed = True


@pytest.mark.asyncio
async def test_production_bootstrap_refuses_missing_admin_credentials(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("PLATFORM_ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("PLATFORM_ADMIN_PASSWORD", raising=False)

    with pytest.raises(RuntimeError, match="set PLATFORM_ADMIN_EMAIL"):
        await ensure_platform_admin(_Session())


@pytest.mark.asyncio
async def test_production_bootstrap_refuses_weak_default_password(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("PLATFORM_ADMIN_EMAIL", "owner@example.com")
    monkeypatch.setenv("PLATFORM_ADMIN_PASSWORD", "Admin#2026")

    with pytest.raises(RuntimeError, match="at least 16 characters"):
        await ensure_platform_admin(_Session())


@pytest.mark.asyncio
async def test_production_bootstrap_uses_operator_supplied_credentials(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("PLATFORM_ADMIN_EMAIL", "owner@example.com")
    monkeypatch.setenv("PLATFORM_ADMIN_PASSWORD", "a-unique-long-secret-2026!")

    db = _Session()
    await ensure_platform_admin(db)

    assert db.committed is True
    assert len(db.added) == 1
    admin = db.added[0]
    assert isinstance(admin, User)
    assert admin.email == "owner@example.com"
    assert admin.hashed_password != "a-unique-long-secret-2026!"


def test_production_settings_reject_known_default_secret():
    from pydantic import ValidationError
    from app.core.config import Settings

    with pytest.raises(ValidationError, match="SECRET_KEY"):
        Settings(
            APP_ENV="production",
            SECRET_KEY="your-super-secret-key-change-in-production-min-32-chars",
            DATABASE_URL="postgresql+asyncpg://user:password@db:5432/app",
            CORS_ORIGINS=["https://app.example.com"],
            CONNECTOR_TLS_VERIFY=True,
        )


def test_production_settings_reject_insecure_transport_and_wildcard_cors():
    from pydantic import ValidationError
    from app.core.config import Settings

    with pytest.raises(ValidationError, match="CONNECTOR_TLS_VERIFY"):
        Settings(
            APP_ENV="production",
            SECRET_KEY="a-unique-production-secret-value-0123456789",
            DATABASE_URL="postgresql+asyncpg://user:password@db:5432/app",
            CORS_ORIGINS=["*"],
            CONNECTOR_TLS_VERIFY=False,
        )


def test_production_settings_accept_explicit_secure_configuration():
    from app.core.config import Settings

    settings = Settings(
        APP_ENV="production",
        SECRET_KEY="a-unique-production-secret-value-0123456789",
        DATABASE_URL="postgresql+asyncpg://user:password@db:5432/app",
        CORS_ORIGINS=["https://app.example.com"],
        CONNECTOR_TLS_VERIFY=True,
    )
    assert settings.APP_ENV == "production"


@pytest.mark.asyncio
async def test_production_bootstrap_rejects_existing_default_admin(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    existing = User(
        email="admin@infracentra.io",
        name="Platform Administrator",
        role="platform_admin",
        hashed_password=get_password_hash("Admin#2026"),
        status="active",
        mfa_enabled=False,
    )
    with pytest.raises(RuntimeError, match="still uses the documented default password"):
        await ensure_platform_admin(_Session(existing=existing))
