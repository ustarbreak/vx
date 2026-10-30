"""Extra Discovery & Infrastructure endpoints.

Mounted in main.py as `router` with prefix /api/discovery (same tag as the
core discovery router, so OpenAPI groups them together):

  * PATCH /discovery/snmp-credentials/{id}   — edit SNMP credentials in place
  * POST  /discovery/snmp-credentials/{id}/test — live probe against a target IP
  * GET   /discovery/graph                   — Infrastructure force-graph with pivots
  * GET   /discovery/devices/{id}/full       — device hub: identity + monitoring +
                                               alerts/tickets/incidents/playbooks/actions
  * POST  /discovery/devices/{id}/action     — endpoint action (backup / remote
                                               access / shutdown / isolate)
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.security import get_current_user
from app.models import User, SnmpCredential, DiscoveredDevice
from app.schemas import SnmpCredentialResponse
from app.services.discovery import snmp_probe
from app.services.device_graph import (
    build_graph, related_items, request_action, DEVICE_ACTIONS, ACTION_LABELS,
)

router = APIRouter(prefix="/discovery", tags=["Auto-Discovery & SNMP"])

# ---------------------------------------------------------------------------
# Credential update / test
# ---------------------------------------------------------------------------

class SnmpCredentialUpdate(BaseModel):
    name: str | None = None
    version: str | None = None
    community: str | None = None
    username: str | None = None
    auth_protocol: str | None = None
    auth_passphrase: str | None = None
    priv_protocol: str | None = None
    priv_passphrase: str | None = None
    port: int | None = None


class SnmpTestRequest(BaseModel):
    target_ip: str
    # Allow testing an unsaved draft before persisting it.
    credential: SnmpCredentialUpdate | None = None


@router.patch("/snmp-credentials/{cred_id}", response_model=SnmpCredentialResponse)
async def update_credential(cred_id: int, body: SnmpCredentialUpdate,
                            current_user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    """Modify stored SNMP credentials (community strings, v3 auth/priv)."""
    cred = (await db.execute(select(SnmpCredential).where(SnmpCredential.id == cred_id))).scalars().first()
    if not cred:
        raise HTTPException(404, "Credential not found")
    if current_user.role != "platform_admin" and cred.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    upd = body.model_dump(exclude_unset=True)
    merged = {**{f: getattr(cred, f) for f in upd}, **upd}
    ver = merged.get("version") or cred.version
    if ver in ("v1", "v2c") and not (merged.get("community") or "").strip():
        raise HTTPException(422, "community string required for SNMP v1/v2c")
    if ver == "v3" and not (merged.get("username") or "").strip():
        raise HTTPException(422, "username required for SNMP v3")
    for k, v in upd.items():
        setattr(cred, k, v)
    await db.commit()
    await db.refresh(cred)
    return cred


@router.post("/snmp-credentials/{cred_id}/test")
async def test_credential(cred_id: int, body: SnmpTestRequest,
                          current_user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    """Probe one host with the tenant's stored credential (or an edited draft).

    Returns exactly what the SNMP engine observed — never a fabricated match.
    In deployments without pysnmp/network reachability the service layer is
    honest about it via `engine` + `mode` fields.
    """
    cred = (await db.execute(select(SnmpCredential).where(SnmpCredential.id == cred_id))).scalars().first()
    if not cred:
        raise HTTPException(404, "Credential not found")
    if current_user.role != "platform_admin" and cred.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    try:
        import ipaddress
        ipaddress.ip_address(body.target_ip)
    except ValueError:
        raise HTTPException(422, "target_ip must be a valid IPv4/IPv6 address")

    # Draft override lets the user test modified values BEFORE saving them.
    draft = body.credential
    class _Effective:
        id = cred.id
        name = draft.name if draft and draft.name else cred.name
        version = draft.version if draft and draft.version else cred.version
        community = (draft.community if draft and draft.community is not None else cred.community)
        username = (draft.username if draft and draft.username is not None else cred.username)
        port = (draft.port if draft and draft.port else cred.port)
    effective = _Effective()

    try:
        result = await snmp_probe(body.target_ip, effective)
    except Exception as exc:
        return {"ok": False, "matched": False, "target": body.target_ip,
                "credential": effective.name,
                "error": f"{type(exc).__name__}: {exc}"}
    return {
        "ok": bool(result),
        "matched": bool(result),
        "target": body.target_ip,
        "credential": effective.name,
        "sys_desc": (result or {}).get("sys_desc"),
        "tested_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Infrastructure graph
# ---------------------------------------------------------------------------

@router.get("/graph")
async def infrastructure_graph(group_by: str = Query("type", pattern="^(type|site|subnet)$"),
                               current_user: User = Depends(get_current_user),
                               db: AsyncSession = Depends(get_db)):
    """Force-directed Infrastructure graph with pivot nodes.

    Nodes/edges derive ONLY from persisted DiscoveredDevice rows + real probe
    heartbeats; pivots are exact aggregates of device_type / site / subnet.
    """
    org_id = current_user.org_id
    if current_user.role == "platform_admin" and not org_id:
        raise HTTPException(400, "org_id required — pass ?org_id= via a client session or use a tenant account")
    if org_id is None:
        raise HTTPException(400, "User has no organization")
    return await build_graph(db, org_id, group_by)


# ---------------------------------------------------------------------------
# Device hub + endpoint actions
# ---------------------------------------------------------------------------

@router.get("/devices/{device_id}/full")
async def device_full(device_id: int, current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    """Everything linked to one device: identity, monitoring state, alerts,
    tickets, incidents, playbook runs, notifications, action ledger."""
    dev = (await db.execute(select(DiscoveredDevice).where(DiscoveredDevice.id == device_id))).scalars().first()
    if not dev:
        raise HTTPException(404, "Device not found")
    if current_user.role != "platform_admin" and dev.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    from app.routers.discovery import device_detail
    detail = await device_detail(device_id, current_user, db)
    related = await related_items(db, dev)
    return {"detail": detail, "related": related,
            "available_actions": sorted(DEVICE_ACTIONS),
            "action_labels": ACTION_LABELS}


class DeviceActionRequest(BaseModel):
    action: str                       # backup | remote_access | shutdown | isolate
    mode: str = "execute"             # simulate | execute
    confirm: bool = False             # explicit operator confirmation for consequential actions


@router.post("/devices/{device_id}/action")
async def device_action(device_id: int, body: DeviceActionRequest,
                        current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    """Queue/route an endpoint action honestly (see services/device_graph.py).

    The platform never pretends to run host commands: with an enrolled agent
    the request is durably queued for delivery on the agent's next poll;
    without one it becomes a P1 technician ticket. shutdown/isolate require
    confirm=true; every outcome is audited.
    """
    dev = (await db.execute(select(DiscoveredDevice).where(DiscoveredDevice.id == device_id))).scalars().first()
    if not dev:
        raise HTTPException(404, "Device not found")
    if current_user.role != "platform_admin" and dev.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    if body.mode not in ("simulate", "execute"):
        raise HTTPException(422, "mode must be 'simulate' or 'execute'")
    try:
        return await request_action(db, dev, current_user, body.action,
                                    mode=body.mode, confirm=body.confirm)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
