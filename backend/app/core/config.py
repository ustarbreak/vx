from pydantic_settings import BaseSettings
from pydantic import model_validator
from typing import Optional


class Settings(BaseSettings):
    # Application
    APP_ENV: str = "development"  # development | test | production
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

    # --- Platform catalog (additive tree, docs/audit/ADAPTED-PLAN.md T1.1) ---
    # OFF by default: nothing consumes the catalog unless explicitly opted in.
    PLATFORM_CATALOG_ENABLED: bool = False
    # Connector HTTP transport helper (T2.5). Default false == today's lenient
    # behavior (verify=False in wazuh.py/connectors.py). Owner decision #5:
    # strict-by-default is a later, explicit migration step. TODO_VERIFY.
    CONNECTOR_TLS_VERIFY: bool = False
    # T5.1 Velociraptor scaffold (roadmap). Empty URL => connector reports not_configured.
    VELOCIRAPTOR_URL: str = ""
    VELOCIRAPTOR_TOKEN: str = ""
    ALLOW_LIVE_RESPONSE: bool = False  # triple-gate for destructive live-response actions
    # T5.3 Unbound / Rspamd read-only scaffolds (roadmap). Empty => not_configured.
    UNBOUND_CONTROL_CMD: str = ""
    RSPAMD_URL: str = ""
    RSPAMD_KEY: str = ""
    # Canonical-action executor mode (T2.6). "native" delegates platform
    # actions to the existing engines (tickets/incidents/SOAR); anything else
    # keeps the safe Phase-1 behavior (validate + report unsupported/queued).
    PROVIDER_MODE: str = "native"
    # T4.2 service lifecycle tracking (not_installed→installed→connected→
    # first_success), persisted per org in ServiceLifecycleState. Purely
    # additive; existing /api/services/{id}/status payload is unchanged unless
    # this flag is on. OFF by default so current UIs see byte-identical JSON.
    SERVICE_LIFECYCLE_ENABLED: bool = False

    @model_validator(mode="after")
    def validate_production_configuration(self):
        if self.APP_ENV.strip().lower() != "production":
            return self

        problems = []
        weak_secrets = {
            "your-super-secret-key-change-in-production-min-32-chars",
            "change-this-to-a-secure-random-string-min-32-chars",
            "secret", "changeme", "password",
        }
        if len(self.SECRET_KEY) < 32 or self.SECRET_KEY.strip().lower() in weak_secrets:
            problems.append("SECRET_KEY must be a unique secret of at least 32 characters")
        if self.DEBUG:
            problems.append("DEBUG must be false")
        if not self.DATABASE_URL or "localhost" in self.DATABASE_URL or "127.0.0.1" in self.DATABASE_URL:
            problems.append("DATABASE_URL must point to the production database service")
        if not self.CORS_ORIGINS or "*" in self.CORS_ORIGINS:
            problems.append("CORS_ORIGINS must explicitly list trusted application origins")
        if not self.CONNECTOR_TLS_VERIFY:
            problems.append("CONNECTOR_TLS_VERIFY must be true")
        if problems:
            raise ValueError("Invalid production configuration: " + "; ".join(problems))
        return self

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
