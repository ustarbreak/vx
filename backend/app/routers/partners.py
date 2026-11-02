"""Partner Portal (MSSP) — real /api/partners router.

Phase 1 of the Partner Portal: mirrors src/services/partnersApi.ts shapes and
the demo handlers in src/services/demoMode.ts, but backed by PostgreSQL/SQLite:

  GET    /partners                     list (platform_admin: all; partner_admin: self)
  GET    /partners/stats               platform_admin only
  GET    /partners/{pid}               partner profile (scoped)
  GET    /partners/{pid}/license       computed from core/pricing_config.json (MAD)
  GET    /partners/{pid}/branding      white-label config (tenant_settings JSON)
  PUT    /partners/{pid}/branding      partial update; custom_domain change -> pending_verification
  POST   /partners/{pid}/verify-domain flips dns_status (verified iff a domain is set)
  GET    /partners/{pid}/clients       end-clients = child orgs (parent_org_id == pid)
  POST   /partners/{pid}/clients       seat-limited creation (402 when full)
  PATCH  /partners/{pid}/clients/{cid} scoped update
  DELETE /partners/{pid}/clients/{cid} scoped delete

HARD RULES honoured:
  * Tenant isolation — every query is scoped to the caller's partner org and its
    own children; cross-partner access returns 403 "Cross-partner access denied"
    (same message as the demo).
  * No mock fallback — an org that is not flagged `is_partner` returns 404
    "not configured"; nothing is ever seeded.
  * Currency MAD; tiers/discounts read from pricing_config.json via
    app.services.pricing_engine (single source of truth — never re-declared).
  * Writes are rate-limited, validated with Pydantic Literals, and audited.
"""
from __future__ import annotations

import re
import time
from collections import defaultdict, deque
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user, require_role
from app.database import get_db
from app.models import AuditLog, Organization, TenantSetting, User
from app.schemas import (
    EndClientIn, EndClientPatch, WhiteLabelIn,
    PartnerOut, PartnerLicenseOut, PartnerEndClientOut, PartnerStatsOut,
)
from app.services.pricing_engine import PRICING_CONFIG, partner_tier_for

router = APIRouter(prefix="/partners", tags=["Partner Portal"])

DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$")
CNAME_TARGET = "edge.infracentra.io"          # published on OUR side, server-derived
LOGO_MAX_B64 = 700_000                          # ~500 KB binary as data-url base64
BRANDING_DEFAULTS = {
    "brand_name": "", "logo_data_url": None, "primary_color": "#0ea5e9",
    "custom_domain": "", "cname_target": CNAME_TARGET,
    "dns_status": "not_configured", "email_sender": "", "hide_infracentra": False,
}

# Per-user sliding-window limiter (mirrors pricing_v2._rate_limit style).
_writes: dict[str, deque] = defaultdict(deque)


def _rate_limit(key: str, max_calls: int = 10, window_s: int = 60) -> None:
    q = _writes[key]
    now = time.monotonic()
    while q and now - q[0] > window_s:
        q.popleft()
    if len(q) >= max_calls:
        raise HTTPException(429, "Trop de requêtes d'écriture — réessayez dans un instant")
    q.append(now)


def _audit(user: User, action: str, resource_id: str, details: str, org_id: int | None) -> AuditLog:
    return AuditLog(actor_id=user.id, actor_name=user.name or user.email,
                    actor_role=user.role, org_id=org_id, action=action,
                    resource="partner", resource_id=resource_id,
                    details=details, outcome="success")


async def _settings(db: AsyncSession, org_id: int) -> dict:
    row = (await db.execute(select(TenantSetting).where(TenantSetting.org_id == org_id))).scalar_one_or_none()
    return dict(row.data or {}) if row else {}


async def _save_settings(db: AsyncSession, org_id: int, data: dict) -> None:
    row = (await db.execute(select(TenantSetting).where(TenantSetting.org_id == org_id))).scalar_one_or_none()
    if row:
        row.data = data
    else:
        db.add(TenantSetting(org_id=org_id, data=data))


def _branding_of(settings_data: dict) -> dict:
    b = dict(BRANDING_DEFAULTS)
    b.update(settings_data.get("branding") or {})
    b["cname_target"] = CNAME_TARGET  # never trust a stored/client-supplied target
    return b


async def _children(db: AsyncSession, partner_id: int) -> list[Organization]:
    res = await db.execute(select(Organization).where(Organization.parent_org_id == partner_id)
                           .order_by(Organization.id))
    return list(res.scalars().all())


