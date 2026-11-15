import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH } from '../password';

export class LoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;

  // No minimum length here: old passwords may predate a policy change.
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password: string;
}
