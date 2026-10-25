"""Demo dataset for the Advanced Reporting portal (Phase 1 skeleton).

Generates plausible, deterministic data for all 20 reports / 6 families /
62 pages. Deterministic = seeded by (tenant_id, period) so the same month
always shows the same numbers across reloads and between PDF/CSV/screen.

REAL DATA PLUG POINTS (marked with "PLUG:"):
  - alerts/incidents/playbook runs -> tables already live in Postgres
    (see app/routers/tickets.py, notifications, services connectors)
  - vulnerabilities/patches/backups/email/network/endpoint/uba/audit
    -> created in Phase 1 migrations; adapters fill them in Phase 2.
Nothing here is ever served when Demo Mode is OFF without an adapter —
the API returns the block with "Donnee indisponible" instead (brief §4).
"""
from __future__ import annotations

import hashlib
import random
from datetime import datetime, timezone


def _rng(tenant_id: str, period: str, salt: str = "") -> random.Random:
    h = hashlib.sha256(f"{tenant_id}|{period}|{salt}".encode()).hexdigest()
    return random.Random(int(h[:12], 16))


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


# ---------------------------------------------------------------- catalog ---
FAMILIES = [
    ("dir", "Direction & Value"),
    ("thr", "Threats & Detection"),
    ("inc", "Incidents & Response"),
    ("vul", "Vulnerabilities & Posture"),
    ("inf", "Infrastructure & Resilience"),
    ("com", "Compliance & Audit"),
]

# id, number, title, family, pages
REPORTS = [
    (1,  "executive",   "Executive Security Dashboard",              "dir", 5),
    (9,  "roi",         "Security ROI Calculator",                   "dir", 3),
    (19, "value",       "Client Value Report",                       "dir", 3),
    (2,  "threatintel", "Threat Intelligence Briefing",              "thr", 3),
    (11, "hunting",     "Threat Hunting Summary",                    "thr", 3),
    (17, "uba",         "User Behavior Analytics",                   "thr", 3),
    (14, "email",       "Email Security Report",                     "thr", 3),
    (3,  "incident",    "Incident Response Report",                  "inc", 3),
    (18, "soar",        "SOAR Automation Report",                    "inc", 3),
    (8,  "tickets",     "Ticket Operations Report",                  "inc", 3),
    (6,  "vuln",        "Vulnerability Management Report",           "vul", 3),
    (12, "patch",       "Patch Management Report",                   "vul", 3),
    (15, "cloud",       "Cloud Security Posture",                    "vul", 3),
    (5,  "infra",       "Infrastructure Health Report",              "inf", 3),
    (7,  "network",     "Network Performance Analytics",             "inf", 3),
    (13, "backup",      "Backup & DR Status",                        "inf", 3),
    (16, "endpoint",    "Endpoint Protection Report",                "inf", 3),
    (4,  "compliance",  "Compliance Status Report (NIST/SOC2/ISO)",  "com", 3),
    (20, "regulatory",  "Regulatory Compliance Report",              "com", 3),
    (10, "audit",       "Audit Trail Report",                        "com", 3),
]


def kpi_set(rnd: random.Random, defs) -> list:
    """defs: [(label, fmt, higher_is_good)]. Returns KPI rows with arrows."""
    out = []
    for label, fmt, good in defs:
        base = rnd.uniform(40, 96)
        delta = rnd.uniform(-9, 9)
        up = delta >= 0
        favorable = up == good
        arrow = "▲" if up else "▼"
        color = "o" if favorable else "b"
        val = fmt.format(value=round(base, 1))
        out.append([label, val, f"{arrow} {abs(delta):.1f}%", color])
    return out


# ------------------------------------------------------------- builders ----
def _download_center(rnd):
    rows = []
    for num, key, title, fam, pages in REPORTS:
        rows.append([str(num), title, fam, str(pages), "open"])
    return ["T", "Report catalogue", ["#", "Report", "Family", "Pages", "Actions"], rows]


