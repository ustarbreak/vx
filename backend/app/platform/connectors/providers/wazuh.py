"""Wazuh provider (T2.3): thin wrapper over app/services/wazuh.py WazuhService.

Host isolation is deliberately fail-closed. The legacy WazuhService.isolate_agent
calls the agent restart endpoint with an "isolate" JSON flag; that is not a
documented or verified network-isolation operation. A real isolation workflow
requires a configured and verified Wazuh Active Response command on the
manager and agents. Until that command is integrated, endpoint.isolate must
never report success or send an agent restart.
"""
from __future__ import annotations

from typing import Any, Dict, List

from app.services.wazuh import WazuhService

from ..base import ConnectorProvider, Manifest, register
from ..models import ActionSpec, ActionResult, Detection, JobState, Severity


@register
class WazuhProvider(ConnectorProvider):
    manifest = Manifest(
        id="wazuh", engine="Wazuh", service_id="endpoint-protection",
        module="providers.wazuh", version_pin="TODO_VERIFY",
        capabilities=[
            {"name": "endpoint.list", "dangerous": False},
            {"name": "detection.fetch", "dangerous": False},
            {"name": "endpoint.isolate", "dangerous": True,
             "description": "Fail-closed until a verified Wazuh Active Response isolation command is configured."},
            {"name": "vulnerability.fetch", "dangerous": False},
        ],
    )

    def _svc(self) -> WazuhService:
        cfg = self.config
        return WazuhService(cfg.get("api_endpoint", ""),
                            cfg.get("username") or cfg.get("api_user") or "wazuh",
                            cfg.get("password") or cfg.get("api_key") or "")

    async def probe(self) -> Dict[str, Any]:
        svc = self._svc()
        try:
            agents = await svc.get_agents()
            return {"reachable": True, "engine": "Wazuh", "agents_seen": len(agents)}
        except Exception as e:  # graceful degradation, same rule as legacy
            return {"reachable": False, "engine": "Wazuh", "reason": type(e).__name__}
        finally:
            await svc.close()

    async def fetch_detections(self, limit: int = 50) -> List[Detection]:
        svc = self._svc()
        out: List[Detection] = []
        try:
            alerts = await svc.get_alerts(level=int(self.config.get("alert_level", 7)), hours=int(self.config.get("alert_hours", 24)))
            org_id = int(self.config.get("org_id") or 0)
            for a in alerts if isinstance(alerts, list) else []:
                payload = a.get("_source", a) if isinstance(a, dict) else {}
                sev = str(payload.get("severity", payload.get("level", "medium")))
                out.append(Detection(
                    id=str(payload.get("id", len(out))), org_id=org_id,
                    service_id="endpoint-protection", source="Wazuh",
                    title=str(payload.get("description", ""))[:200],
                    severity=Severity.parse(sev),
                    hostname=payload.get("agent", {}).get("name") if isinstance(payload.get("agent"), dict) else payload.get("hostname"),
                    mitre_techniques=list((payload.get("mitre") or {}).values())[:8] if isinstance(payload.get("mitre"), dict) else [],
                    raw=payload, timestamp=str(payload.get("timestamp", "")) or None,
                ))
        except Exception:
            pass  # unreachable manager -> empty, never crash (legacy rule)
        finally:
            await svc.close()
        return out

    async def execute(self, action: str, params: Dict[str, Any],
                      dry_run: bool = False) -> ActionResult:
        if action == "endpoint.isolate":
            if dry_run:
                return ActionResult(
                    JobState.succeeded,
                    message=("dry-run: would request host isolation through a verified Wazuh Active Response command; no request was sent"),
                    data={"dry_run": True, "provider": "wazuh"},
                )
            # Do not call WazuhService.isolate_agent: it invokes the agent
            # restart endpoint, which is not equivalent to network isolation.
            # Until a manager-side Active Response command is configured and
            # verified, fail honestly rather than claim containment.
            return ActionResult(
                JobState.unsupported,
                message=("Wazuh host isolation is not enabled: no verified custom Active Response isolation command is configured. Agent restart is not host isolation; no device action was sent."),
                data={"provider": "wazuh", "executed": False,
                      "requires": "verified_wazuh_active_response"},
            )
        return ActionResult(JobState.unsupported, message=f"wazuh: '{action}' not implemented")
