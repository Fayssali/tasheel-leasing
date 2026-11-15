-- Verified suppliers and financial institutions have a public profile (name, wilaya) shown on
-- listings and supplier pages, including to anonymous visitors. Row-level visibility only:
-- the API selects public columns for these reads. Businesses are never public.
CREATE POLICY organizations_public_select ON organizations FOR SELECT
  USING (type IN ('SUPPLIER', 'FINANCIAL_INSTITUTION') AND status = 'VERIFIED' AND deleted_at IS NULL);
