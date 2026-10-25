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
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.security import get_password_hash
from app.models import User, Organization, NotificationRule, Entitlement

# ---------------------------------------------------------------------------
# Canonical service catalog — must stay in sync with src/data/mockData.ts
# (16 services). Advanced Ticketing is bundled into Pro/Enterprise plans.
# ---------------------------------------------------------------------------
ALL_SERVICES = [
    "threat-intel", "compliance", "incident-response", "analytics", "soar",
    "vuln-scanning", "patch-management", "backup-dr", "endpoint-protection",
    "email-security", "cloud-security", "network-monitoring", "dns-filtering",
    "firewall-mgmt", "vpn-gateway", "sd-wan",
]
ADVANCED_TICKETING_SERVICE = "advanced-ticketing"  # included in Pro & Enterprise plans

# Demo accounts provisioned when DEMO_SEED_ENABLED=true (test phase only).
DEMO_ACCOUNT_SPECS = [
    {
        "email": "ops@infracentra.io",
        "name": "Nadia Okafor (Demo)",
        "role": "platform_admin",
        "password": "Admin#2026",
        "org_name": None,
        "tier": None,
    },
    {
        "email": "sarah.chen@infracentracorp.io",
        "name": "Sarah Chen (Demo)",
        "role": "client_admin",
        "password": "Admin#2026",
        "org_name": "Infracentra Corp (Demo)",
        "tier": "enterprise",
    },
    {
        "email": "nina@novaprotect.io",
        "name": "Nina Alvarez (Demo)",
        "role": "client_admin",
        "password": "Admin#2026",
        "org_name": "NovaProtect (Demo)",
        "tier": "professional",
    },
    {
        "email": "marcus.j@infracentracorp.io",
        "name": "Marcus Johnson (Demo)",
        "role": "client_user",
        "password": "Admin#2026",
        "org_name": "Infracentra Corp (Demo)",
        "tier": "enterprise",
    },
]


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


async def ensure_demo_accounts(db: AsyncSession) -> None:
    """Idempotent: provision demo tenants/users + full entitlements.

    Enabled by DEMO_SEED_ENABLED=true (set in docker-compose for the test
    phase). Safe to run on every startup — existing rows are left untouched
    apart from re-enabling entitlements.
    """
    if os.getenv("DEMO_SEED_ENABLED", "").lower() not in ("1", "true", "yes"):
        return

    org_cache: dict[str, Organization] = {}
    for spec in DEMO_ACCOUNT_SPECS:
        # 1) Org (demo tenants are clearly labelled "(Demo)")
        org = None
        if spec["org_name"]:
            if spec["org_name"] not in org_cache:
                result = await db.execute(
                    select(Organization).where(Organization.name == spec["org_name"])
                )
                org = result.scalars().first()
                if not org:
                    org = Organization(
                        name=spec["org_name"], tier=spec["tier"], status="active",
                        contact_email=spec["email"], member_count=5, asset_count=50,
                    )
                    db.add(org)
                    await db.flush()
                    await _grant_all_services(db, org)
                org_cache[spec["org_name"]] = org
            org = org_cache[spec["org_name"]]

        # 2) User
        result = await db.execute(select(User).where(User.email == spec["email"]))
        user = result.scalars().first()
        if not user:
            db.add(User(
                email=spec["email"], name=spec["name"], role=spec["role"],
                org_id=org.id if org else None,
                hashed_password=get_password_hash(spec["password"]),
                status="active", mfa_enabled=False,
            ))

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
