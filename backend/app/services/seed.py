"""Seeding utilities for production deployments and the public demo.

`ensure_platform_admin` runs at startup: if no platform admin exists it creates
one from env vars (PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD, defaulting to
admin@infracentra.io / Admin#2026) so the very first login is possible without
manual SQL.

`seed_demo_tenant` lets a platform admin create a full working tenant (org +
client admin + auto-ticketing notification rules) in one click from Settings.

`ensure_demo_accounts` (DEMO MODE — separate from real production data): when
DEMO_SEED_ENABLED=true the backend provisions two *dedicated demo tenants* on
startup, each entitled to ALL 16 services INCLUDING the Advanced Ticketing
service that ships with the Pro & Enterprise plans. Demo logins therefore work
against the real API without touching customer tenants. The frontend "Demo
Mode" toggle stays fully client-side and never calls these accounts.
"""
import os
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.core.security import get_password_hash
from app.models import (
    User, Organization, NotificationRule, Entitlement,
    Alert, Ticket, DiscoveryScan, DiscoveredDevice,
    GroupingPolicy, UidCounter,
)

# ---------------------------------------------------------------------------
# STAGE 3 — grouping policy v1 seed + UID counter bootstrap.
# Idempotent; runs at startup BEFORE any ingestion can occur. Uses the
# create_all convention already in place (no Alembic revision).
# ---------------------------------------------------------------------------

async def ensure_grouping_policy(db: AsyncSession) -> None:
    """Seed the documented v1 grouping policy row if absent.

    Makes the fingerprint recipe / window / storm threshold auditable at
    runtime (services.notifications.get_grouping_policy reads this table).
    Never overwrites an existing version row — policies are immutable once
    published; a behavior change means inserting v2 and bumping POLICY_VERSION.
    """
    exists = (await db.execute(
        select(GroupingPolicy).where(GroupingPolicy.policy_version == "v1")
    )).scalars().first()
    if exists is None:
        db.add(GroupingPolicy(
            policy_version="v1",
            fingerprint_fields=["org_id", "source", "resource",
                                "title_lower_trimmed"],
            window_minutes=60,
            storm_threshold=5,
            notes="Stage 3 baseline. Identical to the historical hardcoded "
                  "behavior: sha1[:16] over org|source|resource|"
                  "lower(title); 60-minute fold window; re-notification "
                  "suppressed above 5 folds per group.",
        ))
        await db.commit()


async def ensure_uid_counters(db: AsyncSession) -> None:
    """Bootstrap uid_counters from legacy COUNT+1-numbered rows.

    The shared pipeline allocates ALR/TCK uids atomically from
    uid_counters(table,prefix). Existing rows were numbered by counting, so
    the counter must start at MAX(existing numeric suffix) or the first
    atomic claim would collide with a legacy uid's UNIQUE index. Gaps are
    acceptable; duplicates are not.
    """
    for table, prefix, model in (("alerts", "ALR", Alert),
                                 ("tickets", "TCK", Ticket)):
        uids = (await db.execute(select(model.uid))).scalars().all()
        max_n = 0
        for u in uids:
            try:
                max_n = max(max_n, int(str(u).rsplit("-", 1)[-1]))
            except (ValueError, AttributeError):
                continue
        await db.execute(
            text(
                "INSERT INTO uid_counters (table_name, prefix, last_value) "
                "VALUES (:t, :p, :v) "
                "ON CONFLICT (table_name, prefix) DO NOTHING"
            ),
            {"t": table, "p": prefix, "v": max_n},
        )
    await db.commit()

# ---------------------------------------------------------------------------
# DEMO WORLD MIRROR — keep these constants byte-identical with the frontend
# single source of truth src/data/demoWorld.ts. When DEMO_SEED_ENABLED=true
# the real backend renders EXACTLY the same world as Demo Mode: same tenants,
# same users, same 24 devices, 12 alerts and 12 tickets.
# ---------------------------------------------------------------------------
DEMO_WORLD_VERSION = "2026.10-1"

