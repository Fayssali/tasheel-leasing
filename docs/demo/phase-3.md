# Phase 3 demo — Documents and financing

All companies, people, figures and documents are fictional. Rates and fees are invented examples entered "by the banks".

## Setup (local)

```bash
pnpm infra:up                 # add "--profile scan" to the compose command to start ClamAV
pnpm db:deploy                # migrations up to 0700
pnpm db:seed                  # adds 3 banks' products, papers, a submitted application with offers, a draft
pnpm dev
```

To see real antivirus scanning, start ClamAV (`docker compose -f infra/docker/docker-compose.yml --profile scan up -d`) and set `SCAN_MODE=clamav` in `.env`. Without it, documents show "not scanned (development environment)".

| Role                             | Email                          | Note                                |
| -------------------------------- | ------------------------------ | ----------------------------------- |
| Business — Djurdjura TP          | entreprise2@demo.tasheel.local | application with two offers         |
| Business — Clinique Les Palmiers | entreprise3@demo.tasheel.local | draft application                   |
| Bank — Hodna Leasing             | banque@demo.tasheel.local      | 2FA setup required on first sign-in |
| Bank — Banque Fictive du Sahel   | banque2@demo.tasheel.local     | 2FA setup required                  |
| Bank — Crédit Populaire Fictif   | banque3@demo.tasheel.local     | 2FA setup required                  |
| Tasheel admin                    | admin@demo.tasheel.local       | 2FA setup required                  |

Password: `SEED_DEMO_PASSWORD` (default `Demo-Tasheel-2026!`). Emails: Mailpit, http://localhost:8025.

## Script (about 20 minutes)

1. **Documents.** As the Clinique → _Documents_: the two checklists (verification; financing applications) come from the database. Upload the missing CNAS certificate with an expiry date. Replace a document and note that the old version is kept. With ClamAV on, upload the EICAR test file: refused, and the attempt appears in the audit log.
2. **Draft application.** _Financing_ → the draft. Read the indicative matching: each bank's product shows the criteria met and an installment range, labelled indicative. Attach the missing papers from the vault (or upload one directly). Tick two banks and send. If a required document is missing, the message names it.
3. **Bank review.** As Banque Fictive du Sahel → _Applications received_ → open it: it moves to "under review" and the business sees "file opened" on its timeline. The bank sees only the attached documents. Request information.
4. **Reply.** As the Clinique, answer the request. The bank is notified.
5. **Offer.** As the bank, _Make a proposal_: enter the rate, fees and residual value; the installment and total cost update as you type. Send.
6. **Comparison.** As Djurdjura → _Financing_ → its application: two proposals side by side with the lowest total cost flagged, and a declined submission with its reason. Accept one: the other is declined automatically, the remaining bank's submission is closed, and the chosen bank is told to continue directly with the business for its final decision and contract.
7. **Isolation spot-check.** As Crédit Populaire Fictif, open _Applications received_: the Clinique application (not sent to it) is absent. Withdraw an application as a business: the banks lose access to its documents immediately.
8. **Verification papers.** As the Tasheel admin → _Organizations_ → Djurdjura: accept or ask to replace each paper with a reason (emailed). Check the audit log for document, application and offer events.

## Acceptance checklist

- [ ] Vault: checklists, upload, replacement, download, antivirus behaviour
- [ ] Application from an accepted quotation, indicative matching, required documents enforced
- [ ] Bank inbox, information request and reply, decline with reason
- [ ] Offers computed from the bank's terms; comparison; acceptance closes the others
- [ ] Institutions see only what was sent to them; withdrawal cuts access
- [ ] Wording: proposals, indicative, decision of the institution; never an approval by Tasheel
- [ ] French and Arabic, desktop and mobile
