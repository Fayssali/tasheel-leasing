import { Module } from '@nestjs/common';
import {
  BusinessQuotationsController,
  SupplierQuotationsController,
} from './quotations.controller';
import { QuotationsService } from './quotations.service';

@Module({
  controllers: [BusinessQuotationsController, SupplierQuotationsController],
  providers: [QuotationsService],
})
export class QuotationsModule {}
