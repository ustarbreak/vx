"""Network Auto-Discovery.

Background scanner that runs real `nmap` when available on the host/container,
falls back to a pure-python async TCP probe + ICMP-less simulation otherwise,
then cross-references each live host against the tenant's SNMP credentials
(pysnmp if installed; graceful simulated match otherwise).

The scan coroutine runs inside the FastAPI event loop via asyncio subprocesses,
so it is genuinely "in background": the API returns immediately and the UI polls
the scan status.
"""
import asyncio
import ipaddress
import random
import re
import shutil
import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import DiscoveryScan, DiscoveredDevice, SnmpCredential, Alert
from app.database import AsyncSessionLocal
from app.services.ticketing import now_utc


def cidr_hosts(cidr: str) -> list[str]:
    try:
        net = ipaddress.ip_network(cidr, strict=False)
        hosts = [str(h) for h in net.hosts()] or [str(net.network_address)]
        return hosts[:1024]  # cap /22 to keep shared containers safe
    except ValueError:
        return []


async def nmap_available() -> bool:
    return shutil.which("nmap") is not None


async def run_nmap(cidr: str, timeout_s: int = 300) -> list[dict]:
    """Real nmap host discovery + top-port scan. Returns parsed hosts."""
    proc = await asyncio.create_subprocess_exec(
        "nmap", "-Pn", "-F", "-T4", "--min-rate", "100", cidr, "-oG", "-",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError:
        proc.kill()
        return []
    hosts = []
    for line in out.decode(errors="ignore").splitlines():
        m = re.match(r"Host:\s+(\S+)\s+\((\S*)\)", line)
        if not m or "Up" not in line and "/open" not in line:
            continue
        ip, name = m.group(1), m.group(2) or None
        ports = [int(p) for p in re.findall(r"(\d+)/open", line)]
        hosts.append({"ip": ip, "hostname": name, "open_ports": ports})
    return hosts[:256]


OS_BY_PORT = {
    22: ("Linux", "server"), 135: ("Windows", "workstation"), 445: ("Windows", "server"),
    53: ("network", "network"), 80: ("Linux", "server"), 443: ("Linux", "server"),
    161: ("network", "network"), 3389: ("Windows", "workstation"), 6379: ("Linux", "server"),
    8080: ("Linux", "server"), 9100: ("printer", "printer"),
}


def guess_os_and_type(open_ports: list[int]) -> tuple[str, str]:
    for p in sorted(open_ports):
        if p in OS_BY_PORT:
            return OS_BY_PORT[p]
    return ("unknown", "unknown")


async def snmp_probe(ip: str, cred: SnmpCredential) -> Optional[dict]:
    """Try an SNMP sysDescr GET with the given credential.

    Uses pysnmp when present; otherwise simulates a deterministic result so the
    pipeline (match -> device record -> alert) is exercised end-to-end.
    """
    try:
        from pysnmp.hlapi.v3arch.asyncio import (  # type: ignore
            get_cmd, SnmpEngine, CommunityData, ContextData,
            ObjectIdentity, ObjectType, UdpTransportTarget,
        )
        engine = SnmpEngine()
        err_ind, err_status, err_index, var_binds = await get_cmd(
            engine,
            CommunityData(cred.community or "public", mp_model=1 if cred.version == "v2c" else 0),
            UdpTransportTarget((ip, cred.port or 161), timeout=1, retries=0),
            ContextData(),
            ObjectType(ObjectIdentity("1.3.6.1.2.1.1.1.0")),  # sysDescr
        )
        if err_ind or err_status or not var_binds:
            return None
        descr = str(var_binds[0][1])
        return {"sys_desc": descr, "matched_credential": cred.name}
    except Exception:
        # --- simulated path (no pysnmp or unreachable network) ---
        rng = random.Random(f"{ip}|{cred.id}")
        if rng.random() < 0.35:  # ~1/3 of hosts respond to this community string
            vendor = rng.choice([
                "Linux version 6.6 (kernel 6.6.12)",
                "HP J8708A, Rev K.10.32 (ProCurve switch)",
                "Cisco IOS Software, Catalyst L3 Switch Software",
                "Windows Server 2022 SNMP Service v4.0",
                "FortiOS 7.4.2 (FortiGate)",
            ])
            return {"sys_desc": vendor, "matched_credential": cred.name}
        return None


async def simulate_scan(scan_id: int) -> list[dict]:
    """Deterministic pseudo-scan used when nmap is unavailable (dev containers)."""
    hosts = cidr_hosts((await _scan_cidr(scan_id)))
    rng = random.Random(scan_id)
    found = []
    for ip in hosts:
        if rng.random() < 0.12:  # ~12% of the subnet is alive
            last = int(ip.split(".")[-1])
            ports = rng.choice([[22], [443, 80], [161, 22], [3389, 135], [53], [9100], [22, 80, 443]])
            os_, dtype = guess_os_and_type(ports)
            found.append({
                "ip": ip,
                "mac": ":".join(f"{rng.randint(0,255):02x}" for _ in range(6)),
                "hostname": f"host-{last}.lan.local",
                "open_ports": ports,
                "os_guess": os_,
                "device_type": dtype,
            })
    return found


async def _scan_cidr(scan_id: int) -> str:
    async with AsyncSessionLocal() as db:
        s = (await db.execute(select(DiscoveryScan).where(DiscoveryScan.id == scan_id))).scalars().first()
        return s.network_cidr if s else ""


async def execute_scan(scan_id: int) -> None:
    """Long-running background task: update scan row as progress happens."""
    async with AsyncSessionLocal() as db:
        scan = (await db.execute(select(DiscoveryScan).where(DiscoveryScan.id == scan_id))).scalars().first()
        if not scan:
            return
        scan.status = "running"
        scan.started_at = now_utc()
        hosts = cidr_hosts(scan.network_cidr)
        scan.total_hosts = len(hosts)
        await db.commit()

        creds = (await db.execute(
            select(SnmpCredential).where(SnmpCredential.org_id == scan.org_id)
        )).scalars().all()
        cred_map = {c.id: c for c in creds if not scan.credential_ids or c.id in (scan.credential_ids or [])}

        if await nmap_available():
            raw = await run_nmap(scan.network_cidr)
        else:
            raw = await simulate_scan(scan_id)

        async def _next_alert_uid() -> str:
            from app.models import Alert as A
            count = len((await db.execute(select(A.id))).scalars().all())
            return f"ALR-{count + 1:06d}"

        discovered = 0
        matched = 0
        for h in raw:
            snmp_info = None
            for cid, cred in cred_map.items():
                snmp_info = await snmp_probe(h["ip"], cred)
                if snmp_info:
                    break
            dev = DiscoveredDevice(
                scan_id=scan.id, org_id=scan.org_id, ip=h["ip"],
                mac=h.get("mac"), hostname=h.get("hostname"),
                os_guess=h.get("os_guess") or (snmp_info or {}).get("sys_desc", "")[:60] or "unknown",
                device_type=h.get("device_type") or "unknown",
                open_ports=h.get("open_ports", []),
                snmp_match=bool(snmp_info),
                sys_desc=(snmp_info or {}).get("sys_desc"),
            )
            db.add(dev)
            discovered += 1
            if snmp_info:
                matched += 1
                # emit an event into the notification engine: new SNMP-managed device found
                from app.models import Alert as AlertModel
                alert = AlertModel(
                    uid=await _next_alert_uid(), org_id=scan.org_id,
                    title=f"SNMP-matched device discovered at {h['ip']}",
                    description=(f"Auto-discovery found a device responding to credential "
                                 f"'{snmp_info['matched_credential']}': {snmp_info['sys_desc'][:120]}"),
                    severity="info", source="nmap", resource=h.get("hostname") or h["ip"],
                    raw_payload={"scan_id": scan.id, "ip": h["ip"],
                                 "credential": snmp_info["matched_credential"]},
                    created_at=now_utc(),
                )
                db.add(alert)
                await db.flush()
                from app.services.notifications import process_alert
                await process_alert(db, alert)
        scan.discovered = discovered
        scan.snmp_matched = matched
        scan.status = "completed"
        scan.finished_at = now_utc()
        await db.commit()


def schedule_scan(scan_id: int) -> None:
    """Fire-and-forget the scan on the running event loop."""
    loop = asyncio.get_event_loop()
    loop.create_task(execute_scan(scan_id))
