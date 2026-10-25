"""SNMP Credentials & Network Auto-Discovery API.

Scans run in the background (asyncio task) using real nmap when installed;
the client polls scan status and results. Devices that answer any of the
tenant's SNMP credentials are flagged `snmp_match` and emit an event into the
Notification Engine (which can auto-create a ticket via rules).
"""
import ipaddress

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.core.security import get_current_user
from app.models import (
    User, SnmpCredential, DiscoveryScan, DiscoveredDevice, Organization,
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


@router.post("/scans", response_model=ScanResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_scan(body: ScanCreate, current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    org = _scope_org(current_user, body.org_id)
    try:
        ipaddress.ip_network(body.network_cidr, strict=False)
    except ValueError:
        raise HTTPException(422, "Invalid CIDR (e.g. 192.168.1.0/24)")
    creds = (await db.execute(
        select(SnmpCredential).where(SnmpCredential.org_id == org)
    )).scalars().all()
    if body.credential_ids:
        valid = {c.id for c in creds}
        if not set(body.credential_ids).issubset(valid):
            raise HTTPException(422, "Unknown credential id for this tenant")
    scan = DiscoveryScan(
        org_id=org, network_cidr=body.network_cidr,
        credential_ids=body.credential_ids or [c.id for c in creds],
        status="queued", total_hosts=len(cidr_hosts(body.network_cidr)),
        created_by=current_user.email,
    )
    db.add(scan)
    await db.commit()
    await db.refresh(scan)
    schedule_scan(scan.id)  # fire-and-forget background nmap pass
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


@router.get("/devices", response_model=list[DiscoveredDeviceResponse])
async def all_devices(current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db),
                      snmp_only: bool = Query(False)):
    stmt = select(DiscoveredDevice).order_by(DiscoveredDevice.created_at.desc()).limit(1000)
    if current_user.role != "platform_admin":
        stmt = stmt.where(DiscoveredDevice.org_id == current_user.org_id)
    if snmp_only:
        stmt = stmt.where(DiscoveredDevice.snmp_match.is_(True))
    return (await db.execute(stmt)).scalars().all()


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


@router.get("/engine-status")
async def engine_status():
    """Diagnostics for the scanner: is real nmap available in this deployment?"""
    return {"nmap_available": await nmap_available(),
            "mode": "real-nmap" if await nmap_available() else "built-in-probe"}
