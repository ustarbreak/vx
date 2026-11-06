"""Explicit synthetic provider for SDK tests; never a production fallback."""
from __future__ import annotations
from typing import Any, Dict, List
from ..base import ConnectorProvider, Manifest, register
from ..models import ActionResult, Detection, JobState, Severity

@register
class MockConnectorProvider(ConnectorProvider):
    manifest = Manifest(
        id="mock", engine="Infracentra SDK Mock", service_id="mock",
        module="providers.mock", version_pin="in-tree",
        capabilities=[{"name": "mock.echo", "dangerous": False,
                       "description": "Returns supplied payload; test-only."}],
    )

    async def probe(self) -> Dict[str, Any]:
        return {"reachable": True, "engine": self.manifest.engine, "synthetic": True}

    async def fetch_detections(self, limit: int = 50) -> List[Detection]:
        return [
            Detection(id=f"mock-{i}", org_id=int(self.config.get("org_id") or 0),
                      service_id="mock", title=f"Synthetic test detection {i + 1}",
                      severity=Severity.low, source="mock", raw={"synthetic": True})
            for i in range(max(0, min(int(limit), 20)))
        ]

    async def execute(self, action: str, params: Dict[str, Any],
                      dry_run: bool = False) -> ActionResult:
        if action != "mock.echo":
            return ActionResult(JobState.unsupported,
                                message=f"mock: {action!r} is not implemented")
        if dry_run:
            return ActionResult(JobState.dry_run,
                                message="mock dry-run; no action executed",
                                data={"synthetic": True})
        return ActionResult(JobState.succeeded,
                            message="synthetic mock action completed",
                            data={"synthetic": True, "echo": params})
