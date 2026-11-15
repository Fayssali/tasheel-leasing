# M3 — Document vault and financing applications

## Purpose

A business turns an accepted quotation into a financing application, chooses which financial institutions receive it, answers their questions and compares their proposals. Institutions publish products with their own criteria and indicative rates, review the files they receive and make proposals. Tasheel carries the file and computes figures consistently. It never approves, scores creditworthiness or decides.

## Document vault

|           |                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types     | `document_types` (reference data): who provides each type, whether it is required for verification (per organization type) or for any application, whether it expires. Seeded from `@tasheel/shared/documents`, then owned by the database.                                                                                                                       |
| Upload    | PDF, JPEG or PNG, decided from the file's bytes; 15 MB; SHA-256 stored.                                                                                                                                                                                                                                                                                           |
| Antivirus | `Scanner` port. `SCAN_MODE=clamav` streams the file to clamd (INSTREAM over TCP); infected files are refused, never stored, and the attempt is audited. If clamd is unreachable the upload is refused. `SCAN_MODE=off` is development only (documents marked _not scanned_); production refuses to start without `clamav`. Listing PDFs go through the same scan. |
| Versions  | Never deleted. A new upload with `replacesId` supersedes the previous one.                                                                                                                                                                                                                                                                                        |
| Review    | Tasheel staff (`admin.document.review`) accept or ask to replace each verification paper, with a reason that is emailed and audited. The organization's verification decision itself stays the admin action from Phase 1.                                                                                                                                         |
| Access    | See ADR 0003: the owner, Tasheel staff, and an institution only for documents attached to an application submitted to it, until the business withdraws. Downloads by another organization are audited in the downloader's log.                                                                                                                                    |

## Products (institutions)

Each product records amounts, durations, minimum down payment, eligible categories and wilayas, minimum years in business, an indicative annual rate range and extra required documents. Only active products of verified institutions are visible to businesses.

## Application lifecycle

```
DRAFT ──submit (chosen products)──▶ SUBMITTED ──accept an offer──▶ OFFER_ACCEPTED
  │                                    │
  └──────────── withdraw ──────────────┴──▶ WITHDRAWN
```

Per institution (`application_submissions`):

```
SENT ─open─▶ UNDER_REVIEW ─request info─▶ INFO_REQUESTED ─reply─▶ UNDER_REVIEW
                  │                                                    │
                  ├──────────── offer ──▶ OFFER_MADE ◀─────────────────┘
                  └──── decline (reason) ──▶ DECLINED
another offer accepted ──▶ CLOSED        business withdraws ──▶ WITHDRAWN
```

- An application starts from an **accepted** quotation (one application per quotation). Amounts: equipment = quotation total; financed = equipment − down payment.
- **Indicative matching**: for each active product, the share of its published criteria the application meets (amount, duration, down payment, category, wilaya, seniority, and product type when the business states a preference), plus an installment range at the product's minimum and maximum indicative rates. Labelled indicative everywhere.
- **Submission** needs a verified business, one product per institution, and the required documents attached and not expired: those the platform requires for any application plus each chosen product's. The business's identity (legal name, NIF, RC, NIS, wilaya) is snapshotted at submission, since business profiles are otherwise private.
- **Offers**: the institution enters amount, down payment, duration, annual rate or margin, residual value, fees, validity and conditions. The constant monthly installment and the total cost are computed (`computeInstallment`, `computeTotalCost`, integer centimes, checked against 60-digit decimals). A new offer replaces the institution's previous open one. Past their date, offers are treated as expired. Only holders of `offer.issue` (institution admins by default) issue offers; analysts review.
- **Decision**: accepting one offer declines the other open offers and closes the other submissions. The chosen institution then continues directly with the business for its final decision and contract.
- Every step writes to an append-only timeline shared by the two parties, to the audit log, and sends an email in each recipient's language.

## API

| Route                                                                                                                                                                                                                                                                                            | Permission                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `GET/POST /documents`, `GET /documents/:id/file` (RLS decides who)                                                                                                                                                                                                                               | `document.manage` (download: also `application.review`, `admin.document.review`) |
| `GET /admin/organizations/:id/documents`, `POST /admin/documents/:id/accept`, `…/reject`                                                                                                                                                                                                         | `admin.document.review`                                                          |
| `GET/POST /institution/products`, `PUT /institution/products/:id`, `GET /institution/products/document-types`                                                                                                                                                                                    | `product.manage`                                                                 |
| `GET /applications`, `GET /applications/eligible-quotations`, `POST /applications`, `GET/PUT /applications/:id`, `POST/DELETE …/documents`, `GET …/matches`, `POST …/submit`, `POST …/withdraw`, `POST /applications/submissions/:id/reply`, `POST /applications/offers/:id/accept`, `…/decline` | `application.manage`                                                             |
| `GET /institution/applications`, `GET …/:id`, `POST …/:id/request-info`, `POST …/:id/decline`                                                                                                                                                                                                    | `application.review`                                                             |
| `POST /institution/applications/:id/offers`, `POST /institution/applications/offers/:id/withdraw`                                                                                                                                                                                                | `application.review` + `offer.issue`                                             |

## Tests

- SQL isolation checks 21–26; Prisma-level cases in `packages/db/test/tenant-isolation.test.ts`.
- Shared: installment, total cost and matching (`packages/shared/src/financing.test.ts`).
- API: vault and ClamAV protocol against a fake clamd, financing rules, HTTP boundaries.
- Integration on PostgreSQL (CI): `apps/api/test-int/financing.int-spec.ts`.
