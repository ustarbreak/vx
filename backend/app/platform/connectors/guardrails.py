"""Action guardrails (T2.5): RBAC, four-eyes for dangerous ops, dry-run,
protected assets, audit log — reusing soar.py's consequential-action gating
concepts and the AuditLog model already used in app/platform/router.py.

Rules:
- role in {admin, analyst} may run non-dangerous actions; only admin + a
  *different* confirming user may run dangerous ones (four-eyes), unless
  dry_run=true which anyone authenticated may do.
- protected asset ids (comma list in config['protected_assets']) refuse
  destructive actions outright.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

from app.models import User

DANGEROUS_ROLES = {"admin"}          # who may CONFIRM a dangerous action
OPERATOR_ROLES = {"admin", "analyst"}  # who may execute non-dangerous actions


@dataclass
class GuardDecision:
    allowed: bool
    reason: str = ""


def check(user: User, dangerous: bool, dry_run: bool, params: Dict[str, Any],
          confirmer: Optional[User] = None,
          protected_assets: str = "") -> GuardDecision:
    role = getattr(user, "role", "") or ""
    if dry_run:
        return GuardDecision(True, "dry-run always permitted for authenticated users")
    if role not in OPERATOR_ROLES:
        return GuardDecision(False, f"role '{role}' may not execute actions")
    if dangerous:
        if role not in DANGEROUS_ROLES:
            return GuardDecision(False, "dangerous actions require admin role")
        if confirmer is None:
            return GuardDecision(False, "dangerous actions require four-eyes confirmation (confirmer_id)")
        if confirmer.id == user.id:
            return GuardDecision(False, "confirmer must be a different user (four-eyes)")
        if (getattr(confirmer, "role", "") or "") not in DANGEROUS_ROLES:
            return GuardDecision(False, "confirmer must hold admin role")
    target = str(params.get("agent_id") or params.get("hostname") or params.get("target") or "")
    blocked = {a.strip() for a in (protected_assets or "").split(",") if a.strip()}
    if target and target in blocked:
        return GuardDecision(False, f"asset '{target}' is protected")
    return GuardDecision(True)
