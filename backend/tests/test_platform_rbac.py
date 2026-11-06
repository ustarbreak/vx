"""PA-02 platform RBAC foundation tests: direct API checks and scoped overrides."""
from __future__ import annotations
import os, sys
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from datetime import datetime, timedelta, timezone
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.compiler import compiles

@compiles(postgresql.JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw):
    return "JSON"

from app.database import Base, get_db
from app.core.security import create_access_token, get_password_hash
from app.core.platform_rbac import has_permission
from app.models import Organization, User, SnmpCredential, AgentToken, AuditLog, UsageEvent
from app.main import app

@pytest_asyncio.fixture()
async def session_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool, future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        db.add_all([
            Organization(id=1, name="Tenant One", tier="sme", status="active", contact_email="one@example.com"),
            Organization(id=2, name="Tenant Two", tier="sme", status="active", contact_email="two@example.com"),
            Organization(id=3, name="Partner One", tier="sme", status="active", contact_email="partner@example.com", is_partner=True),
            User(id=1, email="owner@example.com", hashed_password=get_password_hash("pw"), name="Owner", role="platform_admin", org_id=None),
            User(id=2, email="expert@example.com", hashed_password=get_password_hash("pw"), name="Expert", role="platform_expert", org_id=None),
            User(id=3, email="analyst@example.com", hashed_password=get_password_hash("pw"), name="Analyst", role="platform_analyst", org_id=None),
            User(id=4, email="staff@example.com", hashed_password=get_password_hash("pw"), name="User", role="platform_user", org_id=None),
            User(id=5, email="tenant@example.com", hashed_password=get_password_hash("pw"), name="Tenant Admin", role="client_admin", org_id=1),
            SnmpCredential(id=1, org_id=1, name="Tenant SNMP", version="v3",
                           username="snmp-reader", auth_protocol="SHA", auth_passphrase="auth-secret",
                           priv_protocol="AES", priv_passphrase="priv-secret", port=161),
        ])
        await db.commit()
    yield factory
    await engine.dispose()

def client_for(factory, user_id, version=0):
    async def override_db():
        async with factory() as db:
            yield db
    app.dependency_overrides[get_db] = override_db
    headers={"Authorization": f"Bearer {create_access_token({'sub': str(user_id), 'ver': version})}"}
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers=headers)

@pytest.mark.asyncio
async def test_effective_access_returns_distinct_role_baselines(session_factory):
    async with client_for(session_factory, 2) as c:
        expert=(await c.get("/api/platform/access/me")).json()
        assert expert["role"] == "platform_expert"
        keys={p["key"] for p in expert["permissions"]}
        assert "platform.integrations.read" in keys
        assert "platform.access.manage" not in keys
    async with client_for(session_factory, 3) as c:
        analyst=(await c.get("/api/platform/access/me")).json()
        keys={p["key"] for p in analyst["permissions"]}
        assert "platform.audit.read" in keys
        assert "platform.integrations.configure" not in keys
    async with client_for(session_factory, 4) as c:
        staff=(await c.get("/api/platform/access/me")).json()
        assert {p["key"] for p in staff["permissions"]} == {"platform.dashboard.read"}

@pytest.mark.asyncio
async def test_owner_only_grant_management_and_audit(session_factory):
    async with client_for(session_factory, 2) as c:
        denied=await c.post("/api/platform/access/assignments", json={
            "user_id": 3, "permission_key": "platform.billing.read"
        })
        assert denied.status_code == 403
    async with client_for(session_factory, 1) as c:
        created=await c.post("/api/platform/access/assignments", json={
            "user_id": 3, "permission_key": "platform.billing.read",
            "effect": "allow", "scope_type": "tenant", "scope_id": 1
        })
        assert created.status_code == 201, created.text
        assignment=created.json()
        listed=await c.get("/api/platform/access/assignments?user_id=3")
        assert listed.status_code == 200
        assert any(x["id"] == assignment["id"] for x in listed.json())
        revoked=await c.delete(f"/api/platform/access/assignments/{assignment['id']}")
        assert revoked.status_code == 204

