"""Production readiness endpoint checks critical dependencies."""
from unittest.mock import AsyncMock, MagicMock
import pytest
from app import main

class _Connection:
    async def __aenter__(self): return self
    async def __aexit__(self, *_args): return None
    async def execute(self, _statement): return 1

class _Engine:
    def connect(self): return _Connection()

@pytest.mark.asyncio
async def test_readiness_reports_ok_when_database_and_redis_are_available(monkeypatch):
    client = MagicMock()
    client.ping = AsyncMock(return_value=True)
    client.aclose = AsyncMock()
    monkeypatch.setattr(main, "engine", _Engine())
    monkeypatch.setattr("redis.asyncio.from_url", lambda *a, **k: client)
    result = await main.readiness_check()
    assert result == {"status": "ready", "checks": {"database": "ok", "redis": "ok"}}

@pytest.mark.asyncio
async def test_readiness_returns_503_when_redis_is_unavailable(monkeypatch):
    from fastapi.responses import JSONResponse
    client = MagicMock()
    client.ping = AsyncMock(side_effect=ConnectionError("secret endpoint detail"))
    client.aclose = AsyncMock()
    monkeypatch.setattr(main, "engine", _Engine())
    monkeypatch.setattr("redis.asyncio.from_url", lambda *a, **k: client)
    result = await main.readiness_check()
    assert isinstance(result, JSONResponse)
    assert result.status_code == 503