# Pack entitlements — mirror of PACK_SERVICES in app.routers.pricing_v2 and
# src/data/pricingConfig.ts: starter = 5 services, pro = 12 (+ ticketing),
# souverain = all 17 (+ ticketing).
PACK_SERVICES = {
    "starter": ["endpoint", "vuln", "patch", "backup", "compliance"],
    "pro": ["endpoint", "vuln", "patch", "backup", "compliance", "email", "incident",
            "network", "dns", "analytics", "threat_intel", "ticketing"],
    "souverain": ["endpoint", "vuln", "patch", "backup", "compliance", "email", "incident",
                  "network", "dns", "analytics", "threat_intel", "ticketing",
                  "soar", "cloud", "firewall_mgmt", "vpn", "sdwan"],
}

# demoTenants[] from demoWorld.ts (Moroccan clients used for the demo only).
DEMO_TENANT_SPECS = [
    {"id": 1, "name": "Damanecash", "tier": "pro", "plan_tier": "PRO",
     "billing_cycle": "MONTHLY", "endpoint_count": 45, "seat_limit": 20,
     "siem_limit_gb": 50, "country": "ma", "org_type": "HQ", "parent_org_id": None,
     "contact_email": "demo@infracentra.io", "member_count": 12, "asset_count": 12},
    {"id": 2, "name": "Valoris System", "tier": "enterprise", "plan_tier": "SOUVERAIN",
     "billing_cycle": "ANNUAL", "endpoint_count": 100, "seat_limit": 20,
     "siem_limit_gb": 50, "country": "ma", "org_type": "HQ", "parent_org_id": None,
     "contact_email": "k.chraibi@valorissystem.ma", "member_count": 15, "asset_count": 8},
    {"id": 3, "name": "Vivalis Salaf", "tier": "sme", "plan_tier": "STARTER",
     "billing_cycle": "MONTHLY", "endpoint_count": 18, "seat_limit": 3,
     "siem_limit_gb": 10, "country": "ma", "org_type": "SUBSIDIARY", "parent_org_id": 1,
     "contact_email": "h.tazi@vivalissalaf.ma", "member_count": 2, "asset_count": 4},
]

# demoTechnicians[] from demoWorld.ts (same names / emails / roles / orgs).
DEMO_USER_SPECS = [
    {"email": "y.elamrani@damanecash.ma", "name": "Y. El Amrani", "role": "technician", "org_id": 1},
    {"email": "s.bennani@damanecash.ma", "name": "S. Bennani", "role": "technician", "org_id": 1},
    {"email": "n.benali@damanecash.ma", "name": "N. Benali", "role": "service-desk", "org_id": 1},
    {"email": "k.chraibi@valorissystem.ma", "name": "K. Chraibi", "role": "technician", "org_id": 2},
    {"email": "a.fassi@valorissystem.ma", "name": "A. Fassi", "role": "analyst", "org_id": 2},
    {"email": "h.tazi@vivalissalaf.ma", "name": "H. Tazi", "role": "technician", "org_id": 3},
    {"email": "demo@infracentra.io", "name": "Demo Client Admin", "role": "client_admin", "org_id": 1},
    # Quick-Demo client admin accounts (DEMO_ACCOUNTS in AuthContext.tsx).
    # Without these rows the login page's "Client Admin" buttons 401 against
    # the real backend ("Account ... does not exist") — mirrored in
    # demoWorld.ts demoTechnicians for Demo Mode.
    {"email": "admin@damanecash.ma", "name": "Damanecash Admin", "role": "client_admin", "org_id": 1},
    {"email": "ciso@damanecash.ma", "name": "Damanecash CISO", "role": "client_admin", "org_id": 1},
    {"email": "soc@valorissystem.ma", "name": "Valoris SOC Manager", "role": "client_admin", "org_id": 2},
    {"email": "it@vivalissalaf.ma", "name": "Vivalis Salaf IT Admin", "role": "client_admin", "org_id": 3},
]

