"""Project Manager API — real backend (PostgreSQL).

Rules enforced server-side:
  * platform admins MUST assign an organization when creating a project;
  * client users can only see/manage projects of their own organization
    (their own projects, or "with us" PSA projects assigned to them);
  * running timer with pause/resume persisted in DB;
  * SLA: sla_hours + due_at computed at creation, progress vs milestones;
  * ticketing link: every ticket whose category == project.ticket_category
    is aggregated (count / open / advanced %) so the project page shows
    "where we are" in the launched project.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.core.security import get_current_user
from app.models import User, Project, ProjectMilestone, ProjectAttachment, Ticket


class AttachmentCreate(BaseModel):
    """Project attachment payload (file_b64 = base64 bytes, or pasted text)."""
    name: str
    kind: str = "file"          # file|image|pdf|config|text|note|diagram
    content: str = ""
    file_b64: str | None = None
    mime_type: str | None = None

router = APIRouter(prefix="/projects", tags=["Project Manager"])


def _now():
    return datetime.now(timezone.utc)


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    kind: str = "internal"            # internal (avec nous) | client (leur propre projet)
    priority: str = "medium"
    manager_email: str = ""
    ticket_category: str = ""
    sla_hours: int = 0
    org_id: int | None = None         # REQUIRED for platform admins
    milestones: list[str] = []


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    manager_email: str | None = None
    ticket_category: str | None = None
    sla_hours: int | None = None
    due_at: datetime | None = None


def _scope(user: User, requested_org: int | None, *, create: bool = False) -> int:
    if user.role == "platform_admin":
        if requested_org is None:
            if create:
                raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                    "Platform admins must assign the project to an organization")
            return -1  # sentinel: all orgs visible
        return requested_org
    if not user.org_id:
        raise HTTPException(400, "User has no organization")
    if requested_org is not None and requested_org != user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    return user.org_id


def _live_seconds(p: Project) -> int:
    base = p.time_spent_seconds or 0
    if p.timer_started_at and not p.timer_paused_at:
        start = p.timer_started_at if p.timer_started_at.tzinfo else p.timer_started_at.replace(tzinfo=timezone.utc)
        base += max(0, int((_now() - start).total_seconds()))
    return base


def _serialize(p: Project, live_secs: int | None = None) -> dict:
    secs = live_secs if live_secs is not None else _live_seconds(p)
    sla_status = "none"
    if p.sla_hours:
        due = p.due_at
        if due:
            due = due if due.tzinfo else due.replace(tzinfo=timezone.utc)
            remaining = (due - _now()).total_seconds()
            if p.status in ("completed", "cancelled"):
                sla_status = "met" if remaining >= 0 else "breached_after_done"
            elif remaining < 0:
                sla_status = "breached"
            elif remaining < 86400:
                sla_status = "at_risk"
            else:
                sla_status = "on_track"
    return {
        "id": p.id, "org_id": p.org_id, "name": p.name, "description": p.description,
        "kind": p.kind, "status": p.status, "priority": p.priority,
        "manager_email": p.manager_email, "ticket_category": p.ticket_category,
        "time_spent_seconds": secs,
        "timer_running": bool(p.timer_started_at and not p.timer_paused_at),
        "sla_hours": p.sla_hours, "sla_status": sla_status,
        "due_at": p.due_at.isoformat() if p.due_at else None,
        "created_by": p.created_by,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.get("")
async def list_projects(org_id: int | None = None,
                        current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    scope = _scope(current_user, org_id)
    stmt = select(Project).order_by(Project.created_at.desc())
    if scope != -1:
        stmt = stmt.where(Project.org_id == scope)
    projects = (await db.execute(stmt)).scalars().all()
    return [_serialize(p) for p in projects]


@router.post("", status_code=201)
async def create_project(body: ProjectCreate,
                         current_user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    org = _scope(current_user, body.org_id, create=True)
    p = Project(
        org_id=org, name=body.name, description=body.description,
        kind="internal" if current_user.role == "platform_admin" else "client",
        status="planned", priority=body.priority, manager_email=body.manager_email,
        ticket_category=body.ticket_category or body.name.lower().replace(" ", "-"),
        sla_hours=body.sla_hours,
        due_at=_now() + timedelta(hours=body.sla_hours) if body.sla_hours else None,
        created_by=current_user.email,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    for i, title in enumerate(body.milestones):
        db.add(ProjectMilestone(project_id=p.id, title=title, order_idx=i))
    await db.commit()
    return _serialize(p)


async def _get_project(pid: int, user: User, db: AsyncSession) -> Project:
    p = (await db.execute(select(Project).where(Project.id == pid))).scalars().first()
    if not p:
        raise HTTPException(404, "Project not found")
    if user.role != "platform_admin" and p.org_id != user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    return p


@router.get("/{pid}")
async def get_project(pid: int, current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    p = await _get_project(pid, current_user, db)
    ms = (await db.execute(
        select(ProjectMilestone).where(ProjectMilestone.project_id == pid)
        .order_by(ProjectMilestone.order_idx))).scalars().all()
    tickets = (await db.execute(
        select(Ticket).where(Ticket.org_id == p.org_id,
                             Ticket.category == p.ticket_category))).scalars().all() if p.ticket_category else []
    open_t = [t for t in tickets if t.status not in ("resolved", "closed")]
    done_ms = sum(1 for m in ms if m.done)
    return {
        **_serialize(p),
        "milestones": [_ms_out(m) for m in ms],
        "progress_pct": round(100 * done_ms / len(ms)) if ms else (100 if p.status == "completed" else 0),
        "tickets": {
            "total": len(tickets), "open": len(open_t),
            "items": [{"uid": t.uid, "title": t.title, "status": t.status,
                       "priority": getattr(t, "priority", "medium")} for t in tickets[:50]],
        },
    }


@router.patch("/{pid}")
async def update_project(pid: int, body: ProjectUpdate,
                         current_user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    p = await _get_project(pid, current_user, db)
    data = body.model_dump(exclude_none=True)
    if "sla_hours" in data and data["sla_hours"] and not p.due_at:
        p.due_at = _now() + timedelta(hours=data["sla_hours"])
    for k, v in data.items():
        setattr(p, k, v)
    await db.commit()
    await db.refresh(p)
    return _serialize(p)


# ---------------------------------------------------------------------------
# Timer (start / pause / resume / stop) — persisted server-side
# ---------------------------------------------------------------------------
@router.post("/{pid}/timer/{action}")
async def timer(pid: int, action: str, current_user: User = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)):
    p = await _get_project(pid, current_user, db)
    if action == "start":
        p.timer_started_at, p.timer_paused_at = _now(), None
    elif action == "pause":
        if p.timer_started_at and not p.timer_paused_at:
            p.time_spent_seconds = _live_seconds(p)
            p.timer_paused_at = _now()
    elif action == "resume":
        if p.timer_paused_at:
            p.timer_started_at, p.timer_paused_at = _now(), None
    elif action == "stop":
        p.time_spent_seconds = _live_seconds(p)
        p.timer_started_at = p.timer_paused_at = None
    else:
        raise HTTPException(422, "action must be start|pause|resume|stop")
    await db.commit()
    await db.refresh(p)
    return _serialize(p)


# ---------------------------------------------------------------------------
# Milestones
# ---------------------------------------------------------------------------
class MilestoneIn(BaseModel):
    """Milestone payload. planned_at is optional; absence is rendered as
    'no planned date' in the Gantt timeline — never back-filled with a guess."""
    title: str | None = None
    done: bool | None = None
    planned_at: datetime | None = None


def _ms_out(m: ProjectMilestone) -> dict:
    return {
        "id": m.id, "title": m.title, "done": bool(m.done),
        "planned_at": (m.planned_at.isoformat() if m.planned_at else None),
    }


@router.post("/{pid}/milestones", status_code=201)
async def add_milestone(pid: int, title: str | None = None, body: MilestoneIn | None = None,
                        current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    p = await _get_project(pid, current_user, db)
    t = title or (body.title if body else None) or "Jalon"
    idx = (await db.execute(select(func.count(ProjectMilestone.id))
                            .where(ProjectMilestone.project_id == p.id))).scalar() or 0
    m = ProjectMilestone(project_id=p.id, title=t, order_idx=idx,
                         planned_at=(body.planned_at if body else None))
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return _ms_out(m)


@router.patch("/milestones/{mid}")
async def toggle_milestone(mid: int, done: bool | None = None, body: MilestoneIn | None = None,
                           current_user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    m = (await db.execute(select(ProjectMilestone).where(ProjectMilestone.id == mid))).scalars().first()
    if not m:
        raise HTTPException(404, "Milestone not found")
    await _get_project(m.project_id, current_user, db)  # tenant guard
    d = done if done is not None else (body.done if body else None)
    if d is not None:
        m.done = d
    if body and "planned_at" in body.model_fields_set:
        m.planned_at = body.planned_at
    if body and body.title:
        m.title = body.title
    await db.commit()
    await db.refresh(m)
    return _ms_out(m)


# ---- attachments (documents that describe the project further) --------------
def _att_out(a: ProjectAttachment) -> dict:
    d = {c.name: getattr(a, c.name) for c in a.__table__.columns}
    d.pop("file_blob", None)
    d["has_file"] = bool(a.file_blob)
    return d


@router.get("/{pid}/attachments")
async def list_attachments(pid: int, current_user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    p = await _get_project(pid, current_user, db)
    rows = (await db.execute(
        select(ProjectAttachment).where(ProjectAttachment.project_id == p.id)
        .order_by(ProjectAttachment.created_at.desc()))).scalars().all()
    return [_att_out(r) for r in rows]


@router.post("/{pid}/attachments", status_code=201)
async def add_attachment(pid: int, body: AttachmentCreate,
                         current_user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """Attach a file (image / PDF / config / txt) or paste a text note."""
    import base64 as _b64
    import hashlib
    p = await _get_project(pid, current_user, db)
    blob_bytes = b""
    if body.file_b64:
        try:
            blob_bytes = _b64.b64decode(body.file_b64, validate=False)
        except Exception:
            blob_bytes = b""
    payload_for_hash = blob_bytes if blob_bytes else body.content.encode()
    att = ProjectAttachment(
        project_id=p.id, org_id=p.org_id, name=body.name, kind=body.kind,
        content=body.content, file_blob=body.file_b64 if blob_bytes else None,
        mime_type=body.mime_type,
        size_kb=max(1, (len(blob_bytes) if blob_bytes else len(body.content)) // 1024),
        sha256=hashlib.sha256(payload_for_hash).hexdigest(),
        uploaded_by=current_user.email,
    )
    db.add(att)
    await db.commit()
    await db.refresh(att)
    return _att_out(att)


@router.get("/{pid}/attachments/{att_id}/file")
async def download_attachment(pid: int, att_id: int,
                              current_user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    import base64
    from fastapi.responses import Response
    p = await _get_project(pid, current_user, db)
    a = (await db.execute(
        select(ProjectAttachment).where(ProjectAttachment.id == att_id,
                                        ProjectAttachment.project_id == p.id)
    )).scalars().first()
    if not a or not a.file_blob:
        raise HTTPException(404, "No file stored for this attachment")
    return Response(content=base64.b64decode(a.file_blob),
                    media_type=a.mime_type or "application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{a.name}"'})


@router.delete("/{pid}/attachments/{att_id}", status_code=204)
async def delete_attachment(pid: int, att_id: int,
                            current_user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    p = await _get_project(pid, current_user, db)
    a = (await db.execute(
        select(ProjectAttachment).where(ProjectAttachment.id == att_id,
                                        ProjectAttachment.project_id == p.id)
    )).scalars().first()
    if a:
        await db.delete(a)
        await db.commit()


@router.delete("/{pid}", status_code=204)
async def delete_project(pid: int, current_user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    p = await _get_project(pid, current_user, db)
    await db.execute(select(ProjectMilestone).where(ProjectMilestone.project_id == pid))
    for m in (await db.execute(select(ProjectMilestone).where(ProjectMilestone.project_id == pid))).scalars().all():
        await db.delete(m)
    await db.delete(p)
    await db.commit()
