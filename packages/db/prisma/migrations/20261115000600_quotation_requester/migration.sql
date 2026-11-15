-- AlterTable
ALTER TABLE "quotation_requests" ADD COLUMN     "business_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "requester_name" TEXT NOT NULL DEFAULT '';

-- A business keeps seeing the listings it asked quotations for, even after the supplier
-- archives them (its quotation history must stay readable).
CREATE POLICY listings_select_requested ON equipment_listings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM quotation_requests r
    WHERE r.listing_id = equipment_listings.id AND r.organization_id = app_current_org()
  ));
