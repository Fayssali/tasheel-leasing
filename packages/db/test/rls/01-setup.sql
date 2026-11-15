-- Run as tasheel_admin (table owner, not subject to RLS). Creates fixed test tenants.
BEGIN;
DELETE FROM favourites WHERE user_id IN ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1');
DELETE FROM quotation_requests WHERE reference LIKE 'RLS-%';
DELETE FROM equipment_listings WHERE reference LIKE 'RLS-%';
DELETE FROM equipment_categories WHERE code = 'rls-test';
DELETE FROM audit_logs WHERE entity_type = 'RlsTest';
DELETE FROM user_tokens WHERE user_id IN (
  '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000f1');
DELETE FROM organization_members WHERE organization_id IN (
  '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-00000000000f', '00000000-0000-7000-8000-00000000000c');
DELETE FROM users WHERE email LIKE '%@rls-test.local';
DELETE FROM organizations WHERE id IN (
  '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-00000000000f', '00000000-0000-7000-8000-00000000000c');

INSERT INTO organizations (id, type, legal_name, updated_at) VALUES
  ('00000000-0000-7000-8000-00000000000a', 'BUSINESS', 'RLS Tenant A', now()),
  ('00000000-0000-7000-8000-00000000000b', 'SUPPLIER', 'RLS Tenant B', now()),
  ('00000000-0000-7000-8000-00000000000f', 'PLATFORM', 'RLS Platform', now()),
  ('00000000-0000-7000-8000-00000000000c', 'SUPPLIER', 'RLS Other Supplier', now());

INSERT INTO users (id, email, password_hash, first_name, last_name, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000000a1', 'a@rls-test.local', 'x', 'A', 'Test', now()),
  ('00000000-0000-7000-8000-0000000000b1', 'b@rls-test.local', 'x', 'B', 'Test', now()),
  ('00000000-0000-7000-8000-0000000000f1', 'p@rls-test.local', 'x', 'P', 'Test', now()),
  ('00000000-0000-7000-8000-0000000000c1', 'c@rls-test.local', 'x', 'C', 'Test', now());

INSERT INTO organization_members (id, organization_id, user_id, updated_at) VALUES
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1', now()),
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-0000000000b1', now()),
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000f', '00000000-0000-7000-8000-0000000000f1', now());

INSERT INTO audit_logs (id, organization_id, action, entity_type) VALUES
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', 'test', 'RlsTest'),
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000b', 'test', 'RlsTest');

INSERT INTO user_tokens (id, user_id, purpose, token_hash, expires_at) VALUES
  (gen_random_uuid(), '00000000-0000-7000-8000-0000000000a1', 'PASSWORD_RESET', 'rls-test-hash-a', now() + interval '1 hour'),
  (gen_random_uuid(), '00000000-0000-7000-8000-0000000000b1', 'PASSWORD_RESET', 'rls-test-hash-b', now() + interval '1 hour');

-- Marketplace: supplier B has one published and one draft listing; business A asked B for a quote.
INSERT INTO equipment_categories (id, code, name, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000000e0', 'rls-test', '{"fr": "Test"}', now());
INSERT INTO equipment_listings (id, organization_id, reference, category_id, title, status, created_by_id, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-00000000000b', 'RLS-PUB', '00000000-0000-7000-8000-0000000000e0', '{"fr": "Pelle publiee"}', 'PUBLISHED', '00000000-0000-7000-8000-0000000000b1', now()),
  ('00000000-0000-7000-8000-0000000000e2', '00000000-0000-7000-8000-00000000000b', 'RLS-DRAFT', '00000000-0000-7000-8000-0000000000e0', '{"fr": "Brouillon secret"}', 'DRAFT', '00000000-0000-7000-8000-0000000000b1', now()),
  ('00000000-0000-7000-8000-0000000000e4', '00000000-0000-7000-8000-00000000000b', 'RLS-ARCH', '00000000-0000-7000-8000-0000000000e0', '{"fr": "Ancien modele"}', 'ARCHIVED', '00000000-0000-7000-8000-0000000000b1', now());
INSERT INTO quotation_requests (id, organization_id, supplier_org_id, reference, listing_id, requested_by_id, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000000e3', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000b', 'RLS-QR', '00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-0000000000a1', now()),
  ('00000000-0000-7000-8000-0000000000e5', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000b', 'RLS-QR2', '00000000-0000-7000-8000-0000000000e4', '00000000-0000-7000-8000-0000000000a1', now());
INSERT INTO favourites (id, organization_id, user_id, listing_id) VALUES
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000e1');
COMMIT;
