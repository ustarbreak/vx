"""Infrastructure Graph + Endpoint Actions service.

Backs the client-admin "Infrastructure" page (force-directed graph with
pivot nodes) and the per-device action buttons (backup / remote access /
shutdown / isolate).

Honesty rules (same doctrine as routers/discovery.py):
  * Nodes come ONLY from persisted DiscoveredDevice rows; pivots come from
    real fields already stored on those rows (device_type, site/org, subnet
    derived from the row's own IP — never invented relationships).
  * Pivot counts are exact aggregates of persisted rows.
  * Edge list is minimal and truthful: tenant org -> site pivot -> device.
    We never draw a link between two devices unless a persisted relationship
    exists (there is none today), so no fake adjacency is fabricated.
  * Device "related items" (tickets / alerts / incidents / playbook runs /
    actions) are correlated by REAL identity strings (hostname or IP) against
    the columns that actually store them (Ticket.asset, Alert.resource,
    Incident.affected_assets, PlaybookRun.result_log). No match data -> the
    section reports null ("no data"), not zero.
  * Endpoint actions NEVER pretend to execute host commands. The platform has
    no shell channel to arbitrary endpoints. An action is durably recorded:
      - queued : an enrolled, online goinfra agent probe matches the device —
                 the collector picks the request up on its next policy poll.
      - manual : no agent channel — a P1 ticket is created for a technician.
    Both outcomes are audited in AuditLog.
"""
from __future__ import annotations

import ipaddress
import json
from typing import Optional

from sqlalchemy import select, or_, func, cast, String
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    DiscoveredDevice, Organization, AgentProbe, Alert, Ticket, Incident,
    PlaybookRun, Notification, DeviceAction, AuditLog, User,
)
from app.services.ticketing import create_ticket, now_utc

# ---------------------------------------------------------------------------
# UID allocation (atomic counter, same mechanism used for alerts)
# ---------------------------------------------------------------------------

async def _next_uid(db: AsyncSession, kind: str, prefix: str) -> str:
    from app.services import notifications as nv
    return await nv.allocate_uid(db, kind, prefix)


# ---------------------------------------------------------------------------
# Identity matching helpers — shared by detail + actions
# ---------------------------------------------------------------------------

def device_identity(dev: DiscoveredDevice) -> list[str]:
    """Real identity strings we can honestly correlate on."""
    return [c for c in (dev.hostname, dev.ip) if c]


async def find_probe(db: AsyncSession, dev: DiscoveredDevice) -> Optional[AgentProbe]:
    """Match a device row to an enrolled collector probe (ip first, then
    hostname) — identical rule to routers/discovery.device_detail."""
    probes = (await db.execute(
        select(AgentProbe).where(AgentProbe.org_id == dev.org_id)
    )).scalars().all()
    for p in probes:
        if dev.ip and p.ip == dev.ip:
            return p
    if dev.hostname:
        for p in probes:
            if p.hostname and p.hostname.lower() == dev.hostname.lower():
                return p
    return None


def _like_or(identity: list[str], column):
    conds = [column.like(f"%{term}%") for term in identity]
    return or_(*conds) if conds else None


# ---------------------------------------------------------------------------
# Related-items correlation
# ---------------------------------------------------------------------------