def _b_executive(rnd, period):
    K = ["K", kpi_set(rnd, [
        ("Security Posture Score", "{value}/100", True),
        ("Critical Incidents", "{value:.0f}", False),
        ("MTTR (hours)", "{value:.1f}", False),
        ("Coverage", "{value:.0f}%", True),
    ])]
    G = ["G", "Global risk score", round(rnd.uniform(55, 85)), "o"]
    M = ["M", "Top actions this period", [
        ["Complete agent rollout on remaining 12 endpoints before end of month.", "w"],
        ["Review firewall rules exposed to the internet (3 legacy rules).", "b"],
        ["Validate backup restore test schedule — last run > 30 days ago.", "h"],
    ]]
    F = ["F", "SOC funnel", [
        ["Events collected", 100], ["Correlated", 38], ["Alerts raised", 12],
        ["Investigated", 9], ["Confirmed incidents", 3],
    ]]
    C = ["C", "Roadmap", [
        ["Now", ["Zero-trust pilot", "Agent completion"], "o"],
        ["Next", ["Detection tuning v2", "DR drill"], "1"],
        ["Later", ["Automation marketplace"], "3"],
    ]]
    P = ["P", "Sign-off", ["Prepared by", "Infracentra SOC", "Reviewed by", "Client CISO"]]
    dl = _download_center(rnd)
    return [
        ["Executive Summary", "One-page synthesis of security posture.", [K, G, M]],
        ["Detection & Response", "Funnel from raw events to confirmed incidents.", [F,
            ["T", "Top incident categories", ["Category", "Count", "Avg MTTR", "Trend"], [
                ["Phishing", "7", "3.2 h", "@crit:▲ rising"],
                ["Malware", "4", "5.1 h", "@high:= stable"],
                ["Data exfiltration attempt", "1", "8.4 h", "@low:▼ falling"],
            ]]]],
        ["Posture & Coverage", "Asset coverage and control status.", [
            ["R", [["Endpoint coverage", 88, "o"], ["Network visibility", 74, "w"], ["Cloud accounts monitored", 92, "o"]]],
            ["B", "Control maturity", [["Detect", 82, "o"], ["Respond", 67, "w"], ["Recover", 54, "b"], ["Govern", 71, "1"]]],
        ]],
        ["Action Plan", "Prioritised remediation roadmap.", [C, M, P]],
        ["Download Center", "All 20 reports grouped by family.", [dl]],
    ]


def _b_threatintel(rnd, period):
    return [
        ["Threat Landscape", "IoCs ingested and matched this period.", [
            ["K", kpi_set(rnd, [("IoCs ingested", "{value:.0f}", True), ("Matches on assets", "{value:.0f}", False), ("Blocked at perimeter", "{value:.0f}%", True)])],
            ["T", "Top IoC types", ["Type", "Count", "Severity"], [
                ["IP (C2)", f"{rnd.randint(30, 90)}", "@crit:Critical"],
                ["Domain (DGA)", f"{rnd.randint(20, 60)}", "@high:High"],
                ["URL (phishing)", f"{rnd.randint(40, 120)}", "@med:Medium"],
            ]],
        ]],
        ["Actor Activity", "Observed campaigns relevant to your sector.", [
            ["B", "Campaign prevalence", [["Sector threats", 34, "b"], ["Ransomware affiliates", 51, "h"], ["Financial fraud", 22, "w"]]],
            ["L", "Notable indicators", ["2 suspicious domains registered < 72h matching internal naming patterns", "1 IP previously linked to beaconing seen in auth logs"]],
        ]],
        ["Recommended Blocks", "Curated blocklist proposals.", [
            ["T", "Proposed entries", ["Indicator", "Source feed", "Confidence"], [
                ["45.155.205[.]", "Threat feed A", "@crit:98%"],
                ["evil-cdn-example[.]com", "Threat feed B", "@high:91%"],
            ]],
            ["M", "Note", [["Apply via Firewall Management service after review.", "1"]]],
        ]],
    ]


