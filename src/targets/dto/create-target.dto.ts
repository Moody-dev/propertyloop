import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { TargetUnit } from '../../../generated/prisma/client';
import { METRIC_KEYS } from '../targets.service';

export class CreateTargetDto {
  @IsString()
  @IsNotEmpty()
  staffId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label: string;

  @IsNumber()
  @Min(0)
  min: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  max?: number;

  @IsEnum(TargetUnit)
  unit: TargetUnit;

  /** True when the number is a limit to stay under rather than reach. */
  @IsBoolean()
  @IsOptional()
  ceiling?: boolean;

  /** YYYY-MM. Defaults to the current month. */
  @Matches(/^\d{4}-\d{2}$/, { message: 'period must be YYYY-MM' })
  @IsOptional()
  period?: string;

  /**
   * Supplying this makes the target DATABASE-backed: its actual is derived
   * by query and nobody can type it. Omit for a manually-entered target.
   */
  @IsIn(METRIC_KEYS as unknown as string[])
  @IsOptional()
  metricKey?: string;
}
