# M4 — Commissions, invoicing, notifications and reporting

## Purpose

Tasheel earns a commission when a deal concluded through the platform is accepted: a supplier
pays on an accepted quotation, a financial institution pays on an accepted financing proposal.
Tasheel invoices those commissions monthly and records payments. Users get an in-app record of
every email the platform sends them, and each side sees its own activity figures.

Tasheel invoices **its own service** (intermediation). It never invoices equipment, collects
lease payments or handles the financing itself.

## Commission rules (configuration, not code)

No rate, fee, VAT rate or prefix is written in the code. Everything comes from
`commission_rules` and the `billing.settings` platform setting, edited by Tasheel staff
(`admin.billing.manage`, super administrator only).

| Field      | Meaning                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger    | `QUOTATION_ACCEPTED` (paid by the supplier) or `OFFER_ACCEPTED` (paid by the institution)                                               |
| Payer      | one organization (a negotiated contract) or every organization of that kind                                                             |
| Basis      | percentage of the deal (quotation subtotal excl. VAT, or financed amount) with optional minimum and maximum, or a fixed amount per deal |
| Categories | optional: restrict the rule to equipment categories                                                                                     |
| Validity   | from / until (dates), active flag                                                                                                       |

When several rules apply on the day of acceptance: an organization-specific rule wins over a
general one, then a category-limited one, then the most recent start date. With no rule, no
commission is due. Payers see the rules that apply to them under _Billing → Terms_.

## Accrual

`app_accrue_commission(source_type, source_id)` runs **inside the transaction that accepts the
quotation or offer**, so a deal can never be accepted without its commission being computed
(or deliberately not, when no rule applies). It is a security-definer function, because the
payer is not the organization that accepts; it acts only on accepted sources the caller is a
party to and is idempotent (one commission per source). When a rule is created after deals
were accepted, staff run _Compute missing commissions_ (`app_accrue_missing_commissions()`,
platform only).

Commission statuses: `ACCRUED` → `INVOICED` → (`CANCELLED` if its invoice is credited and staff
choose not to bill it again).

## Invoices and credit notes

```
DRAFT ──issue──▶ ISSUED ──record payment──▶ PAID
  │                 │                          │
  └─discard         └──────credit note─────────┴──▶ CANCELLED (+ a CREDIT_NOTE document)
```

- **Drafts.** _Prepare invoices_ groups each payer's uninvoiced commissions up to a date into
  one draft. Drafts are internal: payers never see them. Discarding a draft releases its
  commissions.
- **Issue.** The issuer identity, customer identity (legal name, RC, NIF, NIS, tax article,
  address), VAT rate and payment terms are **frozen on the invoice** at that moment, and it
  gets its final number. VAT is computed once on the subtotal (half away from zero).
- **Numbering.** Continuous per calendar year, `{prefix}-{year}-{000000}`, taken from
  `invoice_counters` inside the issuing transaction, so there are no gaps and no duplicates.
  Invoices and credit notes share the sequence, each with its own prefix.
- **Payment.** Staff record the date and reference (transfer, cheque). There is no payment
  integration.
- **Correction.** An issued invoice is never edited or deleted. A credit note repeats every
  line with the opposite sign and cancels the invoice; its commissions either return to
  "to invoice" (to be billed again, corrected) or are cancelled.
- **Overdue** is computed from the due date, not stored.
- **Printing.** The invoice page prints cleanly (navigation hidden) and can be saved as PDF
  from the browser.

The legal mentions printed (RC, NIF, NIS, article d'imposition, RIB) follow common Algerian
practice; the exact requirements for Tasheel's invoices must be confirmed by its accountant
before the first real invoice.

## Notifications

Every email the platform sends is also stored as a notification for its recipient
(`notifications`, keyed to the user, readable only by that user across all their
organizations). The centre shows unread items first, links to the relevant page and lets the
user mark items as read. Notifications are written with plain inserts in a system context
(RLS would otherwise refuse the read-back of a row for another user).

## Reporting

| Who                   | Endpoint                | Figures                                                                                                                                                                                         |
| --------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplier              | `GET /reports/overview` | published listings and views, quotation requests awaiting, acceptance rate, accepted value (excl. VAT), commissions to invoice, invoices due, requests per month                                |
| Business              | same                    | requests sent, quotations received and accepted, applications sent and drafts, proposals received and accepted                                                                                  |
| Financial institution | same                    | applications to handle, proposal acceptance rate, average time to first proposal, financed volume, commissions, invoices due, applications per month                                            |
| Tasheel staff         | `GET /admin/reports`    | listings, requests, accepted value, financed volume, commissions to invoice, receivables, overdue, collected (cash received, even if later credited), financed volume and commissions per month |

Every query runs under the caller's tenant context, so RLS bounds what is counted. Monthly
series always cover the last six calendar months, with zero for empty months.

## Permissions

| Permission             | Who                                               |
| ---------------------- | ------------------------------------------------- |
| `admin.billing.manage` | Tasheel super administrator                       |
| `billing.read`         | supplier administrator, institution administrator |

## Tests

- SQL RLS suite: checks 27–32 (settings writable by staff only, rule visibility, accrual by a
  party only, commissions, invoices and notifications isolation).
- Unit: totals and rounding, accrual call inside the accepting transaction, numbering,
  issue/credit flows.
- Integration (PostgreSQL + RLS): settings → rule → accepted quotation → commission → draft →
  issued invoice → payment → credit note, with notification and report checks.
