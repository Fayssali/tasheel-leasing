import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentTenant, RequirePermissions } from '../common/decorators';
import { requestMeta, type TenantInfo } from '../common/request-context';
import {
  BillingSettingsDto,
  CommissionQueryDto,
  CommissionRuleDto,
  CreditNoteDto,
  GenerateInvoicesDto,
  InvoiceQueryDto,
  PaymentDto,
} from './billing.dto';
import { BillingService } from './billing.service';

/** Tasheel: billing settings, commission rules, commissions and invoices. */
@Controller('admin/billing')
export class AdminBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('settings')
  @RequirePermissions('admin.billing.manage')
  settings(@CurrentTenant() t: TenantInfo) {
    return this.billing.getSettings(t);
  }

  @Put('settings')
  @RequirePermissions('admin.billing.manage')
  setSettings(
    @CurrentTenant() t: TenantInfo,
    @Body() dto: BillingSettingsDto,
    @Req() req: Request,
  ) {
    return this.billing.setSettings(t, dto, requestMeta(req));
  }

  @Get('rules')
  @RequirePermissions('admin.billing.manage')
  rules(@CurrentTenant() t: TenantInfo) {
    return this.billing.rules(t);
  }

  @Post('rules')
  @RequirePermissions('admin.billing.manage')
  createRule(@CurrentTenant() t: TenantInfo, @Body() dto: CommissionRuleDto, @Req() req: Request) {
    return this.billing.saveRule(t, null, dto, requestMeta(req));
  }

  @Put('rules/:id')
  @RequirePermissions('admin.billing.manage')
  updateRule(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommissionRuleDto,
    @Req() req: Request,
  ) {
    return this.billing.saveRule(t, id, dto, requestMeta(req));
  }

  @Get('commissions')
  @RequirePermissions('admin.billing.manage')
  commissions(@CurrentTenant() t: TenantInfo, @Query() q: CommissionQueryDto) {
    return this.billing.commissions(t, q);
  }

  @Post('commissions/accrue-missing')
  @HttpCode(200)
  @RequirePermissions('admin.billing.manage')
  accrueMissing(@CurrentTenant() t: TenantInfo, @Req() req: Request) {
    return this.billing.accrueMissing(t, requestMeta(req));
  }

  @Get('invoices')
  @RequirePermissions('admin.billing.manage')
  invoices(@CurrentTenant() t: TenantInfo, @Query() q: InvoiceQueryDto) {
    return this.billing.invoices(t, q);
  }

  @Post('invoices/generate')
  @HttpCode(200)
  @RequirePermissions('admin.billing.manage')
  generate(@CurrentTenant() t: TenantInfo, @Body() dto: GenerateInvoicesDto, @Req() req: Request) {
    return this.billing.generateDrafts(t, dto.periodEnd, requestMeta(req));
  }

  @Get('invoices/:id')
  @RequirePermissions('admin.billing.manage')
  invoice(@CurrentTenant() t: TenantInfo, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.invoice(t, id, false);
  }

  @Post('invoices/:id/issue')
  @HttpCode(200)
  @RequirePermissions('admin.billing.manage')
  issue(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.billing.issue(t, id, requestMeta(req));
  }

  @Post('invoices/:id/discard')
  @HttpCode(200)
  @RequirePermissions('admin.billing.manage')
  discard(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.billing.discardDraft(t, id, requestMeta(req));
  }

  @Post('invoices/:id/paid')
  @HttpCode(200)
  @RequirePermissions('admin.billing.manage')
  paid(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PaymentDto,
    @Req() req: Request,
  ) {
    return this.billing.markPaid(t, id, dto.paidOn, dto.reference, requestMeta(req));
  }

  @Post('invoices/:id/credit-note')
  @RequirePermissions('admin.billing.manage')
  credit(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreditNoteDto,
    @Req() req: Request,
  ) {
    return this.billing.creditNote(t, id, dto, requestMeta(req));
  }
}

/** Supplier or institution: its own commissions, invoices and the rules that apply to it. */
@Controller('billing')
export class PayerBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('invoices')
  @RequirePermissions('billing.read')
  invoices(@CurrentTenant() t: TenantInfo) {
    return this.billing.payerInvoices(t);
  }

  @Get('invoices/:id')
  @RequirePermissions('billing.read')
  invoice(@CurrentTenant() t: TenantInfo, @Param('id', ParseUUIDPipe) id: string) {
    return this.billing.invoice(t, id, true);
  }

  @Get('commissions')
  @RequirePermissions('billing.read')
  commissions(@CurrentTenant() t: TenantInfo) {
    return this.billing.payerCommissions(t);
  }

  @Get('rules')
  @RequirePermissions('billing.read')
  rules(@CurrentTenant() t: TenantInfo) {
    return this.billing.payerRules(t);
  }
}
