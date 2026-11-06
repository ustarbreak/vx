import asyncio
import logging

from pathlib import Path as FsPath

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from app.core.config import settings
from app.database import init_db, AsyncSessionLocal, engine
from sqlalchemy import text as sql_text
from fastapi.responses import JSONResponse
from app.routers import auth, organizations, users, entitlements, integrations, audit
from app.routers import platform_access as platform_access_router
from app.routers import tickets, notifications, discovery, threat_intel, services, projects
from app.routers import security_map, org_topology
from app.routers import incidents as incidents_router
from app.routers import soar as soar_router
from app.routers import value as value_router
from app.routers import pricing_v2
from app.routers import reports as reports_router
from app.routers import analytics as analytics_router
# Phase 4 — Tenant Manager avancé + Partner Program management
from app.routers import tenant_manager, partners_admin, partners, partners_ops, partners_commercial, partners_service, partners_team, partners_keys, partners_connectors
from app.routers import agent as agent_router
from app.routers import dashboard_layout
from app.routers.settings import router as settings_router, router_playbooks
from app.services.channel_settings import router as channels_router
from app.services.mfa import router as mfa_router
from app.services.invitations import router as invitations_router
from app.services.seed import ensure_platform_admin, ensure_demo_accounts
from app.services.ticketing import run_escalations
from app.services.evidence import run_retention_expiry
from app.services.soar import recover_stale_runs

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





async def _soar_recovery_loop():
    """Mark crashed SOAR executions failed after a bounded stale threshold."""
    while True:
        try:
            async with AsyncSessionLocal() as db:
                count = await recover_stale_runs(db, stale_after_minutes=30)
                if count:
                    logger.warning("SOAR recovery: marked %s stale run(s) failed for operator review", count)
        except Exception as e:  # noqa: BLE001
            logger.warning("SOAR recovery pass failed: %s", e)
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
    soar_task = asyncio.get_event_loop().create_task(_soar_recovery_loop())
    yield
    # Shutdown
    task.cancel()
    ev_task.cancel()
    soar_task.cancel()

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
app.include_router(platform_access_router.router, prefix="/api")
# Phase 4 — Tenant Manager (/api/admin/tenants/*) + Partner admin (/api/partners/*)
app.include_router(tenant_manager.router, prefix="/api")
app.include_router(partners.router, prefix="/api")   # Partner Portal (Phase 1) — declared first: owns GET/PUT/POST-verify/clients CRUD
app.include_router(partners_ops.router, prefix="/api")  # Partner Portal (Phase 2): queue / health / impersonations / templates
app.include_router(partners_commercial.router, prefix="/api")  # Partner Portal (Phase 3): onboarding / deals / quotes / billing
app.include_router(partners_service.router, prefix="/api")  # Partner Portal (Phase 4): reports/PDF / white-label extras / SLA+escalation+roster+runbooks
app.include_router(partners_team.router, prefix="/api")  # Phase 5.1/5.4: team users + partner audit + sales-kit/support escalation
app.include_router(partners_keys.router, prefix="/api")  # Phase 5.2: scoped API keys (hashed) + outgoing webhooks (HMAC)
app.include_router(partners_connectors.router, prefix="/api")  # Phase 5.3: PSA/RMM + Microsoft 365 connectors
app.include_router(partners_admin.router, prefix="/api")  # platform-admin PATCH/suspend/migrate(force tier)/DELETE
# goinfra collection agent: /api/agent/* (probe API) + /api/agent-tokens/* (UI)
# + /api/agents/* (JWT-authenticated fleet reads for the Agents page)
app.include_router(agent_router.router, prefix="/api")
app.include_router(agent_router.tok_router, prefix="/api")
app.include_router(agent_router.web_router, prefix="/api")
# Security Services & Protection consoles: operator action dispatch + history
from app.routers import security_ops  # noqa: E402
app.include_router(security_ops.router, prefix="/api")

# Platform catalog (docs/audit/ADAPTED-PLAN.md T1.3) — additive tree, mounted
# ONLY when PLATFORM_CATALOG_ENABLED=true (default false => zero behavior change).
if settings.PLATFORM_CATALOG_ENABLED:
    from app.platform.router import router as platform_router  # noqa: E402
    from app.platform.jobs_api import router as platform_jobs_router  # noqa: E402
    from app.platform.ueba_api import router as platform_ueba_router  # noqa: E402
    app.include_router(platform_router, prefix="/api")
    app.include_router(platform_jobs_router, prefix="/api")
    app.include_router(platform_ueba_router, prefix="/api")


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
    """Liveness probe: process is serving requests; no dependency claims."""
    return {"status": "alive"}


@app.get("/health/ready")
async def readiness_check():
    """Readiness probe: verify PostgreSQL and Redis before receiving traffic."""
    checks = {"database": "ok", "redis": "ok"}
    try:
        async with engine.connect() as connection:
            await connection.execute(sql_text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 - never expose dependency details
        logger.warning("readiness database check failed: %s", type(exc).__name__)
        checks["database"] = "unavailable"
    redis_client = None
    try:
        import redis.asyncio as aioredis
        redis_client = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
        await redis_client.ping()
    except Exception as exc:  # noqa: BLE001 - never expose dependency details
        logger.warning("readiness redis check failed: %s", type(exc).__name__)
        checks["redis"] = "unavailable"
    finally:
        if redis_client is not None:
            await redis_client.aclose()
    ready = all(value == "ok" for value in checks.values())
    payload = {"status": "ready" if ready else "not_ready", "checks": checks}
    return payload if ready else JSONResponse(status_code=503, content=payload)