async def related_items(db: AsyncSession, dev: DiscoveredDevice) -> dict:
    """Everything genuinely linked to this device, grouped by engine."""
    ident = device_identity(dev)
    out: dict = {
        "identity": ident,
        "alerts": None, "open_alerts": None,
        "tickets": None, "incidents": None,
        "playbook_runs": None, "actions": None, "notifications": None,
    }
    if not ident:
        return out   # nothing to correlate on — honest nulls

    # --- Alerts (resource column stores hostname/IP) ------------------------
    a_stmt = select(Alert.uid, Alert.title, Alert.severity, Alert.status,
                    Alert.created_at).where(
        Alert.org_id == dev.org_id, _like_or(ident, Alert.resource)
    ).order_by(Alert.created_at.desc()).limit(50)
    arows = (await db.execute(a_stmt)).all()
    out["alerts"] = [
        {"uid": r[0], "title": r[1], "severity": r[2], "status": r[3],
         "created_at": r[4].isoformat() if r[4] else None} for r in arows]
    out["open_alerts"] = sum(1 for r in arows if r[3] == "active")

    # --- Tickets (asset column) ---------------------------------------------
    t_stmt = select(Ticket.uid, Ticket.title, Ticket.status, Ticket.priority,
                    Ticket.created_at).where(
        Ticket.org_id == dev.org_id, _like_or(ident, Ticket.asset)
    ).order_by(Ticket.created_at.desc()).limit(50)
    trows = (await db.execute(t_stmt)).all()
    out["tickets"] = [
        {"uid": r[0], "title": r[1], "status": r[2], "priority": r[3],
         "created_at": r[4].isoformat() if r[4] else None} for r in trows]

    # --- Incidents (affected_assets JSON contains hostname/IP) --------------
    i_stmt = select(Incident.uid, Incident.title, Incident.severity,
                    Incident.status, Incident.created_at).where(
        Incident.org_id == dev.org_id,
        cast(Incident.affected_assets, String).ilike(f"%{ident[0]}%")
    )
    if len(ident) > 1:
        i_stmt = select(Incident.uid, Incident.title, Incident.severity,
                        Incident.status, Incident.created_at).where(
            Incident.org_id == dev.org_id,
            or_(*[cast(Incident.affected_assets, String).ilike(f"%{t}%") for t in ident]))
    irows = (await db.execute(i_stmt.order_by(Incident.created_at.desc()).limit(50))).all()
    out["incidents"] = [
        {"uid": r[0], "title": r[1], "severity": r[2], "status": r[3],
         "created_at": r[4].isoformat() if r[4] else None} for r in irows]

    # --- Playbook runs whose redacted log references the device -------------
    p_stmt = select(PlaybookRun.uid, PlaybookRun.mode, PlaybookRun.status,
                    PlaybookRun.created_at).where(
        PlaybookRun.org_id == dev.org_id,
        _like_or(ident, cast(PlaybookRun.result_log, String)),
    ).order_by(PlaybookRun.created_at.desc()).limit(20)
    prows = (await db.execute(p_stmt)).all()
    out["playbook_runs"] = [
        {"uid": r[0], "mode": r[1], "status": r[2],
         "created_at": r[3].isoformat() if r[3] else None} for r in prows]

    # --- Endpoint actions ledger --------------------------------------------
    d_stmt = select(DeviceAction.uid, DeviceAction.action, DeviceAction.status,
                    DeviceAction.ticket_uid, DeviceAction.requested_by,
                    DeviceAction.created_at).where(
        DeviceAction.device_id == dev.id
    ).order_by(DeviceAction.created_at.desc()).limit(50)
    drows = (await db.execute(d_stmt)).all()
    out["actions"] = [
        {"uid": r[0], "action": r[1], "status": r[2], "ticket_uid": r[3],
         "requested_by": r[4],
         "created_at": r[5].isoformat() if r[5] else None} for r in drows]

    # --- Notifications triggered by those alerts ----------------------------
    alert_ids = [a["uid"] for a in out["alerts"] or []]
    n_count = None
    if arows:
        ids = [r[0] for r in arows]
        n_stmt = select(func.count(Notification.id)).where(
            Notification.org_id == dev.org_id,
            Notification.alert_id.in_(
                select(Alert.id).where(Alert.uid.in_(ids))
            ))
        n_count = (await db.execute(n_stmt)).scalar() or 0
    out["notifications"] = {"count": n_count, "alert_uids_ref": bool(alert_ids)}
    return out


# ---------------------------------------------------------------------------
# Infrastructure graph builder
# ---------------------------------------------------------------------------

