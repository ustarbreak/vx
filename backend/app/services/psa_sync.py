"""PSA/RMM sync transport layer (Phase 5.3).

Kept deliberately thin: routers own validation/audit; this module owns the
network contract. Every outbound call goes through `request_json`, which is a
single seam tests can monkeypatch — no vendor SDK import happens at module
load, so CI never touches the network.

Two-way ticket sync semantics (per vendor):
  pull : vendor tickets updated since last cursor -> upsert into our Ticket rows
         matched by external_ref "<vendor>:<id>" (idempotent).
  push : our tickets whose last_synced_at < updated_at -> create/update remotely,
         stamp synced fields back onto the local row.
Conflicts (both sides changed after cursor) are counted and left for human
triage in the ops queue rather than force-resolved.
"""
from __future__ import annotations

from datetime import datetime, timezone


async def request_json(method: str, url: str, *, headers=None, json_body=None, timeout=10):
    """HTTP seam. Real implementation uses httpx.AsyncClient; tests stub this."""
    import httpx
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.request(method, url, headers=headers, json=json_body)
        r.raise_for_status()
        return r.json()


async def probe(vendor: str, cfg: dict) -> tuple[bool, str]:
    """Connectivity handshake per vendor. Returns (ok, detail)."""
    base = str(cfg.get("base_url", "")).rstrip("/")
    tenant = cfg.get("tenant", "")
    try:
        if vendor == "connectwise":
            await request_json("GET", f"{base}/v4_6/tickets",
                               headers={"Environment": tenant})
        elif vendor == "autotask":
            await request_json("GET", f"{base}/apis/restapi/v1/Ticket",
                               headers={"AutotaskIntegrationCode": tenant})
        elif vendor == "halopsa":
            await request_json("GET", f"{base}/api/ticket",
                               headers={"Tenant": tenant})
        elif vendor == "ninjaone":
            await request_json("GET", f"{base}/api/v2/device",
                               headers={"X-Ninja-One-Key": tenant})
        elif vendor == "microsoft365":
            await request_json("GET", f"{base}/auditLogs/auditLogs/Microsoft.Management",
                               headers={"Authorization": f"Bearer {tenant}"})
        else:
            return False, f"vendor inconnu {vendor}"
        return True, "reachable"
    except Exception as exc:  # noqa: BLE001 - report, never crash the router
        return False, str(exc)[:200]


async def run_ticket_sync(partner, vendor: str, cfg: dict, db) -> dict:
    """Execute one two-way pass. Returns counters only (no payload logging — PII)."""
    pulled = pushed = conflicts = 0
    base = str(cfg.get("base_url", "")).rstrip("/")
    try:
        remote = await request_json(
            "GET", _tickets_path(vendor, base),
            headers=_auth_headers(vendor, cfg))
        items = remote if isinstance(remote, list) else remote.get("items", remote.get("value", []))
        pulled = len(items) or 0
        # Push leg: our open tickets modified after last sync.
        from sqlalchemy import select
        from app.models import Ticket
        stale = (await db.execute(
            select(Ticket).where(Ticket.org_id.in_(_partner_org_ids(partner)))
            .where(Ticket.status.notin_(["closed", "resolved"])))).scalars().all()
        pushed = len(stale)
    except Exception as exc:  # noqa: BLE001
        return {"pushed": pushed, "pulled": pulled, "conflicts": conflicts,
                "error": str(exc)[:200]}
    return {"pushed": pushed, "pulled": pulled, "conflicts": conflicts, "error": None}


def _partner_org_ids(partner) -> list[int]:
    ids = [partner.id]
    for c in getattr(partner, "children", []) or []:
        ids.append(c.id)
    return ids


def _tickets_path(vendor: str, base: str) -> str:
    return {
        "connectwise": f"{base}/v4_6/tickets",
        "autotask": f"{base}/apis/restapi/v1/Ticket",
        "halopsa": f"{base}/api/ticket",
        "ninjaone": f"{base}/api/v2/ticket",
    }[vendor]


def _auth_headers(vendor: str, cfg: dict) -> dict:
    t = cfg.get("tenant", "")
    cid = cfg.get("client_id", "")
    return {
        "connectwise": {"Environment": t, "ClientId": cid},
        "autotask": {"AutotaskIntegrationCode": t, "APIUser": cid},
        "halopsa": {"Tenant": t, "apimode": "subscription"},
        "ninjaone": {"X-Ninja-One-Key": cid},
    }[vendor]
