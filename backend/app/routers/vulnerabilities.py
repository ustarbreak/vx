"""Vulnerability management API backed by tenant-scoped Wazuh vulnerability inventory.

Wazuh's vulnerability detector is a verified read source. This API does not
claim to launch an authenticated network scan; Greenbone scan execution stays
unsupported until a Greenbone integration is configured and verified.
"""
from datetime import datetime, timezone
import hashlib

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.database import get_db
from app.models import AuditLog, Organization, Ticket, User, VulnerabilityFinding
from app.services.connectors import load_connector_config
from app.services.wazuh import WazuhService
from app.services import ticketing as ticketing_service

router = APIRouter(prefix="/vulnerabilities", tags=["Vulnerability Management"])


def _scope(user: User, requested: int | None) -> int:
    if user.role == "platform_admin":
        if requested is None:
            raise HTTPException(400, "org_id is required for platform administrators")
        return requested
    if user.org_id is None:
        raise HTTPException(400, "User has no organization")
    if requested is not None and requested != user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    return user.org_id


def _out(row: VulnerabilityFinding) -> dict:
    return {
        "id": row.id, "org_id": row.org_id, "finding_key": row.finding_key,
        "scanner": row.scanner, "asset_id": row.asset_id, "asset_name": row.asset_name,
        "cve": row.cve, "title": row.title, "severity": row.severity, "cvss": row.cvss,
        "status": row.status, "first_seen_at": row.first_seen_at,
        "last_seen_at": row.last_seen_at, "ticket_uid": row.ticket_uid,
    }


def _severity(cvss: float | None, source: str) -> str:
    if cvss is not None:
        if cvss >= 9: return "critical"
        if cvss >= 7: return "high"
        if cvss >= 4: return "medium"
        return "low"
    level = str(source or "").lower()
    return level if level in {"critical", "high", "medium", "low"} else "medium"


