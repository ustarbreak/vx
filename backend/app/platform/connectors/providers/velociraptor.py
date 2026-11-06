"""Velociraptor provider: honest, tenant-tagged read adapter with gated writes."""
from __future__ import annotations

import json
from typing import Any, Dict, List

import httpx

from app.core.config import settings
from app.platform.connectors.base import ConnectorProvider, Manifest, register
from app.platform.connectors.models import ActionResult, Detection, JobState

DESTRUCTIVE_ACTIONS = {"host.isolate", "process.kill", "artifact.collect"}


@register
class VelociraptorProvider(ConnectorProvider):
    manifest = Manifest(
        id="endpoint-forensics",
        engine="Velociraptor",
        service_id="endpoint-forensics",
        module="providers.velociraptor",
        version_pin="TODO_VERIFY",
        capabilities=[
            {"name": "artifact.collect", "dangerous": True,
             "description": "Collection requires explicit live-response authorization."},
            {"name": "hunt.create", "dangerous": True,
             "description": "Creates a Velociraptor hunt on the configured server."},
        ],
    )

    def __init__(self, config: Dict[str, Any] | None = None):
        super().__init__(config or {})

    def _base(self) -> str | None:
        return (self.config.get("api_endpoint")
                or getattr(settings, "VELOCIRAPTOR_URL", "") or None)

    def _headers(self) -> Dict[str, str]:
        token = (self.config.get("api_token")
                 or getattr(settings, "VELOCIRAPTOR_TOKEN", "") or "")
        return {"Authorization": f"Bearer {token}"} if token else {}

    def _verify(self) -> bool:
        return bool(getattr(settings, "CONNECTOR_TLS_VERIFY", True))

    def _configured(self) -> bool:
        return bool(self._base() and self._headers())

    async def probe(self) -> Dict[str, Any]:
        if not self._configured():
            return {"status": "not_configured",
                    "message": "Set VELOCIRAPTOR_URL + VELOCIRAPTOR_TOKEN to enable."}
        try:
            async with httpx.AsyncClient(verify=self._verify(), timeout=10) as client:
                response = await client.get(
                    self._base().rstrip("/") + "/api/v1/server_info",
                    headers=self._headers(),
                )
                response.raise_for_status()
                info = response.json()
            return {"status": "online", "version": info.get("version", "unknown")}
        except Exception as exc:
            return {"status": "offline", "message": type(exc).__name__}

    async def fetch_detections(self, limit: int = 50) -> List[Detection]:
        if not self._configured():
            return []
        org_id = int(self.config.get("org_id") or 0)
        out: List[Detection] = []
        try:
            async with httpx.AsyncClient(verify=self._verify(), timeout=20) as client:
                response = await client.get(
                    self._base().rstrip("/") + "/api/v1/hunts/",
                    headers=self._headers(),
                )
                response.raise_for_status()
                items = response.json().get("items", [])
                for hunt in items[:max(0, min(int(limit), 200))]:
                    out.append(Detection(
                        id=f"velo-{hunt.get('hunt_id', '')}",
                        org_id=org_id,
                        service_id="endpoint-forensics",
                        title=hunt.get("description") or f"Velociraptor hunt {hunt.get('hunt_id')}",
                        source="velociraptor",
                    ))
        except Exception:
            return out
        return out

    async def execute(self, action: str, params: Dict[str, Any],
                      dry_run: bool = False) -> ActionResult:
        if not self._configured():
            return ActionResult(JobState.unsupported,
                                message="Velociraptor not configured (URL/token missing)")
        if action in DESTRUCTIVE_ACTIONS:
            allowed = bool(getattr(settings, "ALLOW_LIVE_RESPONSE", False))
            confirmed = bool(params.get("__confirm__", False))
            if not (allowed and not dry_run and confirmed):
                return ActionResult(
                    JobState.blocked,
                    message=f"'{action}' requires ALLOW_LIVE_RESPONSE=true, "
                            "dry_run=false and explicit confirmation",
                )
            return ActionResult(
                JobState.unsupported,
                message="Live-response flow pending verified Velociraptor deployment.",
            )
        if action == "hunt.create":
            flow = str(params.get("flow") or "")
            if dry_run:
                return ActionResult(JobState.dry_run,
                                    message=f"dry-run: would create hunt for flow '{flow}'")
            if not flow:
                return ActionResult(JobState.failed, message="flow is required")
            try:
                async with httpx.AsyncClient(verify=self._verify(), timeout=20) as client:
                    response = await client.post(
                        self._base().rstrip("/") + "/api/v1/create_hunt/",
                        headers=self._headers(),
                        json={"description": params.get("description", flow),
                              "hunt_flow": flow},
                    )
                    response.raise_for_status()
                return ActionResult(JobState.succeeded, message="hunt created",
                                    data=response.json())
            except Exception as exc:
                return ActionResult(JobState.failed, message=type(exc).__name__)
        return ActionResult(JobState.unsupported,
                            message=f"velociraptor: '{action}' not implemented")