# demoDevices[] from demoWorld.ts — id, hostname, type, ip, status, location,
# orgId, os, lastSeenMin, throughputMbps, alerts, isProbe.
DEMO_DEVICE_SPECS = [
    # Damanecash (org 1) — 12 devices
    ("nd-1", "fw-edge-01", "firewall", "10.0.0.1", "online", "CAS-HQ-DC1", 1, "OPNsense 24.7", 0, 840, 1, True),
    ("nd-2", "sw-core-01", "switch", "10.0.1.1", "online", "CAS-HQ-DC1", 1, "iOS 17.6", 0, 2400, 0, False),
    ("nd-3", "ap-floor3-02", "ap", "10.0.5.33", "degraded", "CAS-HQ-F3", 1, "UniFi 8.0", 2, 120, 2, False),
    ("nd-4", "rtr-wan-01", "router", "10.0.0.2", "online", "CAS-HQ-DC1", 1, "IOS-XE 17.9", 0, 950, 0, False),
    ("nd-5", "ap-conf-01", "ap", "10.0.5.40", "offline", "CAS-HQ-Conf", 1, "UniFi 8.0", 35, 0, 1, False),
    ("nas-backup-01", "nas-backup-01", "storage", "10.0.9.10", "online", "DR-RBAT-DC2", 1, "TrueNAS 24.10", 0, 610, 1, False),
    ("db-primary-01", "db-primary-01", "server", "10.0.8.5", "online", "CAS-HQ-DC1", 1, "Ubuntu 22.04", 0, 320, 1, False),
    ("FIN-WS-042", "FIN-WS-042", "endpoint", "10.0.20.42", "online", "CAS-HQ-F2", 1, "Windows 11 23H2", 0, 45, 1, False),
    ("app-node-03", "app-node-03", "server", "10.0.7.13", "degraded", "CAS-HQ-DC1", 1, "RHEL 9", 0, 280, 1, False),
    ("web-prod-02", "web-prod-02", "server", "10.0.6.12", "online", "DMZ", 1, "Debian 12", 0, 190, 1, False),
    ("HR-DB-001", "HR-DB-001", "server", "10.0.8.9", "online", "CAS-HQ-DC1", 1, "RHEL 9", 0, 150, 0, False),
    ("MKT-WS-018", "MKT-WS-018", "endpoint", "10.0.24.18", "online", "CAS-HQ-F4", 1, "macOS 14.2", 1, 30, 0, False),
    # Valoris System (org 2) — 8 devices
    ("dc-core-sw-01", "dc-core-sw-01", "switch", "10.1.1.1", "online", "RB-DC-1", 2, "NX-OS 10.2", 0, 3100, 1, True),
    ("vpn-gw-01", "vpn-gw-01", "firewall", "10.1.0.1", "online", "RB-DC-1", 2, "Tailscale subnet", 0, 480, 1, False),
    ("DEV-SRV-007", "DEV-SRV-007", "server", "10.1.4.7", "online", "RB-Office", 2, "Ubuntu 22.04", 0, 210, 1, False),
    ("CI-CD-Runner-01", "CI-CD-Runner-01", "server", "10.1.4.21", "online", "RB-DC-1", 2, "Debian 12", 0, 90, 0, False),
    ("PKG-REG-001", "PKG-REG-001", "server", "10.1.4.30", "online", "RB-DC-1", 2, "Alpine 3.19", 0, 60, 0, False),
    ("BRU-RT-01", "BRU-RT-01", "router", "10.1.0.2", "degraded", "Tanger-Branch", 2, "VyOS 1.4", 4, 220, 1, False),
    ("LYO-AP-01", "LYO-AP-01", "ap", "10.1.5.11", "online", "Casa-Branch", 2, "UniFi 8.0", 0, 140, 0, False),
    ("GLX-FW-EDGE", "VLS-FW-EDGE", "firewall", "10.1.0.9", "online", "RB-DC-1", 2, "pfSense 2.7", 0, 700, 0, False),
    # Vivalis Salaf (org 3) — 4 devices
    ("INI-FW-01", "VVS-FW-01", "firewall", "10.2.0.1", "online", "MQ-Office", 3, "OPNsense 24.7", 0, 300, 0, True),
    ("nas-archive-02", "nas-archive-02", "storage", "10.2.9.10", "degraded", "MQ-Office", 3, "OpenMediaVault 7", 3, 80, 1, False),
    ("VVS-SRV-01", "VVS-SRV-01", "server", "10.2.8.5", "online", "MQ-Office", 3, "Windows Server 2022", 0, 110, 0, False),
    ("VVS-WS-003", "VVS-WS-003", "endpoint", "10.2.20.3", "offline", "MQ-Office", 3, "Windows 11", 120, 0, 0, False),
]