@router.get("")
async def list_findings(status: str | None = None, severity: str | None = None,
                        org_id: int | None = Query(None), limit: int = Query(200, ge=1, le=500),
                        user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = _scope(user, org_id)
    stmt = select(VulnerabilityFinding).where(VulnerabilityFinding.org_id == org).order_by(
        VulnerabilityFinding.last_seen_at.desc()).limit(limit)
    if status:
        stmt = stmt.where(VulnerabilityFinding.status == status)
    if severity:
        stmt = stmt.where(VulnerabilityFinding.severity == severity)
    rows = (await db.execute(stmt)).scalars().all()
    return {"items": [_out(x) for x in rows], "count": len(rows), "source": "persisted_scanner_findings"}


@router.post("/sync")
async def sync_wazuh_findings(org_id: int | None = Query(None),
                              user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = _scope(user, org_id)
    organization = await db.get(Organization, org)
    if organization is None:
        raise HTTPException(404, "Organization not found")
    cfg = await load_connector_config("endpoint-protection", db)
    if not cfg.get("api_endpoint"):
        raise HTTPException(503, "Wazuh integration is not configured for endpoint-protection")
    secret = cfg.get("api_key") or ""
    if not cfg.get("api_user") and ":" in secret and not secret.startswith("Bearer "):
        cfg["api_user"], cfg["api_password"] = secret.split(":", 1)
    svc = WazuhService(cfg["api_endpoint"], cfg.get("api_user") or "wazuh",
                       cfg.get("api_password") or secret)
    created = updated = 0
    try:
        agents = await svc.get_agents(org_id=str(org))
        for agent in agents:
            agent_id = str(agent.get("id") or "")
            if not agent_id:
                continue
            vulnerabilities = await svc.get_vulnerabilities(agent_id)
            for item in vulnerabilities:
                cve_obj = item.get("cve") if isinstance(item.get("cve"), dict) else {}
                cve = str(cve_obj.get("id") or item.get("cve") or item.get("cve_id") or "")[:40] or None
                package = item.get("package") if isinstance(item.get("package"), dict) else {}
                package_name = str(package.get("name") or item.get("package_name") or "")
                title = str(item.get("title") or item.get("description") or
                            (f"{cve} — {package_name}" if cve else package_name or "Wazuh vulnerability"))[:500]
                score_obj = item.get("score") if isinstance(item.get("score"), dict) else {}
                try: cvss = float(score_obj.get("base") or item.get("cvss") or item.get("cvss_score"))
                except (TypeError, ValueError): cvss = None
                key_raw = f"{agent_id}|{cve or title}|{package_name}"
                key = hashlib.sha256(key_raw.encode()).hexdigest()
                row = (await db.execute(select(VulnerabilityFinding).where(
                    VulnerabilityFinding.org_id == org, VulnerabilityFinding.finding_key == key
                ))).scalars().first()
                now = datetime.now(timezone.utc)
                values = dict(scanner="Wazuh", asset_id=agent_id,
                    asset_name=str(agent.get("name") or agent_id), cve=cve, title=title,
                    severity=_severity(cvss, str(item.get("severity") or "")), cvss=cvss,
                    last_seen_at=now, raw=item)
                if row is None:
                    row = VulnerabilityFinding(org_id=org, finding_key=key, **values)
                    db.add(row); created += 1
                else:
                    for field, value in values.items():
                        if field not in {"status", "ticket_uid"}:
                            setattr(row, field, value)
                    updated += 1
        db.add(AuditLog(actor_id=user.id, actor_name=user.name or user.email,
            actor_role=user.role, org_id=org, action="vulnerability.findings.synced",
            resource="vulnerability_findings", resource_id=str(org),
            details=f"Wazuh sync: {created} created, {updated} refreshed", outcome="success"))
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(502, f"Wazuh vulnerability sync failed: {type(exc).__name__}")
    finally:
        await svc.close()
    return {"org_id": org, "created": created, "updated": updated, "scanner": "Wazuh"}


class TicketFromFindingIn(BaseModel):
    priority: str = Field(default="p2", pattern="^(p1|p2|p3|p4)$")
    assignee: str | None = None


@router.post("/{finding_id}/ticket", status_code=201)
async def create_ticket_for_finding(finding_id: int, body: TicketFromFindingIn,
                                    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role not in ("client_admin", "platform_admin"):
        raise HTTPException(403, "Only tenant administrators may create remediation tickets")
    stmt = select(VulnerabilityFinding).where(VulnerabilityFinding.id == finding_id)
    if user.role != "platform_admin":
        stmt = stmt.where(VulnerabilityFinding.org_id == user.org_id)
    finding = (await db.execute(stmt)).scalars().first()
    if finding is None:
        raise HTTPException(404, "Finding not found")
    if finding.ticket_uid:
        raise HTTPException(409, f"Finding already linked to ticket {finding.ticket_uid}")
    ticket = await ticketing_service.create_ticket(
        db, org_id=finding.org_id, title=f"Remediate {finding.cve or finding.title}",
        description=f"Scanner: {finding.scanner}\nAsset: {finding.asset_name or finding.asset_id}\n"
                    f"CVSS: {finding.cvss if finding.cvss is not None else 'not supplied'}\n"
                    f"Finding: {finding.title}",
        priority=body.priority, category="vulnerability", source="api",
        assignee=body.assignee, reporter=user.email, tags=["vulnerability", finding.scanner],
        asset=finding.asset_name or finding.asset_id, vulnerability_ref=finding.cve)
    finding.ticket_uid = ticket.uid
    finding.status = "ticketed"
    db.add(AuditLog(actor_id=user.id, actor_name=user.name or user.email, actor_role=user.role,
        org_id=finding.org_id, action="vulnerability.ticket.created", resource="vulnerability_finding",
        resource_id=str(finding.id), details=f"Linked ticket {ticket.uid}", outcome="success"))
    await db.commit()
    await db.refresh(ticket)
    return {"finding": _out(finding), "ticket": {"uid": ticket.uid, "id": ticket.id, "status": ticket.status}}


@router.patch("/{finding_id}/status")
async def update_finding_status(finding_id: int, status: str = Query(..., pattern="^(open|remediating|resolved|accepted_risk)$"),
                                note: str = Query(..., min_length=3, max_length=500),
                                user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.role not in ("client_admin", "platform_admin"):
        raise HTTPException(403, "Only tenant administrators may change finding status")
    stmt = select(VulnerabilityFinding).where(VulnerabilityFinding.id == finding_id)
    if user.role != "platform_admin":
        stmt = stmt.where(VulnerabilityFinding.org_id == user.org_id)
    row = (await db.execute(stmt)).scalars().first()
    if row is None: raise HTTPException(404, "Finding not found")
    row.status = status
    db.add(AuditLog(actor_id=user.id, actor_name=user.name or user.email, actor_role=user.role,
        org_id=row.org_id, action="vulnerability.finding.status_changed", resource="vulnerability_finding",
        resource_id=str(row.id), details=f"{status}: {note}", outcome="success"))
    await db.commit()
    return _out(row)
