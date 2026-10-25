"""goinfra agent API — enrollment, heartbeat, inventory, metrics, discovery.

Authenticated with a per-tenant API token (Bearer icag_..., created below or
from Settings → Agents). Everything is scoped to the token's organization, so
one compromised probe can never read or poison another tenant's data.

The agent endpoints reuse the exact same persistence path as the server-side
Python auto-discovery engine (app.services.discovery): devices land in the
discovered_devices queue via DiscoveryScan/DiscoveredDevice rows, SNMP-matched
ones emit an Alert through the Notification Engine (auto-ticketing rules apply
identically). The probe only moves the scan execution from our side to the
client network — the data model and pipeline stay shared.
"""
import hashlib
import ipaddress
import logging
import secrets
from datetime import datetime, timedelta, timezone as tz

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_agent_token, get_current_user
from app.database import get_db
from app.models import (
    AgentDiscoveredDevice, AgentInventory, AgentMetric, AgentProbe, AgentToken,
    Alert, DiscoveredDevice, DiscoveryScan, SnmpCredential,
    TenantSetting, User,
)
from app.services.ticketing import now_utc

logger = logging.getLogger("infracentra.agent")

router = APIRouter(prefix="/agent", tags=["goinfra agent"])

# ---------------------------------------------------------------------------
# Token management (web UI / platform admins create these; agents consume them)
# ---------------------------------------------------------------------------

tok_router = APIRouter(prefix="/agent-tokens", tags=["goinfra agent"])


class TokenCreate(BaseModel):
    name: str = "default"
    org_id: int | None = None       # platform admin only


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