def _b_hunting(rnd, period):
    return [
        ["Hunting Overview", "Hypotheses worked this period.", [
            ["K", kpi_set(rnd, [("Hypotheses opened", "{value:.0f}", True), ("Validated findings", "{value:.0f}", False), ("Hours invested", "{value:.0f}", True)])],
            ["F", "Pipeline", [["Backlog", 100], ["In progress", 45], ["Validated", 20], ["Negative", 30]]],
        ]],
        ["Findings", "Validated hunting results.", [
            ["T", "Findings", ["ID", "Technique", "Status", "Impact"], [
                ["HUNT-014", "T1055 Process Injection", "@crit:Open", "2 hosts"],
                ["HUNT-012", "T1071 App Layer Protocol", "@low:Closed", "None"],
            ]],
        ]],
        ["Next Targets", "Queued hypotheses (human input, Phase 7).", [
            ["L", "Queue", ["Persistent scheduled tasks in user hives", "OAuth token abuse in SaaS logs", "Living-off-the-land binaries"]],
        ]],
    ]


def _b_uba(rnd, period):
    return [
        ["Behavior Baseline", "Anomaly scoring overview.", [
            ["K", kpi_set(rnd, [("Users profiled", "{value:.0f}", True), ("Anomalies flagged", "{value:.0f}", False), ("False positive rate", "{value:.0f}%", False)])],
            ["B", "Anomaly classes", [["Impossible travel", 18, "w"], ["Bulk download", 31, "b"], ["Off-hours access", 26, "1"], ["Privilege escalation", 9, "h"]]],
        ]],
        ["Risk Users", "Highest-scoring identities.", [
            ["T", "Users", ["User", "Score", "Signals", "State"], [
                ["user-a@client", "@crit:87", "Impossible travel + 4 GB export", "Under review"],
                ["user-b@client", "@med:54", "New admin role, no ticket", "Acknowledged"],
            ]],
        ]],
        ["Controls", "Privacy-preserving notes.", [
            ["M", "Data handling", [["Only technical identifiers are stored in the reporting DB — no raw personal data (brief §8).", "1"]]],
        ]],
    ]


def _b_email(rnd, period):
    return [
        ["Mail Flow Security", "Message disposition.", [
            ["K", kpi_set(rnd, [("Messages processed", "{value:.0f}k", True), ("Malicious blocked", "{value:.0f}", False), ("Quarantined", "{value:.0f}", False)])],
            ["D", "Disposition", [["Clean", 88, "o"], ["Spam", 7, "w"], ["Malware", 2, "b"], ["Spoof/phish", 3, "h"]]],
        ]],
        ["Threat Types", "Detected email threats.", [
            ["T", "Categories", ["Type", "Count", "Action"], [
                ["Credential phishing", f"{rnd.randint(10, 40)}", "@crit:Blocked"],
                ["Attachment malware", f"{rnd.randint(5, 20)}", "@high:Quarantined"],
                ["BEC pretexting", f"{rnd.randint(1, 6)}", "@med:Flagged to user"],
            ]],
        ]],
        ["Recommendations", "Hardening.", [
            ["L", "Actions", ["Enforce DMARC p=reject on secondary domain", "Enable mailbox intelligence for finance team", "Run phishing simulation next quarter"]],
        ]],
    ]


def _b_incident(rnd, period):
    return [
        ["Response Performance", "MTTD / MTTR against targets.", [
            ["K", kpi_set(rnd, [("Incidents", "{value:.0f}", False), ("MTTD (min)", "{value:.0f}", False), ("MTTR (h)", "{value:.1f}", False), ("SLA met", "{value:.0f}%", True)])],
            ["S", "MTTR trend (12 weeks)", [round(rnd.uniform(2, 9), 1) for _ in range(12)]],
        ]],
        ["Incident Ledger", "All confirmed incidents.", [
            ["T", "Incidents", ["Ref", "Title", "Severity", "Status"], [
                ["INC-2201", "Ransomware precursor detected", "@crit:Critical", "@crit:Contained"],
                ["INC-2198", "Phishing campaign vs HR", "@high:High", "@low:Closed"],
                ["INC-2195", "Suspicious privileged login", "@med:Medium", "@low:Closed"],
            ]],
        ]],
        ["Lessons Learned", "Post-incident review.", [
            ["M", "Improvements", [["Auto-containment cut MTTR by ~35% vs last period.", "o"], ["Gap: VPN logs retention below 90 days.", "w"]]],
        ]],
    ]


