"""Generic provider that wraps the existing SERVICE_CONNECTORS pullers
(app/services/connectors.py probe_connector / fetch_live_records) — T2.3.

One class serves every catalog service id; it never invents data: when the
engine is unreachable, fetch_detections returns [] and probe() reports the
honest reason (same degradation rules as the legacy module).
"""
from __future__ import annotations

from typing import Any, Dict, List

from app.services import connectors as legacy

from ..base import ConnectorProvider, Manifest, register
from ..models import Detection, JobState, ActionResult, Severity


@register
class LegacyConnectorProvider(ConnectorProvider):
    """Adapter over the proven 17-service probe/fetch code paths."""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        # manifest may be set by registry lookup; default to config-provided ids
        if not getattr(type(self), "manifest", None):
            type(self).manifest = Manifest(
                id=config.get("connector_id", "legacy"),
                engine=config.get("engine", "unknown"),
                service_id=config.get("service_id", ""),
                module="legacy_connector",
            )

    async def probe(self) -> Dict[str, Any]:
        return await legacy.probe_connector(self.manifest.service_id, self.config)

    async def fetch_detections(self, limit: int = 50) -> List[Detection]:
        res = await legacy.fetch_live_records(self.manifest.service_id, self.config, limit=limit)
        org_id = int(self.config.get("org_id") or 0)
        out: List[Detection] = []
        if res.get("source") != "live":
            return out  # honest empty — UI shows NO LIVE SOURCE as before
        for rec in res.get("records", []):
            if not isinstance(rec, dict):
                rec = {"title": str(rec)}
            out.append(Detection(
                id=str(rec.get("id", rec.get("_id", len(out)))),
                org_id=org_id,
                service_id=self.manifest.service_id,
                title=str(rec.get("title") or rec.get("description") or rec.get("name") or "")[:200],
                severity=Severity.parse(str(rec.get("severity", "medium"))),
                source=self.manifest.engine,
                mitre_techniques=list(rec.get("mitre") or rec.get("tags") or [])[:8],
                hostname=rec.get("hostname") or rec.get("agent"),
                raw=rec,
                timestamp=str(rec.get("timestamp") or rec.get("created") or "") or None,
            ))
        return out
