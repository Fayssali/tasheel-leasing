# M2 — Marketplace and quotations

## Purpose

Verified suppliers publish equipment. Anyone can browse. Verified businesses ask suppliers for quotations and accept one, which later feeds a financing application (Phase 3). Tasheel carries the exchange. Prices, VAT rates and terms are the supplier's.

## Data

| Table                                     | Owner (`organization_id`) | Who else can read                                                                    |
| ----------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `equipment_categories`                    | none (global)             | everyone; admin only writes                                                          |
| `equipment_listings`                      | supplier                  | everyone when `PUBLISHED`; Tasheel staff; businesses that asked a quotation about it |
| `equipment_images`, `equipment_documents` | supplier                  | same as their listing                                                                |
| `favourites`                              | business                  | the user who saved it only                                                           |
| `quotation_requests`                      | business                  | the supplier it is addressed to (`supplier_org_id`)                                  |
| `quotations`                              | supplier                  | the business it is addressed to (`business_org_id`)                                  |
| `platform_settings`                       | none (global)             | everyone reads; Tasheel staff write                                                  |

Commercial records (listings, requests, quotations) are never deleted by the application role. References come from PostgreSQL sequences: `EQ-2026-000123`, `QR-…`, `QT-…`.

## Listing lifecycle

```
DRAFT ──publish──▶ PUBLISHED            (moderation off)
DRAFT ──publish──▶ PENDING_REVIEW ──approve──▶ PUBLISHED
                                 └─reject (reason)─▶ REJECTED ──edit──▶ DRAFT
PUBLISHED ──withdraw by Tasheel (reason)──▶ REJECTED
any (except ARCHIVED) ──archive──▶ ARCHIVED ──restore──▶ DRAFT
```

Publishing requires: a verified supplier, at least one photo, and a price or "price on request". The switch `marketplace.moderation` is stored in `platform_settings` and changed from the admin console (permission `admin.settings.manage`); every change is audited.

## Files

- Photos: JPEG, PNG or WebP, 5 MB, 10 per listing. PDF documents: 15 MB, 5 per listing.
- The type is read from the first bytes of the file; the name and declared type are ignored.
- Stored in a private S3 bucket under `org/<orgId>/listings/<listingId>/…`. Files are served by the API only after the RLS check on the row; there are no public bucket URLs.

## Search

A trigger maintains `search_vector` (titles and descriptions weighted A/C, brand/model/reference B) with `unaccent` and the `simple` configuration, so French and Arabic both work. Free text becomes a prefix query (`pelle:* & 22:*`); operators typed by users are stripped. Filters: category, condition, supplier wilaya, price range, supplier. Sorts: relevance (with text), newest, price.

## Quotations

1. A business (verified, permission `quotation.request`) asks for a quotation on a published listing: quantity, message, delivery wilaya. The supplier sees the business and requester names (a snapshot, since business profiles are private).
2. The supplier (permission `quotation.respond`) issues a quotation: lines, **its own VAT rate**, validity date, delivery terms. Totals are computed in integer centimes (`computeQuotationTotals`), VAT rounded half up to the centime. A new quotation withdraws the previous open one.
3. The business accepts (the request closes) or declines. The supplier can withdraw an open quotation; the business can cancel its request. A quotation past its date is shown and treated as `EXPIRED`.

Emails (FR / AR / EN, in each recipient's language): new request to the supplier's responders, quotation received, accepted, declined.

## API

| Route                                                                                                                            | Access                   |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `GET /marketplace/categories`, `/listings`, `/listings/:reference`, `/suppliers/:id`, `/images/:id`, `/documents/:id`            | public                   |
| `GET/POST /supplier/listings`, `GET/PUT /supplier/listings/:id`, `POST …/submit`, `…/archive`, `…/restore`, images and documents | `listing.manage`         |
| `GET/POST/DELETE /favourites`                                                                                                    | `favourite.manage`       |
| `GET/POST /quotation-requests`, `POST …/:id/cancel`, `POST …/quotations/:id/accept`, `…/decline`                                 | `quotation.request`      |
| `GET /supplier/quotation-requests`, `POST …/:id/quotations`, `POST …/quotations/:id/withdraw`                                    | `quotation.respond`      |
| `GET /admin/listings`, `POST /admin/listings/:id/approve`, `…/reject`, `…/unpublish`, `GET /admin/settings/marketplace`          | `admin.listing.moderate` |
| `PUT /admin/settings/marketplace/moderation`                                                                                     | `admin.settings.manage`  |

## Tests

- SQL isolation checks 13–20 (`packages/db/test/rls`).
- Unit and HTTP: upload checks, spec validation, search query, listing lifecycle, quotation rules, route boundaries (`apps/api/test`).
- Integration on PostgreSQL (CI): `apps/api/test-int/marketplace.int-spec.ts`.
