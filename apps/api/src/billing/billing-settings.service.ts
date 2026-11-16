import { BadRequestException, Injectable } from '@nestjs/common';
import { asJson, type TenantTx } from '@tasheel/db';
import type { BillingSettingsDto } from './billing.dto';

export const BILLING_KEY = 'billing.settings';
export type BillingSettings = BillingSettingsDto;

/**
 * Billing configuration stored in platform_settings: issuer identity, VAT rate, payment terms
 * and number prefixes. Nothing has a default: invoices cannot be issued until Tasheel sets them.
 */
@Injectable()
export class BillingSettingsService {
  async get(tx: TenantTx): Promise<BillingSettings | null> {
    const row = (await tx.platformSetting.findUnique({ where: { key: BILLING_KEY } })) as {
      value: unknown;
    } | null;
    return (row?.value as BillingSettings | undefined) ?? null;
  }

  async require(tx: TenantTx): Promise<BillingSettings> {
    const s = await this.get(tx);
    if (!s) {
      throw new BadRequestException({
        code: 'BILLING_NOT_CONFIGURED',
        message: 'Configure the billing settings (issuer identity, VAT rate, terms) first.',
      });
    }
    return s;
  }

  async set(tx: TenantTx, settings: BillingSettingsDto, userId: string): Promise<void> {
    await tx.platformSetting.upsert({
      where: { key: BILLING_KEY },
      update: { value: asJson(settings), updatedById: userId },
      create: { key: BILLING_KEY, value: asJson(settings), updatedById: userId },
    });
  }
}
