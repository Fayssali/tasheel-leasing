# Phase 2 demo — Marketplace

All companies, people, products and prices are fictional.

## Setup (local)

```bash
pnpm infra:up          # Postgres, Redis, MinIO, Mailpit
pnpm db:deploy         # applies migrations up to 0600
pnpm db:seed           # demo organizations + marketplace demo (placeholder photos go to MinIO)
pnpm dev               # API on :3000, web on :5173
```

Password for every demo user: the value of `SEED_DEMO_PASSWORD` (default `Demo-Tasheel-2026!`). Emails arrive in Mailpit at http://localhost:8025.

| Role                      | Email                                                          |
| ------------------------- | -------------------------------------------------------------- |
| Tasheel admin             | admin@demo.tasheel.local (2FA setup required on first sign-in) |
| Supplier — Atlas Machines | fournisseur@demo.tasheel.local                                 |
| Supplier — Sahel Agri     | fournisseur2@demo.tasheel.local                                |
| Supplier — MediTech       | fournisseur3@demo.tasheel.local                                |
| Business — Tassili Agro   | entreprise@demo.tasheel.local                                  |
| Business — Djurdjura TP   | entreprise2@demo.tasheel.local                                 |

## Script (about 15 minutes)

1. **Browse without an account.** Open `/marketplace`. Search "pelle", then "tracteur". Filter by category and price, then sort by price. Switch to Arabic and check the layout mirrors. Open an equipment page: gallery, specifications, documents, supplier link. Note "Sign in to request a quotation".
2. **Supplier creates a listing.** Sign in as Atlas Machines → _My catalogue_ → _New listing_. Pick "BTP", and the specification fields change with the category. Save the draft, add two photos and reorder them, add a PDF. Try uploading a renamed `.txt` as a photo: refused. Click _Publish_: it appears on the marketplace immediately.
3. **Moderation.** Sign in as the Tasheel admin → _Listing moderation_. Turn review on. As the supplier, publish another draft: it goes to _Under review_. As admin, reject it with a reason. The supplier sees the reason on the listing. Turn review off again.
4. **Quotation.** As Tassili Agro, open the new listing → _Request a quotation_ (quantity 2, a message). Mailpit shows the email to the supplier. As the supplier → _Quotation requests_ → _Issue a quotation_: add a transport line, enter the VAT rate (the supplier types it; Tasheel does not set it) and a date. The totals preview updates as you type. Send.
5. **Decision.** As Tassili Agro → _My quotations_: lines, subtotal, VAT and total. Accept. The supplier receives the acceptance email. The message notes that financing from this quotation comes in Phase 3.
6. **Isolation spot-check.** As Sahel Agri, open _Quotation requests_: nothing from Atlas Machines is visible. Archive a listing as Atlas: it disappears from search, but Tassili's quotation history still shows it.
7. **Audit.** As admin → _Audit log_: listing publication, moderation decisions, quotation events, the settings change.

## Acceptance checklist

- [ ] Search, filters and equipment pages work in FR and AR, on desktop and mobile
- [ ] Supplier can create, illustrate, publish and archive a listing
- [ ] Moderation switch and decisions behave as described, with reasons
- [ ] Quotation request → quotation → acceptance, with the three emails
- [ ] No supplier sees another supplier's requests or drafts
- [ ] Wording never presents Tasheel as a seller, bank or lender
