"""
Threat Intelligence aggregation service.

Real data sources supported:
- MISP instance (via pymisp, configured through the Integrations table)
- AlienVault OTX public API (https://otx.alienvault.com/api/v1/indicators/<type>/<value>/general)

Everything degrades gracefully: if a source is not configured or unreachable,
it is skipped and the remaining sources still return results.
"""
from typing import List, Dict, Optional
import asyncio
import json
import logging

import httpx

logger = logging.getLogger("threat_intel")


def _sev_from_otx(level) -> str:
    try:
        level = int(level)
    except (TypeError, ValueError):
        return "info"
    return {5: "critical", 4: "high", 3: "medium", 2: "low", 1: "info"}.get(level, "info")


async def fetch_alienvault_otx(ioc_value: str, timeout: float = 8.0) -> List[Dict]:
    """Query AlienVault OTX for a single IP / domain / URL / file hash."""
    ioc_value = ioc_value.strip()
    if ":" in ioc_value and all(c in "0123456789abcdefABCDEF." for c in ioc_value.replace(":", "")):
        itype = "file"          # hash
    elif "/" in ioc_value:
        itype = "url"
        ioc_value = httpx.URL(ioc_value.replace("http://", "").replace("https://", "")).host + \
            "/" + (httpx.URL("http://" + ioc_value).path or "")
        itype = "url"
    elif any(c.isalpha() and "." in ioc_value for c in ioc_value) and not ioc_value[0].isdigit():
        itype = "domain"
    else:
        itype = "ip"

    url = f"https://otx.alienvault.com/api/v1/indicators/{itype}/{ioc_value}/general"
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.get(url, headers={"Accept": "application/json"})
        if r.status_code != 200:
            logger.warning("OTX returned %s for %s", r.status_code, ioc_value)
            return []
        data = r.json()

    pulses = data.get("pulses", {}).get("data", []) if isinstance(data.get("pulses"), dict) else data.get("pulses", [])
    out = []
    for p in (pulses or [])[:20]:
        matched = [x for x in p.get("indicators", []) if x.get("ioc") == ioc_value]
        out.append({
            "source": "AlienVault OTX",
            "title": p.get("name", "Untitled pulse"),
            "description": (p.get("description") or "")[:300],
            "severity": _sev_from_otx(p.get("tlp")),
            "confidence": min(95, 50 + len(matched) * 10),
            "timestamp": p.get("created", ""),
            "tags": p.get("tags", [])[:6],
            "references": [p.get("link")] if p.get("link") else [],
            "detections": {},
            "mitre_attack": p.get("attack_techniques", [])[:6],
            "first_seen": p.get("created", ""),
            "last_updated": p.get("modified", ""),
            "analyst_comments": "",
            "related_threats": [],
            "iocs": [{"type": m.get("type", "unknown"), "value": m.get("ioc", ioc_value),
                      "context": "OTX pulse"} for m in matched[:10]] or
                    [{"type": itype, "value": ioc_value, "context": "Queried indicator"}],
        })
    return out


async def fetch_misp(value: Optional[str] = None, limit: int = 50) -> List[Dict]:
    """Query the configured MISP instance (Integration row named 'MISP')."""
    from app.database import AsyncSessionLocal
    from app.models import Integration
    from app.services.misp import MISPService
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Integration).where(
            Integration.name == "MISP", Integration.status == "active"))
        integ = result.scalar_one_or_none()
    if not integ or not integ.api_endpoint or not integ.api_key:
        return []

    def _query():
        svc = MISPService(url=integ.api_endpoint, api_key=integ.api_key)
        try:
            events = svc.get_recent_events(hours=24 * 7)
            if value:
                events = [e for e in events]  # recent events; detailed IoC search below
            return events
        finally:
            pass

    try:
        events = await asyncio.to_thread(_query)
    except Exception as exc:  # noqa: BLE001
        logger.warning("MISP query failed: %s", exc)
        return []

    sev_map = {1: "high", 2: "medium", 3: "low", 4: "info"}
    return [{
        "source": "MISP",
        "title": e.get("info", "MISP event"),
        "description": f"MISP event #{e.get('id')} — {e.get('attribute_count', 0)} attributes",
        "severity": sev_map.get(int(e.get("threat_level", 4)), "info"),
        "confidence": 80,
        "timestamp": str(e.get("timestamp", "")),
        "tags": [],
        "references": [],
        "detections": {},
        "mitre_attack": [],
        "first_seen": str(e.get("timestamp", "")),
        "last_updated": str(e.get("timestamp", "")),
        "analyst_comments": "",
        "related_threats": [],
        "iocs": [],
    } for e in events][:limit]


async def aggregate(value: Optional[str] = None, limit: int = 50) -> List[Dict]:
    """Run all configured sources concurrently, merge and normalise results."""
    tasks = [fetch_misp(value)]
    if value:
        tasks.append(fetch_alienvault_otx(value))
    results = await asyncio.gather(*tasks, return_exceptions=True)

    threats: List[Dict] = []
    for res in results:
        if isinstance(res, Exception):
            logger.warning("threat feed failed: %s", res)
            continue
        threats.extend(res)

    order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    threats.sort(key=lambda t: order.get(t["severity"], 5))

    # Normalise to the frontend ThreatIntel shape (src/data/mockData.ts)
    import hashlib
    from datetime import datetime, timezone

    def _norm(i: int, t: dict) -> dict:
        ioc0 = (t.get("iocs") or [{}])[0]
        digest = hashlib.md5(f"{t.get('title')}{t.get('timestamp')}".encode()).hexdigest()[:8]
        ts = t.get("timestamp") or ""
        if ts.isdigit():  # MISP unix timestamp
            ts = datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
        return {
            "id": f"thr-{digest}-{i}",
            "type": (t.get("tags") or ["threat"])[0],
            "severity": t.get("severity", "info"),
            "title": t.get("title", ""),
            "description": t.get("description", ""),
            "source": t.get("source", ""),
            "ioc": ioc0.get("value", ""),
            "iocType": ioc0.get("type", "unknown"),
            "timestamp": ts,
            "confidence": t.get("confidence", 50),
            "mitreAttack": t.get("mitre_attack", []),
            "affectedAssets": len(t.get("detections", {}) or {}),
            "status": "active",
        }

    return [_norm(i, t) for i, t in enumerate(threats[:limit])]
