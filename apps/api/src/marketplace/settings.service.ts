import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@tasheel/db';
import { PrismaService } from '../prisma/prisma.service';

export const MODERATION_KEY = 'marketplace.moderation';

/** Platform settings stored in the database, never in code (rule: configuration, not code). */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async moderationEnabled(tx?: TenantTx): Promise<boolean> {
    const client = tx ?? this.prisma;
    const row = (await client.platformSetting.findUnique({ where: { key: MODERATION_KEY } })) as {
      value: unknown;
    } | null;
    return row?.value === true;
  }

  async setModeration(tx: TenantTx, enabled: boolean, userId: string): Promise<void> {
    await tx.platformSetting.upsert({
      where: { key: MODERATION_KEY },
      update: { value: enabled, updatedById: userId },
      create: { key: MODERATION_KEY, value: enabled, updatedById: userId },
    });
  }
}
