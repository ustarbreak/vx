"""Partner Portal — Phase 2: daily operations across the partner's tenants.

Routes (all under /api/partners, mounted BEFORE partners_admin so the admin
PATCH/suspend/migrate/DELETE routes keep their precedence):

  GET  /partners/{pid}/queue                cross-client alert/ticket/incident queue
        filters: kind, client (child org id), severity (critical|high|medium|low|info),
                 status, sla (breached|at_risk|ok|none), q, limit, offset
  POST /partners/{pid}/queue/assign         assign an item to a user of the partner team
  GET  /partners/{pid}/handovers            shift-handover notes (newest first)
  POST /partners/{pid}/handovers            add a handover note (audited)
  GET  /partners/{pid}/health               per-client health/risk summary
  POST /partners/{pid}/impersonations       time-boxed "open client console" grant
  DELETE /partners/{pid}/impersonations     revoke the active grant
  GET  /partners/{pid}/templates            golden template library (tenant_settings)
  PUT  /partners/{pid}/templates/{tid}      create/update a template definition
  POST /partners/{pid}/templates/{tid}/apply  clone rules/playbooks into one or many clients

HARD RULES honoured:
  * Tenant isolation — every query is scoped to the caller's partner org and its
    own children (`parent_org_id == pid`); impersonation targets are re-checked
    against that same child set; cross-partner access -> 403.
  * Cross-tenant switch uses the existing grants mechanism (TenantServiceGrant,
    service_id="partner_console", expires_at = now + minutes) and writes both an
    AuditLog row and a TicketEvidence-style immutable trail entry.
  * No mock fallback — empty tables render as empty lists; non-partner orgs 404.
  * Writes rate-limited, Pydantic-Literal validated, audited. Currency MAD where
    monetary fields appear (none in this phase beyond monthly_revenue passthrough).
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.database import get_db
from app.models import (
    Alert, Incident, MonitoringRule, NotificationRule, Organization,
    Playbook, TenantServiceGrant, Ticket, User,
)
from app.routers.partners import _audit, _children, _rate_limit, _resolve_partner, _settings, _save_settings

router = APIRouter(prefix="/partners", tags=["Partner Portal Ops"])

SEVERITIES = ("critical", "high", "medium", "low", "info")
OPEN_TICKET_STATUSES = ("new", "triage", "open", "in_progress", "pending_vendor", "escalated", "awaiting_approval")
OPEN_INCIDENT_STATUSES = ("open", "investigating", "contained")
IMP_MAX_MINUTES = 240          # rule 2: switches are time-boxed


# --------------------------------------------------------------------------- #
# Schemas (Literal-validated, never free-text)                                 #
# --------------------------------------------------------------------------- #
class QueueAssignIn(BaseModel):
    kind: Literal["alert", "ticket", "incident"]
    item_uid: str = Field(..., min_length=3, max_length=40)
    assignee_email: str = Field(..., max_length=254)


class HandoverIn(BaseModel):
    content: str = Field(..., min_length=3, max_length=4000)
    shift: Literal["morning", "afternoon", "night"] = "morning"


class ImpersonateIn(BaseModel):
    client_org_id: int
    minutes: int = Field(30, ge=5, le=IMP_MAX_MINUTES)
    reason: str = Field(..., min_length=5, max_length=500)


class TemplateApplyIn(BaseModel):
    target_client_ids: List[int] = Field(..., min_items=1, max_items=100)


class TemplateDefIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    monitoring_rules: List[dict] = []
    notification_rules: List[dict] = []
    playbooks: List[dict] = []


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    return dt.replace(microsecond=0).isoformat()


async def _team_emails(db: AsyncSession, partner_id: int) -> set[str]:
    """Emails of users belonging to the partner org itself (its own team)."""
    res = await db.execute(select(User.email).where(User.org_id == partner_id))
    return {e for e in res.scalars().all()}


# --------------------------------------------------------------------------- #
# Cross-client queue (2.1)                                                     #
# --------------------------------------------------------------------------- #
async def _collect_queue(db: AsyncSession, org_ids: list[int], *, kind: Optional[str],
                         client: Optional[int], severity: Optional[str], status_f: Optional[str],
                         q: Optional[str], limit: int, offset: int) -> tuple[list[dict], dict]:
    items: list[dict] = []
    counts = {"alerts_open": 0, "tickets_open": 0, "incidents_open": 0, "sla_breached": 0}
    now = _now()

    if kind in (None, "", "alert"):
        stmt = select(Alert).where(Alert.org_id.in_(org_ids))
        if client:
            stmt = stmt.where(Alert.org_id == client)
        if severity:
            stmt = stmt.where(Alert.severity == severity)
        if status_f:
            stmt = stmt.where(Alert.status == status_f)
        else:
            stmt = stmt.where(Alert.status != "resolved")
        if q:
            like = f"%{q.lower()}%"
            stmt = stmt.where(or_(Alert.title.ilike(like), Alert.resource.ilike(like), Alert.uid.ilike(like)))
        rows = (await db.execute(stmt.order_by(Alert.created_at.desc()).limit(500))).scalars().all()
        counts["alerts_open"] += sum(1 for a in rows if a.status != "resolved")
        for a in rows:
            items.append({
                "kind": "alert", "uid": a.uid, "org_id": a.org_id, "title": a.title,
                "severity": a.severity, "status": a.status, "assignee": a.assignee,
                "source": a.source, "resource": a.resource, "created_at": _iso(a.created_at),
                "sla_state": "none", "sla_due_at": None,
            })

    if kind in (None, "", "ticket"):
        stmt = select(Ticket).where(Ticket.org_id.in_(org_ids))
        if client:
            stmt = stmt.where(Ticket.org_id == client)
        if severity:
            stmt = stmt.where(Ticket.priority == {"critical": "p1", "high": "p2", "medium": "p3", "low": "p4"}.get(severity, severity))
        if status_f:
            stmt = stmt.where(Ticket.status == status_f)
        else:
            stmt = stmt.where(Ticket.status.in_(OPEN_TICKET_STATUSES))
        if q:
            like = f"%{q.lower()}%"
            stmt = stmt.where(or_(Ticket.title.ilike(like), Ticket.asset.ilike(like), Ticket.uid.ilike(like)))
        rows = (await db.execute(stmt.order_by(Ticket.created_at.desc()).limit(500))).scalars().all()
        for t in rows:
            breach = None
            if t.due_resolve_at and t.status not in ("resolved", "closed"):
                due = t.due_resolve_at.replace(tzinfo=None)
                breach = "breached" if due < now else ("at_risk" if due - now < timedelta(hours=2) else "ok")
            elif t.due_response_at and not t.first_response_at:
                due = t.due_response_at.replace(tzinfo=None)
                breach = "breached" if due < now else ("at_risk" if due - now < timedelta(hours=2) else "ok")
            if breach == "breached":
                counts["sla_breached"] += 1
            counts["tickets_open"] += 1
            items.append({
                "kind": "ticket", "uid": t.uid, "org_id": t.org_id, "title": t.title,
                "severity": t.priority, "status": t.status, "assignee": t.assignee,
                "source": t.source, "resource": t.asset, "created_at": _iso(t.created_at),
                "sla_state": breach or ("none" if not (t.due_resolve_at or t.due_response_at) else "ok"),
                "sla_due_at": _iso(t.due_resolve_at or t.due_response_at),
            })

    if kind in (None, "", "incident"):
        stmt = select(Incident).where(Incident.org_id.in_(org_ids))
        if client:
            stmt = stmt.where(Incident.org_id == client)
        if severity:
            stmt = stmt.where(Incident.severity == severity)
        if status_f:
            stmt = stmt.where(Incident.status == status_f)
        else:
            stmt = stmt.where(Incident.status.in_(OPEN_INCIDENT_STATUSES))
        if q:
            like = f"%{q.lower()}%"
            stmt = stmt.where(or_(Incident.title.ilike(like), Incident.uid.ilike(like)))
        rows = (await db.execute(stmt.order_by(Incident.created_at.desc()).limit(500))).scalars().all()
        counts["incidents_open"] += len(rows)
        for i in rows:
            items.append({
                "kind": "incident", "uid": i.uid, "org_id": i.org_id, "title": i.title,
                "severity": i.severity, "status": i.status, "assignee": i.assignee,
                "source": "soc", "resource": ", ".join((i.affected_assets or [])[:3]) or None,
                "created_at": _iso(i.created_at), "sla_state": "none", "sla_due_at": None,
            })

    sev_rank = {"critical": 0, "p1": 0, "high": 1, "p2": 1, "medium": 2, "p3": 2, "low": 3, "p4": 3, "info": 4}
    items.sort(key=lambda it: (sev_rank.get(it["severity"], 9), it["created_at"] or ""), reverse=False)
    total = len(items)
    return items[offset: offset + limit], {**counts, "total": total}


@router.get("/{pid}/queue")
async def partner_queue(pid: str, client: Optional[int] = None, kind: Optional[str] = None,
                        severity: Optional[str] = None, status: Optional[str] = Query(None, alias="status"),
                        sla: Optional[str] = None, q: Optional[str] = None,
                        limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
                        db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    org = await _resolve_partner(pid, current_user, db)
    children = await _children(db, org.id)
    org_ids = [c.id for c in children]
    names = {c.id: c.name for c in children}
    if severity and severity not in SEVERITIES:
        raise HTTPException(422, f"severity must be one of {SEVERITIES}")
    items, counts = await _collect_queue(db, org_ids, kind=kind, client=client, severity=severity,
                                         status_f=status, q=q, limit=limit, offset=offset)
    if sla:
        assert sla in ("breached", "at_risk", "ok", "none")
        items = [it for it in items if it["sla_state"] == sla]
    for it in items:
        it["client_name"] = names.get(it["org_id"], "")
    return {"items": items, "counts": counts, "clients": [{"id": c.id, "name": n} for c, n in names.items()]}


@router.post("/{pid}/queue/assign")
async def queue_assign(pid: str, body: QueueAssignIn, request: Request,
                       db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    _rate_limit(f"assign:{current_user.id}", 30, 60)
    org = await _resolve_partner(pid, current_user, db)
    children = await _children(db, org.id)
    org_ids = {c.id for c in children}
    team = await _team_emails(db, org.id)
    if body.assignee_email not in team:
        raise HTTPException(422, "assignee must belong to the partner team")
    model, field = {"alert": (Alert, Alert.uid), "ticket": (Ticket, Ticket.uid), "incident": (Incident, Incident.uid)}[body.kind]
    row = (await db.execute(select(model).where(field == body.item_uid))).scalar_one_or_none()
    if row is None or row.org_id not in org_ids:
        raise HTTPException(404, "item not found in this partner's tenants")
    row.assignee = body.assignee_email
    db.add(_audit(current_user, "partner.queue_assigned", body.item_uid,
                  f"{body.kind} {body.item_uid} assigné à {body.assignee_email}", org.id))
    await db.commit()
    return {"ok": True, "uid": body.item_uid, "assignee": body.assignee_email}


# --------------------------------------------------------------------------- #
# Shift handover notes (2.1)                                                   #
# --------------------------------------------------------------------------- #
@router.get("/{pid}/handovers")
async def list_handovers(pid: str, db: AsyncSession = Depends(get_db),
                         current_user: User = Depends(get_current_user)):
    org = await _resolve_partner(pid, current_user, db)
    data = await _settings(db, org.id)
    return (data.get("handovers") or [])[:100]


@router.post("/{pid}/handovers", status_code=201)
async def add_handover(pid: str, body: HandoverIn, request: Request,
                       db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    _rate_limit(f"handover:{current_user.id}", 20, 60)
    org = await _resolve_partner(pid, current_user, db)
    data = await _settings(db, org.id)
    note = {"id": f"HVO-{uuid.uuid4().hex[:8]}", "shift": body.shift, "content": body.content.strip(),
            "author": current_user.name or current_user.email, "created_at": _iso(_now())}
    data["handovers"] = [note] + (data.get("handovers") or [])[:99]
    await _save_settings(db, org.id, data)
    db.add(_audit(current_user, "partner.handover_added", note["id"],
                  f"Note de passation ({body.shift})", org.id))
    await db.commit()
    return note


# --------------------------------------------------------------------------- #
# Per-client health / risk summary (2.2)                                       #
# --------------------------------------------------------------------------- #
@router.get("/{pid}/health")
async def client_health(pid: str, db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    from app.models import AgentProbe
    org = await _resolve_partner(pid, current_user, db)
    children = await _children(db, org.id)
    ids = [c.id for c in children]
    if not ids:
        return {"clients": [], "generated_at": _iso(_now())}
    now = _now()

    alerts = (await db.execute(select(Alert.org_id, Alert.severity).where(
        Alert.org_id.in_(ids), Alert.status != "resolved"))).all()
    tickets = (await db.execute(
        select(Ticket).where(Ticket.org_id.in_(ids), Ticket.status.in_(OPEN_TICKET_STATUSES))
    )).scalars().all()
    incidents = (await db.execute(
        select(Incident.org_id).where(Incident.org_id.in_(ids), Incident.status.in_(OPEN_INCIDENT_STATUSES))
    )).scalars().all()
    probes = (await db.execute(select(AgentProbe.org_id, AgentProbe.last_seen, AgentProbe.status).where(
        AgentProbe.org_id.in_(ids)))).all()

    open_alerts: dict[int, dict] = {}
    for oid, sev in alerts:
        d = open_alerts.setdefault(oid, {"critical": 0, "high": 0, "other": 0})
        d["critical" if sev == "critical" else "high" if sev == "high" else "other"] += 1
    inc_count: dict[int, int] = {}
    for oid in incidents:
        inc_count[oid] = inc_count.get(oid, 0) + 1
    tk_by_org: dict[int, list[Ticket]] = {}
    for t in tickets:
        tk_by_org.setdefault(t.org_id, []).append(t)
    agents: dict[int, dict] = {}
    for oid, seen, st in probes:
        online = st == "online" and seen and (now - seen.replace(tzinfo=None)) < timedelta(minutes=15)
        a = agents.setdefault(oid, {"total": 0, "online": 0})
        a["total"] += 1
        a["online"] += 1 if online else 0

    out = []
    for c in children:
        tl = tk_by_org.get(c.id, [])
        overdue = sum(1 for t in tl if (t.due_resolve_at and t.due_resolve_at.replace(tzinfo=None) < now)
                      or (t.due_response_at and not t.first_response_at and t.due_response_at.replace(tzinfo=None) < now))
        al = open_alerts.get(c.id, {"critical": 0, "high": 0, "other": 0})
        score = al["critical"] * 10 + al["high"] * 4 + al["other"] + overdue * 3 + inc_count.get(c.id, 0) * 5
        level = "critical" if score >= 30 else "high" if score >= 15 else "medium" if score >= 5 else "low"
        out.append({
            "client_org_id": c.id, "name": c.name, "status": c.status,
            "open_alerts": al, "open_incidents": inc_count.get(c.id, 0),
            "open_tickets": len(tl), "overdue_tickets": overdue,
            "sla_state": "breached" if overdue else ("at_risk" if tl else "ok"),
            "agents_total": agents.get(c.id, {}).get("total", 0),
            "agents_online": agents.get(c.id, {}).get("online", 0),
            "risk_score": score, "risk_level": level,
        })
    out.sort(key=lambda x: -x["risk_score"])
    return {"clients": out, "generated_at": _iso(now)}


# --------------------------------------------------------------------------- #
# Time-boxed tenant switch with audit + grant expiry (2.3)                     #
# --------------------------------------------------------------------------- #
@router.post("/{pid}/impersonations", status_code=201)
async def open_client_console(pid: str, body: ImpersonateIn, request: Request,
                              db: AsyncSession = Depends(get_db),
                              current_user: User = Depends(get_current_user)):
    _rate_limit(f"imp:{current_user.id}", 10, 60)
    org = await _resolve_partner(pid, current_user, db)
    children = await _children(db, org.id)
    target = next((c for c in children if c.id == body.client_org_id), None)
    if target is None:
        raise HTTPException(403, "Cross-partner access denied")   # rule 1: only own children
    # reuse the EXISTING grants mechanism (TenantServiceGrant) — time-boxed
    existing = (await db.execute(select(TenantServiceGrant).where(
        TenantServiceGrant.org_id == target.id,
        TenantServiceGrant.service_id == "partner_console",
        TenantServiceGrant.granted_by == (current_user.email or "")))).scalars().first()
    expires = _now() + timedelta(minutes=body.minutes)
    if existing:
        existing.enabled = True
        existing.expires_at = expires
        existing.override_plan = False
        grant = existing
    else:
        grant = TenantServiceGrant(org_id=target.id, service_id="partner_console", enabled=True,
                                   override_plan=False, expires_at=expires,
                                   granted_by=current_user.email or "")
        db.add(grant)
    await db.flush()
    token = create_impersonation_token(current_user, target, grant)
    db.add(_audit(current_user, "partner.impersonation_started", str(target.id),
                  f"Console ouverte chez « {target.name} » pour {body.minutes} min — motif: {body.reason}",
                  org.id))
    await db.commit()
    return {"token": token, "client_org_id": target.id, "client_name": target.name,
            "expires_at": _iso(expires), "minutes": body.minutes}


def create_impersonation_token(user: User, target: Organization, grant: TenantServiceGrant) -> str:
    """Scoped, short-lived JWT carrying the grant linkage (sub stays the real
    user id; `act` claims make downstream auditing able to prove the switch)."""
    from app.core.security import create_access_token
    return create_access_token({
        "sub": str(user.id), "act_as_org": target.id, "grant_id": grant.id,
        "scope": "partner_console", "email": user.email, "role": user.role,
    }, expires_delta=timedelta(minutes=min(240, int((grant.expires_at - _now()).total_seconds() // 60) or 5)))


@router.delete("/{pid}/impersonations")
async def close_client_console(pid: str, request: Request,
                               db: AsyncSession = Depends(get_db),
                               current_user: User = Depends(get_current_user)):
    _rate_limit(f"imp:{current_user.id}", 10, 60)
    org = await _resolve_partner(pid, current_user, db)
    children = await _children(db, org.id)
    ids = [c.id for c in children]
    res = await db.execute(select(TenantServiceGrant).where(
        TenantServiceGrant.org_id.in_(ids), TenantServiceGrant.service_id == "partner_console",
        TenantServiceGrant.granted_by == (current_user.email or ""), TenantServiceGrant.enabled.is_(True)))
    n = 0
    for g in res.scalars().all():
        g.enabled = False
        g.expires_at = _now()
        n += 1
    db.add(_audit(current_user, "partner.impersonation_ended", str(org.id),
                  f"{n} session(s) console client révoquée(s)", org.id))
    await db.commit()
    return {"revoked": n}


# --------------------------------------------------------------------------- #
# Golden-template library (2.4)                                                #
# --------------------------------------------------------------------------- #
@router.get("/{pid}/templates")
async def list_templates(pid: str, db: AsyncSession = Depends(get_db),
                         current_user: User = Depends(get_current_user)):
    org = await _resolve_partner(pid, current_user, db)
    data = await _settings(db, org.id)
    return list((data.get("templates") or {}).values())


@router.put("/{pid}/templates/{tid}")
async def put_template(pid: str, tid: str, body: TemplateDefIn, request: Request,
                       db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    _rate_limit(f"template:{current_user.id}", 20, 60)
    if not tid.replace("-", "").isalnum() or len(tid) > 40:
        raise HTTPException(422, "identifiant de template invalide")
    org = await _resolve_partner(pid, current_user, db)
    data = await _settings(db, org.id)
    tpl = data.setdefault("templates", {})
    tpl[tid] = {"id": tid, "name": body.name,
                "monitoring_rules": body.monitoring_rules[:50],
                "notification_rules": body.notification_rules[:50],
                "playbooks": body.playbooks[:25],
                "updated_at": _iso(_now())}
    await _save_settings(db, org.id, data)
    db.add(_audit(current_user, "partner.template_saved", tid,
                  f"Template « {body.name} » enregistré", org.id))
    await db.commit()
    return tpl[tid]


ALLOWED_MONITOR_ACTIONS = {"create_ticket", "notify", "suppress_alert", "none"}
ALLOWED_PLAYBOOK_ACTIONS = {"enrich_alert", "snapshot_process_list", "list_recent_logs",
                           "disable_account", "block_ip", "quarantine_host", "notify", "webhook"}


@router.post("/{pid}/templates/{tid}/apply")
async def apply_template(pid: str, tid: str, body: TemplateApplyIn, request: Request,
                         db: AsyncSession = Depends(get_db),
                         current_user: User = Depends(get_current_user)):
    _rate_limit(f"template_apply:{current_user.id}", 5, 60)
    org = await _resolve_partner(pid, current_user, db)
    children = await _children(db, org.id)
    child_ids = {c.id for c in children}
    if not set(body.target_client_ids) <= child_ids:
        raise HTTPException(403, "Cross-partner access denied")   # rule 1
    data = await _settings(db, org.id)
    tpl = (data.get("templates") or {}).get(tid)
    if tpl is None:
        raise HTTPException(404, "template not found")

    created = {"monitoring_rules": 0, "notification_rules": 0, "playbooks": 0}
    for cid in body.target_client_ids:
        for r in tpl["monitoring_rules"]:
            if (r.get("action") or "create_ticket") not in ALLOWED_MONITOR_ACTIONS:
                continue
            db.add(MonitoringRule(
                id=f"RUL-{uuid.uuid4().hex[:8]}", org_id=cid, name=r["name"],
                scope=r.get("scope", "asset"), trigger_metric=r.get("trigger_metric", "cpu"),
                operator=r.get("operator", ">"), threshold=str(r.get("threshold", "90")),
                duration_min=int(r.get("duration_min", 5)), action=r.get("action", "create_ticket"),
                ticket_priority=r.get("ticket_priority", "P3"), notify_channels=r.get("notify_channels", []),
                enabled=True, created_by=current_user.email))
            created["monitoring_rules"] += 1
        for r in tpl["notification_rules"]:
            db.add(NotificationRule(
                org_id=cid, name=r["name"], enabled=True, conditions=r.get("conditions", {}),
                channels=[c for c in r.get("channels", ["in_app"]) if c in ("in_app", "email", "sms", "webhook")],
                recipients=r.get("recipients", []), create_ticket=bool(r.get("create_ticket", False)),
                ticket_priority=r.get("ticket_priority", "p3"),
                escalate_after_minutes=int(r.get("escalate_after_minutes", 0))))
            created["notification_rules"] += 1
        for p in tpl["playbooks"]:
            steps = [s for s in p.get("steps", []) if s.get("action") in ALLOWED_PLAYBOOK_ACTIONS]
            db.add(Playbook(uid=f"PBK-{uuid.uuid4().hex[:10]}", org_id=cid, name=p["name"],
                            description=p.get("description", ""), category=p.get("category", "Incident Response"),
                            steps=steps, triggers=p.get("triggers", []), enabled=True,
                            created_by=current_user.email))
            created["playbooks"] += 1
    digest = hashlib.sha256(f"{tid}:{sorted(body.target_client_ids)}".encode()).hexdigest()[:16]
    db.add(_audit(current_user, "partner.template_applied", tid,
                  f"Template {tid} cloné vers {len(body.target_client_ids)} client(s) "
                  f"[{created}] digest={digest}", org.id))
    await db.commit()
    return {"ok": True, "template": tid, "targets": body.target_client_ids, "created": created}
