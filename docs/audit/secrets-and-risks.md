# Secrets & Risks (T0.7)

Method: targeted grep over the repo (gitleaks/trufflehog are **not installed in this sandbox** — TODO_VERIFY: run `gitleaks detect` in CI once T1.5 lands; the workflow will include it). All findings below were confirmed by opening the cited files.

## 1. TLS verification disabled (4 sites) — owner decision #5: fix behind flag, keep lenient default first
| Site | Evidence |
|---|---|
| `backend/app/services/wazuh.py:21` | `httpx.AsyncClient(timeout=30.0, verify=False)` |
| `backend/app/services/connectors.py:155` | `httpx.AsyncClient(timeout=timeout, verify=False)` (probe_connector) |
| `backend/app/services/connectors.py:187` | `httpx.AsyncClient(timeout=8.0, verify=False)` (fetch_live_records) |
| `agent-go/internal/transport/client.go:29` | `tls.Config{InsecureSkipVerify: true}` — unconditional; the `insecure bool` param of `New()` (L26) is not honored here |
- Planned remediation (ADAPTED-PLAN T2.5): env flag `CONNECTOR_TLS_VERIFY` (default `false` = today's behavior), flip to `true` after installers ship with proper certs. Go side: honor existing `insecure` param and default to verify.
- Note: `backend/app/core/config.py:56` already carries a comment documenting this state and decision #5.

## 2. Default secrets / weak defaults
| Item | Location | Risk | Action |
|---|---|---|---|
| `SECRET_KEY` default `"your-super-secret-key-change-in-production-min-32-chars"` | `core/config.py:18` | Forgeable JWTs if deployed unmodified | Fail-fast startup check when env unset in non-dev (Phase 2, small) |
| Platform admin password fallback `os.getenv("PLATFORM_ADMIN_PASSWORD", "Admin#2026")` | `seed.py` (~L256 region) | Known default credential seeded on first boot | Same fail-fast pattern; document override in deploy guide |
| CORS_ORIGINS localhost-only list | `core/config.py:23` | Not a leak, but production origins must be set via env | Deploy-guide item |
- No hardcoded API keys found beyond the above (`transports.py:42` reads SMTP password from config/env — clean; `seed.py` hashes passwords properly).

## 3. Repo hygiene
- **node_modules tracked in git: 16,328 files** (`git ls-files | grep -c node_modules`). De-track scheduled as T1.6 with feature work (owner decision #9).
- Duplicate installers `public/downloads` ≡ `scripts/downloads` (verified IDENTICAL) — drift risk, see infra.md.

## 4. org_id coverage (tenant isolation)
- `org_id` appears 46× in `backend/app/models.py`; all five native engines scope by org (see native-engines.md). Confirmed as canonical tenant key per owner decision #3 ("tenant" UI = client-admin pages; org id = client id). Catalog/YAMLs use `org_id`, never `tenant_id`.
- TODO_VERIFY: exhaustive per-table audit that every query filters by org_id (route handler review — Phase 2 task, not completed this session).

## 5. Residual risks carried into plan
1. Silent demoWorld fallback on 21 mock-only pages (services-reconciled.md) → adapter swaps must be per-page with visible data-source badge.
2. Legacy `/api/playbooks` response shape consumed by `soarApi.ts` — byte-compatible until Phase 4 regression tests exist.
3. Postgres 18 / Redis 7 pinned in compose; connector containers (Wazuh/MISP/IRIS) version pins are TODO_VERIFY until first run on target host (decision #7 preflight defaults).
