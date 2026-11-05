"""Phase 4 — Partner Program management (plateforme admin).

DB-backed counterpart of the `partners` platform-admin handlers in
src/services/demoMode.ts (PATCH / suspend / migrate / DELETE):

  PATCH  /partners/{pid}            update whitelisted fields   -> audit partner.updated
  POST   /partners/{pid}/suspend    toggle active/suspended     -> audit partner.status_changed
  POST   /partners/{pid}/migrate    FORCE a pricing_config partner tier
                                    (registered|silver|gold|platinum) -> audit partner.migrated
  DELETE /partners/{pid}            bloqué 409 si end-clients   -> audit partner.deleted

Access: platform_admin only (require_role), exactly like the demo's
« Réservé aux administrateurs plateforme » 403.

Persistence: real `organizations` rows flagged is_partner (migration
i9j1k3m5n7o9). The former in-memory _PartnerStore seeded from a non-existent
partner_seed module and the EUR Starter/Business/Scale plans are removed —
currency/tiers now come from core/pricing_config.json (rule 4). The portal
read/write endpoints (GET list/stats/license/branding/clients…) live in
routers/partners.py; this router keeps only the platform-admin verbs.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Organization, AuditLog
from app.schemas import PartnerUpdateIn, PartnerMigrateIn
from app.core.security import get_current_user
from app.core.platform_rbac import has_permission, is_platform_role
from app.services.pricing_engine import PRICING_CONFIG

router = APIRouter(prefix="/partners", tags=["Partner Admin"])

TIER_IDS = [t["id"] for t in PRICING_CONFIG["partner"]["tiers"]]

async def _require_partner_manage(user: User, org: Organization, db: AsyncSession) -> None:
    if user.role == "platform_admin":
        return
    if not is_platform_role(user.role) or not await has_permission(
        user, "platform.partners.manage", db, partner_id=org.id
    ):
        raise HTTPException(403, "Partner management permission required for this partner scope")




def _audit(current_user: User, action: str, details: str, org_id: int) -> AuditLog:
    return AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name or current_user.email,
        actor_role=current_user.role, org_id=org_id,
        action=action, resource="partner", resource_id=action,
        details=details, outcome="success",
    )


async def _get_partner(pid: str, db: AsyncSession) -> Organization:
    if not str(pid).isdigit():
        raise HTTPException(404, f"Partenaire {pid} introuvable")
    org = (await db.execute(select(Organization).where(Organization.id == int(pid)))).scalar_one_or_none()
    if org is None or not org.is_partner:
        raise HTTPException(404, f"Partenaire {pid} introuvable")
    return org


@router.patch("/{pid}")
async def update_partner(
    pid: str, body: PartnerUpdateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org = await _get_partner(pid, db)
    await _require_partner_manage(current_user, org, db)
    patch = body.model_dump(exclude_none=True)
    changed = []
    for k, v in patch.items():
        if k == "company":
            org.name = v
        elif k == "contact_email":
            org.contact_email = v
        elif k == "tier":
            org.partner_tier_override = v
        elif k == "status":
            org.status = v
        elif k == "support_sla":
            org.support_sla = v
        else:
            continue
        changed.append(k)
    db.add(_audit(current_user, "partner.updated",
                  f"Partenaire {org.name} modifié ({', '.join(changed)})", org.id))
    await db.commit()
    await db.refresh(org)
    return {"id": str(org.id), "company": org.name, "contact_email": org.contact_email,
            "tier_override": org.partner_tier_override, "status": org.status,
            "support_sla": org.support_sla or ""}


@router.post("/{pid}/suspend")
async def suspend_partner(
    pid: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("platform.partners.manage")),
):
    org = await _get_partner(pid, db)
    await _require_partner_manage(current_user, org, db)
    org.status = "suspended" if org.status != "suspended" else "active"
    db.add(_audit(current_user, "partner.status_changed",
                  f"Partenaire {org.name} → {org.status}", org.id))
    await db.commit()
    return {"status": org.status}


@router.post("/{pid}/migrate")
async def migrate_partner(
    pid: str, body: PartnerMigrateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("platform.partners.manage")),
):
    """Repurposed (Phase 1): force a pricing_config partner tier instead of the
    old EUR Starter/Business/Scale plans. The override pins the license tier in
    routers/partners._license_payload; automatic progression by managed units
    resumes when the override is cleared (tier=null via PATCH)."""
    org = await _get_partner(pid, db)
    await _require_partner_manage(current_user, org, db)
    target = str(body.tier or "").lower()
    if target not in TIER_IDS:
        raise HTTPException(400, f"Tier invalide — attendu: {'|'.join(TIER_IDS)}")
    org.partner_tier_override = target
    tier_def = next(t for t in PRICING_CONFIG["partner"]["tiers"] if t["id"] == target)
    db.add(_audit(current_user, "partner.migrated",
                  f"Licence {org.name} forcée vers le tier {target} "
                  f"(remise {int(tier_def['discount'] * 100)} %, MAD — pricing_config)", org.id))
    await db.commit()
    return {"tier": target, "discount": tier_def["discount"], "currency": PRICING_CONFIG["currency"]}


@router.delete("/{pid}", status_code=204)
async def delete_partner(
    pid: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("platform.partners.manage")),
):
    org = await _get_partner(pid, db)
    await _require_partner_manage(current_user, org, db)
    children = (await db.execute(select(Organization).where(Organization.parent_org_id == org.id))).scalars().all()
    if len(children) > 0:
        raise HTTPException(409,
                            f"Impossible de supprimer : {len(children)} client(s) final(aux) "
                            "encore rattaché(s). Migrez-les d'abord.")
    org.is_partner = False
    org.partner_code = None
    org.partner_tier_override = None
    db.add(_audit(current_user, "partner.deleted",
                  f"Partenaire {org.name} supprimé du programme", org.id))
    await db.commit()
