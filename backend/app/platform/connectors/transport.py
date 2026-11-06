"""Single transport helper for connector HTTP calls.

TLS certificate verification is enabled by default. An explicit
CONNECTOR_TLS_VERIFY=false override is reserved for trusted lab environments
using self-signed certificates and must not be used in public production.
"""
from __future__ import annotations

from typing import Any, Dict

import httpx

from app.core.config import settings


def tls_verify() -> bool:
    return bool(getattr(settings, "CONNECTOR_TLS_VERIFY", True))


async def get_json(url: str, timeout: float = 8.0,
                   auth_headers: Dict[str, Any] | None = None) -> httpx.Response:
    async with httpx.AsyncClient(timeout=timeout, verify=tls_verify()) as client:
        return await client.get(url, headers=auth_headers or {})
