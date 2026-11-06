"""Wazuh provider: verified read operations and fail-closed response actions.

The previous isolate_agent helper uses the Wazuh agent restart endpoint with
an unsupported "isolate" flag. That does not isolate network traffic. Until a
custom Wazuh Active Response command is configured and end-to-end verified,
live endpoint.isolate must not send a restart or report containment success.
"""
from __future__ import annotations

from typing import Any, Dict, List

from app.services.wazuh import WazuhService

from ..base import ConnectorProvider, Manifest, register
from ..models import ActionResult, Detection, JobState, Severity


@register
class WazuhProvider(ConnectorProvider):
    manifest = Manifest(
        id="wazuh", engine="Wazuh", service_id="endpoint-protection",
        module="providers.wazuh", version_pin="TODO_VERIFY",
        capabilities=[
            {"name": "endpoint.list", "dangerous": False},
            {"name": "detection.fetch", "dangerous": False},
            {"name": "endpoint.isolate", "dangerous": True,
             "description": "Fail-closed until a verified custom Wazuh Active Response isolation command is configured."},
            {"name": "vulnerability.fetch", "dangerous": False},
        ],
    )

    def _svc(self) -> WazuhService:
        cfg = self.config
        return WazuhService(
            cfg.get("api_endpoint", ""),
            cfg.get("username") or cfg.get("api_user") or "wazuh",
            cfg.get("password") or cfg.get("api_password") or cfg.get("api_key") or "",
        )

    async def probe(self) -> Dict[str, Any]:
        svc = self._svc()
        try:
            agents = await svc.get_agents()
            return {"reachable": True, "engine": "Wazuh", "agents_seen": len(agents)}
        except Exception as exc:
            return {"reachable": False, "engine": "Wazuh", "reason": type(exc).__name__}
        finally:
            await svc.close()

    async def fetch_detections(self, limit: int = 50) -> List[Detection]:
        svc = self._svc()
        out: List[Detection] = []
        try:
            alerts = await svc.get_alerts(
                level=int(self.config.get("alert_level", 7)),
                hours=int(self.config.get("alert_hours", 24)),
            )
            org_id = int(self.config.get("org_id") or 0)
            for item in alerts[:max(0, min(int(limit), 500))]:
                payload = item.get("_source", item) if isinstance(item, dict) else {}
                agent = payload.get("agent") if isinstance(payload.get("agent"), dict) else {}
                mitre = payload.get("mitre") if isinstance(payload.get("mitre"), dict) else {}
                out.append(Detection(
                    id=str(payload.get("id", len(out))),
                    org_id=org_id,
                    service_id="endpoint-protection",
                    source="Wazuh",
                    title=str(payload.get("description", ""))[:200],
                    severity=Severity.parse(str(payload.get("severity", payload.get("level", "medium")))),
                    hostname=agent.get("name") or payload.get("hostname"),
                    mitre_techniques=list(mitre.get("id", [])) if isinstance(mitre.get("id"), list) else [],
                    raw=payload,
                    timestamp=str(payload.get("timestamp", "")) or None,
                ))
        except Exception:
            # An unavailable manager is represented as no live detections.
            return out
        finally:
            await svc.close()
        return out

    async def execute(self, action: str, params: Dict[str, Any],
                      dry_run: bool = False) -> ActionResult:
        if action == "endpoint.isolate":
            if dry_run:
                return ActionResult(
                    JobState.dry_run,
                    message="dry-run: Wazuh host isolation would be requested; no device request was sent",
                    data={"dry_run": True, "provider": "wazuh", "executed": False},
                )
            # Do not call WazuhService.isolate_agent: it invokes agent restart,
            # not network isolation. Require verified Active Response support.
            return ActionResult(
                JobState.unsupported,
                message=("Wazuh host isolation is not enabled: no verified custom "
                         "Active Response isolation command is configured. Agent "
                         "restart is not host isolation; no device action was sent."),
                data={"provider": "wazuh", "executed": False,
                      "requires": "verified_wazuh_active_response"},
            )
        if action == "endpoint.list":
            svc = self._svc()
            try:
                agents = await svc.get_agents()
                return ActionResult(JobState.succeeded, message="Wazuh agents retrieved",
                                    data={"agents": agents[:500], "count": len(agents)})
            except Exception as exc:
                return ActionResult(JobState.failed, message=f"Wazuh agent query failed: {type(exc).__name__}")
            finally:
                await svc.close()
        if action == "detection.fetch":
            detections = await self.fetch_detections(limit=int(params.get("limit", 50)))
            return ActionResult(JobState.succeeded, message="Wazuh detections retrieved",
                                data={"detections": [d.__dict__ for d in detections], "count": len(detections)})
        return ActionResult(JobState.unsupported, message=f"wazuh: '{action}' not implemented")
