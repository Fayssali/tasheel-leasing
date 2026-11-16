-- CreateEnum
CREATE TYPE "CommissionTrigger" AS ENUM ('QUOTATION_ACCEPTED', 'OFFER_ACCEPTED');
CREATE TYPE "CommissionBasis" AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE "CommissionStatus" AS ENUM ('ACCRUED', 'INVOICED', 'CANCELLED');
CREATE TYPE "InvoiceKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "trigger" "CommissionTrigger" NOT NULL,
    "payer_org_id" UUID,
    "basis" "CommissionBasis" NOT NULL,
    "rate_pct" DECIMAL(7,4),
    "fixed_amount" DECIMAL(18,2),
    "min_amount" DECIMAL(18,2),
    "max_amount" DECIMAL(18,2),
    "category_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "trigger" "CommissionTrigger" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "source_reference" TEXT NOT NULL,
    "base_amount" DECIMAL(18,2) NOT NULL,
    "rate_pct" DECIMAL(7,4),
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "status" "CommissionStatus" NOT NULL DEFAULT 'ACCRUED',
    "invoice_id" UUID,
    "accrued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "InvoiceKind" NOT NULL DEFAULT 'INVOICE',
    "number" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "credited_invoice_id" UUID,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "issue_date" DATE,
    "due_date" DATE,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "vat_rate" DECIMAL(7,4) NOT NULL,
    "vat_amount" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "issuer" JSONB NOT NULL DEFAULT '{}',
    "customer" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "paid_at" TIMESTAMP(3),
    "payment_reference" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "commission_id" UUID,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_counters" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "key" TEXT NOT NULL,
    "vars" JSONB NOT NULL DEFAULT '{}',
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_rules_trigger_is_active_idx" ON "commission_rules"("trigger", "is_active");
CREATE UNIQUE INDEX "commissions_source_type_source_id_key" ON "commissions"("source_type", "source_id");
CREATE INDEX "commissions_organization_id_status_idx" ON "commissions"("organization_id", "status");
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");
CREATE INDEX "invoices_organization_id_created_at_idx" ON "invoices"("organization_id", "created_at" DESC);
CREATE INDEX "invoices_status_idx" ON "invoices"("status");
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "commission_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below: constraints, commission accrual, Row-Level Security.
-- ---------------------------------------------------------------------------

ALTER TABLE commission_rules
  ADD CONSTRAINT commission_rules_basis_check CHECK (
    (basis = 'PERCENT' AND rate_pct IS NOT NULL AND rate_pct > 0 AND rate_pct < 100 AND fixed_amount IS NULL)
    OR (basis = 'FIXED' AND fixed_amount IS NOT NULL AND fixed_amount > 0 AND rate_pct IS NULL)),
  ADD CONSTRAINT commission_rules_bounds_check CHECK (
    (min_amount IS NULL OR min_amount >= 0) AND (max_amount IS NULL OR max_amount >= coalesce(min_amount, 0))),
  ADD CONSTRAINT commission_rules_validity_check CHECK (valid_to IS NULL OR valid_to >= valid_from);
ALTER TABLE commissions
  ADD CONSTRAINT commissions_source_type_check CHECK (source_type IN ('Quotation', 'Offer')),
  ADD CONSTRAINT commissions_amounts_check CHECK (base_amount >= 0 AND amount >= 0);
ALTER TABLE invoices
  ADD CONSTRAINT invoices_period_check CHECK (period_end >= period_start),
  ADD CONSTRAINT invoices_vat_check CHECK (vat_rate >= 0 AND vat_rate < 100),
  ADD CONSTRAINT invoices_total_check CHECK (total = subtotal + vat_amount),
  ADD CONSTRAINT invoices_sign_check CHECK (
    (kind = 'INVOICE' AND subtotal >= 0 AND credited_invoice_id IS NULL)
    OR (kind = 'CREDIT_NOTE' AND subtotal <= 0 AND credited_invoice_id IS NOT NULL)),
  -- Issued, paid or credited invoices carry a number; a discarded draft (CANCELLED) may not.
  ADD CONSTRAINT invoices_number_check CHECK (status IN ('DRAFT', 'CANCELLED') OR number IS NOT NULL);

