import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { MVP_LOCALES, type Locale } from '@tasheel/shared';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../password';

/** Organization types that can self-register. The platform organization is seeded, never registered. */
export const SELF_REGISTER_TYPES = ['SUPPLIER', 'FINANCIAL_INSTITUTION', 'BUSINESS'] as const;
export type SelfRegisterType = (typeof SELF_REGISTER_TYPES)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  // --- Organization ---
  @IsIn(SELF_REGISTER_TYPES)
  organizationType: SelfRegisterType;

  @Transform(trim)
  @IsString()
  @Length(2, 200)
  legalName: string;

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
  @Matches(/^\d{2}$/, { message: 'wilayaCode must be a 2-digit code' })
  wilayaCode?: string;

  // --- First administrator ---
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  firstName: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  lastName: string;

  @IsOptional()
  @Matches(/^\+?[0-9 ]{8,20}$/, { message: 'phone must contain 8 to 20 digits' })
  phone?: string;

  @IsOptional()
  @IsIn(MVP_LOCALES)
  locale?: Locale;

  /** Explicit consent to the terms and privacy notice (personal data law). */
  @Equals(true, { message: 'acceptTerms must be true' })
  acceptTerms: boolean;
}
