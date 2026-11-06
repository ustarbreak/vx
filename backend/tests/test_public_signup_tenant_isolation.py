"""Regression tests for public signup tenant-boundary enforcement."""
import pytest
from fastapi import HTTPException
from app.routers.auth import register
from app.schemas import UserCreate

@pytest.mark.asyncio
async def test_public_signup_rejects_caller_selected_tenant():
    payload = UserCreate(email="outsider@example.com", password="ValidPassword123!",
                         name="Outside user", role="client_user", org_id=1234)
    with pytest.raises(HTTPException) as error:
        await register(payload, request=None, db=None)
    assert error.value.status_code == 403
    assert "Tenant membership" in error.value.detail

@pytest.mark.asyncio
async def test_public_signup_rejects_privileged_role_before_database_access():
    payload = UserCreate(email="admin@example.com", password="ValidPassword123!",
                         name="External admin", role="client_admin", org_id=None)
    with pytest.raises(HTTPException) as error:
        await register(payload, request=None, db=None)
    assert error.value.status_code == 403