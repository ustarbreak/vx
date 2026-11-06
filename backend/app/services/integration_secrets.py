"""Authenticated encryption for integration credentials stored in the database.

Production requires a dedicated Fernet key. Development falls back to a
deterministic key derived from SECRET_KEY so existing local environments can
exercise the feature without an extra setting. Never rotate the production key
without decrypting/re-encrypting existing credentials.
"""
from __future__ import annotations

import base64
import hashlib
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

_PREFIX = "fernet:v1:"


def _fernet() -> Fernet:
    configured = (getattr(settings, "INTEGRATION_ENCRYPTION_KEY", "") or "").strip()
    if configured:
        try:
            return Fernet(configured.encode("utf-8"))
        except Exception as exc:
            raise RuntimeError("INTEGRATION_ENCRYPTION_KEY is not a valid Fernet key") from exc
    if str(getattr(settings, "APP_ENV", "development")).lower() == "production":
        raise RuntimeError("INTEGRATION_ENCRYPTION_KEY is required in production")
    material = hashlib.sha256(str(settings.SECRET_KEY).encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(material))


def encrypt_secret(value: str | None) -> str | None:
    if value is None or value == "":
        return value
    if value.startswith(_PREFIX):
        # Avoid accidental double encryption when a value is passed through
        # an update or migration path more than once.
        decrypt_secret(value)
        return value
    token = _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return _PREFIX + token


def decrypt_secret(value: str | None) -> str | None:
    if value is None or value == "":
        return value
    if not value.startswith(_PREFIX):
        # Legacy plaintext value: supported only for migration/compatibility.
        return value
    try:
        return _fernet().decrypt(value[len(_PREFIX):].encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Stored integration credential cannot be decrypted; verify the encryption key") from exc


async def encrypt_legacy_integration_secrets(db) -> int:
    """Encrypt plaintext keys in-place once; safe to rerun after interruption."""
    from sqlalchemy import select
    from app.models import Integration

    rows = (await db.execute(select(Integration).where(Integration.api_key.is_not(None)))).scalars().all()
    changed = 0
    for row in rows:
        if row.api_key and not row.api_key.startswith(_PREFIX):
            row.api_key = encrypt_secret(row.api_key)
            changed += 1
    if changed:
        await db.commit()
    return changed