# demoAlertSeeds[] from demoWorld.ts — uid, title, severity, source, hostname, orgId, correlated.
DEMO_ALERT_SPECS = [
    ("ALR-0001", "Ransomware precursor: vssadmin + mass renames", "critical", "wazuh", "nas-backup-01", 1, 4),
    ("ALR-0002", "Brute-force SSH attempts from 45.132.87.10", "high", "wazuh", "fw-edge-01", 1, 23),
    ("ALR-0003", "Unauthorized privilege escalation attempt", "critical", "suricata", "dc-core-sw-01", 2, 1),
    ("ALR-0004", "CPU sustained above 92% for 15 minutes", "medium", "monitor", "app-node-03", 1, 3),
    ("ALR-0005", "Backup job failed with checksum mismatch", "low", "backup-agent", "nas-archive-02", 3, 1),
    ("ALR-0006", "Anomalous outbound traffic 4.7 GB (off-hours)", "high", "network-dlp", "FIN-WS-042", 1, 2),
    ("ALR-0007", "CVE-2026-31337 unpatched OpenSSL RCE detected", "critical", "vuln-scanner", "db-primary-01", 1, 1),
    ("ALR-0008", "TLS certificate expires in 6 days", "medium", "monitor", "web-prod-02", 1, 1),
    ("ALR-0009", "Access point ap-conf-01 unreachable", "high", "nms", "ap-conf-01", 1, 5),
    ("ALR-0010", "Compromised npm package beaconing detected", "high", "edr", "DEV-SRV-007", 2, 3),
    ("ALR-0011", "SD-WAN tunnel flapping BRU↔PAR", "medium", "sdwan", "BRU-RT-01", 2, 9),
    ("ALR-0012", "VPN concurrent seats at 96% capacity", "low", "monitor", "vpn-gw-01", 2, 1),
]

# demoTicketSeeds[] from demoWorld.ts — uid, title, description, status, priority,
# category, source, assignee, orgId, asset, sla_state, minutesAgo, ai_confidence, alertUid.
DEMO_TICKET_SPECS = [
    ("TCK-01001", "Ransomware precursor: mass file renames on NAS", "EDR flagged vssadmin shadow-copy deletion followed by bulk rename on \\\\NAS-01\\finance.", "escalated", "p1", "incident", "alert_engine", "Y. El Amrani", 1, "nas-backup-01", "at_risk", 45, 97, "ALR-0001"),
    ("TCK-01002", "Critical CVE-2026-31337 on production database", "Authenticated scan found unpatched OpenSSL RCE on db-primary-01.", "open", "p1", "vulnerability", "vuln-scanner", "S. Bennani", 1, "db-primary-01", "breached", 300, 93, None),
    ("TCK-01003", "VPN concentration peak — license upgrade request", "Sales team exceeds concurrent VPN seats during quarter-close.", "pending", "p3", "service_request", "portal", "N. Benali", 2, "vpn-gw-01", "paused", 1400, 81, "ALR-0012"),
    ("TCK-01004", "Repeated SSH brute-force from 45.132.87.10", "23 failed authentications in 60s against sshd on DMZ gateway.", "triage", "p2", "incident", "alert_engine", None, 1, "fw-edge-01", "on_track", 90, 88, "ALR-0002"),
    ("TCK-01005", "TLS certificate expires in 6 days (portal.damanecash.ma)", "Automated monitor detected imminent expiry on web-prod-02.", "new", "p2", "change", "monitor", None, 1, "web-prod-02", "on_track", 200, None, "ALR-0008"),
    ("TCK-01006", "Backup checksum mismatch on /vault/archive", "Nightly snapshot verification failed on nas-archive-02.", "resolved", "p4", "problem", "backup-agent", "S. Bennani", 3, "nas-archive-02", "met", 3000, None, "ALR-0005"),
    ("TCK-01007", "Privilege escalation attempt blocked on core switch", "Suricata correlated TGP-3 payload toward management VLAN.", "open", "p1", "incident", "alert_engine", "K. Chraibi", 2, "dc-core-sw-01", "at_risk", 150, 91, "ALR-0003"),
    ("TCK-01008", "Data exfiltration suspicion from FIN-WS-042", "Network DLP recorded 4.7 GB egress off-hours.", "triage", "p2", "incident", "alert_engine", "A. Fassi", 1, "FIN-WS-042", "on_track", 120, 84, "ALR-0006"),
    ("TCK-01009", "Wi-Fi coverage complaint — conference room", "Users report dead zone; ap-conf-01 offline since morning.", "open", "p3", "service_request", "portal", "N. Benali", 1, "ap-conf-01", "on_track", 35, None, "ALR-0009"),
    ("TCK-01010", "Quarantine CI artifacts (compromised npm package)", "Backdoor identified in dependency @utils/auth-helper@2.4.1.", "in_progress", "p1", "incident", "alert_engine", "K. Chraibi", 2, "DEV-SRV-007", "at_risk", 65, 90, "ALR-0010"),
    ("TCK-01011", "SD-WAN tunnel instability Tanger branch", "Repeated flap + 4.2% loss on Tanger↔Rabat tunnel.", "open", "p2", "problem", "monitor", "K. Chraibi", 2, "BRU-RT-01", "on_track", 80, None, "ALR-0011"),
    ("TCK-01012", "Duplicate: SSH brute-force (same source IP)", "Auto-detected duplicate of TCK-01004.", "closed", "p3", "incident", "alert_engine", None, 1, "fw-edge-01", "met", 3200, None, None),
]

