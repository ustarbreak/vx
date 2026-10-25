-- =====================================================================
-- Infracentra — Demo accounts & demo tenant (safe to run multiple times)
-- Passwords are bcrypt hashes of SHA-256 pre-hashed passwords, matching
-- backend/app/core/security.py (_prehash + passlib bcrypt rounds=12).
--
--   admin@infracentra.io   / Admin#2026     -> platform_admin
--   sarah.chen@aegiscorp.io / Client#2026   -> client_admin  (Aegis Corp)
--   marcus.j@aegiscorp.io  / Client#2026    -> client_user   (Aegis Corp)
--   jordan@techstart.io    / Client#2026    -> client_admin  (TechStart SME)
--
-- Run in pgAdmin Query Tool (connected to database "infracentra")
-- or from the terminal:
--   sudo docker exec -i infracentra-db psql -U infracentra -d infracentra < demo_accounts.sql
-- =====================================================================

BEGIN;

-- 1) Platform admin -----------------------------------------------------
INSERT INTO users (email, hashed_password, name, role, org_id, status, mfa_enabled, created_at)
VALUES ('admin@infracentra.io',
        '$2b$12$K9dBOOs/hEEY8jAShpeRdeH12HfMuqRq0PWsjZaNw7xXUcLiEynaK',
        'Platform Administrator', 'platform_admin', NULL, 'active', FALSE, NOW())
ON CONFLICT (email) DO UPDATE
SET hashed_password = EXCLUDED.hashed_password,
    role            = 'platform_admin',
    status          = 'active';

-- 2) Demo tenants (organizations) --------------------------------------
INSERT INTO organizations (name, tier, status, contact_email, member_count, created_at)
VALUES ('Aegis Corp', 'enterprise', 'active', 'sarah.chen@aegiscorp.io', 2, NOW())
ON CONFLICT (name) DO NOTHING;

INSERT INTO organizations (name, tier, status, contact_email, member_count, created_at)
VALUES ('TechStart', 'sme', 'active', 'jordan@techstart.io', 1, NOW())
ON CONFLICT (name) DO NOTHING;

-- 3) Sarah Chen — full-access client admin on Aegis Corp ----------------
INSERT INTO users (email, hashed_password, name, role, org_id, status, mfa_enabled, created_at)
SELECT 'sarah.chen@aegiscorp.io',
       '$2b$12$spBIUJvm/OjCTZLuuEe.0.6jWQSSI4Rg9hxFQth0/3wjPX6.pu2A2',
       'Sarah Chen', 'client_admin', id, 'active', FALSE, NOW()
FROM organizations WHERE name = 'Aegis Corp'
ON CONFLICT (email) DO UPDATE
SET hashed_password = EXCLUDED.hashed_password,
    role            = 'client_admin',
    org_id          = (SELECT id FROM organizations WHERE name = 'Aegis Corp'),
    status          = 'active';

-- 4) Marcus J — regular client user on Aegis Corp ------------------------
INSERT INTO users (email, hashed_password, name, role, org_id, status, mfa_enabled, created_at)
SELECT 'marcus.j@aegiscorp.io',
       '$2b$12$spBIUJvm/OjCTZLuuEe.0.6jWQSSI4Rg9hxFQth0/3wjPX6.pu2A2',
       'Marcus Johnson', 'client_user', id, 'active', FALSE, NOW()
FROM organizations WHERE name = 'Aegis Corp'
ON CONFLICT (email) DO UPDATE
SET hashed_password = EXCLUDED.hashed_password,
    role            = 'client_user',
    org_id          = (SELECT id FROM organizations WHERE name = 'Aegis Corp'),
    status          = 'active';

-- 5) Jordan — client admin on TechStart ----------------------------------
INSERT INTO users (email, hashed_password, name, role, org_id, status, mfa_enabled, created_at)
SELECT 'jordan@techstart.io',
       '$2b$12$spBIUJvm/OjCTZLuuEe.0.6jWQSSI4Rg9hxFQth0/3wjPX6.pu2A2',
       'Jordan Reyes', 'client_admin', id, 'active', FALSE, NOW()
FROM organizations WHERE name = 'TechStart'
ON CONFLICT (email) DO UPDATE
SET hashed_password = EXCLUDED.hashed_password,
    role            = 'client_admin',
    org_id          = (SELECT id FROM organizations WHERE name = 'TechStart'),
    status          = 'active';

-- 6) Auto-ticketing rules for Aegis Corp (if none exist yet) -------------
INSERT INTO notification_rules
    (org_id, name, enabled, conditions, channels, recipients,
     create_ticket, ticket_priority, escalate_after_minutes, created_at)
SELECT o.id, 'Aegis Corp: Critical alerts -> P1 auto-ticket + page SOC', TRUE,
       '{"severity": ["critical"]}'::json, '["in_app", "email"]'::json,
       '["sarah.chen@aegiscorp.io", "soc-team@infracentra.io"]'::json,
       TRUE, 'p1', 30, NOW()
FROM organizations o WHERE o.name = 'Aegis Corp'
AND NOT EXISTS (SELECT 1 FROM notification_rules r WHERE r.org_id = o.id);

INSERT INTO notification_rules
    (org_id, name, enabled, conditions, channels, recipients,
     create_ticket, ticket_priority, escalate_after_minutes, created_at)
SELECT o.id, 'Aegis Corp: High alerts -> P2 auto-ticket', TRUE,
       '{"severity": ["high"]}'::json, '["in_app"]'::json,
       '["sarah.chen@aegiscorp.io"]'::json,
       TRUE, 'p2', NULL, NOW()
FROM organizations o WHERE o.name = 'Aegis Corp'
AND NOT EXISTS (SELECT 1 FROM notification_rules r WHERE r.org_id = o.id AND r.name LIKE '%High%');

COMMIT;

-- Verification -----------------------------------------------------------
SELECT u.email, u.role, u.status, o.name AS tenant
FROM users u LEFT JOIN organizations o ON o.id = u.org_id
ORDER BY u.role, u.email;
