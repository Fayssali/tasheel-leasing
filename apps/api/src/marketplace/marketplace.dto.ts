import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

export class LocalizedTextDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  fr?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  ar?: string;
}

export class LocalizedLongTextDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  fr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  ar?: string;
}

export class ListingInputDto {
  @IsUUID()
  categoryId: string;

  @ValidateNested()
  @Type(() => LocalizedTextDto)
  title: LocalizedTextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalizedLongTextDto)
  description?: LocalizedLongTextDto;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  brand?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  year?: number;

  @IsIn(['NEW', 'USED', 'REFURBISHED'])
  condition: 'NEW' | 'USED' | 'REFURBISHED';

  /** Decimal string, e.g. "15000000.00". Omit with priceOnRequest = true. */
  @IsOptional()
  @Matches(MONEY, { message: 'price must be a decimal amount with up to 2 decimals' })
  price?: string;

  @IsBoolean()
  priceOnRequest: boolean;

  @IsBoolean()
  priceIncludesVat: boolean;

  @IsIn(['IN_STOCK', 'ON_ORDER', 'UNAVAILABLE'])
  availability: 'IN_STOCK' | 'ON_ORDER' | 'UNAVAILABLE';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(730)
  leadTimeDays?: number;

  /** Two-digit wilaya codes; empty means nationwide delivery. */
  @IsArray()
  @ArrayMaxSize(80)
  @Matches(/^\d{2}$/, { each: true })
  deliveryWilayas: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  warrantyMonths?: number;

  @IsOptional()
  @IsObject()
  specs?: Record<string, unknown>;
}

export class SearchQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  q?: string;

  @IsOptional()
  @Matches(/^[a-z0-9-]{2,40}$/)
  category?: string;

  @IsOptional()
  @IsIn(['NEW', 'USED', 'REFURBISHED'])
  condition?: string;

  @IsOptional()
  @Matches(/^\d{2}$/)
  wilaya?: string;

  @IsOptional()
  @Matches(MONEY)
  minPrice?: string;

  @IsOptional()
  @Matches(MONEY)
  maxPrice?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsIn(['relevance', 'newest', 'price_asc', 'price_desc'])
  sort?: 'relevance' | 'newest' | 'price_asc' | 'price_desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  pageSize?: number;
}

export class ListingStatusQueryDto {
  @IsOptional()
  @IsIn(['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'ARCHIVED', 'REJECTED'])
  status?: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';
}

export class ReorderDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  imageIds: string[];
}

export class ReasonDto {
  @Transform(trim)
  @IsString()
  @Length(3, 1000)
  reason: string;
}

export class FavouriteDto {
  @IsUUID()
  listingId: string;
}

export class DocumentKindDto {
  @IsOptional()
  @IsIn(['BROCHURE', 'SPEC_SHEET', 'OTHER'])
  kind?: 'BROCHURE' | 'SPEC_SHEET' | 'OTHER';
}

export class SettingValueDto {
  @IsBoolean()
  enabled: boolean;
}
