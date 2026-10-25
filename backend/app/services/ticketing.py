"""Advanced Ticketing domain logic: AI-assisted classification/prioritization,
SLA timers + breach prediction + escalation, duplicate correlation, hash-chained
audit trail, evidence vault and approval workflows.

The "AI" here is a deterministic rules engine standing in for the production ML
model — same input contract, same output shape, so swapping in a real model only
touches `classify()`.
"""
import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import Ticket, TicketAuditEntry, TicketEvidence, TicketApproval, Organization


# --------------------------------------------------------------------------
# SLA policy matrix (minutes) — response / resolution per priority
# --------------------------------------------------------------------------
SLA_POLICY = {
    "p1": {"response": 15,  "resolution": 240},    # 4h
    "p2": {"response": 60,  "resolution": 1440},   # 24h
    "p3": {"response": 240, "resolution": 4320},   # 3d
    "p4": {"response": 480, "resolution": 10080},  # 7d
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def apply_sla(ticket: Ticket) -> None:
    """Set SLA due dates from the priority policy."""
    pol = SLA_POLICY.get(ticket.priority, SLA_POLICY["p3"])
    base = ticket.created_at or now_utc()
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    ticket.sla_response_minutes = pol["response"]
    ticket.sla_resolution_minutes = pol["resolution"]
    ticket.due_response_at = base + timedelta(minutes=pol["response"])
    ticket.due_resolve_at = base + timedelta(minutes=pol["resolution"])


def sla_state(ticket: Ticket) -> str:
    """on_track | at_risk | breached | met — computed live, never stored."""
    now = now_utc()
    resolved = ticket.status in ("resolved", "closed")

    def _state(due: Optional[datetime], done_at: Optional[datetime]) -> str:
        if due is None:
            return "met" if resolved else "on_track"
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        if done_at:
            if done_at.tzinfo is None:
                done_at = done_at.replace(tzinfo=timezone.utc)
            return "met" if done_at <= due else "breached"
        if resolved:
            return "met"
        if now > due:
            return "breached"
        remaining = (due - now).total_seconds() / 60
        total = max(1, (due - (ticket.created_at or now)).total_seconds() / 60)
        return "at_risk" if remaining / total < 0.25 else "on_track"

    resp = _state(ticket.due_response_at, ticket.first_response_at)
    reso = _state(ticket.due_resolve_at, ticket.resolved_at)
    worst = ["met", "on_track", "at_risk", "breached"]
    return max([resp, reso], key=worst.index)


def breach_prediction(ticket: Ticket) -> dict:
    """Predict whether the resolution SLA will be breached, based on current
    age vs elapsed progress. Deterministic stand-in for the regression model."""
    if ticket.status in ("resolved", "closed") or not ticket.due_resolve_at:
        return {"will_breach": False, "probability": 0, "reason": "Ticket closed or no SLA"}
    due = ticket.due_resolve_at
    if due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    created = ticket.created_at or due - timedelta(hours=1)
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    total = max(1.0, (due - created).total_seconds())
    elapsed_frac = min(1.5, max(0.0, (now_utc() - created).total_seconds() / total))
    # logistic-ish curve around elapsed ratio; unassigned tickets are riskier
    prob = round(min(99, max(1, 100 / (1 + pow(2.71828, -8 * (elapsed_frac - 0.75))))), 1)
    if not ticket.assignee:
        prob = min(99, prob + 15)
    return {
        "will_breach": prob >= 60,
        "probability": prob,
        "time_remaining_minutes": max(0, int((due - now_utc()).total_seconds() // 60)),
        "reason": "No assignee — stalled queue risk" if not ticket.assignee else "Age vs SLA window",
    }


ESCALATION_LADDER = [
    "Team lead notified",
    "Client admin notified",
    "Platform NOC manager paged",
]


async def run_escalations(db: AsyncSession) -> list[str]:
    """Background pass: escalate tickets that breached their response SLA."""
    escalated: list[str] = []
    result = await db.execute(
        select(Ticket).where(Ticket.status.notin_(["resolved", "closed"]))
    )
    for t in result.scalars().all():
        if t.due_response_at and not t.first_response_at:
            due = t.due_response_at
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
            if now_utc() > due:
                overdue_min = (now_utc() - due).total_seconds() / 60
                target_level = min(len(ESCALATION_LADDER), 1 + int(overdue_min // 30))
                while t.escalation_level < target_level:
                    t.escalation_level += 1
                    if t.status not in ("escalated", "awaiting_approval"):
                        t.status = "escalated"
                    await append_audit(
                        db, t.uid, actor="system",
                        action=f"escalation_L{t.escalation_level}",
                        detail=ESCALATION_LADDER[t.escalation_level - 1],
                    )
                    escalated.append(f"{t.uid}:L{t.escalation_level}")
    await db.commit()
    return escalated


# --------------------------------------------------------------------------
# AI-assisted classification & prioritization (rules engine stand-in)
# --------------------------------------------------------------------------
_KEYWORDS = [
    (r"ransom|encrypt(ed|ion)? attack|lockbit|blackcat", "incident", "malware/ransomware", "p1",
     "Ransomware indicators detected in text"),
    (r"phishing|credential harvest|spoofed email", "incident", "email/phishing", "p2",
     "Phishing campaign signatures present"),
    (r"breach|exfiltrat|data theft|stolen", "incident", "data-exfiltration", "p1",
     "Data-breach language with high business impact"),
    (r"cve-\d{4}-\d+|vulnerab|exploit|zero.?day", "vulnerability", "patching", "p2",
     "Vulnerability reference found — track CVE to remediation"),
    (r"down|outage|unreachable|offline|latency|packet loss", "incident", "availability", "p2",
     "Availability degradation pattern"),
    (r"firewall|vpn|dns|network|vlan|switch|router|snmp", "service_request", "network", "p3",
     "Network configuration request"),
    (r"backup|restore|snapshot|retention", "problem", "backup-dr", "p3",
     "Backup/DR related issue"),
    (r"password|account lock|mfa|access request", "service_request", "identity", "p4",
     "Identity/service-desk request"),
]


def classify(title: str, description: str = "", severity_hint: str = "") -> dict:
    blob = f"{title} {description}".lower()
    for pattern, category, subcategory, priority, reason in _KEYWORDS:
        m = re.search(pattern, blob)
        if m:
            conf = 82 + (len(m.group(0)) % 12)
            if severity_hint == "critical":
                priority = "p1"
            elif severity_hint == "high" and priority in ("p3", "p4"):
                priority = "p2"
            return {
                "ai_category": category,
                "ai_subcategory": subcategory,
                "ai_priority": priority,
                "ai_confidence": min(97, conf),
                "ai_reasoning": [reason, f"Matched keyword '{m.group(0)}'", f"Model v2026.10-rules"],
                "ai_predicted_root_cause": subcategory.replace("/", " → "),
            }
    return {
        "ai_category": "other",
        "ai_subcategory": "general",
        "ai_priority": "p3",
        "ai_confidence": 55,
        "ai_reasoning": ["No strong signature matched — routed to manual triage"],
        "ai_predicted_root_cause": "unknown",
    }


async def find_duplicate(db: AsyncSession, org_id: int, title: str, asset: Optional[str]) -> Optional[str]:
    """Duplicate incident correlation via normalized-title fingerprint."""
    norm = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
    tokens = set(norm.split())
    result = await db.execute(select(Ticket).where(Ticket.org_id == org_id))
    best_uid, best_score = None, 0.0
    for t in result.scalars().all():
        t_tokens = set(re.sub(r"[^a-z0-9]+", " ", t.title.lower()).strip().split())
        if not t_tokens:
            continue
        jaccard = len(tokens & t_tokens) / len(tokens | t_tokens)
        score = jaccard + (0.15 if (asset and t.asset == asset) else 0)
        if score > best_score:
            best_uid, best_score = t.uid, score
    return best_uid if best_score >= 0.65 else None


async def next_ticket_uid(db: AsyncSession) -> str:
    count = len((await db.execute(select(Ticket.id))).scalars().all())
    return f"TCK-{count + 1:06d}"


# --------------------------------------------------------------------------
# Hash-chained audit history (tamper-evident)
# --------------------------------------------------------------------------
def _entry_hash(seq: int, at: str, actor: str, action: str, detail: str, prev_hash: str) -> str:
    payload = f"{seq}|{at}|{actor}|{action}|{detail}|{prev_hash}"
    return hashlib.sha256(payload.encode()).hexdigest()[:24]


async def append_audit(db: AsyncSession, ticket_uid: str, actor: str, action: str, detail: str) -> TicketAuditEntry:
    last = (await db.execute(
        select(TicketAuditEntry)
        .where(TicketAuditEntry.ticket_uid == ticket_uid)
        .order_by(TicketAuditEntry.seq.desc())
        .limit(1)
    )).scalars().first()
    seq = (last.seq + 1) if last else 1
    prev_hash = last.entry_hash if last else "0" * 24
    at = now_utc().isoformat()
    entry = TicketAuditEntry(
        ticket_uid=ticket_uid, seq=seq, actor=actor, action=action,
        detail=detail, prev_hash=prev_hash,
        entry_hash=_entry_hash(seq, at, actor, action, detail, prev_hash),
    )
    entry.created_at = datetime.fromisoformat(at)
    db.add(entry)
    await db.flush()
    return entry


async def add_evidence(db: AsyncSession, ticket_uid: str, name: str, kind: str,
                       content: str, collected_by: str,
                       file_b64: str | None = None, mime_type: str | None = None) -> TicketEvidence:
    """Store text evidence or a base64 file attachment (image/PDF/config/txt).

    The SHA-256 fingerprint covers the actual bytes when a file is uploaded,
    otherwise the pasted text — integrity checks work for both flavours.
    """
    import base64 as _b64
    blob_bytes = b""
    if file_b64:
        try:
            blob_bytes = _b64.b64decode(file_b64, validate=False)
        except Exception:
            blob_bytes = b""
    payload_for_hash = blob_bytes if blob_bytes else content.encode()
    sha = hashlib.sha256(payload_for_hash).hexdigest()
    size_kb = max(1, (len(blob_bytes) if blob_bytes else len(content)) // 1024)
    ev = TicketEvidence(
        ticket_uid=ticket_uid, name=name, kind=kind, content=content,
        file_blob=file_b64 if blob_bytes else None, mime_type=mime_type,
        size_kb=size_kb, sha256=sha,
        collected_by=collected_by, immutable=True,
    )
    db.add(ev)
    await db.flush()
    return ev


async def create_ticket(
    db: AsyncSession, *, org_id: int, title: str, description: str = "",
    priority: str = "p3", category: str = "other", source: str = "manual",
    assignee: Optional[str] = None, reporter: Optional[str] = None,
    tags: Optional[list] = None, asset: Optional[str] = None,
    vulnerability_ref: Optional[str] = None, alert_id: Optional[int] = None,
    auto_ai: bool = True,
) -> Ticket:
    """Create a ticket with AI triage, dedup correlation, SLA clocks and an
    initial chained-audit entry. Used by both the UI form and alert automation."""
    uid = await next_ticket_uid(db)
    ai = classify(title, description) if auto_ai else {}
    dup = await find_duplicate(db, org_id, title, asset)

    ticket = Ticket(
        uid=uid, org_id=org_id, title=title, description=description,
        status="new", priority=priority, category=category or ai.get("ai_category", "other"),
        source=source, assignee=assignee, reporter=reporter,
        tags=tags or [], asset=asset, vulnerability_ref=vulnerability_ref,
        alert_id=alert_id,
        ai_category=ai.get("ai_category"), ai_priority=ai.get("ai_priority"),
        ai_confidence=ai.get("ai_confidence"), ai_reasoning=ai.get("ai_reasoning", []),
        ai_predicted_root_cause=ai.get("ai_predicted_root_cause"),
        duplicate_of=dup,
        created_at=now_utc(),
    )
    apply_sla(ticket)
    db.add(ticket)
    await db.flush()

    await append_audit(db, uid, actor=reporter or "system", action="created",
                       detail=f"Ticket created from {source}")
    if ai:
        await append_audit(db, uid, actor="ai-triage", action="classified",
                           detail=f"{ai['ai_category']}/{ai.get('ai_subcategory')} → {ai['ai_priority']} "
                                  f"(confidence {ai['ai_confidence']}%)")
    if dup:
        await append_audit(db, uid, actor="dedup-engine", action="duplicate_flagged",
                           detail=f"Correlated with {dup}")

    # snapshot of the intake data as immutable evidence
    await add_evidence(db, uid, "intake-snapshot.txt", "report",
                       f"title={title}\ndescription={description}\nasset={asset}\n"
                       f"priority={priority}\nsource={source}\ntags={tags}",
                       collected_by=reporter or "system")
    await db.commit()
    await db.refresh(ticket)
    return ticket


async def request_closure(db: AsyncSession, ticket: Ticket, actor: str, note: str) -> TicketApproval:
    """Evidence-based closure: requires at least one piece of evidence + approval step."""
    ev_count = len((await db.execute(
        select(TicketEvidence).where(TicketEvidence.ticket_uid == ticket.uid)
    )).scalars().all())
    if ev_count == 0:
        raise ValueError("Closure blocked: no evidence in vault (evidence-based closure policy)")
    ticket.status = "awaiting_approval"
    ticket.description = f"{ticket.description or ''}\n[closure-request] {note}".strip()
    approval = TicketApproval(ticket_uid=ticket.uid, step=1,
                              approver_role="client_admin", status="pending", note=note)
    db.add(approval)
    await append_audit(db, ticket.uid, actor=actor, action="closure_requested", detail=note)
    await db.commit()
    await db.refresh(approval)
    return approval


async def decide_approval(db: AsyncSession, ticket: Ticket, approval: TicketApproval,
                          approve: bool, actor: str, note: str = "") -> None:
    approval.status = "approved" if approve else "rejected"
    approval.decided_by = actor
    approval.decided_at = now_utc()
    approval.note = f"{approval.note} | decision: {note}" if note else approval.note
    if approve:
        ticket.status = "closed"
        ticket.resolved_at = now_utc()
        await append_audit(db, ticket.uid, actor=actor, action="approval_granted",
                           detail="Evidence-based closure approved")
    else:
        ticket.status = "in_progress"
        await append_audit(db, ticket.uid, actor=actor, action="approval_rejected",
                           detail=note or "Closure rejected — reopened")
    await db.commit()
