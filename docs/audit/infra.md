# Infrastructure Audit (T0.5)

All items below verified by opening the files in the working tree on 2026-11-01.

## Compose stack (2 files, both at repo root)
| File | Services (container_name) | Evidence |
|---|---|---|
| `docker-compose.yml` | infracentra-db (**postgres:18**, L4), infracentra-redis (**redis:7-alpine**, L27), infracentra-backend (L44, builds `backend/Dockerfile`), infracentra-frontend (L71, builds `frontend/Dockerfile`) | `grep image:/container_name:` |
| `docker-compose.prebuilt.yml` | same 4 containers, images instead of build | file exists, parallel config |

- No nginx container in compose; frontend Dockerfile serves the SPA. **TODO_VERIFY** whether an nginx sidecar is used on the production host (no `nginx.conf` found at repo root or within depth 3 — earlier ALIGNMENT.md references to nginx should be read as "host-level, outside repo").
- Postgres 18 + Redis 7 are the only stateful services; no volumes for connector data yet (Phase 3 `deploy/` work).

## Dockerfiles
- `backend/Dockerfile`, `frontend/Dockerfile` — present. Frontend build currently copies sources (node_modules de-track task T1.6 adds an `npm ci` step).

## Installers — duplication confirmed
- `public/downloads/install.sh` ≡ `scripts/downloads/install.sh` (**diff -q: IDENTICAL**)
- `public/downloads/install.ps1` ≡ `scripts/downloads/install.ps1` (**IDENTICAL**)
- Risk: two copies drift apart silently. Recommendation (Phase 3): keep `public/downloads/` as the served copy, make `scripts/downloads/` a symlink or CI-checked copy. Phase 8 hygiene task already tracks this.

## Start / release scripts
- `start-kali.sh` (repo root), `scripts/release.sh`. No other top-level start scripts found.

## Secrets/config surface (cross-ref → secrets-and-risks.md)
- `backend/app/core/config.py` L18 default `SECRET_KEY = "your-super-secret-key-change-in-production-min-32-chars"` — must be overridden via env in every deployment; compose passes env but has no baked secret (good).

## What's missing vs brief (unchanged from ALIGNMENT §C)
- `deploy/` directory does not exist yet (`ls deploy` empty) — MVP installer set (Wazuh+MISP+DFIR-IRIS per decision #8) lands there in Phase 3.
