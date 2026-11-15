export * from '@prisma/client';
export { withTenantContext, type TenantContext, type TenantTx } from './tenant-context';
/** Parameterized SQL fragments for $queryRaw (same helpers as Prisma.sql / Prisma.join). */
export { sqltag as sql, join as sqlJoin, Sql } from '@prisma/client/runtime/library';

/**
 * Marks a validated value (DTO, specs, snapshot) as JSON for a Json column. Prisma's input type
 * for JSON does not accept class instances without an index signature; the value has already
 * been validated, so the cast is safe and kept in one place.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const asJson = (value: unknown): any => value;
