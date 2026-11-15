-- Run as tasheel_app (NOBYPASSRLS). Each block raises an exception on failure.
-- Mirrors packages/db/test/tenant-isolation.test.ts at the SQL level.
\set ON_ERROR_STOP on

-- 1. Tenant A sees only its own organization (verified banks are public profiles by design, see 19)
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000a', true),
       set_config('app.user_id', '00000000-0000-7000-8000-0000000000a1', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM organizations WHERE legal_name LIKE 'RLS %' AND legal_name NOT LIKE 'RLS Bank %') <> 1 THEN
    RAISE EXCEPTION 'FAIL 1: tenant A sees other organizations';
  END IF;
  RAISE NOTICE 'ok 1 - tenant sees only its own organization';
END $$;

-- 2. Tenant A cannot read tenant B members or audit log
DO $$ BEGIN
  IF (SELECT count(*) FROM organization_members WHERE organization_id = '00000000-0000-7000-8000-00000000000b') <> 0
     OR (SELECT count(*) FROM audit_logs WHERE organization_id = '00000000-0000-7000-8000-00000000000b') <> 0 THEN
    RAISE EXCEPTION 'FAIL 2: tenant A reads tenant B members or audit log';
  END IF;
  RAISE NOTICE 'ok 2 - no cross-tenant read of members or audit log';
END $$;

-- 3. Tenant A cannot update tenant B
DO $$ DECLARE n int; BEGIN
  UPDATE organizations SET legal_name = 'hijacked' WHERE id = '00000000-0000-7000-8000-00000000000b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 3: tenant A updated tenant B'; END IF;
  RAISE NOTICE 'ok 3 - no cross-tenant update';
END $$;

-- 4. Tenant A cannot insert into tenant B
DO $$ BEGIN
  BEGIN
    INSERT INTO organization_members (id, organization_id, user_id, updated_at)
    VALUES (gen_random_uuid(), '00000000-0000-7000-8000-00000000000b', '00000000-0000-7000-8000-0000000000a1', now());
    RAISE EXCEPTION 'FAIL 4: tenant A inserted a member into tenant B';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok 4 - cross-tenant insert rejected by RLS';
  END;
END $$;

-- 5. Audit log is append-only
DO $$ BEGIN
  BEGIN
    DELETE FROM audit_logs WHERE organization_id = '00000000-0000-7000-8000-00000000000a';
    RAISE EXCEPTION 'FAIL 5: app role deleted audit rows';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok 5 - audit log delete denied';
  END;
END $$;
COMMIT;

-- 6. No context → nothing visible
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM organizations WHERE legal_name LIKE 'RLS %' AND legal_name NOT LIKE 'RLS Bank %') <> 0 THEN
    RAISE EXCEPTION 'FAIL 6: organizations visible without tenant context';
  END IF;
  RAISE NOTICE 'ok 6 - nothing visible without context';
END $$;
COMMIT;

-- 7. User-only context (organization switcher) sees own memberships only
BEGIN;
SELECT set_config('app.user_id', '00000000-0000-7000-8000-0000000000b1', true);
DO $$ BEGIN
  IF (SELECT array_agg(legal_name) FROM organizations WHERE legal_name LIKE 'RLS %' AND legal_name NOT LIKE 'RLS Bank %') <> ARRAY['RLS Tenant B'] THEN
    RAISE EXCEPTION 'FAIL 7: user sees organizations they do not belong to';
  END IF;
  RAISE NOTICE 'ok 7 - user sees only organizations they belong to';
END $$;
COMMIT;

-- 8. Platform organization reads all organizations
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000f', true),
       set_config('app.user_id', '00000000-0000-7000-8000-0000000000f1', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM organizations WHERE legal_name LIKE 'RLS %') <> 6 THEN
    RAISE EXCEPTION 'FAIL 8: platform cannot see all organizations';
  END IF;
  RAISE NOTICE 'ok 8 - platform sees all organizations';
END $$;
COMMIT;

-- 9. Transaction-scoped context does not leak to the next transaction
DO $$ BEGIN
  IF coalesce(current_setting('app.org_id', true), '') <> '' THEN
    RAISE EXCEPTION 'FAIL 9: tenant context leaked outside its transaction';
  END IF;
  RAISE NOTICE 'ok 9 - context does not leak between transactions';
END $$;

