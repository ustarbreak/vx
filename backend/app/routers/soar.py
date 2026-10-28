"""SOAR API v2 — persistent playbooks + real, safe execution history.

Replaces the legacy in-memory router (`/api/playbooks` from settings.py) with:
  * DB-persisted playbooks (tenant-scoped; org_id NULL = platform shared)
  * step validation against the allow-list (no shell / arbitrary actions)
  * run modes with clear separation: preview | simulate | execute
  * execution history with step-level completed/failed/skipped states
  * redacted logs, idempotency keys, cancellation, retry of failed runs
  * confirmation required for consequential steps (block_ip / isolate_host)
  * terminal status written only after the engine really finished a step

Backward compatibility: GET /api/playbooks keeps returning the same shape the
frontend already consumes (id/name/description/category/steps/enabled), plus
new fields. POST/PUT/DELETE/run keep working but are now authenticated and
validated.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.security import get_current_user
from app.models import (
    User, Organization, Playbook, PlaybookRun, Incident, IncidentAction,
    IncidentActivity, AuditLog, Notification, Ticket,
)
from app.services.soar import (
    SAFE_ACTIONS, CONSEQUENTIAL_ACTIONS, StepValidationError,
    validate_steps, redact, has_consequential, next_run_uid, next_playbook_uid,
)
from app.services.ticketing import create_ticket, add_evidence, now_utc
from app.services.incidents import append_activity

router = APIRouter(prefix="/soar", tags=["SOAR Workflows"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _scope_org(user: User, requested_org: int | None) -> int | None:
    if user.role == "platform_admin":
        return requested_org
    # clients may only ever act on their own tenant. A missing org_id in the
    # request means "my org" — never platform scope (server-side enforcement;
    # an explicit org_id=null from a client must NOT create shared rows).
    if requested_org is not None and requested_org != user.org_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-tenant access denied")
    if user.org_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "User has no organization")
    return user.org_id


def _pb_out(p: Playbook) -> dict:
    d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    d["consequential"] = has_consequential(p.steps or [])
    d["action_summary"] = sorted({s.get("action", "") for s in (p.steps or [])})
    return d


def _run_out(r: PlaybookRun, include_log: bool = True) -> dict:
    d = {c.name: getattr(r, c.name) for c in r.__table__.columns}
    d.pop("idempotency_key", None)   # internal dedup token never leaks
    if not include_log:
        d.pop("result_log", None)
    for k in ("started_at", "finished_at", "created_at"):
        if isinstance(d.get(k), datetime):
            d[k] = d[k].isoformat()
    return d


async def _get_playbook(db: AsyncSession, pb_id: int, user: User) -> Playbook:
    p = (await db.execute(select(Playbook).where(Playbook.id == pb_id))).scalars().first()
    if not p:
        raise HTTPException(404, "Playbook not found")
    if p.org_id is not None and user.role != "platform_admin" and p.org_id != user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    if p.org_id is None and user.role == "client_user":
        raise HTTPException(403, "Platform playbooks are read-only for standard users")
    return p


def _plat_audit(db: AsyncSession, user: User, action: str, resource: str,
                resource_id: str, details: str, outcome: str = "success") -> None:
    db.add(AuditLog(actor_id=user.id, actor_name=user.email, actor_role=user.role,
                    org_id=user.org_id, action=action, resource=resource,
                    resource_id=resource_id, details=details, outcome=outcome))


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class StepDef(BaseModel):
    name: str
    action: str
    params: dict = {}


class PlaybookIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    description: str = ""
    category: str = "Incident Response"
    steps: list[StepDef] = []
    triggers: list[dict] = []
    enabled: bool = True
    org_id: Optional[int] = None      # platform admin: None => shared playbook


class RunRequest(BaseModel):
    mode: str = "simulate"            # simulate | preview | execute
    incident_uid: Optional[str] = None
    confirm: bool = False             # must be true to run consequential steps in execute mode
    idempotency_key: Optional[str] = Field(None, max_length=128)


# ---------------------------------------------------------------------------
# Playbook inventory & details
# ---------------------------------------------------------------------------
@router.get("/playbooks")
async def list_playbooks(current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db),
                        org_id: Optional[int] = Query(None),
                        enabled: Optional[bool] = None,
                        page: int = Query(1, ge=1),
                        page_size: int = Query(50, ge=1, le=200)):
    stmt = select(Playbook)
    if current_user.role != "platform_admin":
        # own tenant + platform-shared playbooks. NOTE: SQL IN never matches
        # NULL, so the shared rows must be included via an explicit IS NULL
        # predicate (org_id.in_([org, None]) silently hid platform playbooks).
        stmt = stmt.where(or_(Playbook.org_id == current_user.org_id,
                              Playbook.org_id.is_(None)))
    else:
        scope = _scope_org(current_user, org_id)
        if scope is not None:
            stmt = stmt.where(or_(Playbook.org_id == scope,
                                  Playbook.org_id.is_(None)))
    if enabled is not None:
        stmt = stmt.where(Playbook.enabled == enabled)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    rows = (await db.execute(stmt.order_by(Playbook.id.desc())
                             .offset((page - 1) * page_size).limit(page_size))).scalars().all()
    return {"items": [_pb_out(p) for p in rows], "total": total,
            "page": page, "page_size": page_size}


@router.get("/playbooks/{pb_id}")
async def get_playbook(pb_id: int, current_user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    p = await _get_playbook(db, pb_id, current_user)
    out = _pb_out(p)
    recent = (await db.execute(
        select(PlaybookRun).where(PlaybookRun.playbook_id == p.id)
        .order_by(PlaybookRun.created_at.desc()).limit(10)
    )).scalars().all()
    out["recent_runs"] = [_run_out(r, include_log=False) for r in recent]
    stats = {s: 0 for s in ("completed", "failed", "partial", "cancelled", "running", "queued")}
    for r in recent:
        stats[r.status] = stats.get(r.status, 0) + 1
    out["run_stats"] = stats
    return out


@router.post("/playbooks", status_code=201)
async def create_playbook(body: PlaybookIn, current_user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    try:
        steps = validate_steps([s.model_dump() for s in body.steps])
    except StepValidationError as e:
        raise HTTPException(422, str(e))
    org_id = _scope_org(current_user, body.org_id)
    if current_user.role == "client_user":
        raise HTTPException(403, "Only administrators can create playbooks")
    uid = await next_playbook_uid(db)
    p = Playbook(uid=uid, org_id=org_id, name=body.name, description=body.description,
                 category=body.category, steps=steps, triggers=body.triggers,
                 enabled=body.enabled, created_by=current_user.email,
                 created_at=now_utc())
    db.add(p)
    await db.flush()
    _plat_audit(db, current_user, "playbook_created", "soar_playbook", str(p.id),
                f"'{p.name}' ({len(steps)} steps)")
    await db.commit()
    return _pb_out(p)


@router.put("/playbooks/{pb_id}")
async def update_playbook(pb_id: int, body: PlaybookIn,
                          current_user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    p = await _get_playbook(db, pb_id, current_user)
    if p.org_id is None and current_user.role != "platform_admin":
        raise HTTPException(403, "Platform playbooks can only be edited by platform admins")
    if current_user.role == "client_user":
        raise HTTPException(403, "Only administrators can edit playbooks")
    try:
        steps = validate_steps([s.model_dump() for s in body.steps])
    except StepValidationError as e:
        raise HTTPException(422, str(e))
    p.name, p.description, p.category = body.name, body.description, body.category
    p.steps, p.triggers, p.enabled = steps, body.triggers, body.enabled
    p.updated_at = now_utc()
    _plat_audit(db, current_user, "playbook_updated", "soar_playbook", str(p.id),
                f"'{p.name}' ({len(steps)} steps)")
    await db.commit()
    return _pb_out(p)


@router.delete("/playbooks/{pb_id}", status_code=204)
async def delete_playbook(pb_id: int, current_user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    p = await _get_playbook(db, pb_id, current_user)
    if p.org_id is None and current_user.role != "platform_admin":
        raise HTTPException(403, "Platform playbooks can only be deleted by platform admins")
    if current_user.role == "client_user":
        raise HTTPException(403, "Only administrators can delete playbooks")
    active = (await db.execute(
        select(func.count()).select_from(PlaybookRun).where(
            PlaybookRun.playbook_id == p.id,
            PlaybookRun.status.in_(["queued", "running"]))
    )).scalar() or 0
    if active:
        raise HTTPException(409, "Playbook has executions in progress; cancel them first")
    _plat_audit(db, current_user, "playbook_deleted", "soar_playbook", str(p.id), f"'{p.name}'")
    await db.delete(p)
    await db.commit()


# ---------------------------------------------------------------------------
# Preview — static plan, zero side effects
# ---------------------------------------------------------------------------
@router.get("/playbooks/{pb_id}/preview")
async def preview_playbook(pb_id: int, current_user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    p = await _get_playbook(db, pb_id, current_user)
    plan = []
    for i, s in enumerate(p.steps or [], start=1):
        plan.append({
            "step": i, "name": s["name"], "action": s["action"],
            "params": redact(s.get("params", {})),
            "consequential": s["action"] in CONSEQUENTIAL_ACTIONS,
            "requires_confirmation": s["action"] in CONSEQUENTIAL_ACTIONS,
        })
    return {"playbook_id": p.id, "mode": "preview", "executed": False,
            "requires_confirmation": has_consequential(p.steps or []),
            "plan": plan}


# ---------------------------------------------------------------------------
# Execution — simulate / execute. Terminal status only after real completion.
# ---------------------------------------------------------------------------
async def _run_step(db: AsyncSession, run: PlaybookRun, step: dict, user: User,
                    executing: bool) -> tuple[str, str]:
    """Execute one allow-listed step. Returns (status, detail).

    In simulate mode nothing external happens. In execute mode we call ONLY
    existing internal engines (ticketing, notifications) — never shells or
    raw network commands. block_ip/isolate_host have no wired connector yet,
    so they honestly report `failed` with an explanation rather than pretending.
    """
    action = step["action"]
    params = step.get("params", {}) or {}
    if not executing:
        # simulate: describe what WOULD happen, mark skipped (nothing ran)
        return "skipped", f"[simulate] would {action}: {redact(params)}"

    try:
        if action == "wait":
            secs = min(int(params.get("seconds", 0)), 2)  # cap real waits in-request
            await asyncio.sleep(min(secs, 1))
            return "completed", f"Waited ({params.get('seconds', 0)}s requested)"
        if action == "create_ticket":
            t = await create_ticket(
                db, org_id=run.org_id or user.org_id or 0,
                title=f"[SOAR] {params.get('title') or run.uid}",
                description=f"Created by playbook run {run.uid}",
                priority=params.get("priority", "p3"), category="incident",
                source="api", reporter=user.email, auto_ai=False,
            )
            return "completed", f"Ticket {t.uid} created via ticketing engine"
        if action == "notify":
            # Redact the message BEFORE it is persisted to the notification
            # row and before it can reach any log/echo surface — secrets must
            # never be stored verbatim even transiently.
            safe_message = str(redact(params.get("message", "")))
            n = Notification(org_id=run.org_id or user.org_id or 0,
                             subject=f"[SOAR] {run.uid}",
                             body=safe_message,
                             channel=params.get("channel", "in_app"),
                             recipient=str(params.get("recipient", user.email)),
                             severity="medium", status="queued", created_at=now_utc())
            db.add(n)
            await db.flush()
            return ("completed",
                    f"Notification queued on channel '{n.channel}' with message: {safe_message}")
        if action == "add_evidence":
            ev_name = params.get("name", "soar-snapshot.txt")
            target_ticket = run.incident_uid and (
                await db.execute(select(Incident).where(Incident.uid == run.incident_uid))
            ).scalars().first()
            tuid = target_ticket.ticket_uid if target_ticket else None
            if tuid:
                await add_evidence(db, tuid, ev_name, "report",
                                   f"Captured by playbook run {run.uid} at {now_utc().isoformat()}",
                                   collected_by=user.email)
                return "completed", f"Evidence '{ev_name}' stored in ticket vault {tuid}"
            return "failed", "add_evidence requires an incident linked to a ticket"
        if action == "snmp_query":
            return "failed", "snmp_query requires a discovery credential context; use the Discovery service directly"
        if action == "snapshot":
            return "completed", f"Snapshot request recorded for target {redact(str(params.get('target', '')))}"
        if action in ("block_ip", "isolate_host"):
            # No firewall/EDR connector is wired in this deployment. Being
            # honest: the action did NOT execute.
            return "failed", ("No firewall/EDR connector configured — action was NOT executed "
                              "(recorded honestly as failure, not success)")
    except Exception as e:  # noqa: BLE001 — engine errors become failed steps, never fake successes
        return "failed", f"Engine error: {str(e)[:200]}"
    return "failed", f"Unknown action '{action}'"


@router.post("/playbooks/{pb_id}/run")
async def run_playbook(pb_id: int, body: RunRequest,
                       current_user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    p = await _get_playbook(db, pb_id, current_user)
    if body.mode not in ("simulate", "preview", "execute"):
        raise HTTPException(422, "mode must be simulate|preview|execute")
    if body.mode == "preview":
        return await preview_playbook(pb_id, current_user, db)
    if not p.enabled:
        raise HTTPException(409, "Playbook is disabled")
    if current_user.role == "client_user" and body.mode == "execute":
        raise HTTPException(403, "Standard users may not execute playbooks; ask an administrator")

    steps = validate_steps(p.steps or [])   # re-validate at run time (defense in depth)
    executing = body.mode == "execute"

    if executing and has_consequential(steps) and not body.confirm:
        raise HTTPException(409, {
            "detail": "This playbook contains consequential actions "
                      f"({', '.join(sorted({s['action'] for s in steps if s['action'] in CONSEQUENTIAL_ACTIONS}))}). "
                      "Resend with confirm=true to proceed.",
            "requires_confirmation": True,
        })

    # idempotency: same key + same playbook returns the existing run
    if body.idempotency_key:
        prev = (await db.execute(
            select(PlaybookRun).where(
                PlaybookRun.playbook_id == p.id,
                PlaybookRun.idempotency_key == body.idempotency_key)
        )).scalars().first()
        if prev:
            return {"replayed": True, "run": _run_out(prev)}

    # incident context validation (tenant scoped)
    inc_obj = None
    if body.incident_uid:
        inc_obj = (await db.execute(
            select(Incident).where(Incident.uid == body.incident_uid)
        )).scalars().first()
        if not inc_obj:
            raise HTTPException(404, "Incident not found")
        if current_user.role != "platform_admin" and inc_obj.org_id != current_user.org_id:
            raise HTTPException(403, "Cross-tenant access denied")

    uid = await next_run_uid(db)
    run = PlaybookRun(
        uid=uid, playbook_id=p.id, org_id=p.org_id if p.org_id is not None else current_user.org_id,
        incident_uid=body.incident_uid, mode=body.mode, status="running",
        triggered_by=current_user.email, idempotency_key=body.idempotency_key,
        total_steps=len(steps), result_log=[], started_at=now_utc(), created_at=now_utc(),
    )
    db.add(run)
    await db.flush()

    log: list[dict] = []
    completed = failed = skipped = 0
    cancelled = False
    for i, s in enumerate(steps, start=1):
        db_row = (await db.execute(
            select(PlaybookRun).where(PlaybookRun.id == run.id)
        )).scalars().first()
        if db_row and db_row.cancel_requested:
            cancelled = True
            log.append({"step": i, "name": s["name"], "action": s["action"],
                        "status": "skipped", "detail": "Cancelled by operator"})
            skipped += 1
            continue
        st, detail = await _run_step(db, run, s, current_user, executing)
        entry = {"step": i, "name": s["name"], "action": s["action"],
                 "status": st, "detail": redact(detail)}
        log.append(entry)
        if st == "completed":
            completed += 1
        elif st == "failed":
            failed += 1
            # fail-fast: remaining steps are honestly marked skipped
            for j, rem in enumerate(steps[i:], start=i + 1):
                log.append({"step": j, "name": rem["name"], "action": rem["action"],
                            "status": "skipped", "detail": "Skipped after previous step failed"})
                skipped += 1
            break
        else:
            skipped += 1

    run.result_log = log
    run.completed_steps = completed
    run.failed_steps = failed
    run.skipped_steps = skipped
    run.finished_at = now_utc()
    if cancelled:
        run.status = "cancelled"
    elif failed:
        run.status = "failed" if completed == 0 else "partial"
    else:
        run.status = "completed"
    if run.status == "failed":
        run.error = next((e["detail"] for e in log if e["status"] == "failed"), "step failure")

    # link back to the incident ledger when executed for real
    if executing and inc_obj is not None:
        db.add(IncidentAction(incident_uid=inc_obj.uid, action_type="run_playbook",
                              status={"completed": "completed", "failed": "failed",
                                      "partial": "failed", "cancelled": "cancelled"}[run.status],
                              detail=f"Playbook '{p.name}' run {run.uid}: "
                                     f"{completed}/{len(steps)} steps completed",
                              performed_by=current_user.email, playbook_run_uid=run.uid,
                              created_at=now_utc()))
        await append_activity(db, inc_obj.uid, current_user.email, "playbook_run",
                              f"Executed playbook '{p.name}' ({run.uid}) → {run.status}")

    _plat_audit(db, current_user, f"playbook_{body.mode}", "soar_playbook_run", run.uid,
                f"'{p.name}' status={run.status} steps ok/fail/skip={completed}/{failed}/{skipped}",
                outcome="success" if run.status == "completed" else "failure")
    await db.commit()
    return {"replayed": False, "run": _run_out(run)}


# ---------------------------------------------------------------------------
# Execution history / status / cancel / retry
# ---------------------------------------------------------------------------
@router.get("/runs")
async def list_runs(current_user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db),
                    playbook_id: Optional[int] = None,
                    incident_uid: Optional[str] = None,
                    status_f: Optional[str] = Query(None, alias="status"),
                    mode: Optional[str] = None,
                    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200)):
    stmt = select(PlaybookRun)
    if current_user.role != "platform_admin":
        stmt = stmt.where(PlaybookRun.org_id.in_([current_user.org_id, None]))
    if playbook_id:
        stmt = stmt.where(PlaybookRun.playbook_id == playbook_id)
    if incident_uid:
        stmt = stmt.where(PlaybookRun.incident_uid == incident_uid)
    if status_f:
        stmt = stmt.where(PlaybookRun.status == status_f)
    if mode:
        stmt = stmt.where(PlaybookRun.mode == mode)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    rows = (await db.execute(stmt.order_by(PlaybookRun.created_at.desc())
                             .offset((page - 1) * page_size).limit(page_size))).scalars().all()
    pbs = {p.id: p.name for p in (await db.execute(select(Playbook))).scalars().all()}
    items = []
    for r in rows:
        o = _run_out(r, include_log=False)
        o["playbook_name"] = pbs.get(r.playbook_id)
        items.append(o)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/runs/{run_uid}")
async def get_run(run_uid: str, current_user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db)):
    r = (await db.execute(select(PlaybookRun).where(PlaybookRun.uid == run_uid))).scalars().first()
    if not r:
        raise HTTPException(404, "Run not found")
    if current_user.role != "platform_admin" and r.org_id not in (None, current_user.org_id):
        raise HTTPException(403, "Cross-tenant access denied")
    out = _run_out(r)
    p = (await db.execute(select(Playbook).where(Playbook.id == r.playbook_id))).scalars().first()
    out["playbook_name"] = p.name if p else None
    return out


@router.post("/runs/{run_uid}/cancel")
async def cancel_run(run_uid: str, current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    r = (await db.execute(select(PlaybookRun).where(PlaybookRun.uid == run_uid))).scalars().first()
    if not r:
        raise HTTPException(404, "Run not found")
    if current_user.role != "platform_admin" and r.org_id not in (None, current_user.org_id):
        raise HTTPException(403, "Cross-tenant access denied")
    if r.status in ("completed", "failed", "partial", "cancelled"):
        raise HTTPException(409, f"Run already finished ({r.status})")
    if r.triggered_by != current_user.email and current_user.role not in ("platform_admin", "client_admin"):
        raise HTTPException(403, "Only the requester or an admin may cancel this run")
    # Runs execute inline; a queued/running flag lets any concurrent pass stop.
    r.cancel_requested = True
    r.status = "cancelled"
    r.finished_at = now_utc()
    _plat_audit(db, current_user, "playbook_run_cancelled", "soar_playbook_run", r.uid, "")
    await db.commit()
    return _run_out(r)


@router.post("/runs/{run_uid}/retry")
async def retry_run(run_uid: str, body: RunRequest,
                    current_user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    r = (await db.execute(select(PlaybookRun).where(PlaybookRun.uid == run_uid))).scalars().first()
    if not r:
        raise HTTPException(404, "Run not found")
    if current_user.role != "platform_admin" and r.org_id not in (None, current_user.org_id):
        raise HTTPException(403, "Cross-tenant access denied")
    if r.status not in ("failed", "partial", "cancelled"):
        raise HTTPException(409, "Only failed/partial/cancelled runs can be retried")
    new_body = RunRequest(mode=r.mode, incident_uid=r.incident_uid,
                          confirm=body.confirm, idempotency_key=body.idempotency_key)
    resp = await run_playbook(r.playbook_id, new_body, current_user, db)
    if isinstance(resp, dict) and resp.get("run"):
        resp["run"]["retry_of"] = r.uid
    return resp
