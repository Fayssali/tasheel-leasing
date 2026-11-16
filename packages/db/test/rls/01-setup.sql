-- Run as tasheel_admin (table owner, not subject to RLS). Creates fixed test tenants.
BEGIN;
DELETE FROM notifications WHERE key = 'rls.test';
DELETE FROM invoice_lines WHERE label LIKE 'RLS %';
DELETE FROM invoices WHERE notes = 'rls-test';
DELETE FROM commissions WHERE source_reference LIKE 'RLS-%';
DELETE FROM commission_rules WHERE name->>'fr' LIKE 'RLS %';
DELETE FROM quotations WHERE reference = 'RLS-QT';
DELETE FROM offers WHERE reference LIKE 'RLS-%';
DELETE FROM submission_events WHERE note = 'rls-test';
DELETE FROM application_submissions WHERE application_id IN (SELECT id FROM financing_applications WHERE reference LIKE 'RLS-%');
DELETE FROM application_documents WHERE application_id IN (SELECT id FROM financing_applications WHERE reference LIKE 'RLS-%');
DELETE FROM financing_applications WHERE reference LIKE 'RLS-%';
DELETE FROM documents WHERE type_code = 'rls-doc';
DELETE FROM document_types WHERE code = 'rls-doc';
DELETE FROM financing_products WHERE name->>'fr' LIKE 'RLS %';
DELETE FROM favourites WHERE user_id IN ('00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000c1');
DELETE FROM quotation_requests WHERE reference LIKE 'RLS-%';
DELETE FROM equipment_listings WHERE reference LIKE 'RLS-%';
DELETE FROM equipment_categories WHERE code = 'rls-test';
DELETE FROM audit_logs WHERE entity_type = 'RlsTest';
DELETE FROM user_tokens WHERE user_id IN (
  '00000000-0000-7000-8000-0000000000a1', '00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000f1');
DELETE FROM organization_members WHERE organization_id IN (
  '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-00000000000f', '00000000-0000-7000-8000-00000000000c',
  '00000000-0000-7000-8000-00000000000d', '00000000-0000-7000-8000-00000000000e');
DELETE FROM users WHERE email LIKE '%@rls-test.local';
DELETE FROM organizations WHERE id IN (
  '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-00000000000f', '00000000-0000-7000-8000-00000000000c',
  '00000000-0000-7000-8000-00000000000d', '00000000-0000-7000-8000-00000000000e');

INSERT INTO organizations (id, type, legal_name, updated_at) VALUES
  ('00000000-0000-7000-8000-00000000000a', 'BUSINESS', 'RLS Tenant A', now()),
  ('00000000-0000-7000-8000-00000000000b', 'SUPPLIER', 'RLS Tenant B', now()),
  ('00000000-0000-7000-8000-00000000000f', 'PLATFORM', 'RLS Platform', now()),
  ('00000000-0000-7000-8000-00000000000c', 'SUPPLIER', 'RLS Other Supplier', now());
INSERT INTO organizations (id, type, status, legal_name, updated_at) VALUES
  ('00000000-0000-7000-8000-00000000000d', 'FINANCIAL_INSTITUTION', 'VERIFIED', 'RLS Bank D', now()),
  ('00000000-0000-7000-8000-00000000000e', 'FINANCIAL_INSTITUTION', 'VERIFIED', 'RLS Bank E', now());

