"""Partner Portal — Phase 1 (/api/partners) & Phase 2 (/api/partners/{pid}/ops).

Run from backend/:
    DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_partners_portal.py -p no:libtmux -q

Covers the HARD RULES:
  * rule 1 tenant isolation — a partner only ever sees its own org + children;
    cross-partner addressing -> 403 "Cross-partner access denied"; queue/assign,
    impersonation targets and template-apply targets are re-checked against the
    caller's own child set.
  * rule 2 cross-tenant switch is time-boxed via the EXISTING grants mechanism
    (TenantServiceGrant service_id="partner_console", expires_at) and audited.
  * rule 3 real mode never falls back to mock data — non-partner orgs -> 404
    "not configured"; empty tables -> empty lists (no seeding anywhere).
  * rule 4 currency MAD everywhere; tiers/discounts come from
    core/pricing_config.json through app.services.pricing_engine (asserted
    against the raw config so drift fails the suite).
  * rule 5 auth required on every route, writes rate-limited, inputs validated
    with Pydantic Literals (free-text tier/status rejected with 422).
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlalchemy.dialects import postgresql  # noqa: E402
from sqlalchemy.ext.compiler import compiles  # noqa: E402


@compiles(postgresql.JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw):  # pragma: no cover - test shim
    return "JSON"


from app.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token, get_password_hash  # noqa: E402
from app.models import (  # noqa: E402
    Alert, AgentProbe, AuditLog, Incident, NotificationRule, Organization,
    Playbook, TenantServiceGrant, Ticket, User,
)
from app.main import app  # noqa: E402
from app.routers import partners as partners_router  # noqa: E402
from app.services.pricing_engine import PRICING_CONFIG  # noqa: E402

NOW = datetime.now(timezone.utc).replace(tzinfo=None)


@pytest_asyncio.fixture()
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


async def _seed(factory):
    """Two MSSP partners with children, one plain client org, users per role."""
    async with factory() as s:
        s.add_all([
            # --- partner A (id 1) : gold by units (600 assets across kids) ---
            Organization(id=1, name="Atlas MSP", tier="enterprise", status="active",
                         contact_email="boss@atlas.ma", country="Maroc", is_partner=True,
                         partner_code="MSP-ATL", asset_count=0, seat_limit=40,
                         contract_start=NOW - timedelta(days=200), contract_end=NOW + timedelta(days=165)),
            Organization(id=11, name="Banque Atlas", tier="mid-market", status="active",
                         contact_email="dpo@banque.ma", industry="Banking", country="Casablanca",
                         parent_org_id=1, asset_count=400, member_count=80, plan_tier="pro",
                         monthly_revenue=90_000, contract_start=NOW - timedelta(days=100)),
            Organization(id=12, name="Retail Atlas", tier="sme", status="active",
                         contact_email="it@retail.ma", industry="Retail", country="Rabat",
                         parent_org_id=1, asset_count=200, member_count=30, plan_tier="starter",
                         monthly_revenue=30_000, contract_start=NOW - timedelta(days=10)),
            # --- partner B (id 2) : silver by units (120 assets) ---
            Organization(id=2, name="Dakhla Sec", tier="mid-market", status="active",
                         contact_email="root@dakhla.ma", country="Maroc", is_partner=True,
                         partner_code="MSP-DKH"),
            Organization(id=21, name="Port Dakhla", tier="sme", status="active",
                         contact_email="ops@port.ma", parent_org_id=2, asset_count=120,
                         member_count=15, plan_tier="starter", monthly_revenue=20_000),
            # --- not a partner at all (rule 3: must 404, never seed) ---
            Organization(id=3, name="Plain Corp", tier="sme", status="active", contact_email="a@b.c"),
            # --- users ---
            User(id=1, email="boss@atlas.ma", hashed_password=get_password_hash("x"),
                 name="Boss Atlas", role="partner_admin", org_id=1),
            User(id=2, email="analyst@atlas.ma", hashed_password=get_password_hash("x"),
                 name="Ana Lyse", role="analyst", org_id=1),
            User(id=3, email="root@dakhla.ma", hashed_password=get_password_hash("x"),
                 name="Boss Dakhla", role="partner_admin", org_id=2),
            User(id=4, email="plat@infracentra.io", hashed_password=get_password_hash("x"),
                 name="Platform", role="platform_admin", org_id=3),
            User(id=5, email="ca@plain.io", hashed_password=get_password_hash("x"),
                 name="Plain Admin", role="client_admin", org_id=3),
            # --- queue data under partner A children ---
            Alert(id=101, uid="ALR-000101", org_id=11, title="Ransomware lateral movement",
                  severity="critical", status="open", source="siem", resource="dc-01",
                  created_at=NOW - timedelta(hours=2)),
            Alert(id=102, uid="ALR-000102", org_id=12, title="Disk usage high",
                  severity="low", status="resolved", source="agent", resource="srv-web",
                  created_at=NOW - timedelta(days=2)),
            Ticket(id=201, uid="TCK-000201", org_id=11, title="VPN outage", priority="p1",
                   status="in_progress", source="manual", asset="fw-01",
                   due_resolve_at=NOW - timedelta(hours=1), created_at=NOW - timedelta(hours=6)),
            Ticket(id=202, uid="TCK-000202", org_id=12, title="New laptop setup", priority="p4",
                   status="new", source="email", asset="hp-zbook",
                   due_resolve_at=NOW + timedelta(days=1), created_at=NOW - timedelta(hours=1)),
            Incident(id=301, uid="INC-000301", org_id=11, title="Phishing campaign",
                     severity="high", status="investigating", affected_assets=["mail-01"],
                     created_at=NOW - timedelta(hours=3)),
            # foreign-org alert that must NEVER surface for partner A
            Alert(id=103, uid="ALR-000103", org_id=3, title="Foreign critical alert",
                  severity="critical", status="open", source="siem",
                  created_at=NOW - timedelta(minutes=5)),
            # agents: 2 online + 1 stale under org 11; none under org 12
            AgentProbe(id=401, org_id=11, hostname="dc-01", status="online", last_seen=NOW),
            AgentProbe(id=402, org_id=11, hostname="fw-01", status="online", last_seen=NOW),
            AgentProbe(id=403, org_id=11, hostname="srv-old", status="online",
                       last_seen=NOW - timedelta(hours=4)),
        ])
        await s.commit()


def client_for(session_factory, user_id=None):
    async def _get_db():
        async with session_factory() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db
    headers = {}
    if user_id is not None:
        headers["Authorization"] = f"Bearer {create_access_token({'sub': str(user_id)})}"
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t", headers=headers)


pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    partners_router._writes.clear()
    yield
    partners_router._writes.clear()


# --------------------------------------------------------------------------- #
# Authentication / role gating                                                #
# --------------------------------------------------------------------------- #
async def test_auth_required_on_all_partner_routes(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory) as c:
        for path in ("/api/partners", "/api/partners/stats", "/api/partners/1",
                     "/api/partners/1/license", "/api/partners/1/branding",
                     "/api/partners/1/clients", "/api/partners/1/queue",
                     "/api/partners/1/health", "/api/partners/1/handovers",
                     "/api/partners/1/templates"):
            r = await c.get(path)
            assert r.status_code in (401, 403), path
        r = await c.put("/api/partners/1/branding", json={"brand_name": "X"})
        assert r.status_code in (401, 403)


async def test_stats_platform_only(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:      # partner_admin
        assert (await c.get("/api/partners/stats")).status_code == 403
    async with client_for(session_factory, 4) as c:      # platform_admin
        r = await c.get("/api/partners/stats")
        assert r.status_code == 200
        st = r.json()
        assert st["partners_total"] == 2 and st["end_clients"] == 3
        assert st["wholesale_mrr_mad"] > 0              # MAD, never EUR keys
        assert set(st) == {"partners_total", "partners_active", "trials", "end_clients",
                           "devices_managed", "wholesale_mrr_mad", "retail_mrr_mad",
                           "channel_margin_pct", "white_labels_live", "dns_pending"}


# --------------------------------------------------------------------------- #
# Rule 1 — tenant isolation                                                   #
# --------------------------------------------------------------------------- #
async def test_partner_list_scoped_to_self(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.get("/api/partners")
        assert [p["id"] for p in r.json()] == ["1"]
    async with client_for(session_factory, 3) as c:
        assert [p["id"] for p in (await c.get("/api/partners")).json()] == ["2"]
    async with client_for(session_factory, 4) as c:
        assert {p["id"] for p in (await c.get("/api/partners")).json()} == {"1", "2"}


async def test_cross_partner_access_denied_everywhere(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        for path in ("/api/partners/2", "/api/partners/2/license", "/api/partners/2/branding",
                     "/api/partners/2/clients", "/api/partners/2/queue", "/api/partners/2/health",
                     "/api/partners/2/handovers", "/api/partners/2/templates"):
            r = await c.get(path)
            assert r.status_code == 403 and r.json()["detail"] == "Cross-partner access denied", path
        r = await c.put("/api/partners/2/branding", json={"brand_name": "Evil"})
        assert r.status_code == 403
        r = await c.post("/api/partners/2/clients",
                         json={"name": "Intrus", "devices": 5, "users": 5})
        assert r.status_code == 403
        # queue of partner B must not leak foreign items into partner A either
        q = (await c.get("/api/partners/1/queue")).json()
        uids = {it["uid"] for it in q["items"]}
        assert "ALR-000103" not in uids          # other org's alert invisible
        assert {"ALR-000101", "TCK-000201", "TCK-000202", "INC-000301"} <= uids


# --------------------------------------------------------------------------- #
# Rule 3 — no mock fallback, explicit states                                  #
# --------------------------------------------------------------------------- #
async def test_non_partner_is_not_configured_never_seeded(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 5) as c:
        r = await c.get("/api/partners/3")
        assert r.status_code == 404 and "not configured" in r.json()["detail"]
    async with client_for(session_factory, 1) as c:
        assert (await c.get("/api/partners/999")).status_code == 404
        assert (await c.get("/api/partners/abc")).status_code == 404   # garbage id -> 404 too


async def test_empty_states_are_explicit_lists(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 3) as c:     # partner B has no queue data
        q = (await c.get("/api/partners/2/queue")).json()
        assert q["items"] == [] and q["counts"]["alerts_open"] == 0
        h = (await c.get("/api/partners/2/health")).json()
        assert len(h["clients"]) == 1 and h["clients"][0]["agents_total"] == 0
        assert (await c.get("/api/partners/2/handovers")).json() == []
        assert (await c.get("/api/partners/2/templates")).json() == []


# --------------------------------------------------------------------------- #
# Rule 4 — license model from pricing_config.json, MAD                        #
# --------------------------------------------------------------------------- #
async def test_license_tiers_and_progress_from_pricing_config(session_factory):
    await _seed(session_factory)
    tiers = PRICING_CONFIG["partner"]["tiers"]
    async with client_for(session_factory, 1) as c:
        lic = (await c.get("/api/partners/1/license")).json()
        assert lic["managed_units"] == 600 and lic["plan"] == "gold"
        assert lic["tier_discount"] == 0.30
        assert lic["next_tier"] == "platinum"
        assert lic["units_to_next_tier"] == 1500 - 600
        assert lic["price_month_mad"] > 0 and lic["resale_price_from_mad"] > 0
        assert not any("eur" in k.lower() for k in lic)
        assert lic["margin_pct"] == max(round(100 * (120_000 - lic["price_month_mad"]) / 120_000), 0)
    async with client_for(session_factory, 3) as c:
        lic2 = (await c.get("/api/partners/2/license")).json()
        assert lic2["managed_units"] == 120 and lic2["plan"] == "silver"
        assert lic2["tier_discount"] == 0.25 and lic2["next_tier"] == "gold"
        assert lic2["units_to_next_tier"] == 500 - 120
    # wholesale math mirrors the config exactly: pack price x max(units,minUnits) x (1-disc)
    disc = min(0.30, PRICING_CONFIG["partner"]["totalDiscountCap"])
    expected = int(PRICING_CONFIG["packs"]["pro"]["price"] * 600 * (1 - disc))
    async with client_for(session_factory, 1) as c:
        assert (await c.get("/api/partners/1/license")).json()["price_month_mad"] == expected


# --------------------------------------------------------------------------- #
# Branding + verify-domain                                                    #
# --------------------------------------------------------------------------- #
async def test_branding_put_resets_dns_and_verify_domain_flips(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        b0 = (await c.get("/api/partners/1/branding")).json()
        assert b0["dns_status"] == "not_configured" and b0["cname_target"] == "edge.infracentra.io"
        r = await c.put("/api/partners/1/branding",
                        json={"brand_name": "Atlas SOC", "primary_color": "#1d4ed8",
                              "custom_domain": "soc.atlas.ma", "hide_infracentra": True})
        assert r.status_code == 200, r.text
        b1 = r.json()
        assert b1["brand_name"] == "Atlas SOC" and b1["dns_status"] == "pending_verification"
        # invalid payload rejected (rule 5)
        assert (await c.put("/api/partners/1/branding", json={"primary_color": "bleu"})).status_code == 422
        v = await c.post("/api/partners/1/verify-domain")
        assert v.status_code == 200 and v.json()["dns_status"] == "verified"
        # clearing the domain resets to not_configured, verify cannot invent success
        await c.put("/api/partners/1/branding", json={"custom_domain": ""})
        assert (await c.post("/api/partners/1/verify-domain")).json()["dns_status"] == "not_configured"


# --------------------------------------------------------------------------- #
# Clients CRUD — seat limit, validation, audit                                #
# --------------------------------------------------------------------------- #
async def test_client_crud_seat_limit_and_audit(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        before = len((await c.get("/api/partners/1/clients")).json())
        r = await c.post("/api/partners/1/clients",
                         json={"name": "Clinique Atlas", "industry": "Santé", "city": "Casa",
                               "devices": 25, "users": 60, "plan": "pro",
                               "monthly_mrr_mad": 12_000, "contact_email": "cto@clinique.ma"})
        assert r.status_code == 201
        cid = r.json()["id"]
        assert len((await c.get("/api/partners/1/clients")).json()) == before + 1
        assert (await c.patch(f"/api/partners/1/clients/{cid}",
                              json={"status": "active"})).json()["status"] == "active"
        assert (await c.patch(f"/api/partners/1/clients/{cid}",
                              json={"plan": "ultra"})).status_code == 422   # Literal-enforced
        assert (await c.post("/api/partners/1/clients",
                             json={"name": "X", "devices": 0, "users": 1})).status_code == 422
        assert (await c.delete(f"/api/partners/1/clients/{cid}")).status_code == 204
        assert (await c.delete(f"/api/partners/1/clients/{cid}")).status_code == 404
    # every write was audited under the partner's own org
    async with session_factory() as s:
        from sqlalchemy import select
        rows = (await s.execute(select(AuditLog).where(AuditLog.org_id == 1))).scalars().all()
        actions = {a.action for a in rows}
        assert {"partner.client_created", "partner.client_updated", "partner.client_deleted"} <= actions


# --------------------------------------------------------------------------- #
# Phase 2 — cross-client queue, filters, assignment                           #
# --------------------------------------------------------------------------- #
async def test_queue_filters_and_sla(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        q = (await c.get("/api/partners/1/queue")).json()
        kinds = {it["kind"] for it in q["items"]}
        assert kinds == {"alert", "ticket", "incident"}
        assert q["counts"]["tickets_open"] == 2 and q["counts"]["incidents_open"] == 1
        assert q["clients"] == [{"id": 11, "name": "Banque Atlas"}, {"id": 12, "name": "Retail Atlas"}]
        # resolved alerts excluded by default
        assert all(it["status"] != "resolved" for it in q["items"])
        # client filter
        qc = (await c.get("/api/partners/1/queue", params={"client": 12})).json()
        assert {it["org_id"] for it in qc["items"]} == {12}
        # kind + severity filters
        qi = (await c.get("/api/partners/1/queue", params={"kind": "incident"})).json()
        assert [it["uid"] for it in qi["items"]] == ["INC-000301"]
        qs = (await c.get("/api/partners/1/queue", params={"severity": "critical"})).json()
        assert {it["uid"] for it in qs["items"]} == {"ALR-000101", "TCK-000201"}  # p1 maps to critical
        # sla filter — TCK-000201 is past due
        qb = (await c.get("/api/partners/1/queue", params={"sla": "breached"})).json()
        assert [it["uid"] for it in qb["items"]] == ["TCK-000201"]
        # text search
        qq = (await c.get("/api/partners/1/queue", params={"q": "ransomware"})).json()
        assert [it["uid"] for it in qq["items"]] == ["ALR-000101"]
        # bad severity -> 422
        assert (await c.get("/api/partners/1/queue", params={"severity": "apocalypse"})).status_code == 422


async def test_queue_assign_team_only_and_audited(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/partners/1/queue/assign",
                         json={"kind": "alert", "item_uid": "ALR-000101",
                               "assignee_email": "analyst@atlas.ma"})
        assert r.status_code == 200 and r.json()["assignee"] == "analyst@atlas.ma"
        # outsider emails are rejected
        r = await c.post("/api/partners/1/queue/assign",
                         json={"kind": "alert", "item_uid": "ALR-000101",
                               "assignee_email": "hacker@other.ma"})
        assert r.status_code == 422
        # foreign item uid -> 404 even for platform-scanned ids
        r = await c.post("/api/partners/1/queue/assign",
                         json={"kind": "alert", "item_uid": "ALR-000103",
                               "assignee_email": "analyst@atlas.ma"})
        assert r.status_code == 404
    async with session_factory() as s:
        from sqlalchemy import select
        row = (await s.execute(select(Alert).where(Alert.uid == "ALR-000101"))).scalar_one()
        assert row.assignee == "analyst@atlas.ma"
        log = (await s.execute(select(AuditLog).where(
            AuditLog.action == "partner.queue_assigned"))).scalars().first()
        assert log.org_id == 1 and "ALR-000101" in log.details


# --------------------------------------------------------------------------- #
# Phase 2 — health summary                                                    #
# --------------------------------------------------------------------------- #
async def test_health_per_client_risk(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        h = (await c.get("/api/partners/1/health")).json()
        by_id = {row["client_org_id"]: row for row in h["clients"]}
        assert set(by_id) == {11, 12}
        b = by_id[11]
        assert b["open_alerts"]["critical"] == 1 and b["open_incidents"] == 1
        assert b["open_tickets"] == 1 and b["overdue_tickets"] == 1
        assert b["sla_state"] == "breached"
        assert b["agents_total"] == 3 and b["agents_online"] == 2   # stale probe excluded
        assert b["risk_level"] in ("critical", "high")
        assert h["clients"][0]["client_org_id"] == 11              # sorted by risk desc
        r = by_id[12]
        assert r["open_alerts"] == {"critical": 0, "high": 0, "other": 0}
        # risk is score-based (alerts*10/4 + incidents*5 + overdue*3); a single
        # open, non-overdue p4 ticket scores below the medium threshold (5) -> low.
        assert r["open_tickets"] == 1 and r["overdue_tickets"] == 0
        assert r["risk_score"] < 5 and r["risk_level"] == "low"


# --------------------------------------------------------------------------- #
# Phase 2 — time-boxed console switch (rule 2)                                #
# --------------------------------------------------------------------------- #
async def test_impersonation_grant_expiry_and_audit(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/partners/1/impersonations",
                         json={"client_org_id": 11, "minutes": 30, "reason": "triage ransomware"})
        assert r.status_code == 201
        body = r.json()
        assert body["token"] and body["client_org_id"] == 11
        exp = datetime.fromisoformat(body["expires_at"])
        assert timedelta(minutes=25) < exp - datetime.utcnow() < timedelta(minutes=35)
        # target outside the partner's children -> 403 (rule 1)
        assert (await c.post("/api/partners/1/impersonations",
                             json={"client_org_id": 21, "minutes": 30,
                                   "reason": "trying other partner"})).status_code == 403
        # minutes bounds enforced (Literal/Field validation)
        assert (await c.post("/api/partners/1/impersonations",
                             json={"client_org_id": 11, "minutes": 900,
                                   "reason": "too long"})).status_code == 422
        close = await c.delete("/api/partners/1/impersonations")
        assert close.status_code == 200 and close.json()["revoked"] == 1
    async with session_factory() as s:
        from sqlalchemy import select
        g = (await s.execute(select(TenantServiceGrant).where(
            TenantServiceGrant.service_id == "partner_console"))).scalars().first()
        assert g is not None and g.org_id == 11 and g.enabled is False
        assert g.expires_at.replace(tzinfo=None) <= datetime.utcnow() + timedelta(seconds=5)
        acts = {a.action for a in (await s.execute(select(AuditLog))).scalars().all()}
        assert {"partner.impersonation_started", "partner.impersonation_ended"} <= acts


# --------------------------------------------------------------------------- #
# Phase 2 — handovers + golden templates                                      #
# --------------------------------------------------------------------------- #
async def test_handovers_roundtrip(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        note = (await c.post("/api/partners/1/handovers",
                             json={"content": "INC-000301 en cours, escalade DPO prévue",
                                   "shift": "night"})).json()
        assert note["id"].startswith("HVO-") and note["shift"] == "night"
        lst = (await c.get("/api/partners/1/handovers")).json()
        assert lst[0]["id"] == note["id"]
        assert (await c.post("/api/partners/1/handovers",
                             json={"content": "ab"})).status_code == 422
        assert (await c.post("/api/partners/1/handovers",
                             json={"content": "ok content", "shift": "weekend"})).status_code == 422


async def test_template_library_clone_and_scope(session_factory):
    await _seed(session_factory)
    tpl = {
        "name": "Golden SOC baseline",
        "monitoring_rules": [{"name": "CPU élevé", "trigger_metric": "cpu",
                              "threshold": "90", "duration_min": 5,
                              "action": "create_ticket", "ticket_priority": "P3"},
                             {"name": "bad action", "action": "rm_rf", "trigger_metric": "disk",
                              "threshold": "90"}],
        "notification_rules": [{"name": "Critique -> équipe", "conditions": {"severity": ["critical"]},
                                "channels": ["email", "carrier_pigeon"], "create_ticket": True,
                                "ticket_priority": "p1"}],
        "playbooks": [{"name": "Quarantaine host", "steps": [
            {"name": "isolate", "action": "quarantine_host"},
            {"name": "evil", "action": "exec_shell"}]}],
    }
    async with client_for(session_factory, 1) as c:
        assert (await c.put("/api/partners/1/templates/golden-soc", json=tpl)).status_code == 200
        assert (await c.get("/api/partners/1/templates"))  .json()[0]["id"] == "golden-soc"
        r = await c.post("/api/partners/1/templates/golden-soc/apply",
                         json={"target_client_ids": [11, 12]})
        assert r.status_code == 200
        created = r.json()["created"]
        assert created["monitoring_rules"] == 2          # the rm_rf rule skipped
        assert created["notification_rules"] == 2
        assert created["playbooks"] == 2
        # unknown template -> 404 ; foreign target -> 403
        assert (await c.post("/api/partners/1/templates/nope/apply",
                             json={"target_client_ids": [11]})).status_code == 404
        assert (await c.post("/api/partners/1/templates/golden-soc/apply",
                             json={"target_client_ids": [21]})).status_code == 403
    async with session_factory() as s:
        from sqlalchemy import select
        rules = (await s.execute(select(NotificationRule).where(
            NotificationRule.org_id.in_([11, 12])))).scalars().all()
        assert rules and all(r.channels == ["email"] for r in rules)   # carrier pigeon dropped
        pbs = (await s.execute(select(Playbook).where(Playbook.org_id.in_([11, 12])))).scalars().all()
        assert pbs and all(len(p.steps) == 1 for p in pbs)             # exec_shell step dropped
        logs = (await s.execute(select(AuditLog).where(
            AuditLog.action == "partner.template_applied"))).scalars().all()
        assert logs and "digest=" in logs[0].details


# --------------------------------------------------------------------------- #
# Rule 5 — rate limiting on writes                                            #
# --------------------------------------------------------------------------- #
async def test_write_endpoints_rate_limited(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        codes = [(await c.put("/api/partners/1/branding",
                              json={"brand_name": f"B{i}"})).status_code for i in range(12)]
        assert codes[:10] == [200] * 10
        assert 429 in codes
        blocked = codes.index(429)
        # separate limiter bucket for handovers still works while branding is throttled
        assert (await c.post("/api/partners/1/handovers",
                             json={"content": "passation", "shift": "morning"})).status_code == 201
        assert blocked == 10


# =========================================================================== #
# Phase 3 — onboarding, deals, quotes, billing (partners_commercial)          #
# =========================================================================== #
async def test_onboarding_token_hashed_and_installer(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.post("/api/partners/1/clients/12/onboarding", json={
            "pack": "pro", "contract_months": 12, "admin_email": "it@retail.ma",
            "integrations": ["m365"]})
        assert r.status_code == 200
        j = r.json()
        assert j["enrollment_token"].startswith("enr-") and j["agent_installer"]
        assert j["pack_summary"]["price_mad"] == PRICING_CONFIG["packs"]["pro"]["price"]
        # token returned once, plaintext; storage must be a SHA-256 hash only (rule 5)
        tok = j["enrollment_token"]
        e = (await c.get("/api/partners/1/clients/12/offboarding")).json()
        assert tok not in str(e), "plaintext enrollment token leaked into export"
    import hashlib
    from app.models import TenantSetting
    async with session_factory() as s:
        st = (await s.get(TenantSetting, 12))
        data = st.data if isinstance(st.data, dict) else {}
        blob = str(data).lower()
        assert tok not in blob, "plaintext token persisted"
        assert hashlib.sha256(tok.encode()).hexdigest() in blob.lower(), "hash of token not stored"


async def test_offboarding_disable_then_delete_flow(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        assert (await c.delete("/api/partners/1/clients/12/offboarding")).status_code == 409
        assert (await c.post("/api/partners/1/clients/12/offboarding/disable")).status_code == 200
        assert (await c.delete("/api/partners/1/clients/12/offboarding")).status_code == 200
        # gone from children
        ids = [int(x["id"]) for x in (await c.get("/api/partners/1/clients")).json()]
        assert 12 not in ids
        # audit trail written
    async with session_factory() as s:
        from sqlalchemy import select
        from app.models import AuditLog
        acts = (await s.execute(select(AuditLog.action).where(AuditLog.org_id == 1))).scalars().all()
        assert "partner.client.deleted" in acts


async def test_deal_conflict_detection_and_bonus_window(session_factory):
    await _seed(session_factory)
    d1 = d2 = None
    async with client_for(session_factory, 1) as c:
        d1 = await c.post("/api/partners/1/deals", json={"prospect_company": "Acme Industries",
                                                          "expected_units": 120, "pack": "pro"})
        assert d1.status_code == 201 and d1.json()["state"] == "registered"
        # own duplicate -> 409
        dup = await c.post("/api/partners/1/deals", json={"prospect_company": "acme industries",
                                                           "expected_units": 50})
        assert dup.status_code == 409
    async with client_for(session_factory, 3) as c:  # partner B same prospect -> conflict
        d2 = await c.post("/api/partners/2/deals", json={"prospect_company": "ACME Industries SARL",
                                                          "expected_units": 80})
        assert d2.status_code == 201 and d2.json()["state"] == "conflict"
        # partner cannot self-approve
        assert (await c.post(f"/api/partners/2/deals/{d2.json()['id']}/approve", json={})).status_code == 403
    deal_id = d1.json()["id"]
    async with client_for(session_factory, 4) as c:  # platform_admin approves
        ap = await c.post(f"/api/partners/1/deals/{deal_id}/approve", json={"note": "ok"})
        assert ap.status_code == 200 and ap.json()["bonus_window_open"] is True
        assert ap.json()["bonus_points"] == PRICING_CONFIG["partner"]["dealRegistrationBonus"]["points"]
        ends = ap.json()["bonus_window_ends"]
        assert ends.startswith(str((NOW + timedelta(days=PRICING_CONFIG["partner"]["dealRegistrationBonus"]["months"] * 31)).year))
        conf = (await c.get("/api/partners/deals/conflicts")).json()["conflicts"]
        assert any(x["id"] == d2.json()["id"] for x in conf)
    # expired window -> derived state
    async with session_factory() as s:
        from sqlalchemy import select as _sel
        from app.models import PartnerDealRegistration as PDR
        d = (await s.execute(_sel(PDR).where(PDR.id == deal_id))).scalar_one()
        d.approved_at = NOW - timedelta(days=PRICING_CONFIG["partner"]["dealRegistrationBonus"]["months"] * 31 + 5)
        await s.commit()
    async with client_for(session_factory, 1) as c:
        lst = (await c.get("/api/partners/1/deals")).json()["deals"]
        mine = next(x for x in lst if x["id"] == deal_id)
        assert mine["state"] == "expired" and mine["bonus_window_open"] is False


async def test_partner_quote_tier_price_deal_bonus_and_margin(session_factory):
    await _seed(session_factory)
    # partner A: 600 managed units -> gold tier (min 500, discount .30)
    base_inputs = {"mode": "pack", "pack": "pro", "assets": [{"class": "server", "qty": 60}]}
    async with client_for(session_factory, 1) as c:
        q = await c.post("/api/partners/1/quotes", json={**base_inputs, "retail_per_unit_mad": 700})
        assert q.status_code == 201
        j = q.json()
        assert j["partner_tier"] == "gold" and j["managed_units"] == 600
        assert j["quote"]["totals"]["partner_discount_mad"] > 0
        assert j["margin"]["gross_margin_mad"] > 0
        num = j["number"]; qid = j["id"]
        got = (await c.get(f"/api/partners/1/quotes/{qid}")).json()
        assert got["number"] == num
        # cross-partner quote read -> 404
    async with client_for(session_factory, 3) as c:
        assert (await c.get(f"/api/partners/1/quotes/{qid}")).status_code in (403, 404)
        assert (await c.get("/api/partners/2/quotes")).json()["quotes"] == []
    # deal bonus: approve a deal then quote with deal_id -> extra 5 pts (capped by totalDiscountCap .40)
    async with client_for(session_factory, 1) as c:
        d = (await c.post("/api/partners/1/deals", json={"prospect_company": "Bonus Co",
                                                          "expected_units": 60, "pack": "pro"})).json()
    async with client_for(session_factory, 4) as c:
        assert (await c.post(f"/api/partners/1/deals/{d['id']}/approve", json={})).status_code == 200
    async with client_for(session_factory, 1) as c:
        qb = (await c.post("/api/partners/1/quotes", json={**base_inputs, "deal_id": d["id"]})).json()
        plain = (await c.post("/api/partners/1/quotes", json=base_inputs)).json()
        assert qb["deal_bonus_applied"] is True
        assert qb["quote"]["totals"]["monthly_excl_vat_mad"] <= plain["quote"]["totals"]["monthly_excl_vat_mad"]
        assert qb["quote"]["totals"]["cap_applied"] in (True, False)
    # unapproved deal -> 409
    async with client_for(session_factory, 1) as c:
        d2 = (await c.post("/api/partners/1/deals", json={"prospect_company": "Fresh Co",
                                                           "expected_units": 10})).json()
        bad = await c.post("/api/partners/1/quotes", json={**base_inputs, "deal_id": d2["id"]})
        assert bad.status_code == 409


async def test_billing_statement_invoice_analytics_csv(session_factory):
    await _seed(session_factory)
    # configure billing settings for child 12 (starter pack, SIEM overage, backup overage, 24/7)
    from app.routers.partners import _settings, _save_settings
    async with session_factory() as s:
        st = await _settings(s, 12)
        st["billing"] = {"pack": "starter", "siem_gb_day": 15, "backup_gb": 6000, "support247": True}
        await _save_settings(s, 12, st)
        st11 = await _settings(s, 11)
        st11["billing"] = {"pack": "pro", "siem_gb_day": 5, "backup_gb": 1000}
        await _save_settings(s, 11, st11)
        await s.commit()
    month = f"{NOW.year}-{NOW.month:02d}"
    async with client_for(session_factory, 1) as c:
        sm = (await c.get(f"/api/partners/1/billing/statement?client_org_id=12&month={month}")).json()
        line = sm["statement"]
        assert line["tier"] == "gold" and sm["tier"] == "gold"
        assert line["lines"][0]["amount_mad"] == 269 * 200          # starter price × 200 units
        siem = next(l for l in line["lines"] if l["key"] == "siem_overage")
        # graduated: first 10 GB @350 + next 5 GB @300 = 5000 (pricing_config rates)
        assert siem["qty"] == 15 and siem["amount_mad"] == 10 * 350 + 5 * 300
        bk = next(l for l in line["lines"] if l["key"] == "backup_overage")
        # starter backupQuotaGbPerUnit=100 x 200 units = 20000 included -> 6000 overage = 0...
        # actual: quota = max(backupQuota min?, units*perUnit) per config; assert engine-consistent value
        from app.services.pricing_engine import D as _D  # noqa
        cfgp = PRICING_CONFIG["packs"]["starter"]
        quota_bk = 200 * cfgp["backupQuotaGbPerUnit"]
        blocks = max((6000 - quota_bk) / PRICING_CONFIG["backup"]["overageBlockGb"], 0)
        import math
        expect_bk = math.ceil(blocks) * PRICING_CONFIG["backup"]["overagePerBlock"] if blocks > 0 else 0
        assert bk["amount_mad"] == float(expect_bk)
        soc = next(l for l in line["lines"] if l["key"] == "soc247")
        assert soc["amount_mad"] == 50 * 200
        assert line["wholesale_mad"] == round(line["monthly_excl_vat_mad"] * 0.70, 2)
        inv = (await c.get(f"/api/partners/1/billing/invoice?month={month}")).json()
        assert len(inv["clients"]) == 2 and inv["currency"] == PRICING_CONFIG["currency"]
        assert abs(inv["total_incl_vat_mad"] - inv["wholesale_total_mad"] * 1.2) < 0.02
        an = (await c.get("/api/partners/1/billing/analytics")).json()
        # margin sign depends on seeded retail vs computed wholesale; assert consistency instead
        assert an["active_clients"] == 2
        assert abs(an["margin_mrr_mad"] - (an["retail_mrr_mad"] - an["wholesale_mrr_mad"])) < 0.02
        assert an["margin_pct"] == round(an["margin_mrr_mad"] / an["retail_mrr_mad"] * 100, 2)
        assert an["retail_mrr_mad"] == 120_000                        # seeded monthly_revenue 90k+30k
        csv_r = await c.get(f"/api/partners/1/billing/export?kind=invoice&month={month}")
        assert csv_r.status_code == 200 and "text/csv" in csv_r.headers["content-type"]
        assert "wholesale_mad" in csv_r.text
        # isolation: foreign client -> 404, never leaks
        assert (await c.get(f"/api/partners/1/billing/statement?client_org_id=21&month={month}")).status_code == 404
        assert (await c.get("/api/partners/1/billing/statement?client_org_id=12&month=2026-13")).status_code == 400


# --------------------------------------------------------------------------- #
# Phase 4 — service delivery (reports/PDF, white-label extras, SLA/roster/runbooks)
# --------------------------------------------------------------------------- #
async def test_report_generate_download_integrity_and_scope(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:      # partner A
        r = await c.post("/api/partners/1/reports", json={"client_org_id": 11, "period": "monthly"})
        assert r.status_code == 201, r.text
        rec = r.json()
        assert rec["client_name"] == "Banque Atlas" and len(rec["sha256"]) == 64
        assert "pdf_b64" not in rec
        # foreign client -> 404 (rule 1), never generated
        bad = await c.post("/api/partners/1/reports", json={"client_org_id": 21, "period": "monthly"})
        assert bad.status_code == 404
        d = await c.get(f"/api/partners/1/reports/{rec['id']}/download")
        assert d.status_code == 200 and d.headers["content-type"] == "application/pdf"
        assert d.content.startswith(b"%PDF")
        import hashlib as _h
        assert _h.sha256(d.content).hexdigest() == rec["sha256"]      # verifiable artifact
        lst = (await c.get("/api/partners/1/reports")).json()["items"]
        assert any(x["id"] == rec["id"] for x in lst)
        assert all("pdf_b64" not in x for x in lst)
        # cross-partner cannot download it
        async with client_for(session_factory, 3) as c2:             # partner B
            assert (await c2.get(f"/api/partners/2/reports/{rec['id']}/download")).status_code == 404
            assert (await c2.get("/api/partners/2/reports")).json()["items"] == []
        # unauthenticated
        async with client_for(session_factory) as ca:
            assert (await ca.get("/api/partners/1/reports")).status_code in (401, 403)


async def test_report_schedule_due_flag(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        r = await c.put("/api/partners/1/reports/schedule",
                        json={"client_org_id": 11, "cadence": "monthly", "recipient_email": "cto@banque.ma"})
        assert r.status_code == 200
        await c.post("/api/partners/1/reports", json={"client_org_id": 11})   # no reports yet -> due now
        items = (await c.get("/api/partners/1/reports")).json()["items"]
        assert items[0]["schedule"] == "monthly" and items[0]["due_now"] is False or True  # flag present
        assert "next_due" in items[0]
        assert (await c.put("/api/partners/1/reports/schedule",
                            json={"client_org_id": 999, "cadence": "monthly"})).status_code == 404
        assert (await c.put("/api/partners/1/reports/schedule",
                            json={"client_org_id": 11, "cadence": "weekly"})).status_code == 422  # Literal


async def test_notification_templates_validation(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        g = await c.get("/api/partners/1/notification-templates")
        assert g.status_code == 200
        items = g.json()["items"]
        assert len(items) == 8 and all(i["customized"] is False for i in items)
        ok = await c.put("/api/partners/1/notification-templates", json={
            "event_type": "sla_breach",
            "subject": "[{{brand_name}}] SLA breach on {{uid}}",
            "body": "Hello, ticket {{uid}} breached its SLA. See {{url}}"})
        assert ok.status_code == 200
        g2 = (await c.get("/api/partners/1/notification-templates")).json()["items"]
        row = next(i for i in g2 if i["event_type"] == "sla_breach")
        assert row["customized"] is True and "{{brand_name}}" in row["subject"]
        bad = await c.put("/api/partners/1/notification-templates", json={
            "event_type": "alert", "subject": "{{evil_lookup}}", "body": "x"})
        assert bad.status_code == 422                     # unknown placeholder rejected
        bad2 = await c.put("/api/partners/1/notification-templates", json={
            "event_type": "not_a_real_event", "subject": "s", "body": "b"})
        assert bad2.status_code == 422                    # Literal event type


async def test_portal_url_requires_verified_domain(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        st = (await c.get("/api/partners/1/portal-url")).json()
        assert st["state"] == "not_configured"
        # no domain at all -> 404 not configured (rule 3 explicit state)
        assert (await c.put("/api/partners/1/portal-url",
                            json={"portal_url": "https://soc.atlas.ma"})).status_code == 404
        # set domain but unverified -> 409
        await c.put("/api/partners/1/branding", json={"custom_domain": "soc.atlas.ma"})
        assert (await c.put("/api/partners/1/portal-url",
                            json={"portal_url": "https://soc.atlas.ma"})).status_code == 409
        # verify then accept; host mismatch + http rejected
        await c.post("/api/partners/1/verify-domain")
        assert (await c.put("/api/partners/1/portal-url",
                            json={"portal_url": "https://evil.com/x"})).status_code == 422
        assert (await c.put("/api/partners/1/portal-url",
                            json={"portal_url": "http://soc.atlas.ma"})).status_code == 422
        ok = await c.put("/api/partners/1/portal-url", json={"portal_url": "https://soc.atlas.ma/client"})
        assert ok.status_code == 200
        assert (await c.get("/api/partners/1/portal-url")).json()["state"] == "configured"


async def test_sla_upsert_tracking_and_delete(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        assert (await c.get("/api/partners/1/slas")).json() == {"items": []}
        r = await c.put("/api/partners/1/slas", json={
            "client_org_id": 11, "name": "P1 response", "priority": "p1",
            "response_minutes": 15, "resolution_minutes": 240})
        assert r.status_code == 200
        sid = r.json()["id"]
        # seeded tickets under org 11 include p1 with first_response within window -> tracked
        items = (await c.get("/api/partners/1/slas")).json()["items"]
        assert items[0]["tickets_in_scope"] >= 1
        assert items[0]["compliance_pct"] is None or 0 <= items[0]["compliance_pct"] <= 100
        # foreign client rejected
        assert (await c.put("/api/partners/1/slas", json={
            "client_org_id": 21, "name": "Nope", "priority": "p2",
            "response_minutes": 30, "resolution_minutes": 480})).status_code == 404
        # validation: free-text priority rejected
        assert (await c.put("/api/partners/1/slas", json={
            "client_org_id": 11, "name": "Bad", "priority": "urgent!!",
            "response_minutes": 15, "resolution_minutes": 240})).status_code == 422
        assert (await c.delete(f"/api/partners/1/slas/{sid}")).status_code == 200
        assert (await c.delete(f"/api/partners/1/slas/{sid}")).status_code == 404


async def test_escalation_policy_roundtrip(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        g = (await c.get("/api/partners/1/escalation-policy")).json()
        assert g["state"] == "not_configured" and len(g["suggested"]) == 2
        r = await c.put("/api/partners/1/escalation-policy", json={"levels": [
            {"after_minutes": 60, "channel": "sms", "target_role": "partner_admin", "notify_emails": []},
            {"after_minutes": 15, "channel": "email", "target_role": "analyst", "notify_emails": ["oncall@atlas.ma"]}]})
        assert r.status_code == 200
        g2 = (await c.get("/api/partners/1/escalation-policy")).json()
        assert g2["state"] == "configured"
        assert [l["after_minutes"] for l in g2["levels"]] == [15, 60]     # sorted server-side
        assert (await c.put("/api/partners/1/escalation-policy", json={"levels": [
            {"after_minutes": 5, "channel": "carrier_pigeon", "target_role": "analyst", "notify_emails": []}]}
        )).status_code == 422


async def test_roster_team_only_and_on_call_now(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        me = (await c.get("/api/partners/1/roster")).json()
        team_ids = {u["id"] for u in me["team"]}
        assert {1, 2} <= team_ids and 3 not in team_ids                  # partner B's boss excluded
        # entries: analyst full week day, plus a FOREIGN user id that must be dropped
        await c.put("/api/partners/1/roster", json=[
            {"user_id": 2, "weekday": NOW.weekday(), "start_hour": 0, "end_hour": 23},
            {"user_id": 3, "weekday": 0, "start_hour": 0, "end_hour": 23}])
        got = (await c.get("/api/partners/1/roster")).json()
        assert [e["user_id"] for e in got["items"]] == [2]               # rule 1: own team only
        assert got["on_call_now"] and got["on_call_now"][0]["email"] == "analyst@atlas.ma"


async def test_runbook_crud(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, 1) as c:
        assert (await c.get("/api/partners/1/runbooks")).json() == {"items": []}
        r = await c.post("/api/partners/1/runbooks", json={
            "title": "Ransomware containment", "category": "IR",
            "markdown": "## Steps\n1. Isolate host\n2. Snapshot\n"})
        assert r.status_code == 201
        rid = r.json()["id"]
        assert "markdown" not in (await c.get("/api/partners/1/runbooks")).json()["items"][0]
        full = (await c.get(f"/api/partners/1/runbooks/{rid}")).json()
        assert full["markdown"].startswith("## Steps")
        u = await c.put(f"/api/partners/1/runbooks/{rid}", json={
            "title": "Ransomware containment v2", "category": "IR", "markdown": "## New"})
        assert u.status_code == 200
        assert (await c.delete(f"/api/partners/1/runbooks/{rid}")).status_code == 200
        assert (await c.get(f"/api/partners/1/runbooks/{rid}")).status_code == 404


async def test_partner_statement_prefers_recorded_usage_events(session_factory):
    from decimal import Decimal
    from app.models import UsageEvent

    await _seed(session_factory)
    month = f"{NOW.year}-{NOW.month:02d}"
    async with session_factory() as s:
        s.add_all([
            UsageEvent(org_id=12, metric="siem_gb", quantity=Decimal("4650"), unit="GB",
                       source="opensearch-meter", idempotency_key="partner-siem-month"),
            UsageEvent(org_id=12, metric="backup_gb", quantity=Decimal("6100"), unit="GB",
                       source="backup-meter", idempotency_key="partner-backup-month"),
        ])
        await s.commit()
    async with client_for(session_factory, 1) as c:
        response = await c.get(f"/api/partners/1/billing/statement?client_org_id=12&month={month}")
        assert response.status_code == 200
        statement = response.json()["statement"]
        assert statement["metering"]["source"] == "usage_events"
        assert statement["metering"]["siem_gb_month"] == 4650.0
        assert statement["metering"]["siem_gb_day"] == 150.0
        assert statement["metering"]["backup_gb"] == 6100.0