def _b_soar(rnd, period):
    return [
        ["Automation Overview", "Playbook execution stats.", [
            ["K", kpi_set(rnd, [("Runs", "{value:.0f}", True), ("Success rate", "{value:.0f}%", True), ("Hours saved", "{value:.0f}", True)])],
            ["B", "Top playbooks", [["Phishing triage", 62, "o"], ["Host isolation", 24, "1"], ["IOC enrichment", 88, "o"], ["Account disable", 15, "w"]]],
        ]],
        ["Failures & Fixes", "Runs needing attention.", [
            ["T", "Failed runs", ["Playbook", "Step", "Cause", "Fix"], [
                ["Host isolation", "API call", "@high:Timeout", "Retry policy added"],
                ["Ticket sync", "Auth", "@crit:Token expired", "Refresh automated"],
            ]],
        ]],
        ["ROI Note", "Cross-reference with report 9.", [
            ["M", "", [["Full cost model available in the Security ROI Calculator.", "1"]]],
        ]],
    ]


def _b_tickets(rnd, period):
    return [
        ["Operations", "Volume and responsiveness.", [
            ["K", kpi_set(rnd, [("Opened", "{value:.0f}", False), ("Resolved", "{value:.0f}", True), ("Backlog", "{value:.0f}", False), ("CSAT", "{value:.1f}/5", True)])],
            ["S", "Daily volume (30d)", [rnd.randint(2, 25) for _ in range(30)]],
        ]],
        ["SLA", "First response / resolution compliance.", [
            ["R", [["First response SLA", 94, "o"], ["Resolution SLA", 87, "w"], ["Escalations handled", 76, "1"]]],
            ["T", "Breaches", ["Ticket", "Priority", "Breach", "Owner"], [
                ["TKT-1042", "@crit:P1", "Resolution +6h", "NOC"],
                ["TKT-1038", "@med:P3", "First response +2h", "Field"],
            ]],
        ]],
        ["Quality", "Tags, satisfaction, reopens.", [
            ["D", "Categories", [["Access", 30, "1"], ["Hardware", 22, "2"], ["Security", 18, "b"], ["Network", 30, "3"]]],
            ["L", "Watch items", ["Reopen rate above 8% for 'Access' category", "Two technicians overloaded (>40 open tickets)"]],
        ]],
    ]


def _b_vuln(rnd, period):
    return [
        ["Exposure", "Vulnerability counts by severity.", [
            ["K", kpi_set(rnd, [("Total open", "{value:.0f}", False), ("Critical", "{value:.0f}", False), ("Fixed this period", "{value:.0f}", True), ("Mean age (days)", "{value:.0f}", False)])],
            ["D", "By severity", [["Critical", 6, "b"], ["High", 21, "h"], ["Medium", 47, "w"], ["Low", 63, "o"]]],
        ]],
        ["Hot Assets", "Most exposed systems.", [
            ["T", "Assets", ["Host", "Crit", "High", "Last scan"], [
                ["srv-fin-01", "@crit:4", "6", "2 days ago"],
                ["win-user-lab", "@high:0", "9", "5 days ago"],
            ]],
        ]],
        ["Program", "Remediation SLA tracking.", [
            ["B", "Within SLA", [["Critical ≤7d", 83, "w"], ["High ≤30d", 91, "o"], ["Medium ≤90d", 78, "1"]]],
        ]],
    ]


