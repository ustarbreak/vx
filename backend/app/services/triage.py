"""STAGE 5 — Rules-based triage scoring.

Deterministic 0-100 priority scoring for incidents. NO trained ML, NO external
LLMs: the score is a pure function of (incident fields, evidence counts,
recurrence lineage, active policy). Same inputs -> same score, byte-for-byte.

Design contract (approved Stage 5 review):
  * source severity          -> incident.severity, NEVER rewritten by scoring
  * calculated priority      -> p1|p2|p3|p4 derived from the score bands below
  * confidence               -> data-quality signal (how much input data was
                                available), NOT a probability of correctness
  * corroboration            -> independent-signal support (distinct alert
                                sources + linked tickets) feeding both the
                                score and its own reported number
  * recurrence               -> episode lineage (episode_number > 1 /
                                recurrence_of_uid set) — Stage 4 fields
  * recommended action       -> advisory text ONLY. Scoring never suppresses
                                alerts, never changes status/severity, never
                                executes response actions. An analyst override
                                is required to deviate, and every evaluation
                                is written to an immutable audit history row.

Missing-data behavior: unknown/absent inputs contribute ZERO points and emit
an explicit reason code (MD_*); they are never guessed at and never treated as
"low risk". A critical-severity safeguard floors every critical incident at 90
(CS_CRITICAL_FLOOR) so deterministic rules can never de-prioritize a critical.

Policy versioning: weights/bands live in TriagePolicy rows keyed by
`policy_version`. Changing any weight or band means INSERTING a new version —
old evaluations keep referencing their frozen version string, so historical
scores remain reproducible. The seed default (v1) mirrors DEFAULT_POLICY
exactly; tests that create tables directly (no seed) fall back to DEFAULT_POLICY
and assert parity with the seeded v1 row.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Alert, Incident, TriagePolicy, TriageEvaluation

TRIAGE_POLICY_VERSION = "v1"

SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"]

# ---------------------------------------------------------------------------
# Default v1 policy — declarative weights (points per condition met)
# ---------------------------------------------------------------------------
DEFAULT_WEIGHTS = {
    "sev_critical": 40,
    "sev_high": 30,
    "sev_medium": 20,
    "sev_low": 10,
    "sev_info": 5,
    "corroboration_source": 8,        # per DISTINCT alert source beyond the first
    "corroboration_ticket": 6,        # linked ticket present
    "volume_step_5": 4,               # correlated_count >= 5
    "volume_step_20": 8,              # correlated_count >= 20 (replaces, not adds)
    "recurrence": 10,                 # episode_number > 1 (or recurrence_of_uid set)
    "asset_impact": 5,                # affected_assets non-empty
    "ioc_related": 7,                 # threat-intel IOCs attached
}

# Bands: inclusive lower bound -> priority label. Score < lowest bound -> p4.
DEFAULT_BANDS = [{"min_score": 90, "priority": "p1"},
                 {"min_score": 70, "priority": "p2"},
                 {"min_score": 40, "priority": "p3"}]

# Confidence weights (data quality — how much input was actually available)
DEFAULT_CONFIDENCE = {
    "resource": 20, "description": 15, "dedup_key": 15,
    "category_known": 15, "assignee": 15, "alert_linked": 20,
}

CRITICAL_FLOOR = 90


# ---------------------------------------------------------------------------
# Pure scoring core — no DB access, trivially deterministic & unit-testable
# ---------------------------------------------------------------------------
def compute_triage(inc: dict, *, counts: dict, policy: dict) -> dict:
    """Pure function. `inc` holds plain values (severity, category, assignee,
    resource, description, dedup_key, ticket_uid, affected_assets, ioc_related,
    episode_number, recurrence_of_uid, status). `counts` holds corroboration
    aggregates computed by the caller (source_count, correlated_count).
    Returns the full evaluation payload."""
    w = policy["weights"]
    reasons: list[dict] = []
    total = 0

    def add(code: str, pts: int, detail: str) -> None:
        nonlocal total
        if pts <= 0:
            return
        total += pts
        reasons.append({"code": code, "points": pts, "detail": detail})

    sev = (inc.get("severity") or "").lower()
    if sev in ("critical", "high", "medium", "low", "info"):
        key = {"critical": "sev_critical", "high": "sev_high", "medium": "sev_medium",
               "low": "sev_low", "info": "sev_info"}[sev]
        add(f"SEV_{sev.upper()}", w[key], f"source severity '{sev}' base weight")
    else:
        reasons.append({"code": "MD_SEVERITY", "points": 0,
                        "detail": "severity missing/unknown — contributes 0, not guessed"})

    # ---- corroboration ----------------------------------------------------
    src = int(counts.get("source_count") or 0)
    corroboration = src
    if src >= 2:
        add("CORROBORATION_SOURCES", w["corroboration_source"] * (src - 1),
            f"{src} distinct alert sources corroborate this incident")
    elif src == 0:
        reasons.append({"code": "MD_SOURCES", "points": 0,
                        "detail": "no linked alert evidence — corroboration unknown"})
    if inc.get("ticket_uid"):
        corroboration += 1
        add("CORROBORATION_TICKET", w["corroboration_ticket"],
            f"linked ticket {inc['ticket_uid']}")

    # ---- volume -----------------------------------------------------------
    vol = int(counts.get("correlated_count") or 0)
    if vol >= 20:
        add("VOLUME_GE_20", w["volume_step_20"], f"correlated alert volume {vol} >= 20")
    elif vol >= 5:
        add("VOLUME_GE_5", w["volume_step_5"], f"correlated alert volume {vol} >= 5")

    # ---- recurrence (Stage 4 episode lineage) ------------------------------
    ep = int(inc.get("episode_number") or 1)
    if ep > 1 or inc.get("recurrence_of_uid"):
        add("RECURRENCE_EPISODE", w["recurrence"],
            f"episode #{ep}"
            + (f" recurring from {inc['recurrence_of_uid']}" if inc.get("recurrence_of_uid") else ""))

    # ---- impact context -----------------------------------------------------
    assets = [a for a in (inc.get("affected_assets") or []) if a]
    if assets:
        add("ASSET_IMPACT", w["asset_impact"], f"{len(assets)} affected asset(s)")
    else:
        reasons.append({"code": "MD_ASSETS", "points": 0,
                        "detail": "affected_assets empty — impact context unavailable"})
    iocs = [i for i in (inc.get("ioc_related") or []) if i]
    if iocs:
        add("IOC_RELATED", w["ioc_related"], f"{len(iocs)} threat-intel IOC(s) attached")

    # ---- bounds + critical safeguard ---------------------------------------
    bounded = max(0, min(100, total))
    suppressed = False
    floored = False
    if sev == "critical" and bounded < CRITICAL_FLOOR:
        bounded = CRITICAL_FLOOR
        floored = True
        reasons.append({"code": "CS_CRITICAL_FLOOR", "points": CRITICAL_FLOOR - total,
                        "detail": "critical-severity safeguard: score floored at 90 — "
                                  "rules may never de-prioritize a critical alert"})
    if total > 100:
        suppressed = True
        reasons.append({"code": "BOUND_CLAMP_HIGH", "points": -(total - 100),
                        "detail": f"raw {total} clamped to 100"})
    if total < 0:
        suppressed = True
        reasons.append({"code": "BOUND_CLAMP_LOW", "points": -total,
                        "detail": f"raw {total} clamped to 0"})

    # ---- priority band ------------------------------------------------------
    priority = "p4"
    for band in sorted(policy["bands"], key=lambda x: -int(x["min_score"])):
        if bounded >= int(band["min_score"]):
            priority = band["priority"]
            break
    reasons.append({"code": f"BAND_{priority.upper()}", "points": 0,
                    "detail": f"score {bounded} falls in band for {priority}"})

    # ---- confidence (data quality, separate axis) ----------------------------
    cw = policy["confidence_weights"]
    cat = (inc.get("category") or "other").lower()
    conf = 0
    if inc.get("resource"):
        conf += cw["resource"]
    if (inc.get("description") or "").strip():
        conf += cw["description"]
    if inc.get("dedup_key"):
        conf += cw["dedup_key"]
    if cat != "other":
        conf += cw["category_known"]
    if inc.get("assignee"):
        conf += cw["assignee"]
    if int(counts.get("alert_count") or 0) > 0:
        conf += cw["alert_link"] if "alert_link" in cw else cw["alert_linked"]
    confidence = max(0, min(100, conf))

    # ---- recommended action (ADVISORY ONLY — never executed here) ------------
    if sev == "critical":
        action = "page on-call immediately; begin containment assessment"
    elif priority == "p1":
        action = "assign senior analyst within 1h; consider containment"
    elif priority == "p2":
        action = "queue for analyst investigation next shift"
    elif priority == "p3":
        action = "review during business hours; enrich before closing"
    else:
        action = "monitor; close as false positive only after manual review"
    if floored:
        action = "CRITICAL SAFEGUARD: " + action

    return {
        "score": bounded,
        "raw_score": total,
        "priority": priority,
        "confidence": confidence,
        "corroboration": corroboration,
        "recommended_action": action,
        "reason_codes": reasons,
        "clamped": suppressed,
        "floored": floored,
    }


# ---------------------------------------------------------------------------
# Policy loading (versioned, cached per process)
# ---------------------------------------------------------------------------
_policy_cache: dict[str, dict] = {}


async def load_policy(db: AsyncSession, version: str = TRIAGE_POLICY_VERSION) -> dict:
    if version in _policy_cache:
        return _policy_cache[version]
    pol = (await db.execute(select(TriagePolicy).where(
        TriagePolicy.policy_version == version))).scalars().first()
    if pol is None:
        if version != TRIAGE_POLICY_VERSION:
            raise LookupError(f"triage policy {version} not found")
        pol = (await db.execute(select(TriagePolicy).where(
            TriagePolicy.policy_version == "v1"))).scalars().first()
    if pol is not None:
        p = {"policy_version": pol.policy_version, "weights": dict(pol.weights or {}),
             "bands": list(pol.bands or []),
             "confidence_weights": dict(pol.confidence_weights or {})}
    else:
        p = {"policy_version": TRIAGE_POLICY_VERSION, "weights": dict(DEFAULT_WEIGHTS),
             "bands": [dict(b) for b in DEFAULT_BANDS],
             "confidence_weights": dict(DEFAULT_CONFIDENCE)}
    _policy_cache[p["policy_version"]] = p
    return p


def clear_policy_cache() -> None:
    _policy_cache.clear()


# ---------------------------------------------------------------------------
# DB-facing entry point used by the router
# ---------------------------------------------------------------------------
async def evaluate_incident(db: AsyncSession, inc: Incident, *,
                            policy_version: str = TRIAGE_POLICY_VERSION,
                            evaluator: Optional[str] = None,
                            persist: bool = True) -> dict:
    """Compute the deterministic triage payload for one incident and (optionally)
    append it to the immutable audit history. This function NEVER mutates the
    incident: severity/status/suppression are out of scope by design."""
    policy = await load_policy(db, policy_version)

    linked = (await db.execute(
        select(Alert).where(Alert.incident_uid == inc.uid))).scalars().all()
    sources = {a.source for a in linked if a.source}
    correlated = sum(int(a.correlated_count or 1) for a in linked)

    snap = {
        "severity": inc.severity,
        "category": inc.category,
        "assignee": inc.assignee,
        "resource": None,  # incidents carry no single resource; MD handled via assets
        "description": inc.description,
        "dedup_key": inc.dedup_key,
        "ticket_uid": inc.ticket_uid,
        "affected_assets": list(inc.affected_assets or []),
        "ioc_related": list(inc.ioc_related or []),
        "episode_number": int(inc.episode_number or 1),
        "recurrence_of_uid": inc.recurrence_of_uid,
        "status": inc.status,
    }
    counts = {"source_count": len(sources), "correlated_count": correlated,
              "alert_count": len(linked)}
    result = compute_triage(snap, counts=counts, policy=policy)
    result.update({
        "incident_uid": inc.uid,
        "org_id": inc.org_id,
        "policy_version": policy["policy_version"],
        "evaluated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "evaluator": evaluator or "system",
        "override": None,
    })
    if persist:
        db.add(TriageEvaluation(
            org_id=inc.org_id, incident_uid=inc.uid,
            policy_version=policy["policy_version"],
            score=result["score"], priority=result["priority"],
            confidence=result["confidence"], corroboration=result["corroboration"],
            reason_codes=result["reason_codes"], breakdown=result,
            evaluator=result["evaluator"]))
        await db.flush()
    return result


async def record_override(db: AsyncSession, evaluation: TriageEvaluation, *,
                          actor: str, reason: str,
                          priority: Optional[str] = None,
                          score: Optional[int] = None) -> dict:
    """Analyst override — appended to the SAME immutable history row's
    breakdown (history rows are never edited/deleted). The override changes
    only the reported recommendation; it does not touch the incident itself."""
    ovr = {"by": actor, "reason": reason, "at":
           datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
           "priority": priority, "score": score}
    bd = dict(evaluation.breakdown or {})
    bd["override"] = ovr
    evaluation.breakdown = bd
    if priority:
        evaluation.priority = priority
    await db.flush()
    return ovr
