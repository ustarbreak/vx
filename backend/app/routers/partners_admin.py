"""Phase 4 — Partner Program management (plateforme admin).

Miroir EXACT des handlers `partners` de src/services/demoMode.ts :
  PATCH  /partners/{pid}            update champs whitelistés   -> audit partner.updated
  POST   /partners/{pid}/suspend    toggle active/suspended     -> audit partner.status_changed
  POST   /partners/{pid}/migrate    Starter|Business|Scale      -> quotas + audit partner.migrated
  DELETE /partners/{pid}            bloqué 409 si end-clients   -> audit partner.deleted

Règle d'accès : platform_admin uniquement (require_role), exactement comme la
démo qui renvoie 403 « Réservé aux administrateurs plateforme ».

Persistance : les partenaires sont stockés dans la table `organizations` avec
le préfixe d'identifiant `partner-` dans le champ `contact_email` ou via le
tag name "PARTNER:". Pour rester au plus près de la démo sans schéma lourd, on
utilise ici un registre en mémoire alimenté par partnerWorld seed ; la version
PostgreSQL complète est fournie par la migration b4e77f19c0a2 (table partners
optionnelle) — ce routeur reste interchangeable.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models import User, AuditLog
from app.schemas import PartnerUpdateIn, PartnerMigrateIn
from app.core.security import require_role

router = APIRouter(prefix="/partners", tags=["Partner Admin"])

# Quotas miroirs de demoMode.ts (plans -> seats/devices/price EUR)
PLAN_QUOTAS = {
    "Starter":  {"seats": 5,  "devices": 300,  "price": 190},
    "Business": {"seats": 15, "devices": 1200, "price": 520},
    "Scale":    {"seats": 40, "devices": 4000, "price": 1180},
}


def _audit(current_user: User, action: str, details: str) -> AuditLog:
    return AuditLog(
        actor_id=current_user.id,
        actor_name=current_user.name or current_user.email,
        actor_role=current_user.role, org_id=None,
        action=action, resource="partner", resource_id=action,
        details=details, outcome="success",
    )


class _PartnerStore:
    """Registre minimal aligné sur partnerWorld.ts (seed) — remplacé par la DB
    dès que la table partners est migrée. Les routes restent identiques."""
    def __init__(self):
        self._items: dict[str, dict] = {}

    def seed(self, partners: list[dict]):
        for p in partners:
            self._items[p["id"]] = p

    def get(self, pid: str) -> dict:
        if pid not in self._items:
            raise HTTPException(404, f"Partenaire {pid} introuvable")
        return self._items[pid]

    def all(self) -> list[dict]:
        return list(self._items.values())

    def remove(self, pid: str):
        self._items.pop(pid, None)


store = _PartnerStore()


def ensure_seeded():
    """Seed paresseux depuis partnerWorld si la DB n'est pas branchée."""
    if store._items:
        return
    try:  # lecture du module TS impossible en Python -> fallback statique léger
        from app.services.partner_seed import PARTNERS_SEED
        store.seed(PARTNERS_SEED)
    except Exception:
        pass


@router.patch("/{pid}")
async def update_partner(
    pid: str, body: PartnerUpdateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin")),
):
    ensure_seeded()
    p = store.get(pid)
    changed = []
    for k, v in body.model_dump(exclude_none=True).items():
        p[k] = v
        changed.append(k)
    db.add(_audit(current_user, "partner.updated",
                  f"Partenaire {p.get('company')} modifié ({', '.join(changed)})"))
    await db.commit()
    return p


@router.post("/{pid}/suspend")
async def suspend_partner(
    pid: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin")),
):
    ensure_seeded()
    p = store.get(pid)
    p["status"] = "suspended" if p.get("status") != "suspended" else "active"
    db.add(_audit(current_user, "partner.status_changed",
                  f"Partenaire {p.get('company')} → {p['status']}"))
    await db.commit()
    return {"status": p["status"]}


@router.post("/{pid}/migrate")
async def migrate_partner(
    pid: str, body: PartnerMigrateIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin")),
):
    ensure_seeded()
    target = str(body.plan or "")
    if target not in PLAN_QUOTAS:
        raise HTTPException(400, f"Plan invalide — attendu: {'|'.join(PLAN_QUOTAS)}")
    p = store.get(pid)
    q = PLAN_QUOTAS[target]
    lic = p.setdefault("license", {})
    lic.update({"plan": target, "client_seats": q["seats"],
                "device_allowance": q["devices"], "price_month_eur": q["price"]})
    db.add(_audit(current_user, "partner.migrated",
                  f"Licence {p.get('company')} migrée vers {target} ({q['price']} €/mois)"))
    await db.commit()
    return lic


@router.delete("/{pid}", status_code=204)
async def delete_partner(
    pid: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("platform_admin")),
):
    ensure_seeded()
    p = store.get(pid)
    clients = p.get("end_clients") or []
    if len(clients) > 0:
        raise HTTPException(409,
                            f"Impossible de supprimer : {len(clients)} client(s) final(aux) "
                            "encore rattaché(s). Migrez-les d'abord.")
    store.remove(pid)
    db.add(_audit(current_user, "partner.deleted",
                  f"Partenaire {p.get('company')} supprimé du programme"))
    await db.commit()
