-- CreateEnum
CREATE TYPE "DocumentScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'NOT_SCANNED');
CREATE TYPE "DocumentReviewStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
CREATE TYPE "FinancingProductType" AS ENUM ('LEASING', 'IJARA');
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'OFFER_ACCEPTED', 'WITHDRAWN', 'CLOSED');
CREATE TYPE "SubmissionStatus" AS ENUM ('SENT', 'UNDER_REVIEW', 'INFO_REQUESTED', 'OFFER_MADE', 'DECLINED', 'WITHDRAWN', 'CLOSED');
CREATE TYPE "OfferStatus" AS ENUM ('ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "document_types" (
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB NOT NULL DEFAULT '{}',
    "owner_types" TEXT[],
    "required_for_verification" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required_for_application" BOOLEAN NOT NULL DEFAULT false,
    "has_expiry" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "scan_status" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
    "scan_detail" TEXT,
    "review_status" "DocumentReviewStatus" NOT NULL DEFAULT 'PENDING',
    "review_reason" TEXT,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "expires_on" DATE,
    "superseded_by_id" UUID,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "financing_products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB NOT NULL DEFAULT '{}',
    "product_type" "FinancingProductType" NOT NULL,
    "min_amount" DECIMAL(18,2) NOT NULL,
    "max_amount" DECIMAL(18,2) NOT NULL,
    "min_duration_months" INTEGER NOT NULL,
    "max_duration_months" INTEGER NOT NULL,
    "min_down_payment_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "category_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wilaya_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "min_years_in_business" INTEGER NOT NULL DEFAULT 0,
    "indicative_rate_min" DECIMAL(7,4) NOT NULL,
    "indicative_rate_max" DECIMAL(7,4) NOT NULL,
    "required_document_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "financing_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "financing_applications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "quotation_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "supplier_org_id" UUID NOT NULL,
    "category_code" TEXT NOT NULL,
    "equipment_amount" DECIMAL(18,2) NOT NULL,
    "down_payment" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "financed_amount" DECIMAL(18,2) NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "preferred_type" "FinancingProductType",
    "purpose" TEXT,
    "company_profile" JSONB NOT NULL DEFAULT '{}',
    "business_snapshot" JSONB NOT NULL DEFAULT '{}',
    "equipment_snapshot" JSONB NOT NULL DEFAULT '{}',
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financing_applications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "application_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "application_submissions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "institution_org_id" UUID NOT NULL,
    "product_id" UUID,
    "match_score" INTEGER,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SENT',
    "decline_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "submission_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "business_org_id" UUID NOT NULL,
    "institution_org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "document_id" UUID,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "business_org_id" UUID NOT NULL,
    "product_id" UUID,
    "reference" TEXT NOT NULL,
    "financed_amount" DECIMAL(18,2) NOT NULL,
    "down_payment" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "duration_months" INTEGER NOT NULL,
    "rate_pct" DECIMAL(7,4) NOT NULL,
    "residual_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fees_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "installment_amount" DECIMAL(18,2) NOT NULL,
    "total_cost" DECIMAL(18,2) NOT NULL,
    "valid_until" DATE NOT NULL,
    "conditions" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'ISSUED',
    "issued_by_id" UUID NOT NULL,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");
CREATE INDEX "documents_organization_id_type_code_created_at_idx" ON "documents"("organization_id", "type_code", "created_at" DESC);
CREATE INDEX "documents_review_status_created_at_idx" ON "documents"("review_status", "created_at");
CREATE INDEX "financing_products_organization_id_idx" ON "financing_products"("organization_id");
CREATE INDEX "financing_products_is_active_product_type_idx" ON "financing_products"("is_active", "product_type");
CREATE UNIQUE INDEX "financing_applications_reference_key" ON "financing_applications"("reference");
CREATE UNIQUE INDEX "financing_applications_quotation_id_key" ON "financing_applications"("quotation_id");
CREATE INDEX "financing_applications_organization_id_created_at_idx" ON "financing_applications"("organization_id", "created_at" DESC);
CREATE UNIQUE INDEX "application_documents_application_id_document_id_key" ON "application_documents"("application_id", "document_id");
CREATE UNIQUE INDEX "application_submissions_application_id_institution_org_id_key" ON "application_submissions"("application_id", "institution_org_id");
CREATE INDEX "application_submissions_institution_status_idx" ON "application_submissions"("institution_org_id", "status", "created_at" DESC);
CREATE INDEX "submission_events_submission_id_created_at_idx" ON "submission_events"("submission_id", "created_at");
CREATE UNIQUE INDEX "offers_reference_key" ON "offers"("reference");
CREATE INDEX "offers_organization_id_created_at_idx" ON "offers"("organization_id", "created_at" DESC);
CREATE INDEX "offers_business_org_id_status_idx" ON "offers"("business_org_id", "status");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_code_fkey" FOREIGN KEY ("type_code") REFERENCES "document_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "financing_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "financing_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "financing_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "application_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "application_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "financing_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "financing_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below: constraints, sequences, Row-Level Security.
-- ---------------------------------------------------------------------------

ALTER TABLE documents ADD CONSTRAINT documents_size_check CHECK (size_bytes > 0);
ALTER TABLE financing_products
  ADD CONSTRAINT financing_products_amounts_check CHECK (min_amount >= 0 AND max_amount >= min_amount),
  ADD CONSTRAINT financing_products_duration_check CHECK (min_duration_months >= 1 AND max_duration_months >= min_duration_months),
  ADD CONSTRAINT financing_products_rates_check CHECK (indicative_rate_min >= 0 AND indicative_rate_max >= indicative_rate_min AND indicative_rate_max < 100),
  ADD CONSTRAINT financing_products_down_payment_check CHECK (min_down_payment_pct >= 0 AND min_down_payment_pct < 100);
ALTER TABLE financing_applications
  ADD CONSTRAINT financing_applications_amounts_check CHECK (down_payment >= 0 AND financed_amount > 0 AND financed_amount + down_payment = equipment_amount),
  ADD CONSTRAINT financing_applications_duration_check CHECK (duration_months BETWEEN 1 AND 240);
ALTER TABLE offers
  ADD CONSTRAINT offers_amounts_check CHECK (financed_amount > 0 AND down_payment >= 0 AND residual_value >= 0 AND fees_amount >= 0 AND installment_amount >= 0 AND total_cost >= 0),
  ADD CONSTRAINT offers_terms_check CHECK (duration_months BETWEEN 1 AND 240 AND rate_pct >= 0 AND rate_pct < 100);

CREATE SEQUENCE financing_application_ref_seq;
CREATE SEQUENCE offer_ref_seq;
GRANT USAGE ON SEQUENCE financing_application_ref_seq, offer_ref_seq TO tasheel_app;

-- Document types: global reference data, edited by Tasheel through the admin connection.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON document_types FROM tasheel_app;

-- Is the current organization an institution that received this application?
-- SECURITY DEFINER so the check does not recurse through the policies it serves.
CREATE FUNCTION app_institution_has_application(app_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (
          SELECT 1 FROM application_submissions s
          WHERE s.application_id = app_id AND s.institution_org_id = app_current_org()
            AND s.status <> 'WITHDRAWN') $$;
REVOKE ALL ON FUNCTION app_institution_has_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_institution_has_application(uuid) TO tasheel_app;

-- Documents: the owner organization; Tasheel staff (verification review); and an institution
-- only for the documents attached to an application submitted to it. Never the whole vault.
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_vault_select ON documents FOR SELECT
  USING (organization_id = app_current_org() OR app_is_platform() OR EXISTS (
    SELECT 1 FROM application_documents ad
    WHERE ad.document_id = documents.id AND app_institution_has_application(ad.application_id)));
CREATE POLICY documents_vault_insert ON documents FOR INSERT
  WITH CHECK (organization_id = app_current_org());
CREATE POLICY documents_vault_update ON documents FOR UPDATE
  USING (organization_id = app_current_org() OR app_is_platform())
  WITH CHECK (organization_id = app_current_org() OR app_is_platform());
REVOKE DELETE, TRUNCATE ON documents FROM tasheel_app;

-- Products: the institution owns them; active products of verified institutions are
-- readable by any signed-in organization (matching and simulation).
ALTER TABLE financing_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_select ON financing_products FOR SELECT
  USING (organization_id = app_current_org() OR app_is_platform() OR (
    is_active AND deleted_at IS NULL AND app_current_org() IS NOT NULL AND EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = financing_products.organization_id AND o.type = 'FINANCIAL_INSTITUTION'
        AND o.status = 'VERIFIED' AND o.deleted_at IS NULL)));
CREATE POLICY products_insert ON financing_products FOR INSERT
  WITH CHECK (organization_id = app_current_org());
CREATE POLICY products_update ON financing_products FOR UPDATE
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
REVOKE DELETE, TRUNCATE ON financing_products FROM tasheel_app;

-- Applications: the business; the institutions it was submitted to (read only); Tasheel staff.
ALTER TABLE financing_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY applications_select ON financing_applications FOR SELECT
  USING (organization_id = app_current_org() OR app_is_platform() OR app_institution_has_application(id));
CREATE POLICY applications_insert ON financing_applications FOR INSERT
  WITH CHECK (organization_id = app_current_org());
CREATE POLICY applications_update ON financing_applications FOR UPDATE
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());
REVOKE DELETE, TRUNCATE ON financing_applications FROM tasheel_app;

