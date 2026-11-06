"""Regression coverage for Wazuh provider response safety and provider lookup."""
import pytest

from app.platform.connectors.models import JobState
from app.platform.connectors.providers import wazuh as _wazuh
from app.platform.connectors.providers.wazuh import WazuhProvider
from app.platform.connectors.base import get_provider


@pytest.mark.asyncio
async def test_wazuh_isolation_fails_closed_without_verified_active_response():
    provider = WazuhProvider({})
    result = await provider.execute("endpoint.isolate", {"agent_id": "001"}, dry_run=False)
    assert result.state == JobState.unsupported
    assert result.data["executed"] is False
    assert result.data["requires"] == "verified_wazuh_active_response"
    assert "no device action was sent" in result.message.lower()


@pytest.mark.asyncio
async def test_wazuh_isolation_dry_run_never_sends_device_request():
    provider = WazuhProvider({})
    result = await provider.execute("endpoint.isolate", {"agent_id": "001"}, dry_run=True)
    assert result.state == JobState.dry_run
    assert result.data["executed"] is False
    assert "no device request was sent" in result.message.lower()


def test_provider_can_be_resolved_by_service_id():
    provider = get_provider("endpoint-protection", {"api_endpoint": "https://wazuh.invalid"})
    assert isinstance(provider, WazuhProvider)


@pytest.mark.asyncio
async def test_wazuh_detections_are_filtered_to_the_tenant_agent_group(monkeypatch):
    class FakeWazuhService:
        def __init__(self, *args, **kwargs):
            self.group = None

        async def get_agents(self, org_id=None):
            self.group = org_id
            return [{"id": "001", "name": "tenant-one-host"}]

        async def get_alerts(self, **kwargs):
            return [
                {"id": "alert-1", "_source": {"id": "alert-1", "description": "owned",
                 "agent": {"id": "001", "name": "tenant-one-host"}, "level": 10}},
                {"id": "alert-2", "_source": {"id": "alert-2", "description": "foreign",
                 "agent": {"id": "002", "name": "tenant-two-host"}, "level": 12}},
            ]

        async def close(self):
            return None

    monkeypatch.setattr("app.platform.connectors.providers.wazuh.WazuhService", FakeWazuhService)
    provider = WazuhProvider({"api_endpoint": "https://wazuh.invalid", "org_id": 1})
    detections = await provider.fetch_detections()

    assert [d.id for d in detections] == ["alert-1"]
    assert detections[0].org_id == 1
