import { IsString, Length, Matches } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../password';

/** A 6-digit TOTP code or an 8-character recovery code (with or without the dash). */
const CODE_RE = /^(\d{3} ?\d{3}|[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})$/;

export class MfaPasswordDto {
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;
}

export class MfaCodeDto {
  @IsString()
  @Matches(CODE_RE, { message: 'code must be a 6-digit code or a recovery code' })
  code: string;
}

export class MfaDisableDto {
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;

  @IsString()
  @Matches(CODE_RE, { message: 'code must be a 6-digit code or a recovery code' })
  code: string;
}

export class MfaLoginDto {
  @IsString()
  @Length(20, 2000)
  mfaToken: string;

  @IsString()
  @Matches(CODE_RE, { message: 'code must be a 6-digit code or a recovery code' })
  code: string;
}
