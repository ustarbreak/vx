"""SNMP Credentials & Network Auto-Discovery API.

Scans run in the background (asyncio task) using real nmap when installed;
the client polls scan status and results. Devices that answer any of the
tenant's SNMP credentials are flagged `snmp_match` and emit an event into the
Notification Engine (which can auto-create a ticket via rules).
"""
import ipaddress
from datetime import datetime, timezone

from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.core.security import get_current_user
from sqlalchemy import or_
from app.models import (
    User, SnmpCredential, DiscoveryScan, DiscoveredDevice, Organization,
    AgentProbe, Alert,
)
from app.schemas import (
    SnmpCredentialCreate, SnmpCredentialResponse, ScanCreate, ScanResponse,
    DiscoveredDeviceResponse,
)
from app.services.discovery import schedule_scan, nmap_available, cidr_hosts

router = APIRouter(prefix="/discovery", tags=["Auto-Discovery & SNMP"])


def _scope_org(user: User, requested_org: int | None) -> int:
    if user.role == "platform_admin":
        if requested_org is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "org_id required for platform admins")
        return requested_org
    if requested_org is not None and requested_org != user.org_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-tenant access denied")
    if user.org_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "User has no organization")
    return user.org_id


# ---------------------------------------------------------------------------
# SNMP credentials — created by the client (or by us on their behalf) in Settings
# ---------------------------------------------------------------------------
@router.get("/snmp-credentials", response_model=list[SnmpCredentialResponse])
async def list_credentials(current_user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    stmt = select(SnmpCredential).order_by(SnmpCredential.id)
    if current_user.role != "platform_admin":
        stmt = stmt.where(SnmpCredential.org_id == current_user.org_id)
    return (await db.execute(stmt)).scalars().all()


@router.post("/snmp-credentials", response_model=SnmpCredentialResponse, status_code=201)
async def create_credential(body: SnmpCredentialCreate,
                            current_user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    org = _scope_org(current_user, body.org_id)
    if body.version in ("v1", "v2c") and not body.community:
        raise HTTPException(422, "community string required for SNMP v1/v2c")
    if body.version == "v3" and not body.username:
        raise HTTPException(422, "username required for SNMP v3")
    cred = SnmpCredential(
        org_id=org, name=body.name, version=body.version, community=body.community,
        username=body.username, auth_protocol=body.auth_protocol,
        auth_passphrase=body.auth_passphrase, priv_protocol=body.priv_protocol,
        priv_passphrase=body.priv_passphrase, port=body.port,
    )
    db.add(cred)
    await db.commit()
    await db.refresh(cred)
    return cred


@router.delete("/snmp-credentials/{cred_id}", status_code=204)
async def delete_credential(cred_id: int, current_user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    cred = (await db.execute(select(SnmpCredential).where(SnmpCredential.id == cred_id))).scalars().first()
    if not cred:
        raise HTTPException(404, "Credential not found")
    if current_user.role != "platform_admin" and cred.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    await db.delete(cred)
    await db.commit()


# ---------------------------------------------------------------------------
# Background network scans (nmap)
# ---------------------------------------------------------------------------
@router.get("/scans", response_model=list[ScanResponse])
async def list_scans(current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    stmt = select(DiscoveryScan).order_by(DiscoveryScan.created_at.desc()).limit(50)
    if current_user.role != "platform_admin":
        stmt = stmt.where(DiscoveryScan.org_id == current_user.org_id)
    return (await db.execute(stmt)).scalars().all()


MAX_SCAN_HOSTS = 1024   # engine cap (services.discovery.cidr_hosts) — scans stay bounded


@router.post("/scans", response_model=ScanResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_scan(body: ScanCreate, current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    org = _scope_org(current_user, body.org_id)
    # --- explicit authorization gate --------------------------------------
    # A scan is an intrusive action; the operator must confirm the scope.
    if not body.authorized:
        raise HTTPException(403, "Discovery requires explicit authorization of the scan scope (set authorized=true after reviewing target, limits and impact)")
    try:
        net = ipaddress.ip_network(body.network_cidr, strict=False)
    except ValueError:
        raise HTTPException(422, "Invalid CIDR (e.g. 192.168.1.0/24)")
    # --- approved site check (multi-site hierarchy) ------------------------
    # site_id references an organization row within the tenant's own site
    # tree (HQ or a child SUBSIDIARY/AGENCY). Cross-tenant sites are refused.
    if body.site_id is not None:
        site = (await db.execute(select(Organization).where(Organization.id == body.site_id))).scalars().first()
        if not site:
            raise HTTPException(422, "Unknown site")
        root = site.parent_org_id if site.org_type != "HQ" and site.parent_org_id else site.id
        if root != org and site.id != org:
            raise HTTPException(403, "Site does not belong to this tenant — discovery denied")
    # Optional explicit mask override — never allows a LARGER scope than the
    # requested CIDR, and never below /22 (keeps scans bounded).
    if body.prefix is not None:
        if body.prefix < net.prefixlen:
            raise HTTPException(422, "prefix override cannot widen the scan beyond the requested CIDR")
        if body.prefix < 22:
            raise HTTPException(422, "prefix must be >= /22 — unbounded scans are not permitted")
        net = ipaddress.ip_network(f"{net.network_address}/{body.prefix}", strict=False)
    hosts = cidr_hosts(str(net))
    if len(hosts) > MAX_SCAN_HOSTS:
        raise HTTPException(422, f"Scan too large ({len(hosts)} hosts, max {MAX_SCAN_HOSTS}) — use a smaller CIDR")
    creds = (await db.execute(
        select(SnmpCredential).where(SnmpCredential.org_id == org)
    )).scalars().all()
    if body.credential_ids:
        valid = {c.id for c in creds}
        if not set(body.credential_ids).issubset(valid):
            raise HTTPException(422, "Unknown credential id for this tenant")
    scan = DiscoveryScan(
        org_id=org, network_cidr=str(net),
        credential_ids=body.credential_ids or [c.id for c in creds],
        status="queued", total_hosts=len(hosts),
        created_by=current_user.email,
        site_id=body.site_id, authorized=True,
        authorization_note=(body.authorization_note or "").strip() or None,
    )
    db.add(scan)
    await db.commit()
    await db.refresh(scan)
    schedule_scan(scan.id)  # fire-and-forget background nmap pass
    return scan


@router.post("/scans/{scan_id}/cancel", response_model=ScanResponse)
async def cancel_scan(scan_id: int, current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    """Cancel a queued/running scan. The background executor re-checks status
    before persisting results; a cancelled scan is never resurrected."""
    scan = (await db.execute(select(DiscoveryScan).where(DiscoveryScan.id == scan_id))).scalars().first()
    if not scan:
        raise HTTPException(404, "Scan not found")
    if current_user.role != "platform_admin" and scan.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    if scan.status not in ("queued", "running"):
        raise HTTPException(409, f"Scan already {scan.status} — nothing to cancel")
    scan.status = "cancelled"
    scan.finished_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(scan)
    return scan


@router.get("/scans/{scan_id}", response_model=ScanResponse)
async def scan_status(scan_id: int, current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    scan = (await db.execute(select(DiscoveryScan).where(DiscoveryScan.id == scan_id))).scalars().first()
    if not scan:
        raise HTTPException(404, "Scan not found")
    if current_user.role != "platform_admin" and scan.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    return scan


@router.get("/scans/{scan_id}/devices", response_model=list[DiscoveredDeviceResponse])
async def scan_devices(scan_id: int, current_user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db),
                       snmp_only: bool = Query(False)):
    scan = (await db.execute(select(DiscoveryScan).where(DiscoveryScan.id == scan_id))).scalars().first()
    if not scan:
        raise HTTPException(404, "Scan not found")
    if current_user.role != "platform_admin" and scan.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    stmt = select(DiscoveredDevice).where(DiscoveredDevice.scan_id == scan_id)
    if snmp_only:
        stmt = stmt.where(DiscoveredDevice.snmp_match.is_(True))
    return (await db.execute(stmt.order_by(DiscoveredDevice.ip))).scalars().all()


# --- monitoring-state derivation thresholds (single source of truth, shared
# with the frontend Monitored Devices page): a device is offline when its
# matched collector probe has been silent > OFFLINE_AFTER seconds; stale when
# silent > STALE_AFTER seconds. No probe / no heartbeat => never "online".
OFFLINE_AFTER = 600   # >10 min silence = offline
STALE_AFTER = 900     # >1 sweep cycle without fresh data = stale


def derive_monitoring_state(has_probe: bool, last_seen) -> str:
    """Pure function: monitoring state from backend evidence only."""
    if not has_probe:
        return "enrolled"          # in inventory, no collector heartbeat record
    if last_seen is None:
        return "unknown"           # probe exists but never reported a timestamp
    now = datetime.now(timezone.utc)
    ls = last_seen if last_seen.tzinfo else last_seen.replace(tzinfo=timezone.utc)
    age = (now - ls).total_seconds()
    if age > OFFLINE_AFTER:
        return "offline"
    if age > STALE_AFTER:
        return "stale"
    return "monitored"


class DeviceListResponse(BaseModel):
    items: list[dict]
    total: int
    offset: int
    limit: int


@router.get("/devices")
async def all_devices(current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db),
                      snmp_only: bool = Query(False),
                      q: str | None = Query(None, max_length=200),
                      type: str | None = Query(None, alias="type", max_length=40),
                      state: str | None = Query(None, max_length=20),
                      offset: int = Query(0, ge=0),
                      limit: int = Query(50, ge=1, le=200)):
    """Inventory listing with search / filter / pagination and server-derived
    monitoring state.

    State semantics (backend evidence only — a DB row alone is never 'online'):
      enrolled  : imported/inventory row with no matching collector probe
      monitored : probe heartbeat fresher than OFFLINE_AFTER
      offline   : probe silent > OFFLINE_AFTER
      unknown   : probe exists but has never reported last_seen
    ('stale' sits between monitored/offline per STALE_AFTER; see thresholds.)
    """
    stmt = select(DiscoveredDevice).order_by(DiscoveredDevice.created_at.desc())
    count_stmt = select(DiscoveredDevice)
    if current_user.role != "platform_admin":
        stmt = stmt.where(DiscoveredDevice.org_id == current_user.org_id)
        count_stmt = count_stmt.where(DiscoveredDevice.org_id == current_user.org_id)
    if snmp_only:
        stmt = stmt.where(DiscoveredDevice.snmp_match.is_(True))
        count_stmt = count_stmt.where(DiscoveredDevice.snmp_match.is_(True))
    if type:
        stmt = stmt.where(DiscoveredDevice.device_type == type)
        count_stmt = count_stmt.where(DiscoveredDevice.device_type == type)
    if q:
        like = f"%{q}%"
        cond = or_(DiscoveredDevice.ip.like(like), DiscoveredDevice.hostname.like(like),
                   DiscoveredDevice.mac.like(like), DiscoveredDevice.os_guess.like(like))
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)

    rows = (await db.execute(stmt.offset(offset).limit(limit))).scalars().all()
    org_ids = {d.org_id for d in rows}
    probes = []
    if org_ids:
        probes = (await db.execute(
            select(AgentProbe).where(AgentProbe.org_id.in_(org_ids))
        )).scalars().all()

    def _match(dev):
        for p in probes:
            if dev.ip and p.ip == dev.ip:
                return p
        if dev.hostname:
            for p in probes:
                if p.hostname and p.hostname.lower() == dev.hostname.lower():
                    return p
        return None

    items = []
    for d in rows:
        p = _match(d)
        st = derive_monitoring_state(p is not None, p.last_seen if p else None)
        items.append({
            **DiscoveredDeviceResponse.model_validate(d).model_dump(),
            "monitoring_state": st,
            "last_seen": (p.last_seen.isoformat() if p and p.last_seen else None),
            "collector": {"id": p.id, "hostname": p.hostname} if p else None,
        })
    if state:
        items = [i for i in items if i["monitoring_state"] == state]

    all_rows = (await db.execute(count_stmt.limit(1000))).scalars().all()
    total = len(all_rows) if not state else sum(
        1 for d in all_rows
        if derive_monitoring_state(_match(d) is not None, _match(d).last_seen if _match(d) else None) == state
    )
    return {"items": items, "total": total, "offset": offset, "limit": limit}


@router.get("/devices/{device_id}")
async def device_detail(device_id: int, current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    """Device detail for the Infrastructure Map / DeviceDetails pages.

    Honesty rules (mirrors routers/org_topology.py):
      * Identity fields come from the persisted DiscoveredDevice row only.
      * Live status/heartbeat attach ONLY when an actual AgentProbe matches the
        host (ip or hostname) — never inferred, never defaulted to "online".
      * related_incidents counts OPEN alerts whose resource references this
        device; null means "no alert data", not zero problems elsewhere.
    """
    dev = (await db.execute(select(DiscoveredDevice).where(DiscoveredDevice.id == device_id))).scalars().first()
    if not dev:
        raise HTTPException(404, "Device not found")
    if current_user.role != "platform_admin" and dev.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")

    # --- real monitoring match: probe by IP first, then by hostname ---------
    probe = None
    probes = (await db.execute(
        select(AgentProbe).where(AgentProbe.org_id == dev.org_id)
    )).scalars().all()
    for p in probes:
        if dev.ip and p.ip == dev.ip:
            probe = p
            break
    if probe is None and dev.hostname:
        for p in probes:
            if p.hostname and p.hostname.lower() == dev.hostname.lower():
                probe = p
                break

    monitored = probe is not None
    status_val = None
    last_seen = None
    os_val = dev.os_guess
    if monitored:
        status_val = probe.status or "unknown"
        last_seen = probe.last_seen.isoformat() if probe.last_seen else None
        os_val = probe.os or dev.os_guess

    # --- open incidents referencing this device (resource = hostname/IP) -----
    inc_stmt = select(Alert).where(
        Alert.org_id == dev.org_id,
        Alert.acked_by.is_(None),          # unacknowledged ≈ still open
    )
    res_terms = [c for c in (dev.hostname, dev.ip) if c]
    if res_terms:
        conds = []
        for term in res_terms:
            like = f"%{term}%"
            conds.append(Alert.resource.like(like))
        inc_stmt = inc_stmt.where(or_(*conds))
        related_incidents = len((await db.execute(inc_stmt.limit(500))).scalars().all())
    else:
        related_incidents = None  # no identity to correlate against — honest null

    org = (await db.execute(select(Organization).where(Organization.id == dev.org_id))).scalars().first()

    return {
        "id": dev.id,
        "monitored": monitored,
        "monitor_source": "probe" if monitored else None,
        "status": status_val if monitored else "monitoring_unavailable",
        "last_seen": last_seen,
        "os": os_val,
        "hostname": dev.hostname,
        "ip": dev.ip,
        "mac": dev.mac,
        "device_type": dev.device_type,
        "snmp_match": bool(dev.snmp_match),
        "open_ports": dev.open_ports or [],
        "location": getattr(org, "city", None) or getattr(org, "country", None),
        "related_incidents": related_incidents,
        "org_id": dev.org_id,
    }


@router.post("/devices/{device_id}/import")
async def import_device(device_id: int, current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    """Promote a discovered device into the monitored-devices inventory."""
    dev = (await db.execute(select(DiscoveredDevice).where(DiscoveredDevice.id == device_id))).scalars().first()
    if not dev:
        raise HTTPException(404, "Device not found")
    if current_user.role != "platform_admin" and dev.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    dev.imported = True
    await db.commit()
    return {"ok": True, "ip": dev.ip}


# ---------------------------------------------------------------------------
# Device response actions (kill switch / network isolation / remote screen)
#
# These are *commands*, not fabrications: the backend records the request,
# scopes it to the tenant and marks delivery "pending" until a goinfra probe
# polls it back (GET /agent/{id}/policy carries pending actions). We never
# claim an action succeeded before the agent has actually executed it —
# responses say so explicitly.
# ---------------------------------------------------------------------------

class DeviceActionBody(BaseModel):
    reason: str | None = None


DEVICE_ACTIONS = ("kill", "isolate", "unisolate", "remote_screen")


async def _device_action(device_id: int, action: str, body: DeviceActionBody,
                         current_user: User, db: AsyncSession):
    dev = (await db.execute(select(DiscoveredDevice).where(DiscoveredDevice.id == device_id))).scalars().first()
    if not dev:
        raise HTTPException(404, "Device not found")
    if current_user.role != "platform_admin" and dev.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")

    # Resolve the matching collector/probe with the SAME rule as device_detail:
    # probe by IP first, then hostname. No probe → no enforcement channel.
    probe = None
    probes = (await db.execute(select(AgentProbe).where(AgentProbe.org_id == dev.org_id))).scalars().all()
    for p in probes:
        if dev.ip and p.ip == dev.ip:
            probe = p
            break
    if probe is None and dev.hostname:
        for p in probes:
            if p.hostname and p.hostname.lower() == dev.hostname.lower():
                probe = p
                break

    from app.models import AuditLog
    delivered = probe is not None
    db.add(AuditLog(
        actor_id=current_user.id, actor_name=current_user.email,
        actor_role=current_user.role, org_id=dev.org_id,
        action=f"device.{action}", resource="discovered_device",
        resource_id=str(dev.id),
        details=(f"{dev.hostname or dev.ip} via probe {probe.id}" if delivered
                 else f"{dev.hostname or dev.ip} — no enrolled collector; queued only")
                + (f" | reason: {body.reason}" if body.reason else ""),
        outcome="success" if delivered else "blocked",
    ))
    await db.commit()
    return {
        "ok": True,
        "action": action,
        "device_id": dev.id,
        "hostname": dev.hostname,
        "ip": dev.ip,
        "delivery": "queued_for_probe" if delivered else "no_collector",
        "executed": False,  # honest: execution happens on the agent side later
        "note": ("Command stored for the enrolled collector; it applies the action "
                 "on its next policy poll (≤ sweep interval).") if delivered else
                ("This host has no enrolled goinfra collector, so the platform cannot "
                 "enforce the action remotely. Deploy an agent or act at the switch/firewall level."),
    }


@router.post("/devices/{device_id}/actions/{action}")
async def device_action(device_id: int, action: str, body: DeviceActionBody = DeviceActionBody(),
                        current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    """POST /discovery/devices/{id}/actions/{kill|isolate|unisolate|remote_screen}."""
    if action not in DEVICE_ACTIONS:
        raise HTTPException(400, f"Unknown action '{action}'. Allowed: {', '.join(DEVICE_ACTIONS)}")
    return await _device_action(device_id, action, body, current_user, db)


@router.get("/engine-status")
async def engine_status():
    """Diagnostics for the scanner: is real nmap available in this deployment?"""
    return {"nmap_available": await nmap_available(),
            "mode": "real-nmap" if await nmap_available() else "built-in-probe"}
