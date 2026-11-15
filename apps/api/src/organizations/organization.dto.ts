import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { MVP_LOCALES, type Locale } from '@tasheel/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Fields that define the legal identity checked during verification. */
export const LEGAL_IDENTITY_FIELDS = [
  'legalName',
  'rcNumber',
  'nif',
  'nis',
  'articleImposition',
] as const;

export class UpdateOrganizationDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 200)
  legalName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  tradeName?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  rcNumber?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  nif?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  nis?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  articleImposition?: string;

  @IsOptional()
  @Matches(/^\d{2}$/, { message: 'wilayaCode must be a 2-digit code' })
  wilayaCode?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Matches(/^\+?[0-9 ]{8,20}$/, { message: 'phone must contain 8 to 20 digits' })
  phone?: string;

  @IsOptional()
  @IsIn(MVP_LOCALES)
  defaultLocale?: Locale;
}
