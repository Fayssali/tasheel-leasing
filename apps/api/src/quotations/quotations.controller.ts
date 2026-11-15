import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Request } from 'express';
import { CurrentTenant, RequirePermissions } from '../common/decorators';
import { requestMeta, type TenantInfo } from '../common/request-context';
import { QuotationsService } from './quotations.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class QuotationRequestDto {
  @IsUUID()
  listingId: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  quantity: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @Matches(/^\d{2}$/)
  deliveryWilaya?: string;
}

export class QuotationLineDto {
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  label: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  quantity: number;

  @Matches(/^\d{1,16}(\.\d{1,2})?$/, {
    message: 'unitPrice must be a decimal amount with up to 2 decimals',
  })
  unitPrice: string;
}

export class IssueQuotationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  lines: QuotationLineDto[];

  /** Percentage entered by the supplier, e.g. "19" or "9.5". */
  @Matches(/^\d{1,2}(\.\d{1,4})?$/)
  vatRate: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validUntil: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  deliveryTerms?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class RequestStatusQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'QUOTED', 'CLOSED', 'CANCELLED'])
  status?: string;
}

/** Business side. */
@Controller('quotation-requests')
export class BusinessQuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  @RequirePermissions('quotation.request')
  list(@CurrentTenant() t: TenantInfo) {
    return this.quotations.forBusiness(t);
  }

  @Post()
  @RequirePermissions('quotation.request')
  request(@CurrentTenant() t: TenantInfo, @Body() dto: QuotationRequestDto, @Req() req: Request) {
    return this.quotations.request(t, dto, requestMeta(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('quotation.request')
  cancel(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.quotations.cancelRequest(t, id, requestMeta(req));
  }

  @Post('quotations/:quotationId/accept')
  @HttpCode(200)
  @RequirePermissions('quotation.request')
  accept(
    @CurrentTenant() t: TenantInfo,
    @Param('quotationId', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.quotations.decide(t, id, 'accept', requestMeta(req));
  }

  @Post('quotations/:quotationId/decline')
  @HttpCode(200)
  @RequirePermissions('quotation.request')
  decline(
    @CurrentTenant() t: TenantInfo,
    @Param('quotationId', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.quotations.decide(t, id, 'decline', requestMeta(req));
  }
}

/** Supplier side. */
@Controller('supplier/quotation-requests')
export class SupplierQuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  @RequirePermissions('quotation.respond')
  inbox(@CurrentTenant() t: TenantInfo, @Query() q: RequestStatusQueryDto) {
    return this.quotations.forSupplier(t, q.status);
  }

  @Post(':id/quotations')
  @RequirePermissions('quotation.respond')
  issue(
    @CurrentTenant() t: TenantInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueQuotationDto,
    @Req() req: Request,
  ) {
    return this.quotations.issue(t, id, dto, requestMeta(req));
  }

  @Post('quotations/:quotationId/withdraw')
  @HttpCode(200)
  @RequirePermissions('quotation.respond')
  withdraw(
    @CurrentTenant() t: TenantInfo,
    @Param('quotationId', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.quotations.withdraw(t, id, requestMeta(req));
  }
}
