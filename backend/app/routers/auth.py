from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from app.database import get_db
from app.models import User, Organization, AuditLog
from app.schemas import UserCreate, UserLogin, Token, UserResponse
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token
)
from app.core.config import settings

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Register a new user"""
    # Check if user already exists
    result = await db.execute(select(User).where(User.email == user_data.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # If org_id provided, check if organization exists
    if user_data.org_id:
        result = await db.execute(select(Organization).where(Organization.id == user_data.org_id))
        if not result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found"
            )
    
    # Create user
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        email=user_data.email,
        hashed_password=hashed_password,
        name=user_data.name,
        role=user_data.role,
        org_id=user_data.org_id
    )
    
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    # Log audit
    audit_log = AuditLog(
        actor_id=new_user.id,
        actor_name=new_user.name,
        actor_role=new_user.role,
        org_id=new_user.org_id,
        action="user.registered",
        resource="User",
        resource_id=str(new_user.id),
        details=f"New user registered: {new_user.email}",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    await db.commit()
    
    return new_user


class TokenWithUser(Token):
    user: UserResponse | None = None
    mfa_required: bool = False        # real backend MFA: continue at POST /api/mfa/verify
    email: str | None = None
    mfa_setup_required: bool = False  # partner policy enforced but user not enrolled yet
    reason: str | None = None         # e.g. "partner_mfa_policy"


async def _partner_mfa_enforced(db: AsyncSession, user: User) -> bool:
    """Phase 5.1 enforcement point: if the user's org is a partner with the
    require_mfa policy set (stored in TenantSetting JSON key 'mfa_policy'),
    every active member must have TOTP enrolled before receiving a JWT.
    Kept local (no import from partners_team) to avoid an import cycle."""
    if not user.org_id or user.role == "platform_admin":
        return False
    org = await db.get(Organization, user.org_id)
    if org is None or not getattr(org, "is_partner", False):
        return False
    from app.models import TenantSetting
    row = (await db.execute(
        select(TenantSetting).where(TenantSetting.org_id == user.org_id)
    )).scalar_one_or_none()
    data = dict(row.data or {}) if row else {}
    return bool((data.get("mfa_policy") or {}).get("require_mfa", False))


@router.post("/login")  # response_model removed on purpose: may return MFA challenge
async def login(
    credentials: UserLogin,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Login and get access token"""
    # Find user
    result = await db.execute(select(User).where(User.email == credentials.email))
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(credentials.password, user.hashed_password):
        # Log failed attempt
        audit_log = AuditLog(
            actor_name=credentials.email,
            actor_role="unknown",
            action="user.login_failed",
            resource="User",
            resource_id=credentials.email,
            details="Invalid credentials",
            ip_address=request.client.host if request.client else None,
            outcome="failure"
        )
        db.add(audit_log)
        await db.commit()
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is not active"
        )
    
    # Update last login
    user.last_login = datetime.utcnow()
    await db.commit()

    # ---- Real MFA (TOTP): if enabled, stop here and issue a challenge.
    # The client must POST /api/mfa/verify {email, code} to receive the JWT.
    if getattr(user, "mfa_enabled", False):
        return {"access_token": None, "token_type": "bearer", "user": None,
                "mfa_required": True, "email": user.email}

    # ---- Phase 5.1 partner MFA enforcement: policy says require_mfa but this
    # active member has not enrolled yet -> no token; explicit setup challenge.
    # Never a silent bypass, never a lockout: after /api/mfa/setup + confirm,
    # login proceeds normally (or via /api/mfa/verify second factor).
    if await _partner_mfa_enforced(db, user):
        audit_log = AuditLog(
            actor_id=user.id, actor_name=user.name, actor_role=user.role,
            org_id=user.org_id,
            action="user.login_mfa_setup_required",
            resource="User", resource_id=str(user.id),
            details="Partner MFA policy enforced; TOTP enrollment pending",
            ip_address=request.client.host if request.client else None,
            outcome="blocked",
        )
        db.add(audit_log)
        await db.commit()
        return {"access_token": None, "token_type": "bearer", "user": None,
                "mfa_required": False, "mfa_setup_required": True,
                "reason": "partner_mfa_policy", "email": user.email}

    # Create access token
    access_token = create_access_token(
        data={"sub": user.id, "email": user.email, "role": user.role, "ver": int(user.auth_version or 0)}
    )
    
    # Log successful login
    audit_log = AuditLog(
        actor_id=user.id,
        actor_name=user.name,
        actor_role=user.role,
        org_id=user.org_id,
        action="user.login",
        resource="User",
        resource_id=str(user.id),
        details="Successful login",
        ip_address=request.client.host if request.client else None,
        outcome="success"
    )
    db.add(audit_log)
    await db.commit()
    
    # Return the authenticated user object alongside the JWT so the frontend
    # can hydrate its session (role / org) without a second round-trip.
    return {"access_token": access_token, "token_type": "bearer", "user": user}


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(
        __import__("app.core.security", fromlist=["get_current_user"]).get_current_user
    )
):
    """Get current user information"""
    return current_user