def _b_patch(rnd, period):
    return [
        ["Patch Compliance", "Rollout status.", [
            ["K", kpi_set(rnd, [("Patch rate", "{value:.0f}%", True), ("Reboots pending", "{value:.0f}", False), ("Failed patches", "{value:.0f}", False)])],
            ["S", "Weekly patch velocity", [rnd.randint(10, 90) for _ in range(12)]],
        ]],
        ["Windows", "Maintenance windows used.", [
            ["T", "Cycles", ["Window", "Targets", "Success", "Notes"], [
                ["W1 Tue 22:00", "Servers", "@low:98%", ""],
                ["W2 Sat 09:00", "Workstations", "@med:92%", "2 rollbacks"],
            ]],
        ]],
        ["Exceptions", "Pinned systems.", [
            ["L", "Excluded", ["Lab hypervisor (change freeze)", "Legacy POS terminal (vendor hold)"]],
        ]],
    ]


def _b_cloud(rnd, period):
    return [
        ["Posture", "Misconfigurations by provider.", [
            ["K", kpi_set(rnd, [("Accounts scanned", "{value:.0f}", True), ("Findings", "{value:.0f}", False), ("Public exposures", "{value:.0f}", False)])],
            ["B", "Finding classes", [["Identity", 44, "b"], ["Storage exposure", 21, "h"], ["Network", 18, "w"], ["Logging", 12, "1"]]],
        ]],
        ["Top Risks", "Critical cloud findings.", [
            ["T", "Findings", ["Resource", "Issue", "Severity"], [
                ["bucket-backups-eu", "Public read ACL", "@crit:Critical"],
                ["iam-user-ci", "Root-level policies", "@high:High"],
            ]],
        ]],
        ["Guardrails", "Preventive controls.", [
            ["M", "Status", [["3 guardrail policies enforced, 2 in dry-run.", "1"], ["Recommend: deny public buckets org-wide.", "w"]]],
        ]],
    ]


def _b_infra(rnd, period):
    return [
        ["Health", "Device availability.", [
            ["K", kpi_set(rnd, [("Devices online", "{value:.0f}", True), ("Uptime", "{value:.2f}%", True), ("Degraded", "{value:.0f}", False)])],
            ["R", [["Core network", 99, "o"], ["Compute", 96, "w"], ["Storage", 91, "h"]]],
        ]],
        ["Capacity", "Utilisation trends.", [
            ["B", "Peak utilisation", [["CPU fleet", 61, "w"], ["RAM fleet", 72, "h"], ["Disk primary", 84, "b"], ["Bandwidth", 45, "o"]]],
        ]],
        ["Watchlist", "Devices needing care.", [
            ["T", "Devices", ["Name", "Issue", "Since"], [
                ["sw-dist-03", "@high:PSU 2 fault", "6 days"],
                ["fw-edge-01", "@med:Config drift", "2 days"],
            ]],
        ]],
    ]


def _b_network(rnd, period):
    return [
        ["Performance", "Latency / loss / jitter.", [
            ["K", kpi_set(rnd, [("Avg latency (ms)", "{value:.0f}", False), ("Packet loss (%)", "{value:.2f}", False), ("Jitter (ms)", "{value:.1f}", False)])],
            ["S", "Latency P95 (24h)", [round(rnd.uniform(8, 60), 1) for _ in range(24)]],
        ]],
        ["Top Talkers", "Bandwidth consumers.", [
            ["T", "Flows", ["Source → Dest", "Mbps", "App class"], [
                ["branch-a ↔ core", "@med:412", "Backup"],
                ["user-segment ↔ saas", "@low:208", "Collaboration"],
            ]],
        ]],
        ["Quality Events", "Degradations detected.", [
            ["L", "Events", ["VoIP quality drop Tue 14:00–14:20 (jitter)", "DNS spikes from lab segment Wed night"]],
        ]],
    ]