-- Attachments: written by the business (detaching allowed while the link is its own);
-- readable by the institutions that received the application.
ALTER TABLE application_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY appdocs_select ON application_documents FOR SELECT
  USING (organization_id = app_current_org() OR app_is_platform() OR app_institution_has_application(application_id));
CREATE POLICY appdocs_write ON application_documents FOR ALL
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

-- Submissions: the business and the institution addressed.
ALTER TABLE application_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY submissions_select ON application_submissions FOR SELECT
  USING (organization_id = app_current_org() OR institution_org_id = app_current_org() OR app_is_platform());
CREATE POLICY submissions_insert ON application_submissions FOR INSERT
  WITH CHECK (organization_id = app_current_org());
CREATE POLICY submissions_update ON application_submissions FOR UPDATE
  USING (organization_id = app_current_org() OR institution_org_id = app_current_org())
  WITH CHECK (organization_id = app_current_org() OR institution_org_id = app_current_org());
REVOKE DELETE, TRUNCATE ON application_submissions FROM tasheel_app;

-- Timeline: append-only, readable by both parties, written by either in its own name.
ALTER TABLE submission_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_select ON submission_events FOR SELECT
  USING (business_org_id = app_current_org() OR institution_org_id = app_current_org() OR app_is_platform());
CREATE POLICY events_insert ON submission_events FOR INSERT
  WITH CHECK (organization_id = app_current_org() AND organization_id IN (business_org_id, institution_org_id));
REVOKE UPDATE, DELETE, TRUNCATE ON submission_events FROM tasheel_app;

-- Offers: issued by the institution, decided by the business.
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY offers_select ON offers FOR SELECT
  USING (organization_id = app_current_org() OR business_org_id = app_current_org() OR app_is_platform());
CREATE POLICY offers_insert ON offers FOR INSERT
  WITH CHECK (organization_id = app_current_org());
CREATE POLICY offers_update ON offers FOR UPDATE
  USING (organization_id = app_current_org() OR business_org_id = app_current_org())
  WITH CHECK (organization_id = app_current_org() OR business_org_id = app_current_org());
REVOKE DELETE, TRUNCATE ON offers FROM tasheel_app;
