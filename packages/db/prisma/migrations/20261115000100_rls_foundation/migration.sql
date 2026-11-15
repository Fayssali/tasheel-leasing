-- Row-Level Security for M0 Foundation (decision D1, docs/adr/0002-multi-tenancy.md).
-- Hand-written: Prisma does not generate RLS. Every future tenant-owned table needs
-- the same treatment plus a case in packages/db/test/tenant-isolation.test.ts.

-- ---------------------------------------------------------------------------
-- Context helpers. The API sets app.org_id / app.user_id per transaction
-- (see packages/db/src/tenant-context.ts). Empty or missing → NULL.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- True when the active organization is the Tasheel platform organization.
-- SECURITY DEFINER so it can read organizations without recursing into its own policy.
CREATE FUNCTION app_is_platform() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (
    SELECT 1 FROM organizations WHERE id = app_current_org() AND type = 'PLATFORM'
  ) $$;

-- Organizations the current user is an active member of (for the organization switcher).
CREATE FUNCTION app_user_org_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT organization_id FROM organization_members
        WHERE user_id = app_current_user() AND status = 'ACTIVE' AND deleted_at IS NULL $$;

REVOKE ALL ON FUNCTION app_is_platform() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_user_org_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_org(), app_current_user(), app_is_platform(), app_user_org_ids() TO tasheel_app;

-- System roles have organization_id NULL, which a normal unique index ignores.
CREATE UNIQUE INDEX "roles_system_code_key" ON "roles"("code") WHERE "organization_id" IS NULL;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizations_select ON organizations FOR SELECT
  USING (id = app_current_org() OR app_is_platform() OR id IN (SELECT app_user_org_ids()));

-- Registration: the API generates the new id and sets it as app.org_id before inserting.
CREATE POLICY organizations_insert ON organizations FOR INSERT
  WITH CHECK (id = app_current_org() OR app_is_platform());

CREATE POLICY organizations_update ON organizations FOR UPDATE
  USING (id = app_current_org() OR app_is_platform())
  WITH CHECK (id = app_current_org() OR app_is_platform());

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY members_select ON organization_members FOR SELECT
  USING (organization_id = app_current_org() OR user_id = app_current_user() OR app_is_platform());

CREATE POLICY members_write ON organization_members FOR ALL
  USING (organization_id = app_current_org() OR app_is_platform())
  WITH CHECK (organization_id = app_current_org() OR app_is_platform());

-- ---------------------------------------------------------------------------
-- roles, role_permissions, member_roles
-- System roles (organization_id NULL) are readable by everyone, writable by no tenant.
-- ---------------------------------------------------------------------------
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY roles_select ON roles FOR SELECT
  USING (organization_id IS NULL OR organization_id = app_current_org() OR app_is_platform());

CREATE POLICY roles_write ON roles FOR ALL
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org() AND is_system = false);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_permissions_select ON role_permissions FOR SELECT
  USING (organization_id IS NULL OR organization_id = app_current_org() OR app_is_platform());

CREATE POLICY role_permissions_write ON role_permissions FOR ALL
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE member_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY member_roles_select ON member_roles FOR SELECT
  USING (organization_id = app_current_org() OR organization_id IN (SELECT app_user_org_ids()) OR app_is_platform());

CREATE POLICY member_roles_write ON member_roles FOR ALL
  USING (organization_id = app_current_org() OR app_is_platform())
  WITH CHECK (organization_id = app_current_org() OR app_is_platform());

-- ---------------------------------------------------------------------------
-- invitations
-- Accepting an invitation by token (before the user belongs to the organization) will go
-- through a dedicated SECURITY DEFINER function when the invitation flow is built.
-- ---------------------------------------------------------------------------
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY invitations_all ON invitations FOR ALL
  USING (organization_id = app_current_org() OR app_is_platform())
  WITH CHECK (organization_id = app_current_org() OR app_is_platform());

-- ---------------------------------------------------------------------------
-- sessions: a user sees only their own sessions
-- ---------------------------------------------------------------------------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sessions_own ON sessions FOR ALL
  USING (user_id = app_current_user())
  WITH CHECK (user_id = app_current_user());

-- ---------------------------------------------------------------------------
-- audit_logs: append-only; readable by the owning organization and the platform
-- ---------------------------------------------------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_select ON audit_logs FOR SELECT
  USING (organization_id = app_current_org() OR app_is_platform());

CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (organization_id IS NULL OR organization_id = app_current_org() OR app_is_platform());

REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM tasheel_app;

-- ---------------------------------------------------------------------------
-- Global tables
-- permissions: read-only catalogue for the app.
-- users: global by design (one person, several organizations). No RLS at this stage;
--   the API never exposes password_hash / mfa_secret and selects users only through
--   memberships. Revisit when user search is built.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON permissions FROM tasheel_app;