@pytest.mark.asyncio
async def test_scoped_grants_and_deny_precedence(session_factory):
    from app.models import PlatformPermissionAssignment
    async with session_factory() as db:
        analyst=await db.get(User, 3)
        db.add(PlatformPermissionAssignment(user_id=3, permission_key="platform.billing.read",
            effect="allow", scope_type="tenant", scope_id=1, granted_by=1))
        await db.commit()
        assert await has_permission(analyst, "platform.billing.read", db, org_id=1) is True
        assert await has_permission(analyst, "platform.billing.read", db, org_id=2) is False
        db.add(PlatformPermissionAssignment(user_id=3, permission_key="platform.billing.read",
            effect="deny", scope_type="tenant", scope_id=1, granted_by=1))
        await db.commit()
        assert await has_permission(analyst, "platform.billing.read", db, org_id=1) is False

@pytest.mark.asyncio
async def test_non_platform_user_cannot_read_platform_access(session_factory):
    async with client_for(session_factory, 5) as c:
        response=await c.get("/api/platform/access/me")
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_permission_change_revokes_existing_bearer_token(session_factory):
    from app.models import PlatformPermissionAssignment
    old_token=create_access_token({"sub": "3", "ver": 0})
    async with client_for(session_factory, 1) as owner:
        response=await owner.post("/api/platform/access/assignments", json={
            "user_id": 3, "permission_key": "platform.billing.read",
            "effect": "allow", "scope_type": "global"
        })
        assert response.status_code == 201, response.text
    async def override_db():
        async with session_factory() as db:
            yield db
    app.dependency_overrides[get_db]=override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
        headers={"Authorization": f"Bearer {old_token}"}) as analyst:
        response=await analyst.get("/api/platform/access/me")
        assert response.status_code == 401

@pytest.mark.asyncio
async def test_only_owner_platform_access_api_can_create_platform_staff(session_factory):
    async with client_for(session_factory, 2) as expert:
        denied = await expert.post("/api/platform/access/users", json={
            "email": "bad-expert@example.com", "name": "Bad Expert",
            "password": "long-enough-password", "role": "platform_expert"
        })
        assert denied.status_code == 403
        generic = await expert.post("/api/users/", json={
            "email": "bad-generic@example.com", "name": "Bad Generic",
            "password": "long-enough-password", "role": "platform_user", "org_id": None
        })
        assert generic.status_code == 403

    async with client_for(session_factory, 1) as owner:
        invalid = await owner.post("/api/users/", json={
            "email": "second-owner@example.com", "name": "Second Owner",
            "password": "long-enough-password", "role": "platform_admin", "org_id": None
        })
        assert invalid.status_code == 403
        valid = await owner.post("/api/platform/access/users", json={
            "email": "new-expert@example.com", "name": "New Expert",
            "password": "long-enough-password", "role": "platform_expert"
        })
        assert valid.status_code == 201, valid.text
        assert valid.json()["role"] == "platform_expert"


@pytest.mark.asyncio
async def test_global_audit_read_is_granted_to_analyst_but_not_tenant_admin(session_factory):
    async with client_for(session_factory, 3) as analyst:
        response=await analyst.get("/api/audit/logs")
        assert response.status_code == 200, response.text
    async with client_for(session_factory, 5) as tenant:
        response=await tenant.get("/api/audit/logs")
        assert response.status_code == 403

@pytest.mark.asyncio
async def test_integration_read_and_write_are_separate_capabilities(session_factory):
    async with client_for(session_factory, 2) as expert:
        read=await expert.get("/api/integrations/")
        assert read.status_code == 200, read.text
        write=await expert.post("/api/integrations/", json={
            "name": "Denied integration", "service_id": "test",
            "integration_type": "api", "status": "inactive",
            "license_type": "open-source", "pricing": "free"
        })
        assert write.status_code == 403
    async with client_for(session_factory, 3) as analyst:
        read=await analyst.get("/api/integrations/")
        assert read.status_code == 403

