import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, withTenantContext, type TenantContext, type TenantTx } from '@tasheel/db';

/**
 * Connects as the application role (DATABASE_URL → tasheel_app), which is subject to RLS.
 * Tenant-scoped work must use `forTenant`; direct queries on tenant tables return nothing
 * because no tenant context is set.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  forTenant<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return withTenantContext(this, ctx, fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