INSERT INTO users (id, email, password_hash, first_name, last_name, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000000a1', 'a@rls-test.local', 'x', 'A', 'Test', now()),
  ('00000000-0000-7000-8000-0000000000b1', 'b@rls-test.local', 'x', 'B', 'Test', now()),
  ('00000000-0000-7000-8000-0000000000f1', 'p@rls-test.local', 'x', 'P', 'Test', now()),
  ('00000000-0000-7000-8000-0000000000c1', 'c@rls-test.local', 'x', 'C', 'Test', now()),
  ('00000000-0000-7000-8000-0000000000d1', 'd@rls-test.local', 'x', 'D', 'Test', now()),
  ('00000000-0000-7000-8000-0000000000d2', 'e@rls-test.local', 'x', 'E', 'Test', now());

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

-- Phase 3: vault, products, an application from A submitted to bank D (not to bank E).
INSERT INTO document_types (code, name, owner_types) VALUES ('rls-doc', '{"fr": "RLS"}', ARRAY['BUSINESS']);
INSERT INTO documents (id, organization_id, type_code, title, file_name, mime_type, size_bytes, sha256, storage_key, uploaded_by_id, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000000f6', '00000000-0000-7000-8000-00000000000a', 'rls-doc', 'RLS attached', 'a.pdf', 'application/pdf', 10, repeat('a', 64), 'rls/attached', '00000000-0000-7000-8000-0000000000a1', now()),
  ('00000000-0000-7000-8000-0000000000f7', '00000000-0000-7000-8000-00000000000a', 'rls-doc', 'RLS private', 'b.pdf', 'application/pdf', 10, repeat('b', 64), 'rls/private', '00000000-0000-7000-8000-0000000000a1', now());
INSERT INTO financing_products (id, organization_id, name, product_type, min_amount, max_amount, min_duration_months, max_duration_months, indicative_rate_min, indicative_rate_max, is_active, created_by_id, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000000f8', '00000000-0000-7000-8000-00000000000d', '{"fr": "RLS active"}', 'LEASING', 1, 100000000, 12, 60, 6, 9, true, '00000000-0000-7000-8000-0000000000d1', now()),
  ('00000000-0000-7000-8000-0000000000f9', '00000000-0000-7000-8000-00000000000d', '{"fr": "RLS inactive"}', 'LEASING', 1, 100000000, 12, 60, 6, 9, false, '00000000-0000-7000-8000-0000000000d1', now());
INSERT INTO financing_applications (id, organization_id, reference, quotation_id, listing_id, supplier_org_id, category_code, equipment_amount, down_payment, financed_amount, duration_months, status, created_by_id, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000000fa', '00000000-0000-7000-8000-00000000000a', 'RLS-FA', gen_random_uuid(), '00000000-0000-7000-8000-0000000000e1', '00000000-0000-7000-8000-00000000000b', 'rls-test', 1000000, 100000, 900000, 36, 'SUBMITTED', '00000000-0000-7000-8000-0000000000a1', now());
INSERT INTO application_documents (id, organization_id, application_id, document_id) VALUES
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000fa', '00000000-0000-7000-8000-0000000000f6');
INSERT INTO application_submissions (id, organization_id, application_id, institution_org_id, product_id, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000000fb', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000fa', '00000000-0000-7000-8000-00000000000d', '00000000-0000-7000-8000-0000000000f8', now());
INSERT INTO submission_events (id, organization_id, submission_id, business_org_id, institution_org_id, kind, note, actor_user_id) VALUES
  (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000fb', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000d', 'SUBMITTED', 'rls-test', '00000000-0000-7000-8000-0000000000a1');
INSERT INTO offers (id, organization_id, submission_id, application_id, business_org_id, reference, financed_amount, duration_months, rate_pct, installment_amount, total_cost, valid_until, issued_by_id, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000000fc', '00000000-0000-7000-8000-00000000000d', '00000000-0000-7000-8000-0000000000fb', '00000000-0000-7000-8000-0000000000fa', '00000000-0000-7000-8000-00000000000a', 'RLS-OF', 900000, 36, 8, 28202.49, 1015289.64, current_date + 30, '00000000-0000-7000-8000-0000000000d1', now());

-- Phase 4: an accepted quotation (B → A) and the accepted offer (D → A); commission rules.
INSERT INTO quotations (id, organization_id, business_org_id, request_id, listing_id, reference, issued_by_id, lines, subtotal, vat_rate, vat_amount, total, valid_until, status, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000001a1', '00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000e3', '00000000-0000-7000-8000-0000000000e1', 'RLS-QT', '00000000-0000-7000-8000-0000000000b1', '[]', 1000000, 19, 190000, 1190000, current_date + 10, 'ACCEPTED', now());
UPDATE offers SET status = 'ACCEPTED' WHERE reference = 'RLS-OF';
INSERT INTO commission_rules (id, name, trigger, payer_org_id, basis, rate_pct, fixed_amount, min_amount, valid_from, created_by_id, updated_at) VALUES
  ('00000000-0000-7000-8000-0000000001b1', '{"fr": "RLS fournisseurs 2 %"}', 'QUOTATION_ACCEPTED', NULL, 'PERCENT', 2, NULL, 5000, current_date - 1, '00000000-0000-7000-8000-0000000000f1', now()),
  ('00000000-0000-7000-8000-0000000001b2', '{"fr": "RLS banques forfait"}', 'OFFER_ACCEPTED', NULL, 'FIXED', NULL, 50000, NULL, current_date - 1, '00000000-0000-7000-8000-0000000000f1', now()),
  ('00000000-0000-7000-8000-0000000001b3', '{"fr": "RLS contrat banque E"}', 'OFFER_ACCEPTED', '00000000-0000-7000-8000-00000000000e', 'PERCENT', 1, NULL, NULL, current_date - 1, '00000000-0000-7000-8000-0000000000f1', now());
COMMIT;
