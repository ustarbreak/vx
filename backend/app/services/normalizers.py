"""Per-service normalizers: raw OSS engine payload -> platform record shape.

The frontend pages were built around a reference ("mock") structure — e.g. a
vulnerability row {id, cve, severity, title, device, cvssScore, status}.  In
real mode we want EXACTLY that structure, but fed by genuine records pulled
from the open-source engine.  Each function below maps one engine's native
JSON onto the platform shape and is defensive: unknown payloads return []
(the hook then shows the honest fallback badge instead of fake data).
"""
from __future__ import annotations

from typing import Any, Dict, List


def _s(v: Any, default: str = "") -> str:
    return str(v) if v is not None else default


# ---------------------------------------------------------------------------
def openvas(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Greenbone/OpenVAS GSA JSON: {'task': {...}, 'results': {'result': [...]}}."""
    rows: List[Dict[str, Any]] = []
    results = items if isinstance(items, list) else []
    # OpenVAS wraps everything in one big dict; unwrap if needed
    if len(results) == 1 and isinstance(results[0], dict) and "result" in results[0].get("results", {}):
        results = results[0]["results"]["result"]
    for i, r in enumerate(results):
        if not isinstance(r, dict):
            continue
        sev_raw = _s(r.get("severity", r.get("cvss", "")))
        try:
            score = float(sev_raw) if sev_raw else 0.0
        except ValueError:
            score = 0.0
        level = "critical" if score >= 9 else "high" if score >= 7 else "medium" if score >= 4 else "low"
        name = r.get("name") or r.get("title") or {}
        rows.append({
            "id": _s(r.get("id", f"VULN-{i + 1:03d}")),
            "cve": _s((r.get("nvt") or {}).get("cve") if isinstance(r.get("nvt"), dict) else r.get("cve", "")),
            "severity": level,
            "title": _s(name if isinstance(name, str) else name.get("value", "")),
            "device": _s(r.get("host", r.get("asset", ""))),
            "deviceIp": _s(r.get("host", "")),
            "status": "open",
            "discoveredAt": _s(r.get("creation_time", r.get("date", ""))),
            "cvssScore": score,
        })
    return rows


def wazuh_agents(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Wazuh manager /agents: {'data': [{'id','name','ip','status',...}]}."""
    rows = []
    for a in items:
        if not isinstance(a, dict):
            continue
        rows.append({
            "id": _s(a.get("id")),
            "name": _s(a.get("name")),
            "ip": _s(a.get("ip", a.get("registerIP", ""))),
            "status": "active" if _s(a.get("status")) == "active" else "inactive",
            "os": _s(a.get("os", {}).get("name") if isinstance(a.get("os"), dict) else a.get("os")),
            "version": _s(a.get("version", a.get("manager", ""))),
            "lastSeen": _s(a.get("last_keepalive", a.get("dateAdd", ""))),
        })
    return rows


def thehive_cases(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """TheHive /api/v1/query result rows -> incident shape."""
    sev_map = {6: "critical", 5: "high", 4: "high", 3: "medium", 2: "medium", 1: "low"}
    rows = []
    for c in items:
        if not isinstance(c, dict):
            continue
        rows.append({
            "id": _s(c.get("id", c.get("_id", ""))),
            "title": _s(c.get("title", c.get("summary", ""))),
            "severity": sev_map.get(c.get("severity"), _s(c.get("severity", "medium")).lower()),
            "status": {"Open": "open", "InProgress": "in_progress", "Closed": "resolved"}.get(
                _s(c.get("status")), _s(c.get("status", "open")).lower()),
            "assignee": _s(c.get("owner", "")),
            "createdAt": _s(c.get("createdAt", c.get("created", ""))),
            "source": _s(c.get("source", "TheHive")),
            "tags": c.get("tags", []) if isinstance(c.get("tags"), list) else [],
        })
    return rows


def n8n_workflows(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """n8n GET /api/v1/workflows -> {'data': [{id,name,active,...}]}."""
    rows = []
    for w in items:
        if not isinstance(w, dict):
            continue
        rows.append({
            "id": _s(w.get("id")),
            "name": _s(w.get("name")),
            "active": bool(w.get("active", False)),
            "status": "active" if w.get("active") else "paused",
            "createdAt": _s(w.get("createdAt", "")),
            "updatedAt": _s(w.get("updatedAt", "")),
            "nodes": len(w.get("nodes", [])) if isinstance(w.get("nodes"), list) else 0,
        })
    return rows


def netdata_devices(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """LibreNMS /api/v0/devices -> network-device shape used by NetworkPage."""
    rows = []
    for d in items:
        if not isinstance(d, dict):
            continue
        status = _s(d.get("status")).lower()
        rows.append({
            "id": _s(d.get("hostname", d.get("device_id", ""))),
            "name": _s(d.get("hostname", "")),
            "type": _s(d.get("type", d.get("hardware", "unknown"))),
            "ip": _s(d.get("ip", d.get("ipv4_addr", d.get("hostname", "")))),
            "uptime": _s(d.get("uptime", "")),
            "status": "online" if status in ("1", "true", "up") else "offline",
            "os": _s(d.get("os", "")),
        })
    return rows


def pihole_stats(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pi-hole FTL /api/stats/summary returns a dict, not a list — wrap it."""
    rows = []
    for s in items:
        if not isinstance(s, dict):
            continue
        fwd = s.get("forward", {}) if isinstance(s.get("forward"), dict) else {}
        blocked = s.get("blocked", {}) if isinstance(s.get("blocked"), dict) else {}
        total = int(fwd.get("all_queries", 0)) + int(blocked.get("all_queries", 0))
        rows.append({
            "id": "pihole-summary",
            "totalQueries": total,
            "blocked": int(blocked.get("all_queries", 0)),
            "allowed": int(fwd.get("all_queries", 0)),
            "percentBlocked": round(100 * int(blocked.get("all_queries", 0)) / total, 1) if total else 0.0,
            "uniqueDomains": int(s.get("domains", {}).get("unique", 0)) if isinstance(s.get("domains"), dict) else 0,
            "status": "enabled",
        })
    return rows


def opnsense_rules(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """OPNsense searchRule -> {'rows': [{seq,action,description,enabled,...}]}."""
    rows = []
    for r in items:
        if not isinstance(r, dict):
            continue
        rows.append({
            "id": _s(r.get("uuid", r.get("seq", ""))),
            "sequence": _s(r.get("seq", "")),
            "action": "block" if _s(r.get("action")).lower() == "drop" else "allow",
            "description": _s(r.get("description", "")),
            "enabled": _s(r.get("enabled")).lower() in ("1", "true"),
            "protocol": _s(r.get("protocol", "*")),
            "src": _s(r.get("source", {}).get("address") if isinstance(r.get("source"), dict) else r.get("src", "")),
            "dst": _s(r.get("destination", {}).get("address") if isinstance(r.get("destination"), dict) else r.get("dst", "")),
        })
    return rows


def glpi_tickets(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """GLPI /apirest.php/Ticket rows -> Advanced Ticketing shape."""
    status_map = {"incoming": "open", "assigned": "in_progress", "planned": "in_progress",
                  "solved": "resolved", "closed": "closed"}
    rows = []
    for t in items:
        if not isinstance(t, dict):
            continue
        rows.append({
            "id": _s(t.get("id")),
            "title": _s(t.get("name", t.get("title", ""))),
            "status": status_map.get(_s(t.get("status")).lower(), _s(t.get("status", "open")).lower()),
            "priority": _s(t.get("priority", "medium")).lower(),
            "requester": _s(t.get("users_recipient_name", t.get("requester", ""))),
            "assignee": _s(t.get("users_locations_name", t.get("assignee", ""))),
            "createdAt": _s(t.get("date_creation", t.get("createdAt", ""))),
            "updatedAt": _s(t.get("date_mod", t.get("updatedAt", ""))),
        })
    return rows


def restic_snapshots(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Restic/Borgmatic snapshot listing -> backup record shape."""
    rows = []
    for sn in items:
        if not isinstance(sn, dict):
            continue
        short_id = _s(sn.get("short_id", sn.get("snapshot", "")))
        rows.append({
            "id": short_id,
            "job": _s(sn.get("tag", sn.get("job", sn.get("hostname", "backup")))),
            "status": "success",
            "size": _s(sn.get("stats", {}).get("stored_size") if isinstance(sn.get("stats"), dict) else sn.get("size", "")),
            "time": _s(sn.get("time", sn.get("timestamp", ""))),
            "host": _s(sn.get("hostname", "")),
        })
    return rows


def grafana_dashboards(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    for d in items:
        if not isinstance(d, dict):
            continue
        rows.append({
            "id": _s(d.get("uid", d.get("id", ""))),
            "title": _s(d.get("title", d.get("name", ""))),
            "url": _s(d.get("url", "")),
            "tags": d.get("tags", []) if isinstance(d.get("tags"), list) else [],
            "updatedAt": _s(d.get("updatedAt", "")),
        })
    return rows


def fleet_hosts(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    for h in items:
        if not isinstance(h, dict):
            continue
        rows.append({
            "id": _s(h.get("id", h.get("hostname", ""))),
            "hostname": _s(h.get("hostname", "")),
            "platform": _s(h.get("platform", "")),
            "osVersion": _s(h.get("os_version", "")),
            "status": "online" if h.get("seen_time") else "offline",
            "ip": _s(h.get("primary_ip", "")),
        })
    return rows


def tailscale_devices(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    for d in items:
        if not isinstance(d, dict):
            continue
        rows.append({
            "id": _s(d.get("id", "")),
            "name": _s(d.get("name", d.get("hostname", ""))),
            "ip": _s((d.get("addresses") or [""])[0]),
            "status": "connected" if d.get("connected") else "disconnected",
            "os": _s(d.get("os", "")),
            "lastSeen": _s(d.get("last_seen", "")),
        })
    return rows


def rspamd_stats(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    for s in items:
        if not isinstance(s, dict):
            continue
        read = s.get("read_bytes", 0)
        rows.append({
            "id": "rspamd-stats",
            "scanned": int(s.get("messages_scanned", s.get("statfiles", 0)) or 0),
            "spam": int(s.get("spam_count", 0) or 0),
            "greylist": int(s.get("greylist_count", 0) or 0),
            "reject": int(s.get("reject_count", 0) or 0),
            "learned": int(s.get("learned", 0) or 0),
            "uptime": _s(s.get("uptime", "")),
        })
    return rows


def prowler_findings(service_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    sev_map = {"critical": "critical", "high": "high", "medium": "medium",
               "low": "low", "error": "high", "warning": "medium"}
    for f in items:
        if not isinstance(f, dict):
            continue
        rows.append({
            "id": _s(f.get("StatusResourceId", f.get("id", ""))),
            "check": _s(f.get("CheckId", f.get("check", ""))),
            "severity": sev_map.get(_s(f.get("Severity", "medium")).lower(), "medium"),
            "status": "pass" if _s(f.get("Status")).lower() == "pass" else "fail",
            "resource": _s(f.get("Resource", "")),
            "region": _s(f.get("Region", "")),
            "service": _s(f.get("Service", "")),
        })
    return rows


# service_id -> normalizer applied to connectors.fetch_live_records output
NORMALIZERS: Dict[str, Any] = {
    "vuln-scanning": openvas,
    "endpoint-protection": wazuh_agents,
    "compliance": wazuh_agents,          # Wazuh SCA reports ride the agent API
    "incident-response": thehive_cases,
    "soar": n8n_workflows,
    "network-monitoring": netdata_devices,
    "sd-wan": netdata_devices,
    "dns-filtering": pihole_stats,
    "firewall-mgmt": opnsense_rules,
    "advanced-ticketing": glpi_tickets,
    "backup-dr": restic_snapshots,
    "analytics": grafana_dashboards,
    "patch-management": fleet_hosts,
    "vpn-gateway": tailscale_devices,
    "email-security": rspamd_stats,
    "cloud-security": prowler_findings,
}


def normalize(service_id: str, result: Dict[str, Any]) -> Dict[str, Any]:
    """Apply the service's normalizer to a fetch_live_records() result."""
    fn = NORMALIZERS.get(service_id)
    if not fn or result.get("source") != "live":
        return result
    try:
        recs = fn(service_id, result.get("records", []))
    except Exception:  # noqa: BLE001 — never let a weird payload crash the route
        return {**result, "source": "error", "reason": "normalization_failed", "records": []}
    return {**result, "records": recs, "count": len(recs)}
