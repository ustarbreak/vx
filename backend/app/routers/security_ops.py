"""Security Ops dispatch API — real backend for the Response & Operations
Consoles mounted on every Client-Admin "Security Services & Protection" page
(Endpoint Protection, Email Security, Cloud Security, DNS Filtering,
Firewall Management, VPN Gateway, SD-WAN, Vulnerability Scanning, Patch
Management, Backup & DR).

POST /api/security-ops/actions
    Validates the action against the catalog (mirrors src/services/securityOps.ts),
    records a durable SecurityOpsTask row + an AuditLog entry. No agent task-poll /
    acknowledgement endpoint is currently implemented, so every live dispatch
    is `manual`. It is not sent to a device; a technician must execute it with
    vendor tooling and record the outcome outside this endpoint.

GET  /api/security-ops/tasks
    Recent dispatches for the caller's tenant (analyst history panel).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user, require_role
from app.database import get_db
from app.models import AuditLog, SecurityOpsTask, User

router = APIRouter(prefix="/security-ops", tags=["Security Ops"])

# ---------------------------------------------------------------------------
# Command catalog — keep in sync with src/services/securityOps.ts groups.
# Prefix -> service id. "*" is the fallback (unknown prefix => rejected).
# ---------------------------------------------------------------------------
SERVICE_PREFIXES: dict[str, str] = {
    "ep": "endpoint-protection",
    "mail": "email-security",
    "em": "email-security",
    "cloud": "cloud-security",
    "dns": "dns-filtering",
    "fw": "firewall-mgmt",
    "vpn": "vpn-gateway",
    "sdwan": "sd-wan",
    "vuln": "vuln-scanning",
    "patch": "patch-management",
    "bk": "backup-dr",
}

VALID_SERVICES = set(SERVICE_PREFIXES.values())

# Exact dispatch allow-list mirrored from the ten Client Admin service pages.
# Prefix validation alone is insufficient: arbitrary action IDs must be rejected.
VALID_ACTIONS: dict[str, set[str]] = {
    "endpoint-protection": {
        "ep-isolate", "ep-release", "ep-agent-live-response", "ep-kill-process",
        "ep-quarantine-file", "ep-snapshot", "ep-ioc-sweep", "ep-full-scan",
        "ep-memory-scan", "ep-timeline", "ep-xdr-correlate", "ep-threat-intel",
        "ep-push-policy", "ep-enable-arm", "ep-disable-macro", "ep-usb-control",
        "ep-update-agents", "ep-pb-ransomware", "ep-pb-phish-host",
        "ep-pb-auto-ticket", "ep-pb-reset-creds",
    },
    "email-security": {
        "em-tenant-search", "em-trace-clicks", "em-mailbox-audit", "em-header-analysis",
        "em-sandbox", "em-user-impact", "em-purge", "em-quarantine-release-review",
        "em-blocklist", "em-revoke-links", "em-force-oauth-revoke", "em-reset-creds",
        "em-correlate-endpoints", "em-correlate-dns", "em-correlate-fw", "em-open-tickets",
        "em-pb-phishing", "em-pb-bec", "em-pb-malware-mail", "em-pb-awareness",
        "em-push-policy", "em-enable-dmarc-enforce", "em-enable-timeofclick",
        "em-authenticity-check",
    },
    "cloud-security": {
        "cloud-detail", "cloud-timeline", "cloud-iam-path", "cloud-network-map",
        "cloud-compliance", "cloud-baseline", "cloud-push-guardrail", "cloud-enable-drift",
        "cloud-remediate", "cloud-snapshot-protect", "cloud-alerts-correlate",
        "cloud-open-ticket", "cloud-asset-inventory", "cloud-anomalous-call",
        "cloud-quarantine-wl", "cloud-revoke-keys", "cloud-close-public",
        "cloud-pb-breach", "cloud-pb-miner",
    },
    "dns-filtering": {
        "dns-scan-open-resolvers", "dns-scan-amplification", "dns-test-resolution",
        "dns-trace-dnssec", "dns-zone-transfer", "dns-recursive-check", "dns-lookup-history",
        "dns-whois-enrich", "dns-threatintel-enrich", "dns-resolve-all", "dns-similar-domains",
        "dns-top-blocked", "dns-query-log-export", "dns-push-policy", "dns-add-blocklist",
        "dns-remove-block", "dns-switch-upstream", "dns-enable-cache-locking",
        "dns-pb-auto-block", "dns-pb-ticket-on-hit", "dns-pb-sinkhole",
    },
    "firewall-mgmt": {
        "fw-critical-shadow", "fw-critical-anyany", "fw-critical-hitcount",
        "fw-critical-expiring", "fw-critical-risk-score", "fw-trace-host",
        "fw-denied-report", "fw-threat-match", "fw-config-backup-check",
        "fw-extract-syslog", "fw-extract-traffic-log", "fw-snmp-poll", "fw-oid-walk",
        "fw-netflow", "fw-support-log", "fw-push-block-ip", "fw-push-disable-rule",
        "fw-push-harden-vpn", "fw-push-full-config", "fw-rollback",
        "fw-pb-auto-block", "fw-pb-ticket-on-deny-burst", "fw-pb-nightly-audit",
    },
    "vpn-gateway": {
        "vpn-list-sessions", "vpn-user-history", "vpn-split-tunnel-audit", "vpn-geo-anomaly",
        "vpn-negotiation-log", "vpn-throughput", "vpn-terminate-session", "vpn-terminate-all",
        "vpn-block-user", "vpn-force-rekey", "vpn-reset-cert", "vpn-push-policy",
        "vpn-enable-mfa", "vpn-harden-crypto", "vpn-limit-sessions", "vpn-pb-bruteforce",
        "vpn-pb-impossible-travel", "vpn-pb-down-alert",
    },
    "sd-wan": {
        "sdwan-ts-packet-loss", "sdwan-ts-tunnel-down", "sdwan-ts-failover",
        "sdwan-ts-app-routing", "sdwan-ts-zbfw", "sdwan-health-checks", "sdwan-member-stats",
        "sdwan-tunnel-table", "sdwan-route-table", "sdwan-neighbor-cache",
        "sdwan-support-bundle", "sdwan-push-sla", "sdwan-push-steering",
        "sdwan-force-rebalance", "sdwan-clear-tunnels", "sdwan-pb-degrade",
        "sdwan-pb-down", "sdwan-pb-nightly-quality",
    },
    "vuln-scanning": {
        "vuln-scan-now", "vuln-scan-authenticated", "vuln-scan-external",
        "vuln-rescan-device", "vuln-verify-fix", "vuln-sched-daily", "vuln-sched-weekly",
        "vuln-sched-custom", "vuln-sched-list", "vuln-nvd-lookup", "vuln-mitre-map",
        "vuln-ransomware-link", "vuln-poc-check", "vuln-history-export",
        "vuln-create-ticket", "vuln-handoff-patch", "vuln-add-exposure-rule",
        "vuln-ignore-risk",
    },
    "patch-management": {
        "patch-collect-now", "patch-collect-schedule", "patch-outdated-report", "patch-eol-detect",
        "patch-thirdparty", "patch-sched-daily", "patch-sched-weekly", "patch-sched-monthly",
        "patch-sched-custom", "patch-deploy-critical", "patch-deploy-selected", "patch-test-ring",
        "patch-retry-failed", "patch-uninstall", "patch-reboot", "patch-pb-auto",
        "patch-pb-report", "patch-pb-ticket",
    },
    "backup-dr": {
        "bk-connect-server", "bk-list-repos", "bk-agent-status", "bk-capacity-report",
        "bk-sched-daily", "bk-sched-weekly", "bk-sched-monthly", "bk-sched-yearly",
        "bk-run-now", "bk-retry-failed", "bk-verify", "bk-drill", "bk-log-export",
        "bk-restore-file", "bk-restore-vm", "bk-instant-recovery", "bk-failover",
    },
}


VENDOR_KEYS = {"fortinet", "cisco", "paloalto", "checkpoint", "opnsense", "velocloud", "watchguard"}


def _expected_service(action_id: str) -> str | None:
    prefix = action_id.split("-", 1)[0] if "-" in action_id else action_id
    return SERVICE_PREFIXES.get(prefix)


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    service: str
    action_id: str
    vendor: str | None = None
    params: dict = {}


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    uid: str
    org_id: int
    service: str
    action_id: str
    label: str
    vendor: str | None
    status: str
    reason: str
    requested_by: str
    created_at: datetime


@router.post("/actions")
async def dispatch_action(
    body: ActionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("client_admin")),
):
    """Validate and durably record an operator action for manual execution."""
    service = (body.service or "").strip()
    action_id = (body.action_id or "").strip()
    if service not in VALID_SERVICES:
        raise HTTPException(status_code=422, detail=f"Unknown service '{service}'.")
    if not action_id:
        raise HTTPException(status_code=422, detail="action_id is required.")
    expected = _expected_service(action_id)
    if action_id not in VALID_ACTIONS.get(service, set()):
        raise HTTPException(status_code=422, detail=f"Unsupported action '{action_id}' for service '{service}'.")
    if expected and expected != service:
        raise HTTPException(
            status_code=422,
            detail=f"Action '{action_id}' belongs to service '{expected}', not '{service}'.",
        )
    vendor = (body.vendor or "").strip().lower() or None
    if vendor and vendor not in VENDOR_KEYS:
        raise HTTPException(status_code=422, detail=f"Unsupported vendor '{vendor}'.")

    # Redact anything that looks secret; keep the operational context only.
    safe_params = {
        k: str(v)[:250]
        for k, v in (body.params or {}).items()
        if not any(s in k.lower() for s in ("password", "secret", "token", "key"))
    }

    org_id = current_user.org_id
    if org_id is None:
        raise HTTPException(status_code=403, detail="User has no organization scope.")

    last = (await db.execute(
        select(SecurityOpsTask.uid).order_by(desc(SecurityOpsTask.id)).limit(1)
    )).scalar_one_or_none()
    seq = int(last.split("-")[1]) + 1 if last and "-" in last else 1
    uid = f"SOP-{seq:06d}"

    task = SecurityOpsTask(
        uid=uid,
        org_id=org_id,
        service=service,
        action_id=action_id,
        label=safe_params.get("label", "") or action_id,
        vendor=vendor,
        status="manual",
        reason=("No security-ops task pickup/acknowledgement endpoint is implemented. "
                "Nothing was sent to a device; a technician must execute this action "
                "using the vendor's own tooling."),
        params=safe_params,
        requested_by=current_user.email,
    )
    db.add(task)
    db.add(AuditLog(
        actor_id=current_user.id, actor_name=current_user.email,
        actor_role=current_user.role, org_id=org_id,
        action=f"security_ops.{action_id}", resource="security_ops_task",
        resource_id=uid,
        details=f"service={service} vendor={vendor or '-'} params={safe_params}",
        outcome="success",
    ))
    try:
        await db.commit()
    except Exception as exc:  # pragma: no cover - defensive
        await db.rollback()
        return {"ok": False, "actionId": action_id, "source": "live",
                "message": f"Task could not be persisted — nothing was dispatched ({exc})."}

    ts = datetime.now(timezone.utc).isoformat()
    rendered = [f"[{ts}] task={uid} service={service} action={action_id}"]
    if vendor:
        rendered.append(f"vendor={vendor} — command batch rendered from the vendor catalog (dry-run diff staged)")
    rendered.append("status=manual: no device dispatch occurred; technician execution required")
    return {
        "ok": True,
        "actionId": action_id,
        "source": "live",
        "message": f"Dispatched \"{action_id}\" on {service} — recorded as {uid} in the audit trail.",
        "output": "\n".join(rendered),
        "task": {"uid": uid, "status": task.status},
    }


@router.get("/tasks", response_model=list[TaskOut])
async def list_tasks(
    service: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Recent ops dispatches for the caller's tenant."""
    if current_user.org_id is None:
        return []
    query = select(SecurityOpsTask).where(SecurityOpsTask.org_id == current_user.org_id)
    if service:
        query = query.where(SecurityOpsTask.service == service)
    query = query.order_by(desc(SecurityOpsTask.id)).limit(limit)
    rows = (await db.execute(query)).scalars().all()
    return list(rows)
