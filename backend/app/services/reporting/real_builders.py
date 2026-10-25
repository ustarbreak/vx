"""Real-data report builders (Phase 1 of the demo/real separation).

These builders read ONLY from live Postgres tables owned by the platform:
  tickets / alerts / notification_rules / ticket_audit_entries.
They are used when the frontend Demo Mode is OFF (no ?demo=1 on the request).

Design rules (brief §4):
  * tenant isolation — every query filters on org_id taken from the JWT,
    never from a client parameter;
  * period filter — [period-01 00:00 UTC, next month 01st) ;
  * empty data is rendered honestly ("Aucun incident sur la période"),
    never with fake numbers and never falling back to demo data.

Block contract follows brief §5 exactly, so the same React renderer works.
"""
from __future__ import annotations

import calendar
from datetime import datetime, timezone

from sqlalchemy import select, func as safunc

from app.database import AsyncSessionLocal
from app.models import Ticket, Alert, NotificationRule


def _period_range(period: str) -> tuple[datetime, datetime]:
    y, m = int(period[:4]), int(period[5:7])
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + (m == 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
    return start, end


def _int(tenant: str) -> int | None:
    try:
        return int(tenant)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- tickets --
async def build_tickets(org: int, period: str) -> list:
    start, end = _period_range(period)
    db = AsyncSessionLocal()
    try:
        base = (Ticket.org_id == org, Ticket.created_at >= start, Ticket.created_at < end)
        opened = await db.scalar(select(safunc.count(Ticket.id)).where(*base)) or 0
        resolved = await db.scalar(select(safunc.count(Ticket.id)).where(
            *base, Ticket.resolved_at.is_not(None))) or 0
        backlog = await db.scalar(select(safunc.count(Ticket.id)).where(
            Ticket.org_id == org, ~Ticket.status.in_(("resolved", "closed")))) or 0
        # SLA breach measured from real timestamps (no dedicated column in schema)
        breached = await db.execute(select(safunc.count(Ticket.id)).where(
            *base, Ticket.due_resolve_at.is_not(None),
            safunc.coalesce(Ticket.resolved_at, datetime.now(timezone.utc)) > Ticket.due_resolve_at
        )).scalar() or 0
        avg_res_h = None
        rows = await db.execute(select(Ticket.created_at, Ticket.resolved_at).where(
            *base, Ticket.resolved_at.is_not(None))).all()
        durs = [(r[1] - r[0]).total_seconds() / 3600 for r in rows if r[1] and r[0]]
        if durs:
            avg_res_h = sum(durs) / len(durs)
        cats = await db.execute(select(Ticket.category, safunc.count(Ticket.id))
                          .where(*base).group_by(Ticket.category)).all()
        prios = await db.execute(select(Ticket.priority, safunc.count(Ticket.id))
                            .where(*base).group_by(Ticket.priority)).all()
        recent = await db.execute(select(Ticket.uid, Ticket.title, Ticket.priority, Ticket.status)
                            .where(*base).order_by(Ticket.created_at.desc()).limit(8)).all()

        total_cat = sum(c for _, c in cats) or 1
        p1 = ["Operations (real data)", "Live counts from the ticketing database.", [
            ["K", [["Opened", str(opened), "= raw count", "1"],
                   ["Resolved", str(resolved),
                    f"{'▲' if resolved * 2 >= opened else '▼'} {round(100 * resolved / max(opened, 1))}% close rate", "o"],
                   ["Backlog (live)", str(backlog), "= currently open", "w" if backlog > 10 else "o"],
                   ["Avg resolution", f"{avg_res_h:.1f} h" if avg_res_h is not None else "n/a",
                    "= no closed tickets yet" if avg_res_h is None else "▲ from real timestamps", "2"],
                   ["SLA breaches", str(breached), "= past due_resolve_at", "b" if breached else "o"]]],
        ]]
        dist = [["B", "Categories", [[c or "other", round(100 * n / total_cat), col]
                for (c, n), col in zip(cats, ["1", "2", "3", "w", "o", "b", "h"])]],
                ["T", "Tickets opened in the period", ["Ref", "Title", "Priority", "Status"],
                 [[u, t[:60], f"@high:{p.upper()}",
                   f"@low:{s}" if s in ("resolved", "closed") else f"@med:{s}"]
                  for u, t, p, s in recent]]]
        if not recent:
            dist.append(["M", "Empty state", [["Aucun ticket ouvert sur la période.", "w"]]])
        p3 = ["SLA & Quality", "Response discipline from real SLA columns.", [
            ["R", [["Close rate", min(100, round(100 * resolved / max(opened, 1))), "o",
                   f"{resolved}/{opened}"],
                  ["Automated triage", 0, "w", "AI fields present but unpopulated"]]],
            ["L", "Watch items", [f"Backlog currently at {backlog} open tickets."]
             if backlog else ["No open backlog."]],
        ]]
        return [p1, ["Distribution", "Breakdown of the real volume.", dist], p3]
    finally:
        await db.close()


# --------------------------------------------------------------- incidents --
async def build_incident(org: int, period: str) -> list:
    start, end = _period_range(period)
    db = AsyncSessionLocal()
    try:
        alerts_q = (Alert.org_id == org, Alert.created_at >= start, Alert.created_at < end)
        total_alerts = await db.scalar(select(safunc.count(Alert.id)).where(*alerts_q)) or 0
        sev = dict((await db.execute(select(Alert.severity, safunc.count(Alert.id))
                              .where(*alerts_q).group_by(Alert.severity))).all())
        acked = await db.scalar(select(safunc.count(Alert.id)).where(*alerts_q, Alert.acked_at.is_not(None))) or 0
        linked = await db.scalar(select(safunc.count(Alert.id)).where(*alerts_q, Alert.ticket_uid.is_not(None))) or 0
        top_src = await db.execute(select(Alert.source, safunc.count(Alert.id))
                             .where(*alerts_q).group_by(Alert.source)
                             .order_by(safunc.count(Alert.id).desc()).limit(6)).all()
        # MTTR proxy: alert created -> its auto-ticket resolved
        mttr_rows = await db.execute(
            select(Alert.created_at, Ticket.resolved_at)
            .join(Ticket, Ticket.uid == Alert.ticket_uid)
            .where(*alerts_q, Ticket.resolved_at.is_not(None))).all()
        mttr_h = None
        if mttr_rows:
            vals = [(r[1] - r[0]).total_seconds() / 3600 for r in mttr_rows if r[1] and r[0]]
            if vals:
                mttr_h = sum(vals) / len(vals)
        inc_rows = await db.execute(select(Ticket.uid, Ticket.title, Ticket.priority, Ticket.status)
                              .where(Ticket.org_id == org, Ticket.category == "incident",
                                     Ticket.created_at >= start, Ticket.created_at < end)
                              .order_by(Ticket.created_at.desc()).limit(10)).all()
        p1 = ["Detection & Response (real data)", "From live alerts + ticketing tables.", [
            ["K", [["Alerts ingested", str(total_alerts), "= raw count", "1"],
                   ["Acknowledged", str(acked), f"▲ {round(100 * acked / max(total_alerts, 1))}%", "o"],
                   ["Converted to tickets", str(linked), f"= {round(100 * linked / max(total_alerts, 1))}% of alerts", "2"],
                   ["MTTR (alert→resolution)", f"{mttr_h:.1f} h" if mttr_h is not None else "n/a",
                    "= no resolved linked tickets" if mttr_h is None else "▲ real timestamps", "3"]]],
            ["F", "SOC funnel", [["Alerts", max(total_alerts, 1)],
                                 ["Acknowledged", max(acked, 1)],
                                 ["Escalated to ticket", max(linked, 1)],
                                 ["Incidents (category)", max(len(inc_rows), 1)]]],
        ]]
        p2 = ["Severity Ledger", "Confirmed incident tickets this period.", [
            ["T", "Incidents", ["Ref", "Title", "Severity", "Status"],
             [[u, t[:60], f"@crit:{p.upper()}" if p in ("p1", "p2") else f"@high:{p.upper()}",
               f"@low:{s}" if s in ("resolved", "closed") else f"@med:{s}"] for u, t, p, s in inc_rows]]
            if inc_rows else
            ["M", "Empty state", [["Aucun incident critique sur la période.", "o"]]],
            ["B", "Alert severity mix", [[s, round(100 * n / max(total_alerts, 1)), c] for (s, n), c in
                                          zip(sorted(sev.items(), key=lambda x: -x[1]),
                                              ["b", "h", "w", "1", "o"])][:5]],
        ]]
        p3 = ["Sources & Lessons", "Where detection pressure comes from.", [
            ["T", "Top alert sources", ["Source", "Count", "Share"],
             [[s, str(n), f"{round(100 * n / max(total_alerts, 1))}%"] for s, n in top_src]],
            ["M", "Note", [["MTTR is computed only from real alert→ticket→resolution timestamps; "
                            "it shows n/a until such chains exist.", "1"]]],
        ]]
        return [p1, p2, p3]
    finally:
        await db.close()


# ------------------------------------------------------------------- soar --
async def build_soar(org: int, period: str) -> list:
    """Automation KPIs derived from real alert->ticket automation + rules."""
    start, end = _period_range(period)
    db = AsyncSessionLocal()
    try:
        alerts_q = (Alert.org_id == org, Alert.created_at >= start, Alert.created_at < end)
        total_alerts = await db.scalar(select(safunc.count(Alert.id)).where(*alerts_q)) or 0
        auto = await db.scalar(select(safunc.count(Alert.id)).where(*alerts_q, Alert.ticket_uid.is_not(None))) or 0
        rules = await db.scalar(select(safunc.count(NotificationRule.id)).where(
            NotificationRule.org_id == org, NotificationRule.enabled.is_(True))) or 0
        suppressed = await db.scalar(select(safunc.count(Alert.id)).where(*alerts_q, Alert.storm_suppressed.is_(True))) or 0
        correlated = await db.scalar(select(safunc.sum(Alert.correlated_count)).where(*alerts_q)) or total_alerts
        pct_auto = round(100 * auto / max(total_alerts, 1))
        p1 = ["Automation Overview (real data)", "Playbook-style automations actually executed.", [
            ["K", [["Alerts processed", str(correlated), "= incl. correlation", "1"],
                   ["Auto-ticketed", str(auto), f"▲ {pct_auto}%", "3"],
                   ["Active rules", str(rules), "= enabled", "2"],
                   ["Storm-suppressed", str(suppressed), "= dedup savings", "o"]]],
            ["G", "Automation rate", pct_auto, "3" if pct_auto >= 50 else "w"],
        ]]
        p2 = ["Rules In Force", "Notification/automation rules driving responses.", [
            ["T", "Enabled rules", ["Name", "Condition", "Action"],
             [[r.name, ", ".join((r.conditions or {}).get("severity", [])) or "-",
               ("ticket:" + r.ticket_priority + "; " if r.create_ticket else "")
               + ",".join(r.channels or [])]
              for r in (await db.execute(select(NotificationRule).where(
                  NotificationRule.org_id == org, NotificationRule.enabled.is_(True))
                  .order_by(NotificationRule.name).limit(10))).scalars()]
             ] if rules else ["M", "Empty state", [["Aucune règle active.", "w"]]],
        ]]
        p3 = ["Notes", "Interpretation.", [
            ["M", "Method", [[f"{auto}/{max(total_alerts, 1)} alerts were automatically escalated to "
                              "tickets during the period — that ratio is the true automation score.", "1"],
                             ["Hours-saved estimation needs playbook run logs (Phase 2 table).", "w"]]],
        ]]
        return [p1, p2, p3]
    finally:
        await db.close()


BUILDERS = {"tickets": build_tickets, "incident": build_incident, "soar": build_soar}


async def build(report_key: str, tenant: str, period: str) -> list | None:
    fn = BUILDERS.get(report_key)
    org = _int(tenant)
    if fn is None or org is None:
        return None
    return await fn(org, period)