-- 10. A tenant cannot create or alter system roles
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000a', true);
DO $$ BEGIN
  BEGIN
    INSERT INTO roles (id, organization_id, organization_type, code, name, is_system, updated_at)
    VALUES (gen_random_uuid(), NULL, 'BUSINESS', 'evil', '{}', true, now());
    RAISE EXCEPTION 'FAIL 10: tenant created a system role';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok 10 - tenant cannot create system roles';
  END;
END $$;
COMMIT;

-- 11. A user sees only their own email tokens, even with a known hash
BEGIN;
SELECT set_config('app.user_id', '00000000-0000-7000-8000-0000000000a1', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM user_tokens WHERE token_hash = 'rls-test-hash-b') <> 0
     OR (SELECT count(*) FROM user_tokens WHERE token_hash = 'rls-test-hash-a') <> 1 THEN
    RAISE EXCEPTION 'FAIL 11: user can read another user''s tokens';
  END IF;
  RAISE NOTICE 'ok 11 - email tokens visible only to their owner';
END $$;

-- 12. Email tokens cannot be deleted by the app role
DO $$ BEGIN
  BEGIN
    DELETE FROM user_tokens WHERE token_hash = 'rls-test-hash-a';
    RAISE EXCEPTION 'FAIL 12: app role deleted a token';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok 12 - email token delete denied';
  END;
END $$;
COMMIT;

-- 13. Anonymous visitors see published listings only, and search finds them
BEGIN;
DO $$ BEGIN
  IF (SELECT array_agg(reference ORDER BY reference) FROM equipment_listings WHERE reference LIKE 'RLS-%') <> ARRAY['RLS-PUB'] THEN
    RAISE EXCEPTION 'FAIL 13: anonymous visitor sees unpublished listings';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM equipment_listings WHERE search_vector @@ to_tsquery('simple', 'pelle:*') AND reference = 'RLS-PUB') THEN
    RAISE EXCEPTION 'FAIL 13: full-text search does not find the published listing';
  END IF;
  RAISE NOTICE 'ok 13 - public sees published listings only; search works';
END $$;

-- 14. Anyone can count a view, but only on published listings and only the counter
SELECT app_count_listing_view('00000000-0000-7000-8000-0000000000e1');
SELECT app_count_listing_view('00000000-0000-7000-8000-0000000000e2');
COMMIT;

-- 15. Another supplier can neither see nor change supplier B's draft
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000c', true),
       set_config('app.user_id', '00000000-0000-7000-8000-0000000000c1', true);
DO $$ DECLARE n int; BEGIN
  IF EXISTS (SELECT 1 FROM equipment_listings WHERE reference = 'RLS-DRAFT') THEN
    RAISE EXCEPTION 'FAIL 15: other supplier sees a draft';
  END IF;
  UPDATE equipment_listings SET price = 1 WHERE reference = 'RLS-PUB';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 15: other supplier updated a listing it does not own'; END IF;
  RAISE NOTICE 'ok 15 - suppliers cannot see or change each other''s listings';
END $$;

-- 16. A quotation request is visible to the asking business and the asked supplier only
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM quotation_requests WHERE reference = 'RLS-QR') THEN
    RAISE EXCEPTION 'FAIL 16: a third organization sees a quotation request';
  END IF;
END $$;
COMMIT;
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000b', true),
       set_config('app.user_id', '00000000-0000-7000-8000-0000000000b1', true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM quotation_requests WHERE reference = 'RLS-QR') THEN
    RAISE EXCEPTION 'FAIL 16: the supplier cannot see the request addressed to it';
  END IF;
  IF (SELECT view_count FROM equipment_listings WHERE reference = 'RLS-DRAFT') <> 0
     OR (SELECT view_count FROM equipment_listings WHERE reference = 'RLS-PUB') < 1 THEN
    RAISE EXCEPTION 'FAIL 14: view counting touched a draft or missed the published listing';
  END IF;
  IF EXISTS (SELECT 1 FROM favourites) THEN
    RAISE EXCEPTION 'FAIL 17: a supplier sees a business''s favourites';
  END IF;
  RAISE NOTICE 'ok 14 - views counted on published listings only';
  RAISE NOTICE 'ok 16 - quotation requests shared with the two parties only';
  RAISE NOTICE 'ok 17 - favourites are private to their user';
END $$;
COMMIT;

-- 18. Quotation requests and listings cannot be deleted by the app role
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000a', true);
DO $$ BEGIN
  BEGIN
    DELETE FROM quotation_requests WHERE reference = 'RLS-QR';
    RAISE EXCEPTION 'FAIL 18: app role deleted a quotation request';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok 18 - commercial records cannot be deleted';
  END;
