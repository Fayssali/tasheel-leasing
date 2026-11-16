# Phase 4 demo — Commissions, invoicing, notifications and reporting

Everything is fictional: the issuer "Tasheel Leasing SPA (fictif)", its identifiers and RIB,
the 2 % supplier commission and the 150 000 DZD institution fee are demo configuration typed
in as an administrator would. None of them is a platform default.

## Setup (local)

```bash
pnpm infra:up
pnpm db:deploy                # migrations up to 0800
pnpm db:seed                  # adds billing settings, two demo rules and the commissions they produce
pnpm dev
```

| Role                      | Email                           | Note                                  |
| ------------------------- | ------------------------------- | ------------------------------------- |
| Tasheel admin             | admin@demo.tasheel.local        | billing, platform report              |
| Supplier — Atlas Machines | fournisseur@demo.tasheel.local  | has an accepted quotation (Djurdjura) |
| Supplier — MediTech       | fournisseur3@demo.tasheel.local | has an accepted quotation (Clinique)  |
| Business — Djurdjura TP   | entreprise2@demo.tasheel.local  | application with two proposals        |
| Bank — Hodna Leasing      | banque@demo.tasheel.local       | made a proposal to Djurdjura          |

Password: `SEED_DEMO_PASSWORD` (default `Demo-Tasheel-2026!`). Emails: Mailpit, http://localhost:8025.

## Script (about 20 minutes)

1. **Configuration.** As the admin → _Billing → Settings_: issuer identity, VAT rate, payment
   terms and numbering prefixes, all editable, none hardcoded. _Rules_: the supplier
   percentage (with minimum and maximum) and the institution flat fee. Open _New rule_ and
   show the options: specific payer, categories, validity; read the precedence note.
2. **Commissions.** _Commissions_: two lines "to invoice", one per supplier, each showing the
   deal reference, the base, the rate and the amount. They were computed when the quotations
   were accepted.
3. **A new commission in real time.** As Djurdjura → _Financing_ → its application → accept a
   proposal. Back as the admin, _Commissions_: the institution's flat fee appears immediately.
4. **Invoices.** _Invoices → Prepare invoices_ up to today: one draft per payer. Open a draft
   (no number yet, identity not frozen), then _Issue_: it gets `DEMO-2026-000001`, the issuer
   and customer identities are frozen on it. The supplier receives an email and a notification.
5. **Payer side.** As Atlas → _Notifications_ (unread badge) → the invoice. _Billing_: its
   invoices, its commissions per deal, and the terms that apply to it. _Print / PDF_.
   Switch to Arabic: the invoice reads right to left, identifiers and dates stay readable.
6. **Payment and correction.** As the admin, record the payment with a transfer reference. On
   the other invoice, issue a credit note with a reason: a numbered `DEMO-AV-…` document
   mirrors it, the invoice becomes cancelled, and you choose whether its commissions go back
   to "to invoice". Nothing is deleted.
7. **Activity.** Dashboards: Atlas (listings, requests awaiting, acceptance rate, amounts due,
   requests per month), Hodna (applications to handle, time to first proposal, financed
   volume) and the admin overview (receivables, overdue, collected, monthly volumes).
8. **Isolation spot-check.** As MediTech, _Billing_ shows only its own commission and
   invoice; as a business, the _Billing_ menu does not exist.

## Acceptance checklist

- [ ] No commission rate, fee, VAT rate or numbering prefix exists outside the admin screens
- [ ] Accepting a quotation or a proposal accrues the commission in the same step
- [ ] Draft → issue → payment, with frozen identities and continuous numbering
- [ ] Credit note instead of deletion; commissions released or cancelled
- [ ] Payers see their own invoices, commissions and terms only
- [ ] Notification centre mirrors the emails, with unread count
- [ ] Dashboards per organization type and platform report, in FR, AR and EN
