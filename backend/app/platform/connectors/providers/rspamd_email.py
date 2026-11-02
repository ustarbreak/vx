"""Provider for 'email-security' native engine path (engine: Rspamd). Status: roadmap.

T5.3 — hand-written scaffold (NOT generated). Talks to the Rspamd HTTP API
(/stats, /ping) only when RSPAMD_URL is configured; otherwise reports
`not_configured`. Never fabricates scan/spam stats.

Enable via env (deploy/.env.connector.example):
  RSPAMD_URL   e.g. http://rspamd:11334
  RSPAMD_KEY   controller password/rspamd_control header value (optional)

Read-only by design: symbol/milter config changes stay manual per safety rule.
"""
from __future__ import annotations

from typing import Any, Dict, List

import httpx

from app.core.config import settings
from app.platform.connectors.base import Manifest, register
from app.platform.connectors.models import ActionResult, Detection, JobState


@register
class RspamdProvider:
    manifest = Manifest(
        id="email-security-rspamd",
        engine="Rspamd",
        service_id="email-security",
        module="providers.rspamd_email",
        version_pin="TODO_VERIFY",
        capabilities=["stats.read"],
    )

    def _base(self) -> str | None:
        return getattr(settings, "RSPAMD_URL", "") or None

    def _headers(self) -> Dict[str, str]:
        key = getattr(settings, "RSPAMD_KEY", "") or ""
        return {"password": key} if key else {}

    async def probe(self) -> Dict[str, Any]:
        base = self._base()
        if not base:
            return {"status": "not_configured",
                    "message": "Set RSPAMD_URL + RSPAMD_KEY to enable."}
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(base.rstrip("/") + "/ping", headers=self._headers())
                r.raise_for_status()
                ok = "PONG" in r.text
            return {"status": "online" if ok else "offline"}
        except Exception as exc:  # noqa: BLE001
            return {"status": "offline", "message": str(exc)}

    async def fetch_detections(self, org_id: int) -> List[Detection]:
        """Map Rspamd stats counters into zero detections (metrics, not alerts)."""
        return []

    async def stats(self) -> Dict[str, Any]:
        base = self._base()
        if not base:
            return {"status": "not_configured"}
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(base.rstrip("/") + "/stats", headers=self._headers())
                r.raise_for_status()
                return {"status": "online", "stats": r.json()}
        except Exception as exc:  # noqa: BLE001
            return {"status": "offline", "message": str(exc)}

    async def execute(self, action: str, params: Dict[str, Any],
                      dry_run: bool = False) -> ActionResult:
        return ActionResult(JobState.unsupported,
                            message="email-security/rspamd: read-only scaffold; "
                                    "milter/symbol config changes are manual (see docs/guides)")