-- Accrues the commission for an accepted quotation or offer, in the caller's transaction.
-- SECURITY DEFINER: the payer is another organization than the one accepting. The function
-- only acts on sources that are ACCEPTED and that the caller is a party to; it is idempotent.
CREATE FUNCTION app_accrue_commission(p_source_type text, p_source_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_payer uuid; v_reference text; v_base numeric; v_category text; v_trigger "CommissionTrigger";
  v_parties uuid[]; v_day date := current_date;
  r commission_rules%ROWTYPE; v_amount numeric;
BEGIN
  IF p_source_type = 'Quotation' THEN
    SELECT q.organization_id, q.reference, q.subtotal, c.code, ARRAY[q.organization_id, q.business_org_id]
      INTO v_payer, v_reference, v_base, v_category, v_parties
      FROM quotations q JOIN equipment_listings l ON l.id = q.listing_id JOIN equipment_categories c ON c.id = l.category_id
      WHERE q.id = p_source_id AND q.status = 'ACCEPTED';
    v_trigger := 'QUOTATION_ACCEPTED';
  ELSIF p_source_type = 'Offer' THEN
    SELECT o.organization_id, o.reference, o.financed_amount, a.category_code, ARRAY[o.organization_id, o.business_org_id]
      INTO v_payer, v_reference, v_base, v_category, v_parties
      FROM offers o JOIN financing_applications a ON a.id = o.application_id
      WHERE o.id = p_source_id AND o.status = 'ACCEPTED';
    v_trigger := 'OFFER_ACCEPTED';
  ELSE
    RAISE EXCEPTION 'unknown commission source %', p_source_type;
  END IF;
  IF v_payer IS NULL THEN RETURN; END IF; -- not accepted: nothing to accrue
  IF NOT (app_is_platform() OR app_current_org() = ANY (v_parties)) THEN
    RAISE EXCEPTION 'not a party to this % ', p_source_type USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO r FROM commission_rules cr
   WHERE cr.is_active AND cr.trigger = v_trigger
     AND cr.valid_from <= v_day AND (cr.valid_to IS NULL OR cr.valid_to >= v_day)
     AND (cr.payer_org_id IS NULL OR cr.payer_org_id = v_payer)
     AND (cardinality(cr.category_codes) = 0 OR v_category = ANY (cr.category_codes))
   ORDER BY (cr.payer_org_id IS NOT NULL) DESC, cardinality(cr.category_codes) > 0 DESC, cr.valid_from DESC, cr.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF; -- no rule configured: no commission

  IF r.basis = 'PERCENT' THEN
    v_amount := round(v_base * r.rate_pct / 100, 2); -- numeric round: half away from zero
    IF r.min_amount IS NOT NULL THEN v_amount := greatest(v_amount, r.min_amount); END IF;
    IF r.max_amount IS NOT NULL THEN v_amount := least(v_amount, r.max_amount); END IF;
  ELSE
    v_amount := r.fixed_amount;
  END IF;

  INSERT INTO commissions (id, organization_id, rule_id, trigger, source_type, source_id, source_reference, base_amount, rate_pct, amount, updated_at)
  VALUES (gen_random_uuid(), v_payer, r.id, v_trigger, p_source_type, p_source_id, v_reference, v_base, r.rate_pct, v_amount, now())
  ON CONFLICT (source_type, source_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION app_accrue_commission(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_accrue_commission(text, uuid) TO tasheel_app;

-- Tasheel staff: accrue commissions for accepted sources that have none (e.g. rule created later).
CREATE FUNCTION app_accrue_missing_commissions() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_before integer; v_after integer; s record;
BEGIN
  IF NOT app_is_platform() THEN RAISE EXCEPTION 'Tasheel staff only' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT count(*) INTO v_before FROM commissions;
  FOR s IN
    SELECT 'Quotation' AS t, q.id FROM quotations q WHERE q.status = 'ACCEPTED'
      AND NOT EXISTS (SELECT 1 FROM commissions c WHERE c.source_type = 'Quotation' AND c.source_id = q.id)
    UNION ALL
    SELECT 'Offer', o.id FROM offers o WHERE o.status = 'ACCEPTED'
      AND NOT EXISTS (SELECT 1 FROM commissions c WHERE c.source_type = 'Offer' AND c.source_id = o.id)
  LOOP
    PERFORM app_accrue_commission(s.t, s.id);
  END LOOP;
  SELECT count(*) INTO v_after FROM commissions;
  RETURN v_after - v_before;
END $$;
REVOKE ALL ON FUNCTION app_accrue_missing_commissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_accrue_missing_commissions() TO tasheel_app;

-- Platform settings: readable by all, written by Tasheel staff only (was unrestricted).
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY settings_select ON platform_settings FOR SELECT USING (true);
CREATE POLICY settings_insert ON platform_settings FOR INSERT WITH CHECK (app_is_platform());
CREATE POLICY settings_update ON platform_settings FOR UPDATE USING (app_is_platform()) WITH CHECK (app_is_platform());

-- Commission rules: Tasheel writes; a payer can read the rules that apply to it (transparency).
ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY rules_select ON commission_rules FOR SELECT
  USING (app_is_platform() OR payer_org_id = app_current_org() OR (payer_org_id IS NULL AND EXISTS (
    SELECT 1 FROM organizations o WHERE o.id = app_current_org() AND (
      (commission_rules.trigger = 'QUOTATION_ACCEPTED' AND o.type = 'SUPPLIER')
      OR (commission_rules.trigger = 'OFFER_ACCEPTED' AND o.type = 'FINANCIAL_INSTITUTION')))));
CREATE POLICY rules_insert ON commission_rules FOR INSERT WITH CHECK (app_is_platform());
CREATE POLICY rules_update ON commission_rules FOR UPDATE USING (app_is_platform()) WITH CHECK (app_is_platform());
REVOKE DELETE, TRUNCATE ON commission_rules FROM tasheel_app;

-- Commissions: created only by app_accrue_commission; the payer reads its own; Tasheel updates.
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY commissions_select ON commissions FOR SELECT USING (organization_id = app_current_org() OR app_is_platform());
CREATE POLICY commissions_update ON commissions FOR UPDATE USING (app_is_platform()) WITH CHECK (app_is_platform());
REVOKE INSERT, DELETE, TRUNCATE ON commissions FROM tasheel_app;

-- Invoices and lines: Tasheel writes; the customer reads its own. Never deleted.
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoices_select ON invoices FOR SELECT USING (organization_id = app_current_org() OR app_is_platform());
CREATE POLICY invoices_insert ON invoices FOR INSERT WITH CHECK (app_is_platform());
CREATE POLICY invoices_update ON invoices FOR UPDATE USING (app_is_platform()) WITH CHECK (app_is_platform());
REVOKE DELETE, TRUNCATE ON invoices FROM tasheel_app;

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY lines_select ON invoice_lines FOR SELECT USING (organization_id = app_current_org() OR app_is_platform());
CREATE POLICY lines_insert ON invoice_lines FOR INSERT WITH CHECK (app_is_platform());
REVOKE UPDATE, DELETE, TRUNCATE ON invoice_lines FROM tasheel_app;

ALTER TABLE invoice_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY counters_platform ON invoice_counters FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());
REVOKE DELETE, TRUNCATE ON invoice_counters FROM tasheel_app;

-- Notifications: each user reads and marks its own; written in the target organization's
-- context by the server (or in the user's own context).
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_select ON notifications FOR SELECT USING (user_id = app_current_user());
CREATE POLICY notifications_insert ON notifications FOR INSERT
  WITH CHECK (user_id = app_current_user() OR (organization_id IS NOT NULL AND organization_id = app_current_org()));
CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
REVOKE DELETE, TRUNCATE ON notifications FROM tasheel_app;