END $$;
COMMIT;

-- 19. Anonymous visitors see verified suppliers' public profiles, never businesses
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE type = 'BUSINESS') THEN
    RAISE EXCEPTION 'FAIL 19: a business is publicly visible';
  END IF;
  IF EXISTS (SELECT 1 FROM organizations WHERE status <> 'VERIFIED') THEN
    RAISE EXCEPTION 'FAIL 19: an unverified organization is publicly visible';
  END IF;
  RAISE NOTICE 'ok 19 - only verified suppliers and institutions are public';
END $$;
COMMIT;

-- 20. A business that asked for a quotation keeps seeing the listing once it is archived;
--     other organizations do not
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000a', true),
       set_config('app.user_id', '00000000-0000-7000-8000-0000000000a1', true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM equipment_listings WHERE reference = 'RLS-ARCH') THEN
    RAISE EXCEPTION 'FAIL 20: requesting business lost sight of an archived listing';
  END IF;
END $$;
COMMIT;
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000c', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM equipment_listings WHERE reference = 'RLS-ARCH') THEN
    RAISE EXCEPTION 'FAIL 20: an archived listing is visible to an unrelated organization';
  END IF;
  RAISE NOTICE 'ok 20 - archived listings stay visible to businesses that requested quotations only';
END $$;
COMMIT;

-- ---------------------------------------------------------------- Phase 3
-- 21. An institution sees an application submitted to it and only the attached documents
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000d', true), set_config('app.user_id', '00000000-0000-7000-8000-0000000000d1', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM financing_applications WHERE reference = 'RLS-FA') <> 1 THEN RAISE EXCEPTION 'FAIL 21: bank D cannot see the application submitted to it'; END IF;
  IF NOT EXISTS (SELECT 1 FROM documents WHERE title = 'RLS attached') THEN RAISE EXCEPTION 'FAIL 21: bank D cannot see the attached document'; END IF;
  IF EXISTS (SELECT 1 FROM documents WHERE title = 'RLS private') THEN RAISE EXCEPTION 'FAIL 21: bank D sees a document that was not attached'; END IF;
  RAISE NOTICE 'ok 21 - institutions see submitted applications and attached documents only';
END $$;
COMMIT;
-- 22. Another institution and a supplier see nothing of it
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000e', true), set_config('app.user_id', '00000000-0000-7000-8000-0000000000d2', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM financing_applications WHERE reference = 'RLS-FA') THEN RAISE EXCEPTION 'FAIL 22: bank E sees the application'; END IF;
  IF EXISTS (SELECT 1 FROM documents WHERE title LIKE 'RLS %') THEN RAISE EXCEPTION 'FAIL 22: bank E sees vault documents'; END IF;
  IF EXISTS (SELECT 1 FROM application_submissions WHERE id = '00000000-0000-7000-8000-0000000000fb') OR EXISTS (SELECT 1 FROM offers WHERE reference = 'RLS-OF') OR EXISTS (SELECT 1 FROM submission_events WHERE note = 'rls-test') THEN RAISE EXCEPTION 'FAIL 22: bank E sees submissions, offers or events'; END IF;
END $$;
COMMIT;
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000b', true), set_config('app.user_id', '00000000-0000-7000-8000-0000000000b1', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM financing_applications WHERE reference = 'RLS-FA') THEN RAISE EXCEPTION 'FAIL 22: supplier B sees the application'; END IF;
  IF EXISTS (SELECT 1 FROM documents WHERE title LIKE 'RLS %') THEN RAISE EXCEPTION 'FAIL 22: supplier B sees vault documents'; END IF;
  IF EXISTS (SELECT 1 FROM application_submissions WHERE id = '00000000-0000-7000-8000-0000000000fb') OR EXISTS (SELECT 1 FROM offers WHERE reference = 'RLS-OF') OR EXISTS (SELECT 1 FROM submission_events WHERE note = 'rls-test') THEN RAISE EXCEPTION 'FAIL 22: supplier B sees submissions, offers or events'; END IF;
END $$;
COMMIT;
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000a', true), set_config('app.user_id', '00000000-0000-7000-8000-0000000000a1', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM documents WHERE title LIKE 'RLS %') <> 2 THEN RAISE EXCEPTION 'FAIL 22: business A cannot see its own vault'; END IF;
  IF NOT EXISTS (SELECT 1 FROM offers WHERE reference = 'RLS-OF') THEN RAISE EXCEPTION 'FAIL 22: business A cannot see the offer made to it'; END IF;
  RAISE NOTICE 'ok 22 - other institutions and suppliers see nothing; the business sees its vault and offers';
