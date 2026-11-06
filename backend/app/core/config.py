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

    EVIDENCE_RETENTION_DAYS: int = 90
    EVIDENCE_MAX_INLINE_BYTES: int = 262144
    EVIDENCE_HARD_LIMIT_BYTES: int = 1048576
    PIPELINE_SIDE_EFFECT_WINDOW_MINUTES: int = 60
    
    WAZUH_URL: Optional[str] = None
    WAZUH_API_USER: Optional[str] = None
    WAZUH_API_PASSWORD: Optional[str] = None
    MISP_URL: Optional[str] = None
    MISP_API_KEY: Optional[str] = None
    ELASTIC_URL: Optional[str] = None
    ELASTIC_API_KEY: Optional[str] = None

    PLATFORM_CATALOG_ENABLED: bool = False
    # Certificate verification is secure by default. Disable only for a trusted
    # lab using self-signed certificates; never disable it in public production.
    CONNECTOR_TLS_VERIFY: bool = True
    VELOCIRAPTOR_URL: str = ""
    VELOCIRAPTOR_TOKEN: str = ""
    ALLOW_LIVE_RESPONSE: bool = False
    UNBOUND_CONTROL_CMD: str = ""
    RSPAMD_URL: str = ""
    RSPAMD_KEY: str = ""
    PROVIDER_MODE: str = "native"
    SERVICE_LIFECYCLE_ENABLED: bool = False

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