def _b_backup(rnd, period):
    return [
        ["Protection", "Job success rates.", [
            ["K", kpi_set(rnd, [("Jobs succeeded", "{value:.0f}%", True), ("Datasets protected", "{value:.0f}", True), ("Last restore test", "{value:.0f}d ago", False)])],
            ["R", [["File backups", 98, "o"], ["VM backups", 94, "w"], ["SaaS backups", 88, "h"]]],
        ]],
        ["Restores", "Test results (immutable copies).", [
            ["T", "Restore tests", ["System", "Date", "Result", "Duration"], [
                ["ERP DB", "day 03", "@low:OK", "42 min"],
                ["Share EU", "day 17", "@crit:FAILED", "timeout"],
            ]],
        ]],
        ["DR Readiness", "RTO/RPO alignment.", [
            ["M", "Gaps", [["RPO target 1h not met for legacy SQL instance.", "b"], ["Failover drill planned next month.", "1"]]],
        ]],
    ]


def _b_endpoint(rnd, period):
    return [
        ["Coverage", "Agent health.", [
            ["K", kpi_set(rnd, [("Managed endpoints", "{value:.0f}", True), ("Healthy agents", "{value:.0f}%", True), ("Stale agents", "{value:.0f}", False)])],
            ["D", "Agent state", [["Healthy", 82, "o"], ["Degraded", 9, "w"], ["Missing", 5, "b"], ["Unmanaged", 4, "h"]]],
        ]],
        ["Detections", "Blocked threats by vector.", [
            ["B", "Vectors", [["USB autorun", 12, "w"], ["Malicious download", 34, "b"], ["Exploit attempt", 7, "h"]]],
        ]],
        ["Isolation", "Containment actions.", [
            ["T", "Events", ["Host", "Trigger", "Duration", "Outcome"], [
                ["win-user-114", "@crit:Loader detected", "38 min", "Cleaned"],
                ["win-user-087", "@high:Suspicious script", "12 min", "False positive"],
            ]],
        ]],
    ]


def _b_compliance(rnd, period):
    return [
        ["Framework Status", "Control conformity.", [
            ["K", kpi_set(rnd, [("Applicable controls", "{value:.0f}", True), ("Conformant", "{value:.0f}%", True), ("Overdue", "{value:.0f}", False)])],
            ["R", [["NIST CSF", 81, "w"], ["SOC 2", 76, "h"], ["ISO 27001", 88, "o"]]],
        ]],
        ["Movement", "Changes since last period.", [
            ["T", "Transitions", ["Control", "From", "To", "Evidence"], [
                ["AC-2 Account mgmt", "@med:Partial", "@low:Full", "Ticket sample attached"],
                ["DE-1 Monitoring", "@high:Non", "@med:Partial", "Collector deployed"],
            ]],
        ]],
        ["Validation", "Human sign-off (Phase 7).", [
            ["M", "", [["Automatic status never replaces human validation — awaiting client DPO/CISO sign-off on 4 controls.", "w"]]],
        ]],
    ]


def _b_regulatory(rnd, period):
    return [
        ["Obligations", "GDPR / HIPAA / PCI-DSS mapping.", [
            ["K", kpi_set(rnd, [("Mapped obligations", "{value:.0f}", True), ("On track", "{value:.0f}%", True), ("At risk", "{value:.0f}", False)])],
            ["B", "By regulation", [["GDPR", 84, "o"], ["HIPAA", 69, "w"], ["PCI-DSS", 77, "h"]]],
        ]],
        ["Data Flows", "Sensitive processing register.", [
            ["T", "Flows", ["Flow", "Regulation", "Status"], [
                ["Payments → PSP", "PCI-DSS", "@low:Assessed"],
                ["HR export → SaaS", "GDPR", "@med:DPA missing"],
            ]],
        ]],
        ["Deadlines", "Upcoming obligations.", [
            ["L", "Next 90 days", ["Annual PCI attestation renewal", "DPA review for 2 sub-processors", "Retention audit for CCTV footage"]],
        ]],
    ]


