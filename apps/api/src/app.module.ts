import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { StorageModule } from './storage/storage.module';
import { MailModule } from './mail/mail.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { DocumentsModule } from './documents/documents.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuotationsModule } from './quotations/quotations.module';
import { PermissionsGuard } from './tenancy/permissions.guard';
import { TenantGuard } from './tenancy/tenant.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuditModule,
    MailModule,
    StorageModule,
    AuthModule,
    HealthModule,
    OrganizationsModule,
    AdminModule,
    MarketplaceModule,
    QuotationsModule,
    DocumentsModule,
  ],
  // Global guards run in this order: rate limit → authentication → organization → permissions.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
