"""Provider for 'dns-filtering' native engine path (engine: Unbound). Status: roadmap.

T5.3 — hand-written scaffold (NOT generated). Reads Unbound's control socket
output only when UNBOUND_CONTROL_CMD is configured; otherwise reports
`not_configured`. Never fabricates query/block stats.

Enable via env (deploy/.env.connector.example):
  UNBOUND_CONTROL_CMD  e.g. "unbound-control"  (must be on PATH + key certs readable)

Read-only by design: execute() has no write actions — DNS policy changes stay
manual in unbound.conf per the brief's safety rule.
"""
from __future__ import annotations

import asyncio
import shutil
from typing import Any, Dict, List

from app.core.config import settings
from app.platform.connectors.base import Manifest, register
from app.platform.connectors.models import ActionResult, Detection, JobState


@register
class UnboundProvider:
    manifest = Manifest(
        id="dns-filtering-unbound",
        engine="Unbound",
        service_id="dns-filtering",
        module="providers.unbound_dns",
        version_pin="TODO_VERIFY",
        capabilities=["stats.read"],
    )

    def _cmd(self) -> str | None:
        return getattr(settings, "UNBOUND_CONTROL_CMD", "") or None

    async def probe(self) -> Dict[str, Any]:
        cmd = self._cmd()
        if not cmd or not shutil.which(cmd):
            return {"status": "not_configured",
                    "message": "Set UNBOUND_CONTROL_CMD (and install unbound-control) to enable."}
        try:
            proc = await asyncio.create_subprocess_exec(
                cmd, "status", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            text = out.decode(errors="replace")
            running = "is running" in text.lower()
            return {"status": "online" if running else "offline", "raw": text.strip()[:400]}
        except Exception as exc:  # noqa: BLE001
            return {"status": "offline", "message": str(exc)}

    async def fetch_detections(self, org_id: int) -> List[Detection]:
        """No detection stream from Unbound itself; return empty honestly."""
        return []

    async def execute(self, action: str, params: Dict[str, Any],
                      dry_run: bool = False) -> ActionResult:
        return ActionResult(JobState.unsupported,
                            message="dns-filtering/unbound: read-only scaffold; "
                                    "DNS policy changes are manual (see docs/guides)")
