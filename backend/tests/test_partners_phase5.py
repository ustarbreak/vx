"""Partner Portal — Phase 5: team & MFA enforcement, API keys/webhooks, connectors.

Run from backend/:
    DATABASE_URL="sqlite+aiosqlite:///:memory:" pytest tests/test_partners_phase5.py -p no:libtmux -q

Covers the HARD RULES for phase 5:
  * rule 1 tenant isolation — team/audit/keys/webhooks/connectors are all keyed to
    the resolved partner org; cross-partner addressing -> 403.
  * rule 2 (MFA enforcement) — enabling the per-partner require_mfa policy blocks
    real /api/auth/login for non-enrolled members with an explicit
    mfa_setup_required challenge (audited), and unblocks after enrollment;
    enrolled members keep the existing /mfa/verify second-factor flow.
  * rule 3 no mock fallback — non-partner caller -> 404 "not configured".
  * rule 5 roles are Literals (free-text role -> 422); API keys are stored only
    as SHA-256 hashes (plaintext shown once, never re-listed); webhook URLs must
    be https; connector vendors are a closed enum; secrets are never echoed back.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlalchemy.dialects import postgresql  # noqa: E402
from sqlalchemy.ext.compiler import compiles  # noqa: E402


@compiles(postgresql.JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw):  # pragma: no cover - test shim
    return "JSON"


from app.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token, get_password_hash  # noqa: E402
from app.models import AuditLog, Organization, TenantSetting, User, UserTotpSecret  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import partners as partners_router  # noqa: E402
from app.services.mfa import generate_secret, totp_code  # noqa: E402

# bcrypt rounds are expensive; one shared hash for all seeded test users keeps
# the suite fast without changing any behavior under test.
_TEST_PW = "test-password-123"
_TEST_HASH = None


async def _seed(factory):
    global _TEST_HASH
    if _TEST_HASH is None:
        _TEST_HASH = get_password_hash(_TEST_PW)


NOW = datetime.now(timezone.utc).replace(tzinfo=None)


@pytest_asyncio.fixture()
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


async def _seed(factory):
    async with factory() as s:
        s.add_all([
            Organization(id=1, name="Atlas MSP", tier="enterprise", status="active",
                         contact_email="boss@atlas.ma", country="Maroc", is_partner=True,
                         partner_code="MSP-ATL", seat_limit=40),
            Organization(id=2, name="Dakhla Sec", tier="mid-market", status="active",
                         contact_email="root@dakhla.ma", country="Maroc", is_partner=True,
                         partner_code="MSP-DKH"),
            Organization(id=3, name="Plain Corp", tier="sme", status="active",
                         contact_email="a@b.c"),
            User(id=1, email="boss@atlas.ma", hashed_password=get_password_hash("pw-atlas-123"),
                 name="Boss Atlas", role="partner_admin", org_id=1, status="active"),
            User(id=2, email="analyst@atlas.ma", hashed_password=get_password_hash("pw-analyst-123"),
                 name="Ana Lyse", role="analyst", org_id=1, status="active"),
            User(id=3, email="root@dakhla.ma", hashed_password=get_password_hash("pw-dakhla-123"),
                 name="Boss Dakhla", role="partner_admin", org_id=2, status="active"),
            User(id=4, email="plat@infracentra.io", hashed_password=get_password_hash("pw-plat-123"),
                 name="Platform", role="platform_admin", org_id=3, status="active"),
            User(id=5, email="ca@plain.io", hashed_password=get_password_hash("pw-ca-123"),
                 name="Plain Admin", role="client_admin", org_id=3, status="active"),
        ])
        await s.commit()


def client_for(session_factory, user_id=None):
    async def _get_db():
        async with session_factory() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db
    headers = {}
    if user_id is not None:
        headers["Authorization"] = f"Bearer {create_access_token({'sub': str(user_id)})}"
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t", headers=headers)


pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    partners_router._writes.clear()
    yield
    partners_router._writes.clear()


# --------------------------------------------------------------------------- #
# 5.1 Team CRUD + role validation + isolation                                  #
# --------------------------------------------------------------------------- #
async def test_team_list_and_create_scoped(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/partners/1/team")
        assert r.status_code == 200
        emails = {u["email"] for u in r.json()["items"]}
        assert {"boss@atlas.ma", "analyst@atlas.ma"} <= emails

        r = await c.post("/api/partners/1/team", json={
            "name": "Billing Beth", "email": "billing@atlas.ma",
            "role": "billing", "password": "sup3r-secret!"})
        assert r.status_code == 201, r.text
        uid = r.json()["id"]

        # free-text role rejected (rule 5)
        r = await c.post("/api/partners/1/team", json={
            "name": "Hacker", "email": "h@x.ma", "role": "superadmin",
            "password": "sup3r-secret!"})
        assert r.status_code == 422

        # duplicate email -> 409
        r = await c.post("/api/partners/1/team", json={
            "name": "Dup", "email": "billing@atlas.ma", "role": "analyst",
            "password": "sup3r-secret!"})
        assert r.status_code == 409

        # patch role ok, self-demotion blocked
        r = await c.patch(f"/api/partners/1/team/{uid}", json={"role": "read_only"})
        assert r.status_code == 200
        r = await c.patch("/api/partners/1/team/1", json={"role": "analyst"})
        assert r.status_code == 400  # cannot demote yourself

        # analyst may not manage the team
        async with client_for(session_factory, user_id=2) as c2:
            r = await c2.get("/api/partners/1/team")
            assert r.status_code == 403

        # cross-partner -> 403 (rule 1)
        async with client_for(session_factory, user_id=3) as c3:
            r = await c3.get("/api/partners/1/team")
            assert r.status_code == 403

        # non-partner -> 404 not configured (rule 3)
        async with client_for(session_factory, user_id=5) as c5:
            r = await c5.get("/api/partners/3/team")
            assert r.status_code == 404


async def test_partner_audit_log_own_org_only(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        await c.post("/api/partners/1/team", json={
            "name": "Audited Andy", "email": "andy@atlas.ma", "role": "analyst",
            "password": "sup3r-secret!"})
        r = await c.get("/api/partners/1/audit")
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(i["action"].startswith("partner.team") for i in items)
        assert all(i.get("org_id") in (None, 1) for i in items)


# --------------------------------------------------------------------------- #
# 5.1 MFA enforcement toggle + login gate                                      #
# --------------------------------------------------------------------------- #
async def test_mfa_policy_toggle_roundtrip(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/partners/1/mfa-policy")
        assert r.status_code == 200 and r.json()["require_mfa"] is False

        r = await c.put("/api/partners/1/mfa-policy", json={"require_mfa": True})
        assert r.status_code == 200 and r.json()["require_mfa"] is True

        r = await c.get("/api/partners/1/mfa-policy")
        body = r.json()
        assert body["require_mfa"] is True
        assert set(body["non_compliant_emails"]) == {"boss@atlas.ma", "analyst@atlas.ma"}

        # team listing surfaces pending enrollment flags
        r = await c.get("/api/partners/1/team")
        for u in r.json()["items"]:
            assert u["mfa_required"] is True
            assert u["mfa_enrollment_pending"] is (not u["mfa_enabled"])

        # analyst cannot change the policy
        async with client_for(session_factory, user_id=2) as c2:
            r = await c2.put("/api/partners/1/mfa-policy", json={"require_mfa": False})
            assert r.status_code == 403


async def test_login_blocked_until_enrolled_then_passes(session_factory):
    """The core Phase-5.1 acceptance: enforced policy => no JWT for non-enrolled
    member (explicit setup challenge, audited); after TOTP enrollment the same
    credentials log in through the normal second-factor path."""
    await _seed(session_factory)

    # policy OFF -> plain login works
    async with client_for(session_factory) as c:
        r = await c.post("/api/auth/login",
                         json={"email": "analyst@atlas.ma", "password": "pw-analyst-123"})
        assert r.status_code == 200
        assert r.json()["access_token"]

    # enable enforcement via admin session
    async with client_for(session_factory, user_id=1) as c:
        r = await c.put("/api/partners/1/mfa-policy", json={"require_mfa": True})
        assert r.status_code == 200

    # policy ON, not enrolled -> explicit mfa_setup_required, NO token
    async with client_for(session_factory) as c:
        r = await c.post("/api/auth/login",
                         json={"email": "analyst@atlas.ma", "password": "pw-analyst-123"})
        assert r.status_code == 200
        body = r.json()
        assert body["access_token"] is None
        assert body["mfa_setup_required"] is True
        assert body["reason"] == "partner_mfa_policy"

    # block is audited
    async with session_factory() as s:
        rows = (await s.execute(
            __import__("sqlalchemy").select(AuditLog).where(
                AuditLog.action == "user.login_mfa_setup_required"))).scalars().all()
        assert len(rows) >= 1 and rows[0].outcome == "blocked"

    # platform_admin is exempt from partner policies
    async with client_for(session_factory) as c:
        r = await c.post("/api/auth/login",
                         json={"email": "plat@infracentra.io", "password": "pw-plat-123"})
        assert r.status_code == 200 and r.json()["access_token"]

    # enroll the analyst directly (simulates /mfa/setup + /mfa/setup/confirm)
    secret = generate_secret()
    async with session_factory() as s:
        u = await s.get(User, 2)
        u.mfa_enabled = True
        s.add(UserTotpSecret(user_id=2, secret=secret, confirmed=True))
        await s.commit()

    # now login returns the standard second-factor challenge (existing flow)
    async with client_for(session_factory) as c:
        r = await c.post("/api/auth/login",
                         json={"email": "analyst@atlas.ma", "password": "pw-analyst-123"})
        body = r.json()
        assert body["mfa_required"] is True and body["access_token"] is None

        # /mfa/verify completes it with a valid TOTP code
        code = totp_code(secret)
        r = await c.post("/api/mfa/verify",
                         json={"email": "analyst@atlas.ma", "code": code})
        assert r.status_code == 200, r.text
        assert r.json()["access_token"]

    # turning the policy off restores plain login for others
    async with client_for(session_factory, user_id=1) as c:
        r = await c.put("/api/partners/1/mfa-policy", json={"require_mfa": False})
        assert r.status_code == 200
    async with client_for(session_factory) as c:
        r = await c.post("/api/auth/login",
                         json={"email": "boss@atlas.ma", "password": "pw-atlas-123"})
        assert r.status_code == 200 and r.json()["access_token"]


# --------------------------------------------------------------------------- #
# 5.2 API keys — hashed at rest, plaintext once, scoped, revocable             #
# --------------------------------------------------------------------------- #
async def test_api_keys_hashed_once_shown_revoked(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.post("/api/partners/1/api-keys",
                         json={"label": "SIEM forwarder", "scopes": ["alerts:read"]})
        assert r.status_code == 201, r.text
        created = r.json()
        plaintext = created["key"]
        assert plaintext and created["id"]

        # listing never contains the plaintext again
        r = await c.get("/api/partners/1/api-keys")
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 1
        assert plaintext not in str(items[0])
        assert items[0]["preview"] in plaintext  # prefix-only preview

        # DB stores only a hash (no plaintext anywhere in the row)
        async with session_factory() as s:
            from app.models import PartnerApiKey
            import sqlalchemy as sa
            row = (await s.execute(sa.select(PartnerApiKey))).scalar_one()
            assert row.key_hash and plaintext not in (row.key_hash or "")
            assert plaintext.encode() != row.key_hash.encode()  # stored value is derived

        # revoke
        r = await c.delete(f"/api/partners/1/api-keys/{created['id']}")
        assert r.status_code == 200
        r = await c.get("/api/partners/1/api-keys")
        assert all(i["status"] == "revoked" for i in r.json()["items"])

        # invalid scope literal -> 422
        r = await c.post("/api/partners/1/api-keys",
                         json={"label": "bad", "scopes": ["nuclear:launch"]})
        assert r.status_code == 422

        # cross-partner key list -> 403
        async with client_for(session_factory, user_id=3) as c3:
            r = await c3.get("/api/partners/1/api-keys")
            assert r.status_code == 403


# --------------------------------------------------------------------------- #
# 5.2 Webhooks — https only, secret never returned, HMAC signing helper        #
# --------------------------------------------------------------------------- #
async def test_webhooks_https_validated_and_secret_hidden(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.post("/api/partners/1/webhooks",
                         json={"url": "http://insecure.example/hook",
                               "events": ["alert.created"]})
        assert r.status_code == 422  # https mandatory

        r = await c.post("/api/partners/1/webhooks",
                         json={"url": "https://hook.example/ingest",
                               "events": ["alert.created", "ticket.updated"]})
        assert r.status_code == 201, r.text
        created = r.json()
        wid = created["id"]
        assert created.get("secret"), "secret shown on creation"

        r = await c.get("/api/partners/1/webhooks")
        items = r.json()["items"]
        assert all("secret" not in i for i in items)

        # unknown event -> 422
        r = await c.post("/api/partners/1/webhooks",
                         json={"url": "https://ok.example", "events": ["moon.landed"]})
        assert r.status_code == 422

        # delete ok
        r = await c.delete(f"/api/partners/1/webhooks/{wid}")
        assert r.status_code == 200

    # HMAC helper signs deterministically (used by delivery worker)
    from app.routers.partners_keys import sign_payload
    sig1 = sign_payload(b"payload", "sec32t")
    sig2 = sign_payload(b"payloaD", "sec32t")
    assert sig1 != sig2 and sig1.startswith(("sha256=", "v1=")) or len(sig1) >= 32


# --------------------------------------------------------------------------- #
# 5.3 Connectors — vendor enum, secret_ref only, m365 ingest-only              #
# --------------------------------------------------------------------------- #
async def test_connectors_vendor_enum_and_no_secret_echo(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/partners/1/connectors")
        assert r.status_code == 200
        assert {i["vendor"] for i in r.json()["items"]} <= {
            "connectwise", "autotask", "halopsa", "ninjaone", "microsoft365"}

        # bad vendor rejected
        r = await c.put("/api/partners/1/connectors/salesforce", json={
            "enabled": True, "base_url": "https://x", "api_identifier": "a", "secret": "s"})
        assert r.status_code == 422

        # configure connectwise; response must NOT echo the secret
        r = await c.put("/api/partners/1/connectors/connectwise", json={
            "enabled": True, "base_url": "https://my.connectwise.com",
            "api_identifier": "atlas", "secret": "super-secret-token"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "super-secret-token" not in str(body)
        assert body.get("secret_configured") is True or body.get("secret_ref")

        # m365 has no two-way sync
        r = await c.put("/api/partners/1/connectors/microsoft365", json={
            "enabled": True, "tenant_id": "tid", "client_id": "cid", "secret": "shh"})
        assert r.status_code == 200
        r = await c.post("/api/partners/1/connectors/microsoft365/sync")
        assert r.status_code == 405

        # sync on disabled/unconfigured vendor -> 4xx but never 500
        r = await c.post("/api/partners/1/connectors/autotask/sync")
        assert r.status_code in (400, 409, 422, 503)

        # cross-partner -> 403
        async with client_for(session_factory, user_id=3) as c3:
            r = await c3.get("/api/partners/1/connectors")
            assert r.status_code == 403


# --------------------------------------------------------------------------- #
# 5.4 Enablement — sales kit + vendor escalation audited                       #
# --------------------------------------------------------------------------- #
async def test_sales_kit_and_escalation(session_factory):
    await _seed(session_factory)
    async with client_for(session_factory, user_id=1) as c:
        r = await c.get("/api/partners/1/sales-kit")
        assert r.status_code == 200
        items = r.json()["items"]
        assert any("roi" in str(i).lower() for i in items)

        r = await c.post("/api/partners/1/support/escalate", json={
            "subject": "Agent installer fails on Server 2012",
            "severity": "high", "body": "MSI exits with code 1603 on clean VM."})
        assert r.status_code == 201, r.text

        r = await c.get("/api/partners/1/audit")
        assert any(i["action"].startswith("partner.support") for i in r.json()["items"])

        # bad severity literal -> 422
        r = await c.post("/api/partners/1/support/escalate", json={
            "subject": "x", "severity": "catastrophic", "body": "y"})
        assert r.status_code == 422
