"""Production bootstrap must never create the public demo administrator."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from app.models import User
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
