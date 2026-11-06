"""Production startup must rely on explicit Alembic migrations."""
from unittest.mock import AsyncMock
import pytest
from app import main

class _Session:
    async def commit(self):
        return None

class _SessionContext:
    async def __aenter__(self):
        return _Session()
    async def __aexit__(self, *_args):
        return None

@pytest.mark.asyncio
async def test_production_lifespan_does_not_call_create_all(monkeypatch):
    monkeypatch.setattr(main.settings, "APP_ENV", "production")
    monkeypatch.setattr(main, "ensure_platform_admin", AsyncMock())
    monkeypatch.setattr(main, "encrypt_legacy_integration_secrets", AsyncMock())
    monkeypatch.setattr(main, "ensure_demo_accounts", AsyncMock())
    from app.services import seed
    monkeypatch.setattr(seed, "ensure_grouping_policy", AsyncMock())
    monkeypatch.setattr(seed, "ensure_uid_counters", AsyncMock())
    monkeypatch.setattr(seed, "ensure_triage_policy", AsyncMock())
    monkeypatch.setattr(main, "init_db", AsyncMock(side_effect=AssertionError("create_all must not run")))
    monkeypatch.setattr(main, "AsyncSessionLocal", lambda: _SessionContext())
    monkeypatch.setattr(main, "_escalation_loop", AsyncMock())
    monkeypatch.setattr(main, "_evidence_retention_loop", AsyncMock())
    monkeypatch.setattr(main, "_soar_recovery_loop", AsyncMock())
    app = main.FastAPI()
    async with main.lifespan(app):
        pass