# ---------------------------------------------------------------------------
# Canonical service catalog — legacy v1 list kept for seed_demo_tenant trials.
# The demo world itself is entitled through PACK_SERVICES above (V2 packs),
# mirroring src/data/pricingConfig.ts exactly.
# ---------------------------------------------------------------------------
ALL_SERVICES = [
    "threat-intel", "compliance", "incident-response", "analytics", "soar",
    "vuln-scanning", "patch-management", "backup-dr", "endpoint-protection",
    "email-security", "cloud-security", "network-monitoring", "dns-filtering",
    "firewall-mgmt", "vpn-gateway", "sd-wan",
]
ADVANCED_TICKETING_SERVICE = "advanced-ticketing"  # included in Pro & Enterprise plans

# Platform admin bootstrap account for the demo world (no tenant attached).
DEMO_PLATFORM_ADMIN_SPEC = {
    "email": "ops@infracentra.io",
    "name": "Ops Infracentra (Demo)",
    "role": "platform_admin",
    "password": "Admin#2026",
}



async def ensure_triage_policy(db: AsyncSession) -> None:
    """STAGE 5: seed the deterministic triage scoring policy v1 if absent.

    Idempotent, same convention as ensure_grouping_policy: policies are
    immutable once published — a weight/band change means inserting v2 and
    bumping TRIAGE_POLICY_VERSION in services/triage.py. Values MUST stay
    byte-identical to app.services.triage.DEFAULT_* (a test asserts parity).
    """
    from app.models import TriagePolicy
    from app.services.triage import (DEFAULT_WEIGHTS, DEFAULT_BANDS,
                                     DEFAULT_CONFIDENCE)
    exists = (await db.execute(
        select(TriagePolicy).where(TriagePolicy.policy_version == "v1")
    )).scalars().first()
    if exists is None:
        db.add(TriagePolicy(
            policy_version="v1",
            weights=dict(DEFAULT_WEIGHTS),
            bands=[dict(b) for b in DEFAULT_BANDS],
            confidence_weights=dict(DEFAULT_CONFIDENCE),
        ))
        await db.commit()


async def ensure_platform_admin(db: AsyncSession) -> None:
    existing = (await db.execute(
        select(User).where(User.role == "platform_admin").limit(1)
    )).scalars().first()
    if existing:
        return
    email = os.getenv("PLATFORM_ADMIN_EMAIL", "admin@infracentra.io")
    password = os.getenv("PLATFORM_ADMIN_PASSWORD", "Admin#2026")
    db.add(User(
        email=email, name="Platform Administrator", role="platform_admin",
        hashed_password=get_password_hash(password), status="active", mfa_enabled=False,
    ))
    await db.commit()


async def _grant_all_services(db: AsyncSession, org: Organization) -> int:
    """Enable every one of the 16 services + Advanced Ticketing for an org."""
    granted = 0
    for service_id in ALL_SERVICES + [ADVANCED_TICKETING_SERVICE]:
        existing = (await db.execute(
            select(Entitlement).where(
                Entitlement.org_id == org.id,
                Entitlement.service_id == service_id,
            )
        )).scalars().first()
        if existing:
            if not existing.enabled:
                existing.enabled = True
            continue
        db.add(Entitlement(
            org_id=org.id, service_id=service_id, enabled=True,
            seat_count=50, notes="Demo grant — all services + advanced ticketing",
        ))
        granted += 1
    return granted


