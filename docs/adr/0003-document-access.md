# ADR 0003 — Who can read a business's documents

- Status: Accepted (Phase 3), 2026-11-15
- Context: Financing applications carry sensitive papers (tax and social security certificates, financial statements, IDs). Several institutions compete for the same application; none should learn more than the business chose to share, and nothing should outlive the business's consent.

## Decision

1. Documents live in the owning organization's vault and are never deleted (new versions supersede old ones).
2. Read access, enforced by PostgreSQL row-level security on `documents`:
   - the owner organization;
   - Tasheel staff (verification review);
   - an institution **only** for documents attached (`application_documents`) to an application that was submitted to it, and only while that submission is not withdrawn. The check is a `SECURITY DEFINER` function (`app_institution_has_application`) so policies do not recurse.
3. Institutions never see the vault itself, other applications, or which other institutions were approached (they see their own submission and the shared timeline only).
4. Every download by another organization is recorded in the downloader's audit log (organizations write audit entries in their own name only).
5. Files are served only through the API after the RLS check; storage keys are never exposed and the bucket is private.

## Consequences

- Withdrawing an application immediately cuts institutions' access to its documents (check 26 of the SQL suite).
- An institution that wants another document asks through an information request; the business decides whether to attach it.
- The business's identity reaches institutions as a snapshot taken at submission, not through access to its organization profile.