@pytest.mark.asyncio
async def test_platform_system_settings_are_owner_only_and_persist(session_factory):
    async with client_for(session_factory, 2) as expert:
        response=await expert.get("/api/settings/system")
        assert response.status_code == 403
    async with client_for(session_factory, 1) as owner:
        before=await owner.get("/api/settings/system")
        assert before.status_code == 200
        saved=await owner.put("/api/settings/system", json={"auto_ticketing": False})
        assert saved.status_code == 200, saved.text
        assert saved.json()["auto_ticketing"] is False
        again=await owner.get("/api/settings/system")
        assert again.status_code == 200
        assert again.json()["auto_ticketing"] is False


@pytest.mark.asyncio
async def test_owner_can_change_platform_staff_role_and_revoke_session(session_factory):
    old_token=create_access_token({"sub": "2", "ver": 0})
    async with client_for(session_factory, 1) as owner:
        response=await owner.patch("/api/platform/access/users/2/role", json={"role": "platform_analyst"})
        assert response.status_code == 200, response.text
        assert response.json()["role"] == "platform_analyst"
        forbidden=await owner.patch("/api/platform/access/users/1/role", json={"role": "platform_user"})
        assert forbidden.status_code == 404
    async def override_db():
        async with session_factory() as db:
            yield db
    app.dependency_overrides[get_db]=override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
        headers={"Authorization": f"Bearer {old_token}"}) as old_expert:
        response=await old_expert.get("/api/platform/access/me")
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_scoped_tenant_read_defaults_and_owner_granted_write_scope(session_factory):
    async with client_for(session_factory, 2) as expert:
        read=await expert.get("/api/admin/tenants/1/summary")
        assert read.status_code == 200, read.text
    async with client_for(session_factory, 5) as tenant_admin:
        read=await tenant_admin.get("/api/admin/tenants/1/summary")
        assert read.status_code == 403
    async with client_for(session_factory, 1) as owner:
        grant=await owner.post("/api/platform/access/assignments", json={
            "user_id": 4, "permission_key": "platform.tenants.manage",
            "effect": "allow", "scope_type": "tenant", "scope_id": 1
        })
        assert grant.status_code == 201, grant.text
    token=create_access_token({"sub": "4", "ver": 1})
    async def override_db():
        async with session_factory() as db:
            yield db
    app.dependency_overrides[get_db]=override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test",
        headers={"Authorization": f"Bearer {token}"}) as staff:
        allowed=await staff.post("/api/admin/tenants/1/tickets", json={"title": "Scoped permission test"})
        assert allowed.status_code == 201, allowed.text
        denied=await staff.post("/api/admin/tenants/2/tickets", json={"title": "Must be denied"})
        assert denied.status_code == 403


@pytest.mark.asyncio
async def test_public_registration_cannot_create_privileged_platform_roles(session_factory):
    async def override_db():
        async with session_factory() as db:
            yield db
    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as public:
        for role in ("platform_admin", "platform_expert", "platform_analyst", "platform_user", "client_admin"):
            response = await public.post("/api/auth/register", json={
                "email": f"{role}@registration.example",
                "name": "Untrusted Registration",
                "password": "long-enough-password",
                "role": role,
                "org_id": 1,
            })
            assert response.status_code == 403, (role, response.text)


