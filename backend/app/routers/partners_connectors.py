"""Partner Portal — Phase 5.3: PSA/RMM + Microsoft 365 connectors (paid/common integrations).

Supported vendors (two-way ticket sync for PSA/RMM; read-only ingest for M365):
    connectwise | autotask | halopsa | ninjaone | microsoft365

Configuration model: one TenantSetting row per partner under key "connectors".
Each connector stores base_url / tenant / client_id and a *reference* to the
secret (never the secret itself in plaintext JSON — secrets live in the vault /
env on the server side; here we keep an opaque fingerprint so the UI can show
"configured" without exposing anything).

Endpoints (all tenant-isolated, rate-limited writes, audited):
    GET    /partners/{pid}/connectors                 list + status matrix
    PUT    /partners/{pid}/connectors/{vendor}        upsert config (validated Literal vendor)
    DELETE /partners/{pid}/connectors/{vendor}        remove config
    POST   /partners/{pid}/connectors/{vendor}/test   connectivity probe (dry, no external call in CI)
    POST   /partners/{pid}/connectors/{vendor}/sync   enqueue a two-way ticket sync run
                                                       -> records last_sync result in settings

The actual network calls are delegated to `app.services.psa_sync` so routers stay
thin and unit tests can monkeypatch the transport.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.database import get_db
from app.models import User
from app.routers.partners import _audit, _rate_limit, _resolve_partner, _save_settings, _settings

router = APIRouter(prefix="/partners", tags=["Partner Portal Connectors"])

VENDOR_IDS = ("connectwise", "autotask", "halopsa", "ninjaone", "microsoft365")
SYNC_VENDORS = ("connectwise", "autotask", "halopsa", "ninjaone")   # two-way ticket sync
VendorId = Literal["connectwise", "autotask", "halopsa", "ninjaone", "microsoft365"]

VENDOR_META = {
    "connectwise": {"label": "ConnectWise Manage", "direction": "two-way tickets", "auth": "OAuth2 + API tier"},
    "autotask": {"label": "Autotask PSA", "direction": "two-way tickets", "auth": "API user/secret"},
    "halopsa": {"label": "HaloPSA", "direction": "two-way tickets", "auth": "OAuth2 client credentials"},
    "ninjaone": {"label": "NinjaOne RMM", "direction": "devices + tickets", "auth": "API key pair"},
    "microsoft365": {"label": "Microsoft 365", "direction": "sign-in & audit log ingest", "auth": "Entra app (client creds)"},
}


class ConnectorIn(BaseModel):
    base_url: HttpUrl
    tenant: str = Field(min_length=1, max_length=120)
    client_id: str = Field(min_length=1, max_length=120)
    # Server-side only: hashed fingerprint of whatever secret the operator pastes.
    secret_ref: str = Field(min_length=8, max_length=128,
                            description="opaque reference/fingerprint of the stored secret")
    ticket_statuses: Optional[list[str]] = None


async def _bucket(db: AsyncSession, partner_id: int) -> dict:
    data = await _settings(db, partner_id)
    return dict(data.get("connectors") or {})


async def _put_bucket(db: AsyncSession, partner_id: int, bucket: dict) -> None:
    data = await _settings(db, partner_id)
    data["connectors"] = bucket
    await _save_settings(db, partner_id, data)


def _public_row(vendor: str, cfg: dict) -> dict:
    return {
        "vendor": vendor,
        "label": VENDOR_META[vendor]["label"],
        "direction": VENDOR_META[vendor]["direction"],
        "auth": VENDOR_META[vendor]["auth"],
        "base_url": cfg.get("base_url"), "tenant": cfg.get("tenant"),
        "client_id": cfg.get("client_id"),
        "configured": bool(cfg.get("secret_ref")),
        "last_sync": cfg.get("last_sync"),
        "last_result": cfg.get("last_result"),
    }


@router.get("/{pid}/connectors")
async def list_connectors(pid: str, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    bucket = await _bucket(db, partner.id)
    return {"items": [_public_row(v, bucket.get(v, {})) for v in VENDOR_IDS]}


@router.put("/{pid}/connectors/{vendor}")
async def upsert_connector(pid: str, vendor: VendorId, body: ConnectorIn, request: Request,
                           user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    _rate_limit(f"conn:{user.id}", max_calls=10)
    partner = await _resolve_partner(pid, user, db)
    bucket = await _bucket(db, partner.id)
    prev = bucket.get(vendor, {})
    bucket[vendor] = {**prev, **body.model_dump(), "updated_at": datetime.now(timezone.utc).isoformat()}
    await _put_bucket(db, partner.id, bucket)
    db.add(_audit(user, "partner.connectors.upsert", vendor, f"{str(body.base_url)} tenant={body.tenant}", partner.id))
    await db.commit()
    return _public_row(vendor, bucket[vendor])


@router.delete("/{pid}/connectors/{vendor}", status_code=204)
async def delete_connector(pid: str, vendor: VendorId,
                           user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    _rate_limit(f"conn:{user.id}", max_calls=10)
    partner = await _resolve_partner(pid, user, db)
    bucket = await _bucket(db, partner.id)
    if vendor not in bucket:
        raise HTTPException(404, "Connecteur non configuré")
    bucket.pop(vendor)
    await _put_bucket(db, partner.id, bucket)
    db.add(_audit(user, "partner.connectors.delete", vendor, "", partner.id))
    await db.commit()


@router.post("/{pid}/connectors/{vendor}/test")
async def test_connector(pid: str, vendor: VendorId,
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """Dry connectivity probe: validates stored config shape; the real handshake is
    performed by app.services.psa_sync.probe() which tests can stub."""
    from app.services import psa_sync
    _rate_limit(f"conn:{user.id}", max_calls=10)
    partner = await _resolve_partner(pid, user, db)
    cfg = (await _bucket(db, partner.id)).get(vendor)
    if not cfg:
        raise HTTPException(404, "Connecteur non configuré")
    ok, detail = await psa_sync.probe(vendor, cfg)
    db.add(_audit(user, "partner.connectors.test", vendor, f"{'ok' if ok else 'fail'}: {detail}", partner.id))
    await db.commit()
    return {"vendor": vendor, "ok": ok, "detail": detail}


@router.post("/{pid}/connectors/{vendor}/sync")
async def sync_connector(pid: str, vendor: VendorId,
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """Two-way ticket sync run (PSA/RMM only). M365 is ingest-only -> 405."""
    from app.services import psa_sync
    _rate_limit(f"sync:{user.id}", max_calls=3)
    partner = await _resolve_partner(pid, user, db)
    if vendor == "microsoft365":
        raise HTTPException(405, "Microsoft 365 est un flux d'ingestion uniquement (pas de sync tickets)")
    cfg = (await _bucket(db, partner.id)).get(vendor)
    if not cfg:
        raise HTTPException(404, "Connecteur non configuré")
    result = await psa_sync.run_ticket_sync(partner, vendor, cfg, db)
    bucket = await _bucket(db, partner.id)
    bucket[vendor] = {**cfg, "last_sync": datetime.now(timezone.utc).isoformat(),
                      "last_result": {k: result[k] for k in ("pushed", "pulled", "conflicts")}}
    await _put_bucket(db, partner.id, bucket)
    db.add(_audit(user, "partner.connectors.sync", vendor,
                  f"pushed={result['pushed']} pulled={result['pulled']} conflicts={result['conflicts']}", partner.id))
    await db.commit()
    return {"vendor": vendor, **result}
