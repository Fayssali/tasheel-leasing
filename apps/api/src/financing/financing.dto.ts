import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
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

export class LocalizedNameDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) fr?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) ar?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) en?: string;
}

export class LocalizedTextDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) fr?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) ar?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) en?: string;
}

export class ProductDto {
  @ValidateNested() @Type(() => LocalizedNameDto) name: LocalizedNameDto;
  @IsOptional() @ValidateNested() @Type(() => LocalizedTextDto) description?: LocalizedTextDto;
  @IsIn(['LEASING', 'IJARA']) productType: 'LEASING' | 'IJARA';
  @Matches(MONEY) minAmount: string;
  @Matches(MONEY) maxAmount: string;
  @IsInt() @Min(1) @Max(240) minDurationMonths: number;
  @IsInt() @Min(1) @Max(240) maxDurationMonths: number;
  @Matches(RATE) minDownPaymentPct: string;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @Matches(/^[a-z0-9-]{2,40}$/, { each: true })
  categoryCodes: string[];
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(58)
  @Matches(/^\d{2}$/, { each: true })
  wilayaCodes: string[];
  @IsInt() @Min(0) @Max(100) minYearsInBusiness: number;
  /** Annual percentage range published by the institution (indicative). */
  @Matches(RATE) indicativeRateMin: string;
  @Matches(RATE) indicativeRateMax: string;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @Matches(/^[a-z0-9_-]{2,40}$/, { each: true })
  requiredDocumentTypes: string[];
  @IsBoolean() isActive: boolean;
}

export class CompanyProfileDto {
  @IsOptional() @IsInt() @Min(0) @Max(200) yearsInBusiness?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) employees?: number;
  /** Latest annual revenue in DZD, as declared by the business. */
  @IsOptional() @Matches(MONEY) annualRevenue?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(150) sector?: string;
}

export class ApplicationDto {
  @IsUUID() quotationId: string;
  @Matches(MONEY) downPayment: string;
  @IsInt() @Min(1) @Max(240) durationMonths: number;
  @IsOptional() @IsIn(['LEASING', 'IJARA']) preferredType?: 'LEASING' | 'IJARA';
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) purpose?: string;
  @IsObject() @ValidateNested() @Type(() => CompanyProfileDto) companyProfile: CompanyProfileDto;
}

export class ApplicationUpdateDto {
  @Matches(MONEY) downPayment: string;
  @IsInt() @Min(1) @Max(240) durationMonths: number;
  @IsOptional() @IsIn(['LEASING', 'IJARA']) preferredType?: 'LEASING' | 'IJARA';
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) purpose?: string;
  @IsObject() @ValidateNested() @Type(() => CompanyProfileDto) companyProfile: CompanyProfileDto;
}

export class DocumentIdsDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(30) @IsUUID('all', { each: true }) documentIds: string[];
}

export class SubmitDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(10) @IsUUID('all', { each: true }) productIds: string[];
}

export class NoteDto {
  @Transform(trim) @IsString() @Length(3, 2000) note: string;
}

export class InfoReplyDto {
  @Transform(trim) @IsString() @Length(3, 2000) note: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  documentIds?: string[];
}

export class ReasonDto {
  @Transform(trim) @IsString() @Length(3, 1000) reason: string;
}

export class OfferDto {
  @IsOptional() @IsUUID() productId?: string;
  @Matches(MONEY) financedAmount: string;
  @Matches(MONEY) downPayment: string;
  @IsInt() @Min(1) @Max(240) durationMonths: number;
  /** Annual rate or profit margin, entered by the institution. */
  @Matches(RATE) ratePct: string;
  @Matches(MONEY) residualValue: string;
  @Matches(MONEY) feesAmount: string;
  @Matches(DATE) validUntil: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(3000) conditions?: string;
}

export class SubmissionStatusQueryDto {
  @IsOptional()
  @IsIn(['SENT', 'UNDER_REVIEW', 'INFO_REQUESTED', 'OFFER_MADE', 'DECLINED', 'WITHDRAWN', 'CLOSED'])
  status?:
    'SENT' | 'UNDER_REVIEW' | 'INFO_REQUESTED' | 'OFFER_MADE' | 'DECLINED' | 'WITHDRAWN' | 'CLOSED';
}
