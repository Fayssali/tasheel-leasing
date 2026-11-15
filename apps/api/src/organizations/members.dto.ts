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
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/password';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const ROLE_CODE = /^[a-z][a-z0-9_]{1,62}$/;

export class InviteDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;

  @Matches(ROLE_CODE)
  roleCode: string;
}

export class InvitationTokenDto {
  @IsString()
  @Length(80, 200)
  token: string;
}

export class AcceptInvitationDto {
  @IsString()
  @Length(80, 200)
  token: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  firstName: string;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  lastName: string;

  @IsString()
  @Length(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)
  password: string;

  @IsOptional()
  @IsIn(MVP_LOCALES)
  locale?: Locale;

  @Equals(true, { message: 'acceptTerms must be true' })
  acceptTerms: boolean;
}

export class UpdateMemberDto {
  @IsOptional()
  @Matches(ROLE_CODE)
  roleCode?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}
