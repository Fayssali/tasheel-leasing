# Phase 1 demo script — Foundation

About 15 minutes, on a local machine or the demo server. All data is fictional.

## Setup

```bash
pnpm install && cp .env.example .env
pnpm infra:up && pnpm db:migrate && pnpm db:seed
pnpm dev            # web http://localhost:5173 · Mailpit http://localhost:8025
```

Keep Mailpit open in a second tab: every email the platform sends lands there. Have an authenticator app ready on a phone.

## 1. A business signs up (French)

1. Open http://localhost:5173 → **Créer un compte** → type **Entreprise**.
2. Fill in the organization (fictional values) and the administrator, accept the terms, submit.
3. Show the dashboard: the onboarding steps, the "pending verification" banner and the "confirm your email" banner.
4. In Mailpit, open the verification email (French, with the intermediary disclaimer) and click the link: the email banner disappears.
5. **Organisation**: complete RC, NIF, wilaya and address. The "complete the profile" step is ticked.

## 2. Team

1. **Équipe → Inviter un membre**, role _Collaborateur_.
2. In Mailpit, open the invitation and accept it in a private window by creating the colleague's account.
3. Back as the owner: change the colleague's role, disable them, re-enable them.
4. Point out the guard rails: the owner cannot disable themselves, and the last administrator cannot be removed.

## 3. Tasheel staff verify the organization

1. Sign out. Sign in as the demo platform admin (`admin@demo.tasheel.local`, password from `SEED_DEMO_PASSWORD`).
2. The admin is sent to **Sécurité**: 2FA is mandatory for Tasheel staff. Scan the QR code, enter the code and save the recovery codes.
3. **Vue d'ensemble**: KPIs, with pending verifications highlighted.
4. **File de vérification** → open the business → check the file → **Vérifier**.
5. Show the decision in **Historique**, and the "organisation vérifiée" email in Mailpit.
6. Optionally reject a second organization with a reason and show the email and the business's red banner.

## 4. Arabic and right-to-left

Switch the language to **العربية** anywhere: the whole interface mirrors (sidebar on the right, aligned tables), and emails go out in Arabic for Arabic-speaking users.

## 5. Security talking points

- Each company's data is isolated in the database itself (Row-Level Security), not only by the application. 12 automated checks run on every change.
- 2FA is mandatory for Tasheel staff and bank users. Secrets are encrypted, and codes cannot be replayed.
- Every important action is in the audit log, which cannot be modified.
- Tasheel never presents itself as a lender. The disclaimer is on every page and in every email.

## Known limits in Phase 1

- No marketplace, applications or offers yet (Phases 2–4).
- No document upload yet: verification is based on the declared identifiers.
- Wilaya is a 2-digit code; a reference list comes with the marketplace filters.