@pytest.mark.asyncio
async def test_channel_permissions_are_tenant_scoped_and_writes_are_audited(session_factory):
    from app.models import AuditLog

    async with client_for(session_factory, 5) as tenant_admin:
        own = await tenant_admin.get("/api/channels/configs?org_id=1")
        cross = await tenant_admin.get("/api/channels/configs?org_id=2")
        assert own.status_code == 200, own.text
        assert cross.status_code == 403

    async with client_for(session_factory, 2) as expert:
        denied = await expert.get("/api/channels/configs?org_id=1")
        assert denied.status_code == 403

    async with client_for(session_factory, 1) as owner:
        grant = await owner.post("/api/platform/access/assignments", json={
            "user_id": 2, "permission_key": "platform.channels.manage",
            "effect": "allow", "scope_type": "tenant", "scope_id": 1
        })
        assert grant.status_code == 201, grant.text

    async with client_for(session_factory, 2, version=1) as expert:
        allowed = await expert.put("/api/channels/configs", json={
            "channel": "webhook", "enabled": True,
            "config": {"url": "https://hooks.example.test/tenant-one"},
            "org_id": 1
        })
        assert allowed.status_code == 200, allowed.text
        cross_write = await expert.put("/api/channels/configs", json={
            "channel": "webhook", "enabled": True,
            "config": {"url": "https://hooks.example.test/tenant-two"},
            "org_id": 2
        })
        assert cross_write.status_code == 403

    async with session_factory() as db:
        audit = (await db.execute(
            __import__("sqlalchemy").select(AuditLog).where(
                AuditLog.action == "notification_channel.config_updated"
            )
        )).scalars().first()
        assert audit is not None
        assert audit.org_id == 1


@pytest.mark.asyncio
async def test_platform_user_directory_is_not_leaked_without_users_read(session_factory):
    async with client_for(session_factory, 4) as platform_user:
        listing = await platform_user.get("/api/users/")
        self_record = await platform_user.get("/api/users/4")
        assert listing.status_code == 403
        assert self_record.status_code == 200

    async with client_for(session_factory, 3) as analyst:
        listing = await analyst.get("/api/users/")
        assert listing.status_code == 403

    async with client_for(session_factory, 1) as owner:
        grant = await owner.post("/api/platform/access/assignments", json={
            "user_id": 3, "permission_key": "platform.users.read",
            "effect": "allow", "scope_type": "global"
        })
        assert grant.status_code == 201, grant.text

    async with client_for(session_factory, 3, version=1) as analyst:
        listing = await analyst.get("/api/users/")
        assert listing.status_code == 200, listing.text
        assert all(row["role"].startswith("platform_") for row in listing.json())
        missing = await analyst.get("/api/users/99999")
        assert missing.status_code == 404


@pytest.mark.asyncio
async def test_platform_alert_and_notification_reads_require_owner_granted_scope(session_factory):
    async with client_for(session_factory, 2) as expert:
        no_scope = await expert.get("/api/alerts")
        assert no_scope.status_code == 403
        no_notification_scope = await expert.get("/api/notifications")
        assert no_notification_scope.status_code == 403

    async with client_for(session_factory, 1) as owner:
        alert_grant = await owner.post("/api/platform/access/assignments", json={
            "user_id": 2, "permission_key": "platform.alerts.read",
            "effect": "allow", "scope_type": "tenant", "scope_id": 1
        })
        notification_grant = await owner.post("/api/platform/access/assignments", json={
            "user_id": 2, "permission_key": "platform.notifications.read",
            "effect": "allow", "scope_type": "tenant", "scope_id": 1
        })
        assert alert_grant.status_code == 201, alert_grant.text
        assert notification_grant.status_code == 201, notification_grant.text

    async with client_for(session_factory, 2, version=2) as expert:
        alert_allowed = await expert.get("/api/alerts?org_id=1")
        alert_cross = await expert.get("/api/alerts?org_id=2")
        notification_allowed = await expert.get("/api/notifications?org_id=1")
        notification_cross = await expert.get("/api/notifications?org_id=2")
        assert alert_allowed.status_code == 200, alert_allowed.text
        assert alert_cross.status_code == 403
        assert notification_allowed.status_code == 200, notification_allowed.text
        assert notification_cross.status_code == 403


