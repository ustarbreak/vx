"""Phase 5 (T5.x) - async job runner API over the Redis-backed JobStore (T2.4).

Additive router, mounted only when PLATFORM_CATALOG_ENABLED is true.
POST /api/platform/jobs           -> enqueue a connector action for background run
GET  /api/platform/jobs/{job_id}  -> poll job state
States: queued -> running -> succeeded | failed | unsupported | blocked (never faked).

Execution path: get_provider(service) -> provider.execute(action, params).
Native-delegating providers receive __user__/__db__ injected here using a
dedicated session (request-scoped deps are gone once the task runs).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.core.security import get_current_user
from app.models import User
from app.platform.connectors.base import get_provider
from app.platform.connectors.guardrails import check as guard_check
from app.platform.connectors.jobs import jobs
from app.platform.connectors.models import JobState

logger = logging.getLogger("platform.jobs.api")

router = APIRouter(prefix="/platform", tags=["Platform Jobs"])


class JobIn(BaseModel):
    service: str
    action: str
    params: Dict[str, Any] = {}
    idempotency_key: str | None = None
    dry_run: bool = True
    confirmer_id: int | None = None


async def _run(job_id: str, service: str, action: str, params: Dict[str, Any],
               user_dict: Dict[str, Any]) -> None:
    await jobs.update(job_id, JobState.running)
    if params.get("dry_run", True):
        await jobs.update(job_id, JobState.dry_run,
                          message="Dry-run completed; provider execution was not invoked.",
                          data={"dry_run": True})
        return
    try:
        provider = get_provider(service, {})
        if provider is None:
            await jobs.update(job_id, JobState.unsupported,
                              message=f"no deployed provider registered for {service!r}")
            return
        run_params = dict(params)
        from app.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            user = await db.get(User, user_dict["id"]) if user_dict.get("id") else None
            if user is None:
                await jobs.update(job_id, JobState.failed, message="job user vanished")
                return
            run_params["__user__"] = user
            run_params["__db__"] = db
            result = await provider.execute(action, run_params)
            await jobs.update(job_id, result.state,
                              message=result.message, data=result.data)
    except Exception as exc:  # noqa: BLE001 - report honestly, never fake success
        logger.warning("job %s failed: %s", job_id, exc)
        await jobs.update(job_id, JobState.failed, message=str(exc)[:500])


@router.post("/jobs", status_code=202)
async def create_job(body: JobIn, request: Request,
                     user: User = Depends(get_current_user)):
    from app.platform.catalog.schema import load_catalog
    spec = load_catalog().get(body.service)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"unknown service {body.service!r}")
    act = next((a for a in spec.actions if a.name == body.action), None)
    if act is None or act.status in ("roadmap", "unsupported"):
        return {"status": "unsupported", "service": body.service, "action": body.action,
                "reason": "action not ga/beta in catalog"}
    confirmer = None
    if body.confirmer_id is not None:
        from app.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            confirmer = await db.get(User, body.confirmer_id)
    decision = guard_check(user, getattr(act, "dangerous", False),
                           body.dry_run, body.params, confirmer=confirmer)
    if not decision.allowed:
        raise HTTPException(status_code=403, detail=decision.reason)
    job_params = dict(body.params)
    job_params["dry_run"] = body.dry_run
    job = await jobs.create(f"{body.service}.{body.action}",
                            getattr(user, "org_id", 0) or 0,
                            job_params, idempotency_key=body.idempotency_key)
    # Idempotent replays return the original job without scheduling it twice.
    if job.get("_created", True):
        task = asyncio.create_task(
            _run(job["id"], body.service, body.action, job_params,
                 {"id": getattr(user, "id", None)}))
        _BG_TASKS.add(task)
        task.add_done_callback(_BG_TASKS.discard)
    return {"job_id": job["id"], "state": job["state"]}


_BG_TASKS: set = set()


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, user: User = Depends(get_current_user)):
    job = await jobs.get(job_id)
    if not job or (user.role != "platform_admin" and job.get("org_id") != user.org_id):
        # Conceal cross-tenant job existence.
        raise HTTPException(status_code=404, detail="job not found")
    return job
