import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
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

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const MONEY = /^\d{1,16}(\.\d{1,2})?$/;
const RATE = /^\d{1,2}(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Tasheel's legal identity printed on invoices (legal mentions required on Algerian invoices). */
export class IssuerDto {
  @Transform(trim) @IsString() @Length(2, 200) legalName: string;
  @Transform(trim) @IsString() @Length(5, 300) address: string;
  @Matches(/^\d{2}$/) wilayaCode: string;
  @Transform(trim) @IsString() @Length(5, 40) rcNumber: string;
  @Transform(trim) @IsString() @Length(5, 40) nif: string;
  @Transform(trim) @IsString() @Length(5, 40) nis: string;
  @Transform(trim) @IsString() @Length(3, 40) articleImposition: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) bankName?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) rib?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) email?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) phone?: string;
}

export class BillingSettingsDto {
  @ValidateNested() @Type(() => IssuerDto) issuer: IssuerDto;
  /** VAT rate applied to commissions, set by Tasheel (not hardcoded). */
  @Matches(RATE) vatRate: string;
  @IsInt() @Min(0) @Max(180) paymentTermsDays: number;
  @Matches(/^[A-Z]{2,6}$/) invoicePrefix: string;
  @Matches(/^[A-Z]{2,6}$/) creditNotePrefix: string;
}

export class LocalizedNameDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) fr?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) ar?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) en?: string;
}

export class CommissionRuleDto {
  @ValidateNested() @Type(() => LocalizedNameDto) name: LocalizedNameDto;
  @IsIn(['QUOTATION_ACCEPTED', 'OFFER_ACCEPTED']) trigger: 'QUOTATION_ACCEPTED' | 'OFFER_ACCEPTED';
  @IsOptional() @IsUUID() payerOrgId?: string;
  @IsIn(['PERCENT', 'FIXED']) basis: 'PERCENT' | 'FIXED';
  @IsOptional() @Matches(RATE) ratePct?: string;
  @IsOptional() @Matches(MONEY) fixedAmount?: string;
  @IsOptional() @Matches(MONEY) minAmount?: string;
  @IsOptional() @Matches(MONEY) maxAmount?: string;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @Matches(/^[a-z0-9-]{2,40}$/, { each: true })
  categoryCodes: string[];
  @Matches(DATE) validFrom: string;
  @IsOptional() @Matches(DATE) validTo?: string;
  @IsBoolean() isActive: boolean;
}

export class GenerateInvoicesDto {
  /** Commissions accrued up to and including this date are invoiced. */
  @Matches(DATE) periodEnd: string;
}

export class PaymentDto {
  @Matches(DATE) paidOn: string;
  @Transform(trim) @IsString() @Length(2, 100) reference: string;
}

export class CreditNoteDto {
  @Transform(trim) @IsString() @Length(3, 500) reason: string;
  /** true: the commissions return to "accrued" and can be invoiced again; false: cancelled. */
  @IsBoolean() releaseCommissions: boolean;
}

export class InvoiceQueryDto {
  @IsOptional() @IsIn(['DRAFT', 'ISSUED', 'PAID', 'CANCELLED']) status?:
    'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED';
  @IsOptional() @IsUUID() organizationId?: string;
}

export class CommissionQueryDto {
  @IsOptional() @IsIn(['ACCRUED', 'INVOICED', 'CANCELLED']) status?:
    'ACCRUED' | 'INVOICED' | 'CANCELLED';
  @IsOptional() @IsUUID() organizationId?: string;
}
