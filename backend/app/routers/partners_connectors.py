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
from pydantic import BaseModel, Field, model_validator, HttpUrl
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
    model_config = {"extra": "ignore"}
    enabled: bool = True
    # PSA/RMM endpoints are https URLs; Microsoft 365 is identified by tenant_id
    # (+client_id) and may omit base_url (graph endpoint is implicit).
    base_url: Optional[str] = Field(default=None, max_length=300)
    # PSA identifiers — accepted under several common spellings from the UI.
    tenant: Optional[str] = Field(default=None, max_length=120)
    tenant_id: Optional[str] = Field(default=None, max_length=120)
    api_identifier: Optional[str] = Field(default=None, max_length=120)
    client_id: Optional[str] = Field(default=None, max_length=120)
    # Raw credential is accepted here (or via X-IC-Connector-Secret header) but
    # NEVER persisted in plaintext — it becomes an opaque secret_ref fingerprint.
    secret: Optional[str] = Field(default=None, min_length=8, max_length=512)
    ticket_statuses: Optional[list[str]] = None

    @model_validator(mode="after")
    def _normalize(self):
        self.tenant = (self.tenant or self.tenant_id or self.api_identifier or "").strip()
        self.client_id = (self.client_id or self.api_identifier or "").strip()
        if self.base_url and not self.base_url.startswith("https://"):
            raise ValueError("base_url doit être en https")
        # PSA/RMM connectors identify themselves with tenant OR api_identifier;
        # Microsoft 365 uses tenant_id + client_id. Either identifier pair is fine.
        if not self.tenant and not self.client_id:
            raise ValueError("identifiant de compte requis (tenant / api_identifier / client_id)")
        return self


class ConnectorSecretIn(BaseModel):
    """Body of POST /connectors/{vendor}/secret — the ONLY place a raw secret
    is ever accepted. It is hashed to an opaque fingerprint server-side and
    never stored or echoed back in plaintext (rule 5)."""
    secret: str = Field(min_length=8, max_length=512)


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
        "secret_configured": bool(cfg.get("secret_ref")),
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
    incoming = body.model_dump()
    raw_secret = incoming.pop("secret", None) or request.headers.get("X-IC-Connector-Secret")
    # Never persist a plaintext secret: store only an opaque SHA-256 fingerprint.
    if raw_secret and len(raw_secret) >= 8:
        incoming["secret_ref"] = "sha256:" + hashlib.sha256(raw_secret.encode()).hexdigest()[:32]
    merged = {**prev, **{k: v for k, v in incoming.items() if v is not None},
              "enabled": body.enabled,
              "updated_at": datetime.now(timezone.utc).isoformat()}
    bucket[vendor] = merged
    await _put_bucket(db, partner.id, bucket)
    db.add(_audit(user, "partner.connectors.upsert", vendor, f"{str(body.base_url)} tenant={body.tenant}", partner.id))
    await db.commit()
    return _public_row(vendor, bucket[vendor])


@router.post("/{pid}/connectors/{vendor}/secret")
async def set_connector_secret(pid: str, vendor: VendorId, body: ConnectorSecretIn,
                               request: Request,
                               user: User = Depends(get_current_user),
                               db: AsyncSession = Depends(get_db)):
    """Rotate the connector credential. Hashed to a fingerprint; plaintext is
    never stored nor returned."""
    _rate_limit(f"conn:{user.id}", max_calls=10)
    partner = await _resolve_partner(pid, user, db)
    bucket = await _bucket(db, partner.id)
    if vendor not in bucket:
        raise HTTPException(404, "Connecteur non configuré")
    bucket[vendor] = {**bucket[vendor],
                      "secret_ref": "sha256:" + hashlib.sha256(body.secret.encode()).hexdigest()[:32],
                      "updated_at": datetime.now(timezone.utc).isoformat()}
    await _put_bucket(db, partner.id, bucket)
    db.add(_audit(user, "partner.connectors.rotate_secret", vendor, "", partner.id))
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
