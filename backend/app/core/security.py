import base64
import hashlib
from datetime import datetime, timedelta, timezone as tz
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from passlib.exc import UnknownHashError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.config import settings
from app.database import get_db
from app.models import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()


def _b64_pad_sha(data):
    """Pre-hash with SHA-256 + base64 so any password length works with bcrypt's 72-byte limit.
    Accepts str or bytes; always returns bytes (base64 of the sha256 digest, 44 chars — safely under 72)."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    digest = hashlib.sha256(data).digest()
    return base64.b64encode(digest)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        # Legacy hashes (created before pre-hashing fix) may be longer than 72 bytes raw;
        # passlib+bcrypt>=4 raises ValueError instead of truncating. Guard both paths.
        return pwd_context.verify(_b64_pad_sha(plain_password.encode("utf-8")).decode("utf-8"), hashed_password)
    except (ValueError, UnknownHashError):
        try:
            return pwd_context.verify(plain_password, hashed_password)
        except ValueError:
            return False


def get_password_hash(password: str) -> str:
    return pwd_context.hash(_b64_pad_sha(password.encode("utf-8")).decode("utf-8"))


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        payload = jwt.decode(credentials.credentials, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if user is None:
        raise credentials_exception
    
    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is not active"
        )
    
    return user


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    return current_user


async def get_agent_token(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
):
    """Authenticate a goinfra agent by its tenant API token (Bearer icag_...).

    Returns the AgentToken row (org_id scopes everything the agent can touch).
    Only the SHA-256 hash of the secret is stored server-side.
    """
    from app.models import AgentToken
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid agent token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token = credentials.credentials
    if not token.startswith("icag_"):
        raise invalid
    thash = hashlib.sha256(token.encode()).hexdigest()
    row = (await db.execute(select(AgentToken).where(AgentToken.token_hash == thash))).scalars().first()
    if row is None or row.revoked_at is not None:
        raise invalid
    row.last_used_at = datetime.now(tz.utc)
    await db.commit()
    return row


def require_role(required_role: str):
    async def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role != required_role and current_user.role != "platform_admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )
        return current_user
    return role_checker
