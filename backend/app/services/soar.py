"""SOAR execution engine — safe, allow-listed playbook steps.

Design rules (see the incident-response/SOAR brief):
  * NO arbitrary shell / command execution. Every step action must be one of
    the allow-listed types below; anything else fails validation at save time
    AND at run time (defense in depth).
  * Steps that would touch external systems (`block_ip`, `isolate_host`) are
    gated: they require an explicit `confirm=true` on the run request and a
    user role of client_admin/platform_admin, and they only ever call the
    EXISTING engines (ticketing, notifications) — never raw sockets/subprocess.
  * Three modes with clear separation:
      - preview   : pure static plan, nothing runs, no side effects
      - simulate  : walks the steps but performs zero side effects
      - execute   : real side-effects through existing internal services only
  * Consequential actions are recorded honestly: a step is marked `completed`
    only when the underlying engine call returned successfully; failures mark
    the step `failed` and remaining steps `skipped`.
  * Sensitive data (passphrases, tokens, IPs of credentials…) is redacted from
    every log line before persistence.
"""
from __future__ import annotations

import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Playbook, PlaybookRun

# ---------------------------------------------------------------------------
# Action allow-list — the ONLY step actions accepted by save/run endpoints.
# ---------------------------------------------------------------------------
SAFE_ACTIONS = {
    "wait":            {"consequential": False, "params": {"seconds": int}},
    "notify":          {"consequential": False, "params": {"channel": str, "message": str}},
    "create_ticket":   {"consequential": False, "params": {"title": str, "priority": str}},
    "add_evidence":    {"consequential": False, "params": {"name": str}},
    "snmp_query":      {"consequential": False, "params": {"target": str}},
    "snapshot":        {"consequential": False, "params": {"target": str}},
    "block_ip":        {"consequential": True,  "params": {"ip": str}},
    "isolate_host":    {"consequential": True,  "params": {"hostname": str}},
}

CONSEQUENTIAL_ACTIONS = {a for a, m in SAFE_ACTIONS.items() if m["consequential"]}

# param keys whose values must always be redacted in logs
_SECRET_KEY_RE = re.compile(r"(passphrase|password|secret|token|community|key)", re.I)
# secret-looking substrings inside free-text params (e.g. "community=public")
_SECRET_KV_RE = re.compile(
    r"((?:passphrase|password|secret|token|community|api[_-]?key)\s*[=:]\s*)(\S+)",
    re.I,
)


class StepValidationError(ValueError):
    """Raised when a playbook definition contains unknown/dangerous actions."""


def validate_steps(steps: list[dict]) -> list[dict]:
    """Validate a step list against the allow-list. Raises StepValidationError.

    Returns the normalized steps ([{name, action, params}]).
    """
    if not isinstance(steps, list):
        raise StepValidationError("steps must be a list")
    norm: list[dict] = []
    for i, s in enumerate(steps, start=1):
        if not isinstance(s, dict):
            raise StepValidationError(f"step {i}: must be an object")
        action = (s.get("action") or "").strip()
        name = (s.get("name") or "").strip()
        params = s.get("params") or {}
        if action not in SAFE_ACTIONS:
            raise StepValidationError(
                f"step {i}: action '{action}' is not allowed "
                f"(permitted: {', '.join(sorted(SAFE_ACTIONS))})"
            )
        if not name:
            raise StepValidationError(f"step {i}: 'name' is required")
        if not isinstance(params, dict):
            raise StepValidationError(f"step {i}: params must be an object")
        # bound wait times so a playbook can't wedge the executor
        if action == "wait":
            try:
                secs = int(params.get("seconds", 5))
            except (TypeError, ValueError):
                raise StepValidationError(f"step {i}: wait.seconds must be an integer")
            if not (0 <= secs <= 3600):
                raise StepValidationError(f"step {i}: wait.seconds must be between 0 and 3600")
            params = {**params, "seconds": secs}
        # basic shape checks on consequential params (no injection surface)
        if action == "block_ip":
            ip = str(params.get("ip", ""))
            if not re.fullmatch(r"(\d{1,3}\.){3}\d{1,3}", ip):
                raise StepValidationError(f"step {i}: block_ip requires a valid IPv4 'ip' param")
        norm.append({"name": name, "action": action, "params": params})
    if len(norm) > 50:
        raise StepValidationError("a playbook may contain at most 50 steps")
    return norm


def redact(value: Any) -> Any:
    """Recursively redact secret-looking values from any structure destined
    for a persisted/logged output."""
    if isinstance(value, dict):
        return {
            k: ("***REDACTED***" if _SECRET_KEY_RE.search(str(k)) else redact(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, str):
        return _SECRET_KV_RE.sub(r"\1***REDACTED***", value)
    return value


def has_consequential(steps: list[dict]) -> bool:
    return any(s.get("action") in CONSEQUENTIAL_ACTIONS for s in steps)


async def next_run_uid(db: AsyncSession) -> str:
    from sqlalchemy import select
    count = len((await db.execute(select(PlaybookRun.id))).scalars().all())
    return f"RUN-{count + 1:06d}"


async def next_playbook_uid(db: AsyncSession) -> str:
    from sqlalchemy import select
    count = len((await db.execute(select(Playbook.id))).scalars().all())
    return f"PBK-{count + 1:06d}"