@pytest.mark.asyncio
async def test_security_ops_requests_require_owner_granted_tenant_scope(session_factory):
    async with client_for(session_factory, 2) as expert:
        denied = await expert.post("/api/security-ops/actions", json={
            "service": "endpoint-protection", "action_id": "ep-isolate", "org_id": 1
        })
        assert denied.status_code == 403

    async with client_for(session_factory, 1) as owner:
        request_grant = await owner.post("/api/platform/access/assignments", json={
            "user_id": 2, "permission_key": "platform.security_ops.request",
            "effect": "allow", "scope_type": "tenant", "scope_id": 1
        })
        read_grant = await owner.post("/api/platform/access/assignments", json={
            "user_id": 2, "permission_key": "platform.security_ops.read",
            "effect": "allow", "scope_type": "tenant", "scope_id": 1
        })
        assert request_grant.status_code == 201, request_grant.text
        assert read_grant.status_code == 201, read_grant.text

    async with client_for(session_factory, 2, version=2) as expert:
        allowed = await expert.post("/api/security-ops/actions", json={
            "service": "endpoint-protection", "action_id": "ep-isolate",
            "org_id": 1, "params": {"label": "Test isolation request"}
        })
        denied_cross = await expert.post("/api/security-ops/actions", json={
            "service": "endpoint-protection", "action_id": "ep-isolate", "org_id": 2
        })
        history = await expert.get("/api/security-ops/tasks?org_id=1")
        assert allowed.status_code == 200, allowed.text
        assert allowed.json()["task"]["status"] == "manual"
        assert denied_cross.status_code == 403
        assert history.status_code == 200, history.text


@pytest.mark.asyncio
async def test_infrastructure_credentials_require_scoped_permission_and_mask_secrets(session_factory):
    async with client_for(session_factory, 2) as expert:
        denied = await expert.get("/api/discovery/snmp-credentials?org_id=1")
        assert denied.status_code == 403

    async with client_for(session_factory, 1) as owner:
        grant = await owner.post("/api/platform/access/assignments", json={
            "user_id": 2, "permission_key": "platform.infrastructure.credentials.read",
            "effect": "allow", "scope_type": "tenant", "scope_id": 1
        })
        assert grant.status_code == 201, grant.text

    async with client_for(session_factory, 2, version=1) as expert:
        response = await expert.get("/api/discovery/snmp-credentials?org_id=1")
        assert response.status_code == 200, response.text
        credential = response.json()[0]
        assert credential["community"] is None
        assert credential["auth_passphrase"] == "********"
        assert credential["priv_passphrase"] == "********"


@pytest.mark.asyncio
async def test_permission_expiry_handles_naive_and_aware_datetimes(session_factory):
    from app.models import PlatformPermissionAssignment

    async with session_factory() as db:
        analyst = await db.get(User, 3)
        db.add(PlatformPermissionAssignment(
            user_id=3, permission_key="platform.billing.read", effect="allow",
            scope_type="global", granted_by=1,
            expires_at=datetime.utcnow() - timedelta(minutes=1),
        ))
        await db.commit()
        assert await has_permission(analyst, "platform.billing.read", db) is False

    async with client_for(session_factory, 1) as owner:
        past = await owner.post("/api/platform/access/assignments", json={
            "user_id": 3, "permission_key": "platform.billing.read",
            "effect": "allow", "scope_type": "global",
            "expires_at": (datetime.now() - timedelta(minutes=1)).isoformat()
        })
        future = await owner.post("/api/platform/access/assignments", json={
            "user_id": 3, "permission_key": "platform.billing.read",
            "effect": "allow", "scope_type": "global",
            "expires_at": (datetime.now() + timedelta(hours=1)).isoformat()
        })
        assert past.status_code == 422
        assert future.status_code == 201, future.text


@pytest.mark.asyncio
async def test_effective_access_response_applies_deny_precedence_and_shows_scopes(session_factory):
    async with client_for(session_factory, 1) as owner:
        allow = await owner.post("/api/platform/access/assignments", json={
            "user_id": 3, "permission_key": "platform.billing.read",
            "effect": "allow", "scope_type": "global"
        })
        deny = await owner.post("/api/platform/access/assignments", json={
            "user_id": 3, "permission_key": "platform.billing.read",
            "effect": "deny", "scope_type": "global"
        })
        assert allow.status_code == 201, allow.text
        assert deny.status_code == 201, deny.text

    async with client_for(session_factory, 3, version=2) as analyst:
        response = await analyst.get("/api/platform/access/me")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert "platform.billing.read" not in {p["key"] for p in payload["permissions"]}
        assert len([a for a in payload["assignments"] if a["permission_key"] == "platform.billing.read"]) == 2


