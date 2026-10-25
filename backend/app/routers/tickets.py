"""Advanced Ticketing API — real backend, no mock data.

Tenancy rules:
  * platform_admin  -> sees/acts on every tenant, must pass org_id when creating
  * client_admin / client_user -> automatically scoped to their own org_id
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.core.security import get_current_user
from app.models import (
    User, Ticket, TicketEvidence, TicketAuditEntry, TicketApproval, Organization,
)
from app.schemas import (
    TicketCreate, TicketUpdate, TicketResponse, EvidenceCreate, EvidenceResponse,
    AuditEntryResponse, ApprovalResponse, ClosureRequest, ApprovalDecision,
)
from app.services import ticketing as tk

router = APIRouter(prefix="/tickets", tags=["Advanced Ticketing"])


def _scope_org(user: User, requested_org: int | None) -> int | None:
    """Returns effective org filter. Raises if a client touches another tenant."""
    if user.role == "platform_admin":
        return requested_org  # None => all tenants
    org = user.org_id
    if requested_org is not None and requested_org != org:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-tenant access denied")
    return org


def _ticket_out(t: Ticket) -> dict:
    d = {c.name: getattr(t, c.name) for c in t.__table__.columns}
    d["sla_state"] = tk.sla_state(t)
    d["breach_prediction"] = tk.breach_prediction(t)
    return d


async def _get_ticket(db: AsyncSession, uid_or_id: str, user: User) -> Ticket:
    stmt = select(Ticket).where(
        (Ticket.uid == uid_or_id) if str(uid_or_id).startswith("TCK-") else (Ticket.id == int(uid_or_id))
    )
    t = (await db.execute(stmt)).scalars().first()
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found")
    if user.role != "platform_admin" and t.org_id != user.org_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-tenant access denied")
    return t


@router.get("", response_model=list[TicketResponse])
async def list_tickets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    org_id: int | None = Query(None),
    status_f: str | None = Query(None, alias="status"),
    priority: str | None = None,
    q: str | None = None,
):
    eff_org = _scope_org(current_user, org_id)
    stmt = select(Ticket).order_by(Ticket.created_at.desc())
    if eff_org is not None:
        stmt = stmt.where(Ticket.org_id == eff_org)
    rows = (await db.execute(stmt)).scalars().all()
    out = []
    for t in rows:
        if status_f and t.status != status_f:
            continue
        if priority and t.priority != priority:
            continue
        if q and q.lower() not in f"{t.uid} {t.title} {t.asset or ''} {t.category}".lower():
            continue
        out.append(_ticket_out(t))
    return out


@router.post("", response_model=TicketResponse, status_code=status.HTTP_201_CREATED)
async def create_ticket(
    body: TicketCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org = _scope_org(current_user, body.org_id)
    if org is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Platform admins must specify org_id when creating a ticket")
    t = await tk.create_ticket(
        db, org_id=org, title=body.title, description=body.description or "",
        priority=body.priority, category=body.category, source="manual",
        assignee=body.assignee, reporter=current_user.email,
        tags=body.tags, asset=body.asset, vulnerability_ref=body.vulnerability_ref,
    )
    return _ticket_out(t)


# ---- tenants list (for the platform-admin tenant filter dropdown) -----------
@router.get("/meta/tenants")
async def ticket_tenants(current_user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """Distinct org ids that actually have tickets — used to populate the
    tenant filter. Clients only ever receive their own org."""
    stmt = select(Ticket.org_id).distinct()
    if current_user.role != "platform_admin":
        stmt = stmt.where(Ticket.org_id == current_user.org_id)
    org_ids = [r for r in (await db.execute(stmt)).scalars().all()]
    orgs = (await db.execute(select(Organization).where(Organization.id.in_(org_ids)))).scalars().all()
    return [{"id": o.id, "name": o.name} for o in orgs]


@router.get("/{uid}", response_model=TicketResponse)
async def get_ticket(uid: str, current_user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    return _ticket_out(await _get_ticket(db, uid, current_user))


@router.patch("/{uid}", response_model=TicketResponse)
async def update_ticket(uid: str, body: TicketUpdate,
                        current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    t = await _get_ticket(db, uid, current_user)
    changes = []
    if body.status is not None:
        if body.status in ("open", "in_progress") and not t.first_response_at:
            t.first_response_at = tk.now_utc()
        if body.status == "resolved":
            t.resolved_at = tk.now_utc()
        t.status = body.status
        changes.append(f"status→{body.status}")
    if body.priority is not None:
        t.priority = body.priority
        tk.apply_sla(t)  # recompute SLA clocks for the new priority
        changes.append(f"priority→{body.priority}")
    for field in ("assignee", "category", "asset", "vulnerability_ref"):
        val = getattr(body, field)
        if val is not None:
            setattr(t, field, val)
            changes.append(f"{field}→{val}")
    if body.tags is not None:
        t.tags = body.tags
        changes.append("tags updated")
    if changes or body.note:
        await tk.append_audit(db, t.uid, actor=current_user.email, action="updated",
                              detail="; ".join(changes) + (f" | note: {body.note}" if body.note else ""))
        await db.commit()
        await db.refresh(t)
    return _ticket_out(t)


# ---- evidence vault --------------------------------------------------------
def _ev_out(ev: TicketEvidence) -> dict:
    d = {c.name: getattr(ev, c.name) for c in ev.__table__.columns}
    d.pop("file_blob", None)          # never stream blobs in list payloads
    d["has_file"] = bool(ev.file_blob)
    return d


@router.get("/{uid}/evidence", response_model=list[EvidenceResponse])
async def list_evidence(uid: str, current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    t = await _get_ticket(db, uid, current_user)
    rows = (await db.execute(
        select(TicketEvidence).where(TicketEvidence.ticket_uid == t.uid)
        .order_by(TicketEvidence.created_at.desc())
    )).scalars().all()
    return [_ev_out(r) for r in rows]


@router.get("/{uid}/evidence/{ev_id}/file")
async def download_evidence_file(uid: str, ev_id: int,
                                 current_user: User = Depends(get_current_user),
                                 db: AsyncSession = Depends(get_db)):
    """Return the raw uploaded bytes (image/PDF/config/txt) for an attachment."""
    import base64
    from fastapi.responses import Response
    t = await _get_ticket(db, uid, current_user)
    ev = (await db.execute(
        select(TicketEvidence).where(TicketEvidence.id == ev_id,
                                     TicketEvidence.ticket_uid == t.uid)
    )).scalars().first()
    if not ev or not ev.file_blob:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No file stored for this evidence")
    return Response(content=base64.b64decode(ev.file_blob),
                    media_type=ev.mime_type or "application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{ev.name}"'})


@router.post("/{uid}/evidence", response_model=EvidenceResponse, status_code=201)
async def add_evidence(uid: str, body: EvidenceCreate,
                       current_user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    t = await _get_ticket(db, uid, current_user)
    ev = await tk.add_evidence(db, t.uid, body.name, body.kind, body.content,
                               collected_by=current_user.email,
                               file_b64=body.file_b64, mime_type=body.mime_type)
    await tk.append_audit(db, t.uid, actor=current_user.email, action="evidence_added",
                          detail=f"{body.kind}:{body.name} sha256={ev.sha256[:12]}…")
    await db.commit()
    await db.refresh(ev)
    return _ev_out(ev)


# ---- immutable audit chain ---------------------------------------------------
@router.get("/{uid}/audit", response_model=list[AuditEntryResponse])
async def audit_trail(uid: str, current_user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    t = await _get_ticket(db, uid, current_user)
    rows = (await db.execute(
        select(TicketAuditEntry).where(TicketAuditEntry.ticket_uid == t.uid)
        .order_by(TicketAuditEntry.seq.asc())
    )).scalars().all()
    return rows


# ---- approval workflow -------------------------------------------------------
@router.post("/{uid}/closure-request", response_model=ApprovalResponse)
async def closure_request(uid: str, body: ClosureRequest,
                          current_user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    t = await _get_ticket(db, uid, current_user)
    try:
        ap = await tk.request_closure(db, t, actor=current_user.email, note=body.note)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    return ap


@router.get("/{uid}/approvals", response_model=list[ApprovalResponse])
async def list_approvals(uid: str, current_user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    t = await _get_ticket(db, uid, current_user)
    rows = (await db.execute(
        select(TicketApproval).where(TicketApproval.ticket_uid == t.uid).order_by(TicketApproval.step)
    )).scalars().all()
    return rows


@router.post("/{uid}/approvals/{approval_id}/decide", response_model=ApprovalResponse)
async def decide(uid: str, approval_id: int, body: ApprovalDecision,
                 current_user: User = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)):
    t = await _get_ticket(db, uid, current_user)
    ap = (await db.execute(
        select(TicketApproval).where(TicketApproval.id == approval_id,
                                     TicketApproval.ticket_uid == t.uid)
    )).scalars().first()
    if not ap:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Approval step not found")
    if ap.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "Decision already recorded")
    await tk.decide_approval(db, t, ap, approve=body.approve,
                             actor=current_user.email, note=body.note or "")
    await db.refresh(ap)
    return ap


# ---- workload & escalations --------------------------------------------------
@router.get("/ops/workload")
async def team_workload(current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    eff_org = _scope_org(current_user, None)
    stmt = select(Ticket).where(Ticket.status.notin_(["resolved", "closed"]))
    if eff_org is not None:
        stmt = stmt.where(Ticket.org_id == eff_org)
    rows = (await db.execute(stmt)).scalars().all()
    by_assignee: dict[str, dict] = {}
    for t in rows:
        key = t.assignee or "unassigned"
        w = by_assignee.setdefault(key, {"assignee": key, "open": 0, "p1_p2": 0, "breached": 0})
        w["open"] += 1
        if t.priority in ("p1", "p2"):
            w["p1_p2"] += 1
        if tk.sla_state(t) == "breached":
            w["breached"] += 1
    return sorted(by_assignee.values(), key=lambda x: -x["open"])


@router.post("/ops/run-escalations")
async def run_escalations(current_user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    if current_user.role != "platform_admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform admins only")
    return {"escalated": await tk.run_escalations(db)}
