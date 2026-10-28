from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "Infracentra API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://infracentra:infracentra@localhost:5432/infracentra"
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    
    # JWT
    SECRET_KEY: str = "your-super-secret-key-change-in-production-min-32-chars"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    # Event evidence retention (Stage 1 — durable per-event raw payloads).
    # Days an accepted event's raw payload is kept before the nightly expiry
    # job nulls it (row + integrity metadata survive; see services/evidence.py).
    EVIDENCE_RETENTION_DAYS: int = 90
    # Hard cap for inline payload bytes. Over-size => stored truncated with a
    # full-body sha256 retained; over hard ceiling => ingest rejected (413).
    EVIDENCE_MAX_INLINE_BYTES: int = 262144          # 256 KB stored inline
    EVIDENCE_HARD_LIMIT_BYTES: int = 1048576         # 1 MB absolute ingest cap

    # Shared pipeline side-effect idempotency window (Stage 2). A retried
    # submission of an event already processed within this window replays the
    # recorded outcome instead of re-running tickets/notifications.
    PIPELINE_SIDE_EFFECT_WINDOW_MINUTES: int = 60
    
    # Wazuh Integration
    WAZUH_URL: Optional[str] = None
    WAZUH_API_USER: Optional[str] = None
    WAZUH_API_PASSWORD: Optional[str] = None
    
    # MISP Integration
    MISP_URL: Optional[str] = None
    MISP_API_KEY: Optional[str] = None
    
    # Elastic Integration
    ELASTIC_URL: Optional[str] = None
    ELASTIC_API_KEY: Optional[str] = None
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
