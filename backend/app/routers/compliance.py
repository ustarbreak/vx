"""Tenant-scoped, evidence-backed compliance control assessments.

This is a starter NIST CSF 2.0 register, not a claim that every framework
control is automatically monitored. Unassessed controls remain unassessed
until a client administrator records a status and evidence note.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user, require_role
from app.database import get_db
from app.models import AuditLog, ComplianceAssessment, User

router = APIRouter(prefix="/compliance", tags=["Compliance"])

FRAMEWORK = "NIST CSF 2.0"
CONTROL_CATALOG = [
    {"id": "ID.AM-1", "category": "ID", "category_name": "Identify", "title": "Physical asset inventory is maintained"},
    {"id": "ID.AM-2", "category": "ID", "category_name": "Identify", "title": "Software and service inventory is maintained"},
    {"id": "ID.RA-1", "category": "ID", "category_name": "Identify", "title": "Vulnerabilities are identified and recorded"},
    {"id": "PR.AA-1", "category": "PR", "category_name": "Protect", "title": "Identities and credentials are managed"},
    {"id": "PR.DS-1", "category": "PR", "category_name": "Protect", "title": "Data-at-rest protections are defined"},
    {"id": "PR.PS-1", "category": "PR", "category_name": "Protect", "title": "Platform security configuration is maintained"},
    {"id": "DE.CM-1", "category": "DE", "category_name": "Detect", "title": "Networks and services are monitored"},
    {"id": "DE.AE-2", "category": "DE", "category_name": "Detect", "title": "Potentially adverse events are analysed"},
    {"id": "RS.MI-1", "category": "RS", "category_name": "Respond", "title": "Incidents are contained"},
    {"id": "RS.AN-1", "category": "RS", "category_name": "Respond", "title": "Investigations support response and recovery"},
    {"id": "RC.RP-1", "category": "RC", "category_name": "Recover", "title": "Recovery plans are executed during incidents"},
    {"id": "RC.CO-1", "category": "RC", "category_name": "Recover", "title": "Recovery activities are communicated to stakeholders"},
]
VALID_STATUSES = {"not_assessed", "compliant", "partial", "non_compliant"}
STATUS_SCORE = {"compliant": 100, "partial": 50, "non_compliant": 0}


class AssessmentUpdate(BaseModel):
    status: str
    evidence: str = Field(default="", max_length=4000)


def _row_out(control: dict, row: ComplianceAssessment | None) -> dict:
    status = row.status if row else "not_assessed"
    return {
        **control,
        "framework": FRAMEWORK,
        "status": status,
        "score": STATUS_SCORE.get(status),
        "evidence": row.evidence if row else "",
        "assessed_by": row.assessed_by if row else None,
        "assessed_at": row.assessed_at.isoformat() if row and row.assessed_at else None,
    }


@router.get("/controls")
async def list_controls(current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    if current_user.org_id is None:
        raise HTTPException(403, "User has no tenant scope")
    rows = (await db.execute(select(ComplianceAssessment).where(
        ComplianceAssessment.org_id == current_user.org_id,
        ComplianceAssessment.framework == FRAMEWORK,
    ))).scalars().all()
    by_control = {row.control_id: row for row in rows}
    return [_row_out(control, by_control.get(control["id"])) for control in CONTROL_CATALOG]


@router.patch("/controls/{control_id}")
async def update_control(control_id: str, body: AssessmentUpdate,
                         current_user: User = Depends(require_role("client_admin")),
                         db: AsyncSession = Depends(get_db)):
    if current_user.org_id is None:
        raise HTTPException(403, "User has no tenant scope")
    control = next((item for item in CONTROL_CATALOG if item["id"] == control_id), None)
    if not control:
        raise HTTPException(404, "Unknown NIST CSF 2.0 control")
    if body.status not in VALID_STATUSES:
        raise HTTPException(422, "Unsupported assessment status")
    evidence = body.evidence.strip()
    if body.status != "not_assessed" and not evidence:
        raise HTTPException(422, "Evidence note is required for an assessed control")

    row = (await db.execute(select(ComplianceAssessment).where(
        ComplianceAssessment.org_id == current_user.org_id,
        ComplianceAssessment.framework == FRAMEWORK,
        ComplianceAssessment.control_id == control_id,
    ))).scalars().first()
    if row is None:
        row = ComplianceAssessment(
            org_id=current_user.org_id, framework=FRAMEWORK, control_id=control_id,
        )
        db.add(row)
    row.status = body.status
    row.evidence = evidence or None
    row.assessed_by = current_user.email if body.status != "not_assessed" else None
    row.assessed_at = datetime.now(timezone.utc) if body.status != "not_assessed" else None

    db.add(AuditLog(
        actor_id=current_user.id, actor_name=current_user.email,
        actor_role=current_user.role, org_id=current_user.org_id,
        action="compliance.control_assessed", resource="ComplianceAssessment",
        resource_id=control_id,
        details="status=" + body.status + "; evidence_note_present=" + str(bool(evidence)),
        outcome="success",
    ))
    await db.commit()
    await db.refresh(row)
    return _row_out(control, row)
