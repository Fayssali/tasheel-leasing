import type { TenantTx } from '@tasheel/db';

const SEQUENCES = {
  EQ: 'equipment_listing_ref_seq',
  QR: 'quotation_request_ref_seq',
  QT: 'quotation_ref_seq',
  FA: 'financing_application_ref_seq',
  OF: 'offer_ref_seq',
} as const;

/** Human reference such as EQ-2026-000123, from a PostgreSQL sequence (no gaps reused, no races). */
export async function nextReference(tx: TenantTx, prefix: keyof typeof SEQUENCES): Promise<string> {
  // The sequence name comes from the constant map above, never from input.
  const rows = (await tx.$queryRawUnsafe(`SELECT nextval('${SEQUENCES[prefix]}') AS n`)) as Array<{
    n: bigint;
  }>;
  return `${prefix}-${new Date().getFullYear()}-${String(rows[0]!.n).padStart(6, '0')}`;
}
