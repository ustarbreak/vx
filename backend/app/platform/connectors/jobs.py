"""Async job store on Redis (T2.4). States: queued→running→succeeded|failed|unsupported.

Falls back to an in-process dict when Redis is unavailable so dev/test runs
never require infrastructure. Idempotency keys prevent double-execution of
dangerous actions within TTL.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Dict, Optional

from app.core.config import settings

from .models import JobState

logger = logging.getLogger("platform.jobs")

_TTL = 24 * 3600  # job retention
_PREFIX = "ic:job:"


def _redis():
    try:
        import redis.asyncio as aioredis
        url = getattr(settings, "REDIS_URL", None) or "redis://localhost:6379/0"
        return aioredis.from_url(url, decode_responses=True, socket_connect_timeout=1)
    except Exception:
        return None


class JobStore:
    def __init__(self):
        self._mem: Dict[str, Dict[str, Any]] = {}  # fallback + tests

    async def create(self, action: str, org_id: int, params: Dict[str, Any],
                     idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        if idempotency_key:
            existing = await self._get_by_key(idempotency_key)
            if existing:
                return existing
        job = {
            "id": uuid.uuid4().hex,
            "action": action,
            "org_id": org_id,
            "params": params,
            "state": JobState.queued.value,
            "created_at": time.time(),
            "idempotency_key": idempotency_key,
        }
        await self._save(job)
        if idempotency_key:
            r = _redis()
            if r:
                try:
                    await r.setex(f"{_PREFIX}key:{idempotency_key}", _TTL, job["id"])
                except Exception as e:
                    logger.warning("redis setex failed: %s", e)
                finally:
                    await r.aclose()
            else:
                self._mem[f"key:{idempotency_key}"] = job["id"]
        return job

    async def update(self, job_id: str, state: JobState, message: str = "",
                     data: Optional[Dict[str, Any]] = None):
        job = await self.get(job_id)
        if not job:
            return
        job.update({"state": state.value, "message": message,
                    "data": data, "updated_at": time.time()})
        await self._save(job)

    async def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        r = _redis()
        if r:
            try:
                raw = await r.get(f"{_PREFIX}{job_id}")
                if raw:
                    return json.loads(raw)
            except Exception as e:
                logger.warning("redis get failed: %s", e)
            finally:
                await r.aclose()
        return self._mem.get(job_id)

    async def _get_by_key(self, key: str) -> Optional[Dict[str, Any]]:
        r = _redis()
        if r:
            try:
                jid = await r.get(f"{_PREFIX}key:{key}")
                if jid:
                    return await self.get(jid)
            except Exception as e:
                logger.warning("redis lookup failed: %s", e)
            finally:
                await r.aclose()
        jid = self._mem.get(f"key:{key}")
        return self._mem.get(jid) if jid else None

    async def _save(self, job: Dict[str, Any]):
        self._mem[job["id"]] = job
        r = _redis()
        if r:
            try:
                await r.setex(f"{_PREFIX}{job['id']}", _TTL, json.dumps(job, default=str))
            except Exception as e:
                logger.warning("redis save failed (in-memory only): %s", e)
            finally:
                await r.aclose()


jobs = JobStore()
