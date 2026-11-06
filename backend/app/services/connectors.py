"""Open-source connector registry — the real-data engine behind every service.

Each of the 16 platform services maps to one or more connectors that talk to a
best-in-class OPEN-SOURCE backend (Wazuh, TheHive/MISP, OpenSearch/Elastic,
Grafana Loki, n8n, OpenVAS, FreeIPA, Netdata, Pi-hole, OPNsense/pfSense,
LibreNMS, Restic/BorgBackup, ClamAV/Wazuh SCA, Mailcow/Rspamd, Keycloak/OWASP
ZAP).  In production these are swapped for the commercial equivalent without
touching this file: only `config["kind"]` changes.

Design rules (same philosophy as threat_intel.py):
- Everything degrades gracefully: unreachable source -> skipped, never a crash.
- No new heavy dependencies: plain httpx against each tool's REST API.
- Credentials come from the `integrations` table (api_endpoint / api_key),
  resolved through `load_connector_config(service_id, db)`.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Integration

logger = logging.getLogger("connectors")

# ---------------------------------------------------------------------------
# Catalogue: service_id -> default open-source engine + REST endpoints used
# to pull *live* counts/records.  `probe` endpoints are cheap GETs used by
# /services/{id}/status to verify the engine answers.
# ---------------------------------------------------------------------------
SERVICE_CONNECTORS: Dict[str, Dict[str, Any]] = {
    "threat-intel": {
        "engine": "MISP + AlienVault OTX",
        "docs": "https://www.misp-project.org/",
        "endpoints": {"events": "/events/restSearch", "stats": "/servers/getVersion"},
    },
    "compliance": {
        "engine": "CIS-CAT Lite / Wazuh SCA",
        "docs": "https://documentation.wazuh.com/current/user-manual/capabilities/security-config-assessment/index.html",
        "endpoints": {"scan": "/sca/000/status", "stats": "/manager/version"},
    },
    "incident-response": {
        "engine": "TheHive (SOAR-ready case management)",
        "docs": "https://thehive-project.org/",
        "endpoints": {"cases": "/api/v1/query", "stats": "/api/v1/status"},
    },
    "analytics": {
        "engine": "Grafana + OpenSearch/Loki",
        "docs": "https://grafana.com/docs/grafana/latest/developer-resources/http-api/",
        "endpoints": {"dashboards": "/api/dashboards/db", "health": "/api/health"},
    },
    "soar": {
        "engine": "n8n / Shuffle",
        "docs": "https://docs.n8n.io/api/api-reference/",
        "endpoints": {"workflows": "/api/v1/workflows", "executions": "/api/v1/executions"},
    },
    "vuln-scanning": {
        "engine": "OpenVAS / Greenbone Community Edition",
        "docs": "https://docs.greenbone.net/GSM-Manual/gos-22.04/en/scanning/",
        "endpoints": {"tasks": "/get_tasks", "info": "/get_version"},
    },
    "patch-management": {
        "engine": "Fleet (osquery) + Wazuh upgrade module",
        "docs": "https://fleetdm.com/docs/REST-API/rest-endpoints",
        "endpoints": {"hosts": "/api/v1/fleet/hosts", "meta": "/api/v1/fleet//"},
    },
    "backup-dr": {
        "engine": "Restic / BorgBackup via Borgmatic",
        "docs": "https://restic.readthedocs.io/en/latest/030_command_reference.html",
        "endpoints": {"snapshots": "/api/v1/snapshots", "repo": "/api/v1/repo/stats"},
    },
    "endpoint-protection": {
        "engine": "Wazuh agents + ClamAV",
        "docs": "https://documentation.wazuh.com/current/user-manual/registering/index.html",
        "endpoints": {"agents": "/agents", "vulns": "/vulnerability/reports"},
    },
    "email-security": {
        "engine": "Rspamd / Mailcow (DMARC aggregate parsing)",
        "docs": "https://rspamd.com/doc/api.html",
        "endpoints": {"auth": "/auth/check", "stats": "/statsscores"},
    },
    "cloud-security": {
        "engine": "CloudSploit / Prowler (CSPM open source)",
        "docs": "https://github.com/Prowler-PSP/prowler",
        "endpoints": {"scans": "/api/v1/scans", "findings": "/api/v1/findings"},
    },
    "network-monitoring": {
        "engine": "Netdata + LibreNMS",
        "docs": "https://registry.getnetdata.net/#netdata-rest-api",
        "endpoints": {"system": "/api/v1/data?chart=system.cpu", "devices": "/api/v0/devices"},
    },
    "dns-filtering": {
        "engine": "Pi-hole FTL API",
        "docs": "https://docs.pi-hole.net/ftldns/api/",
        "endpoints": {"stats": "/api/stats/summary", "queries": "/api/query?type=top_domains"},
    },
    "firewall-mgmt": {
        "engine": "OPNsense / pfSense REST plugin",
        "docs": "https://docs.opnsense.org/development/api.html",
        "endpoints": {"rules": "/api/firewall/filter/searchRule", "aliases": "/api/firewall/alias/searchItem"},
    },
    "vpn-gateway": {
        "engine": "Tailscale ACL API / OpenVPN-AS stats",
        "docs": "https://tailscale.com/kb/1218/acls",
        "endpoints": {"devices": "/api/v2/tailnet/-/devices", "keys": "/api/v2/keys"},
    },
    "sd-wan": {
        "engine": "LibreNMS / NetBox topology",
        "docs": "https://docs.librenms.org/API/",
        "endpoints": {"devices": "/api/v0/devices", "ports": "/api/v0/ports"},
    },
    "advanced-ticketing": {
        "engine": "GLPI / osTicket (ITSM open source)",
        "docs": "https://glpi-developer-documentation.rtfd.io/",
        "endpoints": {"fulltextsearch": "/apirest.php/fulltextsearch?search=text", "session": "/apirest.php/login"},
    },
}


def _basic_or_token_auth(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Build auth kwargs for httpx from an integration config.

    api_key formats supported:
      "user:password"  -> HTTP Basic
      "Bearer <tok>"   -> Authorization header
      "<token>"        -> custom header (X-API-Key / Authorization fallback per tool)
    """
    key = (cfg.get("api_key") or "").strip()
    if not key:
        return {}
    if ":" in key and not key.startswith("Bearer"):
        u, p = key.split(":", 1)
        return {"auth": (u, p)}
    if key.startswith("Bearer"):
        return {"headers": {"Authorization": key}}
    return {"headers": {"X-API-Key": key, "Authorization": f"Bearer {key}"}}


