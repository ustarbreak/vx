"""Action guardrails for platform connector jobs.

Client operators may run non-dangerous actions. Dangerous actions require a
platform administrator and a distinct platform-administrator confirmer.
Dry-runs remain available to authenticated users. Protected assets are never
eligible for destructive actions.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

from app.models import User

DANGEROUS_ROLES = {"platform_admin"}
OPERATOR_ROLES = {"platform_admin", "client_admin", "partner_admin"}


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
            return GuardDecision(False, "dangerous actions require platform_admin role")
        if confirmer is None:
            return GuardDecision(False, "dangerous actions require four-eyes confirmation (confirmer_id)")
        if confirmer.id == user.id:
            return GuardDecision(False, "confirmer must be a different user (four-eyes)")
        if (getattr(confirmer, "role", "") or "") not in DANGEROUS_ROLES:
            return GuardDecision(False, "confirmer must hold platform_admin role")
    target = str(params.get("agent_id") or params.get("hostname") or params.get("target") or "")
    blocked = {a.strip() for a in (protected_assets or "").split(",") if a.strip()}
    if target and target in blocked:
        return GuardDecision(False, f"asset '{target}' is protected")
    return GuardDecision(True)