async def _grant_services_for_pack(db: AsyncSession, org: Organization) -> int:
    """Idempotently grant the V2 pack entitlements of the org (demo world).

    starter = 5 services, pro = 12 (incl. ticketing), souverain = 17.
    Existing rows are re-enabled; missing rows are created. Never deletes.
    Returns the number of (newly) enabled entitlements.
    """
    plan = (org.plan_tier or "STARTER").lower()
    services = PACK_SERVICES.get(plan, PACK_SERVICES["starter"])
    granted = 0
    for service_id in services:
        existing = (await db.execute(
            select(Entitlement).where(
                Entitlement.org_id == org.id,
                Entitlement.service_id == service_id,
            )
        )).scalars().first()
        if existing:
            if not existing.enabled:
                existing.enabled = True
                granted += 1
            continue
        db.add(Entitlement(
            org_id=org.id, service_id=service_id, enabled=True,
            seat_count=org.seat_limit or 5,
            notes=f"Demo world mirror ({DEMO_WORLD_VERSION}) — pack {plan}",
        ))
        granted += 1
    return granted


async def _seed_demo_world(db: AsyncSession) -> None:
    """Materialise src/data/demoWorld.ts into the real DB (idempotent).

    Seeds the three Moroccan tenants with their V2 billing columns, the seven
    demo users, the 24 monitored devices (as a completed DiscoveryScan +
    DiscoveredDevice rows), the 12 alerts and the 12 tickets — same names,
    emails, counts and UIDs as Demo Mode renders client-side.
    """
    now = datetime.now(timezone.utc)

    # ---- 1) Organizations (three demo tenants, exact demoWorld fields) -----
    orgs: dict[int, Organization] = {}
    for spec in DEMO_TENANT_SPECS:
        result = await db.execute(select(Organization).where(Organization.name == spec["name"]))
        org = result.scalars().first()
        if not org:
            org = Organization(id=spec["id"], name=spec["name"], tier=spec["tier"],
                               status="active", contact_email=spec["contact_email"],
                               country=spec["country"],
                               member_count=spec["member_count"], asset_count=spec["asset_count"])
            db.add(org)
        # Always refresh the V2 billing / hierarchy columns to mirror demoWorld.
        org.plan_tier = spec["plan_tier"]
        org.billing_cycle = spec["billing_cycle"]
        org.endpoint_count = spec["endpoint_count"]
        org.seat_limit = spec["seat_limit"]
        org.siem_limit_gb = spec["siem_limit_gb"]
        org.org_type = spec["org_type"]
        org.parent_org_id = spec["parent_org_id"]
        await db.flush()
        orgs[spec["id"]] = org
        await _grant_services_for_pack(db, org)

    # ---- 2) Users (demo technicians + client admin) -------------------------
    for spec in DEMO_USER_SPECS:
        result = await db.execute(select(User).where(User.email == spec["email"]))
        user = result.scalars().first()
        if not user:
            db.add(User(
                email=spec["email"], name=spec["name"], role=spec["role"],
                org_id=orgs[spec["org_id"]].id,
                hashed_password=get_password_hash("Admin#2026"),
                status="active", mfa_enabled=False,
            ))
    # Platform admin used by the operator console (ops@infracentra.io).
    result = await db.execute(select(User).where(User.email == DEMO_PLATFORM_ADMIN_SPEC["email"]))
    if not result.scalars().first():
        db.add(User(
            email=DEMO_PLATFORM_ADMIN_SPEC["email"], name=DEMO_PLATFORM_ADMIN_SPEC["name"],
            role=DEMO_PLATFORM_ADMIN_SPEC["role"], org_id=None,
            hashed_password=get_password_hash(DEMO_PLATFORM_ADMIN_SPEC["password"]),
            status="active", mfa_enabled=False,
        ))

    # ---- 3) Devices: one completed DiscoveryScan per tenant + 24 assets ----
    for oid, org in orgs.items():
        scan = (await db.execute(select(DiscoveryScan).where(
            DiscoveryScan.org_id == oid,
            DiscoveryScan.network_cidr == f"demo-world:{DEMO_WORLD_VERSION}",
        ))).scalars().first()
        if not scan:
            scan = DiscoveryScan(
                org_id=oid, network_cidr=f"demo-world:{DEMO_WORLD_VERSION}",
                status="completed", total_hosts=len([d for d in DEMO_DEVICE_SPECS if d[6] == oid]),
                discovered=len([d for d in DEMO_DEVICE_SPECS if d[6] == oid]),
                snmp_matched=0, started_at=now - timedelta(minutes=10), finished_at=now,
                created_by="demo-world-seed",
            )
            db.add(scan)
            await db.flush()
        devs = [d for d in DEMO_DEVICE_SPECS if d[6] == oid]
        existing_hostnames = set((await db.execute(
            select(DiscoveredDevice.hostname).where(DiscoveredDevice.scan_id == scan.id)
        )).scalars().all())
        for (_devid, hostname, dtype, ip, status, location, _org, os_name,
             _last_seen, _tput, _alerts, is_probe) in devs:
            if hostname in existing_hostnames:
                continue
            db.add(DiscoveredDevice(
                scan_id=scan.id, org_id=oid, ip=ip, hostname=hostname,
                os_guess=os_name, device_type=dtype,
                open_ports=[], snmp_match=False,
                sys_desc=f"demo-world {DEMO_WORLD_VERSION} | status={status} | site={location}",
                imported=True, is_probe=is_probe,
            ))

    # ---- 4) Alerts (ALR-0001..0012) ------------------------------------------
    existing_alert_uids = set((await db.execute(select(Alert.uid))).scalars().all())
    for uid, title, severity, source, hostname, oid, correlated in DEMO_ALERT_SPECS:
        if uid in existing_alert_uids:
            continue
        db.add(Alert(
            uid=uid, org_id=oid, title=title, description="",
            severity=severity, source=source, resource=hostname,
            raw_payload={"demo_world": DEMO_WORLD_VERSION, "hostname": hostname},
            correlated_count=correlated,
            created_at=now - timedelta(minutes=_alert_minutes(uid)),
        ))

    # ---- 5) Tickets (TCK-01001..01012) ---------------------------------------
    existing_ticket_uids = set((await db.execute(select(Ticket.uid))).scalars().all())
    for (uid, title, desc, status, priority, category, source, assignee, oid,
         asset, _sla, minutes_ago, ai_conf, alert_uid) in DEMO_TICKET_SPECS:
        if uid in existing_ticket_uids:
            continue
        created = now - timedelta(minutes=minutes_ago)
        resolved = created + timedelta(minutes=max(10, minutes_ago // 2)) if status in ("resolved", "closed") else None
        db.add(Ticket(
            uid=uid, org_id=oid, title=title, description=desc,
            status=status, priority=priority, category=category, source=source,
            assignee=assignee, reporter="demo-world-seed", tags=[],
            asset=asset,
            vulnerability_ref="CVE-2026-31337" if uid == "TCK-01002" else None,
            ai_confidence=ai_conf,
            duplicate_of="TCK-01004" if uid == "TCK-01012" else None,
            resolved_at=resolved, created_at=created,
        ))
        # Back-link the originating alert (mirrors alertUid in demoWorld.ts).
        if alert_uid:
            al = (await db.execute(select(Alert).where(Alert.uid == alert_uid))).scalars().first()
            if al and not al.ticket_uid:
                al.ticket_uid = uid

    # ---- 6) Default automation rules for every demo tenant ------------------
    for oid, org in orgs.items():
        rule_name = f"{org.name}: Critical alerts → auto-ticket P1 (demo world)"
        exists = (await db.execute(select(NotificationRule).where(
            NotificationRule.org_id == oid, NotificationRule.name == rule_name
        ))).scalars().first()
        if not exists:
            db.add(NotificationRule(
                org_id=oid, name=rule_name, enabled=True,
                conditions={"severity": ["critical"]}, channels=["in_app", "email"],
                recipients=[org.contact_email], create_ticket=True,
                ticket_priority="p1", escalate_after_minutes=30,
            ))


def _alert_minutes(uid: str) -> int:
    """minutesAgo per alert from demoAlertSeeds (demoWorld.ts) — stable map."""
    return {
        "ALR-0001": 46, "ALR-0002": 91, "ALR-0003": 150, "ALR-0004": 30,
        "ALR-0005": 210, "ALR-0006": 120, "ALR-0007": 300, "ALR-0008": 200,
        "ALR-0009": 35, "ALR-0010": 65, "ALR-0011": 80, "ALR-0012": 25,
    }.get(uid, 60)


async def ensure_demo_accounts(db: AsyncSession) -> None:
    """Idempotent: provision the DEMO WORLD so real mode mirrors Demo Mode 1:1.

    Enabled by DEMO_SEED_ENABLED=true. Provisions the three Moroccan tenants
    from demoTenants (with plan_tier/endpoint_count/seat_limit/siem_limit_gb/
    billing_cycle/org_type/parent_org_id), the demoTechnicians users, the 24
    demoDevices, the 12 demoAlertSeeds and the 12 demoTicketSeeds, then grants
    pack entitlements via _grant_services_for_pack() (starter=5, pro=12+
    ticketing, souverain=17). Safe to run on every startup — existing rows
    are left untouched apart from re-enabling entitlements.
    """
    if os.getenv("DEMO_SEED_ENABLED", "").lower() not in ("1", "true", "yes"):
        return
    await _seed_demo_world(db)
    await db.commit()


async def seed_demo_tenant(db: AsyncSession, *, email: str, password: str, org_name: str,
                           service_ids: list[str] | None = None,
                           trial_days: int = 30) -> dict:
    """Create a real tenant + client admin for a *real user* evaluation.

    - service_ids: explicit list of services to grant. When omitted we fall
      back to the test-phase default (ALL 16 services + Advanced Ticketing).
    - trial_days: entitlements expire after this window (default 30-day trial);
      deactivated_at is stamped so expiry is visible in the DB and auditable.
    """
    dup = (await db.execute(select(User).where(User.email == email))).scalars().first()
    if dup:
        raise ValueError(f"User {email} already exists")
    org = Organization(name=org_name, tier="professional", status="active",
                       contact_email=email, member_count=1)
    db.add(org)
    await db.flush()

    admin = User(email=email, name=f"{org_name} Admin", role="client_admin",
                 org_id=org.id, hashed_password=get_password_hash(password),
                 status="active", mfa_enabled=False)
    db.add(admin)

    from datetime import datetime, timedelta, timezone
    expires_at = datetime.now(timezone.utc) + timedelta(days=max(1, trial_days))

    granted = 0
    wanted = service_ids if service_ids else (ALL_SERVICES + [ADVANCED_TICKETING_SERVICE])
    for sid in wanted:
        db.add(Entitlement(
            org_id=org.id, service_id=sid, enabled=True, seat_count=50,
            activated_at=datetime.now(timezone.utc),
            deactivated_at=expires_at,
            notes=f"Trial ({trial_days}d) — created by platform admin",
        ))
        granted += 1

    # Default automation: critical & high alerts notify + auto-create tickets
    db.add_all([
        NotificationRule(
            org_id=None, name="Global: Critical incidents → page SOC + auto-ticket P1",
            enabled=True, conditions={"severity": ["critical"]},
            channels=["in_app", "email"], recipients=["soc-team@infracentra.io"],
            create_ticket=True, ticket_priority="p1", escalate_after_minutes=30,
        ),
        NotificationRule(
            org_id=org.id, name=f"{org_name}: High alerts → notify + auto-ticket P2",
            enabled=True, conditions={"severity": ["high"]},
            channels=["in_app"], recipients=[email],
            create_ticket=True, ticket_priority="p2",
        ),
        NotificationRule(
            org_id=org.id, name=f"{org_name}: Discovery events → log only",
            enabled=True, conditions={"source": ["nmap", "snmp"]},
            channels=["in_app"], recipients=["noc"],
            create_ticket=False,
        ),
    ])
    await db.commit()
    await db.refresh(org)
    await db.refresh(admin)
    return {
        "organization": {"id": org.id, "name": org.name},
        "client_admin": {"id": admin.id, "email": admin.email},
        "rules_created": 3,
        "services_granted": granted,
    }
