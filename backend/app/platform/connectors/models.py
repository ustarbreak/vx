"""Connector SDK canonical models (ADAPTED-PLAN T2.1).

Shapes mirror what the live engines already produce so providers can delegate
without translation layers:
- severity values match app/services/triage.py SEVERITY_ORDER
  (["info", "low", "medium", "high", "critical"]).
- org_id is the tenant key everywhere (owner decision #3; do NOT rename to
  tenant_id — "tenant" refers to the whole client admin page).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

# Same order/values as triage.SEVERITY_ORDER (backend/app/services/triage.py:47)
SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"]


class Severity(str, Enum):
    info = "info"
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"

    @classmethod
    def parse(cls, value: str) -> "Severity":
        v = (value or "medium").lower()
        return cls(v) if v in cls._value2member_map_ else cls.medium


class JobState(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    unsupported = "unsupported"  # honesty rule: capability not implemented
    blocked = "blocked"          # requires confirmation (four-eyes gating)
    dry_run = "dry_run"          # simulated; provider was not invoked


@dataclass
class Detection:
    """Canonical detection record (T2.1): EndpointAlert shape + MITRE + org_id."""

    id: str
    org_id: int
    service_id: str                     # catalog id, e.g. "endpoint-protection"
    title: str
    severity: Severity = Severity.medium
    source: str = ""                    # engine name, e.g. "wazuh"
    mitre_techniques: List[str] = field(default_factory=list)  # e.g. ["T1059"]
    hostname: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)
    timestamp: Optional[str] = None     # ISO-8601 UTC string


@dataclass
class ActionSpec:
    """One canonical action a provider supports (surfaced via /api/capabilities)."""

    name: str                           # canonical dotted name, e.g. "case.create"
    dangerous: bool = False             # four-eyes + dry-run enforced by guardrails
    description: str = ""
    params: List[str] = field(default_factory=list)


@dataclass
class ActionResult:
    state: JobState
    message: str = ""
    data: Optional[Dict[str, Any]] = None
    job_id: Optional[str] = None


def detection_from_endpoint_alert(payload: Dict[str, Any], org_id: int,
                                  service_id: str, source: str) -> Detection:
    """Adapt an existing EndpointAlert-shaped dict (schemas.py ~line 379) into
    the canonical Detection without touching the original model."""
    return Detection(
        id=str(payload.get("id", "")),
        org_id=org_id,
        service_id=service_id,
        title=str(payload.get("title") or payload.get("description") or ""),
        severity=Severity.parse(str(payload.get("severity", "medium"))),
        source=source,
        mitre_techniques=list(payload.get("mitre") or payload.get("mitre_techniques") or []),
        hostname=payload.get("hostname"),
        raw=payload,
        timestamp=str(payload.get("timestamp") or payload.get("created_at") or "") or None,
    )
