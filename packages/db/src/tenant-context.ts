import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Identity of the caller for one unit of work. Set by the API after authentication
 * and after checking that the user is an active member of `organizationId`.
 */
export interface TenantContext {
  userId: string | null;
  organizationId: string | null;
}

export type TenantTx = Prisma.TransactionClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuidOrNull(value: string | null, name: string): void {
  if (value !== null && !UUID_RE.test(value)) {
    throw new Error(`withTenantContext: ${name} must be a UUID or null`);
  }
}

/**
 * Runs `fn` inside a transaction whose PostgreSQL session variables carry the tenant
 * context. Row-Level Security policies read them through app_current_org() and
 * app_current_user(). `set_config(..., true)` scopes them to this transaction only,
 * so a pooled connection can never leak one tenant's context into another request.
 *
 * Every tenant-scoped query in the API must go through this helper.
 */
export async function withTenantContext<T>(
  prisma: PrismaClient,
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  assertUuidOrNull(ctx.organizationId, 'organizationId');
  assertUuidOrNull(ctx.userId, 'userId');

  return prisma.$transaction(async (tx: TenantTx) => {
    await tx.$executeRaw`SELECT
      set_config('app.org_id', ${ctx.organizationId ?? ''}, true),
      set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
    return fn(tx);
  });
}