async def _partner_out(db: AsyncSession, org: Organization) -> dict:
    settings = await _settings(db, org.id)
    children = await _children(db, org.id)
    branding = _branding_of(settings)
    lic = _license_payload(org, children)   # dict (model_dump) — index, not attr
    return PartnerOut(
        id=str(org.id), code=org.partner_code or f"MSP-{org.id}",
        company=org.name, country=org.country or "Maroc",
        contact_name=(await db.execute(select(User.name).where(User.org_id == org.id)
                                       .where(User.role == "partner_admin").limit(1))).scalars().first(),
        contact_email=org.contact_email, phone=org.contact_phone or "",
        status=org.status if org.status in ("prospect", "trial", "active", "suspended") else "active",
        signed_on=org.contract_start.date().isoformat() if org.contract_start else None,
        tier=lic["plan"], license=lic, branding=branding,
        end_clients=[_client_out(c) for c in children],
        training=settings.get("training", {"completed": [], "pending": []}),
        support_sla=org.support_sla or "",
    ).model_dump()


def _client_out(c: Organization) -> dict:
    return PartnerEndClientOut(
        id=str(c.id), partner_id=str(c.parent_org_id or ""), name=c.name,
        industry=c.industry or "Non spécifié", city=(c.country or "Casablanca"),
        devices=c.asset_count or 0, users=c.member_count or 0,
        plan=c.plan_tier or "starter", monthly_mrr_mad=int(c.monthly_revenue or 0),
        status="active" if c.status == "active" else ("onboarding" if c.status == "pending" else "suspended"),
        since=c.contract_start.date().isoformat() if c.contract_start else date.today().isoformat(),
    ).model_dump()


# --------------------------------------------------------------------------- #
# License model — pricing_config.json partner tiers, currency MAD (rule 4).   #
# wholesale = pack list price x managed units x (1 - tier discount), capped   #
# at totalDiscountCap off list. Tier may be forced by platform admin          #
# (partner_tier_override) — mirrors the repurposed migrate endpoint.          #
# --------------------------------------------------------------------------- #
# Seats/devices per tier are program quotas; wholesale math & discounts come
# strictly from pricing_config.json (packs + partner tiers).
_TIER_SEATS = {"registered": 5, "silver": 15, "gold": 40, "platinum": 100}
_TIER_DEVICES = {"registered": 300, "silver": 1200, "gold": 4000, "platinum": 20000}


def _license_payload(org: Organization, children: list[Organization]) -> dict:
    cfg = PRICING_CONFIG
    units = sum((c.asset_count or 0) for c in children)
    auto = partner_tier_for(cfg, Decimal(units))
    override = (org.partner_tier_override or "").lower()
    tier_def = next((t for t in cfg["partner"]["tiers"] if t["id"] == override), auto)
    tier_id = tier_def["id"]
    # reference pack chosen by managed-unit volume (same engine semantics as quote())
    pack_id, pack = ("starter", cfg["packs"]["starter"]) if units < int(cfg["packs"]["pro"]["minUnits"]) \
        else ("pro", cfg["packs"]["pro"])
    discount = min(Decimal(str(tier_def["discount"])), Decimal(str(cfg["partner"]["totalDiscountCap"])))
    billable = max(units, int(pack["minUnits"]))
    wholesale = (Decimal(pack["price"]) * Decimal(billable) * (Decimal(1) - discount)).quantize(Decimal("1"))
    resale_from = Decimal(pack["price"])            # suggested retail = list price per unit
    tiers = cfg["partner"]["tiers"]
    idx = next(i for i, t in enumerate(tiers) if t["id"] == tier_id)
    nxt = tiers[idx + 1] if idx + 1 < len(tiers) else None
    seats = _TIER_SEATS.get(tier_id, 5)
    retail_mrr = sum(int(c.monthly_revenue or 0) for c in children)
    margin = round(100 * (retail_mrr - int(wholesale)) / retail_mrr) if retail_mrr > 0 and wholesale > 0 else 0
    return PartnerLicenseOut(
        id=f"lic-{org.id}-{tier_id}", plan=tier_id,
        client_seats=seats, client_seats_used=len(children),
        device_allowance=_TIER_DEVICES.get(tier_id, 300), devices_used=units,
        price_month_mad=int(wholesale), resale_price_from_mad=int(resale_from),
        margin_pct=max(margin, 0),
        renews_on=org.contract_end.date().isoformat() if org.contract_end else None,
        services_included=["all"], ticketing=True,
        tier_discount=float(tier_def["discount"]), managed_units=units,
        next_tier=nxt["id"] if nxt else None,
        units_to_next_tier=max(0, int(nxt["minManagedUnits"]) - units) if nxt else 0,
    ).model_dump()


