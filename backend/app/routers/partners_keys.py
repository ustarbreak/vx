"""Partner Portal — Phase 5.2: scoped API keys + outgoing webhooks.

Routes (all under /api/partners, tenant-isolated via partners._resolve_partner):

  GET    /partners/{pid}/api-keys                 list (prefix only, never the secret)
  POST   /partners/{pid}/api-keys                 create -> plaintext shown ONCE
  DELETE /partners/{pid}/api-keys/{kid}           revoke
  GET    /partners/{pid}/webhooks                 list endpoints + recent deliveries
  POST   /partners/{pid}/webhooks                 register (https-only URL validated)
  PATCH  /partners/{pid}/webhooks/{wid}           enable/disable, edit events/url/secret
  DELETE /partners/{pid}/webhooks/{wid}           remove

Security model (rule 5):
  * Keys are random 32-byte urlsafe secrets; ONLY a SHA-256 hash is stored.
    Lookup/auth would compare hashes; admins can never recover a key.
  * Scopes are a Pydantic Literal subset — read/alerts/tickets/billing — never free text.
  * Webhook payloads are HMAC-SHA256 signed with the endpoint's own secret
    (header X-IC-Signature), so receivers can verify authenticity.
  * All writes rate-limited and audited (rule 2 audit trail).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, HttpUrl, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.database import get_db
from app.models import User
from app.routers.partners import _audit, _rate_limit, _resolve_partner, _save_settings, _settings

router = APIRouter(prefix="/partners", tags=["Partner Portal Keys & Webhooks"])

KEY_SCOPES = ("read", "alerts", "tickets", "billing")
WEBHOOK_EVENTS = ("alert.created", "ticket.updated", "incident.breached", "report.generated")


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class ApiKeyIn(BaseModel):
    label: str = Field(min_length=2, max_length=80)
    scopes: list[Literal["read", "alerts", "tickets", "billing"]] = Field(min_length=1)


class ApiKeyOut(BaseModel):
    id: str
    label: str
    prefix: str
    scopes: list[str]
    created_at: str
    last_used: Optional[str] = None
    revoked: bool = False


class WebhookIn(BaseModel):
    url: HttpUrl
    events: list[Literal["alert.created", "ticket.updated", "incident.breached", "report.generated"]] = Field(min_length=1)
    # Optional: when omitted the server generates one and returns it exactly once.
    secret: Optional[str] = Field(default=None, min_length=16, max_length=128)
    enabled: bool = True

    @model_validator(mode="after")
    def _https_only(self):
        if self.url.scheme != "https":
            raise ValueError("URL de webhook en https obligatoire")
        return self


class WebhookPatch(BaseModel):
    url: Optional[HttpUrl] = None
    events: Optional[list[Literal["alert.created", "ticket.updated", "incident.breached", "report.generated"]]] = None
    secret: Optional[str] = Field(default=None, min_length=16, max_length=128)
    enabled: Optional[bool] = None

    @model_validator(mode="after")
    def _https_only(self):
        if self.url is not None and self.url.scheme != "https":
            raise ValueError("URL de webhook en https obligatoire")
        return self


async def _store(db: AsyncSession, partner_id: int, key: str, value) -> None:
    data = await _settings(db, partner_id)
    bucket = dict(data.get(key) or {})
    bucket.update(value if isinstance(value, dict) else {value[0]: value[1]})
    data[key] = bucket
    await _save_settings(db, partner_id, data)


async def _bucket(db: AsyncSession, partner_id: int, key: str) -> dict:
    data = await _settings(db, partner_id)
    return dict(data.get(key) or {})


# --------------------------------------------------------------------------- #
# API keys                                                                     #
# --------------------------------------------------------------------------- #
@router.get("/{pid}/api-keys")
async def list_keys(pid: str, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    bucket = await _bucket(db, partner.id, "api_keys")
    return {"items": [{**ApiKeyOut(**v).model_dump(),
                       "preview": v["prefix"],
                       "status": "revoked" if v.get("revoked") else "active"}
                      for v in bucket.values()]}


@router.post("/{pid}/api-keys", status_code=201)
async def create_key(pid: str, body: ApiKeyIn, request: Request,
                     user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    _rate_limit(f"keys:{user.id}", max_calls=5)
    partner = await _resolve_partner(pid, user, db)
    raw = "ic_" + secrets.token_urlsafe(32)
    kid = secrets.token_hex(8)
    row = ApiKeyOut(id=kid, label=body.label, prefix=raw[:10], scopes=sorted(set(body.scopes)),
                    created_at=datetime.now(timezone.utc).isoformat()).model_dump()
    bucket = await _bucket(db, partner.id, "api_keys")
    bucket[kid] = row
    data = await _settings(db, partner.id)
    data["api_keys"] = bucket
    data.setdefault("api_key_hashes", {})[kid] = _hash_key(raw)
    await _save_settings(db, partner.id, data)
    db.add(_audit(user, "partner.keys.create", kid, f"{body.label} scopes={row['scopes']}", partner.id))
    await db.commit()
    # plaintext returned exactly once; only its hash persists
    return {**row, "key": raw}


@router.delete("/{pid}/api-keys/{kid}", status_code=204)
async def revoke_key(pid: str, kid: str,
                     user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)):
    _rate_limit(f"keys:{user.id}", max_calls=5)
    partner = await _resolve_partner(pid, user, db)
    data = await _settings(db, partner.id)
    bucket = dict(data.get("api_keys") or {})
    if kid not in bucket:
        raise HTTPException(404, "Clé introuvable")
    bucket[kid] = {**bucket[kid], "revoked": True}
    data["api_keys"] = bucket
    data.get("api_key_hashes", {}).pop(kid, None)
    await _save_settings(db, partner.id, data)
    db.add(_audit(user, "partner.keys.revoke", kid, bucket[kid]["label"], partner.id))
    await db.commit()


# --------------------------------------------------------------------------- #
# Outgoing webhooks                                                            #
# --------------------------------------------------------------------------- #
@router.get("/{pid}/webhooks")
async def list_webhooks(pid: str, user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    partner = await _resolve_partner(pid, user, db)
    bucket = await _bucket(db, partner.id, "webhooks")
    deliveries = (await _bucket(db, partner.id, "webhook_deliveries")).get("log", [])
    return {"items": [{k: v for k, v in r.items() if k != "secret"} for r in bucket.values()],
            "recent_deliveries": deliveries[-20:]}


@router.post("/{pid}/webhooks", status_code=201)
async def create_webhook(pid: str, body: WebhookIn, request: Request,
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    _rate_limit(f"hooks:{user.id}", max_calls=5)
    partner = await _resolve_partner(pid, user, db)
    wid = secrets.token_hex(8)
    secret = body.secret or ("whsec_" + secrets.token_urlsafe(24))
    row = {"id": wid, "url": str(body.url), "events": sorted(set(body.events)),
           "secret": secret, "enabled": body.enabled,
           "created_at": datetime.now(timezone.utc).isoformat()}
    bucket = await _bucket(db, partner.id, "webhooks")
    bucket[wid] = row
    await _store(db, partner.id, "webhooks", bucket)
    db.add(_audit(user, "partner.webhooks.create", wid, f"{body.url} events={row['events']}", partner.id))
    await db.commit()
    # secret returned exactly once at creation; listings strip it (rule 5)
    return {**{k: v for k, v in row.items() if k != "secret"}, "secret": secret}


@router.patch("/{pid}/webhooks/{wid}")
async def patch_webhook(pid: str, wid: str, body: WebhookPatch, request: Request,
                        user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)):
    _rate_limit(f"hooks:{user.id}", max_calls=10)
    partner = await _resolve_partner(pid, user, db)
    bucket = await _bucket(db, partner.id, "webhooks")
    if wid not in bucket:
        raise HTTPException(404, "Webhook introuvable")
    upd = body.model_dump(exclude_none=True)
    bucket[wid] = {**bucket[wid], **{k: (str(v) if k == "url" else v) for k, v in upd.items()}}
    await _store(db, partner.id, "webhooks", bucket)
    db.add(_audit(user, "partner.webhooks.update", wid, ",".join(sorted(upd)), partner.id))
    await db.commit()
    return {k: v for k, v in bucket[wid].items() if k != "secret"}


@router.delete("/{pid}/webhooks/{wid}", status_code=204)
async def delete_webhook(pid: str, wid: str,
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    _rate_limit(f"hooks:{user.id}", max_calls=5)
    partner = await _resolve_partner(pid, user, db)
    bucket = await _bucket(db, partner.id, "webhooks")
    if wid not in bucket:
        raise HTTPException(404, "Webhook introuvable")
    bucket.pop(wid)
    await _store(db, partner.id, "webhooks", bucket)
    db.add(_audit(user, "partner.webhooks.delete", wid, "", partner.id))
    await db.commit()


def sign_payload(secret: str, body: dict) -> str:
    """HMAC of the canonical JSON — exposed for the delivery worker (Phase 5.3 sync job)."""
    payload = json.dumps(body, sort_keys=True).encode("utf-8")
    return "sha256=" + hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