@pytest.mark.asyncio
async def test_partner_operations_writes_require_partner_scoped_manage_grant(session_factory):
    async with client_for(session_factory, 2) as expert:
        denied = await expert.post("/api/partners/3/handovers", json={
            "content": "Shift handover without permission", "shift": "morning"
        })
        assert denied.status_code == 403

    async with client_for(session_factory, 1) as owner:
        grant = await owner.post("/api/platform/access/assignments", json={
            "user_id": 2, "permission_key": "platform.partners.manage",
            "effect": "allow", "scope_type": "partner", "scope_id": 3
        })
        assert grant.status_code == 201, grant.text

    async with client_for(session_factory, 2, version=1) as expert:
        allowed = await expert.post("/api/partners/3/handovers", json={
            "content": "Authorized scoped shift handover", "shift": "morning"
        })
        cross_partner = await expert.post("/api/partners/2/handovers", json={
            "content": "Must not cross partner scope", "shift": "morning"
        })
        assert allowed.status_code == 201, allowed.text
        assert cross_partner.status_code == 404


@pytest.mark.asyncio
async def test_entitlement_graph_and_chain_honor_tenant_scoped_billing_read(session_factory):
    async with client_for(session_factory, 2) as expert:
        denied = await expert.get("/api/entitlements/graph?org_id=1")
        assert denied.status_code == 403

    async with client_for(session_factory, 1) as owner:
        grant = await owner.post("/api/platform/access/assignments", json={
            "user_id": 2, "permission_key": "platform.billing.read",
            "effect": "allow", "scope_type": "tenant", "scope_id": 1
        })
        assert grant.status_code == 201, grant.text

    async with client_for(session_factory, 2, version=1) as expert:
        graph = await expert.get("/api/entitlements/graph?org_id=1")
        chain = await expert.get("/api/entitlements/chain/siem?org_id=1")
        cross_graph = await expert.get("/api/entitlements/graph?org_id=2")
        cross_chain = await expert.get("/api/entitlements/chain/siem?org_id=2")
        assert graph.status_code == 200, graph.text
        assert chain.status_code == 200, chain.text
        assert cross_graph.status_code == 403
        assert cross_chain.status_code == 403


@pytest.mark.asyncio
async def test_platform_dashboard_is_live_and_permission_gated(session_factory):
    async with client_for(session_factory, 1) as owner:
        response = await owner.get("/api/platform/dashboard/overview")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["data_mode"] == "live"
        assert payload["scope"] == "global_platform"
        assert payload["counts"]["organizations"] == 3
        assert payload["counts"]["partners"] == 1
        assert payload["counts"]["platform_staff"] == 4
        assert "revenue" in payload["limitations"]
    async with client_for(session_factory, 5) as tenant_admin:
        denied = await tenant_admin.get("/api/platform/dashboard/overview")
        assert denied.status_code == 403


@pytest.mark.asyncio
async def test_owner_can_suspend_staff_and_revoke_existing_sessions(session_factory):
    async with client_for(session_factory, 1) as owner:
        response = await owner.patch("/api/platform/access/users/2/status", json={"status": "inactive"})
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "inactive"
        assert response.json()["auth_version"] == 1
        self_suspend = await owner.patch("/api/platform/access/users/1/status", json={"status": "inactive"})
        assert self_suspend.status_code == 404 or self_suspend.status_code == 403

    async with client_for(session_factory, 2, version=0) as stale_staff:
        response = await stale_staff.get("/api/platform/access/me")
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_non_owner_cannot_manage_platform_staff_status(session_factory):
    async with client_for(session_factory, 5) as tenant:
        denied = await tenant.patch("/api/platform/access/users/2/status", json={"status": "inactive"})
        assert denied.status_code == 403
    async with client_for(session_factory, 2) as expert:
        denied = await expert.patch("/api/platform/access/users/3/status", json={"status": "inactive"})
        assert denied.status_code == 403


