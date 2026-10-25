import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
from app.database import init_db, AsyncSessionLocal
from app.routers import auth, organizations, users, entitlements, integrations, audit
from app.routers import tickets, notifications, discovery, threat_intel, services, projects
from app.routers import value as value_router
from app.routers import pricing
from app.routers import reports as reports_router
# Phase 4 — Tenant Manager avancé + Partner Program management
from app.routers import tenant_manager, partners_admin
from app.routers.settings import router as settings_router, router_playbooks
from app.services.channel_settings import router as channels_router
from app.services.mfa import router as mfa_router
from app.services.invitations import router as invitations_router
from app.services.seed import ensure_platform_admin, ensure_demo_accounts
from app.services.ticketing import run_escalations

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create schema, guarantee a platform admin exists, seed demo
    # tenants when DEMO_SEED_ENABLED=true (test phase), start workers
    await init_db()
    async with AsyncSessionLocal() as db:
        await ensure_platform_admin(db)
        try:
            await ensure_demo_accounts(db)
        except Exception as e:  # noqa: BLE001 — demo seeding must never block startup
            logger.warning("demo account seeding skipped: %s", e)
    task = asyncio.get_event_loop().create_task(_escalation_loop())
    yield
    # Shutdown
    task.cancel()

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
app.include_router(discovery.router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(router_playbooks, prefix="/api")
app.include_router(threat_intel.router, prefix="/api")
app.include_router(services.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(value_router.router, prefix="/api")
app.include_router(reports_router.router, prefix="/api")
app.include_router(reports_router.meta_router, prefix="/api")
app.include_router(pricing.router, prefix="/api")
app.include_router(channels_router, prefix="/api")
app.include_router(mfa_router, prefix="/api")
app.include_router(invitations_router, prefix="/api")
# Phase 4 — Tenant Manager (/api/admin/tenants/*) + Partner admin (/api/partners/*)
app.include_router(tenant_manager.router, prefix="/api")
app.include_router(partners_admin.router, prefix="/api")


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
