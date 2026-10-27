"""Organizational Infrastructure Topology API — real org hierarchy + monitored fleet.

GET /api/org-topology serves the Dashboard's "organizational
infrastructure topology" section. It is deliberately SEPARATE from the
worldwide attack map (routers/security_map.py): this endpoint answers
"what does the customer's organization look like and is it healthy?",
never "where do attacks come from?".

Data sources (all existing, no new tables, no invented nodes):
  * Organizational hierarchy — Organization rows: parent_org_id links and
    org_type (HQ | SUBSIDIARY | AGENCY). The tenant root is the caller's
    organization; direct children are its registered branches/subsidiaries.
    A branch with no configured HQ flag is reported honestly via
    `hq_configured=false` — we never synthesize a headquarters node.
  * Technical layer — AgentProbe rows (enrolled goinfra collectors) grouped
    by org. Device health uses REAL status + last_seen timestamps only.
  * Related incidents — open Alerts per org (severity counts), same records
    the incident workspace already uses. No second source of truth.

Honesty rules enforced here:
  * Only sites that exist as Organization rows appear. No fabricated
    branches, sites or devices.
  * Health is derived from actual probe state/timestamps; an org with zero
    enrolled probes is "monitoring_unavailable", NOT "healthy".
  * Network connectivity between devices is intentionally NOT rendered:
    the schema has no device-to-device link table, so `network_topology_
    available` stays false and the frontend must say so explicitly.
    Sharing a subnet is never treated as a connection.
Tenancy: client roles are auto-scoped to their own org subtree; platform_admin
may target any org via org_id. Cross-tenant requests are rejected (403).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.security import get_current_user
from app.models import Alert, AgentProbe, Organization, User
from app.services.ticketing import now_utc

router = APIRouter(prefix="/org-topology", tags=["Org Topology"])

# Telemetry older than this is "stale"; beyond this "offline" (collector dead).
STALE_AFTER = timedelta(hours=24)
OFFLINE_AFTER = timedelta(days=7)


class TopoNode(BaseModel):
    id: str                     # "org:<pk>" or "probe:<pk>" — stable, prefixed
    kind: str                   # organization | site | hq | probe
    name: str
    parent: str | None          # organizational ownership ONLY (never inferred)
    org_ref: int                # owning organization id (authorization anchor)
    site_status: str | None = None      # organization.status when applicable
    org_type: str | None = None         # HQ | SUBSIDIARY | AGENCY
    country: str | None = None
    asset_count: int | None = None
    health: str | None = None   # healthy|degraded|offline|stale|monitoring_unavailable|unknown
    last_seen: datetime | None = None
    agent_version: str | None = None
    os: str | None = None
    ip: str | None = None       # internal address — only visible to authorized tenant
    related_incidents: int | None = None  # open alerts for the owning org


class OrgTopologyPayload(BaseModel):
    nodes: list[TopoNode]
    edges: list[dict]           # {source, target, type: "organizational"}
    root_org_id: int
    hq_configured: bool
    network_topology_available: bool = False
    note: str = ""
    generated_at: datetime


def _health(probe: AgentProbe, now: datetime) -> str:
    """Derive collector health from REAL status + timestamps only."""
    if not probe.last_seen:
        return "unknown" if probe.status == "online" else "offline"
    seen = probe.last_seen
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=timezone.utc)
    age = now - seen
    if probe.status != "online" or age > OFFLINE_AFTER:
        return "offline"
    if age > STALE_AFTER:
        return "stale"
    return "healthy"


@router.get("", response_model=OrgTopologyPayload)
@router.get("/", response_model=OrgTopologyPayload)
async def org_topology(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    org_id: int | None = Query(None, description="platform_admin only: target organization"),
):
    """Authenticated, tenant-scoped organizational topology (hierarchy + fleet)."""
    # ---- resolve the tenant root (authorization first) --------------------
    if current_user.role == "platform_admin":
        root_id = org_id if org_id is not None else current_user.org_id
        if root_id is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "platform_admin must pass org_id (no home organization)")
    else:
        if org_id is not None and org_id != current_user.org_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-tenant access denied")
        root_id = current_user.org_id
    if root_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Caller has no organization")

    root = await db.get(Organization, root_id)
    if root is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")

    # Registered direct children = branches/subsidiaries/agencies of the tenant.
    children = list((await db.execute(
        select(Organization).where(Organization.parent_org_id == root_id)
        .order_by(Organization.name)
    )).scalars().all())

    orgs = [root] + children
    org_ids = [o.id for o in orgs]

    # ---- real fleet + open incidents ---------------------------------------
    probes = list((await db.execute(
        select(AgentProbe).where(AgentProbe.org_id.in_(org_ids)).order_by(AgentProbe.hostname)
    )).scalars().all())

    recent_alerts = list((await db.execute(
        select(Alert).where(Alert.org_id.in_(org_ids),
                            Alert.created_at >= now_utc() - timedelta(days=30))
    )).scalars().all())
    open_by_org: dict[int, int] = {}
    for a in recent_alerts:
        raw = a.raw_payload if isinstance(a.raw_payload, dict) else {}
        if raw.get("resolved") or a.ticket_uid and a.severity in ("info", "low"):
            continue
        open_by_org[a.org_id] = open_by_org.get(a.org_id, 0) + 1

    now = datetime.now(timezone.utc)
    nodes: list[TopoNode] = []
    edges: list[dict] = []

    # ---- organization layer --------------------------------------------------
    # HQ flag: the tenant itself is HQ-type, or one of its children is marked HQ.
    hq_child = next((c for c in children if (c.org_type or "").upper() == "HQ"), None)
    hq_configured = (root.org_type or "").upper() == "HQ" or hq_child is not None

    root_kind = "hq" if (root.org_type or "").upper() == "HQ" else "organization"
    nodes.append(TopoNode(
        id=f"org:{root.id}", kind=root_kind, name=root.name, parent=None,
        org_ref=root.id, site_status=root.status, org_type=root.org_type,
        country=root.country, asset_count=root.asset_count,
        related_incidents=open_by_org.get(root.id, 0),
    ))
    for c in children:
        kind = "hq" if (c.org_type or "").upper() == "HQ" else "site"
        nodes.append(TopoNode(
            id=f"org:{c.id}", kind=kind, name=c.name, parent=f"org:{root.id}",
            org_ref=c.id, site_status=c.status, org_type=c.org_type,
            country=c.country, asset_count=c.asset_count,
            related_incidents=open_by_org.get(c.id, 0),
        ))
        edges.append({"source": f"org:{root.id}", "target": f"org:{c.id}",
                      "type": "organizational"})

    # ---- technical layer (real collectors only) ------------------------------
    probes_by_org: dict[int, list[AgentProbe]] = {}
    for p in probes:
        probes_by_org.setdefault(p.org_id, []).append(p)

    for o in orgs:
        plist = probes_by_org.get(o.id, [])
        if not plist:
            # Honest placeholder: monitoring is unavailable at this site —
            # NEVER promoted to "healthy" just because the site exists.
            nodes.append(TopoNode(
                id=f"monitoring:{o.id}", kind="probe",
                name="Monitoring unavailable at this site",
                parent=f"org:{o.id}", org_ref=o.id,
                health="monitoring_unavailable", related_incidents=0,
            ))
            edges.append({"source": f"org:{o.id}", "target": f"monitoring:{o.id}",
                          "type": "organizational"})
            continue
        for p in plist:
            nodes.append(TopoNode(
                id=f"probe:{p.id}", kind="probe", name=p.hostname,
                parent=f"org:{o.id}", org_ref=o.id,
                health=_health(p, now), last_seen=p.last_seen,
                agent_version=p.agent_version, os=p.os, ip=p.ip,
            ))
            edges.append({"source": f"org:{o.id}", "target": f"probe:{p.id}",
                          "type": "organizational"})

    degraded_sites = sum(1 for n in nodes if n.kind == "probe" and n.health in ("offline", "stale"))
    note_parts = [
        "Nodes come exclusively from registered organizations and enrolled "
        "collectors; nothing is synthesized.",
    ]
    if not hq_configured:
        note_parts.append("Headquarters is not configured for this organization.")
    if degraded_sites:
        note_parts.append(f"{degraded_sites} collector(s) offline or stale — see health badges.")
    note_parts.append(
        "Device-to-device network topology is unavailable: no relationship data "
        "exists, so only organizational ownership links are drawn."
    )

    return OrgTopologyPayload(
        nodes=nodes, edges=edges, root_org_id=root.id,
        hq_configured=hq_configured, network_topology_available=False,
        note=" ".join(note_parts), generated_at=now,
    )
