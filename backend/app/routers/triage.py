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
from app.services.outcomes import (
    DISPOSITIONS, PRIORITY_CORRECTNESS, append_outcome_label, current_head_label_id,
    label_out, latest_labels,
)
from app.services.label_audit import label_quality_report
from app.services.baseline_eval import baseline_report
from app.services.ml_feasibility import assess_feasibility

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


# ============================================================================
# STAGE 6A — Structured outcome labeling (data collection only; scoring path
# untouched). Same tenancy + role rules as the override endpoint above.
# ============================================================================

class OutcomeLabelIn(BaseModel):
    disposition: str = Field(..., pattern=r"^(true_positive|false_positive|benign_duplicate|unknown)$")
    priority_correctness: str = Field(..., pattern=r"^(correct|too_high|too_low|unknown)$")
    rationale: Optional[str] = Field(None, max_length=2000)
    reviewer: Optional[str] = Field(None, max_length=200)
    supersedes_id: Optional[int] = None
    relabel_previous: bool = False


@router.post("/incidents/{uid}/outcome-label", status_code=201)
async def add_outcome_label(uid: str, body: OutcomeLabelIn,
                            user: User = Depends(get_current_user),
                            db=Depends(get_db)):
    """Append an immutable outcome label (or a correction when supersedes_id
    is given). client_user may NOT label (mirrors override/status rules);
    every write is tenant-checked via _get_incident and audit-logged."""
    if user.role == "client_user":
        raise HTTPException(403, "Only analysts/admins may record outcome labels")
    inc = await _get_incident(db, uid, user)
    if body.supersedes_id is not None and body.relabel_previous:
        raise HTTPException(422, "supersedes_id and relabel_previous are mutually exclusive")
    prev_head = None
    if body.supersedes_id is None and body.relabel_previous:
        # capture the pre-append head so audit can distinguish a reopen
        # relabel (head replaced) from a first-ever label
        prev_head = await current_head_label_id(db, inc.org_id, inc.uid)
    try:
        row = await append_outcome_label(
            db, inc, disposition=body.disposition,
            priority_correctness=body.priority_correctness,
            labeled_by=user.email, rationale=body.rationale,
            reviewer=body.reviewer, supersedes_id=body.supersedes_id,
            relabel_previous=body.relabel_previous)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))
    action = ("incident_outcome_label_corrected" if body.supersedes_id
              else "incident_outcome_label_added")
    await _audit(db, user, action, uid,
                 f"disposition={body.disposition} "
                 f"priority_correctness={body.priority_correctness} "
                 f"priority_at_label={row.priority_labeled_at}"
                 + (f" supersedes={body.supersedes_id}"
                    if body.supersedes_id else
                    (f" replaces_head={prev_head}" if prev_head else "")))
    await db.commit()
    return label_out(row)


@router.get("/incidents/{uid}/outcome-labels")
async def get_outcome_labels(uid: str, user: User = Depends(get_current_user),
                             db=Depends(get_db)):
    """Full immutable label history for one incident (newest first)."""
    inc = await _get_incident(db, uid, user)   # 404/403 tenancy gate
    rows = await latest_labels(db, uid)
    return {"incident_uid": uid,
            "latest": label_out(rows[0]) if rows else None,
            "history": [label_out(r) for r in rows],
            "vocabularies": {"disposition": list(DISPOSITIONS),
                             "priority_correctness": list(PRIORITY_CORRECTNESS)}}


# ============================================================================
# STAGE 6B — Data-quality audit over collected labels. READ-ONLY: no writes,
# no scoring changes, no ML. Tenancy mirrors the platform rule used by
# _get_incident: platform_admin sees a cross-tenant rollup; everyone else is
# hard-scoped to their own org (query param cannot widen scope).
# ============================================================================

@router.get("/labels/quality-report")
async def labels_quality_report(recent_days: int = 30,
                                user: User = Depends(get_current_user),
                                db=Depends(get_db)):
    """Measured label-corpus quality metrics for the caller's tenant
    (platform_admin: all tenants). Read-only aggregate; contains no PII."""
    if not 1 <= recent_days <= 3650:
        raise HTTPException(422, "recent_days must be between 1 and 3650")
    org_id = None if user.role == "platform_admin" else user.org_id
    return await label_quality_report(db, org_id=org_id, recent_days=recent_days)


# ============================================================================
# STAGE 6C — Rules-baseline evaluation over validated labels. READ-ONLY:
# computes precision/recall/F1/FPR + exact CIs from frozen at-labeling
# snapshots only (no post-outcome inputs). Same tenancy rule as above.
# No ML, no LLM, no scoring changes.
# ============================================================================

@router.get("/labels/baseline-report")
async def labels_baseline_report(window_days: Optional[int] = None,
                                 user: User = Depends(get_current_user),
                                 db=Depends(get_db)):
    """Measured rules-baseline metrics for the caller's tenant
    (platform_admin: all tenants). window_days optionally restricts to labels
    created in the recent N days (1..3650)."""
    if window_days is not None and not 1 <= window_days <= 3650:
        raise HTTPException(422, "window_days must be between 1 and 3650")
    org_id = None if user.role == "platform_admin" else user.org_id
    return await baseline_report(db, org_id=org_id, window_days=window_days)


# ============================================================================
# STAGE 6D — ML feasibility gate over validated labels. READ-ONLY assessment:
# computes measured readiness gates (volume/balance/diversity/time/noise/
# baseline-measurability/leakage-integrity) from live rows. No training, no
# ML runtime, no LLM, no scoring changes. Same tenancy rule as above.
# ============================================================================

@router.get("/labels/ml-feasibility")
async def labels_ml_feasibility(window_days: Optional[int] = None,
                                user: User = Depends(get_current_user),
                                db=Depends(get_db)):
    """Measured Stage 6D readiness verdict for the caller's tenant
    (platform_admin: all tenants). window_days optionally restricts the
    corpus to labels created in the recent N days (1..3650)."""
    if window_days is not None and not 1 <= window_days <= 3650:
        raise HTTPException(422, "window_days must be between 1 and 3650")
    org_id = None if user.role == "platform_admin" else user.org_id
    return await assess_feasibility(db, org_id=org_id, window_days=window_days)
