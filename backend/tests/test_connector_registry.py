from __future__ import annotations
import os
import sys
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pytest
from app.platform.connectors.registry import ConnectorRegistry
from app.platform.connectors.models import JobState

def test_registry_discovers_registered_providers_and_manifest():
    entries = ConnectorRegistry().discover()
    assert "wazuh" in entries
    assert "mock" in entries
    assert entries["mock"].manifest.service_id == "mock"
    assert entries["mock"].manifest.module == "providers.mock"

@pytest.mark.asyncio
async def test_mock_provider_is_explicit_and_labels_synthetic_data():
    provider = ConnectorRegistry().create("mock", {"org_id": 17})
    assert provider is not None
    assert (await provider.probe())["synthetic"] is True
    detections = await provider.fetch_detections(limit=2)
    assert len(detections) == 2
    assert all(d.org_id == 17 and d.raw["synthetic"] for d in detections)
    result = await provider.execute("mock.echo", {"hello": "world"})
    assert result.state == JobState.succeeded
    assert result.data["synthetic"] is True

@pytest.mark.asyncio
async def test_mock_dry_run_has_no_execution_side_effect():
    provider = ConnectorRegistry().create("mock", {})
    result = await provider.execute("mock.echo", {"x": 1}, dry_run=True)
    assert result.state == JobState.dry_run
    assert result.data == {"synthetic": True}

def test_unknown_provider_is_not_fabricated():
    assert ConnectorRegistry().create("does-not-exist", {}) is None


@pytest.mark.asyncio
async def test_velociraptor_obeys_provider_contract_without_external_service():
    provider = ConnectorRegistry().create("endpoint-forensics", {})
    assert provider is not None
    assert [a.name for a in provider.actions()] == ["artifact.collect", "hunt.create"]
    health = await provider.probe()
    assert health["status"] == "not_configured"
    assert await provider.fetch_detections(limit=5) == []
