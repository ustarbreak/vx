"""Wazuh provider (T2.3): thin wrapper over app/services/wazuh.py WazuhService.

No behavior changes to the underlying service. Note: WazuhService.isolate_agent
currently sends an agent *restart* with an isolate flag — real host isolation
needs Wazuh Active Response enabled on the manager, so until that is verified
the action reports honest partial semantics in its message (ALIGNMENT §E).
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
             "description": "Requires Wazuh Active Response on the manager; "
                            "current impl restarts agent with isolate flag (partial)."},
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
                return ActionResult(JobState.succeeded, message="dry-run: would restart+flag isolate", data={})
            agent_id = params.get("agent_id")
            if not agent_id:
                return ActionResult(JobState.failed, message="agent_id required")
            svc = self._svc()
            try:
                res = await svc.isolate_agent(str(agent_id))
                return ActionResult(JobState.succeeded,
                                    message="isolate requested via agent restart (Active Response not verified - TODO_VERIFY)",
                                    data=res)
            except Exception as e:
                return ActionResult(JobState.failed, message=f"{type(e).__name__}: {e}")
            finally:
                await svc.close()
        return ActionResult(JobState.unsupported, message=f"wazuh: '{action}' not implemented")