@pytest.mark.asyncio
async def test_tenant_detail_subresources_return_persisted_scoped_data_only(session_factory):
    async with session_factory() as db:
        db.add(AgentToken(
            org_id=1, name="Tenant collector", token_hash="a" * 64,
            prefix="icag_safe", created_by="owner@example.com",
        ))
        db.add(AuditLog(
            actor_id=1, actor_name="Owner", actor_role="platform_admin", org_id=1,
            action="tenant.test_event", resource="Tenant", resource_id="1",
            details="Persisted test audit event", outcome="success",
        ))
        await db.commit()

    async with client_for(session_factory, 1) as owner:
        members = await owner.get("/api/admin/tenants/1/members")
        devices = await owner.get("/api/admin/tenants/1/devices")
        keys = await owner.get("/api/admin/tenants/1/api-keys")
        activity = await owner.get("/api/admin/tenants/1/activity")
        assert members.status_code == devices.status_code == keys.status_code == activity.status_code == 200
        assert any(row["email"] == "tenant@example.com" for row in members.json())
        assert devices.json() == []
        assert keys.json()[0]["prefix"] == "icag_safe"
        assert "token_hash" not in keys.json()[0] and "token" not in keys.json()[0]
        assert activity.json()[0]["details"] == "Persisted test audit event"

    async with client_for(session_factory, 5) as tenant_admin:
        denied = await tenant_admin.get("/api/admin/tenants/2/members")
        assert denied.status_code == 403


@pytest.mark.asyncio
async def test_tenant_detail_subresources_honor_explicit_tenant_deny(session_factory):
    async with client_for(session_factory, 1) as owner:
        deny = await owner.post("/api/platform/access/assignments", json={
            "user_id": 2, "permission_key": "platform.tenants.read",
            "effect": "deny", "scope_type": "tenant", "scope_id": 2,
        })
        assert deny.status_code == 201, deny.text
    async with client_for(session_factory, 2, version=1) as expert:
        allowed = await expert.get("/api/admin/tenants/1/members")
        denied = await expert.get("/api/admin/tenants/2/members")
        assert allowed.status_code == 200
        assert denied.status_code == 403


@pytest.mark.asyncio
async def test_platform_billing_overview_uses_only_persisted_usage_and_is_owner_gated(session_factory):
    async with session_factory() as db:
        db.add(UsageEvent(
            org_id=1, metric="siem_gb", quantity=5, unit="GB",
            source="test-meter", idempotency_key="billing-test-event",
            occurred_at=datetime(2026, 11, 6, tzinfo=timezone.utc),
        ))
        await db.commit()

    async with client_for(session_factory, 1) as owner:
        response = await owner.get("/api/platform/billing/overview?period=2026-11")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["data_mode"] == "live"
        assert payload["counts"]["organizations"] == 3
        assert payload["counts"]["partners"] == 1
        assert payload["counts"]["tenants_with_usage"] == 1
        tenant = next(row for row in payload["tenants"] if row["id"] == 1)
        assert tenant["usage"]["siem_gb"]["quantity"] == 5.0
        assert tenant["usage_event_count"] == 1
        assert "no invoice ledger" in payload["commercial_integrity"]["invoices"]

    async with client_for(session_factory, 5) as tenant_admin:
        denied = await tenant_admin.get("/api/platform/billing/overview?period=2026-11")
        assert denied.status_code == 403


@pytest.mark.asyncio
async def test_platform_ticket_overview_is_global_owner_only(session_factory):
    async with client_for(session_factory, 1) as owner:
        response = await owner.get("/api/tickets/ops/overview")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["data_mode"] == "live"
        assert set(payload["counts"]) >= {"total", "open", "p1_p2", "sla_breached", "unassigned"}
        assert isinstance(payload["by_organization"], list)
        assert isinstance(payload["workload"], list)

    async with client_for(session_factory, 5) as tenant_admin:
        denied = await tenant_admin.get("/api/tickets/ops/overview")
        assert denied.status_code == 403
