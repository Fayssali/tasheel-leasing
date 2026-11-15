-- Run as tasheel_admin (table owner, not subject to RLS). Creates fixed test tenants.
BEGIN;
DELETE FROM audit_logs WHERE entity_type = 'RlsTest';
DELETE FROM organization_members WHERE organization_id IN (
  '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-00000000000f');
DELETE FROM users WHERE email LIKE '%@rls-test.local';
DELETE FROM organizations WHERE id IN (
  '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-00000000000f');

INSERT INTO organizations (id, type, legal_name, updated_at) VALUES
  ('00000000-0000-7000-8000-00000000000a', 'BUSINESS', 'RLS Tenant A', now()),
  ('00000000-0000-7000-8000-00000000000b', 'SUPPLIER', 'RLS Tenant B', now()),
  ('00000000-0000-7000-8000-00000000000f', 'PLATFORM', 'RLS Platform', now());

INSERT INTO users (id, email, password_hash, first_name, last_name, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000000a1', 'a@rls-test.local', 'x', 'A', 'Test', now()),
  ('00000000-0000-7000-8000-0000000000b1', 'b@rls-test.local', 'x', 'B', 'Test', now()),
  ('00000000-0000-7000-8000-0000000000f1', 'p@rls-test.local', 'x', 'P', 'Test', now());

INSERT INTO organization_members (id, organization_id, user_id, updated_at) VALUES
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1', now()),
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-0000000000b1', now()),
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000f', '00000000-0000-7000-8000-0000000000f1', now());

INSERT INTO audit_logs (id, organization_id, action, entity_type) VALUES
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', 'test', 'RlsTest'),
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000b', 'test', 'RlsTest');
COMMIT;
