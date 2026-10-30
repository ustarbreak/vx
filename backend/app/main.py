import asyncio
import logging

from pathlib import Path as FsPath

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from app.core.config import settings
from app.database import init_db, AsyncSessionLocal
from app.routers import auth, organizations, users, entitlements, integrations, audit
from app.routers import tickets, notifications, discovery, threat_intel, services, projects
from app.routers import security_map, org_topology
from app.routers import incidents as incidents_router
from app.routers import soar as soar_router
from app.routers import value as value_router
from app.routers import pricing_v2
from app.routers import reports as reports_router
from app.routers import analytics as analytics_router
# Phase 4 — Tenant Manager avancé + Partner Program management
from app.routers import tenant_manager, partners_admin
from app.routers import agent as agent_router
from app.routers import dashboard_layout
from app.routers.settings import router as settings_router, router_playbooks
from app.services.channel_settings import router as channels_router
from app.services.mfa import router as mfa_router
from app.services.invitations import router as invitations_router
from app.services.seed import ensure_platform_admin, ensure_demo_accounts
from app.services.ticketing import run_escalations
from app.services.evidence import run_retention_expiry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("infracentra")


async def _escalation_loop():
    """Background worker: every 60s escalate tickets that breached response SLA."""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                done = await run_escalations(db)
                if done:
                    logger.info("SLA escalations: %s", ", ".join(done))
        except Exception as e:  # noqa: BLE001
            logger.warning("escalation pass failed: %s", e)
        await asyncio.sleep(60)


async def _evidence_retention_loop():
    """Stage 1 (event evidence): hourly retention pass. Nulls expired payloads
    per settings.EVIDENCE_RETENTION_DAYS; rows survive as intelligible stubs.
    Never deletes rows and never touches alert/incident data."""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                n = await run_retention_expiry(db)
                if n:
                    logger.info("evidence retention pass: %s payload(s) expired", n)
        except Exception as e:  # noqa: BLE001
            logger.warning("evidence retention pass failed: %s", e)
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create schema, guarantee a platform admin exists, seed demo
    # tenants when DEMO_SEED_ENABLED=true (test phase), start workers
    await init_db()
    async with AsyncSessionLocal() as db:
        await ensure_platform_admin(db)
        # STAGE 3: grouping policy v1 row + atomic UID counter bootstrap.
        # Must run before any ingestion so correlate() reads the documented
        # policy and allocate_uid() never collides with legacy COUNT+1 uids.
        from app.services.seed import (ensure_grouping_policy, ensure_uid_counters,
                                       ensure_triage_policy)
        await ensure_grouping_policy(db)
        await ensure_uid_counters(db)
        # STAGE 5: deterministic triage policy v1 seed (idempotent).
        await ensure_triage_policy(db)
        try:
            await ensure_demo_accounts(db)
        except Exception as e:  # noqa: BLE001 — demo seeding must never block startup
            logger.warning("demo account seeding skipped: %s", e)
    task = asyncio.get_event_loop().create_task(_escalation_loop())
    ev_task = asyncio.get_event_loop().create_task(_evidence_retention_loop())
    yield
    # Shutdown
    task.cancel()
    ev_task.cancel()

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api")
app.include_router(organizations.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(entitlements.router, prefix="/api")
app.include_router(integrations.router, prefix="/api")
app.include_router(audit.router, prefix="/api")
app.include_router(tickets.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(security_map.router, prefix="/api")
app.include_router(org_topology.router, prefix="/api")
app.include_router(discovery.router, prefix="/api")
from app.routers import discovery_extra  # credential PATCH/test, infra graph, device hub & actions
app.include_router(discovery_extra.router, prefix="/api")
app.include_router(settings_router, prefix="/api")
# Per-user customizable dashboard widget layouts (Overview & Live Proof, network…)
app.include_router(dashboard_layout.router, prefix="/api")
# Legacy in-memory playbooks router is superseded by the SOAR v2 API below.
# It stays mounted (same URL shape) only for backward compatibility and now
# requires authentication — see app/routers/settings.py.
app.include_router(router_playbooks, prefix="/api")
# Incident Response + SOAR Workflows (real backend for those two pages)
app.include_router(incidents_router.router, prefix="/api")
app.include_router(soar_router.router, prefix="/api")
from app.routers import triage as triage_router  # STAGE 5
app.include_router(triage_router.router, prefix="/api")
app.include_router(threat_intel.router, prefix="/api")
app.include_router(analytics_router.router, prefix="/api")
app.include_router(services.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(value_router.router, prefix="/api")
app.include_router(reports_router.router, prefix="/api")
app.include_router(reports_router.meta_router, prefix="/api")
# Pricing v1 (Bundle All-in-One) DELETED — the single engine is pricing_v2 (§3 of the brief).
# Pricing v2 — public config/leads/health-checks + sales calculator + partner + upsell
app.include_router(pricing_v2.v1_router, prefix="/api")
app.include_router(pricing_v2.router, prefix="/api")
app.include_router(channels_router, prefix="/api")
app.include_router(mfa_router, prefix="/api")
app.include_router(invitations_router, prefix="/api")
# Phase 4 — Tenant Manager (/api/admin/tenants/*) + Partner admin (/api/partners/*)
app.include_router(tenant_manager.router, prefix="/api")
app.include_router(partners_admin.router, prefix="/api")
# goinfra collection agent: /api/agent/* (probe API) + /api/agent-tokens/* (UI)
# + /api/agents/* (JWT-authenticated fleet reads for the Agents page)
app.include_router(agent_router.router, prefix="/api")
app.include_router(agent_router.tok_router, prefix="/api")
app.include_router(agent_router.web_router, prefix="/api")


# ---------------------------------------------------------------------------
# Agent binary distribution — clients download goinfra + install scripts from
# the same domain as the app (no separate file server needed).
# Populated by scripts/release.sh -> backend/static/downloads/goinfra/...
# ---------------------------------------------------------------------------
_STATIC_DIR = FsPath(__file__).resolve().parent.parent / "static"
_DOWNLOADS = _STATIC_DIR / "downloads" / "goinfra"
_DOWNLOADS.mkdir(parents=True, exist_ok=True)
# Ship the installers next to the binaries automatically: they live in the repo
# at scripts/downloads/ (source of truth); release.sh also copies them, this is
# just a safety net so a fresh clone serves them without running release.sh.
for _src_dir in (FsPath(__file__).resolve().parents[2] / "scripts" / "downloads",):
    if _src_dir.is_dir():
        for _f in _src_dir.glob("install.*"):
            _dst = _DOWNLOADS / _f.name
            if not _dst.exists() or _dst.stat().st_size != _f.stat().st_size:
                _dst.write_bytes(_f.read_bytes())
app.mount("/downloads", StaticFiles(directory=str(_STATIC_DIR / "downloads")), name="downloads")


@app.get("/")
async def root():
    return {
        "message": "Infracentra API",
        "version": settings.APP_VERSION,
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