@tok_router.post("", status_code=201)
async def create_agent_token(body: TokenCreate, current_user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    """Mint a tenant API token. The secret is returned exactly once — only its
    SHA-256 hash is stored."""
    org_id = _scope_org(current_user, body.org_id)
    plain = "icag_" + secrets.token_urlsafe(32)
    row = AgentToken(
        org_id=org_id, name=body.name or "default",
        token_hash=hashlib.sha256(plain.encode()).hexdigest(),
        prefix=plain[:12], created_by=current_user.email,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"id": row.id, "org_id": org_id, "name": row.name,
            "token": plain, "created_at": row.created_at,
            "note": "Store this token now — it is shown only once."}


@tok_router.get("")
async def list_agent_tokens(current_user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    stmt = select(AgentToken).order_by(AgentToken.id.desc())
    if current_user.role != "platform_admin":
        stmt = stmt.where(AgentToken.org_id == current_user.org_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [{"id": t.id, "org_id": t.org_id, "name": t.name, "prefix": t.prefix,
             "revoked": t.revoked_at is not None, "last_used_at": t.last_used_at,
             "created_at": t.created_at} for t in rows]


@tok_router.delete("/{token_id}", status_code=204)
async def revoke_agent_token(token_id: int, current_user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    t = (await db.execute(select(AgentToken).where(AgentToken.id == token_id))).scalars().first()
    if t is None:
        raise HTTPException(404, "token not found")
    if current_user.role != "platform_admin" and t.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    t.revoked_at = now_utc()
    await db.commit()


# ---------------------------------------------------------------------------
# Probe-scoped helpers
# ---------------------------------------------------------------------------

async def _get_probe(probe_id: int, token: AgentToken, db: AsyncSession) -> AgentProbe:
    probe = (await db.execute(
        select(AgentProbe).where(AgentProbe.id == probe_id,
                                 AgentProbe.org_id == token.org_id)
    )).scalars().first()
    if probe is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "probe not enrolled for this token's tenant")
    return probe


async def _touch(db: AsyncSession, probe: AgentToken | AgentProbe):  # type: ignore[valid-type]
    probe.last_seen = now_utc()
    probe.status = "online"
    await db.commit()


# ---------------------------------------------------------------------------
# Enrollment handshake — idempotent per (org, hostname)
# ---------------------------------------------------------------------------

class HelloBody(BaseModel):
    hostname: str
    agent_version: str = ""
    os: str = ""                     # linux | windows (agent runtime GOOS)
    ip: str = ""                     # primary NIC address, for fleet display


@router.post("/hello")
async def agent_hello(body: HelloBody, token: AgentToken = Depends(get_agent_token),
                      db: AsyncSession = Depends(get_db)):
    hostname = (body.hostname or "").strip()[:253]
    if not hostname:
        raise HTTPException(422, "hostname required")
    probe = (await db.execute(
        select(AgentProbe).where(AgentProbe.org_id == token.org_id,
                                 AgentProbe.hostname == hostname)
    )).scalars().first()
    if probe is None:
        probe = AgentProbe(org_id=token.org_id, hostname=hostname,
                           agent_version=body.agent_version)
        db.add(probe)
    else:
        probe.agent_version = body.agent_version or probe.agent_version
    if body.os:
        probe.os = body.os[:60]
    if body.ip:
        probe.ip = body.ip[:60]
    probe.status = "online"
    probe.last_seen = now_utc()
    await db.commit()
    await db.refresh(probe)
    return {"agent_id": probe.id, "tenant_id": probe.org_id, "hostname": probe.hostname,
            "status": probe.status, "server_time": now_utc().isoformat()}


@router.post("/{agent_id}/heartbeat")
async def heartbeat(agent_id: int, token: AgentToken = Depends(get_agent_token),
                   db: AsyncSession = Depends(get_db)):
    probe = await _get_probe(agent_id, token, db)
    await _touch(db, probe)
    return {"ok": True, "server_time": now_utc().isoformat()}


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------

@router.post("/{agent_id}/inventory", status_code=201)
async def report_inventory(agent_id: int, payload: dict,
                           token: AgentToken = Depends(get_agent_token),
                           db: AsyncSession = Depends(get_db)):
    probe = await _get_probe(agent_id, token, db)
    raw_collected = payload.get("collected_at")
    collected = None
    if isinstance(raw_collected, str):
        try:
            collected = datetime.fromisoformat(raw_collected.replace("Z", "+00:00"))
        except ValueError:
            collected = None
    inv = AgentInventory(probe_id=probe.id, org_id=probe.org_id,
                         collected_at=collected or now_utc(), payload=payload)
    db.add(inv)
    # keep only the latest 50 snapshots per probe (bounded storage)
    await db.flush()
    stale = (await db.execute(
        select(AgentInventory.id).where(AgentInventory.probe_id == probe.id)
        .order_by(AgentInventory.id.desc()).offset(50)
    )).scalars().all()
    if stale:
        await db.execute(delete(AgentInventory).where(AgentInventory.id.in_(stale)))
    await _touch(db, probe)
    return {"ok": True, "inventory_id": inv.id}


@router.get("/{agent_id}/inventory/latest")
async def latest_inventory(agent_id: int, token: AgentToken = Depends(get_agent_token),
                           db: AsyncSession = Depends(get_db)):
    probe = await _get_probe(agent_id, token, db)
    inv = (await db.execute(
        select(AgentInventory).where(AgentInventory.probe_id == probe.id)
        .order_by(AgentInventory.id.desc()).limit(1)
    )).scalars().first()
    if inv is None:
        raise HTTPException(404, "no inventory yet")
    return {"inventory_id": inv.id, "collected_at": inv.collected_at, "payload": inv.payload}


# ---------------------------------------------------------------------------
# Metrics stream
# ---------------------------------------------------------------------------

class MetricsBody(BaseModel):
    points: list[dict] = []


@router.post("/{agent_id}/metrics", status_code=201)
async def push_metrics(agent_id: int, body: MetricsBody,
                       token: AgentToken = Depends(get_agent_token),
                       db: AsyncSession = Depends(get_db)):
    probe = await _get_probe(agent_id, token, db)
    n = 0
    for p in body.points[:500]:
        try:
            ts = int(p.get("ts", 0))
        except (TypeError, ValueError):
            continue
        if ts <= 0:
            continue
        m = await db.get(AgentMetric, (ts, probe.id))
        if m is None:
            m = AgentMetric(ts=ts, probe_id=probe.id, org_id=probe.org_id)
            db.add(m)
        for col in ("cpu_percent", "mem_used_percent", "mem_total_bytes",
                    "disk_worst_percent", "load1", "net_recv_bps", "net_sent_bps",
                    "temp_max_celsius"):
            if col in p and p[col] is not None:
                setattr(m, col, p[col])
        n += 1
    await _touch(db, probe)
    return {"ok": True, "stored": n}


@router.get("/{agent_id}/metrics")
async def query_metrics(agent_id: int, hours: int = 24,
                        token: AgentToken = Depends(get_agent_token),
                        db: AsyncSession = Depends(get_db)):
    probe = await _get_probe(agent_id, token, db)
    since = int((datetime.now(tz.utc) - timedelta(hours=min(hours, 720))).timestamp())
    rows = (await db.execute(
        select(AgentMetric).where(AgentMetric.probe_id == probe.id, AgentMetric.ts >= since)
        .order_by(AgentMetric.ts.asc()).limit(20000)
    )).scalars().all()
    return [{"ts": m.ts, "cpu_percent": m.cpu_percent, "mem_used_percent": m.mem_used_percent,
             "disk_worst_percent": m.disk_worst_percent, "load1": m.load1,
             "net_recv_bps": m.net_recv_bps, "net_sent_bps": m.net_sent_bps,
             "temp_max_celsius": m.temp_max_celsius} for m in rows]


# ---------------------------------------------------------------------------
# Scan policy — sweep targets + SNMP credentials handed down to probes
# ---------------------------------------------------------------------------

@router.get("/{agent_id}/policy")
async def get_policy(agent_id: int, token: AgentToken = Depends(get_agent_token),
                     db: AsyncSession = Depends(get_db)):
    probe = await _get_probe(agent_id, token, db)
    creds = (await db.execute(
        select(SnmpCredential).where(SnmpCredential.org_id == probe.org_id)
    )).scalars().all()
    ts = (await db.get(TenantSetting, probe.org_id))
    data = (ts.data or {}) if ts else {}
    cidrs = data.get("sweep_cidrs") or []
    if not cidrs:
        cidrs = ["auto"]          # probe derives CIDRs from its own NICs
    return {
        "sweep_cidrs": cidrs,
        "interval_seconds": int(data.get("scan_interval_seconds", 300)),
        "snmp_credentials": [{
            "name": c.name, "version": c.version, "community": c.community,
            "username": c.username, "auth_protocol": c.auth_protocol,
            "auth_passphrase": c.auth_passphrase, "priv_protocol": c.priv_protocol,
            "priv_passphrase": c.priv_passphrase, "port": c.port or 161,
        } for c in creds],
    }


# ---------------------------------------------------------------------------
# Discovery upload — feeds the SAME pipeline as the Python engine
# ---------------------------------------------------------------------------

class AgentDevice(BaseModel):
    ip: str
    mac: str | None = None
    hostname: str | None = None
    os_guess: str | None = None
    device_type: str | None = None
    open_ports: list[int] = []
    sys_name: str | None = None
    sys_descr: str | None = None
    via_agent: int = 0


class DiscoveryBody(BaseModel):
    devices: list[AgentDevice] = []


def _guess_os_and_type(open_ports: list[int]) -> tuple[str, str]:
    """Mirror of app.services.discovery.guess_os_and_type (kept local to avoid
    importing the scanner's nmap machinery)."""
    s = set(open_ports)
    if {161} & s or {80, 161, 22} <= s:
        return "network-os", "network"
    if 9100 in s:
        return "printer", "printer"
    if 3389 in s:
        return "windows", "workstation"
    if 445 in s:
        return "windows", "server"
    if 22 in s:
        return "linux", "server"
    return "unknown", "unknown"


async def _next_alert_uid(db: AsyncSession) -> str:
    count = len((await db.execute(select(Alert.id))).scalars().all())
    return f"ALR-{count + 1:06d}"


@router.post("/{agent_id}/discovery", status_code=201)
async def report_discovery(agent_id: int, body: DiscoveryBody,
                           token: AgentToken = Depends(get_agent_token),
                           db: AsyncSession = Depends(get_db)):
    probe = await _get_probe(agent_id, token, db)
    org_id = probe.org_id

    # One virtual scan row per agent upload batch so results show up in the
    # existing /api/discovery UI exactly like a server-side nmap run.
    scan = DiscoveryScan(
        org_id=org_id, network_cidr="agent-probe", status="completed",
        credential_ids=[], total_hosts=len(body.devices), discovered=len(body.devices),
        snmp_matched=sum(1 for d in body.devices if d.sys_descr),
        started_at=now_utc(), finished_at=now_utc(), created_by=f"probe:{probe.id}",
    )
    db.add(scan)
    await db.flush()

    new_devs = 0
    for d in body.devices:
        try:
            ipaddress.ip_address(d.ip)
        except ValueError:
            continue
        os_guess = d.os_guess or ""
        dtype = d.device_type or ""
        if not os_guess or not dtype:
            g_os, g_t = _guess_os_and_type(d.open_ports or [])
            os_guess = os_guess or g_os
            dtype = dtype or g_t
        dev = DiscoveredDevice(
            scan_id=scan.id, org_id=org_id, ip=d.ip, mac=d.mac, hostname=d.hostname,
            os_guess=os_guess[:60] if os_guess else "unknown", device_type=dtype,
            open_ports=d.open_ports or [], snmp_match=bool(d.sys_descr or d.sys_name),
            sys_desc=(d.sys_descr or d.sys_name), is_probe=False,
        )
        db.add(dev)
        new_devs += 1

        # upsert the long-lived agent-device registry
        ad = (await db.execute(
            select(AgentDiscoveredDevice).where(AgentDiscoveredDevice.org_id == org_id,
                                                AgentDiscoveredDevice.ip == d.ip)
        )).scalars().first()
        if ad is None:
            ad = AgentDiscoveredDevice(org_id=org_id, probe_id=probe.id, ip=d.ip)
            db.add(ad)
        ad.probe_id = probe.id
        ad.mac, ad.hostname, ad.os_guess, ad.device_type = d.mac, d.hostname, os_guess, dtype
        ad.open_ports = d.open_ports or []
        ad.sys_name, ad.sys_desc = d.sys_name, d.sys_descr
        ad.last_seen = now_utc()

        # SNMP-managed device found -> same alert/notification path as nmap scans
        if dev.snmp_match:
            alert = Alert(
                uid=await _next_alert_uid(db), org_id=org_id,
                title=f"SNMP-matched device discovered at {d.ip} (via probe {probe.hostname})",
                description=(f"Probe '{probe.hostname}' found a device answering SNMP: "
                             f"{(d.sys_descr or d.sys_name or '')[:120]}"),
                severity="info", source="snmp", resource=d.hostname or d.ip,
                raw_payload={"probe_id": probe.id, "ip": d.ip,
                             "sys_name": d.sys_name},
                created_at=now_utc(),
            )
            db.add(alert)
            await db.flush()
            from app.services.notifications import process_alert
            await process_alert(db, alert)

    scan.discovered = new_devs
    await _touch(db, probe)
    await db.commit()
    return {"ok": True, "scan_id": scan.id, "stored": new_devs}


# ---------------------------------------------------------------------------
# Probe fleet view (used by dashboard / settings page)
# ---------------------------------------------------------------------------

@router.get("/probes/list")
async def list_probes(current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    stmt = select(AgentProbe).order_by(AgentProbe.id)
    if current_user.role != "platform_admin":
        stmt = stmt.where(AgentProbe.org_id == current_user.org_id)
    probes = (await db.execute(stmt)).scalars().all()
    cutoff = now_utc() - timedelta(minutes=10)
    out = []
    for p in probes:
        online = p.last_seen is not None and (
            p.last_seen.tzinfo is not None and p.last_seen >= cutoff
            or p.last_seen.replace(tzinfo=tz.utc) >= cutoff)
        if not online and p.status == "online":
            p.status = "offline"
            await db.commit()
        out.append({"id": p.id, "org_id": p.org_id, "hostname": p.hostname,
                    "agent_version": p.agent_version, "status": p.status,
                    "os": p.os, "ip": p.ip, "last_seen": p.last_seen})
    return out


# ---------------------------------------------------------------------------
# Fleet reads for the web UI (session-JWT authenticated — the /agent/* routes
# above require the agent's icag_ Bearer token and cannot be called from a
# browser). All scoped to the caller's org; platform admins may pass org_id.
# ---------------------------------------------------------------------------

web_router = APIRouter(prefix="/agents", tags=["goinfra agent"])


async def _web_probe(probe_id: int, current_user: User, db: AsyncSession) -> AgentProbe:
    probe = await db.get(AgentProbe, probe_id)
    if probe is None:
        raise HTTPException(404, "probe not found")
    if current_user.role != "platform_admin" and probe.org_id != current_user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    return probe


@web_router.get("/probes")
async def web_list_probes(current_user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    """Same fleet view as /agent/probes/list but JWT-authenticated."""
    return await list_probes(current_user=current_user, db=db)


@web_router.get("/probes/{probe_id}/inventory/latest")
async def web_latest_inventory(probe_id: int, current_user: User = Depends(get_current_user),
                               db: AsyncSession = Depends(get_db)):
    probe = await _web_probe(probe_id, current_user, db)
    inv = (await db.execute(
        select(AgentInventory).where(AgentInventory.probe_id == probe.id)
        .order_by(AgentInventory.id.desc()).limit(1)
    )).scalars().first()
    if inv is None:
        raise HTTPException(404, "no inventory yet")
    return {"inventory_id": inv.id, "collected_at": inv.collected_at, "payload": inv.payload}


@web_router.get("/probes/{probe_id}/metrics")
async def web_query_metrics(probe_id: int, hours: int = 24,
                            current_user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    probe = await _web_probe(probe_id, current_user, db)
    since = int((datetime.now(tz.utc) - timedelta(hours=max(1, min(hours, 720)))).timestamp())
    rows = (await db.execute(
        select(AgentMetric).where(AgentMetric.probe_id == probe.id, AgentMetric.ts >= since)
        .order_by(AgentMetric.ts.asc()).limit(20000)
    )).scalars().all()
    return [{"ts": m.ts, "cpu_percent": m.cpu_percent, "mem_used_percent": m.mem_used_percent,
             "disk_worst_percent": m.disk_worst_percent, "load1": m.load1,
             "net_recv_bps": m.net_recv_bps, "net_sent_bps": m.net_sent_bps,
             "temp_max_celsius": m.temp_max_celsius} for m in rows]


@web_router.get("/discovered-devices")
async def web_discovered_devices(org_id: int | None = None,
                                 current_user: User = Depends(get_current_user),
                                 db: AsyncSession = Depends(get_db)):
    stmt = select(AgentDiscoveredDevice).order_by(AgentDiscoveredDevice.last_seen.desc()).limit(2000)
    if current_user.role != "platform_admin":
        stmt = stmt.where(AgentDiscoveredDevice.org_id == current_user.org_id)
    elif org_id is not None:
        stmt = stmt.where(AgentDiscoveredDevice.org_id == org_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [{"id": d.id, "probe_id": d.probe_id, "ip": d.ip, "mac": d.mac,
             "hostname": d.hostname, "os_guess": d.os_guess, "device_type": d.device_type,
             "sys_name": d.sys_name, "snmp": bool(d.sys_desc or d.sys_name),
             "open_ports": d.open_ports or [], "last_seen": d.last_seen} for d in rows]