def _subnet_of(ip: str) -> Optional[str]:
    """/24 pivot derived from the device's OWN persisted IP — a real,
    deterministic grouping key (not an invented relationship)."""
    try:
        net = ipaddress.ip_network(f"{ip}/24", strict=False)
        return str(net)
    except ValueError:
        return None


async def build_graph(db: AsyncSession, org_id: int, group_by: str = "type") -> dict:
    """Force-graph payload: tenant root, pivot nodes, device nodes.

    group_by: 'type' | 'site' | 'subnet' — all three pivots derive from
    persisted columns only.
    """
    devs = (await db.execute(
        select(DiscoveredDevice).where(DiscoveredDevice.org_id == org_id)
    )).scalars().all()
    org = (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalars().first()

    probes = (await db.execute(
        select(AgentProbe).where(AgentProbe.org_id == org_id)
    )).scalars().all()
    probe_by_ip = {p.ip: p for p in probes if p.ip}
    probe_by_host = {p.hostname.lower(): p for p in probes if p.hostname}

    def pivot_key(d: DiscoveredDevice) -> tuple[str, str, str]:
        if group_by == "site":
            return (f"site:{d.org_id}", org.name if org else f"Org {d.org_id}", "site")
        if group_by == "subnet":
            sub = _subnet_of(d.ip) or "unclassified"
            return (f"subnet:{sub}", sub, "subnet")
        t = d.device_type or "unknown"
        return (f"type:{t}", t, "type")

    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    root_id = f"org:{org_id}"
    nodes[root_id] = {
        "id": root_id, "label": (org.name if org else f"Tenant {org_id}"),
        "kind": "tenant", "count": len(devs),
    }
    monitored_count = 0
    for d in devs:
        p = probe_by_ip.get(d.ip) or (probe_by_host.get(d.hostname.lower()) if d.hostname else None)
        monitored = p is not None
        if monitored:
            monitored_count += 1
        pid, plabel, pklass = pivot_key(d)
        if pid not in nodes:
            nodes[pid] = {"id": pid, "label": plabel, "kind": f"pivot:{pklass}", "count": 0}
            edges.append({"source": root_id, "target": pid, "type": "contains"})
        nodes[pid]["count"] += 1
        did = f"device:{d.id}"
        nodes[did] = {
            "id": did, "label": d.hostname or d.ip, "kind": "device",
            "device_id": d.id, "ip": d.ip, "mac": d.mac,
            "device_type": d.device_type or "unknown",
            "os": d.os_guess, "snmp_match": bool(d.snmp_match),
            "imported": bool(d.imported), "is_probe": bool(getattr(d, "is_probe", False)),
            "monitored": monitored,
            "status": (p.status if monitored else "unmonitored"),
            "last_seen": (p.last_seen.isoformat() if monitored and p.last_seen else None),
            "open_ports": d.open_ports or [],
        }
        edges.append({"source": pid, "target": did, "type": "hosts"})

    return {
        "group_by": group_by,
        "nodes": list(nodes.values()),
        "edges": edges,
        "stats": {
            "devices": len(devs),
            "monitored": monitored_count,
            "snmp_verified": sum(1 for d in devs if d.snmp_match),
            "imported": sum(1 for d in devs if d.imported),
        },
    }


# ---------------------------------------------------------------------------
# Endpoint actions
# ---------------------------------------------------------------------------

DEVICE_ACTIONS = {"backup", "remote_access", "shutdown", "isolate"}

ACTION_LABELS = {
    "backup": "Backup snapshot",
    "remote_access": "Remote access session (smart screen)",
    "shutdown": "Graceful shutdown",
    "isolate": "Network isolation",
}

# Roles allowed to fire consequential endpoint actions. Analysts may still
# SIMULATE any action; execution requires one of these roles.
EXEC_ROLES = {"client_admin", "platform_admin", "technician"}
CONSEQUENTIAL_ACTIONS = {"shutdown", "isolate"}


async def request_action(db: AsyncSession, dev: DiscoveredDevice, user: User,
                         action: str, mode: str = "execute",
                         confirm: bool = False) -> dict:
    """Record an endpoint action honestly (see module docstring)."""
    if action not in DEVICE_ACTIONS:
        raise ValueError(f"Unknown action '{action}' (allowed: {', '.join(sorted(DEVICE_ACTIONS))})")

    role = getattr(user, "role", "") or ""
    actor = getattr(user, "email", "") or "system"

    base = {
        "action": action, "label": ACTION_LABELS[action], "mode": mode,
        "device_id": dev.id, "ip": dev.ip, "hostname": dev.hostname,
    }

    # ---- simulate: plan only, zero side effects, nothing persisted ---------
    if mode == "simulate":
        return {**base, "status": "simulated", "ticket_uid": None,
                "reason": "Simulation only — nothing was executed or recorded."}

    # ---- authorization gates ------------------------------------------------
    if role not in EXEC_ROLES:
        await _audit(db, user, dev, action, "blocked",
                     f"role '{role}' cannot execute endpoint actions")
        return {**base, "status": "blocked", "ticket_uid": None,
                "reason": f"Role '{role}' is not authorized to execute endpoint actions (requires: {', '.join(sorted(EXEC_ROLES))}). Ask an admin or use simulate mode."}
    if action in CONSEQUENTIAL_ACTIONS and not confirm:
        await _audit(db, user, dev, action, "blocked", "missing explicit confirmation")
        return {**base, "status": "blocked", "ticket_uid": None,
                "reason": f"'{ACTION_LABELS[action]}' is consequential: re-send with confirm=true after reviewing the impact."}

    probe = await find_probe(db, dev)
    ticket_uid = None
    if probe is not None:
        status, reason = "queued", (
            f"Enrolled agent '{probe.hostname}' matched this device; the request is "
            f"durable and will be delivered on the agent's next policy poll.")
    else:
        # No agent channel -> route to a human through the REAL ticketing engine.
        ticket_uid = await create_ticket(
            db,
            org_id=dev.org_id,
            title=f"[Endpoint action] {ACTION_LABELS[action]} — {dev.hostname or dev.ip}",
            description=(
                f"Requested by {actor} from the Infrastructure graph.\n"
                f"Device: {dev.hostname or ''} {dev.ip} ({dev.device_type or 'unknown'})\n"
                f"The device has no enrolled collector agent, so the platform cannot "
                f"deliver the command automatically. Perform it via your RMM/IPMI/"
                f"switch tooling and update this ticket."),
            priority="p1", category="incident", source="manual",
            asset=dev.hostname or dev.ip,
        )
        status, reason = "manual", (
            "No enrolled agent on this device — routed to a technician as ticket "
            f"{ticket_uid}.")

    ticket_uid = getattr(ticket_uid, "uid", ticket_uid)   # create_ticket returns a Ticket row

    uid = await _next_uid(db, "device_actions", "DVA")
    rec = DeviceAction(
        uid=uid, org_id=dev.org_id, device_id=dev.id, action=action,
        mode="execute", status=status, reason=reason,
        detail={"ip": dev.ip, "hostname": dev.hostname, "probe": probe.hostname if probe else None},
        ticket_uid=ticket_uid, requested_by=actor,
    )
    db.add(rec)
    await _audit(db, user, dev, action, "success", f"{uid}: {status}")
    await db.commit()
    return {**base, "uid": uid, "status": status, "ticket_uid": ticket_uid, "reason": reason}


async def _audit(db: AsyncSession, user: User, dev: DiscoveredDevice,
                 action: str, outcome: str, details: str) -> None:
    db.add(AuditLog(
        actor_id=getattr(user, "id", None),
        actor_name=getattr(user, "email", "system"),
        actor_role=getattr(user, "role", "unknown"),
        org_id=dev.org_id,
        action=f"device.{action}", resource="DiscoveredDevice",
        resource_id=str(dev.id), details=details, outcome=outcome,
    ))
