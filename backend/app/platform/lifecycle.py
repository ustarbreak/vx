"""T4.2 — service onboarding lifecycle helpers (additive, flag-gated).

State machine: not_installed -> installed -> connected -> first_success.
Advanced automatically from probe results in routers/services.py when
settings.SERVICE_LIFECYCLE_ENABLED is true; admins can also record a
first_success explicitly via POST /api/platform/services/{id}/first-success.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

ORDER = ["not_installed", "installed", "connected", "first_success"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def get_state(db: AsyncSession, org_id: int, service_id: str):
    from app.models import ServiceLifecycleState
    row = (await db.execute(
        select(ServiceLifecycleState)
        .where(ServiceLifecycleState.org_id == org_id,
               ServiceLifecycleState.service_id == service_id)
    )).scalar_one_or_none()
    if row is None:
        row = ServiceLifecycleState(org_id=org_id, service_id=service_id,
                                    state="not_installed")
        db.add(row)
    return row


async def advance(db: AsyncSession, org_id: int, service_id: str, target: str):
    """Move a service to `target` only forward along ORDER; returns the row."""
    from app.models import ServiceLifecycleState
    row = await get_state(db, org_id, service_id)
    cur, tgt = ORDER.index(row.state), ORDER.index(target)
    if tgt > cur:
        ts = _now()
        for state in ORDER[cur + 1: tgt + 1]:
            col = {"installed": "installed_at", "connected": "connected_at",
                   "first_success": "first_success_at"}.get(state)
            if col and getattr(row, col) is None:
                setattr(row, col, ts)
        row.state = target
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


def as_dict(row) -> dict:
    return {
        "service_id": row.service_id,
        "state": row.state,
        "installed_at": row.installed_at,
        "connected_at": row.connected_at,
        "first_success_at": row.first_success_at,
    }
