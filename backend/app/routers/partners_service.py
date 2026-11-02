"""Partner Portal — Phase 4: service delivery.

Routes (all under /api/partners; scoping via _resolve_partner exactly like
Phases 1-3: partner_admin touches only its own org + children, platform_admin
may address any partner, cross-partner -> 403, non-partner -> 404 "not configured"):

  4.1 Co-branded PDF client reports (server-side reportlab — approved design)
  GET    /partners/{pid}/reports                      list report records (own scope)
  POST   /partners/{pid}/reports                      generate now for one child client
                                                    (MTTD/MTTR/incidents/patch-vuln),
                                                    render PDF, store bytes as base64 in
                                                    tenant_settings['partner_reports'],
                                                    sha256 recorded on the row (rule:
                                                    verifiable artifact).
  GET    /partners/{pid}/reports/{rid}/download       streams application/pdf
  PUT    /partners/{pid}/reports/schedule             monthly|quarterly cadence per client
                                                    (schedule rows live beside reports;
                                                    `due` computed at read time — no cron
                                                    dependency, an operator or the UI
                                                    triggers generation when due).

  4.2 White-label extras
  GET/PUT  /partners/{pid}/notification-templates     subject/body per event type,
                                                    {{placeholder}} validation, MAD-safe.
  GET/PUT  /partners/{pid}/portal-url                 client portal URL bound to the
                                                    partner's VERIFIED custom domain only
                                                    (unverified -> 409 not_configured).

  4.3 SLA definitions & tracking, escalation policy, on-call roster, runbooks
  GET/PUT/DELETE /partners/{pid}/slas[/{sid}]         per-client response/resolution
                                                    targets; breach rate tracked live
                                                    from Ticket sla/due columns.
  GET/PUT  /partners/{pid}/escalation-policy          ordered levels (Literal channels).
  GET/PUT  /partners/{pid}/roster                     weekly on-call rotation (team users only).
  GET/POST/PUT/DELETE /partners/{pid}/runbooks[/{rid}]  markdown library, cloneable to
                                                    clients via existing template engine.

Storage note: Phase 4 adds NO new tables (per HARD RULE 6 minimalism) — all
state lives in TenantSetting.data JSON under namespaced keys, audited via
AuditLog. If concurrent-write volume grows, promote to tables + Alembic then.
"""
from __future__ import annotations

import base64
import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select as _sa_select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.database import get_db
from app.models import Alert, AuditLog, Incident, Organization, Ticket, User
from app.routers.partners import (
    _audit, _children, _rate_limit, _resolve_partner, _save_settings, _settings,
)
from app.services.partner_pdf import render_report_pdf

router = APIRouter(prefix="/partners", tags=["Partner Portal Service Delivery"])

SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
PLACEHOLDER_RE = re.compile(r"\{\{[a-z_]+\}\}")


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _put_state(db: AsyncSession, org_id: int, key: str, value: Any) -> None:
    data = await _settings(db, org_id)
    data[key] = value
    await _save_settings(db, org_id, data)


async def _get_state(db: AsyncSession, org_id: int, key: str, default: Any) -> Any:
    data = await _settings(db, org_id)
    return data.get(key, default)


# --------------------------------------------------------------------------- #
# 4.1 Co-branded PDF reports                                                   #
# --------------------------------------------------------------------------- #
class ReportGenerateIn(BaseModel):
    client_org_id: int
    period: Literal["monthly", "quarterly"] = "monthly"
    months_back: int = Field(default=0, ge=0, le=12)   # 0 = current period so far


class SchedulePutIn(BaseModel):
    client_org_id: int
    cadence: Literal["off", "monthly", "quarterly"]
    recipient_email: Optional[str] = None              # where a mailer would send it


