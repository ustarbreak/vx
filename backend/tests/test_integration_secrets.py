import pytest
from cryptography.fernet import Fernet
from app.core.config import settings
from app.services import integration_secrets as secrets

def test_round_trip_and_at_rest_ciphertext(monkeypatch):
    monkeypatch.setattr(settings, "INTEGRATION_ENCRYPTION_KEY", Fernet.generate_key().decode())
    encrypted = secrets.encrypt_secret("vendor-api-token")
    assert encrypted.startswith("fernet:v1:")
    assert "vendor-api-token" not in encrypted
    assert secrets.decrypt_secret(encrypted) == "vendor-api-token"

def test_legacy_plaintext_is_readable_for_backfill():
    assert secrets.decrypt_secret("legacy-token") == "legacy-token"

def test_encryption_is_idempotent(monkeypatch):
    monkeypatch.setattr(settings, "INTEGRATION_ENCRYPTION_KEY", Fernet.generate_key().decode())
    first = secrets.encrypt_secret("token")
    assert secrets.encrypt_secret(first) == first

def test_production_requires_dedicated_encryption_key():
    from pydantic import ValidationError
    from app.core.config import Settings
    with pytest.raises(ValidationError, match="INTEGRATION_ENCRYPTION_KEY"):
        Settings(APP_ENV="production", SECRET_KEY="a-unique-production-secret-value-0123456789",
                 DATABASE_URL="postgresql+asyncpg://user:password@db:5432/app",
                 CORS_ORIGINS=["https://app.example.com"], CONNECTOR_TLS_VERIFY=True)