END $$;
COMMIT;
-- 23. Active products of verified institutions are visible to signed-in organizations; inactive ones are not; anonymous sees none
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000a', true), set_config('app.user_id', '00000000-0000-7000-8000-0000000000a1', true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM financing_products WHERE name->>'fr' = 'RLS active') THEN RAISE EXCEPTION 'FAIL 23: business cannot see an active product'; END IF;
  IF EXISTS (SELECT 1 FROM financing_products WHERE name->>'fr' = 'RLS inactive') THEN RAISE EXCEPTION 'FAIL 23: business sees an inactive product'; END IF;
END $$;
COMMIT;
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM financing_products WHERE name->>'fr' LIKE 'RLS %') THEN RAISE EXCEPTION 'FAIL 23: anonymous visitors see products'; END IF;
  RAISE NOTICE 'ok 23 - products: active ones to signed-in organizations only';
END $$;
COMMIT;
-- 24. An institution cannot change an application, nor write events in the business's name
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000d', true), set_config('app.user_id', '00000000-0000-7000-8000-0000000000d1', true);
DO $$ BEGIN
  UPDATE financing_applications SET financed_amount = 1 WHERE reference = 'RLS-FA';
  IF FOUND THEN RAISE EXCEPTION 'FAIL 24: bank D changed the application'; END IF;
  BEGIN
    INSERT INTO submission_events (id, organization_id, submission_id, business_org_id, institution_org_id, kind, note, actor_user_id)
    VALUES (gen_random_uuid(), '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-0000000000fb', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000d', 'NOTE', 'forged', '00000000-0000-7000-8000-0000000000d1');
    RAISE EXCEPTION 'FAIL 24: bank D wrote an event in the business''s name';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
COMMIT;
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000e', true), set_config('app.user_id', '00000000-0000-7000-8000-0000000000d2', true);
DO $$ BEGIN
  BEGIN
    INSERT INTO submission_events (id, organization_id, submission_id, business_org_id, institution_org_id, kind, note, actor_user_id)
    VALUES (gen_random_uuid(), '00000000-0000-7000-8000-00000000000e', '00000000-0000-7000-8000-0000000000fb', '00000000-0000-7000-8000-00000000000a', '00000000-0000-7000-8000-00000000000d', 'NOTE', 'intruder', '00000000-0000-7000-8000-0000000000d2');
    RAISE EXCEPTION 'FAIL 24: bank E wrote into a timeline it is not part of';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok 24 - institutions cannot edit applications or forge timeline entries';
END $$;
COMMIT;
-- 25. Financing records and documents are never deleted; the timeline is append-only
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000a', true), set_config('app.user_id', '00000000-0000-7000-8000-0000000000a1', true);
DO $$ BEGIN
  BEGIN DELETE FROM documents WHERE title = 'RLS private'; RAISE EXCEPTION 'FAIL 25: document deleted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM financing_applications WHERE reference = 'RLS-FA'; RAISE EXCEPTION 'FAIL 25: application deleted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM offers WHERE reference = 'RLS-OF'; RAISE EXCEPTION 'FAIL 25: offer deleted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE submission_events SET note = 'changed' WHERE note = 'rls-test'; RAISE EXCEPTION 'FAIL 25: event changed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'ok 25 - documents and financing records cannot be deleted; events cannot be changed';
END $$;
COMMIT;
-- 26. Once the business withdraws a submission, the institution loses access to its documents
BEGIN;
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000a', true), set_config('app.user_id', '00000000-0000-7000-8000-0000000000a1', true);
UPDATE application_submissions SET status = 'WITHDRAWN' WHERE id = '00000000-0000-7000-8000-0000000000fb';
SELECT set_config('app.org_id', '00000000-0000-7000-8000-00000000000d', true), set_config('app.user_id', '00000000-0000-7000-8000-0000000000d1', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM documents WHERE title = 'RLS attached') OR EXISTS (SELECT 1 FROM financing_applications WHERE reference = 'RLS-FA') THEN
    RAISE EXCEPTION 'FAIL 26: bank D still sees the application or documents after withdrawal';
  END IF;
  RAISE NOTICE 'ok 26 - withdrawal removes the institution''s access to the application and documents';
END $$;
ROLLBACK;
