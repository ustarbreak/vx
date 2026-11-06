"""Wazuh provider must never confuse agent restart with network isolation."""
import pytest

from app.platform.connectors.models import JobState
from app.platform.connectors.providers.wazuh import WazuhProvider


@pytest.mark.asyncio
async def test_endpoint_isolation_fails_closed_until_active_response_is_verified():
    provider = WazuhProvider({})

    result = await provider.execute(
        "endpoint.isolate",
        {"agent_id": "001"},
        dry_run=False,
    )

    assert result.state == JobState.unsupported
    assert result.data == {
        "provider": "wazuh",
        "executed": False,
        "requires": "verified_wazuh_active_response",
    }
    assert "no device action was sent" in result.message.lower()


@pytest.mark.asyncio
async def test_endpoint_isolation_dry_run_does_not_claim_execution():
    provider = WazuhProvider({})

    result = await provider.execute(
        "endpoint.isolate",
        {"agent_id": "001"},
        dry_run=True,
    )

    assert result.state == JobState.succeeded
    assert result.data == {"dry_run": True, "provider": "wazuh"}
    assert "no request was sent" in result.message.lower()