async def _client_metrics(db: AsyncSession, client_id: int, since: datetime) -> Dict[str, Any]:
    """MTTD / MTTR / incidents / patch-vulnerability snapshot for one child."""
    tickets = (await db.execute(
        select_native_tickets(client_id))).scalars().all()
    alerts = (await db.execute(
        _select_alerts(client_id, since))).scalars().all()
    incidents = (await db.execute(
        _select_incidents(client_id, since))).scalars().all()

    responded = [t for t in tickets if t.first_response_at and t.created_at]
    resolved_t = [t for t in tickets if t.resolved_at and t.created_at]
    mtt_min = [ (t.first_response_at - t.created_at).total_seconds() / 60
               for t in responded ]
    mttr_min = [ (t.resolved_at - t.created_at).total_seconds() / 60
                for t in resolved_t ]
    acked = [a for a in alerts if a.acked_at and a.created_at]
    mtt_alert = [(a.acked_at - a.created_at).total_seconds() / 60 for a in acked]
    res_inc = [i for i in incidents if i.resolved_at and i.created_at]
    mttr_inc = [(i.resolved_at - i.created_at).total_seconds() / 60 for i in res_inc]

    def avg(xs: List[float]) -> Optional[float]:
        return round(sum(xs) / len(xs), 1) if xs else None

    open_alerts = [a for a in alerts if a.status == "active"]
    crit_open = [a for a in open_alerts if a.severity in ("critical", "high")]
    vuln_tickets = [t for t in tickets if t.category == "vulnerability"]
    patched = [t for t in vuln_tickets if t.status in ("resolved", "closed")]
    return {
        "mttd_minutes": avg(mtt_min + mtt_alert),
        "mttr_minutes": avg(mttr_min + mttr_inc),
        "alerts_total": len(alerts),
        "alerts_open": len(open_alerts),
        "alerts_critical_high_open": len(crit_open),
        "incidents_total": len(incidents),
        "incidents_open": len([i for i in incidents if i.status not in ("resolved", "closed")]),
        "tickets_total": len(tickets),
        "tickets_overdue": len([t for t in tickets
                                if t.due_resolve_at and t.due_resolve_at < _now()
                                and t.status not in ("resolved", "closed")]),
        "vulns_tracked": len(vuln_tickets),
        "vulns_patched": len(patched),
        "patch_compliance_pct": round(100 * len(patched) / len(vuln_tickets), 1) if vuln_tickets else None,
        "top_incidents": [
            {"uid": i.uid, "title": i.title[:70], "severity": i.severity,
             "status": i.status,
             "created": i.created_at.strftime("%Y-%m-%d") if i.created_at else ""}
            for i in sorted(incidents, key=lambda x: SEV_ORDER.get(x.severity, 9))[:8]
        ],
    }


def select_native_tickets(client_id: int):
    return _sa_select(Ticket).where(Ticket.org_id == client_id)


def _select_alerts(client_id: int, since: datetime):
    return _sa_select(Alert).where(Alert.org_id == client_id, Alert.created_at >= since)


def _select_incidents(client_id: int, since: datetime):
    return _sa_select(Incident).where(Incident.org_id == client_id, Incident.created_at >= since)


