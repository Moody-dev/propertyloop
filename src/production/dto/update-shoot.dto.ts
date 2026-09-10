import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ShootStage } from '../../../generated/prisma/client';

export class UpdateShootDto {
  @IsString()
  @MaxLength(300)
  @IsOptional()
  title?: string;

  @IsString()
  @MaxLength(300)
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  listingId?: string | null;

  @IsString()
  @IsOptional()
  presenterId?: string;

  @IsString()
  @IsOptional()
  secretaryId?: string;

  /** Explicit null un-books the shoot and rewinds it to Requested. */
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  scheduledFor?: Date | null;

  @IsBoolean()
  @IsOptional()
  reshoot?: boolean;

  /** Null means "not read from the platform yet". */
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  engagementRate?: number | null;
}

export class SetShootStageDto {
  @IsEnum(ShootStage)
  stage: ShootStage;
}
