"""INFRAvx — Pricing v2 API (per-asset packs, Health Check, sales, partners, upsell).

All money math is delegated to the PURE engine (app.services.pricing_engine) —
this router never computes prices inline and NEVER trusts client totals:
quotes are recomputed server-side from raw inputs.

Access rules
------------
* public            : GET /pricing/config, POST /pricing/leads, POST /health-checks
* token-gated       : GET /pricing/quote-links/{token}  (private expiring calculator link)
* sales + platform  : lead inbox, quote links CRUD, quotes CRUD/export
* partner_admin     : deals, partner quotes, partner-run health checks
* any authenticated : POST /upsell/events|requests (org comes from the JWT only)

tenant_id is NEVER taken from body/URL for isolation — it comes from the JWT.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user, require_role
from app.database import get_db
from app.models import (
    AuditLog, HealthCheck, Organization, PartnerDealRegistration, PlanEntitlementV2,
    PricingConfigVersion, PricingLead, QuoteLink, QuoteRecord, UpsellEvent, User,
)
from app.services.pricing_engine import PRICING_CONFIG, quote as engine_quote, partner_tier_for

router = APIRouter(tags=["Pricing v2"])
v1_router = APIRouter(prefix="/v1/pricing", tags=["Pricing v2 (public)"])

# ---------------------------------------------------------------------------
# tiny in-memory rate limiter (per-process; swap for Redis in multi-worker prod)
# ---------------------------------------------------------------------------
_rl: Dict[str, List[float]] = {}


def _rate_limit(key: str, max_calls: int = 5, window_s: int = 60):
    now = datetime.now(timezone.utc).timestamp()
    arr = [t for t in _rl.get(key, []) if now - t < window_s]
    if len(arr) >= max_calls:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Trop de requêtes — réessayez dans une minute.")
    arr.append(now)
    _rl[key] = arr


def _ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?"))


async def _audit(db: AsyncSession, user: Optional[User], action: str, resource: str,
                 resource_id: str, details: str, org_id: Optional[int] = None):
    db.add(AuditLog(
        actor_id=user.id if user else None,
        actor_name=(user.name or user.email) if user else "anonymous",
        actor_role=user.role if user else "public",
        org_id=org_id, action=action, resource=resource,
        resource_id=resource_id, details=details, outcome="success",
    ))
    await db.commit()


def _sales_or_admin(user: User) -> User:
    if user.role not in ("sales", "platform_admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Réservé à l'équipe commerciale.")
    return user


# ---------------------------------------------------------------------------
# Public: config + leads
# ---------------------------------------------------------------------------
@v1_router.get("/config")
async def get_pricing_config():
    """Public versioned pricing config (single source of truth).

    Carries `packDetails` — the LIVE pack composition edited by the platform
    admin in the Pack Customizer (/admin/packs), seeded with the shipped
    defaults. Clients derive PACK_SERVICES from it, never hardcode."""
    return _live_config


class LeadIn(BaseModel):
    company: str = Field(min_length=2, max_length=200)
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=200)
    phone: Optional[str] = None
    country: Optional[str] = None
    lang: str = "fr"
    asset_counts: Optional[Dict[str, int]] = None
    interests: Optional[List[str]] = None
    message: Optional[str] = None
    contact_prefs: Optional[List[str]] = None
    consent: bool = False
    website: Optional[str] = None          # honeypot — must stay empty


@v1_router.post("/leads", status_code=201)
async def create_lead(body: LeadIn, request: Request, db: AsyncSession = Depends(get_db)):
    if body.website:                        # bot trap
        return {"ok": True}                 # silently swallow bots
    if not body.consent:
        raise HTTPException(400, "Le consentement (loi 09-08 / CNDP) est requis.")
    _rate_limit(f"lead:{_ip(request)}", 5, 60)
    lead = PricingLead(
        company=body.company, name=body.name, email=body.email.lower(),
        phone=body.phone, country=body.country, lang=body.lang,
        asset_counts=json.dumps(body.asset_counts or {}),
        interests=json.dumps(body.interests or []),
        message=body.message, contact_prefs=json.dumps(body.contact_prefs or []),
        consent=True,
    )
    db.add(lead)
    await db.commit()
    await db.refresh(lead)
    await _audit(db, None, "pricing.lead.created", "pricing_lead", str(lead.id),
                 f"lead from {body.email}")
    return {"ok": True, "id": lead.id,
            "message": "Un conseiller commercial vous enverra un calculateur personnel ou réalisera le calcul avec vous."}


@v1_router.get("/leads")
async def list_leads(status_f: Optional[str] = None,
                    db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    _sales_or_admin(user)
    q = select(PricingLead).order_by(PricingLead.created_at.desc())
    if status_f:
        q = q.where(PricingLead.status == status_f)
    rows = (await db.execute(q)).scalars().all()
    return [{
        "id": r.id, "company": r.company, "name": r.name, "email": r.email,
        "phone": r.phone, "country": r.country, "lang": r.lang,
        "asset_counts": json.loads(r.asset_counts or "{}"),
        "interests": json.loads(r.interests or "[]"),
        "message": r.message, "contact_prefs": json.loads(r.contact_prefs or "[]"),
        "status": r.status, "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]


@v1_router.patch("/leads/{lead_id}")
async def patch_lead(lead_id: int, body: Dict[str, Any], db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    _sales_or_admin(user)
    lead = (await db.execute(select(PricingLead).where(PricingLead.id == lead_id))).scalar_one_or_none()
    if not lead:
        raise HTTPException(404, "Lead introuvable")
    if body.get("status") in ("new", "contacted", "qualified", "won", "lost"):
        lead.status = body["status"]
    if body.get("assigned_to"):
        lead.assigned_to = int(body["assigned_to"])
    await db.commit()
    await _audit(db, user, "pricing.lead.updated", "pricing_lead", str(lead_id),
                 json.dumps({k: body.get(k) for k in ("status", "assigned_to") if k in body}))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Sales: private expiring calculator links
# ---------------------------------------------------------------------------
class QuoteLinkIn(BaseModel):
    lead_id: Optional[int] = None
    prefill: Optional[Dict[str, Any]] = None
    expiry_days: int = Field(default=14, ge=1, le=90)
    lock_email: Optional[str] = None


@v1_router.post("/quote-links", status_code=201)
async def create_quote_link(body: QuoteLinkIn, db: AsyncSession = Depends(get_db),
                            user: User = Depends(get_current_user)):
    _sales_or_admin(user)
    token = secrets.token_urlsafe(32)               # 32+ random bytes, stored hashed only
    thash = hashlib.sha256(token.encode()).hexdigest()
    link = QuoteLink(
        token_hash=thash, lead_id=body.lead_id, created_by=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=body.expiry_days),
        prefill=json.dumps(body.prefill or {}), lock_email=body.lock_email,
        max_extra_discount="0.05" if user.role == "sales" else "1.0",
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    await _audit(db, user, "pricing.quote_link.created", "quote_link", str(link.id),
                 f"expiry={body.expiry_days}d lead={body.lead_id}")
    # secret shown exactly once
    return {"id": link.id, "token": token, "url_path": f"#/quote/{token}",
            "expires_at": link.expires_at.isoformat()}


@v1_router.get("/quote-links")
async def list_quote_links(db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_current_user)):
    _sales_or_admin(user)
    rows = (await db.execute(select(QuoteLink).order_by(QuoteLink.created_at.desc()))).scalars().all()
    return [{
        "id": r.id, "lead_id": r.lead_id, "created_by": r.created_by,
        "expires_at": r.expires_at.isoformat() if r.expires_at else None,
        "revoked_at": r.revoked_at.isoformat() if r.revoked_at else None,
        "view_count": r.view_count, "prefill": json.loads(r.prefill or "{}"),
        "lock_email": r.lock_email,
    } for r in rows]


@v1_router.post("/quote-links/{link_id}/revoke")
async def revoke_quote_link(link_id: int, db: AsyncSession = Depends(get_db),
                            user: User = Depends(get_current_user)):
    _sales_or_admin(user)
    link = (await db.execute(select(QuoteLink).where(QuoteLink.id == link_id))).scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Lien introuvable")
    link.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    await _audit(db, user, "pricing.quote_link.revoked", "quote_link", str(link_id), "")
    return {"ok": True}


@v1_router.get("/quote-links/by-token/{token}")
async def view_quote_link(token: str, db: AsyncSession = Depends(get_db)):
    """Token-gated public read for the private calculator (#/quote/:token)."""
    thash = hashlib.sha256(token.encode()).hexdigest()
    link = (await db.execute(select(QuoteLink).where(QuoteLink.token_hash == thash))).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if link is None:
        raise HTTPException(404, "Lien de devis invalide.")
    if link.revoked_at is not None:
        raise HTTPException(410, "Ce lien de devis a été révoqué. Contactez votre conseiller.")
    exp = link.expires_at
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp < now:
        raise HTTPException(410, "Ce lien de devis a expiré. Contactez votre conseiller pour un nouveau lien.")
    link.view_count = (link.view_count or 0) + 1
    await db.commit()
    await _audit(db, None, "pricing.quote_link.viewed", "quote_link", str(link.id), "")
    return {"prefill": json.loads(link.prefill or "{}"),
            "expires_at": exp.isoformat() if exp else None,
            "lock_email": bool(link.lock_email),
            "config_version": PRICING_CONFIG["version"]}


# ---------------------------------------------------------------------------
# Quotes (server-recomputed; client totals ignored)
# ---------------------------------------------------------------------------
class QuoteCreateIn(BaseModel):
    inputs: Dict[str, Any]
    lead_id: Optional[int] = None
    extra_discount: float = Field(default=0.0, ge=0, le=1)
    discount_reason: Optional[str] = None


def _apply_extra_discount(result: Dict[str, Any], pct: float, cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Role-capped manual discount applied on top of the engine output (recomputed)."""
    if pct <= 0:
        return result
    from decimal import ROUND_HALF_UP
    D = Decimal
    t = result["totals"]
    base = D(str(t["monthly_excl_vat_mad"]))
    disc = (base * D(str(pct))).quantize(D("0.01"), rounding=ROUND_HALF_UP)
    net = base - disc
    vat = (net * D(str(cfg["vat"]))).quantize(D("0.01"), rounding=ROUND_HALF_UP)
    result["lines"].append({"key": "extra_discount",
                            "label_fr": f"Remise commerciale additionnelle ({int(pct*100)} %)",
                            "amount_mad": -float(disc), "kind": "discount"})
    t["contract_discount_mad"] = round(t["contract_discount_mad"] + float(disc), 2)
    t["monthly_excl_vat_mad"] = float(net)
    t["vat_mad"] = float(vat)
    t["monthly_incl_vat_mad"] = float(net + vat)
    t["annual_excl_vat_mad"] = float(net * 12)
    t["first_year_incl_vat_mad"] = round(float(net * 12 + vat * 12 + D(str(t["onboarding_mad"]))), 2)
    return result


@v1_router.post("/quotes", status_code=201)
async def create_quote(body: QuoteCreateIn, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    if user.role not in ("sales", "platform_admin", "partner_admin"):
        raise HTTPException(403, "Non autorisé")
    inputs = dict(body.inputs or {})
    # Recompute server-side — ignore anything the client claims about totals.
    result = engine_quote(inputs, PRICING_CONFIG)
    if not result.get("eligible"):
        raise HTTPException(422, result.get("reason", "Devis non éligible"))
    cap = 0.05 if user.role == "sales" else 1.0
    if user.role == "platform_admin":
        if not body.discount_reason:
            raise HTTPException(400, "Une raison est requise pour toute remise au-delà du barème.")
    pct = min(body.extra_discount, cap)
    result = _apply_extra_discount(result, pct, PRICING_CONFIG)
    num = f"IC-Q-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(2).upper()}"
    rec = QuoteRecord(
        number=num, created_by=user.id, lead_id=body.lead_id,
        partner_id=user.org_id if user.role == "partner_admin" else None,
        mode=inputs.get("mode", "pack"), inputs=json.dumps(inputs),
        result=json.dumps(result), extra_discount=str(pct),
        discount_reason=body.discount_reason, config_version=PRICING_CONFIG["version"],
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    await _audit(db, user, "pricing.quote.created", "quote", num,
                 f"extra_discount={pct} reason={body.discount_reason or ''}")
    return {"id": rec.id, "number": num, "result": result}


@v1_router.get("/quotes")
async def list_quotes(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("sales", "platform_admin", "partner_admin"):
        raise HTTPException(403, "Non autorisé")
    q = select(QuoteRecord).order_by(QuoteRecord.created_at.desc())
    if user.role == "partner_admin":
        q = q.where(QuoteRecord.partner_id == user.org_id)
    elif user.role == "sales":
        q = q.where(QuoteRecord.created_by == user.id)
    rows = (await db.execute(q)).scalars().all()
    return [{"id": r.id, "number": r.number, "mode": r.mode, "lead_id": r.lead_id,
             "config_version": r.config_version, "created_at": r.created_at.isoformat() if r.created_at else None,
             "totals": json.loads(r.result)["totals"]} for r in rows]


@v1_router.get("/quotes/{quote_id}/export")
async def export_quote(quote_id: int, format: str = "csv",
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("sales", "platform_admin", "partner_admin"):
        raise HTTPException(403, "Non autorisé")
    rec = (await db.execute(select(QuoteRecord).where(QuoteRecord.id == quote_id))).scalar_one_or_none()
    if not rec:
        raise HTTPException(404, "Devis introuvable")
    res = json.loads(rec.result)
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(["Devis", rec.number, "Config", rec.config_version])
        w.writerow(["Unités facturables", res["totals"]["units"], "Prix/unité HT", res["totals"]["price_per_unit_mad"]])
        w.writerow([]); w.writerow(["Ligne", "Type", "Montant MAD"])
        for ln in res["lines"]:
            w.writerow([ln["label_fr"], ln["kind"], ln["amount_mad"]])
        data = buf.getvalue().encode("utf-8-sig")
        await _audit(db, user, "pricing.quote.exported", "quote", rec.number, "csv")
        return StreamingResponse(io.BytesIO(data), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{rec.number}.csv"'})
    # PDF-lite: structured JSON rendered as an HTML->print page is out of scope here;
    # produce a deterministic text PDF-ish payload with hash logged.
    text = json.dumps(res, ensure_ascii=False, indent=2)
    h = hashlib.sha256(text.encode()).hexdigest()
    rec.pdf_hash = h
    await db.commit()
    await _audit(db, user, "pricing.quote.exported", "quote", rec.number, f"pdf sha256={h}")
    return {"ok": True, "sha256": h, "download_name": f"{rec.number}.json"}


# ---------------------------------------------------------------------------
# Free Security Health Check (public lead magnet)
# ---------------------------------------------------------------------------
class HealthCheckIn(BaseModel):
    company: str = Field(min_length=2, max_length=200)
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=200)
    phone: Optional[str] = None
    country: Optional[str] = None
    consent: bool = False
    website: Optional[str] = None      # honeypot


@v1_router.post("/health-checks", status_code=201)
async def start_health_check(body: HealthCheckIn, request: Request,
                             db: AsyncSession = Depends(get_db),
                             user: Optional[User] = Depends(get_current_user)):
    hc_cfg = PRICING_CONFIG["healthCheck"]
    if body.website:
        return {"ok": True}
    if not body.consent:
        raise HTTPException(400, "Le consentement (loi 09-08 / CNDP) est requis.")
    _rate_limit(f"hc:{_ip(request)}", 3, 60)
    domain = body.email.lower().split("@")[-1]
    now = datetime.now(timezone.utc)
    # one active Health Check per email domain per N days
    recent = (await db.execute(
        select(HealthCheck).where(
            HealthCheck.email_domain == domain,
            HealthCheck.status.in_(("active", "read_only")),
        )
    )).scalars().all()
    for r in recent:
        st = r.started_at
        if st and st.tzinfo is None:
            st = st.replace(tzinfo=timezone.utc)
        if st and (now - st) <= timedelta(days=hc_cfg["oneActivePerEmailDomainDays"]):
            raise HTTPException(409, "Un Health Check est déjà actif pour ce domaine e-mail.")
    key = "ichc_" + secrets.token_urlsafe(24)
    org = Organization(
        name=f"HC · {body.company}", tier="trial", status="active",
        contact_email=body.email, contact_phone=body.phone, country=body.country,
        plan_tier="STARTER", trial=True,
        trial_expires_at=now + timedelta(days=hc_cfg["days"]),
        grace_until=now + timedelta(days=hc_cfg["days"] + hc_cfg["graceReadOnlyDays"]),
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    hc = HealthCheck(
        company=body.company, name=body.name, email=body.email.lower(),
        phone=body.phone, country=body.country, consent=True, email_domain=domain,
        org_id=org.id, enrollment_key_hash=hashlib.sha256(key.encode()).hexdigest(),
        expires_at=org.trial_expires_at, grace_until=org.grace_until,
        status="active",
        created_by_partner_id=(user.org_id if user and user.role == "partner_admin" else None),
    )
    db.add(hc)
    await db.commit()
    await db.refresh(hc)
    # partner-run => auto deal registration
    if user and user.role == "partner_admin" and user.org_id:
        db.add(PartnerDealRegistration(
            partner_org_id=user.org_id, prospect_company=body.company,
            prospect_email=body.email, pack="starter", status="registered",
            approved_at=now,
        ))
        await db.commit()
    await _audit(db, user, "health_check.started", "health_check", str(hc.id),
                 f"org={org.id} domain={domain}")
    return {"ok": True, "id": hc.id, "org_id": org.id,
            "enrollment_key": key,           # one-time, shown once
            "expires_at": hc.expires_at.isoformat(),
            "scope": {"days": hc_cfg["days"], "max_units": hc_cfg["maxUnits"],
                      "no_siem": True, "no_backup": True}}


@v1_router.get("/health-checks")
async def list_health_checks(db: AsyncSession = Depends(get_db),
                             user: User = Depends(get_current_user)):
    if user.role not in ("sales", "platform_admin", "partner_admin"):
        raise HTTPException(403, "Non autorisé")
    q = select(HealthCheck).order_by(HealthCheck.started_at.desc())
    if user.role == "partner_admin":
        q = q.where(HealthCheck.created_by_partner_id == user.org_id)
    rows = (await db.execute(q)).scalars().all()
    return [{"id": r.id, "company": r.company, "email": r.email, "status": r.status,
             "score": r.score, "recommended_pack": r.recommended_pack,
             "started_at": r.started_at.isoformat() if r.started_at else None,
             "expires_at": r.expires_at.isoformat() if r.expires_at else None,
             "org_id": r.org_id} for r in rows]


# ---------------------------------------------------------------------------
# Partners: deals, tier, wholesale quotes reuse /quotes with partnerTier input
# ---------------------------------------------------------------------------
class DealIn(BaseModel):
    prospect_company: str = Field(min_length=2, max_length=200)
    prospect_email: Optional[str] = None
    expected_units: float = Field(gt=0, le=100000)
    pack: str = "starter"


@v1_router.post("/partner/deal-registrations", status_code=201)
async def register_deal(body: DealIn, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    if user.role != "partner_admin" or not user.org_id:
        raise HTTPException(403, "Réservé aux partenaires.")
    # conflict check against existing leads and tenants
    conflict = None
    lead = (await db.execute(select(PricingLead).where(
        PricingLead.company.ilike(f"%{body.prospect_company}%"),
        PricingLead.status.in_(("new", "contacted", "qualified"))))).scalars().first()
    if lead:
        conflict = f"Un lead direct existe déjà pour cette société (#{lead.id})."
    org = (await db.execute(select(Organization).where(
        Organization.name.ilike(f"%{body.prospect_company}%"),
        Organization.status == "active"))).scalars().first()
    if org and not conflict:
        conflict = f"Cette société est déjà cliente (org #{org.id})."
    deal = PartnerDealRegistration(
        partner_org_id=user.org_id, prospect_company=body.prospect_company,
        prospect_email=body.prospect_email, expected_units=str(body.expected_units),
        pack=body.pack, status="conflict" if conflict else "registered",
        conflict_note=conflict,
        approved_at=None if conflict else datetime.now(timezone.utc),
    )
    db.add(deal)
    await db.commit()
    await db.refresh(deal)
    await _audit(db, user, "partner.deal.registered", "deal", str(deal.id),
                 conflict or "approved")
    return {"id": deal.id, "status": deal.status, "conflict_note": conflict}


@v1_router.get("/partner/deal-registrations")
async def list_deals(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("partner_admin", "platform_admin"):
        raise HTTPException(403, "Non autorisé")
    q = select(PartnerDealRegistration).order_by(PartnerDealRegistration.created_at.desc())
    if user.role == "partner_admin":
        q = q.where(PartnerDealRegistration.partner_org_id == user.org_id)
    rows = (await db.execute(q)).scalars().all()
    return [{"id": r.id, "prospect_company": r.prospect_company, "expected_units": r.expected_units,
             "pack": r.pack, "status": r.status, "conflict_note": r.conflict_note,
             "approved_at": r.approved_at.isoformat() if r.approved_at else None,
             "partner_org_id": r.partner_org_id} for r in rows]


@v1_router.post("/partner/deal-registrations/{deal_id}/approve")
async def approve_deal(deal_id: int, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    if user.role != "platform_admin":
        raise HTTPException(403, "Réservé à la plateforme.")
    deal = (await db.execute(select(PartnerDealRegistration).where(
        PartnerDealRegistration.id == deal_id))).scalar_one_or_none()
    if not deal:
        raise HTTPException(404, "Affaire introuvable")
    deal.status = "approved"
    deal.approved_at = datetime.now(timezone.utc)   # starts the 12-month bonus window
    await db.commit()
    await _audit(db, user, "partner.deal.approved", "deal", str(deal_id), "")
    return {"ok": True}


@v1_router.get("/partner/tier")
async def partner_tier(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Current wholesale tier from managed units across the partner's end-clients."""
    if user.role not in ("partner_admin", "platform_admin"):
        raise HTTPException(403, "Non autorisé")
    org_ids = []
    if user.org_id:
        subs = (await db.execute(select(Organization.id).where(
            Organization.parent_org_id == user.org_id))).scalars().all()
        org_ids = [user.org_id, *subs]
    total_devices = 0
    if org_ids:
        from app.models import Device
        total_devices = (await db.execute(
            select(Device).where(Device.org_id.in_(org_ids)))).scalars().all().__len__()
    # managed units ≈ devices (heavy default); refined by weights when classes known
    tier = partner_tier_for(PRICING_CONFIG, Decimal(str(total_devices)))
    nxt = next((t for t in PRICING_CONFIG["partner"]["tiers"] if t["minManagedUnits"] > total_devices), None)
    return {"tier": tier, "managed_units": total_devices, "next_tier": nxt,
            "cap": PRICING_CONFIG["partner"]["totalDiscountCap"]}


# ---------------------------------------------------------------------------
# Upsell engine (rules-based)
# ---------------------------------------------------------------------------
class UpsellEventIn(BaseModel):
    trigger: str
    message: str
    action: str = "shown"      # shown|dismissed|clicked|requested


@v1_router.post("/upsell/events", status_code=201)
async def log_upsell(body: UpsellEventIn, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    if not user.org_id:
        raise HTTPException(400, "User has no organization")
    ev = UpsellEvent(org_id=user.org_id, trigger=body.trigger, message=body.message,
                     action=body.action,
                     dismissed_at=datetime.now(timezone.utc) if body.action == "dismissed" else None)
    db.add(ev)
    await db.commit()
    return {"ok": True}


@v1_router.get("/upsell/cards")
async def upsell_cards(db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """Server-side rule evaluation for the tenant portal nudges (§8 triggers)."""
    if not user.org_id:
        raise HTTPException(400, "User has no organization")
    org = (await db.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "Organization not found")
    cfg = PRICING_CONFIG
    cards = []
    now = datetime.now(timezone.utc)
    # dismiss history: a dismissed card reappears after 30 days
    dismissed = (await db.execute(select(UpsellEvent).where(
        UpsellEvent.org_id == org.id, UpsellEvent.action == "dismissed",
    ))).scalars().all()
    def recently_dismissed(trigger: str) -> bool:
        for d in dismissed:
            dt = d.dismissed_at or d.created_at
            if dt and dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if d.trigger == trigger and dt and (now - dt) < timedelta(days=30):
                return True
        return False
    # live units (devices) via billable weights where class known
    try:
        from app.models import Device
        devs = (await db.execute(select(Device).where(Device.org_id == org.id))).scalars().all()
        light_types = {"switch", "router", "access_point", "printer", "iot", "camera", "mailbox"}
        units = sum(0.5 if (getattr(d, "device_type", "") or "").lower() in light_types else 1.0 for d in devs)
    except Exception:
        units = float(max(org.endpoint_count or 0, org.asset_count or 0))
    plan = (org.plan_tier or "STARTER").lower()
    if plan == "starter" and units >= cfg["upsell"]["starterNearCapUnits"]:
        msg = f"Pro démarre à {cfg['packs']['pro']['minUnits']} unités et inclut davantage de services et un quota SIEM."
        if not recently_dismissed("near_cap"):
            cards.append({"trigger": "near_cap", "message": msg, "cta": "upgrade"})
    # backup usage (stored on TenantSetting kv if present)
    try:
        from app.models import TenantSetting
        ts = (await db.execute(select(TenantSetting).where(
            TenantSetting.org_id == org.id, TenantSetting.key == "backup_usage"))).scalars().first()
        if ts:
            used_gb = float(json.loads(ts.value or "{}").get("used_gb", 0))
            quota = units * cfg["packs"].get(plan, cfg["packs"]["starter"])["backupQuotaGbPerUnit"]
            if quota and used_gb >= quota * cfg["upsell"]["backupQuotaWarnPct"]:
                msg = (f"Sauvegarde à {round(used_gb/quota*100)} % du quota ({int(quota)} Go). "
                       f"Passez au pack supérieur pour doubler le quota.")
                if not recently_dismissed("backup_quota"):
                    cards.append({"trigger": "backup_quota", "message": msg, "cta": "upgrade"})
    except Exception:
        pass
    # trial day-20 CTA
    if org.trial and org.trial_expires_at:
        te = org.trial_expires_at
        if te.tzinfo is None:
            te = te.replace(tzinfo=timezone.utc)
        days_left = (te - now).days
        if days_left <= cfg["upsell"]["trialCtaDay"] and days_left >= 0:
            msg = f"Votre Security Health Check gratuit expire dans {days_left} jours — convertissez-vous maintenant avec votre estimation préremplie."
            if not recently_dismissed("trial_cta"):
                cards.append({"trigger": "trial_cta", "message": msg, "cta": "convert"})
    return {"cards": cards, "plan": plan, "units": units}


class UpgradeRequestIn(BaseModel):
    service_id: str
    note: Optional[str] = None


@v1_router.post("/upsell/requests", status_code=201)
async def request_upgrade(body: UpgradeRequestIn, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    """'Request upgrade' → routed to the partner if partner-managed, else to sales."""
    if not user.org_id:
        raise HTTPException(400, "User has no organization")
    org = (await db.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
    route = "sales"
    if org and org.parent_org_id:
        route = f"partner:{org.parent_org_id}"
    ev = UpsellEvent(org_id=user.org_id, trigger="upgrade_request",
                     message=f"{body.service_id}: {body.note or ''}", action="requested")
    db.add(ev)
    await db.commit()
    await _audit(db, user, "upsell.upgrade_requested", "organization", str(user.org_id),
                 f"service={body.service_id} routed_to={route}")
    return {"ok": True, "routed_to": route}


# ---------------------------------------------------------------------------
# Entitlements v2 (locked cards in the tenant portal)
# ---------------------------------------------------------------------------
# DEFAULT pack composition — mirror of DEFAULT_PACK_DETAILS in
# src/data/pricingConfig.ts. PACK_SERVICES is DERIVED from it via
# _pack_services_from(); pages/entitlements never hardcode a second copy.
DEFAULT_PACK_DETAILS: Dict[str, Any] = {
    "starter": {
        "services": ["endpoint", "vuln", "patch", "backup", "compliance"],
        "freePicks": [],
    },
    "pro": {
        "services": ["endpoint", "vuln", "patch", "backup", "compliance", "email", "incident", "network"],
        "freePicks": ["dns", "analytics", "threat_intel", "ticketing"],
    },
    "souverain": {
        "services": ["endpoint", "vuln", "patch", "backup", "compliance", "email", "incident",
                     "network", "soar", "cloud", "firewall_mgmt", "vpn", "sdwan"],
        "freePicks": ["dns", "analytics", "threat_intel", "ticketing"],
    },
}


def _pack_services_from(details: Dict[str, Any], cfg: Dict[str, Any]) -> Dict[str, List[str]]:
    """Derive each pack's service list (paid + free picks) from its customizer
    definition, ordered by the canonical catalogs — mirror of
    packServicesFrom() in src/data/pricingConfig.ts."""
    order_paid = [s["id"] for s in cfg["services"]]
    order_free = [f["id"] for f in cfg["freePool"]]
    out: Dict[str, List[str]] = {}
    for pid, d in details.items():
        svc, free = list(d.get("services", [])), list(d.get("freePicks", []))
        known = set(order_paid) | set(order_free)
        picked = [i for i in order_paid if i in svc] + [i for i in svc if i not in known] \
               + [i for i in order_free if i in free] + [i for i in free if i not in known]
        seen: List[str] = []
        for i in picked:
            if i not in seen:
                seen.append(i)
        out[pid] = seen
    return out


# Live config served by GET /pricing/config — starts as the bundled copy and
# carries admin edits made through the Pack Customizer (/admin/packs).
_live_config: Dict[str, Any] = json.loads(json.dumps(PRICING_CONFIG))
_live_config["packDetails"] = json.loads(json.dumps(DEFAULT_PACK_DETAILS))

# Persistence for the live pack composition (Pack Customizer edits). In-memory
# state alone is lost on restart/reload; we mirror it to a small JSON file next
# to the backend so edits survive dev-server restarts. Override the location
# with env PACK_STORE_PATH (e.g. a mounted volume in Docker/prod).
_PACK_STORE_PATH = os.environ.get(
    "PACK_STORE_PATH",
    str(FsPath(__file__).resolve().parents[2] / "data" / "pack_details.json"),
)


def _persist_pack_details() -> None:
    try:
        p = FsPath(_PACK_STORE_PATH)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(_live_config["packDetails"], ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError:  # read-only FS etc. — in-memory state still correct
        pass


def _load_pack_details() -> None:
    try:
        raw = FsPath(_PACK_STORE_PATH).read_text(encoding="utf-8")
        stored = json.loads(raw)
        if isinstance(stored, dict):
            merged = json.loads(json.dumps(DEFAULT_PACK_DETAILS))
            for pid, d in stored.items():
                if isinstance(d, dict) and isinstance(d.get("services"), list) and isinstance(d.get("freePicks"), list):
                    base = merged.get(pid) or {}
                    merged[pid] = {**base, **d, "id": pid}
            _live_config["packDetails"] = merged
    except (OSError, ValueError):
        pass


_load_pack_details()

PACK_SERVICES = _pack_services_from(DEFAULT_PACK_DETAILS, PRICING_CONFIG)
PACK_SERVICES["trial"] = ["dns", "analytics", "threat_intel"]
NEXT_PACK_MSG = {"starter": "Pro", "pro": "Souverain", "souverain": "Sur mesure"}


@v1_router.get("/entitlements")
async def my_entitlements(db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    """Services included in the caller's plan + locked cards with upsell copy."""
    if not user.org_id:
        raise HTTPException(400, "User has no organization")
    org = (await db.execute(select(Organization).where(Organization.id == user.org_id))).scalar_one_or_none()
    plan = (org.plan_tier or "STARTER").lower() if org else "starter"
    if org and org.trial:
        plan = "trial"
    included = _pack_services_from(_live_config["packDetails"], PRICING_CONFIG).get(plan, PACK_SERVICES["starter"])
    all_services = [s["id"] for s in PRICING_CONFIG["services"]] + [f["id"] for f in PRICING_CONFIG["freePool"]]
    locked = [sid for sid in all_services if sid not in included]
    labels = {
        "endpoint": "Supervision et protection des terminaux", "vuln": "Scan de vulnérabilités continu",
        "patch": "Gestion des correctifs", "backup": "Sauvegarde et plan de reprise",
        "compliance": "Rapports de conformité", "email": "Sécurité des messageries",
        "incident": "Réponse aux incidents", "network": "Supervision réseau",
        "soar": "Automatisation des réponses", "cloud": "Sécurité du cloud",
        "firewall_mgmt": "Gestion de pare-feu", "vpn": "VPN et accès zéro-confiance",
        "sdwan": "SD-WAN et inventaire réseau", "dns": "Filtrage DNS sécurisé",
        "analytics": "Analytique et tableaux de bord", "threat_intel": "Intelligence sur les menaces",
        "ticketing": "Guichet de services",
    }
    nxt = NEXT_PACK_MSG.get(plan, "Sur mesure")
    return {"plan": plan, "included": included,
            "locked": [{"service_id": s, "label": labels.get(s, s),
                        "upsell": f"{labels.get(s, s)} est disponible avec le pack {nxt}."} for s in locked]}


# ---------------------------------------------------------------------------
# Config version persistence helper (called at startup)
# ---------------------------------------------------------------------------
async def sync_pricing_config(db: AsyncSession):
    """Upsert the active config version so every quote is traceable to it."""
    ver = PRICING_CONFIG["version"]
    row = (await db.execute(select(PricingConfigVersion).where(
        PricingConfigVersion.version == ver))).scalars().first()
    if not row:
        db.add(PricingConfigVersion(version=ver, payload=json.dumps(PRICING_CONFIG), is_active=True))
        for plan, services in PACK_SERVICES.items():
            for sid in services:
                db.add(PlanEntitlementV2(plan=plan, service_id=sid, included=True))
        await db.commit()


# ---------------------------------------------------------------------------
# PACK CUSTOMIZER (platform admin only) — mirrors demoMode.ts /pricing/packs.
# The step-by-step wizard in /admin/packs edits one pack at a time; every save
# updates the LIVE config served by GET /pricing/config, re-derives
# PACK_SERVICES and persists PlanEntitlementV2 rows so tenant portals, locked
# cards and seed entitlements all follow the customized packs automatically.
# ---------------------------------------------------------------------------
class PackCustomizerIn(BaseModel):
    services: List[str]
    freePicks: List[str] = Field(default_factory=list)
    # optional overrides of the numeric pack attributes (step 1/4 of the wizard)
    price: Optional[float] = None
    minUnits: Optional[int] = None
    maxUnits: Optional[int] = None
    retentionDays: Optional[int] = None
    backupQuotaGbPerUnit: Optional[int] = None
    support: Optional[str] = None
    onboarding: Optional[float] = None


def _persist_pack(db: AsyncSession, pid: str, d: Dict[str, Any]) -> None:
    """Write PlanEntitlementV2 rows for one pack (delete-then-insert, idempotent)."""
    from sqlalchemy import delete as sa_delete
    db.add(sa_delete(PlanEntitlementV2).where(PlanEntitlementV2.plan == pid))
    for sid in _pack_services_from({pid: d}, PRICING_CONFIG)[pid]:
        db.add(PlanEntitlementV2(plan=pid, service_id=sid, included=True))


@v1_router.get("/packs")
async def list_packs():
    """Effective pack composition + diff vs the shipped defaults."""
    details = _live_config["packDetails"]
    derived = _pack_services_from(details, PRICING_CONFIG)
    base_derived = _pack_services_from(DEFAULT_PACK_DETAILS, PRICING_CONFIG)
    eff = {}
    for pid, d in details.items():
        cur = set(derived.get(pid, []))
        base = set(base_derived.get(pid, []))
        eff[pid] = {
            "id": pid,
            "configured": json.dumps(d, sort_keys=True) != json.dumps(DEFAULT_PACK_DETAILS.get(pid, {}), sort_keys=True),
            "services": d.get("services", []), "free_picks": d.get("freePicks", []),
            "added": sorted(cur - base), "removed": sorted(base - cur),
        }
    return {"version": _live_config["version"], "packs": details, "effective": eff}


@v1_router.put("/packs/{pack_id}")
async def update_pack(pack_id: str, body: PackCustomizerIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    if user.role != "platform_admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform admin only")
    known = {s["id"] for s in PRICING_CONFIG["services"]} | {f["id"] for f in PRICING_CONFIG["freePool"]}
    invalid = [i for i in body.services + body.freePicks if i not in known]
    if invalid:
        raise HTTPException(400, f"Service(s) inconnu(s): {', '.join(invalid)}")
    prev = _live_config["packDetails"].get(pack_id) or DEFAULT_PACK_DETAILS.get(pack_id)
    if prev is None and pack_id not in ("custom",):
        raise HTTPException(404, f"Pack inconnu: {pack_id}")
    merged = dict(prev or {})
    merged.update({"id": pack_id, "services": body.services, "freePicks": body.freePicks})
    for k_src, k_dst in (("price", "price"), ("minUnits", "minUnits"), ("maxUnits", "maxUnits"),
                         ("retentionDays", "retentionDays"), ("backupQuotaGbPerUnit", "backupQuotaGbPerUnit"),
                         ("support", "support"), ("onboarding", "onboarding")):
        v = getattr(body, k_src, None)
        if v is not None:
            merged[k_dst] = v
            if k_dst in (_live_config["packs"].get(pack_id) or {}):
                _live_config["packs"].setdefault(pack_id, {})[k_dst] = v
    _live_config["packDetails"][pack_id] = merged
    _persist_pack_details()
    _persist_pack(db, pack_id, merged)
    await db.commit()
    await _audit(db, user, "pricing.pack.updated", "pack", pack_id,
                 f"{len(body.services)} payants + {len(body.freePicks)} inclus")
    return {"ok": True, "pack": merged}


@v1_router.post("/packs/reset")
async def reset_packs(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role != "platform_admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform admin only")
    _live_config["packDetails"] = json.loads(json.dumps(DEFAULT_PACK_DETAILS))
    _persist_pack_details()
    for pid, d in DEFAULT_PACK_DETAILS.items():
        _persist_pack(db, pid, d)
    await db.commit()
    await _audit(db, user, "pricing.packs.reset", "pack", "all", "composition par défaut restaurée")
    return {"ok": True, "version": _live_config["version"]}
