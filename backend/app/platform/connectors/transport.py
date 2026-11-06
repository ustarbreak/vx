"""Single transport helper for all connector HTTP calls (T2.5, owner decision #5).

Honors settings.CONNECTOR_TLS_VERIFY: default False keeps today's lenient
behavior byte-compatible (wazuh.py:21, connectors.py:155/187 use verify=False);
strict verification is an explicit opt-in until the migration task lands.
"""
from __future__ import annotations

from typing import Any, Dict

import httpx

from app.core.config import settings


def tls_verify() -> bool:
    return bool(getattr(settings, "CONNECTOR_TLS_VERIFY", False))


async def get_json(url: str, timeout: float = 8.0,
                   auth_headers: Dict[str, Any] | None = None) -> httpx.Response:
    async with httpx.AsyncClient(timeout=timeout, verify=tls_verify()) as client:
        return await client.get(url, headers=auth_headers or {})
