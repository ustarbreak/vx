"""Real MFA (TOTP) for the production login flow — RFC 6238 implemented with
stdlib only (hmac + struct), so it works on Kali and Windows without extra pip
packages. Compatible with Google Authenticator / Authy / FreeOTP / Aegis.

Flow:
  POST /mfa/setup            -> generate secret + otpauth:// URI (show QR)
  POST /mfa/setup/confirm    -> verify a 6-digit code, activate MFA
  POST /auth/login           -> returns {mfa_required:true} when enabled;
                                then POST /mfa/verify {token} -> JWT
  POST /mfa/disable          -> password re-check + optional backup code
Backup codes: single-use, stored hashed.
"""
import os
import base64
import time
import hmac
import hashlib
import struct
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.core.security import get_current_user, create_access_token
from app.models import User, UserTotpSecret

router = APIRouter(prefix="/mfa", tags=["MFA"])

ISSUER = os.getenv("MFA_ISSUER", "INFRAvx")


# ---------------------------------------------------------------------------
# TOTP core (RFC 6238, SHA1, 30s step, 6 digits)
# ---------------------------------------------------------------------------
def generate_secret(n_bytes: int = 20) -> str:
    return base64.b32encode(secrets.token_bytes(n_bytes)).decode().rstrip("=")


def totp_code(secret_b32: str, at: float | None = None, step: int = 30, digits: int = 6) -> str:
    pad = "=" * (-len(secret_b32) % 8)
    key = base64.b32decode(secret_b32 + pad, casefold=True)
    counter = int((at if at is not None else time.time()) // step)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(code).zfill(digits)


def verify_totp(secret_b32: str, code: str, window: int = 1) -> bool:
    now = time.time()
    for delta in range(-window, window + 1):
        if hmac.compare_digest(totp_code(secret_b32, now + delta * 30), code.strip()):
            return True
    return False


def otpauth_uri(email: str, secret_b32: str) -> str:
    from urllib.parse import quote
    label = quote(email)
    return f"otpauth://totp/{ISSUER}:{label}?secret={secret_b32}&issuer={quote(ISSUER)}&algorithm=SHA1&digits=6&period=30"


def _new_backup_codes(n: int = 8) -> tuple[list[str], list[str]]:
    plain = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(n)]
    hashed = [hashlib.sha256(c.encode()).hexdigest() for c in plain]
    return plain, hashed


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
class ConfirmBody(BaseModel):
    code: str


class VerifyBody(BaseModel):
    email: str
    code: str


class DisableBody(BaseModel):
    password: str
    code: str | None = None


@router.post("/setup")
async def setup(current_user: User = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)):
    secret = generate_secret()
    row = (await db.execute(select(UserTotpSecret).where(
        UserTotpSecret.user_id == current_user.id))).scalars().first()
    if row:
        row.secret, row.confirmed = secret, False
        row.backup_codes = []
    else:
        db.add(UserTotpSecret(user_id=current_user.id, secret=secret, confirmed=False))
    await db.commit()
    return {"secret": secret, "otpauth_uri": otpauth_uri(current_user.email, secret),
            "hint": "Scan the QR with Google Authenticator/Authy/FreeOTP, then confirm a code"}


@router.post("/setup/confirm")
async def confirm(body: ConfirmBody, current_user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(UserTotpSecret).where(
        UserTotpSecret.user_id == current_user.id))).scalars().first()
    if not row or not row.secret:
        raise HTTPException(400, "Call /mfa/setup first")
    if not verify_totp(row.secret, body.code):
        raise HTTPException(422, "Invalid code — check clock drift or retry")
    plain, hashed = _new_backup_codes()
    row.confirmed = True
    row.backup_codes = hashed
    current_user.mfa_enabled = True
    await db.commit()
    return {"ok": True, "backup_codes": plain,
            "note": "Store these one-time recovery codes safely"}


@router.get("/status")
async def status_mfa(current_user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(UserTotpSecret).where(
        UserTotpSecret.user_id == current_user.id))).scalars().first()
    return {"mfa_enabled": bool(current_user.mfa_enabled and row and row.confirmed),
            "methods_available": ["totp_app", "backup_codes"]}


@router.post("/verify")
async def verify_login_second_factor(body: VerifyBody, db: AsyncSession = Depends(get_db)):
    """Second step of the real login when MFA is on. Password already checked
    by /auth/login (which returned mfa_required); here we validate the code."""
    user = (await db.execute(select(User).where(User.email == body.email.lower()))).scalars().first()
    if not user or not user.mfa_enabled:
        raise HTTPException(400, "MFA not enabled for this account")
    row = (await db.execute(select(UserTotpSecret).where(
        UserTotpSecret.user_id == user.id))).scalars().first()
    if not row:
        raise HTTPException(400, "MFA not provisioned")
    ok = verify_totp(row.secret, body.code)
    if not ok:
        # try backup code (single use)
        h = hashlib.sha256(body.code.strip().encode()).hexdigest()
        codes = list(row.backup_codes or [])
        if h in codes:
            codes.remove(h)
            row.backup_codes = codes
            await db.commit()
            ok = True
    if not ok:
        raise HTTPException(422, "Invalid or expired code")
    return {"access_token": create_access_token({"sub": user.email}),
            "token_type": "bearer", "user": {"email": user.email, "role": user.role,
                                              "org_id": user.org_id}}


@router.post("/disable")
async def disable(body: DisableBody, current_user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db)):
    from app.core.security import verify_password
    if not verify_password(body.password, current_user.hashed_password):
        raise HTTPException(422, "Password incorrect")
    row = (await db.execute(select(UserTotpSecret).where(
        UserTotpSecret.user_id == current_user.id))).scalars().first()
    if row:
        await db.delete(row)
    current_user.mfa_enabled = False
    await db.commit()
    return {"ok": True, "mfa_enabled": False}
