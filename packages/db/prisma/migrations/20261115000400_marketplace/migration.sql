-- CreateEnum
CREATE TYPE "EquipmentCondition" AS ENUM ('NEW', 'USED', 'REFURBISHED');

-- CreateEnum
CREATE TYPE "EquipmentAvailability" AS ENUM ('IN_STOCK', 'ON_ORDER', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EquipmentDocumentKind" AS ENUM ('BROCHURE', 'SPEC_SHEET', 'OTHER');

-- CreateEnum
CREATE TYPE "QuotationRequestStatus" AS ENUM ('OPEN', 'QUOTED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "equipment_categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "spec_schema" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_listings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "title" JSONB NOT NULL,
    "description" JSONB NOT NULL DEFAULT '{}',
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "condition" "EquipmentCondition" NOT NULL DEFAULT 'NEW',
    "price" DECIMAL(18,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "price_on_request" BOOLEAN NOT NULL DEFAULT false,
    "price_includes_vat" BOOLEAN NOT NULL DEFAULT false,
    "availability" "EquipmentAvailability" NOT NULL DEFAULT 'IN_STOCK',
    "lead_time_days" INTEGER,
    "delivery_wilayas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warranty_months" INTEGER,
    "specs" JSONB NOT NULL DEFAULT '{}',
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "status_reason" TEXT,
    "published_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "search_vector" tsvector,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "equipment_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_images" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "kind" "EquipmentDocumentKind" NOT NULL DEFAULT 'BROCHURE',
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favourites" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favourites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "supplier_org_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "listing_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "message" TEXT,
    "delivery_wilaya" VARCHAR(2),
    "status" "QuotationRequestStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "business_org_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "issued_by_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'DZD',
    "lines" JSONB NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "vat_rate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "valid_until" DATE NOT NULL,
    "delivery_terms" TEXT,
    "notes" TEXT,
    "status" "QuotationStatus" NOT NULL DEFAULT 'ISSUED',
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_categories_code_key" ON "equipment_categories"("code");

-- CreateIndex
CREATE INDEX "equipment_categories_parent_id_sort_order_idx" ON "equipment_categories"("parent_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_listings_reference_key" ON "equipment_listings"("reference");

-- CreateIndex
CREATE INDEX "equipment_listings_organization_id_status_created_at_idx" ON "equipment_listings"("organization_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "equipment_listings_status_category_id_price_idx" ON "equipment_listings"("status", "category_id", "price");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_images_storage_key_key" ON "equipment_images"("storage_key");

-- CreateIndex
CREATE INDEX "equipment_images_listing_id_sort_order_idx" ON "equipment_images"("listing_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_documents_storage_key_key" ON "equipment_documents"("storage_key");

-- CreateIndex
CREATE INDEX "equipment_documents_listing_id_idx" ON "equipment_documents"("listing_id");

-- CreateIndex
CREATE INDEX "favourites_organization_id_idx" ON "favourites"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "favourites_user_id_listing_id_key" ON "favourites"("user_id", "listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_requests_reference_key" ON "quotation_requests"("reference");

-- CreateIndex
CREATE INDEX "quotation_requests_organization_id_created_at_idx" ON "quotation_requests"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "quotation_requests_supplier_org_id_status_created_at_idx" ON "quotation_requests"("supplier_org_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "quotations_reference_key" ON "quotations"("reference");

-- CreateIndex
CREATE INDEX "quotations_organization_id_created_at_idx" ON "quotations"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "quotations_business_org_id_status_created_at_idx" ON "quotations"("business_org_id", "status", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "equipment_categories" ADD CONSTRAINT "equipment_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "equipment_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_listings" ADD CONSTRAINT "equipment_listings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_listings" ADD CONSTRAINT "equipment_listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "equipment_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_images" ADD CONSTRAINT "equipment_images_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "equipment_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_documents" ADD CONSTRAINT "equipment_documents_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "equipment_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "equipment_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_requests" ADD CONSTRAINT "quotation_requests_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "equipment_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "quotation_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "equipment_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Hand-written below: constraints, search, reference sequences, Row-Level Security.
-- =============================================================================

-- Sanity bounds (real business limits live in data, not here).
ALTER TABLE equipment_listings
  ADD CONSTRAINT equipment_listings_price_check CHECK (price IS NULL OR price >= 0),
  ADD CONSTRAINT equipment_listings_year_check CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
  ADD CONSTRAINT equipment_listings_title_check CHECK (coalesce(title->>'fr', '') <> '' OR coalesce(title->>'ar', '') <> '');
ALTER TABLE quotation_requests ADD CONSTRAINT quotation_requests_quantity_check CHECK (quantity BETWEEN 1 AND 10000);
ALTER TABLE quotations
  ADD CONSTRAINT quotations_amounts_check CHECK (subtotal >= 0 AND vat_amount >= 0 AND total >= 0 AND vat_rate >= 0 AND vat_rate < 100);

-- Human references: EQ-2026-000123, QR-…, QT-…
CREATE SEQUENCE equipment_listing_ref_seq;
CREATE SEQUENCE quotation_request_ref_seq;
CREATE SEQUENCE quotation_ref_seq;
GRANT USAGE, SELECT ON SEQUENCE equipment_listing_ref_seq, quotation_request_ref_seq, quotation_ref_seq TO tasheel_app;

-- ---------------------------------------------------------------------------
-- Full-text search over French and Arabic titles/descriptions, brand and model.
-- 'simple' configuration + unaccent works for both languages (no stemming), and
-- prefix queries (to_tsquery 'word:*') give search-as-you-type.
-- unaccent is a trusted extension: the database owner can create it.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE FUNCTION equipment_listing_search_update() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', unaccent(lower(coalesce(NEW.title->>'fr', '') || ' ' || coalesce(NEW.title->>'ar', '')))), 'A') ||
    setweight(to_tsvector('simple', unaccent(lower(coalesce(NEW.brand, '') || ' ' || coalesce(NEW.model, '') || ' ' || NEW.reference))), 'B') ||
    setweight(to_tsvector('simple', unaccent(lower(coalesce(NEW.description->>'fr', '') || ' ' || coalesce(NEW.description->>'ar', '')))), 'C');
  RETURN NEW;
END $$;

CREATE TRIGGER equipment_listings_search
  BEFORE INSERT OR UPDATE OF title, description, brand, model, reference ON equipment_listings
  FOR EACH ROW EXECUTE FUNCTION equipment_listing_search_update();

CREATE INDEX equipment_listings_search_idx ON equipment_listings USING GIN (search_vector);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

-- Categories and settings: global reference data. Read-only for the app, except settings,
-- which the API updates only for holders of admin.settings.manage.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON equipment_categories FROM tasheel_app;
REVOKE DELETE, TRUNCATE ON platform_settings FROM tasheel_app;

-- Listings: published ones are public (anonymous visitors included); drafts and the rest
-- belong to the supplier. The platform sees everything for moderation.
ALTER TABLE equipment_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY listings_select ON equipment_listings FOR SELECT
  USING ((status = 'PUBLISHED' AND deleted_at IS NULL) OR organization_id = app_current_org() OR app_is_platform());

CREATE POLICY listings_insert ON equipment_listings FOR INSERT
  WITH CHECK (organization_id = app_current_org());

CREATE POLICY listings_update ON equipment_listings FOR UPDATE
  USING (organization_id = app_current_org() OR app_is_platform())
  WITH CHECK (organization_id = app_current_org() OR app_is_platform());

-- Views are counted on public pages by any visitor, through a function that touches only
-- view_count (a visitor must never be able to update anything else).
CREATE FUNCTION app_count_listing_view(listing uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public
  AS $$ UPDATE equipment_listings SET view_count = view_count + 1
        WHERE id = listing AND status = 'PUBLISHED' AND deleted_at IS NULL $$;
REVOKE ALL ON FUNCTION app_count_listing_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_count_listing_view(uuid) TO tasheel_app;

REVOKE DELETE, TRUNCATE ON equipment_listings FROM tasheel_app;

-- Images and documents follow their listing.
ALTER TABLE equipment_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY images_select ON equipment_images FOR SELECT
  USING (organization_id = app_current_org() OR app_is_platform() OR EXISTS (
    SELECT 1 FROM equipment_listings l WHERE l.id = listing_id AND l.status = 'PUBLISHED' AND l.deleted_at IS NULL));
CREATE POLICY images_write ON equipment_images FOR ALL
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

ALTER TABLE equipment_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY documents_select ON equipment_documents FOR SELECT
  USING (organization_id = app_current_org() OR app_is_platform() OR EXISTS (
    SELECT 1 FROM equipment_listings l WHERE l.id = listing_id AND l.status = 'PUBLISHED' AND l.deleted_at IS NULL));
CREATE POLICY documents_write ON equipment_documents FOR ALL
  USING (organization_id = app_current_org())
  WITH CHECK (organization_id = app_current_org());

-- Favourites: private to the user, inside their organization.
ALTER TABLE favourites ENABLE ROW LEVEL SECURITY;
CREATE POLICY favourites_own ON favourites FOR ALL
  USING (organization_id = app_current_org() AND user_id = app_current_user())
  WITH CHECK (organization_id = app_current_org() AND user_id = app_current_user());

-- Quotation requests: the business that asked and the supplier asked. Nobody else.
ALTER TABLE quotation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY qr_select ON quotation_requests FOR SELECT
  USING (organization_id = app_current_org() OR supplier_org_id = app_current_org() OR app_is_platform());
CREATE POLICY qr_insert ON quotation_requests FOR INSERT
  WITH CHECK (organization_id = app_current_org());
CREATE POLICY qr_update ON quotation_requests FOR UPDATE
  USING (organization_id = app_current_org() OR supplier_org_id = app_current_org())
  WITH CHECK (organization_id = app_current_org() OR supplier_org_id = app_current_org());
REVOKE DELETE, TRUNCATE ON quotation_requests FROM tasheel_app;

-- Quotations: the supplier that issued and the business addressed. Never deleted.
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY quotations_select ON quotations FOR SELECT
  USING (organization_id = app_current_org() OR business_org_id = app_current_org() OR app_is_platform());
CREATE POLICY quotations_insert ON quotations FOR INSERT
  WITH CHECK (organization_id = app_current_org());
CREATE POLICY quotations_update ON quotations FOR UPDATE
  USING (organization_id = app_current_org() OR business_org_id = app_current_org())
  WITH CHECK (organization_id = app_current_org() OR business_org_id = app_current_org());
REVOKE DELETE, TRUNCATE ON quotations FROM tasheel_app;

-- Moderation is off by default; the admin can switch it on.
INSERT INTO platform_settings (key, value, updated_at) VALUES ('marketplace.moderation', 'false', now());
