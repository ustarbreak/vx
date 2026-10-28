"""STAGE 5 — Rules-based triage API.

Endpoints (all authenticated, tenant-scoped):
  POST /api/triage/incidents/{uid}/evaluate   -> run deterministic scoring,
          append an immutable TriageEvaluation history row. NEVER mutates the
          incident (severity/status untouched — no autonomous suppression).
  GET  /api/triage/incidents/{uid}            -> latest evaluation + full history
  GET  /api/triage/policies                   -> versioned policies (read-only)
  POST /api/triage/incidents/{uid}/override   -> analyst override of a recorded
          evaluation (admin only; reason required; written into the frozen
          breakdown's override field + audit log — the rule score itself stays)

Safety invariants enforced here:
  * no ML/LLM path exists in this module (pure rules from app.services.triage)
  * critical incidents can never be de-prioritized below p1 by the engine
    (CS_CRITICAL_FLOOR in the scorer) and nothing here suppresses alerts
  * overrides require an explicit human actor + reason and are auditable
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.database import get_db
from app.core.security import get_current_user
from app.models import User, Incident, AuditLog, TriageEvaluation, TriagePolicy
from app.services.triage import (
    evaluate_incident, load_policy, record_override, TRIAGE_POLICY_VERSION,
)

router = APIRouter(prefix="/triage", tags=["Triage"])


async def _get_incident(db, uid: str, user: User) -> Incident:
    inc = (await db.execute(select(Incident).where(Incident.uid == uid))).scalars().first()
    if inc is None:
        raise HTTPException(404, "Incident not found")
    # same tenancy rule as routers/incidents.py:_get_incident (line 116):
    # platform_admin crosses tenants; everyone else is org-scoped.
    if user.role != "platform_admin" and inc.org_id != user.org_id:
        raise HTTPException(403, "Cross-tenant access denied")
    return inc


async def _audit(db, user: User, action: str, resource_id: str, details: str) -> None:
    """Same Stage-4 pattern as routers/incidents.py: add + immediate awaited
    flush so no deferred autoflush INSERT survives into sync code paths
    (MissingGreenlet guard); StaticPool cursor-drain respected (no refresh())."""
    db.add(AuditLog(actor_id=user.id, actor_name=user.email, actor_role=user.role,
                    org_id=user.org_id, action=action, resource="triage",
                    resource_id=resource_id, details=details, outcome="success"))
    await db.flush()


class OverrideIn(BaseModel):
    reason: str = Field(..., min_length=5, max_length=500)
    priority: Optional[str] = Field(None, pattern=r"^p[1-4]$")


@router.post("/incidents/{uid}/evaluate")
async def evaluate(uid: str, policy_version: str = TRIAGE_POLICY_VERSION,
                   user: User = Depends(get_current_user),
                   db=Depends(get_db)):
    inc = await _get_incident(db, uid, user)
    try:
        result = await evaluate_incident(db, inc, policy_version=policy_version,
                                         evaluator=user.email)
    except LookupError as e:
        raise HTTPException(404, str(e))
    await _audit(db, user, "incident_triaged", uid,
                 f"score={result['score']} priority={result['priority']} "
                 f"policy={result['policy_version']}")
    await db.commit()
    return result


@router.get("/incidents/{uid}")
async def get_evaluations(uid: str, user: User = Depends(get_current_user),
                          db=Depends(get_db)):
    inc = await _get_incident(db, uid, user)
    rows = (await db.execute(
        select(TriageEvaluation).where(TriageEvaluation.incident_uid == uid)
        .order_by(TriageEvaluation.id.desc()))).scalars().all()
    history = [{
        "id": r.id, "policy_version": r.policy_version, "score": r.score,
        "priority": r.priority, "confidence": r.confidence,
        "corroboration": r.corroboration, "reason_codes": r.reason_codes,
        "breakdown": r.breakdown, "evaluator": r.evaluator,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]
    return {"incident_uid": uid, "latest": history[0] if history else None,
            "history": history}


@router.get("/policies")
async def list_policies(user: User = Depends(get_current_user),
                        db=Depends(get_db)):
    rows = (await db.execute(select(TriagePolicy)
                             .order_by(TriagePolicy.policy_version))).scalars().all()
    return [{"policy_version": r.policy_version, "weights": r.weights,
             "bands": r.bands, "confidence_weights": r.confidence_weights,
             "created_at": r.created_at.isoformat() if r.created_at else None}
            for r in rows]


@router.post("/incidents/{uid}/override")
async def override(uid: str, body: OverrideIn,
                   user: User = Depends(get_current_user),
                   db=Depends(get_db)):
    # mirrors incidents router: client_user is read/evaluate-only; every
    # managing role (client_admin, MSP staff, platform_admin) may override.
    if user.role == "client_user":
        raise HTTPException(403, "Only analysts/admins may override triage results")
    inc = await _get_incident(db, uid, user)
    ev = (await db.execute(
        select(TriageEvaluation).where(TriageEvaluation.incident_uid == uid)
        .order_by(TriageEvaluation.id.desc()).limit(1))).scalars().first()
    if ev is None:
        raise HTTPException(409, "No triage evaluation to override — run evaluate first")
    ovr = await record_override(db, ev, actor=user.email, reason=body.reason,
                                priority=body.priority)
    await _audit(db, user, "triage_overridden", uid,
                 f"rule_priority={ev.score and _rule_priority(ev)} → "
                 f"{body.priority or 'unchanged'} reason='{body.reason}'")
    await db.commit()
    return {"incident_uid": uid, "evaluation_id": ev.id, "override": ovr,
            "score": ev.score, "priority": ev.priority}


def _rule_priority(ev: TriageEvaluation) -> str:
    bd = ev.breakdown or {}
    return bd.get("priority", ev.priority)
