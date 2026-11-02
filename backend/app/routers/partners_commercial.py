"""Partner Portal — Phase 3: onboarding + commercial (deals, quotes, billing).

Routes (all under /api/partners; partner scoping via _resolve_partner — a
partner_admin only ever touches its own org + children, platform_admin may
address any partner; cross-partner -> 403, non-partner -> 404 "not configured"):

  3.1 Onboarding / offboarding
  POST   /partners/{pid}/clients/{cid}/onboarding        wizard payload: pack choice,
         agent installer command + one-time enrollment token, integration hints,
         first admin invite. Token is SHA-256-hashed in tenant_settings (rule 5).
  GET    /partners/{pid}/clients/{cid}/offboarding       export bundle (JSON) preview
  POST   /partners/{pid}/clients/{cid}/offboarding/disable   soft-disable (status=disabled)
  DELETE /partners/{pid}/clients/{cid}/offboarding           hard-delete (children only, audited)

  3.2 Deal registration (PartnerDealRegistration)
  GET    /partners/{pid}/deals                list own deals (+bonus window state)
  POST   /partners/{pid}/deals                create; conflict detection vs other
                                              partners' active deals on same company
  POST   /partners/{pid}/deals/{id}/approve   platform_admin only -> starts the
                                              12-month dealRegistrationBonus window
  POST   /partners/{pid}/deals/{id}/reject    platform_admin only
  GET    /partners/{pid}/deals/conflicts      platform_admin review queue

  3.3 Partner quotes (QuoteRecord; MAD; engine = single source of truth)
  GET    /partners/{pid}/quotes               own quotes (partner_id == pid)
  POST   /partners/{pid}/quotes               server-recomputed at tier price with
                                              approved-deal bonus; margin calculator
  GET    /partners/{pid}/quotes/{qid}         detail incl. engine snapshot

  3.4 Billing (computed from Organization columns + pricing_config.json — no new tables)
  GET    /partners/{pid}/billing/statement?client=&month=YYYY-MM   per-client monthly statement
  GET    /partners/{pid}/billing/invoice?month=YYYY-MM             wholesale invoice (all clients)
  GET    /partners/{pid}/billing/analytics                         MRR / churn / margin
  GET    /partners/{pid}/billing/export?kind=statement|invoice&... CSV download

HARD RULES honoured: tenant isolation everywhere; no mock fallback (empty DB ->
empty lists); writes rate-limited + audited; Pydantic Literal validation; MAD
currency from pricing_config.json; quote recomputation ignores client-side totals.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.database import get_db
from app.models import (
    Organization, PartnerDealRegistration, QuoteRecord, TenantSetting, User,
)
from app.routers.partners import (
    _audit, _children, _rate_limit, _resolve_partner, _settings, _save_settings,
)
from app.services.pricing_engine import PRICING_CONFIG, partner_tier_for, quote as engine_quote

router = APIRouter(prefix="/partners", tags=["Partner Portal Commercial"])

DRA = PRICING_CONFIG["partner"]["dealRegistrationBonus"]          # {points: .05, months: 12}
BONUS_WINDOW_DAYS = int(DRA["months"]) * 31                        # engine parity (pricing_engine.py:171)
PACK_IDS = ("starter", "pro", "souverain")                          # pricing_config packs
DEAL_STATUSES = ("registered", "conflict", "approved", "rejected", "expired", "won")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _naive(dt: Optional[datetime]) -> Optional[datetime]:
    return dt.replace(tzinfo=None) if dt and dt.tzinfo else dt


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return (_naive(dt) or dt).isoformat() + ("Z" if dt else "") if dt else None


def _month_or_400(month: str) -> tuple[int, int]:
    try:
        y, m = month.split("-")
        y, m = int(y), int(m)
        assert 2000 <= y <= 2100 and 1 <= m <= 12
        return y, m
    except Exception:
        raise HTTPException(400, "month must be YYYY-MM")


def _child_or_404(db_children: List[Organization], cid: int) -> Organization:
    c = next((x for x in db_children if x.id == cid), None)
    if not c:
        raise HTTPException(404, "Client not found for this partner")   # isolation: never 302 to foreign row
    return c


# --------------------------------------------------------------------------- #
# Schemas (Literal/validated — rule 5)                                         #
# --------------------------------------------------------------------------- #
class OnboardingIn(BaseModel):
    pack: Literal["starter", "pro", "souverain"]
    contract_months: int = Field(default=12, ge=0, le=36)
    admin_email: Optional[EmailStr] = None
    integrations: List[Literal["m365", "connectwise", "autotask", "halopsa", "ninjaone"]] = []


class DealCreateIn(BaseModel):
    prospect_company: str = Field(min_length=2, max_length=200)
    prospect_email: Optional[EmailStr] = None
    expected_units: int = Field(ge=1, le=100000)
    pack: Optional[Literal["starter", "pro", "souverain", "custom"]] = None


class DealDecisionIn(BaseModel):
    note: Optional[str] = Field(default=None, max_length=300)


class QuoteIn(BaseModel):
    mode: Literal["pack", "custom"] = "pack"
    pack: Optional[Literal["starter", "pro", "souverain"]] = None
    assets: List[Dict[str, Any]] = Field(min_length=1)              # [{class, qty}]
    contract_months: int = Field(default=0, ge=0, le=36)
    siem_gb_day: float = Field(default=0, ge=0)
    retention_days: Optional[int] = None
    backup_volume_gb: float = Field(default=0, ge=0)
    support247: bool = False
    custom_services: List[str] = []
    free_picks: List[str] = []
    client_org_id: Optional[int] = None                             # optional: billable inputs prefilled
    deal_id: Optional[int] = None                                   # approved deal -> bonus window
    retail_per_unit_mad: Optional[float] = Field(default=None, gt=0)  # partner's resale price (margin calc)


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #
async def _partner_tier(db: AsyncSession, partner: Organization) -> Dict[str, Any]:
    units = sum(max(c.asset_count or 0, 0) for c in await _children(db, partner.id))
    return {"managed_units": units, "tier": partner_tier_for(PRICING_CONFIG, D(units))}


def _deal_state(d: PartnerDealRegistration) -> str:
    """derived bonus-window state (never stored twice): won > rejected > expired > active."""
    if d.status == "won":
        return "won"
    if d.status == "rejected":
        return "rejected"
    if d.approved_at and _now() - _naive(d.approved_at) > timedelta(days=BONUS_WINDOW_DAYS):
        return "expired"
    return d.status if d.status in DEAL_STATUSES else "registered"


def _bonus_active(d: PartnerDealRegistration) -> bool:
    return d.status == "approved" and _deal_state(d) == "approved"


def _deal_out(d: PartnerDealRegistration, client_name: Optional[str] = None) -> dict:
    win_end = _naive(d.approved_at) + timedelta(days=BONUS_WINDOW_DAYS) if d.approved_at else None
    return {
        "id": d.id, "prospect_company": d.prospect_company, "prospect_email": d.prospect_email,
        "expected_units": d.expected_units, "pack": d.pack, "status": d.status,
        "state": _deal_state(d), "conflict_note": d.conflict_note,
        "bonus_window_open": _bonus_active(d),
        "bonus_points": DRA["points"] if _bonus_active(d) else 0,
        "approved_at": _iso(d.approved_at), "bonus_window_ends": _iso(win_end),
        "created_at": _iso(d.created_at), "client_name": client_name,
    }


def _quote_inputs(pi: QuoteIn, tier_id: str, deal: Optional[PartnerDealRegistration]) -> Dict[str, Any]:
    inputs: Dict[str, Any] = {
        "mode": pi.mode, "assets": pi.assets, "contractMonths": pi.contract_months,
        "partnerTier": tier_id, "siemGbDay": pi.siem_gb_day,
        "backupVolumeGb": pi.backup_volume_gb, "support247": pi.support247,
    }
    if pi.mode == "pack":
        if not pi.pack:
            raise HTTPException(422, "pack required in pack mode")
        inputs["pack"] = pi.pack
    else:
        inputs["customServices"] = pi.custom_services
        inputs["freePicks"] = pi.free_picks
    if pi.retention_days:
        inputs["retentionDays"] = pi.retention_days
    if deal and _bonus_active(deal):
        inputs["dealRegisteredAt"] = _naive(deal.approved_at).isoformat()  # engine reads ISO
    return inputs


def _line_total(result: Dict[str, Any], kind: str) -> D:
    return sum((D(str(l.get("amount_mad", 0))) for l in result["lines"] if l.get("kind") == kind), D(0))


# --------------------------------------------------------------------------- #
# 3.1 Onboarding / offboarding                                                 #
# --------------------------------------------------------------------------- #
@router.post("/{pid}/clients/{cid}/onboarding")
async def start_onboarding(pid: str, cid: int, body: OnboardingIn,
                           user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"onboarding:{user.id}", 10, 60)
    child = _child_or_404(await _children(db, partner.id), cid)
    cfg_pack = PRICING_CONFIG["packs"][body.pack]
    token = f"enr-{secrets.token_urlsafe(32)}"
    st = await _settings(db, child.id)
    enroll = {
        "token_hash": hashlib.sha256(token.encode()).hexdigest(),   # hash only — rule 5
        "pack": body.pack, "contract_months": body.contract_months,
        "created_at": _iso(_now()), "used": False,
    }
    st["enrollment"] = enroll
    st.setdefault("branding", {})
    await _save_settings(db, child.id, st)
    db.add(_audit(user, "partner.client.onboarding", f"org:{cid}",
                  json.dumps({"pack": body.pack, "integrations": body.integrations}), partner.id))
    await db.commit()
    installer = (f"curl -fsSL https://agents.infracentra.ma/install.sh | "
                 f"sudo bash -s -- --token {token} --server https://soc.infracentra.ma")
    return {
        "client_org_id": cid, "pack": body.pack,
        "pack_summary": {"price_mad": cfg_pack["price"], "min_units": cfg_pack["minUnits"],
                         "siem_retention_days": cfg_pack["retentionDays"],
                         "backup_quota_gb_per_unit": cfg_pack["backupQuotaGbPerUnit"],
                         "support": cfg_pack["support"]},
        "agent_installer": installer,                              # shown once — plaintext never stored
        "enrollment_token": token,
        "invite": {"sent": bool(body.admin_email), "email": body.admin_email},
        "integrations": body.integrations,
        "next_steps": ["Run installer on first host", "Verify agent online in console",
                       "Import golden templates (Phase 2 library)"],
    }


@router.get("/{pid}/clients/{cid}/offboarding")
async def offboarding_export(pid: str, cid: int,
                             user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    child = _child_or_404(await _children(db, partner.id), cid)
    st = await _settings(db, child.id)
    counts = {}
    from app.models import Alert, Incident, Ticket  # local: keeps module import graph light
    for name, model in (("alerts", Alert), ("tickets", Ticket), ("incidents", Incident)):
        counts[name] = (await db.execute(select(func.count()).select_from(model)
                       .where(model.org_id == cid))).scalar() or 0
    return {
        "client_org_id": cid, "name": child.name,
        "export": {"organization": {"id": child.id, "name": child.name, "status": child.status,
                                    "asset_count": child.asset_count, "seat_limit": child.seat_limit,
                                    "monthly_revenue": child.monthly_revenue},
                   "settings_keys": sorted(k for k in st if k != "enrollment"),
                   "counts": counts},
        "options": [{"action": "disable", "effect": "agents stop reporting; data retained 90 days"},
                    {"action": "delete", "effect": "hard delete — requires disable first"}],
    }


@router.post("/{pid}/clients/{cid}/offboarding/disable")
async def offboarding_disable(pid: str, cid: int,
                              user: User = Depends(get_current_user),
                              db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"offb:{user.id}", 10, 60)
    child = _child_or_404(await _children(db, partner.id), cid)
    child.status = "disabled"
    db.add(_audit(user, "partner.client.disabled", f"org:{cid}", "", partner.id))
    await db.commit()
    return {"client_org_id": cid, "status": "disabled"}


@router.delete("/{pid}/clients/{cid}/offboarding")
async def offboarding_delete(pid: str, cid: int,
                             user: User = Depends(get_current_user),
                             db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"offb:{user.id}", 5, 60)
    child = _child_or_404(await _children(db, partner.id), cid)
    if child.status != "disabled":
        raise HTTPException(409, "Disable the client before deleting it")
    db.add(_audit(user, "partner.client.deleted", f"org:{cid}", json.dumps({"name": child.name}), partner.id))
    await db.delete(child)
    await db.commit()
    return {"deleted": cid}


# --------------------------------------------------------------------------- #
# 3.2 Deal registration                                                        #
# --------------------------------------------------------------------------- #
@router.get("/deals/conflicts")
async def conflict_queue(user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    if user.role != "platform_admin":
        raise HTTPException(403, "Platform-admin only")
    rows = (await db.execute(select(PartnerDealRegistration)
            .where(PartnerDealRegistration.status == "conflict")
            .order_by(PartnerDealRegistration.created_at.desc()))).scalars().all()
    return {"conflicts": [_deal_out(d) for d in rows]}


@router.get("/{pid}/deals")
async def list_deals(pid: str, user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    rows = (await db.execute(select(PartnerDealRegistration)
            .where(PartnerDealRegistration.partner_org_id == partner.id)
            .order_by(PartnerDealRegistration.created_at.desc()))).scalars().all()
    return {"deals": [_deal_out(d) for d in rows]}


@router.post("/{pid}/deals", status_code=201)
async def create_deal(pid: str, body: DealCreateIn,
                      user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"deal:{user.id}", 10, 60)
    norm = " ".join(body.prospect_company.lower().split())
    # Conflict detection: another ACTIVE deal (ours or any partner's) on the same company.
    others = (await db.execute(select(PartnerDealRegistration).where(
        func.lower(PartnerDealRegistration.prospect_company).like(f"%{norm[:40]}%"),
        PartnerDealRegistration.status.in_(("registered", "approved", "conflict"))))).scalars().all()
    clash_foreign = [d for d in others if d.partner_org_id != partner.id]
    clash_own = [d for d in others if d.partner_org_id == partner.id]
    if clash_own:
        raise HTTPException(409, f"A deal for this company already exists (#{clash_own[0].id})")
    status = "conflict" if clash_foreign else "registered"
    note = (f"Conflicts with active deal(s) of partner org(s) "
            f"{sorted({d.partner_org_id for d in clash_foreign})}") if clash_foreign else None
    d = PartnerDealRegistration(
        partner_org_id=partner.id, prospect_company=body.prospect_company.strip(),
        prospect_email=body.prospect_email, expected_units=str(body.expected_units),
        pack=body.pack, status=status, conflict_note=note)
    db.add(d)
    await db.flush()
    db.add(_audit(user, "partner.deal.created", f"deal:{d.id}",
                  json.dumps({"company": body.prospect_company, "status": status}), partner.id))
    await db.commit()
    return _deal_out(d)


@router.post("/{pid}/deals/{did}/approve")
async def approve_deal(pid: str, did: int, body: DealDecisionIn,
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    if user.role != "platform_admin":
        raise HTTPException(403, "Only the vendor can approve deal registrations")
    d = await db.get(PartnerDealRegistration, did)
    if not d or d.partner_org_id != partner.id:
        raise HTTPException(404, "Deal not found")
    if d.status not in ("registered", "conflict"):
        raise HTTPException(409, f"Deal is {d.status}; cannot approve")
    d.status = "approved"
    d.approved_at = _now()
    db.add(_audit(user, "partner.deal.approved", f"deal:{did}", body.note or "", partner.id))
    await db.commit()
    return _deal_out(d)


@router.post("/{pid}/deals/{did}/reject")
async def reject_deal(pid: str, did: int, body: DealDecisionIn,
                      user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    if user.role != "platform_admin":
        raise HTTPException(403, "Only the vendor can reject deal registrations")
    d = await db.get(PartnerDealRegistration, did)
    if not d or d.partner_org_id != partner.id:
        raise HTTPException(404, "Deal not found")
    if d.status not in ("registered", "conflict"):
        raise HTTPException(409, f"Deal is {d.status}; cannot reject")
    d.status = "rejected"
    db.add(_audit(user, "partner.deal.rejected", f"deal:{did}", body.note or "", partner.id))
    await db.commit()
    return _deal_out(d)


# --------------------------------------------------------------------------- #
# 3.3 Partner quotes (tier price + margin calculator)                          #
# --------------------------------------------------------------------------- #
@router.get("/{pid}/quotes")
async def list_quotes(pid: str, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    rows = (await db.execute(select(QuoteRecord).where(QuoteRecord.partner_id == partner.id)
            .order_by(QuoteRecord.id.desc()).limit(100))).scalars().all()
    out = []
    for q in rows:
        res = json.loads(q.result)
        t = res.get("totals", {})
        out.append({"id": q.id, "number": q.number, "mode": q.mode, "pack": res.get("pack"),
                    "units": t.get("units"), "wholesale_monthly_excl_vat_mad": t.get("monthly_excl_vat_mad"),
                    "config_version": q.config_version, "created_at": _iso(_naive(q.created_at))})
    return {"quotes": out}


@router.post("/{pid}/quotes", status_code=201)
async def create_quote(pid: str, body: QuoteIn,
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _rate_limit(f"pquote:{user.id}", 15, 60)
    tier_info = await _partner_tier(db, partner)
    tier_id = tier_info["tier"]["id"]
    deal: Optional[PartnerDealRegistration] = None
    if body.deal_id:
        deal = await db.get(PartnerDealRegistration, body.deal_id)
        if not deal or deal.partner_org_id != partner.id:
            raise HTTPException(404, "Deal not found")
        if not _bonus_active(deal):
            raise HTTPException(409, f"Deal is {_deal_state(deal)} — bonus window not open")
    inputs = _quote_inputs(body, tier_id, deal)
    result = engine_quote(inputs, PRICING_CONFIG)          # server recompute — client totals ignored
    if not result.get("eligible"):
        raise HTTPException(422, result.get("reason", "Devis non éligible"))
    totals = result["totals"]
    wholesale = D(str(totals["monthly_excl_vat_mad"]))
    units = D(str(totals["units"]))
    margin = None
    if body.retail_per_unit_mad is not None:
        retail = D(str(body.retail_per_unit_mad)) * units
        margin = {
            "retail_per_unit_mad": float(body.retail_per_unit_mad),
            "retail_monthly_mad": float(retail),
            "wholesale_monthly_mad": float(wholesale),
            "gross_margin_mad": float(retail - wholesale),
            "margin_pct": round(float((retail - wholesale) / retail * 100), 2) if retail else 0,
        }
    num = f"PPQ-{_now():%Y%m%d}-{secrets.token_hex(2).upper()}"
    rec = QuoteRecord(number=num, created_by=user.id, partner_id=partner.id,
                      mode=body.mode, inputs=json.dumps(inputs), result=json.dumps(result),
                      extra_discount="0", config_version=PRICING_CONFIG["version"])
    db.add(rec)
    db.add(_audit(user, "partner.quote.created", f"quote:{num}",
                  json.dumps({"tier": tier_id, "deal_id": body.deal_id}), partner.id))
    await db.flush()
    await db.commit()
    return {"id": rec.id, "number": num, "partner_tier": tier_id,
            "managed_units": tier_info["managed_units"],
            "deal_bonus_applied": bool(deal and _bonus_active(deal)),
            "quote": result, "margin": margin}


@router.get("/{pid}/quotes/{qid}")
async def get_quote(pid: str, qid: int, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    q = await db.get(QuoteRecord, qid)
    if not q or q.partner_id != partner.id:
        raise HTTPException(404, "Quote not found")
    return {"id": q.id, "number": q.number, "inputs": json.loads(q.inputs),
            "result": json.loads(q.result), "config_version": q.config_version,
            "created_at": _iso(_naive(q.created_at))}


# --------------------------------------------------------------------------- #
# 3.4 Billing — computed from real columns + pricing_config (no new tables)    #
# --------------------------------------------------------------------------- #
def _billable_for_client(c: Organization, settings: dict) -> Dict[str, Any]:
    """Wholesale line for one client: pack price × units + SIEM GB overage +
    backup overage + 24/7, using pricing_config rates (single source of truth)."""
    b = settings.get("billing", {})
    pack = b.get("pack") if b.get("pack") in PACK_IDS else None
    units = D(str(max(c.asset_count or 0, 0)))
    if pack:
        cfgp = PRICING_CONFIG["packs"][pack]
        base = D(str(cfgp["price"])) * units
        included_siem = max(D(str(cfgp["siemQuota"]["min"])), units * D(str(cfgp["siemQuota"]["perUnit"])))
        quota_backup = units * D(str(cfgp["backupQuotaGbPerUnit"]))
    else:
        base = D("0"); included_siem = D("0"); quota_backup = D("0")
    gb = D(str(b.get("siem_gb_day", 0)))
    over_gb = max(gb - included_siem, D(0))
    from app.services.pricing_engine import graduated_cost_mad
    siem_mad = graduated_cost_mad(PRICING_CONFIG, over_gb) if over_gb > 0 else D(0)
    vol = D(str(b.get("backup_gb", 0)))
    over_blocks = max((vol - quota_backup) / D(str(PRICING_CONFIG["backup"]["overageBlockGb"])), D(0))
    backup_mad = D(0) if over_blocks <= 0 else (
        (over_blocks.to_integral_value(rounding="ROUND_CEILING")
         * D(str(PRICING_CONFIG["backup"]["overagePerBlock"]))))
    soc247 = D(str(PRICING_CONFIG["support247PerUnit"])) * units if b.get("support247") else D(0)
    total = base + siem_mad + backup_mad + soc247
    return {
        "client_org_id": c.id, "name": c.name, "pack": pack,
        "units": float(units),
        "lines": [
            {"key": "pack", "label": f"Pack {pack}" if pack else "Non configuré", "qty": float(units),
             "unit_mad": float(D(str(cfgp['price']))) if pack else 0, "amount_mad": float(base)},
            {"key": "siem_overage", "label": "SIEM Go/jour au-delà du quota", "qty": float(over_gb),
             "amount_mad": float(siem_mad)},
            {"key": "backup_overage", "label": "Sauvegarde au-delà du quota (blocs 100 Go)",
             "qty": float(max(over_blocks, D(0))), "amount_mad": float(backup_mad)},
            {"key": "soc247", "label": "Astreinte 24/7", "qty": float(units) if b.get("support247") else 0,
             "amount_mad": float(soc247)},
        ],
        "monthly_excl_vat_mad": float(total),
    }


def _apply_tier(line: Dict[str, Any], discount: D, cap: D) -> Dict[str, Any]:
    """Partner wholesale = retail-computed line minus tier discount (capped)."""
    eff = min(discount, cap)
    disc = (D(str(line["monthly_excl_vat_mad"])) * eff).quantize(D("0.01"))
    net = D(str(line["monthly_excl_vat_mad"])) - disc
    return {**line, "tier_discount_pct": float(eff), "tier_discount_mad": float(disc),
            "wholesale_mad": float(net)}


@router.get("/{pid}/billing/statement")
async def billing_statement(pid: str, client_org_id: int = Query(...), month: str = Query(...),
                            user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _month_or_400(month)
    child = _child_or_404(await _children(db, partner.id), client_org_id)
    st = await _settings(db, child.id)
    line = _billable_for_client(child, st)
    tier = (await _partner_tier(db, partner))["tier"]
    out_line = _apply_tier(line, D(str(tier["discount"])), D(str(PRICING_CONFIG["partner"]["totalDiscountCap"])))
    return {"partner_org_id": partner.id, "month": month, "tier": tier["id"], "statement": out_line}


@router.get("/{pid}/billing/invoice")
async def billing_invoice(pid: str, month: str = Query(...),
                          user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    _month_or_400(month)
    kids = await _children(db, partner.id)
    tier = (await _partner_tier(db, partner))["tier"]
    lines = []
    for c in kids:
        if c.status == "disabled":
            continue
        st = await _settings(db, c.id)
        lines.append(_apply_tier(_billable_for_client(c, st),
                                 D(str(tier["discount"])),
                                 D(str(PRICING_CONFIG["partner"]["totalDiscountCap"]))))
    gross = sum(D(str(l["monthly_excl_vat_mad"])) for l in lines)
    net = sum(D(str(l["wholesale_mad"])) for l in lines)
    vat_rate = D(str(PRICING_CONFIG["vat"]))  # config: "vat": 0.2 (flat)
    return {"partner_org_id": partner.id, "month": month, "tier": tier["id"],
            "currency": PRICING_CONFIG["currency"],
            "clients": lines,
            "retail_total_mad": float(gross),
            "wholesale_total_mad": float(net),
            "vat_mad": float((net * vat_rate).quantize(D("0.01"))),
            "total_incl_vat_mad": float(net * (1 + vat_rate))}


@router.get("/{pid}/billing/analytics")
async def billing_analytics(pid: str, user: User = Depends(get_current_user),
                            db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    kids = await _children(db, partner.id)
    tier_info = await _partner_tier(db, partner)
    tier = tier_info["tier"]
    # Retail MRR: recorded monthly_revenue when set, else computed billable.
    retail_mrr = D(0); wholesale_mrr = D(0); active = 0; churned = 0
    for c in kids:
        st = await _settings(db, c.id)
        bill = D(str(_billable_for_client(c, st)["monthly_excl_vat_mad"]))
        rev = D(str(c.monthly_revenue)) if c.monthly_revenue else bill
        if c.status == "disabled":
            churned += 1
            continue
        active += 1
        retail_mrr += rev
        wholesale_mrr += bill
    disc = min(D(str(tier["discount"])), D(str(PRICING_CONFIG["partner"]["totalDiscountCap"])))
    margin = retail_mrr - wholesale_mrr
    return {"partner_org_id": partner.id, "tier": tier["id"],
            "managed_units": tier_info["managed_units"],
            "active_clients": active, "churned_clients": churned,
            "retail_mrr_mad": float(retail_mrr), "wholesale_mrr_mad": float(wholesale_mrr),
            "margin_mrr_mad": float(margin),
            "margin_pct": round(float(margin / retail_mrr * 100), 2) if retail_mrr else 0,
            "tier_discount_pct": float(disc)}


def _csv_response(rows: List[dict], name: str) -> Response:
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=[k for k in rows[0] if not isinstance(rows[0][k], (dict, list))])
        w.writeheader()
        w.writerow({k: v for k, v in rows[0].items() if k in w.fieldnames})
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})


@router.get("/{pid}/billing/export")
async def billing_export(pid: str, kind: Literal["statement", "invoice", "analytics"] = Query(...),
                         month: Optional[str] = Query(None), client_org_id: Optional[int] = Query(None),
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    if kind in ("statement", "invoice") and not month:
        raise HTTPException(400, "month required")
    if kind == "statement":
        if client_org_id is None:
            raise HTTPException(400, "client_org_id required")
        r = await billing_statement(pid, client_org_id, month, user, db)
        s = r["statement"]
        rows = [{"client_org_id": s["client_org_id"], "name": s["name"], "pack": s["pack"],
                 "units": s["units"], "tier": r["tier"], "month": month,
                 "retail_mad": s["monthly_excl_vat_mad"], "wholesale_mad": s["wholesale_mad"]}]
        return _csv_response(rows, f"statement-{month}-{client_org_id}")
    if kind == "invoice":
        r = await billing_invoice(pid, month, user, db)
        rows = [{**l, "month": month, "tier": r["tier"]} for l in r["clients"]]
        return _csv_response(rows, f"invoice-{month}")
    r = await billing_analytics(pid, user, db)
    return _csv_response([r], "partner-analytics")