def _b_audit(rnd, period):
    return [
        ["Activity", "Platform audit trail summary.", [
            ["K", kpi_set(rnd, [("Audited events", "{value:.0f}k", True), ("Admin actions", "{value:.0f}", False), ("Config changes", "{value:.0f}", False)])],
            ["S", "Events per day (30d)", [rnd.randint(50, 900) for _ in range(30)]],
        ]],
        ["Sensitive Actions", "Highlighted operations.", [
            ["T", "Events", ["When", "Who", "Action", "Risk"], [
                ["day 04 09:12", "admin-a", "Role granted: platform_admin", "@crit:High"],
                ["day 11 22:40", "svc-account", "API key rotated", "@low:Info"],
                ["day 19 15:03", "admin-b", "Firewall rule deleted", "@high:Medium"],
            ]],
        ]],
        ["Integrity", "Chain verification.", [
            ["M", "", [["Hash-chain verified for all exported periods (no gaps).", "o"], ["2 exports lacked reason codes — reminder sent.", "w"]]],
        ]],
    ]


def _b_roi(rnd, period):
    return [
        ["Investment Model", "Costs vs avoided losses.", [
            ["K", kpi_set(rnd, [("Annual spend", "${value:.0f}k", False), ("Avoided loss est.", "${value:.0f}k", True), ("Net ROI", "{value:.0f}%", True)])],
            ["B", "Cost split", [["Tooling", 38, "1"], ["People", 47, "2"], ["Services", 15, "3"]]],
        ]],
        ["Avoidance Scenarios", "Counterfactual modelling.", [
            ["T", "Scenario", ["Event", "Likelihood", "Loss avoided"], [
                ["Ransomware week-long outage", "@med:12%/yr", "$480k"],
                ["Data breach notification", "@low:6%/yr", "$210k"],
            ]],
            ["M", "Assumptions", [["Parameters editable by client admin only (brief Q4).", "1"]]],
        ]],
        ["Efficiency", "Automation savings.", [
            ["S", "Hours saved/month", [rnd.randint(20, 120) for _ in range(12)]],
        ]],
    ]


def _b_value(rnd, period):
    return [
        ["Value Delivered", "Outcomes visible to the business.", [
            ["K", kpi_set(rnd, [("Incidents prevented", "{value:.0f}", True), ("Downtime avoided (h)", "{value:.0f}", True), ("Projects delivered", "{value:.0f}", True)])],
            ["D", "Service mix", [["SOC", 34, "b"], ["Infra", 28, "1"], ["Compliance", 18, "3"], ["Projects", 20, "o"]]],
        ]],
        ["Commitments", "SLA and roadmap delivery.", [
            ["T", "Commitments", ["Item", "Target", "Actual", "State"], [
                ["P1 response", "15 min", "9 min", "@low:Met"],
                ["Monthly report", "day 5", "day 4", "@low:Met"],
                ["DR drill", "quarterly", "late 6d", "@med:At risk"],
            ]],
        ]],
        ["Voice of Client", "Satisfaction inputs.", [
            ["R", [["NPS", 72, "o"], ["CSAT tickets", 91, "o"], ["Portal adoption", 64, "w"]]],
        ]],
    ]


_BUILDERS = {
    "executive": _b_executive, "roi": _b_roi, "value": _b_value,
    "threatintel": _b_threatintel, "hunting": _b_hunting, "uba": _b_uba,
    "email": _b_email, "incident": _b_incident, "soar": _b_soar,
    "tickets": _b_tickets, "vuln": _b_vuln, "patch": _b_patch,
    "cloud": _b_cloud, "infra": _b_infra, "network": _b_network,
    "backup": _b_backup, "endpoint": _b_endpoint, "compliance": _b_compliance,
    "regulatory": _b_regulatory, "audit": _b_audit,
}


def build_demo_report(report_key: str, tenant_id: str, period: str) -> list:
    """Return [[title, intro, [blocks]], ...] — the page contract (brief §5)."""
    rnd = _rng(tenant_id, period, report_key)
    ts = now_utc()
    pages = _BUILDERS[report_key](rnd, period)
    stamped = []
    for title, intro, blocks in pages:
        stamped.append([title, f"{intro} · last updated {ts}", blocks])
    return stamped