def _period_window(period: str, months_back: int) -> tuple[datetime, str]:
    now = _now()
    if period == "quarterly":
        q = (now.month - 1) // 3
        start = now.replace(month=q * 3 + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
        label = f"{now.year} Q{q + 1}"
    else:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        label = now.strftime("%B %Y")
    if months_back:
        m = start.month - 1 - months_back
        y = start.year + m // 12
        m = m % 12 + 1
        start = start.replace(year=y, month=m)
        label = start.strftime("%B %Y") if period != "quarterly" else f"{start.year} Q{(start.month - 1) // 3 + 1}"
    return start, label


@router.get("/{pid}/reports")
async def list_reports(pid: str, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    kids = await _children(db, partner.id)
    name_by_id = {c.id: c.name for c in kids}
    rows = await _get_state(db, partner.id, "partner_reports", [])
    sched = await _get_state(db, partner.id, "report_schedule", {})
    out = []
    for r in rows:
        cid = r.get("client_org_id")
        if cid not in name_by_id:            # rule 1: never leak foreign rows
            continue
        entry = dict(r)
        entry.pop("pdf_b64", None)           # don't ship megabytes in a list
        entry["client_name"] = name_by_id.get(cid, "")
        s = sched.get(str(cid), {})
        entry["schedule"] = s.get("cadence", "off")
        if s.get("cadence", "off") != "off":
            last = max((x["generated_at"] for x in rows if x.get("client_org_id") == cid), default="")
            nxt = _next_due(s.get("cadence"), last)
            entry["next_due"] = nxt.isoformat() if nxt else None
            entry["due_now"] = bool(nxt and nxt <= _now())
        out.append(entry)
    return {"items": out}


def _next_due(cadence: str, last_iso: str) -> Optional[datetime]:
    if not last_iso:
        return _now()
    try:
        last = datetime.fromisoformat(last_iso)
    except ValueError:
        return None
    step = timedelta(days=92) if cadence == "quarterly" else timedelta(days=31)
    return last + step


@router.post("/{pid}/reports", status_code=201)
async def generate_report(pid: str, body: ReportGenerateIn,
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"report:{user.id}", max_calls=6)
    kids = {c.id: c for c in await _children(db, partner.id)}
    client = kids.get(body.client_org_id)
    if client is None:
        raise HTTPException(404, "Client not found in your portfolio")
    since, label = _period_window(body.period, body.months_back)
    metrics = await _client_metrics(db, client.id, since)
    branding = (await _settings(db, partner.id)).get("branding", {})

    kpis = [
        {"label": "MTTD", "value": f"{metrics['mttd_minutes']} min" if metrics["mttd_minutes"] is not None else "n/a"},
        {"label": "MTTR", "value": f"{metrics['mttr_minutes']} min" if metrics["mttr_minutes"] is not None else "n/a"},
        {"label": "Alerts", "value": str(metrics["alerts_total"])},
        {"label": "Incidents", "value": str(metrics["incidents_total"])},
        {"label": "Patch compliance", "value": f"{metrics['patch_compliance_pct']}%" if metrics["patch_compliance_pct"] is not None else "n/a"},
        {"label": "SLA overdue", "value": str(metrics["tickets_overdue"])},
    ]
    sections = [
        {"heading": "Service performance", "columns": ["Metric", "Value"],
         "rows": [[k["label"], k["value"]] for k in kpis]},
        {"heading": "Vulnerability & patch status", "columns": ["Tracked", "Patched", "Compliance"],
         "rows": [[str(metrics["vulns_tracked"]), str(metrics["vulns_patched"]),
                   (f"{metrics['patch_compliance_pct']}%" if metrics["patch_compliance_pct"] is not None else "n/a")]]},
        {"heading": "Incidents (top by severity)",
         "columns": ["UID", "Title", "Severity", "Status", "Created"],
         "rows": [[i["uid"], i["title"], i["severity"], i["status"], i["created"]]
                  for i in metrics["top_incidents"]]},
    ]
    pdf = render_report_pdf(
        title=f"Security Operations Report ({body.period})",
        period=label, partner_name=partner.name, client_name=client.name,
        branding=branding, kpis=kpis, sections=sections,
        footer=f"Confidential — prepared by {branding.get('brand_name') or partner.name} with InfraCentra SOC",
    )
    rid = hashlib.sha256(pdf).hexdigest()[:12]
    record = {
        "id": rid, "sha256": hashlib.sha256(pdf).hexdigest(),
        "client_org_id": client.id, "client_name": client.name,
        "period": body.period, "period_label": label,
        "generated_at": _now().isoformat(), "generated_by": user.email,
        "metrics": metrics, "size_bytes": len(pdf),
        "pdf_b64": base64.b64encode(pdf).decode(),
    }
    rows = await _get_state(db, partner.id, "partner_reports", [])
    rows = [r for r in rows if r.get("id") != rid][-60:]      # cap stored history
    rows.insert(0, record)
    await _put_state(db, partner.id, "partner_reports", rows)
    db.add(_audit(user, "partner.report.generate", str(client.id),
                  f"report {rid} ({body.period} {label}) sha256={record['sha256'][:16]}…", partner.id))
    await db.commit()
    return {k: v for k, v in record.items() if k != "pdf_b64"}


@router.get("/{pid}/reports/{rid}/download")
async def download_report(pid: str, rid: str, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    kids = {c.id for c in await _children(db, partner.id)}
    rows = await _get_state(db, partner.id, "partner_reports", [])
    rec = next((r for r in rows if r.get("id") == rid), None)
    if rec is None or rec.get("client_org_id") not in kids:
        raise HTTPException(404, "Report not found")
    blob = base64.b64decode(rec["pdf_b64"])
    if hashlib.sha256(blob).hexdigest() != rec["sha256"]:
        raise HTTPException(500, "Report integrity check failed")
    fname = f"report-{rec['client_name'].replace(' ', '_')}-{rec['period_label'].replace(' ', '_')}.pdf"
    return Response(content=blob, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.put("/{pid}/reports/schedule")
async def put_schedule(pid: str, body: SchedulePutIn, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"schedule:{user.id}")
    kids = {c.id: c for c in await _children(db, partner.id)}
    if body.client_org_id not in kids:
        raise HTTPException(404, "Client not found in your portfolio")
    sched = await _get_state(db, partner.id, "report_schedule", {})
    sched[str(body.client_org_id)] = {"cadence": body.cadence,
                                      "recipient_email": body.recipient_email,
                                      "updated_at": _now().isoformat()}
    await _put_state(db, partner.id, "report_schedule", sched)
    db.add(_audit(user, "partner.report.schedule", str(body.client_org_id),
                  f"cadence={body.cadence}", partner.id))
    await db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# 4.2 White-label extras                                                       #
# --------------------------------------------------------------------------- #
EventType = Literal["alert", "ticket_created", "ticket_resolved", "sla_warning",
                    "sla_breach", "incident_open", "report_ready", "welcome"]
DEFAULT_TEMPLATES: Dict[str, Dict[str, str]] = {
    et: {"subject": "", "body": ""} for et in (
        "alert", "ticket_created", "ticket_resolved", "sla_warning", "sla_breach",
        "incident_open", "report_ready", "welcome")
}
ALLOWED_PLACEHOLDERS = {"brand_name", "client_name", "partner_name", "title", "severity",
                        "status", "uid", "url", "support_email", "agent_name", "amount_mad"}


class TemplateIn(BaseModel):
    event_type: EventType
    subject: str = Field(max_length=140)
    body: str = Field(max_length=4000)

    @field_validator("subject", "body")
    @classmethod
    def _placeholders_known(cls, v: str) -> str:
        unknown = {p.strip("{}") for p in PLACEHOLDER_RE.findall(v)} - ALLOWED_PLACEHOLDERS
        if unknown:
            raise ValueError(f"unknown placeholders: {', '.join(sorted(unknown))}")
        return v


@router.get("/{pid}/notification-templates")
async def get_templates(pid: str, user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    stored = await _get_state(db, partner.id, "notification_templates", {})
    items = []
    for et, defaults in DEFAULT_TEMPLATES.items():
        cur = stored.get(et, {})
        items.append({"event_type": et,
                      "subject": cur.get("subject", defaults["subject"]),
                      "body": cur.get("body", defaults["body"]),
                      "customized": et in stored})
    return {"items": items, "allowed_placeholders": sorted(ALLOWED_PLACEHOLDERS)}


@router.put("/{pid}/notification-templates")
async def put_template(pid: str, body: TemplateIn, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"template:{user.id}")
    stored = await _get_state(db, partner.id, "notification_templates", {})
    stored[body.event_type] = {"subject": body.subject, "body": body.body}
    await _put_state(db, partner.id, "notification_templates", stored)
    db.add(_audit(user, "partner.template.update", body.event_type, "whitelabel template", partner.id))
    await db.commit()
    return {"ok": True}


class PortalUrlIn(BaseModel):
    portal_url: str = Field(max_length=200)


@router.get("/{pid}/portal-url")
async def get_portal_url(pid: str, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    st = await _settings(db, partner.id)
    branding = st.get("branding", {})
    return {
        "portal_url": st.get("portal_url"),
        "custom_domain": branding.get("custom_domain"),
        "dns_status": branding.get("dns_status", "not_configured"),
        "state": ("configured" if st.get("portal_url") else
                  "not_configured" if not branding.get("custom_domain") else
                  "pending_verification" if branding.get("dns_status") != "verified" else
                  "empty"),
    }


@router.put("/{pid}/portal-url")
async def put_portal_url(pid: str, body: PortalUrlIn, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"portalurl:{user.id}")
    st = await _settings(db, partner.id)
    branding = st.get("branding", {})
    domain = (branding.get("custom_domain") or "").strip().lower()
    if not domain:
        raise HTTPException(404, "not configured: set a custom domain first")
    if branding.get("dns_status") != "verified":
        raise HTTPException(409, "domain not verified — run verify-domain first")
    url = body.portal_url.strip()
    host = re.sub(r"^https?://", "", url).split("/")[0].lower()
    if host != domain:
        raise HTTPException(422, f"portal URL host must be your verified domain ({domain})")
    if not url.startswith("https://"):
        raise HTTPException(422, "portal URL must use https://")
    st["portal_url"] = url
    await _save_settings(db, partner.id, st)
    db.add(_audit(user, "partner.portal_url.update", partner.partner_code or str(partner.id), url, partner.id))
    await db.commit()
    return {"ok": True, "portal_url": url}


# --------------------------------------------------------------------------- #
# 4.3 SLAs, escalation policy, roster, runbooks                                #
# --------------------------------------------------------------------------- #
class SlaIn(BaseModel):
    id: Optional[str] = None
    client_org_id: int
    name: str = Field(min_length=2, max_length=80)
    priority: Literal["p1", "p2", "p3", "p4"]
    response_minutes: int = Field(ge=5, le=10080)
    resolution_minutes: int = Field(ge=30, le=44640)


class EscalationLevel(BaseModel):
    after_minutes: int = Field(ge=0, le=10080)
    channel: Literal["in_app", "email", "sms", "webhook", "phone"]
    target_role: Literal["analyst", "billing", "partner_admin", "platform_admin"]
    notify_emails: List[str] = Field(default_factory=list, max_length=10)


class EscalationPolicyIn(BaseModel):
    levels: List[EscalationLevel] = Field(max_length=6)


class RosterEntry(BaseModel):
    user_id: int
    weekday: int = Field(ge=0, le=6)           # 0 = Monday
    start_hour: int = Field(ge=0, le=23)
    end_hour: int = Field(ge=0, le=23)         # may wrap past midnight


class RunbookIn(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    category: str = Field(default="General", max_length=60)
    markdown: str = Field(max_length=20000)


async def _sla_tracking(db: AsyncSession, partner_id: int, slas: List[dict]) -> List[dict]:
    kids = {c.id for c in await _children(db, partner_id)}
    tickets = (await db.execute(
        _sa_select(Ticket).where(Ticket.org_id.in_(kids or {-1}))
    )).scalars().all()
    out = []
    for s in slas:
        scoped = [t for t in tickets if t.org_id == s["client_org_id"] and t.priority == s["priority"]]
        met_resp = [t for t in scoped if t.first_response_at and t.created_at
                    and (t.first_response_at - t.created_at).total_seconds() / 60 <= s["response_minutes"]]
        breached = [t for t in scoped if t.due_resolve_at and t.status not in ("resolved", "closed")
                    and t.due_resolve_at < _now()]
        out.append({**s,
                    "tickets_in_scope": len(scoped),
                    "response_met": len(met_resp),
                    "overdue_open": len(breached),
                    "compliance_pct": round(100 * len(met_resp) / len(scoped), 1) if scoped else None})
    return out


@router.get("/{pid}/slas")
async def list_slas(pid: str, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    slas = await _get_state(db, partner.id, "slas", [])
    return {"items": await _sla_tracking(db, partner.id, slas)}


@router.put("/{pid}/slas")
async def put_sla(pid: str, body: SlaIn, user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"sla:{user.id}")
    kids = {c.id for c in await _children(db, partner.id)}
    if body.client_org_id not in kids:
        raise HTTPException(404, "Client not found in your portfolio")
    slas = await _get_state(db, partner.id, "slas", [])
    sid = body.id or hashlib.sha256(f"{partner.id}:{body.name}:{_now().isoformat()}".encode()).hexdigest()[:10]
    row = {"id": sid, **body.model_dump(exclude={"id"})}
    slas = [r for r in slas if r.get("id") != sid] + [row]
    await _put_state(db, partner.id, "slas", slas)
    db.add(_audit(user, "partner.sla.upsert", sid, f"{body.name} p={body.priority}", partner.id))
    await db.commit()
    return {"ok": True, "id": sid}


@router.delete("/{pid}/slas/{sid}")
async def delete_sla(pid: str, sid: str, user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    slas = await _get_state(db, partner.id, "slas", [])
    kept = [r for r in slas if r.get("id") != sid]
    if len(kept) == len(slas):
        raise HTTPException(404, "SLA not found")
    await _put_state(db, partner.id, "slas", kept)
    db.add(_audit(user, "partner.sla.delete", sid, "", partner.id))
    await db.commit()
    return {"ok": True}


@router.get("/{pid}/escalation-policy")
async def get_escalation(pid: str, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    pol = await _get_state(db, partner.id, "escalation_policy", None)
    if pol is None:
        return {"state": "not_configured", "levels": [],
                "suggested": [{"after_minutes": 15, "channel": "email", "target_role": "analyst", "notify_emails": []},
                              {"after_minutes": 60, "channel": "sms", "target_role": "partner_admin", "notify_emails": []}]}
    return {"state": "configured", "levels": pol}


@router.put("/{pid}/escalation-policy")
async def put_escalation(pid: str, body: EscalationPolicyIn, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"escalation:{user.id}")
    levels = sorted((l.model_dump() for l in body.levels), key=lambda x: x["after_minutes"])
    await _put_state(db, partner.id, "escalation_policy", levels)
    db.add(_audit(user, "partner.escalation.update", partner.partner_code or str(partner.id),
                  f"{len(levels)} levels", partner.id))
    await db.commit()
    return {"ok": True}


@router.get("/{pid}/roster")
async def get_roster(pid: str, user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    entries = await _get_state(db, partner.id, "roster", [])
    team = (await db.execute(_sa_select(User).where(User.org_id == partner.id))).scalars().all()
    by_id = {u.id: u for u in team}
    out = []
    for e in entries:
        u = by_id.get(e.get("user_id"))
        if u is None:                       # stale entry or foreign user — drop silently
            continue
        out.append({**e, "name": u.name, "email": u.email, "role": u.role})
    now = _now()
    wd, hh = now.weekday(), now.hour
    on_call = [o for o in out if o["weekday"] == wd and _hour_active(o["start_hour"], o["end_hour"], hh)]
    return {"items": out, "on_call_now": on_call,
            "team": [{"id": u.id, "name": u.name, "email": u.email, "role": u.role} for u in team]}


def _hour_active(start_h: int, end_h: int, h: int) -> bool:
    return (start_h <= h < end_h) if start_h <= end_h else (h >= start_h or h < end_h)


@router.put("/{pid}/roster")
async def put_roster(pid: str, body: List[RosterEntry], user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"roster:{user.id}")
    team_ids = {u.id for u in (await db.execute(
        _sa_select(User).where(User.org_id == partner.id))).scalars().all()}
    clean = [e.model_dump() for e in body if e.user_id in team_ids]   # rule 1: own team only
    if len(clean) > 60:
        raise HTTPException(422, "roster too large")
    await _put_state(db, partner.id, "roster", clean)
    db.add(_audit(user, "partner.roster.update", partner.partner_code or str(partner.id),
                  f"{len(clean)} entries", partner.id))
    await db.commit()
    return {"ok": True, "count": len(clean)}


@router.get("/{pid}/runbooks")
async def list_runbooks(pid: str, user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    rows = await _get_state(db, partner.id, "runbooks", [])
    return {"items": [{k: v for k, v in r.items() if k != "markdown"} for r in rows]}


@router.post("/{pid}/runbooks", status_code=201)
async def create_runbook(pid: str, body: RunbookIn, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"runbook:{user.id}")
    rows = await _get_state(db, partner.id, "runbooks", [])
    rid = hashlib.sha256(f"{partner.id}:{body.title}:{_now().isoformat()}".encode()).hexdigest()[:10]
    rows.insert(0, {"id": rid, **body.model_dump(), "created_at": _now().isoformat()})
    await _put_state(db, partner.id, "runbooks", rows[:100])
    db.add(_audit(user, "partner.runbook.create", rid, body.title, partner.id))
    await db.commit()
    return {"ok": True, "id": rid}


@router.put("/{pid}/runbooks/{rid}")
async def update_runbook(pid: str, rid: str, body: RunbookIn, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    rows = await _get_state(db, partner.id, "runbooks", [])
    for r in rows:
        if r.get("id") == rid:
            r.update(body.model_dump()); r["updated_at"] = _now().isoformat()
            await _put_state(db, partner.id, "runbooks", rows)
            db.add(_audit(user, "partner.runbook.update", rid, body.title, partner.id))
            await db.commit()
            return {"ok": True}
    raise HTTPException(404, "Runbook not found")


@router.get("/{pid}/runbooks/{rid}")
async def get_runbook(pid: str, rid: str, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    rows = await _get_state(db, partner.id, "runbooks", [])
    r = next((x for x in rows if x.get("id") == rid), None)
    if r is None:
        raise HTTPException(404, "Runbook not found")
    return r


@router.delete("/{pid}/runbooks/{rid}")
async def delete_runbook(pid: str, rid: str, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    rows = await _get_state(db, partner.id, "runbooks", [])
    kept = [r for r in rows if r.get("id") != rid]
    if len(kept) == len(rows):
        raise HTTPException(404, "Runbook not found")
    await _put_state(db, partner.id, "runbooks", kept)
    db.add(_audit(user, "partner.runbook.delete", rid, "", partner.id))
    await db.commit()
    return {"ok": True}
