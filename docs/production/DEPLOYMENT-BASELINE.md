# Production deployment baseline

A production-specific Compose file is provided separately from the existing
development/demo stack.

## Prepare

1. Provision a supported Linux host with Docker Engine and Compose plugin.
2. Point the application DNS record at the host.
3. Copy `.env.production.example` to `.env`; replace every placeholder.
4. Generate a unique secret using `openssl rand -hex 32`.
5. Set CORS_ORIGINS to a JSON array containing only the real HTTPS frontend
   origin. URL-encode reserved characters in DATABASE_URL credentials.
6. Keep .env out of source control and run `chmod 600 .env`.

## Start and inspect

```bash
docker compose --env-file .env -f docker-compose.production.yml config
docker compose --env-file .env -f docker-compose.production.yml up -d --build
docker compose --env-file .env -f docker-compose.production.yml ps
docker compose --env-file .env -f docker-compose.production.yml logs -f backend
```

The frontend binds to 127.0.0.1:3000. Publish it through a separately managed
reverse proxy with valid TLS certificates. Do not expose PostgreSQL, Redis, or
FastAPI directly to the public internet. Preserve Host and X-Forwarded-Proto
headers at the proxy.

## Known limitations — not a production certification

- /health currently confirms process liveness, not full database/Redis readiness.
- Startup currently calls init_db(); verify the Alembic migration path and
  backup/restore procedure against staging before a production rollout.
- DEMO_SEED_ENABLED=false is set, but every seeding path must be audited before
  claiming all demo fixtures are disabled.
- This file does not provision DNS, TLS certificates, firewall rules, backups,
  monitoring, secret management, or external connector credentials.
- Pin and scan immutable image versions before commercial deployment.
- Existing development Compose files are intentionally unchanged.

Run migration, integration, tenant-isolation, security, backup/restore and
failure-recovery acceptance tests before onboarding customers.