async def probe_connector(service_id: str, cfg: Dict[str, Any], timeout: float = 6.0) -> Dict[str, Any]:
    """Try the connector's cheapest endpoint. Returns status dict, never raises."""
    meta = SERVICE_CONNECTORS.get(service_id, {})
    base = (cfg.get("api_endpoint") or "").rstrip("/")
    if not base:
        return {"service_id": service_id, "engine": meta.get("engine"), "reachable": False,
                "reason": "no endpoint configured"}
    path = next(iter(meta.get("endpoints", {}).values()), "/")
    url = base + path
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=timeout, verify=False) as client:
            r = await client.get(url, **_basic_or_token_auth(cfg))
        ok = r.status_code < 500
        return {
            "service_id": service_id,
            "engine": meta.get("engine"),
            "reachable": ok,
            "http_status": r.status_code,
            "latency_ms": int((time.monotonic() - t0) * 1000),
            "url": url,
        }
    except Exception as e:  # noqa: BLE001 — degrade gracefully
        return {"service_id": service_id, "engine": meta.get("engine"), "reachable": False,
                "reason": type(e).__name__, "url": url}


async def fetch_live_records(service_id: str, cfg: Dict[str, Any], limit: int = 50) -> Dict[str, Any]:
    """Pull a page of REAL records from the service's open-source engine.

    Falls back to {'source':'none'} when nothing is configured/reachable so
    the UI can show 'NO LIVE SOURCE' instead of silently faking data.
    """
    meta = SERVICE_CONNECTORS.get(service_id)
    if not meta:
        return {"service_id": service_id, "source": "none", "records": []}
    base = (cfg.get("api_endpoint") or "").rstrip("/")
    if not base:
        return {"service_id": service_id, "engine": meta["engine"], "source": "none", "records": []}

    primary = list(meta["endpoints"].items())[0]
    url = base + primary[1]
    try:
        async with httpx.AsyncClient(timeout=8.0, verify=False) as client:
            r = await client.get(url, params={"limit": limit}, **_basic_or_token_auth(cfg))
            if r.status_code != 200:
                return {"service_id": service_id, "engine": meta["engine"], "source": "error",
                        "http_status": r.status_code, "records": [], "url": url}
            data = r.json()
    except Exception as e:  # noqa: BLE001
        return {"service_id": service_id, "engine": meta["engine"], "source": "unreachable",
                "reason": type(e).__name__, "records": [], "url": url}

    # Normalise: most OSS APIs nest items under some list key.
    items: List[Any] = []
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        for k in ("data", "items", "hosts", "agents", "tickets", "objects", "result", "logs", "hits"):
            v = data.get(k)
            if isinstance(v, list):
                items = v
                break
            if k == "hits" and isinstance(v, dict) and isinstance(v.get("hits"), list):
                items = [h.get("_source", h) for h in v["hits"]]
                break
    return {
        "service_id": service_id,
        "engine": meta["engine"],
        "source": "live",
        "count": len(items[:limit]),
        "records": items[:limit],
        "url": url,
    }


async def load_connector_config(service_id: str, db: AsyncSession) -> Dict[str, Any]:
    """Resolve credentials for a service from the integrations table.

    The first ACTIVE integration whose service_id matches wins; its
    api_endpoint/api_key become the connector config.
    """
    res = await db.execute(
        select(Integration)
        .where(Integration.service_id == service_id, Integration.status == "active")
        .order_by(Integration.id)
    )
    integ = res.scalars().first()
    if not integ:
        return {}
    return {"api_endpoint": integ.api_endpoint, "api_key": integ.api_key, "name": integ.name}


async def status_all(db: AsyncSession) -> List[Dict[str, Any]]:
    """Concurrently probe every configured connector (for the health panel)."""
    tasks = []
    for sid in SERVICE_CONNECTORS:
        cfg = await load_connector_config(sid, db)
        if cfg.get("api_endpoint"):
            tasks.append(probe_connector(sid, cfg))
    results = await asyncio.gather(*tasks) if tasks else []
    return list(results)