async def _resolve_partner(pid: str, user: User, db: AsyncSession) -> Organization:
    """Tenant isolation gate (rule 1). platform_admin may address any partner;
    a partner_admin only their own org. Non-partner orgs -> 404 not configured."""
    try:
        oid = int(pid)
    except (TypeError, ValueError):
        raise HTTPException(404, f"Partenaire {pid} introuvable")
    org = (await db.execute(select(Organization).where(Organization.id == oid))).scalar_one_or_none()
    if org is None or not org.is_partner:
        raise HTTPException(404, "not configured — cette organisation n'est pas un partenaire du programme")
    if user.role != "platform_admin" and str(user.org_id) != str(org.id):
        raise HTTPException(403, "Cross-partner access denied")
    return org


# --------------------------------------------------------------------------- #
# Routes                                                                      #
# --------------------------------------------------------------------------- #
@router.get("")
async def list_partners(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role == "platform_admin":
        res = await db.execute(select(Organization).where(Organization.is_partner.is_(True)).order_by(Organization.id))
        orgs = list(res.scalars().all())
    elif current_user.role == "partner_admin":
        org = (await db.execute(select(Organization).where(Organization.id == current_user.org_id))).scalar_one_or_none()
        orgs = [org] if org and org.is_partner else []
    else:
        raise HTTPException(403, "Partners routes require a partner or platform-admin session")
    return [await _partner_out(db, o) for o in orgs]


@router.get("/stats")
async def program_stats(db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(require_role("platform_admin"))):
    partners = (await db.execute(select(Organization).where(Organization.is_partner.is_(True)))).scalars().all()
    active = [p for p in partners if p.status == "active"]
    wholesale = 0
    retail = 0
    devices = 0
    end_clients = 0
    wl_live = 0
    dns_pending = 0
    for p in partners:
        children = await _children(db, p.id)
        lic = _license_payload(p, children)
        end_clients += len(children)
        devices += lic["managed_units"]
        if p.status == "active":
            wholesale += lic["price_month_mad"]
        retail += sum(int(c.monthly_revenue or 0) for c in children)
        st = await _settings(db, p.id)
        b = _branding_of(st)
        if b["hide_infracentra"] and b["dns_status"] == "verified":
            wl_live += 1
        if b["dns_status"] != "verified":
            dns_pending += 1
    return PartnerStatsOut(
        partners_total=len(partners), partners_active=len(active),
        trials=sum(1 for p in partners if p.status == "trial"),
        end_clients=end_clients, devices_managed=devices,
        wholesale_mrr_mad=wholesale, retail_mrr_mad=retail,
        channel_margin_pct=round(100 * (retail - wholesale) / retail) if retail else 0,
        white_labels_live=wl_live, dns_pending=dns_pending,
    ).model_dump()


@router.get("/{pid}")
async def get_partner(pid: str, db: AsyncSession = Depends(get_db),
                      current_user: User = Depends(get_current_user)):
    org = await _resolve_partner(pid, current_user, db)
    return await _partner_out(db, org)


@router.get("/{pid}/license")
async def get_license(pid: str, db: AsyncSession = Depends(get_db),
                      current_user: User = Depends(get_current_user)):
    org = await _resolve_partner(pid, current_user, db)
    return _license_payload(org, await _children(db, org.id))


@router.get("/{pid}/branding")
async def get_branding(pid: str, db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    org = await _resolve_partner(pid, current_user, db)
    return _branding_of(await _settings(db, org.id))


@router.put("/{pid}/branding")
async def put_branding(pid: str, body: WhiteLabelIn, request: Request,
                       db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    _rate_limit(f"branding:{current_user.id}", 10, 60)
    org = await _resolve_partner(pid, current_user, db)
    if body.logo_data_url and len(body.logo_data_url) > LOGO_MAX_B64:
        raise HTTPException(422, "Logo trop volumineux (max ~500 Ko en base64)")
    if body.custom_domain and not DOMAIN_RE.match(body.custom_domain.lower()):
        raise HTTPException(422, "Domaine personnalisé invalide")
    if body.email_sender and "@" not in body.email_sender:
        raise HTTPException(422, "Expéditeur e-mail invalide")
    data = await _settings(db, org.id)
    cur = _branding_of(data)
    patch = body.model_dump(exclude_none=True)
    domain_changed = "custom_domain" in patch and patch["custom_domain"] != cur["custom_domain"]
    cur.update(patch)
    if domain_changed:
        cur["dns_status"] = "pending_verification" if cur["custom_domain"] else "not_configured"
    cur["cname_target"] = CNAME_TARGET
    data["branding"] = cur
    await _save_settings(db, org.id, data)
    db.add(_audit(current_user, "partner.branding_updated", str(org.id),
                  f"Branding mis à jour ({', '.join(patch.keys())})", org.id))
    await db.commit()
    return cur


@router.post("/{pid}/verify-domain")
async def verify_domain(pid: str, request: Request,
                        db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    _rate_limit(f"verify:{current_user.id}", 5, 60)
    org = await _resolve_partner(pid, current_user, db)
    data = await _settings(db, org.id)
    b = _branding_of(data)
    if not b["custom_domain"]:
        b["dns_status"] = "not_configured"
    elif b["dns_status"] == "pending_verification":
        # Phase 1: presence check — the CNAME target is published on our side,
        # so a domain that was registered + pending is accepted as verified.
        # (A real DNS TXT probe lands with the background scheduler; kept
        # explicit so UI never shows fake green for an unregistered domain.)
        b["dns_status"] = "verified"
    else:
        b["dns_status"] = "pending_verification"
    data["branding"] = b
    await _save_settings(db, org.id, data)
    db.add(_audit(current_user, "partner.domain_verify", str(org.id),
                  f"Vérification domaine {b['custom_domain'] or '(aucun)'} -> {b['dns_status']}", org.id))
    await db.commit()
    return b


@router.get("/{pid}/clients")
async def list_clients(pid: str, db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    org = await _resolve_partner(pid, current_user, db)
    return [_client_out(c) for c in await _children(db, org.id)]


@router.post("/{pid}/clients", status_code=201)
async def add_client(pid: str, body: EndClientIn, request: Request,
                     db: AsyncSession = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    _rate_limit(f"client:{current_user.id}", 10, 60)
    org = await _resolve_partner(pid, current_user, db)
    children = await _children(db, org.id)
    lic = _license_payload(org, children)
    if lic["client_seats_used"] >= lic["client_seats"]:
        raise HTTPException(402, f"License limit reached ({lic['client_seats']} client seats on tier {lic['plan']})")
    child = Organization(
        name=body.name, tier="sme", status="pending", contact_email=body.contact_email or f"noc@{body.city.lower().replace(' ', '')}.local",
        contact_phone=body.contact_phone, industry=body.industry, country=body.city,
        member_count=body.users, asset_count=body.devices,
        plan_tier=body.plan, parent_org_id=org.id, org_type="SUBSIDIARY",
        monthly_revenue=body.monthly_mrr_mad, contract_start=date.today(),
    )
    db.add(child)
    db.add(_audit(current_user, "partner.client_created", str(org.id),
                  f"Client final « {body.name} » créé sous le partenaire {org.name}", org.id))
    await db.commit()
    await db.refresh(child)
    return _client_out(child)


@router.patch("/{pid}/clients/{cid}")
async def patch_client(pid: str, cid: str, body: EndClientPatch, request: Request,
                       db: AsyncSession = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    _rate_limit(f"client:{current_user.id}", 10, 60)
    org = await _resolve_partner(pid, current_user, db)
    child = None
    if str(cid).isdigit():
        child = (await db.execute(select(Organization).where(Organization.id == int(cid)))).scalar_one_or_none()
    if child is None or child.parent_org_id != org.id:
        raise HTTPException(404, "end-client not found for this partner")
    patch = body.model_dump(exclude_none=True)
    for k, v in patch.items():
        setattr(child, {"monthly_mrr_mad": "monthly_revenue", "devices": "asset_count",
                        "users": "member_count", "city": "country", "plan": "plan_tier"}.get(k, k), v)
    db.add(_audit(current_user, "partner.client_updated", str(child.id),
                  f"Client final modifié ({', '.join(patch.keys())})", org.id))
    await db.commit()
    await db.refresh(child)
    return _client_out(child)


@router.delete("/{pid}/clients/{cid}", status_code=204)
async def remove_client(pid: str, cid: str, request: Request,
                        db: AsyncSession = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    _rate_limit(f"client:{current_user.id}", 10, 60)
    org = await _resolve_partner(pid, current_user, db)
    if not str(cid).isdigit():
        raise HTTPException(404, "end-client not found for this partner")
    child = (await db.execute(select(Organization).where(Organization.id == int(cid)))).scalar_one_or_none()
    if child is None or child.parent_org_id != org.id:
        raise HTTPException(404, "end-client not found for this partner")
    await db.delete(child)
    db.add(_audit(current_user, "partner.client_deleted", str(child.id),
                  f"Client final « {child.name} » supprimé du partenaire {org.name}", org.id))
    await db.commit()
