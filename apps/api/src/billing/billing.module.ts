import { Module } from '@nestjs/common';
import { AdminBillingController, PayerBillingController } from './billing.controllers';
import { BillingSettingsService } from './billing-settings.service';
import { BillingService } from './billing.service';

@Module({
  controllers: [AdminBillingController, PayerBillingController],
  providers: [BillingService, BillingSettingsService],
})
export class BillingModule {}
