import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  ORGANIZATION_STATUSES,
  ORGANIZATION_TYPES,
  type OrganizationStatus,
  type OrganizationType,
} from '@tasheel/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class OrganizationListQueryDto {
  @IsOptional()
  @IsIn(ORGANIZATION_STATUSES)
  status?: OrganizationStatus;

  @IsOptional()
  @IsIn(ORGANIZATION_TYPES)
  type?: OrganizationType;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  q?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AuditQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @Matches(/^[a-z_.]{2,80}$/)
  action?: string;

  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class StatusChangeDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 1000)
  reason?: string;
}
