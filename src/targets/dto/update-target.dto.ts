import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { TargetUnit } from '../../../generated/prisma/client';

export class UpdateTargetDto {
  @IsString()
  @MaxLength(200)
  @IsOptional()
  label?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  min?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  max?: number;

  /** Ignored for DATABASE-backed targets, which recompute on read. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  actual?: number;

  @IsEnum(TargetUnit)
  @IsOptional()
  unit?: TargetUnit;

  @IsBoolean()
  @IsOptional()
  ceiling?: boolean;
}

export class RollForwardDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'from must be YYYY-MM' })
  from: string;

  @Matches(/^\d{4}-\d{2}$/, { message: 'to must be YYYY-MM' })
  to: string;
}
